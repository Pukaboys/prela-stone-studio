import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-downloads-test-"));

const signup = await import("@/app/api/auth/signup/route");
const release = await import("@/app/api/admin/release/route");
const twoStep = await import("@/app/api/admin/2fa/route");
const download = await import("@/app/api/download/route");
const appVersion = await import("@/app/api/app-version/route");
const accounts = await import("@/lib/accounts");
const { CHUNK_BYTES } = await import("@/lib/downloads");
const { setUpTwoStep } = await import("./admin-helper");

let n = 1;
const BASE = "https://studio.example/api/";
function req(path: string, o: { json?: unknown; bytes?: Uint8Array; cookie?: string; origin?: string | null; range?: string } = {}) {
  const headers: Record<string, string> = { host: "studio.example", "x-forwarded-for": `198.19.0.${n++}` };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.range) headers.range = o.range;
  if (o.json !== undefined) headers["content-type"] = "application/json";
  if (o.bytes) headers["content-type"] = "application/octet-stream";
  if (o.origin !== null && (o.json !== undefined || o.bytes)) headers.origin = o.origin ?? "https://studio.example";
  const body = o.json !== undefined ? JSON.stringify(o.json) : o.bytes ? Buffer.from(o.bytes) : undefined;
  return new Request(BASE + path, { method: body ? "POST" : "GET", headers, body });
}
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0];

// A fake 9 MB "installer" (three pieces: 4 + 4 + 1 MB).
const installer = new Uint8Array(9 * 1024 * 1024 + 123).map((_, i) => (i * 31) % 251);
const sha = createHash("sha256").update(installer).digest("hex");

let boss = "";
let customer = "";
const piece = (id: string, offset: number, cookie = boss, origin?: string | null) =>
  release.POST(req(`admin/release?upload=${id}&offset=${offset}`, { bytes: installer.subarray(offset, offset + CHUNK_BYTES), cookie, origin }));
const action = (json: unknown, cookie = boss) => release.POST(req("admin/release", { json, cookie }));

describe("publishing installers", () => {
  it("only the owner with two-step login can upload", async () => {
    customer = cookieOf(await signup.POST(req("auth/signup", { json: { email: "client@example.com", password: "client-pass-2026" } })));
    boss = cookieOf(await signup.POST(req("auth/signup", { json: { email: "boss@example.com", password: "boss-pass-2026" } })));
    process.env.ADMIN_ACCOUNT_ID = (await accounts.findByEmail("boss@example.com"))!.id;
    const id = crypto.randomUUID();
    expect((await piece(id, 0, customer)).status).toBe(403);
    expect((await piece(id, 0)).status).toBe(428); // two-step login first
    await setUpTwoStep((json) => twoStep.POST(req("admin/2fa", { json, cookie: boss })));
    expect((await piece(id, 0, boss, "https://evil.example")).status).toBe(400); // other site
    expect((await piece(id, 0, boss, null)).status).toBe(400); // no origin
  });
  it("uploads in pieces (retries are safe, gaps are refused) and checks the result", async () => {
    const id = crypto.randomUUID();
    expect((await piece(id, CHUNK_BYTES)).status).toBe(400); // must start at 0
    expect((await piece(id, 0)).status).toBe(200);
    expect((await piece(id, 0)).status).toBe(200); // same piece again: ignored
    expect((await piece(id, CHUNK_BYTES)).status).toBe(200);
    const done = await piece(id, 2 * CHUNK_BYTES);
    expect(((await done.json()) as { received: number }).received).toBe(installer.length);
    expect((await action({ action: "finish", upload: id, platform: "windows", name: "Setup.exe", size: installer.length + 1 })).status).toBe(400);
    expect((await action({ action: "finish", upload: id, platform: "windows", name: "Setup.dmg", size: installer.length })).status).toBe(400);
    expect((await action({ action: "finish", upload: id, platform: "windows", name: "../../evil.exe", size: installer.length })).status).toBe(400);
    const f = await action({ action: "finish", upload: id, platform: "windows", name: "Jeo Stone Studio Setup 1.0.1.exe", size: installer.length });
    const file = (await f.json()) as { name: string; size: number; sha256: string };
    expect(file).toEqual({ name: "Jeo Stone Studio Setup 1.0.1.exe", size: installer.length, sha256: sha });
    expect((await action({ action: "publish", version: "1.0", files: { windows: file } })).status).toBe(400);
    const pub = await action({ action: "publish", version: "1.0.1", notes: "Settings window", files: { windows: file } });
    expect(pub.status).toBe(200);
    const v = (await (await appVersion.GET()).json()) as { version: string; notes: string; downloads: Record<string, number | null> };
    expect(v).toMatchObject({ version: "1.0.1", notes: "Settings window", downloads: { windows: installer.length, "mac-arm": null, "mac-intel": null } });
  });
});

describe("downloading", () => {
  it("customers with an active licence get the whole file, or a resumed part", async () => {
    expect((await download.GET(req("download?platform=windows"))).status).toBe(302); // not signed in
    const r = await download.GET(req("download?platform=windows", { cookie: customer }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-length")).toBe(String(installer.length));
    expect(r.headers.get("content-disposition")).toContain("Jeo Stone Studio Setup 1.0.1.exe");
    expect(createHash("sha256").update(new Uint8Array(await r.arrayBuffer())).digest("hex")).toBe(sha);
    const part = await download.GET(req("download?platform=windows", { cookie: customer, range: "bytes=100-199" }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${installer.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(installer.subarray(100, 200));
    expect((await download.GET(req("download?platform=mac-arm", { cookie: customer }))).status).toBe(404);
  });
  it("ended licences cannot download", async () => {
    const a = (await accounts.findByEmail("client@example.com"))!;
    a.licence.expiresAt = new Date(Date.now() - 1000).toISOString();
    await accounts.saveAccount(a);
    expect((await download.GET(req("download?platform=windows", { cookie: customer }))).status).toBe(402);
  });
  it("a new version replaces the old file on disk; Remove stops offering it", async () => {
    const id = crypto.randomUUID();
    for (let o = 0; o < installer.length; o += CHUNK_BYTES) await piece(id, o);
    const file = await (await action({ action: "finish", upload: id, platform: "windows", name: "Jeo Stone Studio Setup 1.0.2.exe", size: installer.length })).json();
    await action({ action: "publish", version: "1.0.2", notes: "", files: { windows: file } });
    const dir = join(process.env.DATA_DIR!, "downloads");
    expect(existsSync(join(dir, "Jeo Stone Studio Setup 1.0.2.exe"))).toBe(true);
    expect(existsSync(join(dir, "Jeo Stone Studio Setup 1.0.1.exe"))).toBe(false);
    await action({ action: "remove", platform: "windows" });
    expect(existsSync(join(dir, "Jeo Stone Studio Setup 1.0.2.exe"))).toBe(false);
    const v = (await (await appVersion.GET()).json()) as { version: string; downloads: Record<string, number | null> };
    expect(v).toMatchObject({ version: "1.0.2", downloads: { windows: null } });
  });
});
