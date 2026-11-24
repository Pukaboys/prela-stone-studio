import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-activity-test-"));
process.env.LICENSE_PRIVATE_KEY = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

const signup = await import("@/app/api/auth/signup/route");
const login = await import("@/app/api/auth/login/route");
const logout = await import("@/app/api/auth/logout/route");
const password = await import("@/app/api/auth/password/route");
const activate = await import("@/app/api/licence/activate/route");
const download = await import("@/app/api/download/route");
const twoStep = await import("@/app/api/admin/2fa/route");
const adminActivity = await import("@/app/api/admin/activity/route");
const accounts = await import("@/lib/accounts");
const activity = await import("@/lib/activity");
const { getStore } = await import("@/lib/storage");
const { setUpTwoStep } = await import("./admin-helper");

let n = 1;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
function req(path: string, o: { json?: unknown; cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { host: "studio.example", "x-forwarded-for": o.ip ?? `198.51.100.${n++}`, "user-agent": UA };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.json !== undefined) {
    headers["content-type"] = "application/json";
    headers.origin = "https://studio.example";
  }
  return new Request("https://studio.example/api/" + path, { method: o.json !== undefined ? "POST" : "GET", headers, body: o.json !== undefined ? JSON.stringify(o.json) : undefined });
}
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];
const actions = async (id: string) => (await activity.activityFor(id)).map((e) => e.action).reverse();

let customerId = "";
let boss = "";
let carla = "";

