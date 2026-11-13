/**
 * Licence reminder emails: 7 days before the end, 1 day before, and when it
 * has ended. Each is sent once per end date (a renewal starts fresh).
 *
 * Runs at most once an hour, started by ordinary site traffic (see
 * /api/auth/me), and can also be triggered by a cron job calling
 * /api/cron/reminders?key=CRON_SECRET.
 */
import { listAccounts, licenceStatus, saveAccount, type Account } from "@/lib/accounts";
import { reminderEmail } from "@/lib/emails";
import { mailEnabled, sendMail } from "@/lib/mail";
import { getSetting } from "@/lib/storage";

type Kind = "7" | "1" | "ended";

/** Which reminder (if any) is due for this account now. */
export function dueReminder(a: Account, now = Date.now()): Kind | null {
  const s = licenceStatus(a, now);
  const msLeft = new Date(a.licence.expiresAt).getTime() - now;
  let kind: Kind | null = null;
  if (!s.active) kind = -msLeft < 3 * 864e5 ? "ended" : null; // only just ended
  else if (msLeft <= 864e5) kind = "1";
  else if (msLeft <= 7 * 864e5) kind = "7";
  if (!kind) return null;
  return a.reminders?.[`${a.licence.expiresAt}:${kind}`] ? null : kind;
}

/** Send every due reminder; returns how many emails went out. */
export async function sendDueReminders(siteUrl: string, now = Date.now()) {
  if (!(await mailEnabled()) || !siteUrl) return 0;
  const owner = (await getSetting("ADMIN_EMAIL"))?.trim().toLowerCase();
  let sent = 0;
  for (const a of await listAccounts()) {
    if (a.email === owner || a.emailVerified === false) continue;
    const kind = dueReminder(a, now);
    if (!kind) continue;
    if (await sendMail(reminderEmail(a, kind, `${siteUrl}/account`))) {
      a.reminders = { ...a.reminders, [`${a.licence.expiresAt}:${kind}`]: new Date(now).toISOString() };
      await saveAccount(a);
      sent++;
    }
  }
  return sent;
}

let lastRun = 0;
let running = false;
/** Start a reminder run if the last one was more than an hour ago (never blocks the caller). */
export function remindersSoon(siteUrl: string) {
  if (running || Date.now() - lastRun < 3600e3) return;
  lastRun = Date.now();
  running = true;
  sendDueReminders(siteUrl)
    .catch((e) => console.error("[reminders]", e))
    .finally(() => (running = false));
}
