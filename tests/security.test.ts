import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Throwaway data folder, test licence keys, and SMTP set up but no SITE_URL.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-security-test-"));
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.LICENSE_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
process.env.LICENSE_PUBLIC_KEY_TEST = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_USER = "info@studio.example";
process.env.SMTP_PASS = "mailbox-secret";
delete process.env.SITE_URL;

const signup = await import("@/app/api/auth/signup/route");
const login = await import("@/app/api/auth/login/route");
const activate = await import("@/app/api/licence/activate/route");
const projects = await import("@/app/api/projects/route");
const { clientIp } = await import("@/lib/accounts");
const { siteUrl } = await import("@/lib/emails");
const { mailEnabled } = await import("@/lib/mail");
const { QUOTA } = await import("@/lib/studio-access");
const { defaultProject } = await import("@/lib/model");

let n = 1;
const ip = () => `198.18.7.${n++}`;
function req(path: string, o: { body?: unknown; raw?: BodyInit; cookie?: string; ip?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "studio.example", "x-forwarded-for": o.ip ?? ip(), ...o.headers };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  const body = o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined);
  return new Request("https://studio.example/api/" + path, { method: body !== undefined ? "POST" : "GET", headers, body, ...(o.raw instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
}
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
async function newUser(email: string, pw = "slab-planner-2026") {
  const r = await signup.POST(req("auth/signup", { body: { email, password: pw } }));
  expect(r.status).toBe(200);
  return cookieOf(r);
}

describe("email links", () => {
  it("are never built from request headers; without SITE_URL email stays off", async () => {
    expect(await siteUrl()).toBe("");
    expect(await mailEnabled()).toBe(false);
    process.env.SITE_URL = "https://studio.example/";
    expect(await siteUrl()).toBe("https://studio.example");
    expect(await mailEnabled()).toBe(true);
    delete process.env.SITE_URL;
  });
});

describe("visitor address", () => {
  const at = (h: Record<string, string>) => clientIp(new Request("https://studio.example/", { headers: h }));
  it("ignores addresses the visitor adds themselves", () => {
    expect(at({ "x-forwarded-for": "1.2.3.4, 203.0.113.50" })).toBe("203.0.113.50"); // added by our proxy
    expect(at({ "x-forwarded-for": "203.0.113.50", "cf-connecting-ip": "9.9.9.9" })).toBe("203.0.113.50"); // not on Cloudflare
    expect(at({})).toBe("local");
  });
  it("PROXY_HOPS counts our proxies from the right", () => {
    process.env.PROXY_HOPS = "2";
    expect(at({ "x-forwarded-for": "6.6.6.6, 203.0.113.50, 10.0.0.2" })).toBe("203.0.113.50");
    delete process.env.PROXY_HOPS;
  });
});

describe("password guessing", () => {
  it("is limited per account, whatever address the guesses come from", async () => {
    await newUser("guarded@example.com", "right-pass-2026");
    for (let i = 0; i < 20; i++)
      expect((await login.POST(req("auth/login", { body: { email: "guarded@example.com", password: "wrong-" + i } }))).status).toBe(401);
    // A fresh address, even with the right password, waits; desktop activation shares the limit.
    expect((await login.POST(req("auth/login", { body: { email: "guarded@example.com", password: "right-pass-2026" } }))).status).toBe(429);
    const act = await activate.POST(req("licence/activate", { body: { email: "guarded@example.com", password: "right-pass-2026", deviceId: "33333333-3333-4333-8333-333333333333" } }));
    expect(act.status).toBe(429);
  }, 30000);
});

describe("device limit", () => {
  it("holds when several computers activate at the same moment", async () => {
    await newUser("race@example.com", "race-pass-2026");
    const ids = [1, 2, 3, 4, 5].map((d) => `${d}${d}${d}${d}${d}${d}${d}${d}-0000-4000-8000-000000000000`);
    const results = await Promise.all(
      ids.map((deviceId) => activate.POST(req("licence/activate", { body: { email: "race@example.com", password: "race-pass-2026", deviceId } }))),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1); // trial: 1 computer
  });
});

describe("studio uploads", () => {
  it("stop reading a body that passes the limit, even without Content-Length", async () => {
    const cookie = await newUser("big@example.com");
    const huge = new ReadableStream({
      start(c) {
        for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(100_000).fill(32));
        c.close();
      },
    });
    const r = await projects.POST(req("projects", { raw: huge, cookie, headers: { "content-type": "application/json" } }));
    expect(r.status).toBe(413);
  });
  it("keep each trial account within its quota", async () => {
    const cookie = await newUser("quota@example.com");
    const limit = QUOTA.trial.projects;
    (QUOTA.trial as { projects: number }).projects = 1;
    try {
      const first = await projects.POST(req("projects", { body: { ...defaultProject(), id: "" }, cookie }));
      expect(first.status).toBe(200);
      const { id } = (await first.json()) as { id: string };
      expect((await projects.POST(req("projects", { body: { ...defaultProject(), id }, cookie }))).status).toBe(200); // saving again is fine
      expect((await projects.POST(req("projects", { body: { ...defaultProject(), id: "" }, cookie }))).status).toBe(507);
    } finally {
      (QUOTA.trial as { projects: number }).projects = limit;
    }
  });
});
