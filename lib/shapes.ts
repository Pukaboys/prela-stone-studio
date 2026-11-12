/**
 * Piece shapes.
 *
 * Every piece has a bounding box (w × h, millimetres) and an optional shape
 * inside it. `pieceOutline` turns any shape into one polygon in piece-local
 * millimetres (x right, y towards the front, 0..w × 0..h). The slab layout,
 * the 2D and 3D assembly, the 3D export and the placement checks all use this
 * outline, so they always agree.
 */
import type { Piece } from "@/lib/model";

export type Pt = { x: number; y: number };

/** Corner treatment. Chamfer sizes are along X (horizontal edge) and Y (vertical edge). */
export type Corner =
  | { type: "square" }
  | { type: "radius"; r: number }
  | { type: "chamfer"; x: number; y: number };
export type Corners = [Corner, Corner, Corner, Corner]; // back-left, back-right, front-right, front-left

export type PieceShape =
  | { kind: "rect"; corners?: Corners }
  | { kind: "ellipse" }
  /** Rectangle with a round top (back) edge; `rise` = height of the curve. */
  | { kind: "arch"; rise: number }
  /** Curved band: straight leg A, a turn of `angle`° with inner radius, straight leg B. */
  | { kind: "bend"; band: number; radius: number; angle: number; legA: number; legB: number }
  /** Free form, points normalised to 0..1 of the piece box. */
  | { kind: "polygon"; points: Pt[] };

export type ShapeKind = PieceShape["kind"];
export type HoleKind = "rect" | "rounded" | "ellipse";

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: "Rectangle",
  ellipse: "Circle / ellipse",
  arch: "Arch",
  bend: "Curved band",
  polygon: "Free form",
};
export const SQUARE: Corner = { type: "square" };
export const CORNER_NAMES = ["Back left", "Back right", "Front right", "Front left"] as const;

// ------------------------------------------------------------------ geometry
const ARC_STEP = Math.PI / 24; // 7.5°: coarsest step, for small radii
/** Curves deviate at most this far (mm) from the true arc, so 4 mm gap checks stay exact. */
const ARC_TOLERANCE = 0.2;
/** Angle step that keeps the chord within ARC_TOLERANCE of an arc of radius r. */
const arcStep = (r: number) =>
  r <= ARC_TOLERANCE ? ARC_STEP : Math.min(ARC_STEP, Math.max(Math.PI / 360, 2 * Math.acos(1 - ARC_TOLERANCE / r)));

function arc(c: Pt, rx: number, ry: number, a0: number, a1: number, out: Pt[], includeStart = true) {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / arcStep(Math.max(rx, ry))));
  for (let i = includeStart ? 0 : 1; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });
  }
}

/** Fit corner sizes so the two corners on an edge never overlap. */
function fitCorners(corners: Corners, w: number, h: number): Corners {
  const along = (c: Corner, horizontal: boolean) =>
    c.type === "radius" ? c.r : c.type === "chamfer" ? (horizontal ? c.x : c.y) : 0;
  const scaleFor = (a: number, b: number, len: number) => (a + b > len && a + b > 0 ? len / (a + b) : 1);
  // edges: back (0,1) horizontal, right (1,2) vertical, front (2,3) horizontal, left (3,0) vertical
  const s = [
    scaleFor(along(corners[0], true), along(corners[1], true), w),
    scaleFor(along(corners[1], false), along(corners[2], false), h),
    scaleFor(along(corners[2], true), along(corners[3], true), w),
    scaleFor(along(corners[3], false), along(corners[0], false), h),
  ];
  // corner i touches edges i-1 (vertical/horizontal) and i
  const k = (i: number) => Math.min(s[i], s[(i + 3) % 4]);
  return corners.map((c, i) => {
    const f = k(i);
    if (c.type === "radius") return { type: "radius", r: Math.max(0, c.r * f) };
    if (c.type === "chamfer") return { type: "chamfer", x: Math.max(0, c.x * f), y: Math.max(0, c.y * f) };
    return c;
  }) as Corners;
}

