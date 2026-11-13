import { clientIp, fail, findByEmail, limited, makeLinkToken, sameOriginJson } from "@/lib/accounts";
import { resetEmail, siteUrl } from "@/lib/emails";
import { body, err, ok } from "@/lib/http";
import { mailEnabled, sendMail } from "@/lib/mail";
import { isDesktop } from "@/lib/studio-access";

/**
 * "Forgot password": email a one-time reset link. Always answers the same
 * way, so it cannot be used to find out which emails have accounts.
 */
export async function POST(req: Request) {
  if (isDesktop()) return err(404, "Reset your password on the website.");
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  if (!(await mailEnabled())) return err(503, "Password reset by email is not available yet. Please contact us.");
  const ip = "forgot:" + clientIp(req);
  if (limited(ip, 5)) return err(429, "Too many requests. Wait 15 minutes and try again.");
  fail(ip);
  const email = String((await body<{ email: string }>(req)).email ?? "").trim().toLowerCase();
  const a = email ? await findByEmail(email) : null;
  if (a) {
    const url = `${await siteUrl(req)}/reset?token=${encodeURIComponent(await makeLinkToken("reset", a, 1))}`;
    void sendMail(resetEmail(a, url));
  }
  return ok({ sent: true });
}
