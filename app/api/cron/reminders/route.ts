import { siteUrl } from "@/lib/emails";
import { err, ok, safeEqual } from "@/lib/http";
import { sendDueReminders } from "@/lib/reminders";
import { getSetting } from "@/lib/storage";

/**
 * For an external cron job. Send the secret as a header
 *   Authorization: Bearer <CRON_SECRET>
 * (preferred: URLs end up in access logs), or as /api/cron/reminders?key=<CRON_SECRET>.
 */
export async function GET(req: Request) {
  const secret = await getSetting("CRON_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (new URL(req.url).searchParams.get("key") ?? "");
  if (!secret || secret.length < 16 || !safeEqual(key, secret)) return err(404, "Not found.");
  return ok({ sent: await sendDueReminders(await siteUrl()) });
}
