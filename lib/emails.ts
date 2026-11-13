/**
 * The emails the website sends (text + simple HTML), and the site address
 * used in their links.
 */
import type { Account } from "@/lib/accounts";
import type { Mail } from "@/lib/mail";
import { planById } from "@/lib/plans";
import { getSetting } from "@/lib/storage";

/**
 * Public address for links in emails: SITE_URL when set (recommended, e.g.
 * https://jeostonestudio.com), otherwise the address of this request.
 */
export async function siteUrl(req?: Request) {
  const set = (await getSetting("SITE_URL"))?.trim().replace(/\/+$/, "");
  if (set) return set;
  if (!req) return "";
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const hello = (a: Account) => (a.name ? `Hello ${a.name},` : "Hello,");

/** One layout for every email: heading, paragraphs, optional button. */
function layout(o: { to: string; subject: string; heading: string; lines: string[]; button?: { label: string; url: string }; footer?: string }): Mail {
  const text = [o.heading, "", ...o.lines, ...(o.button ? ["", `${o.button.label}: ${o.button.url}`] : []), "", "— Jeo Stone Studio", ...(o.footer ? ["", o.footer] : [])].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f2f4f3;font-family:Arial,Helvetica,sans-serif;color:#1d2528">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#141a1e;padding:18px 24px;color:#e8eeec;font-size:15px;letter-spacing:2px"><b style="color:#bde96e">JEO</b> STONE STUDIO</td></tr>
<tr><td style="padding:26px 24px 8px"><h1 style="margin:0 0 14px;font-size:20px">${esc(o.heading)}</h1>
${o.lines.map((l) => `<p style="margin:0 0 12px;line-height:1.55;font-size:15px">${esc(l)}</p>`).join("\n")}
${o.button ? `<p style="margin:20px 0 8px"><a href="${esc(o.button.url)}" style="display:inline-block;background:#bde96e;color:#203018;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${esc(o.button.label)}</a></p>
<p style="margin:0 0 12px;font-size:12px;color:#6b7a80;word-break:break-all">${esc(o.button.url)}</p>` : ""}
</td></tr>
<tr><td style="padding:12px 24px 22px;font-size:12px;color:#6b7a80">${esc(o.footer ?? "Jeo Stone Studio · slab planning & vein matching")}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: o.to, subject: o.subject, text, html };
}

export const verifyEmail = (a: Account, url: string) =>
  layout({
    to: a.email,
    subject: "Confirm your email – Jeo Stone Studio",
    heading: "Confirm your email address",
    lines: [hello(a), "Thanks for starting your Jeo Stone Studio trial. Please confirm this email address to open the studio.", "The link works for 3 days."],
    button: { label: "Confirm my email", url },
    footer: "You get this email because this address was used to create a Jeo Stone Studio account. If that was not you, ignore it.",
  });

export const resetEmail = (a: Account, url: string) =>
  layout({
    to: a.email,
    subject: "Reset your password – Jeo Stone Studio",
    heading: "Reset your password",
    lines: [hello(a), "Someone (hopefully you) asked to reset the password of your Jeo Stone Studio account.", "The link works for 1 hour and only once. Setting a new password signs out every browser."],
    button: { label: "Choose a new password", url },
    footer: "If you did not ask for this, ignore this email: your password stays the same.",
  });

export function reminderEmail(a: Account, kind: "7" | "1" | "ended", accountUrl: string) {
  const trial = a.licence.plan === "trial";
  const what = trial ? "free trial" : `${planById(a.licence.plan)?.name.toLowerCase() ?? ""} licence`.trim();
  const end = fmtDate(a.licence.expiresAt);
  const subject =
    kind === "ended" ? `Your ${what} has ended` : kind === "1" ? `Your ${what} ends tomorrow` : `Your ${what} ends in 7 days`;
  return layout({
    to: a.email,
    subject: subject + " – Jeo Stone Studio",
    heading: subject,
    lines: [
      hello(a),
      kind === "ended"
        ? `Your Jeo Stone Studio ${what} ended on ${end}. The desktop app now opens projects in view-only mode, and the online studio is locked.`
        : `Your Jeo Stone Studio ${what} runs until ${end}.`,
      trial ? "To keep planning, choose a plan on your account page. Your projects are kept." : "To keep working without interruption, renew on your account page. Renewing extends from the current end date.",
    ],
    button: { label: kind === "ended" ? "Renew now" : "Choose a plan", url: accountUrl },
  });
}

export const paymentEmail = (a: Account, amount: string, planName: string, accountUrl: string) =>
  layout({
    to: a.email,
    subject: "Payment received – Jeo Stone Studio",
    heading: "Thank you, your payment was received",
    lines: [
      hello(a),
      `We received €${amount} for the ${planName} plan.`,
      `Your licence now runs until ${fmtDate(a.licence.expiresAt)}. The desktop app picks this up by itself the next time it is online.`,
    ],
    button: { label: "Open my account", url: accountUrl },
  });

export const ownerNewAccountEmail = (owner: string, a: Account, adminUrl: string) =>
  layout({
    to: owner,
    subject: `New trial: ${a.email}`,
    heading: "Someone started a free trial",
    lines: [`${a.name ? a.name + " · " : ""}${a.email}`, `Trial until ${fmtDate(a.licence.expiresAt)}.`],
    button: { label: "Open customers", url: adminUrl },
  });
