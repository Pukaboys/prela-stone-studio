import { currentSession, publicAccount } from "@/lib/accounts";
import { ok } from "@/lib/http";
import { isDesktop, isOwner } from "@/lib/studio-access";

/** The signed-in account (or null) and whether this is the desktop app. */
export async function GET(req: Request) {
  if (isDesktop()) return ok({ desktop: true, account: null });
  const s = await currentSession(req);
  return ok({ desktop: false, account: s ? publicAccount(s.account, s.sessionId) : null, owner: s ? await isOwner(s.account) : false });
}
