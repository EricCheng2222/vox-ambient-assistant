import { MailError } from "./util.ts";

// TCP for IMAP and SMTP through Workers sockets (cloudflare:sockets), with a
// buffered reader and a timeout on every step. Tests swap in a fake connector.

export type TcpSocket = {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
  startTls(options?: { expectedServerHostname?: string }): TcpSocket;
};

export type Connector = (host: string, port: number, secureTransport: "on" | "starttls") => TcpSocket | Promise<TcpSocket>;

// Only the standard mail ports; everything else is refused.
export const MAIL_PORTS = new Set([993, 143, 465, 587]);

const defaultConnector: Connector = async (host, port, secureTransport) => {
  const { connect } = await import("cloudflare:sockets");
  return connect({ hostname: host, port }, { secureTransport, allowHalfOpen: false }) as unknown as TcpSocket;
};

let connector: Connector = defaultConnector;

/** For tests: route connections to an in-memory server. */
export function setConnector(next: Connector | null) {
  connector = next ?? defaultConnector;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new MailError(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

/** Private, loopback, and link-local hosts are never mail servers here. */
export function isPublicHost(host: string) {
  const name = host.trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/u.test(name) || !name.includes(".") || name.endsWith(".local") || name === "localhost") return false;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/u.exec(name);
  if (!ip) return true;
  const [a, b] = [Number(ip[1]), Number(ip[2])];
  return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224);
}

/** A line- and byte-oriented connection with timeouts. */
export class Connection {
  private socket: TcpSocket;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = new Uint8Array(0);
  private closed = false;
  readonly host: string;
  readonly timeoutMs: number;

  private constructor(socket: TcpSocket, host: string, timeoutMs: number) {
    this.socket = socket;
    this.host = host;
    this.timeoutMs = timeoutMs;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  static async open(host: string, port: number, secure: "on" | "starttls", timeoutMs = 20_000) {
    if (!MAIL_PORTS.has(port)) throw new MailError("Only mail ports 993, 143, 465, and 587 are allowed.");
    if (!isPublicHost(host)) throw new MailError(`${host} isn't a mail server address.`);
    try {
      const socket = await connector(host, port, secure);
      await withTimeout(socket.opened, timeoutMs, `${host} didn't answer in time.`);
      return new Connection(socket, host, timeoutMs);
    } catch (error) {
      if (error instanceof MailError) throw error;
      throw new MailError(`Couldn't connect to ${host}:${port}.`);
    }
  }

  /** Upgrades a plain connection to TLS (STARTTLS), once nothing is left unread. */
  upgrade() {
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.socket = this.socket.startTls({ expectedServerHostname: this.host });
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.buffer = new Uint8Array(0);
  }

  private async fill() {
    const { value, done } = await withTimeout(this.reader.read(), this.timeoutMs, `${this.host} stopped answering.`);
    if (done || !value) throw new MailError(`${this.host} closed the connection.`);
    const next = new Uint8Array(this.buffer.length + value.length);
    next.set(this.buffer);
    next.set(value, this.buffer.length);
    this.buffer = next;
  }

  /** One line without its CRLF, as UTF-8 text. */
  async readLine(maxBytes = 1_000_000) {
    for (;;) {
      const end = this.buffer.indexOf(10);
      if (end >= 0) {
        const line = this.buffer.subarray(0, end > 0 && this.buffer[end - 1] === 13 ? end - 1 : end);
        this.buffer = this.buffer.slice(end + 1);
        return new TextDecoder().decode(line);
      }
      if (this.buffer.length > maxBytes) throw new MailError(`${this.host} sent a line that is too long.`);
      await this.fill();
    }
  }

  /** Exactly `count` bytes (an IMAP literal). */
  async readBytes(count: number) {
    while (this.buffer.length < count) await this.fill();
    const bytes = this.buffer.slice(0, count);
    this.buffer = this.buffer.slice(count);
    return bytes;
  }

  async write(data: string | Uint8Array) {
    await withTimeout(this.writer.write(typeof data === "string" ? new TextEncoder().encode(data) : data), this.timeoutMs, `${this.host} stopped accepting data.`);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.reader.releaseLock();
      this.writer.releaseLock();
    } catch {
      // Already released.
    }
    await this.socket.close().catch(() => undefined);
  }
}
