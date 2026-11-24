import { activityFor, fillEarlierHistory, logActivity } from "@/lib/activity";
import { applyPayment, getAccount, listAccounts, publicAccount, saveAccount, sameOriginJson, type Account } from "@/lib/accounts";
import { adminAccess } from "@/lib/admin";
import { audit, recentAudit } from "@/lib/audit";
import { paymentEmail, siteUrl } from "@/lib/emails";
import { body, err, ok } from "@/lib/http";
import { sendMail } from "@/lib/mail";
import { planById } from "@/lib/plans";

/**
 * Owner only, with two-step login (see lib/admin): list customers and switch
 * on licences after they pay. GET lists accounts and the activity log;
 * POST { accountId, action: "grant", plan, amount, note } adds a paid plan,
 * { action: "end" } ends the licence now, { action: "signout" } signs the
 * customer out of every browser. Every action is written to the activity log.
 */
const row = (a: Account) => ({ ...publicAccount(a), createdAt: a.createdAt });
const day = (iso: string) => iso.slice(0, 10);

export async function GET(req: Request) {
  const me = await adminAccess(req);
  if (me instanceof Response) return me;
  const all = await listAccounts();
  await fillEarlierHistory(all);
  // The newest few events of each customer, shown in their row.
  const recent = await Promise.all(all.map(async (a) => (await activityFor(a.id, 3)).slice(0, 3)));
  return ok({ accounts: all.map((a, i) => ({ ...row(a), recent: recent[i] })), activity: await recentAudit(200), recoveryLeft: me.account.totp?.recovery.length ?? 0 });
}

export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const me = await adminAccess(req);
  if (me instanceof Response) return me;
  const by = me.account.email;
  const b = await body<{ accountId: string; action: string; plan: string; amount: string; note: string; notify: boolean }>(req);
  const a = await getAccount(String(b.accountId ?? ""));
  if (!a) return err(404, "No such account.");

  if (b.action === "grant") {
    const plan = planById(b.plan);
    if (!plan) return err(400, "Choose a plan.");
    const amount = Number(String(b.amount ?? plan.price).replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return err(400, "Enter the amount paid.");
    const note = String(b.note ?? "").trim().slice(0, 200) || undefined;
    const before = a.licence.expiresAt;
    await applyPayment(a, `MANUAL-${Date.now()}`, plan.id, amount.toFixed(2), note);
    await logActivity(req, a, `${plan.name} plan added`, { by, detail: `€${amount.toFixed(2)} · until ${day(a.licence.expiresAt)}` });
    await audit(req, by, `Added ${plan.name} plan`, a.email, `€${amount.toFixed(2)} · until ${day(before)} → ${day(a.licence.expiresAt)}${note ? ` · ${note}` : ""}`);
    if (b.notify !== false) void sendMail(paymentEmail(a, amount.toFixed(2), plan.name, `${await siteUrl()}/account`));
    return ok({ account: row(a) });
  }
  if (b.action === "end") {
    const before = a.licence.expiresAt;
    a.licence = { ...a.licence, expiresAt: new Date().toISOString() };
    await saveAccount(a);
    await logActivity(req, a, "Licence ended by the owner", { by });
    await audit(req, by, "Ended licence", a.email, `was until ${day(before)}`);
    return ok({ account: row(a) });
  }
  if (b.action === "signout") {
    const count = a.sessions?.length ?? 0;
    a.sessions = [];
    await saveAccount(a);
    await logActivity(req, a, "Signed out of every browser by the owner", { by });
    await audit(req, by, "Signed out of every browser", a.email, `${count} browser${count === 1 ? "" : "s"}`);
    return ok({ account: row(a) });
  }
  return err(400, "Unknown action.");
}
