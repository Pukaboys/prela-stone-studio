"use client";
/** Quote: editable prices (saved with the project) and a live price breakdown. */
import { Printer } from "lucide-react";
import Num from "@/components/num-field";
import { FINISHES, FINISH_LABEL } from "@/lib/edges";
import type { Project } from "@/lib/model";
import { DEFAULT_PRICING, quote, type Pricing } from "@/lib/production";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function QuotePanel({
  project,
  onPricing,
  onPrint,
}: {
  project: Project;
  onPricing: (p: Pricing) => void;
  onPrint: () => void;
}) {
  const pricing = { ...DEFAULT_PRICING, ...project.pricing };
  const set = (values: Partial<Pricing>) => onPricing({ ...pricing, ...values });
  const q = quote(project, pricing);
  const cur = pricing.currency;
  return (
    <div className="quote-panel">
      <div className="quote-prices">
        <label className="field">
          <span>Currency</span>
          <input value={cur} maxLength={8} onChange={(e) => set({ currency: e.target.value })} />
        </label>
        <Num label="Stone per m²" unit={cur} value={pricing.stonePerM2} max={1e6} onChange={(stonePerM2) => set({ stonePerM2 })} />
        <Num label="Offcuts" unit="%" value={pricing.waste} max={300} onChange={(waste) => set({ waste })} />
        <Num label="Sawing per m" unit={cur} value={pricing.cutPerM} max={1e6} onChange={(cutPerM) => set({ cutPerM })} />
        <Num label="45° mitre per m" unit={cur} value={pricing.mitrePerM} max={1e6} onChange={(mitrePerM) => set({ mitrePerM })} />
        {FINISHES.filter((f) => f !== "raw").map((f) => (
          <Num
            key={f}
            label={`${FINISH_LABEL[f]} per m`}
            unit={cur}
            value={pricing.finishPerM[f] ?? 0}
            max={1e6}
            onChange={(n) => set({ finishPerM: { ...pricing.finishPerM, [f]: n } })}
          />
        ))}
        <Num label="Sink / hob cut-out" unit={cur} value={pricing.openingRect} max={1e6} onChange={(openingRect) => set({ openingRect })} />
        <Num label="Round hole" unit={cur} value={pricing.openingRound} max={1e6} onChange={(openingRound) => set({ openingRound })} />
        <Num label="VAT" unit="%" value={pricing.vat} max={100} onChange={(vat) => set({ vat })} />
      </div>
      <table className="quote-table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="n">Quantity</th>
            <th className="n">Price</th>
            <th className="n">Total</th>
          </tr>
        </thead>
        <tbody>
          {q.lines.length ? (
            q.lines.map((l) => (
              <tr key={l.label}>
                <td>{l.label}</td>
                <td className="n">
                  {l.qty.toFixed(l.unit === "pcs" ? 0 : 2)} {l.unit}
                </td>
                <td className="n">{fmt(l.price)}</td>
                <td className="n">{fmt(l.total)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={4} className="muted">
                Add pieces to see the quote.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Subtotal</td>
            <td className="n">
              {cur} {fmt(q.subtotal)}
            </td>
          </tr>
          <tr>
            <td colSpan={3}>VAT {pricing.vat}%</td>
            <td className="n">
              {cur} {fmt(q.vat)}
            </td>
          </tr>
          <tr className="total">
            <td colSpan={3}>Total</td>
            <td className="n">
              {cur} {fmt(q.total)}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="hint">
        Finished area {q.totals.finishedM2.toFixed(2)} m² · sawing {q.totals.cutM.toFixed(2)} m · mitres {q.totals.mitreM.toFixed(2)} m · {q.totals.rectHoles} cut-out
        {q.totals.rectHoles === 1 ? "" : "s"} · {q.totals.roundHoles} round hole{q.totals.roundHoles === 1 ? "" : "s"}. Prices are saved with the project.
      </p>
      <div className="dialog-actions">
        <span />
        <button className="primary" onClick={onPrint}>
          <Printer size={16} /> Print quote with cut list
        </button>
      </div>
    </div>
  );
}
