/**
 * Team password protection for the website (server side).
 *
 * Set STUDIO_PASSWORD on the host (e.g. Hostinger environment variables) to
 * require signing in before projects and slab photos can be read or written.
 * Without it the studio is open — right for the desktop app, which only
 * listens on 127.0.0.1.
 *
 * Signing in sets an HttpOnly cookie "<expiry>.<HMAC>" signed with a key
 * derived from the password, so changing the password signs everyone out.
 * Uses Web Crypto, which works in Node and in Cloudflare Workers.
 */
import { getSetting } from "@/lib/storage";

const COOKIE = "jeo_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const enc = new TextEncoder();

async function hmac(key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode("jeo-session-v1:" + key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (avoids leaking how much matched). */
function same(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function studioPassword() {
  const p = await getSetting("STUDIO_PASSWORD");
  return p && p.length > 0 ? p : null;
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function isSignedIn(req: Request) {
  const password = await studioPassword();
  if (!password) return true;
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const [expires, sig] = token.split(".");
  if (!expires || !sig || Number(expires) < Date.now() / 1000) return false;
  return same(sig, await hmac(password, expires));
}

/** Returns a 401 response when the request is not signed in, otherwise null. */
export async function requireSession(req: Request): Promise<Response | null> {
  if (await isSignedIn(req)) return null;
  return new Response("Your session has ended. Reload the page and sign in again.", {
    status: 401,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const secure = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

export async function sessionCookie(req: Request) {
  const password = (await studioPassword())!;
  const expires = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  const value = `${expires}.${await hmac(password, expires)}`;
  return `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`;
}

export const clearCookie = (req: Request) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`;

export async function checkPassword(attempt: string) {
  const password = await studioPassword();
  return !!password && same(attempt, password);
}

// Slow down guessing: at most 10 failed attempts per address per 15 minutes.
const failures = new Map<string, { count: number; since: number }>();
const WINDOW = 15 * 60 * 1000;
export function clientKey(req: Request) {
  return (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
}
export function tooManyAttempts(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() - f.since > WINDOW) return false;
  return f.count >= 10;
}
export function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() - f.since > WINDOW) failures.set(key, { count: 1, since: Date.now() });
  else f.count++;
}
export const clearFailures = (key: string) => failures.delete(key);
