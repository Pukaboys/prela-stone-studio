/**
 * Customer accounts, sessions and licences (website server).
 *
 * - Passwords: scrypt with a per-account salt; only the hash is stored.
 * - Sessions: HttpOnly, SameSite=Lax, Secure cookie "<accountId>.<sessionId>.<expiry>.<HMAC>"
 *   signed with a server secret (SESSION_SECRET, or one generated and kept in
 *   the data folder). Each signed-in browser is listed on the account; at most
 *   MAX_BROWSERS at once, a further sign-in is refused. Changing the password
 *   signs out every other browser.
 * - Licence: trial on sign-up, extended by the owner on the admin page after
 *   the customer pays (bank transfer, cash...); the
 *   desktop app is activated on a limited number of devices.
 * - Storage: the same object store as projects (files on Hostinger).
 */
import { BROWSER_IDLE_DAYS, CURRENCY, MAX_BROWSERS, TRIAL_DAYS, TRIAL_DEVICES, planById, type PlanId } from "@/lib/plans";
import { mailEnabled } from "@/lib/mail";
import { getSetting, getStore } from "@/lib/storage";

export type Device = { id: string; name: string; activatedAt: string; lastSeen: string };
/** A signed-in browser. */
export type WebSession = { id: string; name: string; createdAt: string; lastSeen: string; /** Admin two-step code entered (owner). */ mfaAt?: string };
export type Payment = { orderId: string; plan: PlanId; amount: string; currency: string; at: string; note?: string };
export type Account = {
  id: string;
  email: string;
  name?: string;
  salt: string;
  hash: string;
  /** Bumped on password change: invalidates older sessions. */
  sessionVersion: number;
  createdAt: string;
  licence: { plan: PlanId | "trial"; expiresAt: string; devices: Device[] };
  payments: Payment[];
  /** Signed-in browsers (at most MAX_BROWSERS). */
  sessions?: WebSession[];
  /** false until the sign-up link is clicked (only when email is set up); missing = confirmed. */
  emailVerified?: boolean;
  /** Reminder emails already sent, keyed "<expiresAt>:<kind>" (a renewal starts fresh). */
  reminders?: Record<string, string>;
  /** Two-step login for the admin page (authenticator app). */
  totp?: { secret: string; enabledAt: string; lastStep: number; recovery: string[] };
  /** Key shown during setup, until the first code confirms it. */
  totpPending?: { secret: string; at: string };
};
export type PublicAccount = {
  id: string;
  email: string;
  name?: string;
  licence: LicenceStatus;
  devices: Device[];
  payments: Payment[];
  browsers: (WebSession & { current: boolean })[];
  maxBrowsers: number;
  emailVerified: boolean;
};
export type LicenceStatus = { plan: PlanId | "trial"; active: boolean; expiresAt: string; daysLeft: number; maxDevices: number };

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const COOKIE = "jeo_account";
const SESSION_DAYS = 30;

