/**
 * Access to the admin page and its API.
 *
 * Needs all of: a signed-in browser, the owner account (see ownerStatus), the
 * owner's two-step login set up, and a code entered in this browser within
 * the last ADMIN_MFA_HOURS. Otherwise the answer says what is missing:
 * 401 sign in · 403 not the owner · 428 { need: "setup" | "code" }.
 */
import { currentSession, type Account, type WebSession } from "@/lib/accounts";
import { err } from "@/lib/http";
import { isOwner } from "@/lib/studio-access";

export const ADMIN_MFA_HOURS = 12;

export type AdminSession = { account: Account; session: WebSession; sessionId: string };

const need = (what: "setup" | "code", error: string) =>
  Response.json({ error, need: what }, { status: 428, headers: { "Cache-Control": "no-store" } });

export const mfaFresh = (s: WebSession) => !!s.mfaAt && Date.now() - new Date(s.mfaAt).getTime() < ADMIN_MFA_HOURS * 3600e3;

/** The owner's session, before the two-step check (for the 2FA routes themselves). */
export async function ownerSession(req: Request): Promise<AdminSession | Response> {
  const s = await currentSession(req);
  if (!s) return err(401, "Sign in first.");
  if (!(await isOwner(s.account))) return err(403, "Only the owner can do this.");
  const session = s.account.sessions!.find((x) => x.id === s.sessionId)!;
  return { account: s.account, session, sessionId: s.sessionId };
}

/** Full admin access (owner + fresh two-step code), or a response saying what is missing. */
export async function adminAccess(req: Request): Promise<AdminSession | Response> {
  const o = await ownerSession(req);
  if (o instanceof Response) return o;
  if (!o.account.totp) return need("setup", "Set up two-step login to open the admin page.");
  if (!mfaFresh(o.session)) return need("code", "Enter the code from your authenticator app.");
  return o;
}
