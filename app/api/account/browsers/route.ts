import { currentSession, endSession, publicAccount, sameOriginJson } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Sign out another browser (frees its place for a new sign-in). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const s = await currentSession(req);
  if (!s) return err(401, "Sign in first.");
  const { sessionId } = await body<{ sessionId: string }>(req);
  await endSession(s.account, String(sessionId ?? ""));
  return ok({ account: publicAccount(s.account, s.sessionId) });
}