/** Rectangle w × h with square, rounded or chamfered corners (clockwise from back-left). */
export function roundedRect(w: number, h: number, corners: Corners = [SQUARE, SQUARE, SQUARE, SQUARE], ox = 0, oy = 0): Pt[] {
  const c = fitCorners(corners, w, h);
  const pts: Pt[] = [];
  // corner position, direction of the edge arriving at it, direction of the edge leaving it
  const geo: [Pt, Pt, Pt][] = [
    [{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }],
    [{ x: w, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: w, y: h }, { x: 0, y: 1 }, { x: -1, y: 0 }],
    [{ x: 0, y: h }, { x: -1, y: 0 }, { x: 0, y: -1 }],
  ];
  geo.forEach(([p, din, dout], i) => {
    const corner = c[i];
    if (corner.type === "radius" && corner.r > 0.01) {
      const r = corner.r;
      const center = { x: p.x - din.x * r + dout.x * r, y: p.y - din.y * r + dout.y * r };
      const s = { x: p.x - din.x * r, y: p.y - din.y * r }, e = { x: p.x + dout.x * r, y: p.y + dout.y * r };
      const a0 = Math.atan2(s.y - center.y, s.x - center.x);
      let a1 = Math.atan2(e.y - center.y, e.x - center.x);
      while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
      while (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
      arc(center, r, r, a0, a1, pts);
    } else if (corner.type === "chamfer" && (corner.x > 0.01 || corner.y > 0.01)) {
      const inLen = din.x !== 0 ? corner.x : corner.y, outLen = dout.x !== 0 ? corner.x : corner.y;
      pts.push({ x: p.x - din.x * inLen, y: p.y - din.y * inLen }, { x: p.x + dout.x * outLen, y: p.y + dout.y * outLen });
    } else pts.push({ ...p });
  });
  return pts.map((q) => ({ x: q.x + ox, y: q.y + oy }));
}

function ellipse(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const pts: Pt[] = [];
  arc({ x: cx, y: cy }, rx, ry, -Math.PI / 2, (3 * Math.PI) / 2, pts);
  pts.pop(); // last point repeats the first
  return pts;
}

/** Curved band in its own coordinates (before fitting into the piece box). */
export function bendPolygon(s: Extract<PieceShape, { kind: "bend" }>): Pt[] {
  const t = Math.max(1, s.band), R = Math.max(0, s.radius) + t / 2;
  const sweep = (Math.min(180, Math.max(1, s.angle)) * Math.PI) / 180;
  const center: Pt[] = [];
  const heading: Pt[] = [];
  center.push({ x: 0, y: 0 }); heading.push({ x: 1, y: 0 });
  if (s.legA > 0) { center.push({ x: s.legA, y: 0 }); heading.push({ x: 1, y: 0 }); }
  const c = { x: Math.max(0, s.legA), y: R };
  const n = Math.max(4, Math.ceil(sweep / arcStep(R + t / 2)));
  for (let i = 1; i <= n; i++) {
    const phi = -Math.PI / 2 + (sweep * i) / n;
    center.push({ x: c.x + R * Math.cos(phi), y: c.y + R * Math.sin(phi) });
    heading.push({ x: -Math.sin(phi), y: Math.cos(phi) });
  }
  if (s.legB > 0) {
    const e = center[center.length - 1], d = heading[heading.length - 1];
    center.push({ x: e.x + d.x * s.legB, y: e.y + d.y * s.legB }); heading.push(d);
  }
  const outer = center.map((p, i) => ({ x: p.x + heading[i].y * (t / 2), y: p.y - heading[i].x * (t / 2) }));
  const inner = center.map((p, i) => ({ x: p.x - heading[i].y * (t / 2), y: p.y + heading[i].x * (t / 2) }));
  return [...outer, ...inner.reverse()];
}

export function bounds(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Stretch points so their bounding box becomes exactly 0..w × 0..h. */
function fit(pts: Pt[], w: number, h: number): Pt[] {
  const b = bounds(pts);
  const sx = b.w > 0 ? w / b.w : 1, sy = b.h > 0 ? h / b.h : 1;
  return pts.map((p) => ({ x: (p.x - b.x) * sx, y: (p.y - b.y) * sy }));
}

/** Natural size of shapes whose size follows from their parameters (curved band). */
export function shapeSize(shape: PieceShape): { w: number; h: number } | null {
  if (shape.kind !== "bend") return null;
  const b = bounds(bendPolygon(shape));
  return { w: Math.round(b.w * 10) / 10, h: Math.round(b.h * 10) / 10 };
}

/** The piece outline in piece-local millimetres. */
export function pieceOutline(p: Pick<Piece, "w" | "h" | "shape">): Pt[] {
  const { w, h } = p, s = p.shape;
  if (!s || s.kind === "rect") return roundedRect(w, h, s?.corners);
  if (s.kind === "ellipse") return ellipse(w / 2, h / 2, w / 2, h / 2);
  if (s.kind === "arch") {
    const rise = Math.min(h, Math.max(0, s.rise));
    const pts: Pt[] = [];
    arc({ x: w / 2, y: rise }, w / 2, rise, Math.PI, 2 * Math.PI, pts);
    pts.push({ x: w, y: h }, { x: 0, y: h });
    return pts;
  }
  if (s.kind === "bend") return fit(bendPolygon(s), w, h);
  return s.points.map((q) => ({ x: q.x * w, y: q.y * h }));
}

/** Opening outline in piece-local millimetres, from its box. */
export function holeOutline(box: { x: number; y: number; w: number; h: number }, kind: HoleKind = "rect", r = 0): Pt[] {
  if (kind === "ellipse") return ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2);
  const c: Corner = kind === "rounded" && r > 0 ? { type: "radius", r } : SQUARE;
  return roundedRect(box.w, box.h, [c, c, c, c], box.x, box.y);
}

/** Piece-local point → slab footprint coordinates (rotated 90° when `rot`). */
export const toFootprint = (p: Pick<Piece, "h" | "rot">, q: Pt): Pt => (p.rot ? { x: p.h - q.y, y: q.x } : q);

// ------------------------------------------------------------------ polygon maths
export function area(pts: Pt[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function pathD(pts: Pt[]) {
  if (!pts.length) return "";
  return "M" + pts.map((p) => `${+p.x.toFixed(2)} ${+p.y.toFixed(2)}`).join("L") + "Z";
}

export function pointInPolygon(pt: Pt, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointSegDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * True when two polygons overlap or are closer than `gap` (the saw gap).
 * A tiny tolerance keeps pieces snapped exactly `gap` apart valid.
 */
export function tooClose(A: Pt[], B: Pt[], gap: number) {
  const a = bounds(A), b = bounds(B);
  if (a.x > b.x + b.w + gap || b.x > a.x + a.w + gap || a.y > b.y + b.h + gap || b.y > a.y + a.h + gap) return false;
  if (pointInPolygon(A[0], B) || pointInPolygon(B[0], A)) return true;
  const limit = gap - 1e-6;
  for (let i = 0; i < A.length; i++) {
    const p = A[i], q = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      const r = B[j], s = B[(j + 1) % B.length];
      if (segmentsCross(p, q, r, s)) return true;
      if (limit > 0 && Math.min(pointSegDist(p, r, s), pointSegDist(r, p, q)) < limit) return true;
    }
  }
  return false;
}

/** True when every point of `inner` lies inside `outer` (used for openings). */
export const containsPolygon = (outer: Pt[], inner: Pt[]) =>
  inner.every((p) => pointInPolygon(p, outer)) &&
  !inner.some((p, i) => outer.some((r, j) => segmentsCross(p, inner[(i + 1) % inner.length], r, outer[(j + 1) % outer.length])));

// ------------------------------------------------------------------ validation
const num = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
function validCorner(c: unknown) {
  if (!c || typeof c !== "object") return false;
  const k = c as Record<string, unknown>;
  return k.type === "square" || (k.type === "radius" && num(k.r, 0, 20000)) || (k.type === "chamfer" && num(k.x, 0, 20000) && num(k.y, 0, 20000));
}
export function validShape(s: unknown): s is PieceShape {
  if (s === undefined) return true;
  if (!s || typeof s !== "object") return false;
  const v = s as Record<string, unknown>;
  switch (v.kind) {
    case "rect":
      return v.corners === undefined || (Array.isArray(v.corners) && v.corners.length === 4 && v.corners.every(validCorner));
    case "ellipse":
      return true;
    case "arch":
      return num(v.rise, 0, 20000);
    case "bend":
      return num(v.band, 1, 20000) && num(v.radius, 0, 20000) && num(v.angle, 1, 180) && num(v.legA, 0, 20000) && num(v.legB, 0, 20000);
    case "polygon":
      return (
        Array.isArray(v.points) &&
        v.points.length >= 3 &&
        v.points.length <= 2000 &&
        v.points.every((p: unknown) => !!p && num((p as Pt).x, -0.001, 1.001) && num((p as Pt).y, -0.001, 1.001))
      );
    default:
      return false;
  }
}
