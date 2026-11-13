import { siteUrl } from "@/lib/emails";
import { err, ok } from "@/lib/http";
import { sendDueReminders } from "@/lib/reminders";
import { getSetting } from "@/lib/storage";

/** For an external cron job: /api/cron/reminders?key=<CRON_SECRET>. */
export async function GET(req: Request) {
  const secret = await getSetting("CRON_SECRET");
  const key = new URL(req.url).searchParams.get("key");
  if (!secret || secret.length < 16 || key !== secret) return err(404, "Not found.");
  return ok({ sent: await sendDueReminders(await siteUrl(req)) });
}
