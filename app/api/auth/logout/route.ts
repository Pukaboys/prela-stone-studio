import { logActivity } from "@/lib/activity";
import { clearSessionCookie, currentSession, endSession } from "@/lib/accounts";
import { ok } from "@/lib/http";

/** Sign this browser out; its place on the account is freed. */
export async function POST(req: Request) {
  const s = await currentSession(req);
  if (s) {
    await endSession(s.account, s.sessionId);
    await logActivity(req, s.account, "Signed out");
  }
  return ok({ signedIn: false }, { "Set-Cookie": clearSessionCookie(req) });
}
