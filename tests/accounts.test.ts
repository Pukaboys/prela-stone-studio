import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Throwaway data folder and a test licence key pair (set before the modules load).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-accounts-test-"));
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.LICENSE_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
process.env.LICENSE_PUBLIC_KEY_TEST = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
process.env.ADMIN_EMAIL = "owner@example.com";

const signup = await import("@/app/api/auth/signup/route");
const login = await import("@/app/api/auth/login/route");
const me = await import("@/app/api/auth/me/route");
const password = await import("@/app/api/auth/password/route");
const devices = await import("@/app/api/account/devices/route");
const activate = await import("@/app/api/licence/activate/route");
const refresh = await import("@/app/api/licence/refresh/route");
const release = await import("@/app/api/licence/release/route");
const projects = await import("@/app/api/projects/route");
const admin = await import("@/app/api/admin/accounts/route");
const accounts = await import("@/lib/accounts");
const { checkLicence, verifyLicence } = await import("@/lib/licence-token");
const { defaultProject } = await import("@/lib/model");

let ipCounter = 1;
const ip = () => `198.51.100.${ipCounter++}`;
function req(path: string, init: { method?: string; body?: unknown; cookie?: string; ip?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": init.ip ?? "203.0.113.9", host: "studio.example" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  if (init.origin) headers.origin = init.origin;
  return new Request("https://studio.example/api/" + path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";

async function newUser(email: string, pw = "slab-planner-2026") {
  const r = await signup.POST(req("auth/signup", { body: { email, password: pw, name: "Test Fabricator" }, ip: ip() }));
  expect(r.status).toBe(200);
  return cookieOf(r);
}

describe("sign up and sign in", () => {
  it("creates an account with a 14-day trial and a secure session cookie", async () => {
    const r = await signup.POST(req("auth/signup", { body: { email: "Anna@Example.com", password: "marble-2026-ok" }, ip: ip() }));
    expect(r.status).toBe(200);
    const set = r.headers.get("set-cookie")!;
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/SameSite=Lax/);
    expect(set).toMatch(/Secure/);
    const body = (await r.json()) as { account: { email: string; licence: { plan: string; active: boolean; daysLeft: number } } };
    expect(body.account.email).toBe("anna@example.com");
    expect(body.account.licence).toMatchObject({ plan: "trial", active: true, daysLeft: 14 });
  });
  it("never stores the password", async () => {
    const a = (await accounts.findByEmail("anna@example.com"))!;
    expect(JSON.stringify(a)).not.toContain("marble-2026-ok");
    expect(a.hash).toHaveLength(128);
  });
  it("rejects weak passwords, bad emails and duplicates", async () => {
    expect((await signup.POST(req("auth/signup", { body: { email: "b@example.com", password: "short1" }, ip: ip() }))).status).toBe(400);
    expect((await signup.POST(req("auth/signup", { body: { email: "b@example.com", password: "onlyletterslong" }, ip: ip() }))).status).toBe(400);
    expect((await signup.POST(req("auth/signup", { body: { email: "not-an-email", password: "marble-2026-ok" }, ip: ip() }))).status).toBe(400);
    expect((await signup.POST(req("auth/signup", { body: { email: "ANNA@example.com", password: "marble-2026-ok" }, ip: ip() }))).status).toBe(409);
  });
  it("signs in with the right password only", async () => {
    expect((await login.POST(req("auth/login", { body: { email: "anna@example.com", password: "wrong-password-1" }, ip: ip() }))).status).toBe(401);
    const ok = await login.POST(req("auth/login", { body: { email: "anna@example.com", password: "marble-2026-ok" }, ip: ip() }));
    expect(ok.status).toBe(200);
    const who = (await (await me.GET(req("auth/me", { cookie: cookieOf(ok) }))).json()) as { account: { email: string } };
    expect(who.account.email).toBe("anna@example.com");
  });
  it("rejects tampered sessions and cross-site requests", async () => {
    const cookie = await newUser("carl@example.com");
    const forged = cookie.slice(0, -4) + "0000";
    expect(((await (await me.GET(req("auth/me", { cookie: forged }))).json()) as { account: unknown }).account).toBeNull();
    const cross = await login.POST(req("auth/login", { body: { email: "carl@example.com", password: "slab-planner-2026" }, origin: "https://evil.example" }));
    expect(cross.status).toBe(400);
  });
  it("changing the password ends other sessions", async () => {
    const old = await newUser("dina@example.com");
    const r = await password.POST(req("auth/password", { body: { current: "slab-planner-2026", next: "new-password-2027" }, cookie: old }));
    expect(r.status).toBe(200);
    expect(((await (await me.GET(req("auth/me", { cookie: old }))).json()) as { account: unknown }).account).toBeNull();
    expect(((await (await me.GET(req("auth/me", { cookie: cookieOf(r) }))).json()) as { account: unknown }).account).not.toBeNull();
  });
  it("blocks password guessing", async () => {
    await newUser("eve@example.com");
    const from = ip();
    for (let i = 0; i < 10; i++)
      expect((await login.POST(req("auth/login", { body: { email: "eve@example.com", password: "guess-" + i }, ip: from }))).status).toBe(401);
    expect((await login.POST(req("auth/login", { body: { email: "eve@example.com", password: "slab-planner-2026" }, ip: from }))).status).toBe(429);
  }, 30000);
});

describe("desktop licence", () => {
  const act = (email: string, deviceId: string, pw = "slab-planner-2026") =>
    activate.POST(req("licence/activate", { body: { email, password: pw, deviceId, deviceName: "Workshop PC" }, ip: ip() }));

  it("activates one computer on a trial and refuses a second", async () => {
    await newUser("fred@example.com");
    const r = await act("fred@example.com", DEVICE_A);
    expect(r.status).toBe(200);
    const { token } = (await r.json()) as { token: string };
    const check = await checkLicence(token, DEVICE_A);
    expect(check.ok).toBe(true);
    expect((await act("fred@example.com", DEVICE_B)).status).toBe(403);
  });
  it("tokens cannot be forged, moved or extended", async () => {
    const { token } = (await (await act("fred@example.com", DEVICE_A)).json()) as { token: string };
    expect((await checkLicence(token, DEVICE_B)).ok).toBe(false); // another computer
    const [body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    const longer = Buffer.from(JSON.stringify({ ...payload, exp: payload.exp + 1e12 })).toString("base64url");
    expect(await verifyLicence(`${longer}.${sig}`)).toBeNull(); // edited expiry
    expect((await checkLicence(token, DEVICE_A, payload.exp + 1)).ok).toBe(false); // after expiry
    expect((await checkLicence(token, DEVICE_A, payload.iat + 31 * 864e5)).ok).toBe(false); // offline > 30 days
  });
  it("refresh follows removed computers, and release frees the seat", async () => {
    const cookie = cookieOf(await login.POST(req("auth/login", { body: { email: "fred@example.com", password: "slab-planner-2026" }, ip: ip() })));
    const { token } = (await (await act("fred@example.com", DEVICE_A)).json()) as { token: string };
    expect((await refresh.POST(req("licence/refresh", { body: { token } }))).status).toBe(200);
    await devices.POST(req("account/devices", { body: { deviceId: DEVICE_A }, cookie }));
    expect((await refresh.POST(req("licence/refresh", { body: { token } }))).status).toBe(403);
    const again = (await (await act("fred@example.com", DEVICE_A)).json()) as { token: string };
    expect((await release.POST(req("licence/release", { body: { token: again.token } }))).status).toBe(200);
    expect((await act("fred@example.com", DEVICE_B)).status).toBe(200); // seat was freed
  });
  it("an ended licence cannot activate new computers", async () => {
    await newUser("gina@example.com");
    const a = (await accounts.findByEmail("gina@example.com"))!;
    a.licence.expiresAt = new Date(Date.now() - 1000).toISOString();
    await accounts.saveAccount(a);
    expect((await act("gina@example.com", DEVICE_A)).status).toBe(402);
  });
});

describe("online studio data", () => {
  it("each account sees only its own projects; ended licences are locked out", async () => {
    const a = await newUser("hana@example.com");
    const b = await newUser("ivan@example.com");
    const p = { ...defaultProject(), name: "Hana's kitchen" };
    const saved = await projects.POST(new Request("https://studio.example/api/projects", { method: "POST", headers: { cookie: a, "content-type": "application/json" }, body: JSON.stringify(p) }));
    expect(saved.status).toBe(200);
    const listA = (await (await projects.GET(req("projects", { cookie: a }))).json()) as { name: string }[];
    const listB = (await (await projects.GET(req("projects", { cookie: b }))).json()) as { name: string }[];
    expect(listA.map((x) => x.name)).toContain("Hana's kitchen");
    expect(listB).toEqual([]);
    expect((await projects.GET(req("projects"))).status).toBe(401);
    const acc = (await accounts.findByEmail("ivan@example.com"))!;
    acc.licence.expiresAt = new Date(Date.now() - 1000).toISOString();
    await accounts.saveAccount(acc);
    expect((await projects.GET(req("projects", { cookie: b }))).status).toBe(402);
  });
});

describe("owner switches on paid plans", () => {
  type Row = { id: string; email: string; licence: { plan: string; daysLeft: number; active: boolean }; payments: { note?: string }[] };
  const grant = (cookie: string, accountId: string, extra: object = {}) =>
    admin.POST(req("admin/accounts", { body: { accountId, action: "grant", plan: "yearly", amount: "199", note: "Bank ref 42", ...extra }, cookie }));

  it("only the owner can list customers or add plans", async () => {
    const customer = await newUser("mia@example.com");
    const mia = (await accounts.findByEmail("mia@example.com"))!;
    expect((await admin.GET(req("admin/accounts"))).status).toBe(401);
    expect((await admin.GET(req("admin/accounts", { cookie: customer }))).status).toBe(403);
    expect((await grant(customer, mia.id)).status).toBe(403);
    expect((await accounts.findByEmail("mia@example.com"))!.licence.plan).toBe("trial");
  });
  it("adding a yearly plan turns the trial into a year; adding again extends it", async () => {
    const owner = await newUser("owner@example.com");
    const me = ((await (await admin.GET(req("admin/accounts", { cookie: owner }))).json()) as { accounts: Row[] }).accounts.find((r) => r.email === "owner@example.com")!;
    expect(me.licence.daysLeft).toBeGreaterThan(3000); // the owner never runs out
    const list = ((await (await admin.GET(req("admin/accounts", { cookie: owner }))).json()) as { accounts: Row[] }).accounts;
    const mia = list.find((r) => r.email === "mia@example.com")!;
    expect(list.length).toBeGreaterThan(5);
    const r = await grant(owner, mia.id);
    expect(r.status).toBe(200);
    const row = ((await r.json()) as { account: Row }).account;
    expect(row.licence).toMatchObject({ plan: "yearly", daysLeft: 365, active: true });
    expect(row.payments[0].note).toBe("Bank ref 42");
    const again = ((await (await grant(owner, mia.id, { plan: "monthly", amount: "19" })).json()) as { account: Row }).account;
    expect(again.licence.daysLeft).toBe(365 + 31);
  });
  it("can end a licence, and rejects bad input", async () => {
    const owner = (await login.POST(req("auth/login", { body: { email: "owner@example.com", password: "slab-planner-2026" }, ip: ip() }))).headers.get("set-cookie")!.split(";")[0];
    const mia = (await accounts.findByEmail("mia@example.com"))!;
    expect((await grant(owner, mia.id, { plan: "lifetime-free" })).status).toBe(400);
    expect((await grant(owner, mia.id, { amount: "-5" })).status).toBe(400);
    expect((await grant(owner, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    const ended = await admin.POST(req("admin/accounts", { body: { accountId: mia.id, action: "end" }, cookie: owner }));
    expect(((await ended.json()) as { account: Row }).account.licence.active).toBe(false);
    const miaCookie = cookieOf(await login.POST(req("auth/login", { body: { email: "mia@example.com", password: "slab-planner-2026" }, ip: ip() })));
    expect((await projects.GET(req("projects", { cookie: miaCookie }))).status).toBe(402);
  });
  it("the owner works on the shared (existing) projects", async () => {
    const owner = cookieOf(await login.POST(req("auth/login", { body: { email: "owner@example.com", password: "slab-planner-2026" }, ip: ip() })));
    const p = { ...defaultProject(), name: "Owner project" };
    await projects.POST(new Request("https://studio.example/api/projects", { method: "POST", headers: { cookie: owner, "content-type": "application/json" }, body: JSON.stringify(p) }));
    const store = await (await import("@/lib/storage")).getStore();
    expect((await store.list("projects/")).length).toBeGreaterThan(0);
  });
});
