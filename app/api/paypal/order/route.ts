import { currentAccount, sameOriginJson } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { PayPalError, createOrder } from "@/lib/paypal";
import { planById } from "@/lib/plans";

/** Start a PayPal checkout for a plan (amount set on the server). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const a = await currentAccount(req);
  if (!a) return err(401, "Sign in first.");
  const plan = planById((await body<{ plan: string }>(req)).plan);
  if (!plan) return err(400, "Unknown plan.");
  try {
    return ok({ id: await createOrder(a.id, plan) });
  } catch (e) {
    if (e instanceof PayPalError) return err(502, e.message);
    console.error(e);
    return err(503, "Could not start the payment.");
  }
}