// ---------------------------------------------------------------- helpers
export const normaliseEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
export function passwordProblem(p: string) {
  if (p.length < 10) return "Use at least 10 characters.";
  if (p.length > 200) return "That password is too long.";
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return "Use letters and at least one number.";
  return null;
}
function same(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
async function sha256(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

async function scrypt(password: string, salt: string): Promise<string> {
  const { scrypt: s } = await import("node:crypto");
  return new Promise((resolve, reject) =>
    s(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key.toString("hex")),
    ),
  );
}

let secretCache: Promise<string> | undefined;
/** HMAC secret for session cookies: SESSION_SECRET, or a random one kept in the data folder. */
async function sessionSecret() {
  secretCache ??= (async () => {
    const fromEnv = await getSetting("SESSION_SECRET");
    if (fromEnv && fromEnv.length >= 32) return fromEnv;
    const store = await getStore();
    const obj = await store.get("settings/session-secret");
    if (obj) return new Response(obj.body as BodyInit).text();
    const fresh = hex(crypto.getRandomValues(new Uint8Array(32)));
    await store.put("settings/session-secret", fresh, "text/plain");
    return fresh;
  })();
  return secretCache;
}
async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(await sessionSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

// ---------------------------------------------------------------- storage
const accountKey = (id: string) => `accounts/${id}/account.json`;
const emailKey = async (email: string) => `accounts/by-email/${await sha256(normaliseEmail(email))}.json`;

async function readJson<T>(key: string): Promise<T | null> {
  const obj = await (await getStore()).get(key);
  if (!obj) return null;
  return JSON.parse(await new Response(obj.body as BodyInit).text()) as T;
}
const writeJson = async (key: string, value: unknown) => (await getStore()).put(key, JSON.stringify(value), "application/json");

/**
 * Is this account the site owner (admin page, the projects saved before
 * accounts existed, a licence that never runs out)?
 *
 * - ADMIN_ACCOUNT_ID set: exactly that account (works without email).
 * - Otherwise ADMIN_EMAIL, but only once that address was proven by a link
 *   sent to it (confirmation or password reset). Signing up with the owner's
 *   email is not enough, so nobody can claim the admin by registering first.
 *
 * "pending": the email matches but has not been proven yet.
 */
export async function ownerStatus(a: Account): Promise<"owner" | "pending" | "no"> {
  const id = (await getSetting("ADMIN_ACCOUNT_ID"))?.trim();
  if (id) return a.id === id ? "owner" : "no";
  const email = (await getSetting("ADMIN_EMAIL"))?.trim().toLowerCase();
  if (!email || email !== a.email) return "no";
  return a.emailVerified === true ? "owner" : "pending";
}

/** The owner never runs out: their licence is kept 10 years ahead. */
async function keepOwnerLicence(a: Account) {
  if (new Date(a.licence.expiresAt).getTime() - Date.now() > 365 * 864e5) return a;
  if ((await ownerStatus(a)) !== "owner") return a;
  a.licence = { ...a.licence, plan: "yearly", expiresAt: new Date(Date.now() + 3650 * 864e5).toISOString() };
  await saveAccount(a);
  return a;
}

// ---------------------------------------------------------------- email links
/**
 * Signed, expiring links for email confirmation and password reset:
 * "<accountId>.<expiry>.<HMAC>". A reset link is tied to the current password
 * hash, so it stops working once used (or after any password change); a
 * confirmation link is tied to the email address.
 */
export type LinkPurpose = "verify" | "reset";
const bindTo = (purpose: LinkPurpose, a: Account) => (purpose === "reset" ? a.hash : a.email);

export async function makeLinkToken(purpose: LinkPurpose, a: Account, hours: number) {
  const exp = Math.floor(Date.now() / 1000 + hours * 3600);
  return `${a.id}.${exp}.${await hmac(`${purpose}|${a.id}|${exp}|${bindTo(purpose, a)}`)}`;
}

export async function readLinkToken(purpose: LinkPurpose, token: string): Promise<Account | null> {
  const [id, exp, sig] = String(token).split(".");
  if (!id || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  const a = await getAccount(id);
  if (!a) return null;
  return same(sig, await hmac(`${purpose}|${a.id}|${exp}|${bindTo(purpose, a)}`)) ? a : null;
}

export async function getAccount(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const a = await readJson<Account>(accountKey(id));
  return a ? keepOwnerLicence(a) : null;
}
export async function findByEmail(email: string) {
  const ref = await readJson<{ id: string }>(await emailKey(email));
  return ref ? getAccount(ref.id) : null;
}
export const saveAccount = (a: Account) => writeJson(accountKey(a.id), a);

// ---------------------------------------------------------------- accounts
export async function createAccount(email: string, password: string, name?: string): Promise<Account> {
  const e = normaliseEmail(email);
  if (await findByEmail(e)) throw new AccountError("An account with this email already exists. Sign in instead.");
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const now = new Date();
  const account: Account = {
    id: crypto.randomUUID(),
    email: e,
    name: name?.trim().slice(0, 80) || undefined,
    salt,
    hash: await scrypt(password, salt),
    sessionVersion: 1,
    createdAt: now.toISOString(),
    licence: { plan: "trial", expiresAt: new Date(now.getTime() + TRIAL_DAYS * 864e5).toISOString(), devices: [] },
    payments: [],
    // With email set up, the address must be confirmed before the studio opens.
    ...((await mailEnabled()) ? { emailVerified: false } : {}),
  };
  await saveAccount(account);
  await writeJson(await emailKey(e), { id: account.id });
  return keepOwnerLicence(account);
}

export async function checkPassword(account: Account, password: string) {
  return same(await scrypt(password, account.salt), account.hash);
}

/** New password; signs out every browser (the caller then signs this one in again). */
export async function setPassword(account: Account, password: string) {
  account.salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  account.hash = await scrypt(password, account.salt);
  account.sessionVersion += 1;
  account.sessions = [];
  await saveAccount(account);
}

export class AccountError extends Error {}

// ---------------------------------------------------------------- licence
export function licenceStatus(a: Account, now = Date.now()): LicenceStatus {
  const exp = new Date(a.licence.expiresAt).getTime();
  const plan = a.licence.plan;
  return {
    plan,
    active: exp > now,
    expiresAt: a.licence.expiresAt,
    daysLeft: Math.max(0, Math.ceil((exp - now) / 864e5)),
    maxDevices: plan === "trial" ? TRIAL_DEVICES : (planById(plan)?.devices ?? 2),
  };
}

/** Extend the licence after a payment (idempotent per payment id). */
export async function applyPayment(a: Account, orderId: string, planId: PlanId, amount: string, note?: string) {
  if (a.payments.some((p) => p.orderId === orderId)) return a;
  const plan = planById(planId)!;
  const base = Math.max(Date.now(), a.licence.plan === "trial" ? Date.now() : new Date(a.licence.expiresAt).getTime());
  a.licence = { ...a.licence, plan: plan.id, expiresAt: new Date(base + plan.days * 864e5).toISOString() };
  a.payments.push({ orderId, plan: plan.id, amount, currency: CURRENCY, at: new Date().toISOString(), ...(note ? { note } : {}) });
  await saveAccount(a);
  return a;
}

/** Every customer account (admin page). */
export async function listAccounts(): Promise<Account[]> {
  // The file store lists one folder level ("accounts/<id>"), R2 lists every key.
  const ids = new Set<string>();
  for (const o of await (await getStore()).list("accounts/")) {
    const m = /^accounts\/([a-f0-9-]{36})(\/|$)/.exec(o.key);
    if (m) ids.add(m[1]);
  }
  const all = await Promise.all([...ids].map(getAccount));
  return all.filter((a): a is Account => !!a).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}

export function publicAccount(a: Account, currentSessionId?: string | null): PublicAccount {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    licence: licenceStatus(a),
    devices: a.licence.devices,
    payments: a.payments,
    browsers: (a.sessions ?? []).map(({ id, name, createdAt, lastSeen }) => ({ id, name, createdAt, lastSeen, current: id === currentSessionId })),
    maxBrowsers: MAX_BROWSERS,
    emailVerified: a.emailVerified !== false,
  };
}

// ---------------------------------------------------------------- sessions
const secure = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
const SESSION_MS = SESSION_DAYS * 864e5;
const daysSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 864e5;
function whenText(iso: string) {
  const d = Math.floor(daysSince(iso));
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** "Chrome on Windows", from the browser's user agent. */
export function browserName(ua: string | null) {
  const u = ua ?? "";
  const browser = /Edg\//.test(u)
    ? "Edge"
    : /OPR\//.test(u)
      ? "Opera"
      : /Firefox\//.test(u)
        ? "Firefox"
        : /Chrome\//.test(u)
          ? "Chrome"
          : /Safari\//.test(u)
            ? "Safari"
            : "Browser";
  const os = /iPhone/.test(u)
    ? "iPhone"
    : /iPad/.test(u)
      ? "iPad"
      : /Android/.test(u)
        ? "Android"
        : /Windows/.test(u)
          ? "Windows"
          : /Mac OS X/.test(u)
            ? "Mac"
            : /Linux/.test(u)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Sign this browser in: lists it on the account and returns the session
 * cookie. Refused with an AccountError when MAX_BROWSERS are already signed
 * in; a browser idle for BROWSER_IDLE_DAYS gives up its place.
 */
export async function startSession(req: Request, a: Account) {
  const now = new Date().toISOString();
  let sessions = (a.sessions ?? []).filter((s) => daysSince(s.createdAt) * 864e5 < SESSION_MS);
  // Signing in again in a browser that is still signed in replaces its old session.
  const here = await currentSession(req);
  if (here && here.account.id === a.id) sessions = sessions.filter((s) => s.id !== here.sessionId);
  if (sessions.length >= MAX_BROWSERS) sessions = sessions.filter((s) => daysSince(s.lastSeen) < BROWSER_IDLE_DAYS);
  if (sessions.length >= MAX_BROWSERS) {
    const list = sessions.map((s) => `${s.name} (used ${whenText(s.lastSeen)})`).join(" and ");
    throw new AccountError(
      `This account is already open in ${MAX_BROWSERS} browsers: ${list}. Sign out in one of them first (My account → Browsers). A browser not used for ${BROWSER_IDLE_DAYS} days frees its place automatically.`,
    );
  }
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  sessions.push({ id, name: browserName(req.headers.get("user-agent")), createdAt: now, lastSeen: now });
  a.sessions = sessions;
  await saveAccount(a);
  const exp = Math.floor((Date.now() + SESSION_MS) / 1000);
  const body = `${a.id}.${id}.${exp}`;
  return `${COOKIE}=${body}.${await hmac(body)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`;
}

/** Sign one browser out (removes it from the account). */
export async function endSession(a: Account, sessionId: string) {
  const before = (a.sessions ?? []).length;
  a.sessions = (a.sessions ?? []).filter((s) => s.id !== sessionId);
  if (a.sessions.length !== before) await saveAccount(a);
}
export const clearSessionCookie = (req: Request) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`;

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** The signed-in account and browser session for this request, or null. */
export async function currentSession(req: Request): Promise<{ account: Account; sessionId: string } | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, sessionId, exp, sig] = parts;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!same(sig, await hmac(`${id}.${sessionId}.${exp}`))) return null;
  const a = await getAccount(id);
  const s = a?.sessions?.find((x) => x.id === sessionId);
  if (!a || !s) return null; // signed out from another browser, or the password changed
  if (Date.now() - new Date(s.lastSeen).getTime() > 3600e3) {
    s.lastSeen = new Date().toISOString();
    await saveAccount(a);
  }
  return { account: a, sessionId };
}

/** The signed-in account for this request, or null. */
export async function currentAccount(req: Request): Promise<Account | null> {
  return (await currentSession(req))?.account ?? null;
}

// ---------------------------------------------------------------- abuse protection
const attempts = new Map<string, { n: number; since: number }>();
const WINDOW = 15 * 60 * 1000;
export const clientIp = (req: Request) =>
  (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
export function limited(key: string, max = 10) {
  const a = attempts.get(key);
  return !!a && Date.now() - a.since < WINDOW && a.n >= max;
}
export function fail(key: string) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.since > WINDOW) attempts.set(key, { n: 1, since: Date.now() });
  else a.n++;
}
export const forgive = (key: string) => attempts.delete(key);

/**
 * Cross-site protection for state-changing requests: JSON only (forms
 * cannot send it cross-site without a preflight) and, when the browser
 * sends one, an Origin matching this site.
 */
export function sameOriginJson(req: Request) {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
