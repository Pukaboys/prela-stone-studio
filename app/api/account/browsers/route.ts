import { logActivity } from "@/lib/activity";
import { currentSession, endSession, publicAccount, sameOriginJson } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Sign out another browser (frees its place for a new sign-in). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const s = await currentSession(req);
  if (!s) return err(401, "Sign in first.");
  const { sessionId } = await body<{ sessionId: string }>(req);
  const other = s.account.sessions?.find((x) => x.id === String(sessionId ?? ""));
  await endSession(s.account, String(sessionId ?? ""));
  if (other) await logActivity(req, s.account, "Signed out another browser", { detail: other.name });
  return ok({ account: publicAccount(s.account, s.sessionId) });
}
