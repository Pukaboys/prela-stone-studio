import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The desktop app's local server, with a throwaway data folder and test keys.
process.env.JEO_DESKTOP = "1";
process.env.JEO_DESKTOP_KEY = "k".repeat(64); // the app's per-start key
process.env.JEO_DATA_KEY = "ab".repeat(32); // encrypts the licence on disk
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-desktop-test-"));
process.env.JEO_LICENSE_SERVER = "http://127.0.0.1:9"; // nothing listens: "offline"
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.LICENSE_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
process.env.LICENSE_PUBLIC_KEY_TEST = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const { requireStudio, deviceId, saveLocalToken, localToken } = await import("@/lib/studio-access");
const { signLicence } = await import("@/lib/licence-token");
const licence = await import("@/app/api/desktop/licence/route");

const DAY = 864e5;
async function install(expInDays: number) {
  const token = await signLicence({ acc: "acc", email: "shop@example.com", plan: "yearly", exp: Date.now() + expInDays * DAY, dev: await deviceId() });
  await saveLocalToken(token);
}
const app = { host: "127.0.0.1:47821", "x-jeo-desktop": "k".repeat(64) };
const get = new Request("http://127.0.0.1:47821/api/projects", { headers: app });
const post = new Request("http://127.0.0.1:47821/api/projects", { method: "POST", headers: app });
const status = async () => (await (await licence.GET(new Request("http://127.0.0.1:47821/api/desktop/licence", { headers: app }))).json()) as {
  ok: boolean;
  limited: boolean;
  reason: string | null;
  offlineDaysLeft: number;
  online: boolean | null;
};

afterEach(() => vi.useRealTimers());

describe("desktop licence modes", () => {
  it("not signed in: nothing works, the app asks to sign in", async () => {
    await saveLocalToken(null);
    expect(((await requireStudio(get)) as Response).status).toBe(402);
    expect(await status()).toMatchObject({ ok: false, limited: false, reason: "missing" });
  });
  it("valid licence: full use", async () => {
    await install(300);
    expect(await requireStudio(post)).toMatchObject({ prefix: "" });
    expect(await status()).toMatchObject({ ok: true, limited: false, offlineDaysLeft: 7 });
  });
  it("offline: full use for 7 days since the last check-in, then view only", async () => {
    await install(300);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 5 * DAY);
    expect(await status()).toMatchObject({ ok: true, offlineDaysLeft: 2, online: false });
    expect(await requireStudio(post)).toMatchObject({ prefix: "" });
    vi.setSystemTime(Date.now() + 3 * DAY);
    expect(await status()).toMatchObject({ ok: false, limited: true, reason: "offline-too-long" });
    expect(await requireStudio(get)).toMatchObject({ prefix: "" }); // open and look
    expect(((await requireStudio(post)) as Response).status).toBe(402); // no saving
  });
  it("licence ended: view only", async () => {
    await install(-1);
    expect(await status()).toMatchObject({ ok: false, limited: true, reason: "expired" });
    expect(await requireStudio(get)).toMatchObject({ prefix: "" });
    expect(((await requireStudio(post)) as Response).status).toBe(402);
  });
});

describe("local server protection", () => {
  it("answers only the app's own window: not web pages, not DNS-rebinding sites", async () => {
    await install(300);
    const page = new Request("http://127.0.0.1:47821/api/projects", { headers: { host: "127.0.0.1:47821" } });
    expect(((await requireStudio(page)) as Response).status).toBe(403); // no key
    const wrong = new Request("http://127.0.0.1:47821/api/projects", { headers: { ...app, "x-jeo-desktop": "x".repeat(64) } });
    expect(((await requireStudio(wrong)) as Response).status).toBe(403);
    const rebound = new Request("http://evil.example:47821/api/projects", { headers: { ...app, host: "evil.example:47821" } });
    expect(((await requireStudio(rebound)) as Response).status).toBe(403);
    const activate = await licence.POST(new Request("http://127.0.0.1:47821/api/desktop/licence", { method: "POST", headers: { host: "127.0.0.1:47821" }, body: JSON.stringify({ action: "signout" }) }));
    expect(activate.status).toBe(403);
    expect(await localToken()).not.toBeNull(); // still signed in
  });
  it("keeps the licence encrypted on disk", async () => {
    await install(300);
    const raw = readFileSync(join(process.env.DATA_DIR!, "settings", "licence.json"), "utf8");
    expect(raw).toMatch(/"enc"/);
    expect(raw).not.toContain((await localToken())!.split(".")[0]);
  });
});
