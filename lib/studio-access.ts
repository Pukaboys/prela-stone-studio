/**
 * Who may use the studio APIs (projects, photos, sync), and where their data lives.
 *
 * Website:     a signed-in account with an active trial or plan. Each account
 *              stores its projects and photos under accounts/<id>/. The owner
 *              (ADMIN_EMAIL) keeps the data saved before accounts existed.
 * Desktop app: a valid signed licence for this computer (JEO_DESKTOP=1).
 *              Data stays in the app's own folder.
 */
import { currentAccount, licenceStatus, type Account } from "@/lib/accounts";
import { checkLicence, type LicenceCheck } from "@/lib/licence-token";
import { getSetting, getStore } from "@/lib/storage";

export const isDesktop = () => typeof process !== "undefined" && process.env.JEO_DESKTOP === "1";

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
export async function localToken() {
  const raw = await readText(LOCAL_LICENCE);
  return raw ? ((JSON.parse(raw) as { token?: string }).token ?? null) : null;
}
export async function saveLocalToken(token: string | null) {
  await (await getStore()).put(LOCAL_LICENCE, JSON.stringify(token ? { token } : {}), "application/json");
}
export async function localLicence(): Promise<LicenceCheck> {
  return checkLicence(await localToken(), await deviceId());
}

// ---------------------------------------------------------------- guard
export type Access = { prefix: string; account: Account | null };

const text = (status: number, message: string) =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function isOwner(a: Account) {
  const admin = await getSetting("ADMIN_EMAIL");
  return !!admin && admin.trim().toLowerCase() === a.email;
}

/** Access for this request, or a 401/402 response explaining what is needed. */
export async function requireStudio(req: Request): Promise<Access | Response> {
  if (isDesktop()) {
    const lic = await localLicence();
    if (!lic.ok) return text(402, "Activate your Jeo Stone Studio licence to continue.");
    return { prefix: "", account: null };
  }
  const account = await currentAccount(req);
  if (!account) return text(401, "Your session has ended. Sign in again.");
  if (!licenceStatus(account).active) return text(402, "Your licence has ended. Renew it on your account page.");
  return { prefix: (await isOwner(account)) ? "" : `accounts/${account.id}/`, account };
}
