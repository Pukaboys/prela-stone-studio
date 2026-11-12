/**
 * Edge cuts (mitres). Each side of a piece — back, right, front, left — is
 * cut straight (90°) or at 45° through the full slab thickness:
 *
 *   below  top face full size, the cut slopes inward underneath
 *          (e.g. a countertop's front edge meeting an apron below it)
 *   above  bottom face full size, the top face is shorter
 *          (e.g. the apron's edge meeting the countertop from below)
 *
 * Outline segments belong to the side they face, so any shape works. The
 * piece outline is the larger face; the mitred face is inset by the slab
 * thickness on the mitred edges.
 */
import type { Piece } from "@/lib/model";
import type { Pt } from "@/lib/shapes";

export type EdgeCut = "straight" | "below" | "above";
export type Side = "back" | "right" | "front" | "left";
export type EdgeCuts = Partial<Record<Side, EdgeCut>>;

export const SIDES: Side[] = ["back", "right", "front", "left"];
export const SIDE_LABEL: Record<Side, string> = { back: "Back", right: "Right", front: "Front", left: "Left" };
export const CUT_LABEL: Record<EdgeCut, string> = { straight: "Straight", below: "45° below", above: "45° above" };

/** Edge cuts of a piece; legacy `cutAngle: 45` means every edge mitred below. */
export function edgeCutsOf(p: Pick<Piece, "edges" | "cutAngle">): Record<Side, EdgeCut> {
  const fallback: EdgeCut = !p.edges && p.cutAngle === 45 ? "below" : "straight";
  return {
    back: p.edges?.back ?? fallback,
    right: p.edges?.right ?? fallback,
    front: p.edges?.front ?? fallback,
    left: p.edges?.left ?? fallback,
  };
}
export const hasMitre = (p: Pick<Piece, "edges" | "cutAngle">) => Object.values(edgeCutsOf(p)).some((c) => c !== "straight");

/** One-line summary, e.g. "Front 45° below · Left 45° above" or "All straight". */
export function edgeSummary(p: Pick<Piece, "edges" | "cutAngle">) {
  const cuts = edgeCutsOf(p);
  const parts = SIDES.filter((s) => cuts[s] !== "straight").map((s) => `${SIDE_LABEL[s]} ${CUT_LABEL[cuts[s]]}`);
  if (!parts.length) return "All straight";
  if (parts.length === 4 && SIDES.every((s) => cuts[s] === cuts.back)) return `All ${CUT_LABEL[cuts.back]}`;
  return parts.join(" · ");
}

const signedArea = (pts: Pt[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

/** Inward unit normal and facing side of every outline segment i → i+1. */
export function segmentSides(pts: Pt[]) {
  const ccw = signedArea(pts) > 0;
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const d = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    const inward = ccw ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
    const out = { x: -inward.x, y: -inward.y };
    // y grows towards the front; the back is the top edge in the drawings.
    const side: Side = Math.abs(out.y) >= Math.abs(out.x) ? (out.y < 0 ? "back" : "front") : out.x > 0 ? "right" : "left";
    return { dir: d, inward, side };
  });
}

/**
 * Move each segment inward by its own distance and re-join the corners.
 * Keeps the vertex count, so the inset outline lines up 1:1 with the
 * original (needed to build the slanted walls). Nearly straight joins
 * (tessellated curves) blend instead of intersecting, to avoid spikes.
 */
export function insetPolygon(pts: Pt[], dist: number[]): Pt[] {
  const seg = segmentSides(pts);
  const n = pts.length;
  return pts.map((p, j) => {
    const a = (j - 1 + n) % n, b = j;
    const da = dist[a], db = dist[b];
    if (!da && !db) return { ...p };
    const u = seg[a].dir, v = seg[b].dir;
    const cross = u.x * v.y - u.y * v.x;
    if (Math.abs(cross) < Math.sin((12 * Math.PI) / 180)) {
      const nx = seg[a].inward.x + seg[b].inward.x, ny = seg[a].inward.y + seg[b].inward.y;
      const len = Math.hypot(nx, ny) || 1, d = (da + db) / 2;
      return { x: p.x + (nx / len) * d, y: p.y + (ny / len) * d };
    }
    const A = { x: p.x + seg[a].inward.x * da, y: p.y + seg[a].inward.y * da };
    const B = { x: p.x + seg[b].inward.x * db, y: p.y + seg[b].inward.y * db };
    const s = ((B.x - A.x) * v.y - (B.y - A.y) * v.x) / cross;
    return { x: A.x + u.x * s, y: A.y + u.y * s };
  });
}

/**
 * Top and bottom faces of a piece with mitred edges (piece-local mm).
 * `thickness` is the slab thickness: a 45° mitre insets the face by it.
 */
export function mitredFaces(outline: Pt[], cuts: Record<Side, EdgeCut>, thickness: number) {
  const seg = segmentSides(outline);
  const t = Math.max(0, thickness);
  const top = insetPolygon(outline, seg.map((s) => (cuts[s.side] === "above" ? t : 0)));
  const bottom = insetPolygon(outline, seg.map((s) => (cuts[s.side] === "below" ? t : 0)));
  return { top, bottom };
}

/**
 * Strips along mitred edges for drawings: the band between the full outline
 * and the mitred face, tagged with the cut direction.
 */
export function mitreStrips(outline: Pt[], cuts: Record<Side, EdgeCut>, thickness: number) {
  const seg = segmentSides(outline);
  const inner = insetPolygon(outline, seg.map((s) => (cuts[s.side] === "straight" ? 0 : thickness)));
  const strips: { cut: EdgeCut; pts: Pt[] }[] = [];
  seg.forEach((s, i) => {
    const cut = cuts[s.side];
    if (cut === "straight") return;
    const j = (i + 1) % outline.length;
    strips.push({ cut, pts: [outline[i], outline[j], inner[j], inner[i]] });
  });
  return strips;
}

export function validEdges(e: unknown): boolean {
  if (e === undefined) return true;
  if (!e || typeof e !== "object") return false;
  return Object.entries(e as Record<string, unknown>).every(
    ([k, v]) => (SIDES as string[]).includes(k) && (v === "straight" || v === "below" || v === "above"),
  );
}
