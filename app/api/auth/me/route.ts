import { currentSession, publicAccount } from "@/lib/accounts";
import { siteUrl } from "@/lib/emails";
import { ok } from "@/lib/http";
import { mailEnabled } from "@/lib/mail";
import { remindersSoon } from "@/lib/reminders";
import { isDesktop, isOwner } from "@/lib/studio-access";

/** The signed-in account (or null), whether this is the desktop app, and whether email works. */
export async function GET(req: Request) {
  if (isDesktop()) return ok({ desktop: true, account: null });
  // Site traffic keeps the reminder emails going (at most one run per hour).
  remindersSoon(await siteUrl(req));
  const s = await currentSession(req);
  return ok({
    desktop: false,
    account: s ? publicAccount(s.account, s.sessionId) : null,
    owner: s ? await isOwner(s.account) : false,
    mail: await mailEnabled(),
  });
}
