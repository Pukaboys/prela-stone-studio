/**
 * What is sold. Change prices, lengths and device limits here; the website,
 * the admin page and the licences all read this.
 */
export type PlanId = "monthly" | "yearly";
export type Plan = {
  id: PlanId;
  name: string;
  /** Price in EUR. */
  price: number;
  /** Shown next to the price. */
  per: string;
  /** How long one payment extends the licence. */
  days: number;
  /** Computers the desktop app can be activated on. */
  devices: number;
  note?: string;
};

export const CURRENCY = "EUR";
export const TRIAL_DAYS = 14;
export const TRIAL_DEVICES = 1;

export const PLANS: Plan[] = [
  { id: "monthly", name: "Monthly", price: 19, per: "per month", days: 31, devices: 2, note: "Cancel any time" },
  { id: "yearly", name: "Yearly", price: 199, per: "per year", days: 365, devices: 2, note: "Two months free" },
];

export const planById = (id: unknown) => PLANS.find((p) => p.id === id);
