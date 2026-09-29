import { AuthError } from "./imap.ts";
import { Connection } from "./socket.ts";
import { MailError } from "./util.ts";

// A minimal SMTP submission client (RFC 5321 / 6409): EHLO, STARTTLS or
// implicit TLS, AUTH PLAIN or LOGIN, then one message with dot-stuffing.

export type SmtpLogin = { host: string; port: number; security: "tls" | "starttls"; username: string; password: string };

function base64(text: string) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

/** Doubles a leading dot on every line and ends the data with CRLF.CRLF. */
export function dotStuff(message: Uint8Array) {
  let text = "";
  for (let index = 0; index < message.length; index += 0x8000) text += String.fromCharCode(...message.subarray(index, index + 0x8000));
  text = text.replace(/\r?\n/gu, "\r\n");
  if (!text.endsWith("\r\n")) text += "\r\n";
  text = text.replace(/(^|\r\n)\./gu, "$1..");
  return Uint8Array.from(`${text}.\r\n`, (character) => character.charCodeAt(0) & 0xff);
}

class Smtp {
  private readonly connection: Connection;
  extensions: string[] = [];

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /** One reply, which may span several "250-" lines. */
  async reply() {
    const lines: string[] = [];
    for (;;) {
      const line = await this.connection.readLine();
      lines.push(line.slice(4));
      if (!/^\d{3}-/u.test(line)) return { code: Number(line.slice(0, 3)), lines };
    }
  }

  async expect(codes: number[], what: string) {
    const reply = await this.reply();
    if (!codes.includes(reply.code)) throw new MailError(`${this.connection.host} refused ${what}: ${reply.code} ${reply.lines.join(" ").slice(0, 200)}`);
    return reply;
  }

  async send(line: string, codes: number[], what: string) {
    await this.connection.write(`${line}\r\n`);
    return this.expect(codes, what);
  }

  async writeData(data: Uint8Array) {
    await this.connection.write(data);
  }

  async hello() {
    const reply = await this.send("EHLO vox-mail", [250], "the greeting");
    this.extensions = reply.lines.slice(1).map((line) => line.toUpperCase());
  }

  supports(extension: string) {
    return this.extensions.some((line) => line === extension || line.startsWith(`${extension} `));
  }

  async authenticate(username: string, password: string) {
    const auth = this.extensions.find((line) => line.startsWith("AUTH ") || line.startsWith("AUTH=")) ?? "";
    const reply = async (line: string) => {
      await this.connection.write(`${line}\r\n`);
      return this.reply();
    };
    let result;
    if (/\bPLAIN\b/u.test(auth) || !/\bLOGIN\b/u.test(auth)) {
      result = await reply(`AUTH PLAIN ${base64(`\0${username}\0${password}`)}`);
    } else {
      result = await reply("AUTH LOGIN");
      if (result.code === 334) result = await reply(base64(username));
      if (result.code === 334) result = await reply(base64(password));
    }
    if (result.code === 535 || result.code === 534 || result.code === 530) throw new AuthError("The mail server rejected the user name or app password.");
    if (result.code !== 235) throw new MailError(`${this.connection.host} didn't accept signing in: ${result.code} ${result.lines.join(" ").slice(0, 200)}`);
  }

  async quit() {
    try {
      await this.connection.write("QUIT\r\n");
      await this.reply();
    } catch {
      // Closing anyway.
    }
    await this.connection.close();
  }
}

async function open(login: SmtpLogin) {
  const connection = await Connection.open(login.host, login.port, login.security === "tls" ? "on" : "starttls");
  const smtp = new Smtp(connection);
  try {
    await smtp.expect([220], "the connection");
    await smtp.hello();
    if (login.security === "starttls") {
      if (!smtp.supports("STARTTLS")) throw new MailError(`${login.host} doesn't offer STARTTLS on port ${login.port}.`);
      await smtp.send("STARTTLS", [220], "STARTTLS");
      connection.upgrade();
      await smtp.hello();
    }
    await smtp.authenticate(login.username, login.password);
    return smtp;
  } catch (error) {
    await connection.close();
    throw error;
  }
}

/** Signs in and out, to check the settings before saving an account. */
export async function verifySmtp(login: SmtpLogin) {
  const smtp = await open(login);
  await smtp.quit();
}

/** Sends one message to every recipient (To, Cc, and Bcc). */
export async function sendSmtp(login: SmtpLogin, from: string, recipients: string[], message: Uint8Array) {
  if (!recipients.length) throw new MailError("The message has no recipients.");
  // Addresses go into SMTP commands: no spaces, brackets, or line breaks.
  for (const address of [from, ...recipients]) {
    if (!/^[^\s<>@]+@[^\s<>@]+$/u.test(address)) throw new MailError(`"${address}" is not an email address.`);
  }
  const smtp = await open(login);
  try {
    await smtp.send(`MAIL FROM:<${from}>${smtp.supports("8BITMIME") ? " BODY=8BITMIME" : ""}`, [250], "the sender");
    for (const recipient of recipients) await smtp.send(`RCPT TO:<${recipient}>`, [250, 251], `the recipient ${recipient}`);
    await smtp.send("DATA", [354], "the message");
    await smtp.writeData(dotStuff(message));
    await smtp.expect([250], "the message");
  } finally {
    await smtp.quit();
  }
}
