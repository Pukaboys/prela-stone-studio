import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The desktop app's local server, with a throwaway data folder and test keys.
process.env.JEO_DESKTOP = "1";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-desktop-test-"));
process.env.JEO_LICENSE_SERVER = "http://127.0.0.1:9"; // nothing listens: "offline"
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.LICENSE_PRIVATE_KEY = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
process.env.LICENSE_PUBLIC_KEY_TEST = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const { requireStudio, deviceId, saveLocalToken } = await import("@/lib/studio-access");
const { signLicence } = await import("@/lib/licence-token");
const licence = await import("@/app/api/desktop/licence/route");

const DAY = 864e5;
async function install(expInDays: number) {
  const token = await signLicence({ acc: "acc", email: "shop@example.com", plan: "yearly", exp: Date.now() + expInDays * DAY, dev: await deviceId() });
  await saveLocalToken(token);
}
const get = new Request("http://127.0.0.1/api/projects");
const post = new Request("http://127.0.0.1/api/projects", { method: "POST" });
const status = async () => (await (await licence.GET(new Request("http://127.0.0.1/api/desktop/licence"))).json()) as {
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
