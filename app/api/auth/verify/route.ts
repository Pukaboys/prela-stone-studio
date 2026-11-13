import { clientIp, currentSession, fail, limited, makeLinkToken, ownerStatus, readLinkToken, saveAccount, sameOriginJson } from "@/lib/accounts";
import { siteUrl, verifyEmail } from "@/lib/emails";
import { body, err, ok } from "@/lib/http";
import { mailEnabled, sendMail } from "@/lib/mail";

/**
 * Email confirmation.
 * POST { token }            → confirm the address from the emailed link
 * POST { action: "resend" } → send the link again (signed in)
 */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const b = await body<{ token: string; action: string }>(req);

  if (b.action === "resend") {
    const s = await currentSession(req);
    if (!s) return err(401, "Sign in first.");
    const a = s.account;
    // Unconfirmed accounts, and the owner proving ADMIN_EMAIL for the admin page.
    if (a.emailVerified !== false && (await ownerStatus(a)) !== "pending") return ok({ verified: true });
    const key = "verify-resend:" + a.id;
    if (limited(key, 3)) return err(429, "We already sent a few emails. Check your spam folder, or wait 15 minutes.");
    if (!(await mailEnabled())) return err(503, "Email is not set up on this site.");
    fail(key);
    const url = `${await siteUrl(req)}/verify?token=${encodeURIComponent(await makeLinkToken("verify", a, 72))}`;
    const sent = await sendMail(verifyEmail(a, url));
    return sent ? ok({ sent: true }) : err(503, "The email could not be sent. Please try again later.");
  }

  const ip = "verify:" + clientIp(req);
  if (limited(ip, 20)) return err(429, "Too many attempts. Wait 15 minutes and try again.");
  const a = await readLinkToken("verify", String(b.token ?? ""));
  if (!a) {
    fail(ip);
    return err(400, "This confirmation link is no longer valid. Sign in and ask for a new one.");
  }
  if (a.emailVerified !== true) {
    a.emailVerified = true; // proven by the link
    await saveAccount(a);
  }
  return ok({ verified: true, email: a.email });
}
