/**
 * Who may use the studio APIs (projects, photos, sync), and where their data lives.
 *
 * Website:     a signed-in account with an active trial or plan. Each account
 *              stores its projects and photos under accounts/<id>/. The owner
 *              (ADMIN_EMAIL) keeps the data saved before accounts existed.
 * Desktop app: a valid signed licence for this computer (JEO_DESKTOP=1).
 *              Data stays in the app's own folder. When the licence has
 *              ended or the app was offline too long, it runs in limited
 *              mode: projects can be opened (GET) but not changed.
 */
import { currentAccount, getAccount, licenceStatus, ownerStatus, type Account } from "@/lib/accounts";
import { OFFLINE_GRACE_DAYS, checkLicence, verifyLicence, type LicenceCheck } from "@/lib/licence-token";
import { safeEqual } from "@/lib/http";
import { getStore } from "@/lib/storage";

export const isDesktop = () => typeof process !== "undefined" && process.env.JEO_DESKTOP === "1";

// ---------------------------------------------------------------- desktop request check
/** Header the desktop app's window adds to every request to its local server. */
export const DESKTOP_HEADER = "x-jeo-desktop";

/**
 * Is this request from the desktop app's own window?
 *
 * The local server listens on 127.0.0.1, which every web page the customer
 * opens in a browser can also send requests to (and, with DNS rebinding,
 * read the answers). So it accepts only requests that
 * - are addressed to 127.0.0.1 / localhost (a rebinding site's requests carry
 *   its own host name), and
 * - carry the random key the app creates at each start (JEO_DESKTOP_KEY) and
 *   adds to its window's requests; no web page can know it.
 */
export function desktopRequestOk(req: Request) {
  const key = process.env.JEO_DESKTOP_KEY ?? "";
  if (key.length < 32) return false;
  const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
  const name = host.replace(/:\d+$/, "");
  if (name !== "127.0.0.1" && name !== "localhost") return false;
  return safeEqual(req.headers.get(DESKTOP_HEADER) ?? "", key);
}

/** The answer for a desktop request that fails desktopRequestOk. */
export const desktopForbidden = () =>
  new Response("Forbidden.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

// ---------------------------------------------------------------- desktop licence (local)
const LOCAL_LICENCE = "settings/licence.json";
const LOCAL_DEVICE = "settings/device.json";

async function readText(key: string) {
  const obj = await (await getStore()).get(key);
  return obj ? new Response(obj.body as BodyInit).text() : null;
}

/** Stable id for this computer (random, created once). */
export async function deviceId() {
  const existing = await readText(LOCAL_DEVICE);
  if (existing) return (JSON.parse(existing) as { id: string }).id;
  const id = crypto.randomUUID();
  await (await getStore()).put(LOCAL_DEVICE, JSON.stringify({ id }), "application/json");
  return id;
}
/**
 * The licence token also lets this computer sync with the website account,
 * so it is stored encrypted (AES-GCM) with a key the desktop app keeps in the
 * operating system's protected storage (JEO_DATA_KEY, from Electron
 * safeStorage). A copy of the data folder alone is then useless. Without
 * that key (development, tests) it is stored as before.
 */
async function dataKey() {
  const hex = typeof process !== "undefined" ? (process.env.JEO_DATA_KEY ?? "") : "";
  if (!/^[a-f0-9]{64}$/.test(hex)) return null;
  const raw = Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function localToken() {
  const raw = await readText(LOCAL_LICENCE);
  if (!raw) return null;
  const saved = JSON.parse(raw) as { token?: string; enc?: string };
  if (saved.enc) {
    const key = await dataKey();
    if (!key) return null;
    try {
      const all = fromB64(saved.enc);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12));
      return new TextDecoder().decode(plain);
    } catch {
      return null; // another computer's (or user's) key: activate again
    }
  }
  // Saved before encryption: encrypt it now when possible.
  if (saved.token && (await dataKey())) await saveLocalToken(saved.token);
  return saved.token ?? null;
}
export async function saveLocalToken(token: string | null) {
  let saved: { token?: string; enc?: string } = {};
  const key = token ? await dataKey() : null;
  if (token && key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
    const all = new Uint8Array(12 + sealed.length);
    all.set(iv);
    all.set(sealed, 12);
    saved = { enc: toB64(all) };
  } else if (token) saved = { token };
  await (await getStore()).put(LOCAL_LICENCE, JSON.stringify(saved), "application/json");
}
export async function localLicence(): Promise<LicenceCheck> {
  return checkLicence(await localToken(), await deviceId());
}
/** Signed in, but the licence ended or the app was offline too long: view only. */
export const isLimited = (lic: LicenceCheck) => !lic.ok && (lic.reason === "expired" || lic.reason === "offline-too-long");

// ---------------------------------------------------------------- guard
export type Access = { prefix: string; account: Account | null };

const text = (status: number, message: string) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** The site owner (see ownerStatus: proven ADMIN_EMAIL, or ADMIN_ACCOUNT_ID). */
export async function isOwner(a: Account) {
  return (await ownerStatus(a)) === "owner";
}

/**
 * Desktop "Website sync" sends its computer licence ("Authorization: Licence
 * <token>") instead of signing in like a browser, so it never takes one of
 * the account's browser places. Accepted only while that computer is still
 * activated on the account.
 */
async function desktopSyncAccount(req: Request): Promise<Account | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Licence ")) return null;
  const p = await verifyLicence(auth.slice(8).trim());
  if (!p || Date.now() - p.iat > OFFLINE_GRACE_DAYS * 864e5) return null;
  const a = await getAccount(p.acc);
  return a && a.licence.devices.some((d) => d.id === p.dev) ? a : null;
}

/** Access for this request, or a 401/402 response explaining what is needed. */
export async function requireStudio(req: Request): Promise<Access | Response> {
  if (isDesktop()) {
    if (!desktopRequestOk(req)) return desktopForbidden();
    const lic = await localLicence();
    if (lic.ok) return { prefix: "", account: null };
    if (isLimited(lic) && req.method === "GET") return { prefix: "", account: null };
    return text(402, isLimited(lic) ? "Limited mode: renew your licence or connect to the internet to make changes." : "Activate your Jeo Stone Studio licence to continue.");
  }
  const account = (await desktopSyncAccount(req)) ?? (await currentAccount(req));
  if (!account) return text(401, "Your session has ended. Sign in again.");
  if (account.emailVerified === false) return text(403, "Confirm your email address first: open the link we sent you.");
  if (!licenceStatus(account).active) return text(402, "Your licence has ended. Renew it on your account page.");
  return { prefix: (await isOwner(account)) ? "" : `accounts/${account.id}/`, account };
}

// ---------------------------------------------------------------- storage quota
/**
 * How many saved projects and slab photos one customer account may keep, so
 * free trials cannot fill the server's disk. The owner and the desktop app
 * (its own computer) have no limit.
 */
export const QUOTA = {
  trial: { projects: 100, images: 300 },
  paid: { projects: 2000, images: 5000 },
} as const;

/** null when there is room for one more `kind` (projects or images), otherwise a 507 response. */
export async function quotaFull(access: Access, kind: "projects" | "images"): Promise<Response | null> {
  if (!access.account || !access.prefix) return null;
  const limit = QUOTA[access.account.licence.plan === "trial" ? "trial" : "paid"][kind];
  const used = (await (await getStore()).list(access.prefix + kind + "/")).length;
  if (used < limit) return null;
  return text(
    507,
    kind === "projects"
      ? `Your account has reached ${limit} saved projects. Delete old projects, or contact us for more room.`
      : `Your account has reached ${limit} slab photos. Contact us for more room.`,
  );
}
