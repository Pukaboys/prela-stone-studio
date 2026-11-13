import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// ---- a tiny fake SMTP server that keeps every message it receives
type Received = { from: string; to: string; data: string; user: string; pass: string };
const inbox: Received[] = [];
const server = createServer((sock) => {
  let buf = "";
  let inData = false;
  let auth = 0;
  const cur: Received = { from: "", to: "", data: "", user: "", pass: "" };
  sock.write("220 fake ESMTP\r\n");
  sock.on("data", (d) => {
    buf += d.toString();
    while (true) {
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end < 0) return;
        cur.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        inbox.push({ ...cur });
        sock.write("250 queued\r\n");
        continue;
      }
      const i = buf.indexOf("\r\n");
      if (i < 0) return;
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (auth === 1) {
        cur.user = Buffer.from(line, "base64").toString();
        auth = 2;
        sock.write("334 UGFzc3dvcmQ6\r\n");
      } else if (auth === 2) {
        cur.pass = Buffer.from(line, "base64").toString();
        auth = 0;
        sock.write("235 ok\r\n");
      } else if (/^EHLO/i.test(line)) sock.write("250-fake\r\n250 AUTH LOGIN\r\n");
      else if (/^AUTH LOGIN/i.test(line)) {
        auth = 1;
        sock.write("334 VXNlcm5hbWU6\r\n");
      } else if (/^MAIL FROM/i.test(line)) {
        cur.from = line;
        sock.write("250 ok\r\n");
      } else if (/^RCPT TO/i.test(line)) {
        cur.to = /<([^>]+)>/.exec(line)![1];
        sock.write("250 ok\r\n");
      } else if (/^DATA/i.test(line)) {
        inData = true;
        sock.write("354 go\r\n");
      } else if (/^QUIT/i.test(line)) sock.end("221 bye\r\n");
      else sock.write("500 what\r\n");
    }
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
afterAll(() => server.close());

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-email-test-"));
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = String((server.address() as { port: number }).port);
process.env.SMTP_USER = "info@studio.example";
process.env.SMTP_PASS = "mailbox-secret";
process.env.SMTP_INSECURE_TEST = "1";
process.env.SITE_URL = "https://studio.example";
process.env.ADMIN_EMAIL = "owner@example.com";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.LICENSE_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
process.env.LICENSE_PUBLIC_KEY_TEST = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const signup = await import("@/app/api/auth/signup/route");
const login = await import("@/app/api/auth/login/route");
const forgot = await import("@/app/api/auth/forgot/route");
const reset = await import("@/app/api/auth/reset/route");
const verify = await import("@/app/api/auth/verify/route");
const activate = await import("@/app/api/licence/activate/route");
const projects = await import("@/app/api/projects/route");
const admin = await import("@/app/api/admin/accounts/route");
const twoStep = await import("@/app/api/admin/2fa/route");
const { setUpTwoStep } = await import("./admin-helper");
const accounts = await import("@/lib/accounts");
const { sendDueReminders } = await import("@/lib/reminders");
const { buildMessage } = await import("@/lib/mail");

let n = 1;
const ip = () => `192.0.2.${n++}`;
function req(path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: "studio.example", "x-forwarded-for": ip() };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  return new Request("https://studio.example/api/" + path, { method: o.body !== undefined ? "POST" : "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
}
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
/** Plain-text part of a received message, decoded. */
function textOf(m: Received) {
  const part = m.data.split(/\r\n--jeo-[^\r\n]+\r\n/).find((p) => p.startsWith("Content-Type: text/plain"))!;
  return Buffer.from(part.split("\r\n\r\n")[1].replace(/\s+/g, ""), "base64").toString("utf8");
}
const subjectOf = (m: Received) => {
  const raw = /\r\nSubject: ([^\r\n]+)/.exec("\r\n" + m.data)![1];
  const enc = /^=\?UTF-8\?B\?(.+)\?=$/.exec(raw);
  return enc ? Buffer.from(enc[1], "base64").toString("utf8") : raw;
};
async function mailTo(to: string, count = 1) {
  for (let i = 0; i < 100; i++) {
    const got = inbox.filter((m) => m.to === to);
    if (got.length >= count) return got[count - 1];
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("no email to " + to);
}
const linkIn = (m: Received) => /https:\/\/studio\.example\/\S+/.exec(textOf(m))![0];
const tokenIn = (m: Received) => decodeURIComponent(new URL(linkIn(m)).searchParams.get("token")!);

describe("message format", () => {
  it("encodes non-ASCII subjects and keeps lines short", () => {
    const msg = buildMessage("Jeo Stone Studio <info@studio.example>", { to: "a@b.example", subject: "Zgjedh planin – ë", text: "x".repeat(300), html: "<p>ë</p>" });
    expect(msg).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(Math.max(...msg.split("\r\n").map((l) => l.length))).toBeLessThanOrEqual(998);
  });
});

describe("sign-up confirmation", () => {
  let cookie = "";
  it("sends a confirmation link and tells the owner", async () => {
    const r = await signup.POST(req("auth/signup", { body: { email: "rita@example.com", password: "confirm-me-2026", name: "Rita Stone" } }));
    expect(r.status).toBe(200);
    cookie = cookieOf(r);
    const m = await mailTo("rita@example.com");
    expect(m.user).toBe("info@studio.example");
    expect(m.pass).toBe("mailbox-secret");
    expect(subjectOf(m)).toMatch(/Confirm your email/);
    expect(linkIn(m)).toMatch(/^https:\/\/studio\.example\/verify\?token=/);
    expect(subjectOf(await mailTo("owner@example.com"))).toBe("New trial: rita@example.com");
  });
  it("the studio and desktop activation wait for the confirmation", async () => {
    expect((await projects.GET(req("projects", { cookie }))).status).toBe(403);
    const act = await activate.POST(req("licence/activate", { body: { email: "rita@example.com", password: "confirm-me-2026", deviceId: "44444444-4444-4444-8444-444444444444" } }));
    expect(act.status).toBe(403);
  });
  it("resending works and the link confirms the address", async () => {
    expect((await verify.POST(req("auth/verify", { body: { action: "resend" }, cookie }))).status).toBe(200);
    const m = await mailTo("rita@example.com", 2);
    expect((await verify.POST(req("auth/verify", { body: { token: tokenIn(m) + "x" } }))).status).toBe(400);
    expect((await verify.POST(req("auth/verify", { body: { token: tokenIn(m) } }))).status).toBe(200);
    expect((await projects.GET(req("projects", { cookie }))).status).toBe(200);
  });
});

describe("forgotten password", () => {
  it("never reveals whether an email has an account", async () => {
    const before = inbox.length;
    const r = await forgot.POST(req("auth/forgot", { body: { email: "nobody@example.com" } }));
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 200));
    expect(inbox.length).toBe(before);
  });
  it("a reset link sets a new password once, and signs the old browsers out", async () => {
    const oldCookie = cookieOf(await login.POST(req("auth/login", { body: { email: "rita@example.com", password: "confirm-me-2026" } })));
    await forgot.POST(req("auth/forgot", { body: { email: "rita@example.com" } }));
    const m = await mailTo("rita@example.com", 3);
    expect(subjectOf(m)).toMatch(/Reset your password/);
    const token = tokenIn(m);
    expect((await reset.POST(req("auth/reset", { body: { token, password: "short" } }))).status).toBe(400);
    const ok = await reset.POST(req("auth/reset", { body: { token, password: "brand-new-pass-77" } }));
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).toMatch(/^jeo_account=/);
    expect((await reset.POST(req("auth/reset", { body: { token, password: "another-pass-88" } }))).status).toBe(400); // used
    expect((await projects.GET(req("projects", { cookie: oldCookie }))).status).toBe(401);
    expect((await login.POST(req("auth/login", { body: { email: "rita@example.com", password: "confirm-me-2026" } }))).status).toBe(401);
  });
});

describe("licence emails", () => {
  it("reminds 7 days and 1 day before the end, and when it ended — each once", async () => {
    const a = (await accounts.findByEmail("rita@example.com"))!;
    a.licence.expiresAt = new Date(Date.now() + 6 * 864e5).toISOString();
    await accounts.saveAccount(a);
    const before = inbox.filter((m) => m.to === "rita@example.com").length;
    expect(await sendDueReminders("https://studio.example")).toBe(1);
    expect(subjectOf(await mailTo("rita@example.com", before + 1))).toMatch(/ends in 7 days/);
    expect(await sendDueReminders("https://studio.example")).toBe(0); // not twice
    const b = (await accounts.findByEmail("rita@example.com"))!;
    b.licence.expiresAt = new Date(Date.now() + 10 * 3600e3).toISOString();
    await accounts.saveAccount(b);
    expect(await sendDueReminders("https://studio.example")).toBe(1);
    expect(subjectOf(await mailTo("rita@example.com", before + 2))).toMatch(/ends tomorrow/);
    const c = (await accounts.findByEmail("rita@example.com"))!;
    c.licence.expiresAt = new Date(Date.now() - 3600e3).toISOString();
    await accounts.saveAccount(c);
    expect(await sendDueReminders("https://studio.example")).toBe(1);
    expect(subjectOf(await mailTo("rita@example.com", before + 3))).toMatch(/has ended/);
  });
  it("thanks the customer when the owner adds a paid plan", async () => {
    const owner = cookieOf(await signup.POST(req("auth/signup", { body: { email: "owner@example.com", password: "owner-pass-2026" } })));
    // Prove ADMIN_EMAIL with the confirmation link, then turn on two-step login.
    expect((await admin.GET(req("admin/accounts", { cookie: owner }))).status).toBe(403);
    const confirm = inbox.filter((m) => m.to === "owner@example.com").find((m) => subjectOf(m).includes("Confirm"))!;
    expect((await verify.POST(req("auth/verify", { body: { token: tokenIn(confirm) } }))).status).toBe(200);
    await setUpTwoStep((body) => twoStep.POST(req("admin/2fa", { body, cookie: owner })));
    const rita = (await accounts.findByEmail("rita@example.com"))!;
    const before = inbox.filter((m) => m.to === "rita@example.com").length;
    const r = await admin.POST(req("admin/accounts", { body: { accountId: rita.id, action: "grant", plan: "yearly", amount: "199" }, cookie: owner }));
    expect(r.status).toBe(200);
    const m = await mailTo("rita@example.com", before + 1);
    expect(subjectOf(m)).toMatch(/Payment received/);
    expect(textOf(m)).toMatch(/€199\.00 for the Yearly plan/);
  });
});
