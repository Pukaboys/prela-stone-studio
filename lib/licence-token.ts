/**
 * Signed licence tokens for the desktop app (Ed25519, Web Crypto).
 *
 * The website signs a token when a device is activated or refreshed; the
 * desktop app verifies it with the public key built into the app, so a
 * licence cannot be forged or edited without the private key, which only
 * the website has (LICENSE_PRIVATE_KEY).
 *
 * Token: base64url(JSON payload) "." base64url(signature)
 */
import { LICENCE_PUBLIC_KEY } from "@/lib/licence-public-key";
import { getSetting } from "@/lib/storage";

export type LicencePayload = {
  v: 1;
  /** Account id and email. */
  acc: string;
  email: string;
  plan: string;
  /** Licence end (ms since epoch). */
  exp: number;
  /** Device id this token is for. */
  dev: string;
  /** Issued at (ms). */
  iat: number;
};
/** The app must check in online at least this often (offline grace); after that it runs in limited mode. */
export const OFFLINE_GRACE_DAYS = 7;
/** Check in with the website when the token is older than this (each start, and every few hours). */
export const REFRESH_AFTER_MS = 3600e3;

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function privateKey() {
  const raw = await getSetting("LICENSE_PRIVATE_KEY");
  if (!raw) return null;
  return crypto.subtle.importKey("pkcs8", fromB64(raw.trim()), { name: "Ed25519" }, false, ["sign"]);
}

/** Public key used to verify. Tests may override it; the shipped app never does. */
function publicKeyB64() {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test" && process.env.LICENSE_PUBLIC_KEY_TEST)
    return process.env.LICENSE_PUBLIC_KEY_TEST;
  return LICENCE_PUBLIC_KEY;
}

export async function signLicence(payload: Omit<LicencePayload, "v" | "iat">): Promise<string> {
  const key = await privateKey();
  if (!key) throw new Error("Licensing is not configured on this server (LICENSE_PRIVATE_KEY).");
  const body = b64u(new TextEncoder().encode(JSON.stringify({ v: 1, iat: Date.now(), ...payload })));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(body)));
  return `${body}.${b64u(sig)}`;
}

/** Verify the signature and return the payload, or null if forged or malformed. */
export async function verifyLicence(token: string): Promise<LicencePayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const key = await crypto.subtle.importKey("raw", fromB64(publicKeyB64()), { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("Ed25519", key, fromB64u(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body))) as LicencePayload;
    return p.v === 1 && typeof p.exp === "number" && typeof p.dev === "string" ? p : null;
  } catch {
    return null;
  }
}

export type LicenceCheck =
  | { ok: true; payload: LicencePayload; needsRefresh: boolean }
  | { ok: false; reason: "missing" | "invalid" | "device" | "expired" | "offline-too-long"; payload?: LicencePayload };

/** Is this token valid on this device right now? */
export async function checkLicence(token: string | null, deviceId: string, now = Date.now()): Promise<LicenceCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const p = await verifyLicence(token);
  if (!p) return { ok: false, reason: "invalid" };
  if (p.dev !== deviceId) return { ok: false, reason: "device", payload: p };
  if (p.exp <= now) return { ok: false, reason: "expired", payload: p };
  if (now - p.iat > OFFLINE_GRACE_DAYS * 864e5) return { ok: false, reason: "offline-too-long", payload: p };
  // Check in with the website whenever online (renewals, removed computers).
  return { ok: true, payload: p, needsRefresh: now - p.iat > REFRESH_AFTER_MS };
}
