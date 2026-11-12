/**
 * PayPal Checkout (Orders API v2), server side.
 *
 * Settings: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV ("sandbox" for
 * testing, "live" for real payments). Amounts always come from lib/plans on
 * the server; the browser only says which plan. A licence is extended only
 * after PayPal reports the capture COMPLETED for the expected amount,
 * currency, account and plan.
 */
import { CURRENCY, planById, type Plan, type PlanId } from "@/lib/plans";
import { getSetting } from "@/lib/storage";

export class PayPalError extends Error {}

async function config() {
  const clientId = await getSetting("PAYPAL_CLIENT_ID");
  const secret = await getSetting("PAYPAL_CLIENT_SECRET");
  const live = (await getSetting("PAYPAL_ENV")) === "live";
  if (!clientId || !secret) throw new PayPalError("Payments are not configured yet (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).");
  return { clientId, secret, base: live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com", live };
}

export async function publicConfig() {
  const clientId = (await getSetting("PAYPAL_CLIENT_ID")) ?? null;
  const live = (await getSetting("PAYPAL_ENV")) === "live";
  return { clientId, currency: CURRENCY, live };
}

async function accessToken() {
  const c = await config();
  const res = await fetch(`${c.base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${c.clientId}:${c.secret}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new PayPalError(`PayPal sign-in failed (${res.status}). Check the PayPal settings.`);
  return { token: ((await res.json()) as { access_token: string }).access_token, base: c.base };
}

const money = (n: number) => n.toFixed(2);

/** Create an order for a plan; returns PayPal's order id. */
export async function createOrder(accountId: string, plan: Plan) {
  const { token, base } = await accessToken();
  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": crypto.randomUUID() },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: plan.id,
          custom_id: `${accountId}:${plan.id}`,
          description: `Jeo Stone Studio – ${plan.name} licence`,
          amount: { currency_code: CURRENCY, value: money(plan.price) },
        },
      ],
      application_context: { brand_name: "Jeo Stone Studio", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
    }),
  });
  if (!res.ok) throw new PayPalError(`PayPal could not create the order (${res.status}).`);
  return ((await res.json()) as { id: string }).id;
}

type OrderDetails = {
  id: string;
  status: string;
  purchase_units?: {
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: { captures?: { id: string; status: string; custom_id?: string; amount: { currency_code: string; value: string } }[] };
  }[];
};

/**
 * Capture an approved order and check it. Returns what was paid for; throws
 * if anything does not match (wrong account, plan, amount or status).
 */
export async function captureOrder(orderId: string, accountId: string): Promise<{ plan: PlanId; amount: string }> {
  if (!/^[A-Z0-9]{6,40}$/.test(orderId)) throw new PayPalError("Invalid order.");
  const { token, base } = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let res = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, { method: "POST", headers });
  if (res.status === 422) {
    // Already captured (e.g. a retried request): read the order instead.
    res = await fetch(`${base}/v2/checkout/orders/${orderId}`, { headers });
  }
  if (!res.ok) throw new PayPalError(`PayPal could not complete the payment (${res.status}).`);
  const order = (await res.json()) as OrderDetails;
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (order.status !== "COMPLETED" || capture?.status !== "COMPLETED") throw new PayPalError("The payment was not completed.");
  const [acc, planId] = (unit?.custom_id ?? capture.custom_id ?? "").split(":");
  const plan = planById(planId);
  if (acc !== accountId || !plan) throw new PayPalError("This payment belongs to a different account.");
  if (capture.amount.currency_code !== CURRENCY || capture.amount.value !== money(plan.price))
    throw new PayPalError("The paid amount does not match the plan.");
  return { plan: plan.id, amount: capture.amount.value };
}