describe("customer activity log", () => {
  it("records sign-ups, sign-ins, wrong passwords and password changes, without secrets", async () => {
    const c = await signup.POST(req("auth/signup", { json: { email: "carla@example.com", password: "carla-pass-2026" } }));
    const cookie = cookieOf(c);
    customerId = (await accounts.findByEmail("carla@example.com"))!.id;
    expect((await login.POST(req("auth/login", { json: { email: "carla@example.com", password: "nope-nope-nope" }, ip: "203.0.113.7" }))).status).toBe(401);
    // Someone trying an email that has no account: nothing to log it under.
    expect((await login.POST(req("auth/login", { json: { email: "nobody@example.com", password: "x" } }))).status).toBe(401);
    const s = await login.POST(req("auth/login", { json: { email: "carla@example.com", password: "carla-pass-2026" } }));
    expect(s.status).toBe(200);
    expect((await password.POST(req("auth/password", { json: { current: "carla-pass-2026", next: "carla-pass-2027" }, cookie: cookieOf(s) }))).status).toBe(200);
    await logout.POST(req("auth/logout", { json: {}, cookie }));

    expect(await actions(customerId)).toEqual(["Account created", "Wrong password", "Signed in", "Password changed"]);
    const wrong = (await activity.activityFor(customerId)).find((e) => e.action === "Wrong password")!;
    expect(wrong).toMatchObject({ ip: "203.0.113.7", device: "Chrome on Windows", detail: "website sign-in" });
    const raw = JSON.stringify(await activity.activityFor(customerId));
    expect(raw).not.toContain("nope-nope");
    expect(raw).not.toContain("carla-pass");
  });

  it("records desktop activations", async () => {
    const deviceId = crypto.randomUUID();
    const act = await activate.POST(req("licence/activate", { json: { email: "carla@example.com", password: "carla-pass-2027", deviceId, deviceName: "Office PC" } }));
    expect(act.status).toBe(200);
    carla = cookieOf(await login.POST(req("auth/login", { json: { email: "carla@example.com", password: "carla-pass-2027" } })));
    expect((await download.GET(req("download?platform=windows", { cookie: carla }))).status).toBe(402);
    const list = await activity.activityFor(customerId);
    expect(list.find((e) => e.action === "Desktop app activated on a new computer")).toMatchObject({ device: "Office PC" });
  });

  it("the owner can read it and download it as CSV; nobody else can", async () => {
    boss = cookieOf(await signup.POST(req("auth/signup", { json: { email: "boss@example.com", password: "boss-pass-2026" } })));
    process.env.ADMIN_ACCOUNT_ID = (await accounts.findByEmail("boss@example.com"))!.id;
    expect((await adminActivity.GET(req("admin/activity", { cookie: carla }))).status).toBe(403);
    expect((await adminActivity.GET(req("admin/activity", { cookie: boss }))).status).toBe(428);
    await setUpTwoStep((json) => twoStep.POST(req("admin/2fa", { json, cookie: boss })));

    const one = (await (await adminActivity.GET(req(`admin/activity?account=${customerId}`, { cookie: boss }))).json()) as { entries: { action: string; email: string }[] };
    expect(one.entries.every((e) => e.email === "carla@example.com")).toBe(true);
    expect(one.entries.at(-1)!.action).toBe("Account created");
    const all = (await (await adminActivity.GET(req("admin/activity", { cookie: boss }))).json()) as { entries: { email: string }[] };
    expect(new Set(all.entries.map((e) => e.email))).toEqual(new Set(["carla@example.com", "boss@example.com"]));

    const csv = await adminActivity.GET(req(`admin/activity?account=${customerId}&format=csv`, { cookie: boss }));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("activity-carla_example.com-");
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM: Excel reads it as UTF-8
    const text = new TextDecoder().decode(bytes);
    expect(text.split(/\r?\n/)[0]).toBe("Time (UTC),Customer,Action,Details,IP address,Browser / computer,Done by");
    expect(text).toContain("carla@example.com,Wrong password,website sign-in,203.0.113.7,Chrome on Windows,customer");
  });

  it("fills in the history from before the log, once per account", async () => {
    // An account from before the log: made directly, so nothing was logged.
    const a = await accounts.createAccount("olga@example.com", "olga-pass-2026");
    const day = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
    a.createdAt = day(30);
    a.payments.push({ orderId: "OLD-1", plan: "yearly", amount: "190.00", currency: "EUR", at: day(20) });
    a.licence.devices.push({ id: crypto.randomUUID(), name: "Shop laptop", activatedAt: day(19), lastSeen: day(1) });
    a.sessions = [{ id: "s1", name: "Safari on Mac", createdAt: day(5), lastSeen: day(2) }];
    await accounts.saveAccount(a);
    await activity.logActivity(null, a, "Signed in"); // something logged since the log started
    expect(await activity.fillEarlierHistory([a])).toBe(1);
    expect(await activity.fillEarlierHistory([a])).toBe(0); // only once
    const list = await activity.activityFor(a.id);
    expect(list[0].action).toBe("Signed in");
    expect(list.filter((e) => e.earlier).map((e) => e.action).reverse()).toEqual([
      "Account created",
      "Yearly plan added",
      "Desktop app activated on a new computer",
      "Signed in",
      "Used the website",
      "Desktop app opened (licence check)",
    ]);
    expect(list.find((e) => e.action === "Yearly plan added")).toMatchObject({ detail: "€190.00", ip: "", earlier: true });
    expect(list.map((e) => e.at)).toEqual([...list.map((e) => e.at)].sort().reverse()); // still newest first
  });

  it("CSV cells cannot run as spreadsheet formulas", () => {
    const csv = activity.activityCsv([{ at: "2026-11-24T10:00:00.000Z", email: "a@b.c", action: "Desktop app activated", ip: "1.2.3.4", device: '=HYPERLINK("http://evil","x")' }]);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });

  it("deletes months older than 12 months", async () => {
    const store = await getStore();
    const old = { at: "2024-01-05T10:00:00.000Z", action: "Signed in", ip: "1.1.1.1" };
    await store.put(`activity/${customerId}/2024-01.json`, JSON.stringify([old]), "application/json");
    expect((await store.list(`activity/${customerId}/`)).some((o) => o.key.endsWith("2024-01.json"))).toBe(true);
    await activity.pruneActivity();
    expect((await store.list(`activity/${customerId}/`)).some((o) => o.key.endsWith("2024-01.json"))).toBe(false);
    expect((await activity.activityFor(customerId)).length).toBeGreaterThan(0); // this month stays
  });
});
