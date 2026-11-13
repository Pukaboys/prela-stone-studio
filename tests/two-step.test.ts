import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-2fa-test-"));
process.env.ADMIN_EMAIL = "boss@example.com";

const { base32Decode, base32Encode, checkTotp, hotp, stepAt } = await import("@/lib/totp");
const signup = await import("@/app/api/auth/signup/route");
const login = await import("@/app/api/auth/login/route");
const admin = await import("@/app/api/admin/accounts/route");
const twoStep = await import("@/app/api/admin/2fa/route");
const accounts = await import("@/lib/accounts");
const { setUpTwoStep } = await import("./admin-helper");

let n = 1;
function req(path: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { host: "studio.example", "x-forwarded-for": `198.18.0.${n++}` };
  if (o.body !== undefined) headers["content-type"] = "application/json";
  if (o.cookie) headers.cookie = o.cookie;
  return new Request("https://studio.example/api/" + path, { method: o.body !== undefined ? "POST" : "GET", headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
}
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
const tf = (cookie: string) => (body: unknown) => twoStep.POST(req("admin/2fa", { body, cookie }));

afterEach(() => vi.useRealTimers());

describe("authenticator codes (RFC 6238)", () => {
  // RFC 6238 appendix B key "12345678901234567890" (SHA-1).
  const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
  it("matches the RFC test vectors", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(secret)).toEqual(new TextEncoder().encode("12345678901234567890"));
    expect(hotp(secret, stepAt(59_000))).toBe("287082");
    expect(hotp(secret, stepAt(1_111_111_109_000))).toBe("081804");
    expect(hotp(secret, stepAt(2_000_000_000_000))).toBe("279037");
  });
  it("allows one step of clock drift, never a used or wrong code", () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(checkTotp(secret, hotp(secret, step), -1, now)).toBe(step);
    expect(checkTotp(secret, hotp(secret, step - 1), -1, now)).toBe(step - 1);
    expect(checkTotp(secret, hotp(secret, step + 1), -1, now)).toBe(step + 1);
    expect(checkTotp(secret, hotp(secret, step - 2), -1, now)).toBeNull();
    expect(checkTotp(secret, hotp(secret, step), step, now)).toBeNull(); // replay
    expect(checkTotp(secret, "12345", -1, now)).toBeNull();
  });
});

describe("admin page protection", () => {
  let boss = "";
  let recovery: string[] = [];

  it("registering the owner's email first does not give the admin", async () => {
    const squatter = cookieOf(await signup.POST(req("auth/signup", { body: { email: "boss@example.com", password: "i-am-not-boss-1" } })));
    expect((await admin.GET(req("admin/accounts", { cookie: squatter }))).status).toBe(403);
    expect((await tf(squatter)({ action: "start" })).status).toBe(403);
    // The real owner is named by account id instead (or proves the email by its link).
    const real = cookieOf(await signup.POST(req("auth/signup", { body: { email: "real-boss@example.com", password: "the-real-boss-2" } })));
    process.env.ADMIN_ACCOUNT_ID = (await accounts.findByEmail("real-boss@example.com"))!.id;
    expect((await admin.GET(req("admin/accounts", { cookie: squatter }))).status).toBe(403);
    expect((await admin.GET(req("admin/accounts", { cookie: real }))).status).toBe(428);
    boss = real;
  });
  it("two-step setup: the key is only accepted with a right code, then recovery codes are given once", async () => {
    const { secret } = (await (await tf(boss)({ action: "start" })).json()) as { secret: string };
    expect((await tf(boss)({ action: "confirm", code: "000000" })).status).toBe(400);
    expect((await admin.GET(req("admin/accounts", { cookie: boss }))).status).toBe(428);
    const r = await tf(boss)({ action: "confirm", code: hotp(secret, stepAt(Date.now())) });
    expect(r.status).toBe(200);
    recovery = ((await r.json()) as { recovery: string[] }).recovery;
    expect(recovery).toHaveLength(10);
    expect((await admin.GET(req("admin/accounts", { cookie: boss }))).status).toBe(200);
    const stored = JSON.stringify(await accounts.findByEmail("real-boss@example.com"));
    expect(stored).not.toContain(recovery[0]); // only hashes are kept
  });
  it("a new key cannot replace the old one without a current code", async () => {
    const other = cookieOf(await login.POST(req("auth/login", { body: { email: "real-boss@example.com", password: "the-real-boss-2" } })));
    expect((await tf(other)({ action: "start" })).status).toBe(403);
    expect((await admin.GET(req("admin/accounts", { cookie: other }))).status).toBe(428);
  });
  it("wrong codes are blocked after 5 tries and logged", async () => {
    const third = await accounts.findByEmail("real-boss@example.com");
    third!.sessions = [];
    await accounts.saveAccount(third!);
    const c = cookieOf(await login.POST(req("auth/login", { body: { email: "real-boss@example.com", password: "the-real-boss-2" } })));
    for (let i = 0; i < 5; i++) expect((await tf(c)({ action: "verify", code: "111111" })).status).toBe(400);
    expect((await tf(c)({ action: "verify", code: recovery[0] })).status).toBe(429); // even a right code waits
    accounts.forgive("admin-2fa:" + (await accounts.findByEmail("real-boss@example.com"))!.id);
    expect((await tf(c)({ action: "verify", code: recovery[0] })).status).toBe(200);
    expect((await tf(c)({ action: "verify", code: recovery[0] })).status).toBe(400); // recovery codes work once
    boss = c;
    const log = ((await (await admin.GET(req("admin/accounts", { cookie: c }))).json()) as { activity: { action: string; ip: string }[] }).activity;
    expect(log.filter((e) => e.action === "Wrong two-step code").length).toBe(6);
    expect(log[0].action).toBe("Wrong two-step code"); // the reused recovery code
    expect(log[1].action).toBe("Admin unlocked with a recovery code");
    expect(log[1].ip).toMatch(/^198\.18\.0\./);
  });
  it("the unlock lasts 12 hours", async () => {
    expect((await admin.GET(req("admin/accounts", { cookie: boss }))).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 13 * 3600e3);
    expect((await admin.GET(req("admin/accounts", { cookie: boss }))).status).toBe(428);
  });
});
