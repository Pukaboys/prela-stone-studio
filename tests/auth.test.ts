import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The API handlers store files under DATA_DIR on Node; use a throwaway folder.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "jeo-auth-test-"));
const session = await import("@/app/api/session/route");
const projects = await import("@/app/api/projects/route");

const URL_ = "https://studio.example/api/";
const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  new Request(URL_ + path, { ...init, headers: { ...(init.headers as object), ...(init.cookie ? { cookie: init.cookie } : {}), "x-forwarded-for": "203.0.113.7" } });
const login = (password: string) =>
  session.POST(req("session", { method: "POST", body: JSON.stringify({ password }), headers: { "Content-Type": "application/json" } }));

describe("without STUDIO_PASSWORD (desktop app)", () => {
  it("is open", async () => {
    delete process.env.STUDIO_PASSWORD;
    expect(await (await session.GET(req("session"))).json()).toEqual({ required: false, signedIn: true });
    expect((await projects.GET(req("projects"))).status).toBe(200);
  });
});

describe("with STUDIO_PASSWORD (website)", () => {
  beforeAll(() => {
    process.env.STUDIO_PASSWORD = "correct horse battery";
  });
  afterAll(() => {
    delete process.env.STUDIO_PASSWORD;
  });

  it("requires signing in", async () => {
    expect(await (await session.GET(req("session"))).json()).toEqual({ required: true, signedIn: false });
    expect((await projects.GET(req("projects"))).status).toBe(401);
  });
  it("rejects a wrong password", async () => {
    const r = await login("wrong");
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("signs in with the right password; the cookie opens the APIs", async () => {
    const r = await login("correct horse battery");
    expect(r.status).toBe(200);
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
    const value = cookie.split(";")[0];
    expect((await projects.GET(req("projects", { cookie: value }))).status).toBe(200);
    // A tampered signature is rejected.
    const forged = value.slice(0, -4) + "0000";
    expect((await projects.GET(req("projects", { cookie: forged }))).status).toBe(401);
    // Changing the password signs everyone out.
    process.env.STUDIO_PASSWORD = "new password";
    expect((await projects.GET(req("projects", { cookie: value }))).status).toBe(401);
    process.env.STUDIO_PASSWORD = "correct horse battery";
  });
  it("sign out clears the cookie", async () => {
    const r = await session.DELETE(req("session", { method: "DELETE" }));
    expect(r.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
  it("blocks guessing after 10 failures", async () => {
    // (The successful sign-in above reset the counter.)
    for (let i = 0; i < 10; i++) expect((await login("guess " + i)).status).toBe(401);
    expect((await login("still guessing")).status).toBe(429);
  }, 20000);
});
