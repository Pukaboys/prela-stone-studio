import { ok } from "@/lib/http";
import { publicConfig } from "@/lib/paypal";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";

/** Plans and the public PayPal client id for the checkout buttons. */
export async function GET() {
  return ok({ ...(await publicConfig()), plans: PLANS, trialDays: TRIAL_DAYS });
}
