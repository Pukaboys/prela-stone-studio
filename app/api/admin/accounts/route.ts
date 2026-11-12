import { applyPayment, currentAccount, getAccount, listAccounts, publicAccount, saveAccount, sameOriginJson, type Account } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { planById } from "@/lib/plans";
import { isOwner } from "@/lib/studio-access";

/**
 * Owner only (ADMIN_EMAIL): list customers and switch on licences after they
 * pay. GET lists accounts; POST { accountId, action: "grant", plan, amount, note }
 * adds a paid plan, { action: "end" } ends the licence now, { action:
 * "signout" } signs the customer out of every browser.
 */
async function owner(req: Request): Promise<Account | Response> {
  const a = await currentAccount(req);
  if (!a) return err(401, "Sign in first.");
  if (!(await isOwner(a))) return err(403, "Only the owner can do this.");
  return a;
}

export async function GET(req: Request) {
  const me = await owner(req);
  if (me instanceof Response) return me;
  const all = await listAccounts();
  return ok({ accounts: all.map((a) => ({ ...publicAccount(a), createdAt: a.createdAt })) });
}

export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const me = await owner(req);
  if (me instanceof Response) return me;
  const b = await body<{ accountId: string; action: string; plan: string; amount: string; note: string }>(req);
  const a = await getAccount(String(b.accountId ?? ""));
  if (!a) return err(404, "No such account.");

  if (b.action === "grant") {
    const plan = planById(b.plan);
    if (!plan) return err(400, "Choose a plan.");
    const amount = Number(String(b.amount ?? plan.price).replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return err(400, "Enter the amount paid.");
    const note = String(b.note ?? "").trim().slice(0, 200) || undefined;
    await applyPayment(a, `MANUAL-${Date.now()}`, plan.id, amount.toFixed(2), note);
    return ok({ account: { ...publicAccount(a), createdAt: a.createdAt } });
  }
  if (b.action === "end") {
    a.licence = { ...a.licence, expiresAt: new Date().toISOString() };
    await saveAccount(a);
    return ok({ account: { ...publicAccount(a), createdAt: a.createdAt } });
  }
  if (b.action === "signout") {
    a.sessions = [];
    await saveAccount(a);
    return ok({ account: { ...publicAccount(a), createdAt: a.createdAt } });
  }
  return err(400, "Unknown action.");
}
