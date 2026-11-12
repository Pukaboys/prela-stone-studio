/**
 * Customer accounts, sessions and licences (website server).
 *
 * - Passwords: scrypt with a per-account salt; only the hash is stored.
 * - Sessions: HttpOnly, SameSite=Lax, Secure cookie "<accountId>.<expiry>.<HMAC>"
 *   signed with a server secret (SESSION_SECRET, or one generated and kept in
 *   the data folder). Changing the password ends every other session.
 * - Licence: trial on sign-up, extended by verified PayPal payments; the
 *   desktop app is activated on a limited number of devices.
 * - Storage: the same object store as projects (files on Hostinger).
 */
import { CURRENCY, TRIAL_DAYS, TRIAL_DEVICES, planById, type PlanId } from "@/lib/plans";
import { getSetting, getStore } from "@/lib/storage";

export type Device = { id: string; name: string; activatedAt: string; lastSeen: string };
export type Payment = { orderId: string; plan: PlanId; amount: string; currency: string; at: string };
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
};
export type PublicAccount = {
  id: string;
  email: string;
  name?: string;
  licence: LicenceStatus;
  devices: Device[];
  payments: Payment[];
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

export const getAccount = (id: string) => (/^[a-f0-9-]{36}$/.test(id) ? readJson<Account>(accountKey(id)) : Promise.resolve(null));
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
  };
  await saveAccount(account);
  await writeJson(await emailKey(e), { id: account.id });
  return account;
}

export async function checkPassword(account: Account, password: string) {
  return same(await scrypt(password, account.salt), account.hash);
}

export async function setPassword(account: Account, password: string) {
  account.salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  account.hash = await scrypt(password, account.salt);
  account.sessionVersion += 1;
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

/** Extend the licence after a verified payment (idempotent per order id). */
export async function applyPayment(a: Account, orderId: string, planId: PlanId, amount: string) {
  if (a.payments.some((p) => p.orderId === orderId)) return a;
  const plan = planById(planId)!;
  const base = Math.max(Date.now(), a.licence.plan === "trial" ? Date.now() : new Date(a.licence.expiresAt).getTime());
  a.licence = { ...a.licence, plan: plan.id, expiresAt: new Date(base + plan.days * 864e5).toISOString() };
  a.payments.push({ orderId, plan: plan.id, amount, currency: CURRENCY, at: new Date().toISOString() });
  await saveAccount(a);
  return a;
}

export function publicAccount(a: Account): PublicAccount {
  return { id: a.id, email: a.email, name: a.name, licence: licenceStatus(a), devices: a.licence.devices, payments: a.payments };
}

// ---------------------------------------------------------------- sessions
const secure = (req: Request) => new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

export async function sessionCookie(req: Request, a: Account) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = `${a.id}.${a.sessionVersion}.${exp}`;
  return `${COOKIE}=${body}.${await hmac(body)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`;
}
export const clearSessionCookie = (req: Request) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure(req) ? "; Secure" : ""}`;

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** The signed-in account for this request, or null. */
export async function currentAccount(req: Request): Promise<Account | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, version, exp, sig] = parts;
  if (Number(exp) < Date.now() / 1000) return null;
  if (!same(sig, await hmac(`${id}.${version}.${exp}`))) return null;
  const a = await getAccount(id);
  return a && String(a.sessionVersion) === version ? a : null;
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
