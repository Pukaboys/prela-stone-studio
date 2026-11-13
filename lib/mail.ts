/**
 * Sending email over SMTP (no extra packages).
 *
 * Settings (Hostinger: Emails → your mailbox → "Connect apps & devices"):
 *   SMTP_HOST  e.g. smtp.hostinger.com
 *   SMTP_PORT  465 (SSL, default) — 587 uses STARTTLS
 *   SMTP_SECURE optional: "ssl" or "starttls" (default: ssl on 465, starttls otherwise)
 *   SMTP_USER  the mailbox, e.g. info@your-domain.com
 *   SMTP_PASS  the mailbox password
 *   MAIL_FROM  optional, e.g. "Jeo Stone Studio <info@your-domain.com>"
 *
 * Without SMTP_HOST/SMTP_USER/SMTP_PASS nothing is sent (mailEnabled() is
 * false) and the site works without email features.
 */
import { getSetting } from "@/lib/storage";

export type Mail = { to: string; subject: string; text: string; html: string };

type Config = { host: string; port: number; user: string; pass: string; from: string; tls: boolean; ssl: boolean };

async function config(): Promise<Config | null> {
  const host = await getSetting("SMTP_HOST");
  const user = await getSetting("SMTP_USER");
  const pass = await getSetting("SMTP_PASS");
  if (!host || !user || !pass) return null;
  const port = Number((await getSetting("SMTP_PORT")) || 465);
  const from = (await getSetting("MAIL_FROM")) || `Jeo Stone Studio <${user}>`;
  // Plain connections are only for the test suite's local fake server.
  const tls = !(process.env.NODE_ENV === "test" && process.env.SMTP_INSECURE_TEST === "1");
  const secure = ((await getSetting("SMTP_SECURE")) ?? "").toLowerCase();
  const ssl = secure ? secure === "ssl" || secure === "tls" || secure === "true" : port === 465;
  return { host, port, user, pass, from, tls, ssl };
}

export async function mailEnabled() {
  return !!(await config());
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const address = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from;
function encodeFrom(from: string) {
  const m = /^(.*)<([^>]+)>\s*$/.exec(from);
  return m ? `${encodeHeader(m[1].trim().replace(/^"|"$/g, ""))} <${m[2]}>` : from;
}

/** The full message (multipart text + HTML, base64 bodies). */
export function buildMessage(from: string, mail: Mail, now = new Date()) {
  const boundary = "jeo-" + crypto.randomUUID();
  const domain = address(from).split("@")[1] ?? "localhost";
  return [
    `From: ${encodeFrom(from)}`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${now.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(mail.text)),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(b64(mail.html)),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** Minimal SMTP conversation: EHLO, (STARTTLS), AUTH LOGIN, MAIL, RCPT, DATA, QUIT. */
async function smtp(c: Config, mail: Mail) {
  const net = await import("node:net");
  const tlsMod = await import("node:tls");
  type Sock = import("node:net").Socket;

  let socket: Sock = c.tls && c.ssl ? tlsMod.connect({ host: c.host, port: c.port, servername: net.isIP(c.host) ? undefined : c.host }) : net.connect({ host: c.host, port: c.port });
  socket.setTimeout(20000);
  let buffer = "";
  let waiting: ((line: string) => void) | null = null;
  let failure: Error | null = null;
  // A reply is complete when its last line has "NNN " (a space after the code).
  const complete = () => /(?:^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buffer);
  const deliver = () => {
    if (!waiting || !complete()) return;
    const reply = buffer;
    buffer = "";
    const w = waiting;
    waiting = null;
    w(reply);
  };
  const attach = (s: Sock) => {
    s.on("data", (d: Buffer) => {
      buffer += d.toString("utf8");
      deliver();
    });
    s.on("error", (e: Error) => (failure = e));
    s.on("timeout", () => s.destroy(new Error("The mail server did not answer.")));
  };
  attach(socket);
  const read = () =>
    new Promise<string>((resolve, reject) => {
      if (failure) return reject(failure);
      waiting = resolve;
      socket.once("close", () => reject(failure ?? new Error("The mail server closed the connection.")));
      deliver();
    });
  const expect = async (codes: number[], command?: string) => {
    if (command !== undefined) socket.write(command + "\r\n");
    const reply = await read();
    const code = Number(reply.trim().split(/\r\n/).pop()!.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`Mail server said: ${reply.trim().split(/\r\n/).pop()}`);
    return reply;
  };

  try {
    await expect([220]);
    let ehlo = await expect([250], "EHLO jeo-stone-studio");
    if (c.tls && !c.ssl) {
      // Never send the password unencrypted.
      if (!/STARTTLS/i.test(ehlo)) throw new Error("The mail server does not offer an encrypted connection (STARTTLS).");
      await expect([220], "STARTTLS");
      socket.removeAllListeners("data");
      socket = tlsMod.connect({ socket, servername: net.isIP(c.host) ? undefined : c.host });
      attach(socket);
      ehlo = await expect([250], "EHLO jeo-stone-studio");
    }
    await expect([334], "AUTH LOGIN");
    await expect([334], b64(c.user));
    await expect([235], b64(c.pass));
    await expect([250], `MAIL FROM:<${address(c.from)}>`);
    await expect([250, 251], `RCPT TO:<${mail.to}>`);
    await expect([354], "DATA");
    // Dot-stuffing: a line starting with "." gets an extra ".".
    const body = buildMessage(c.from, mail).replace(/\r\n\./g, "\r\n..");
    await expect([250], body + "\r\n.");
    socket.write("QUIT\r\n");
  } finally {
    socket.end();
  }
}

/**
 * Send an email. Returns false (and logs) instead of throwing, so a mail
 * problem never breaks sign-up, payments or the studio.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const c = await config();
  if (!c) return false;
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(mail.to)) return false;
  try {
    await smtp(c, mail);
    return true;
  } catch (e) {
    console.error("[mail] could not send to", mail.to, "-", e instanceof Error ? e.message : e);
    return false;
  }
}
