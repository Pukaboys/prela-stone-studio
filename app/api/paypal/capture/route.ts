import { applyPayment, currentAccount, publicAccount, sameOriginJson } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { PayPalError, captureOrder } from "@/lib/paypal";

/** Complete an approved PayPal payment and extend the licence. */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const a = await currentAccount(req);
  if (!a) return err(401, "Sign in first.");
  const orderId = String((await body<{ orderId: string }>(req)).orderId ?? "");
  try {
    const paid = await captureOrder(orderId, a.id);
    const updated = await applyPayment(a, orderId, paid.plan, paid.amount);
    return ok({ account: publicAccount(updated) });
  } catch (e) {
    if (e instanceof PayPalError) return err(402, e.message);
    console.error(e);
    return err(503, "The payment could not be confirmed. If money was taken, contact us with the PayPal receipt.");
  }
}
