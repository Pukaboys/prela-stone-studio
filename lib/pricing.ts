/**
 * Quote prices (no imports, so the project model can validate them without a
 * circular dependency on the production module).
 */
import type { EdgeFinish } from "@/lib/edges";

export type Pricing = {
  currency: string;
  /** Stone price per m² of finished area. */
  stonePerM2: number;
  /** Extra stone for offcuts, in % of the finished area. */
  waste: number;
  /** Sawing, per metre of cut (all piece outlines). */
  cutPerM: number;
  /** 45° mitre, per metre. */
  mitrePerM: number;
  /** Edge finish, per metre, by finish. */
  finishPerM: Partial<Record<EdgeFinish, number>>;
  /** Cut-out for a square or rounded opening (sink, hob). */
  openingRect: number;
  /** Round hole (tap, drain). */
  openingRound: number;
  /** VAT / sales tax in %. */
  vat: number;
};

export const DEFAULT_PRICING: Pricing = {
  currency: "€",
  stonePerM2: 0,
  waste: 10,
  cutPerM: 0,
  mitrePerM: 0,
  finishPerM: {},
  openingRect: 0,
  openingRound: 0,
  vat: 20,
};

export function validPricing(v: unknown): boolean {
  if (v === undefined) return true;
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  const n = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1e7;
  return (
    typeof p.currency === "string" &&
    p.currency.length <= 8 &&
    [p.stonePerM2, p.waste, p.cutPerM, p.mitrePerM, p.openingRect, p.openingRound, p.vat].every(n) &&
    !!p.finishPerM &&
    typeof p.finishPerM === "object" &&
    Object.values(p.finishPerM as object).every(n)
  );
}

