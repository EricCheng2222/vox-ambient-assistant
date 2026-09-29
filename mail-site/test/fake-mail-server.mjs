// In-memory IMAP and SMTP servers behind a fake cloudflare:sockets connector.
// They speak just enough of each protocol for Vox Mail's clients, and record
// what the clients sent so tests can check it.

const { parseValues } = await import("../src/imap.ts");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** SASL credentials are UTF-8 inside base64. */
function fromBase64(value) {
  return Buffer.from(value, "base64").toString("utf8");
}

function concat(a, b) {
  const next = new Uint8Array(a.length + b.length);
  next.set(a);
  next.set(b, a.length);
  return next;
}

/** A fake Workers socket. The server's `send` goes to whichever socket is current (after STARTTLS). */
function makeSocket(session) {
  let controller;
  const readable = new ReadableStream({
    start(value) {
      controller = value;
    },
  });
  const writable = new WritableStream({
    write(chunk) {
      session.receive(chunk);
    },
  });
  const socket = {
    readable,
    writable,
    opened: Promise.resolve({}),
    async close() {
      session.closed = true;
      try {
        controller.close();
      } catch {
        // Already closed.
      }
    },
    startTls() {
      session.tls = true;
      session.tlsUpgrades += 1;
      const next = makeSocket(session);
      session.push = next.push;
      return next;
    },
    push(bytes) {
      if (!session.closed) controller.enqueue(bytes);
    },
  };
  return socket;
}

/** Routes host:port to a server factory; records every connection. */
export function fakeConnector(servers) {
  const connections = [];
  const connector = (host, port, secureTransport) => {
    const factory = servers[`${host}:${port}`];
    if (!factory) throw new Error(`connection refused: ${host}:${port}`);
    const session = { tls: secureTransport === "on", tlsUpgrades: 0, closed: false, host, port, secureTransport };
    const socket = makeSocket(session);
    session.push = socket.push;
    session.send = (data) => session.push(typeof data === "string" ? encoder.encode(data) : data);
    const server = factory(session);
    session.receive = (chunk) => server.receive(chunk);
    connections.push(session);
    if (!server.silent) server.greet();
    return socket;
  };
  connector.connections = connections;
  return connector;
}

/** Collects client bytes into lines, pausing for literals when asked. */
class LineBuffer {
  constructor(onLine) {
    this.buffer = new Uint8Array(0);
    this.onLine = onLine;
    this.wanted = 0;
    this.onBytes = null;
  }
  receive(chunk) {
    this.buffer = concat(this.buffer, chunk);
    for (;;) {
      if (this.onBytes) {
        if (this.buffer.length < this.wanted) return;
        const bytes = this.buffer.slice(0, this.wanted);
        this.buffer = this.buffer.slice(this.wanted);
        const next = this.onBytes;
        this.onBytes = null;
        next(bytes);
        continue;
      }
      const end = this.buffer.indexOf(10);
      if (end < 0) return;
      const line = decoder.decode(this.buffer.subarray(0, end > 0 && this.buffer[end - 1] === 13 ? end - 1 : end));
      this.buffer = this.buffer.slice(end + 1);
      this.onLine(line);
    }
  }
  readBytes(count, next) {
    this.wanted = count;
    this.onBytes = next;
  }
}

// ---- IMAP ----

function quote(value) {
  if (value == null || value === "") return value === "" ? '""' : "NIL";
  if (/[^\x20-\x7e]/u.test(value)) {
    const bytes = encoder.encode(value);
    return `{${bytes.length}}\r\n${value}`;
  }
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function headersOf(raw) {
  const head = raw.split(/\r?\n\r?\n/u)[0].replace(/\r?\n[ \t]+/gu, " ");
  const headers = {};
  for (const line of head.split(/\r?\n/u)) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).toLowerCase()] ??= line.slice(index + 1).trim();
  }
  return headers;
}

function envelopeAddress(list) {
  if (!list) return "NIL";
  const items = list.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = /^(.*?)\s*<([^>]+)>$/u.exec(item);
    const name = match ? match[1].replace(/^"|"$/gu, "") : "";
    const [mailbox, host] = (match ? match[2] : item).split("@");
    return `(${name ? quote(name) : "NIL"} NIL ${quote(mailbox)} ${quote(host)})`;
  });
  return `(${items.join("")})`;
}

