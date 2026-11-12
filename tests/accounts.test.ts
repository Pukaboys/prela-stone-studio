import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Throwaway data folder and a test licence key pair (set before the modules load).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-accounts-test-"));
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.LICENSE_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
process.env.LICENSE_PUBLIC_KEY_TEST = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
process.env.PAYPAL_CLIENT_ID = "test-client";
process.env.PAYPAL_CLIENT_SECRET = "test-secret";

const signup = await import("@/app/api/auth/signup/route");
const login = await import("@/app/api/auth/login/route");
const me = await import("@/app/api/auth/me/route");
const password = await import("@/app/api/auth/password/route");
const devices = await import("@/app/api/account/devices/route");
const activate = await import("@/app/api/licence/activate/route");
const refresh = await import("@/app/api/licence/refresh/route");
const release = await import("@/app/api/licence/release/route");
const projects = await import("@/app/api/projects/route");
const order = await import("@/app/api/paypal/order/route");
const capture = await import("@/app/api/paypal/capture/route");
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

describe("PayPal checkout", () => {
  let paid = { value: "199.00", currency: "EUR", custom: "" };
  beforeAll(() => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "tok" });
      if (url.endsWith("/v2/checkout/orders") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        paid.custom = body.purchase_units[0].custom_id;
        expect(body.purchase_units[0].amount.value).toMatch(/^(19|199)\.00$/); // server-side price
        return Response.json({ id: "ORDER123ABC" });
      }
      if (url.includes("/capture"))
        return Response.json({
          id: "ORDER123ABC",
          status: "COMPLETED",
          purchase_units: [{ custom_id: paid.custom, payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: paid.currency, value: paid.value } }] } }],
        });
      throw new Error("unexpected fetch " + url);
    });
  });
  afterEach(() => {
    paid = { value: "199.00", currency: "EUR", custom: paid.custom };
  });

  it("a verified yearly payment turns the trial into a yearly licence (once per order)", async () => {
    const cookie = await newUser("jon@example.com");
    const o = await order.POST(req("paypal/order", { body: { plan: "yearly" }, cookie }));
    expect(((await o.json()) as { id: string }).id).toBe("ORDER123ABC");
    const c = await capture.POST(req("paypal/capture", { body: { orderId: "ORDER123ABC" }, cookie }));
    expect(c.status).toBe(200);
    const acc = ((await c.json()) as { account: { licence: { plan: string; daysLeft: number; maxDevices: number } } }).account;
    expect(acc.licence).toMatchObject({ plan: "yearly", daysLeft: 365, maxDevices: 2 });
    // Capturing the same order again does not extend twice.
    const again = ((await (await capture.POST(req("paypal/capture", { body: { orderId: "ORDER123ABC" }, cookie }))).json()) as { account: { licence: { daysLeft: number } } }).account;
    expect(again.licence.daysLeft).toBe(365);
  });
  it("rejects a payment for the wrong amount or another account", async () => {
    const cookie = await newUser("kai@example.com");
    await order.POST(req("paypal/order", { body: { plan: "yearly" }, cookie }));
    paid.value = "1.00";
    expect((await capture.POST(req("paypal/capture", { body: { orderId: "ORDER123ABC" }, cookie }))).status).toBe(402);
    paid.value = "199.00";
    const other = await newUser("lia@example.com");
    expect((await capture.POST(req("paypal/capture", { body: { orderId: "ORDER123ABC" }, cookie: other }))).status).toBe(402);
    expect((await order.POST(req("paypal/order", { body: { plan: "lifetime-free" }, cookie }))).status).toBe(400);
  });
  it("renewing extends from the current end date", async () => {
    const a = (await accounts.findByEmail("jon@example.com"))!;
    const before = new Date(a.licence.expiresAt).getTime();
    await accounts.applyPayment(a, "ORDER-RENEW-1", "monthly", "19.00");
    expect(new Date(a.licence.expiresAt).getTime() - before).toBe(31 * 864e5);
  });
});
