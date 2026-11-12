/**
 * Production output from a project: cut list, DXF for CNC / bridge saws, and
 * a quote. Everything is derived from the real outlines, openings, edge cuts
 * and finishes, so the shop floor, the CAD file and the price agree.
 */
import {
  edgeCutsOf,
  edgeFinishesOf,
  mitreStrips,
  sideLengths,
  CUT_LABEL,
  FINISH_LABEL,
  SIDES,
  SIDE_LABEL,
  type EdgeFinish,
} from "@/lib/edges";
import {
  openingBox,
  openingsOf,
  outlineOnSlab,
  pieceArea,
  pieceHoles,
  placement,
  slabAngleOf,
  type Piece,
  type Project,
} from "@/lib/model";
import { SHAPE_LABEL, area, pieceOutline, type Pt } from "@/lib/shapes";
import { DEFAULT_PRICING, type Pricing } from "@/lib/pricing";

export { DEFAULT_PRICING, type Pricing };

// ---------------------------------------------------------------- cut list
export type CutListPiece = {
  number: number;
  piece: Piece;
  shape: string;
  size: string;
  angle: number;
  position: { x: number; y: number };
  areaM2: number;
  edges: { side: string; cut: string; finish: string; lengthMm: number }[];
  openings: { label: string; size: string; kind: string; position: string }[];
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function cutList(pr: Project) {
  return pr.slabs.map((slab, si) => {
    const pieces: CutListPiece[] = pr.pieces
      .map((p, i) => ({ p, number: i + 1 }))
      .filter(({ p }) => p.slab === slab.id)
      .map(({ p, number }) => {
        const outline = pieceOutline(p);
        const lengths = sideLengths(outline);
        const cuts = edgeCutsOf(p), fins = edgeFinishesOf(p);
        return {
          number,
          piece: p,
          shape: SHAPE_LABEL[p.shape?.kind ?? "rect"],
          size: `${r1(p.w)} × ${r1(p.h)}`,
          angle: slabAngleOf(p),
          position: { x: r1(p.x), y: r1(p.y) },
          areaM2: pieceArea(p) / 1e6,
          edges: SIDES.filter((s) => lengths[s] > 0.5).map((s) => ({
            side: SIDE_LABEL[s],
            cut: CUT_LABEL[cuts[s]],
            finish: cuts[s] === "straight" ? FINISH_LABEL[fins[s]] : "Joint",
            lengthMm: Math.round(lengths[s]),
          })),
          openings: openingsOf(p).map((o, k) => ({
            label: o.label || `Opening ${k + 1}`,
            size: o.kind === "ellipse" && o.w === o.h ? `Ø${r1(o.w)}` : `${r1(o.w)} × ${r1(o.h)}`,
            kind: o.kind === "ellipse" ? "Round" : o.kind === "rounded" ? `Rounded R${r1(o.r ?? 0)}` : "Square",
            position: `${r1(o.dx)} from ${o.edgeX}, ${r1(o.dy)} from ${o.edgeY}`,
          })),
        };
      });
    const used = pieces.reduce((a, c) => a + c.areaM2, 0);
    return { slab, number: si + 1, pieces, slabM2: (slab.w * slab.h) / 1e6, usedM2: used };
  });
}

// ---------------------------------------------------------------- DXF
/**
 * DXF (R12, millimetres) with every slab side by side. Layers:
 * SLAB (slab edge), MARGIN (usable area), CUT (piece outlines), OPENING,
 * MITRE_BELOW / MITRE_ABOVE (mitred edges), TEXT (piece numbers).
 * DXF's Y axis points up, so drawings are flipped from screen coordinates.
 */
export function projectDxf(pr: Project) {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === "number" ? String(+value.toFixed(3)) : value);
  const poly = (layer: string, pts: Pt[], ox: number, h: number, closed = true) => {
    g(0, "POLYLINE"); g(8, layer); g(66, 1); g(70, closed ? 1 : 0);
    for (const p of pts) { g(0, "VERTEX"); g(8, layer); g(10, ox + p.x); g(20, h - p.y); }
    g(0, "SEQEND"); g(8, layer);
  };
  const text = (layer: string, x: number, y: number, size: number, value: string) => {
    g(0, "TEXT"); g(8, layer); g(10, x); g(20, y); g(40, size); g(1, value.replace(/[\r\n]/g, " "));
  };
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  let ox = 0;
  for (const slab of pr.slabs) {
    const H = slab.h;
    poly("SLAB", [{ x: 0, y: 0 }, { x: slab.w, y: 0 }, { x: slab.w, y: H }, { x: 0, y: H }], ox, H);
    const m = pr.margin;
    if (m > 0) poly("MARGIN", [{ x: m, y: m }, { x: slab.w - m, y: m }, { x: slab.w - m, y: H - m }, { x: m, y: H - m }], ox, H);
    text("TEXT", ox, H + 60, 50, slab.name);
    pr.pieces.forEach((p, i) => {
      if (p.slab !== slab.id) return;
      const pl = placement(p);
      poly("CUT", outlineOnSlab(p), ox, H);
      for (const h of pieceHoles(p)) poly("OPENING", h.map(pl.slab), ox, H);
      for (const s of mitreStrips(pieceOutline(p), edgeCutsOf(p), slab.thickness))
        poly(s.cut === "below" ? "MITRE_BELOW" : "MITRE_ABOVE", [s.pts[0], s.pts[1]].map(pl.slab), ox, H, false);
      const c = pl.slab({ x: p.w / 2, y: p.h / 2 });
      text("TEXT", ox + c.x, H - c.y, 60, `${i + 1} ${p.name}`);
    });
    ox += slab.w + 300;
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- quote
export type QuoteLine = { label: string; qty: number; unit: string; price: number; total: number };

export function quote(pr: Project, pricing: Pricing = DEFAULT_PRICING) {
  let finishedMm2 = 0, cutMm = 0, mitreMm = 0, rectHoles = 0, roundHoles = 0;
  const finishMm: Partial<Record<EdgeFinish, number>> = {};
  for (const p of pr.pieces) {
    const outline = pieceOutline(p);
    finishedMm2 += pieceArea(p);
    const lengths = sideLengths(outline);
    const cuts = edgeCutsOf(p), fins = edgeFinishesOf(p);
    for (const s of SIDES) {
      cutMm += lengths[s];
      if (cuts[s] !== "straight") mitreMm += lengths[s];
      else if (fins[s] !== "raw") finishMm[fins[s]] = (finishMm[fins[s]] ?? 0) + lengths[s];
    }
    for (const o of openingsOf(p)) {
      if (!(o.w > 0 && o.h > 0)) continue;
      if (o.kind === "ellipse") roundHoles++;
      else rectHoles++;
      // Openings are sawn too.
      const box = openingBox(p, o);
      cutMm += o.kind === "ellipse" ? Math.PI * ((box.w + box.h) / 2) : 2 * (box.w + box.h);
    }
  }
  const m2 = (finishedMm2 / 1e6) * (1 + pricing.waste / 100);
  const lines: QuoteLine[] = [];
  const add = (label: string, qty: number, unit: string, price: number) => {
    if (qty > 0) lines.push({ label, qty, unit, price, total: qty * price });
  };
  add(`Stone (finished area + ${pricing.waste}% offcuts)`, m2, "m²", pricing.stonePerM2);
  add("Sawing", cutMm / 1000, "m", pricing.cutPerM);
  add("45° mitre", mitreMm / 1000, "m", pricing.mitrePerM);
  for (const [f, mm] of Object.entries(finishMm) as [EdgeFinish, number][])
    add(`Edge: ${FINISH_LABEL[f]}`, mm / 1000, "m", pricing.finishPerM[f] ?? 0);
  add("Cut-out (sink / hob)", rectHoles, "pcs", pricing.openingRect);
  add("Round hole (tap / drain)", roundHoles, "pcs", pricing.openingRound);
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const vat = (subtotal * pricing.vat) / 100;
  return {
    lines,
    subtotal,
    vat,
    total: subtotal + vat,
    totals: { finishedM2: finishedMm2 / 1e6, cutM: cutMm / 1000, mitreM: mitreMm / 1000, rectHoles, roundHoles },
  };
}

/** Area helper for reports (m², 2 decimals). */
export const m2 = (mm2: number) => (mm2 / 1e6).toFixed(2);
export const outlineAreaM2 = (pts: Pt[]) => area(pts) / 1e6;