function envelope(raw) {
  const h = headersOf(raw);
  return `(${quote(h.date ?? "")} ${quote(h.subject ?? "")} ${envelopeAddress(h.from)} ${envelopeAddress(h.from)} ${envelopeAddress(h["reply-to"] ?? h.from)} ${envelopeAddress(h.to)} ${envelopeAddress(h.cc)} NIL ${quote(h["in-reply-to"] ?? null)} ${quote(h["message-id"] ?? null)})`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseImapDate(value) {
  const [day, month, year] = value.split("-");
  return Date.UTC(Number(year), MONTHS.indexOf(month), Number(day));
}

function text(value) {
  if (value instanceof Uint8Array) return decoder.decode(value);
  return value == null ? "" : String(value);
}

/**
 * An IMAP server over an in-memory store:
 * { users: { name: password }, capabilities, mailboxes: { name: { uidValidity, uidNext, special, messages: [{ uid, flags, raw, date }] } } }
 */
export function imapServer(store) {
  store.commands ??= [];
  return (session) => {
    let signedIn = false;
    let selected = null;
    const send = (line) => session.send(`${line}\r\n`);
    const caps = () => ["IMAP4rev1", ...store.capabilities, ...(session.secureTransport === "starttls" && !session.tls ? ["STARTTLS", "LOGINDISABLED"] : [])].join(" ");
    let pending = [];
    let buffer;
    const mailbox = (name) => store.mailboxes[name];
    const bySet = (box, set) => {
      const wanted = new Set();
      for (const part of set.split(",")) {
        const [a, b] = part.split(":");
        if (b === undefined) wanted.add(Number(a));
        else for (let uid = Number(a); uid <= (b === "*" ? box.uidNext : Number(b)); uid += 1) wanted.add(uid);
      }
      return box.messages.filter((message) => wanted.has(message.uid));
    };
    const matches = (message, tokens) => {
      const h = headersOf(message.raw);
      const has = (value, needle) => text(value).toLowerCase().includes(text(needle).toLowerCase());
      const next = () => {
        const key = text(tokens.shift()).toUpperCase();
        switch (key) {
          case "ALL":
            return true;
          case "UNSEEN":
            return !message.flags.has("\\Seen");
          case "SEEN":
            return message.flags.has("\\Seen");
          case "FLAGGED":
            return message.flags.has("\\Flagged");
          case "UNFLAGGED":
            return !message.flags.has("\\Flagged");
          case "FROM":
            return has(h.from, tokens.shift());
          case "TO":
            return has(h.to, tokens.shift());
          case "SUBJECT":
            return has(h.subject, tokens.shift());
          case "TEXT":
            return has(message.raw, tokens.shift());
          case "SINCE":
            return message.date >= parseImapDate(text(tokens.shift()));
          case "BEFORE":
            return message.date < parseImapDate(text(tokens.shift()));
          case "HEADER": {
            const name = text(tokens.shift()).toLowerCase();
            return has(h[name], tokens.shift());
          }
          case "OR": {
            const a = next();
            const b = next();
            return a || b;
          }
          default:
            throw new Error(`fake IMAP: unsupported search key ${key}`);
        }
      };
      let result = true;
      while (tokens.length) result = next() && result;
      return result;
    };
    const fetchItems = (message, items) => {
      const out = [`UID ${message.uid}`];
      const spec = items.toUpperCase();
      if (spec.includes("FLAGS")) out.push(`FLAGS (${[...message.flags].join(" ")})`);
      if (spec.includes("INTERNALDATE")) out.push(`INTERNALDATE "${new Date(message.date).toUTCString().replace(/^\w+, (\d+) (\w+) (\d+) ([\d:]+) GMT$/u, "$1-$2-$3 $4 +0000")}"`);
      if (spec.includes("ENVELOPE")) out.push(`ENVELOPE ${envelope(message.raw)}`);
      if (spec.includes("HEADER.FIELDS (REFERENCES)")) {
        const references = headersOf(message.raw).references;
        const value = references ? `References: ${references}\r\n\r\n` : "\r\n";
        out.push(`BODY[HEADER.FIELDS (REFERENCES)] {${encoder.encode(value).length}}\r\n${value}`);
      }
      const partial = /BODY\.PEEK\[\]<0\.(\d+)>/u.exec(spec);
      if (partial) {
        const bytes = encoder.encode(message.raw).slice(0, Number(partial[1]));
        out.push(`BODY[]<0> {${bytes.length}}\r\n${decoder.decode(bytes)}`);
        store.literalFetches = (store.literalFetches ?? 0) + 1;
      }
      return out.join(" ");
    };
    const handle = (tag, tokens) => {
      const command = text(tokens[0]).toUpperCase();
      const isUid = command === "UID";
      const verb = isUid ? text(tokens[1]).toUpperCase() : command;
      const args = tokens.slice(isUid ? 2 : 1);
      store.commands.push(`${isUid ? "UID " : ""}${verb}${verb === "LOGIN" || verb === "AUTHENTICATE" ? "" : ` ${args.map((arg) => (Array.isArray(arg) ? "(...)" : text(arg))).join(" ")}`}`.trim());
      if (!signedIn && !["CAPABILITY", "LOGIN", "AUTHENTICATE", "STARTTLS", "LOGOUT"].includes(verb)) return send(`${tag} NO Sign in first`);
      switch (verb) {
        case "CAPABILITY":
          send(`* CAPABILITY ${caps()}`);
          return send(`${tag} OK done`);
        case "STARTTLS":
          send(`${tag} OK Begin TLS`);
          return;
        case "LOGIN": {
          if (session.secureTransport === "starttls" && !session.tls) return send(`${tag} NO TLS first`);
          const [user, password] = args.map(text);
          if (store.users[user] !== password) return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
          signedIn = true;
          return send(`${tag} OK Logged in`);
        }
        case "AUTHENTICATE": {
          const check = (token) => {
            const [, user, password] = fromBase64(token).split("\0");
            if (store.users[user] !== password) return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
            signedIn = true;
            return send(`${tag} OK Logged in`);
          };
          if (args[1]) return check(text(args[1]));
          send("+ ");
          pending = [(line) => check(line)];
          return;
        }
        case "LIST":
          for (const [name, box] of Object.entries(store.mailboxes)) {
            send(`* LIST (\\HasNoChildren${box.special && store.capabilities.includes("SPECIAL-USE") ? ` ${box.special}` : ""}) "/" ${quote(name)}`);
          }
          return send(`${tag} OK LIST done`);
        case "SELECT":
        case "EXAMINE": {
          const box = mailbox(text(args[0]));
          if (!box) return send(`${tag} NO No such mailbox`);
          selected = text(args[0]);
          send(`* ${box.messages.length} EXISTS`);
          send(`* OK [UIDVALIDITY ${box.uidValidity}] UIDs valid`);
          return send(`${tag} OK [${verb === "SELECT" ? "READ-WRITE" : "READ-ONLY"}] done`);
        }
        case "STATUS": {
          const name = text(args[0]);
          const box = mailbox(name);
          const unseen = box.messages.filter((message) => !message.flags.has("\\Seen")).length;
          send(`* STATUS ${quote(name)} (UNSEEN ${unseen})`);
          return send(`${tag} OK done`);
        }
        case "SEARCH": {
          const box = mailbox(selected);
          let criteria = args.map((arg) => arg);
          if (text(criteria[0]).toUpperCase() === "CHARSET") criteria = criteria.slice(2);
          const found = box.messages.filter((message) => matches(message, [...criteria])).map((message) => message.uid);
          send(`* SEARCH${found.length ? ` ${found.join(" ")}` : ""}`);
          return send(`${tag} OK done`);
        }
        case "FETCH": {
          const box = mailbox(selected);
          const items = tokens.slice(isUid ? 3 : 2).flat(Infinity).map(text).join(" ");
          for (const [index, message] of bySet(box, text(args[0])).entries()) send(`* ${index + 1} FETCH (${fetchItems(message, items)})`);
          return send(`${tag} OK done`);
        }
        case "STORE": {
          const box = mailbox(selected);
          const change = text(args[1]).toUpperCase();
          const flags = (Array.isArray(args[2]) ? args[2] : [args[2]]).map(text);
          for (const message of bySet(box, text(args[0]))) {
            for (const flag of flags) {
              if (change.startsWith("+")) message.flags.add(flag);
              else message.flags.delete(flag);
            }
          }
          return send(`${tag} OK done`);
        }
        case "COPY":
        case "MOVE": {
          const box = mailbox(selected);
          const target = mailbox(text(args[1]));
          if (!target) return send(`${tag} NO [TRYCREATE] No such mailbox`);
          const moving = bySet(box, text(args[0]));
          const from = [];
          const to = [];
          for (const message of moving) {
            const uid = target.uidNext++;
            target.messages.push({ ...message, uid, flags: new Set(message.flags) });
            from.push(message.uid);
            to.push(uid);
          }
          if (verb === "MOVE") box.messages = box.messages.filter((message) => !moving.includes(message));
          const code = store.capabilities.includes("UIDPLUS") && from.length ? `[COPYUID ${target.uidValidity} ${from.join(",")} ${to.join(",")}] ` : "";
          return send(`${tag} OK ${code}done`);
        }
        case "EXPUNGE": {
          const box = mailbox(selected);
          const only = isUid ? new Set(bySet(box, text(args[0])).map((message) => message.uid)) : null;
          box.messages = box.messages.filter((message) => !(message.flags.has("\\Deleted") && (!only || only.has(message.uid))));
          return send(`${tag} OK done`);
        }
        case "APPEND": {
          const name = text(args[0]);
          const box = mailbox(name);
          const flags = Array.isArray(args[1]) ? args[1].map(text) : [];
          const raw = text(args.at(-1));
          const uid = box.uidNext++;
          box.messages.push({ uid, flags: new Set(flags), raw, date: Date.now() });
          return send(`${tag} OK ${store.capabilities.includes("UIDPLUS") ? `[APPENDUID ${box.uidValidity} ${uid}] ` : ""}done`);
        }
        case "LOGOUT":
          send("* BYE Logging out");
          return send(`${tag} OK done`);
        default:
          return send(`${tag} BAD Unknown command ${verb}`);
      }
    };
    const onLine = (line) => {
      if (pending.length && !buffer) {
        const next = pending.shift();
        return next(line);
      }
      buffer ??= [];
      const literal = /\{(\d+)(\+?)\}$/u.exec(line);
      if (literal) {
        buffer.push(line.slice(0, literal.index));
        if (!literal[2]) send("+ Ready for literal");
        reader.readBytes(Number(literal[1]), (bytes) => buffer.push(bytes));
        return;
      }
      buffer.push(line);
      const chunks = buffer;
      buffer = undefined;
      const [tag, ...tokens] = parseValues(chunks);
      handle(text(tag), tokens);
    };
    const reader = new LineBuffer(onLine);
    return {
      silent: store.silent,
      greet: () => send(`* OK ${store.greetingCapabilities ? `[CAPABILITY ${caps()}] ` : ""}Fake IMAP ready`),
      receive: (chunk) => reader.receive(chunk),
    };
  };
}

// ---- SMTP ----

/** An SMTP submission server: { users, received: [] }. */
export function smtpServer(store) {
  store.received ??= [];
  return (session) => {
    const send = (line) => session.send(`${line}\r\n`);
    let signedIn = false;
    let envelope = null;
    let data = null;
    let login = null;
    const onLine = (line) => {
      if (data) {
        if (line === ".") {
          const stuffed = data.join("\r\n");
          store.received.push({ ...envelope, stuffed, message: data.map((item) => (item.startsWith(".") ? item.slice(1) : item)).join("\r\n") });
          data = null;
          envelope = null;
          return send("250 2.0.0 Queued");
        }
        data.push(line);
        return;
      }
      if (login) {
        const step = login;
        login = null;
        return step(line);
      }
      const [verb, ...rest] = line.split(" ");
      switch (verb.toUpperCase()) {
        case "EHLO": {
          const extensions = ["AUTH PLAIN LOGIN", "8BITMIME", ...(session.port === 587 && !session.tls ? ["STARTTLS"] : [])];
          send("250-fake.example greets you");
          extensions.forEach((extension, index) => send(`250${index === extensions.length - 1 ? " " : "-"}${extension}`));
          return;
        }
        case "STARTTLS":
          return send("220 2.0.0 Ready to start TLS");
        case "AUTH": {
          if (session.port === 587 && !session.tls) return send("530 Must issue STARTTLS first");
          const accept = (user, password) => {
            if (store.users[user] !== password) return send("535 5.7.8 Authentication failed");
            signedIn = true;
            return send("235 2.7.0 Authenticated");
          };
          if (rest[0].toUpperCase() === "PLAIN") {
            const [, user, password] = fromBase64(rest[1]).split("\0");
            return accept(user, password);
          }
          send("334 VXNlcm5hbWU6");
          login = (userLine) => {
            send("334 UGFzc3dvcmQ6");
            login = (passwordLine) => accept(fromBase64(userLine), fromBase64(passwordLine));
          };
          return;
        }
        case "MAIL":
          if (!signedIn) return send("530 Authentication required");
          envelope = { from: /<(.*)>/u.exec(line)[1], recipients: [] };
          return send("250 OK");
        case "RCPT":
          envelope.recipients.push(/<(.*)>/u.exec(line)[1]);
          return send("250 OK");
        case "DATA":
          data = [];
          return send("354 End data with <CR><LF>.<CR><LF>");
        case "QUIT":
          return send("221 Bye");
        default:
          return send("502 Unknown");
      }
    };
    const reader = new LineBuffer(onLine);
    return { greet: () => send("220 fake.example ESMTP"), receive: (chunk) => reader.receive(chunk) };
  };
}
