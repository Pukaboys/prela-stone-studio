import DEFAULT_PROJECT from "@/lib/default-project.json";
import { validPricing, type Pricing } from "@/lib/pricing";
import { validEdges, validFinishes, type EdgeCuts, type EdgeFinishes } from "@/lib/edges";
import {
  area,
  containsPolygon,
  holeOutline,
  pieceOutline,
  roundedRect,
  tooClose,
  validShape,
  type HoleKind,
  type PieceShape,
  type Pt,
} from "@/lib/shapes";

export type PhotoCrop = { x: number; y: number; w: number; h: number };
export type PhotoQuad = {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
};
export type PhotoAdjustments = { straighten: number; perspectiveV: number; perspectiveH: number };
/**
 * Settings from the photo editor (iPhone-style straighten / perspective /
 * crop). `source` is the original upload; the slab's `image` is the corrected
 * photo baked from it, so every view shows the same straightened stone.
 * `crop` is in the editor's display space (centered, half-size = 1).
 */
export type PhotoEdit = {
  source: string;
  straighten: number;
  vertical: number;
  horizontal: number;
  crop: PhotoCrop;
};
export const EDIT_LIMIT = 45;
export type Slab = {
  id: string;
  name: string;
  w: number;
  h: number;
  thickness: number;
  image: string;
  photoWidth?: number;
  photoHeight?: number;
  crop?: PhotoCrop;
  calibration?: PhotoQuad;
  adjustments?: PhotoAdjustments;
  /** Book-matched slab: show the photo mirrored left–right. */
  mirror?: boolean;
  edit?: PhotoEdit;
};
export type CutAngle = 0 | 45;
/** One opening, positioned by distances from the piece edges to its edges. */
export type Opening = {
  id: string;
  label?: string;
  w: number;
  h: number;
  kind?: HoleKind;
  /** Corner radius for rounded openings. */
  r?: number;
  edgeX: HoleEdgeX;
  dx: number;
  edgeY: HoleEdgeY;
  dy: number;
};
export type HoleEdgeX = "left" | "right";
/** Back is the top edge of the piece in the drawings (wall side); front is the bottom edge. */
export type HoleEdgeY = "front" | "back";
export type Piece = {
  id: string;
  name: string;
  slab: string;
  w: number;
  h: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
  az?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  /** Legacy 90° turn on the slab; superseded by `slabAngle` when that is set. */
  rot: boolean;
  /** Rotation on the slab in degrees (clockwise on screen), any angle. */
  slabAngle?: number;
  cutAngle?: CutAngle;
  holeW: number;
  holeH: number;
  /** Legacy: opening offset from the piece centre. Used only when holeDX/holeDY are unset. */
  holeX?: number;
  holeY?: number;
  /** Opening position: distance (mm) from the chosen piece edge to the opening's edge. */
  holeEdgeX?: HoleEdgeX;
  holeDX?: number;
  holeEdgeY?: HoleEdgeY;
  holeDY?: number;
  /** Opening shape: rectangular (default), rounded corners, or round/oval. */
  holeKind?: HoleKind;
  /** Corner radius for a rounded opening (mm). */
  holeR?: number;
  /** Piece shape inside its w × h box; undefined = plain rectangle. */
  shape?: PieceShape;
  /** Per-side edge cut: straight, or 45° mitre below / above. */
  edges?: EdgeCuts;
  /** Per-side edge finish (polished, bullnose…), used for drawings and quotes. */
  finishes?: EdgeFinishes;
  /** Openings (sinks, tap holes, hobs…). Replaces the legacy single opening. */
  openings?: Opening[];
  color: string;
};
export type Defect = {
  id: string;
  slab: string;
  x: number;
  y: number;
  w: number;
  h: number;
  points?: { x: number; y: number }[];
  brush?: number;
};
export type Project = {
  id: string;
  name: string;
  slabs: Slab[];
  pieces: Piece[];
  defects: Defect[];
  kerf: number;
  margin: number;
  /** Prices for the quote (optional). */
  pricing?: Pricing;
};
export const colors = ["#bde96e", "#65cbd5", "#ddaeec", "#f2be70", "#95aafa"];
export function demo(): Project {
  return {
    id: "",
    name: "Kitchen study · 01",
    slabs: [
      {
        id: "s1",
        name: "Arabescato · demo slab",
        w: 3200,
        h: 2000,
        thickness: 20,
        image: "/demo-slab.png",
      },
    ],
    pieces: [
      {
        id: "p1",
        name: "Island top",
        slab: "s1",
        w: 1800,
        h: 850,
        x: 40,
        y: 40,
        ax: 0,
        ay: 0,
        rot: false,
        cutAngle: 0,
        holeW: 0,
        holeH: 0,
        color: colors[0],
      },
      {
        id: "p2",
        name: "Backsplash",
        slab: "s1",
        w: 1800,
        h: 400,
        x: 40,
        y: 898,
        ax: 0,
        ay: 858,
        rot: false,
        cutAngle: 0,
        holeW: 0,
        holeH: 0,
        color: colors[1],
      },
      {
        id: "p3",
        name: "Sink counter",
        slab: "s1",
        w: 1800,
        h: 620,
        x: 40,
        y: 1306,
        ax: 0,
        ay: 1266,
        rot: false,
        cutAngle: 0,
        holeW: 500,
        holeH: 380,
        color: colors[2],
      },
    ],
    defects: [],
    kerf: 4,
    margin: 20,
  };
}
/**
 * The project the studio opens with (lib/default-project.json): the
 * "Kitchen study · 01" setup. Returns a fresh copy so edits never change it.
 */
export function defaultProject(): Project {
  const p = structuredClone(DEFAULT_PROJECT) as unknown;
  if (!validProject(p)) return demo();
  p.id = "";
  return p;
}

export const pieceAngle = (p: Piece) => p.cutAngle ?? 0;

/** Default crop that fills the slab rectangle with the photo (center crop, no stretching). */
export function fitPhotoCrop(slab: Slab): PhotoCrop {
  const sourceAspect = (slab.photoWidth ?? slab.w) / (slab.photoHeight ?? slab.h);
  const slabAspect = slab.w / slab.h;
  if (sourceAspect > slabAspect) {
    const w = slabAspect / sourceAspect;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = sourceAspect / slabAspect;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

function cropFromCalibration(slab: Slab): PhotoCrop | undefined {
  const q = slab.calibration;
  if (!q) return undefined;
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x],
    ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const x = Math.max(0, Math.min(...xs)),
    y = Math.max(0, Math.min(...ys));
  const right = Math.min(1, Math.max(...xs)),
    bottom = Math.min(1, Math.max(...ys));
  return { x, y, w: Math.max(0.02, right - x), h: Math.max(0.02, bottom - y) };
}

/**
 * The part of the photo (normalized 0..1) that represents the slab.
 * Every view (slab layout, 2D assembly, 3D assembly) must use this so the
 * veins shown on a placed piece match the finished preview.
 */
export function slabCrop(slab: Slab): PhotoCrop {
  return cropFromCalibration(slab) ?? slab.crop ?? fitPhotoCrop(slab);
}

/** Geometry for drawing the slab photo in slab millimetre coordinates. */
export function slabImageRect(slab: Slab) {
  const c = slabCrop(slab);
  return {
    x: (-c.x * slab.w) / c.w,
    y: (-c.y * slab.h) / c.h,
    w: slab.w / c.w,
    h: slab.h / c.h,
  };
}
/** The piece's rotation on the slab in degrees, normalised to (-180, 180]. */
export function slabAngleOf(p: Pick<Piece, "rot" | "slabAngle">) {
  const a = p.slabAngle ?? (p.rot ? 90 : 0);
  const n = ((((a + 180) % 360) + 360) % 360) - 180;
  return n === -180 ? 180 : Math.round(n * 100) / 100;
}

/** cos/sin with exact values at multiples of 90° (no 6e-17 noise in sizes). */
function trig(deg: number) {
  const q = ((Math.round(deg) % 360) + 360) % 360;
  if (Math.abs(deg - Math.round(deg)) < 1e-9 && q % 90 === 0)
    return { c: [1, 0, -1, 0][q / 90], s: [0, 1, 0, -1][q / 90] };
  const r = (deg * Math.PI) / 180;
  return { c: Math.cos(r), s: Math.sin(r) };
}

/**
 * How a piece sits on its slab: the outline is rotated by the slab angle and
 * (x, y) is the top-left corner of the rotated outline's bounding box (the
 * footprint). At 90° this matches the legacy `rot` placement exactly.
 */
export function placement(p: Piece) {
  const { c, s } = trig(slabAngleOf(p));
  const turn = (q: Pt) => ({ x: q.x * c - q.y * s, y: q.x * s + q.y * c });
  const pts = pieceOutline(p).map(turn);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of pts) {
    minX = Math.min(minX, q.x); minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x); maxY = Math.max(maxY, q.y);
  }
  const clean = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    cos: c,
    sin: s,
    w: clean(maxX - minX),
    h: clean(maxY - minY),
    /** Piece-local point → footprint coordinates (relative to p.x, p.y). */
    local: (q: Pt) => {
      const k = turn(q);
      return { x: k.x - minX, y: k.y - minY };
    },
    /** Piece-local point → slab millimetres. */
    slab: (q: Pt) => {
      const k = turn(q);
      return { x: p.x + k.x - minX, y: p.y + k.y - minY };
    },
    /** Translation of the piece origin on the slab (slab = origin + R·q). */
    origin: { x: p.x - minX, y: p.y - minY },
  };
}

/** Size of the piece's rotated bounding box on the slab. */
export const footprint = (p: Piece) => {
  const m = placement(p);
  return { w: m.w, h: m.h };
};

/**
 * Rotate a piece on the slab to `angle` degrees, keeping the centre of its
 * footprint in place. Returns the values to patch.
 */
export function rotateOnSlab(p: Piece, angle: number): Partial<Piece> {
  const before = footprint(p);
  const next = { ...p, slabAngle: angle, rot: false };
  const after = footprint(next);
  return {
    slabAngle: slabAngleOf(next),
    rot: false,
    x: Math.round((p.x + before.w / 2 - after.w / 2) * 10) / 10,
    y: Math.round((p.y + before.h / 2 - after.h / 2) * 10) / 10,
  };
}

export function opening(p: Piece) {
  const x =
      p.holeDX !== undefined
        ? p.holeEdgeX === "right"
          ? p.w - p.holeDX - p.holeW
          : p.holeDX
        : (p.w - p.holeW) / 2 + (p.holeX ?? 0),
    y =
      p.holeDY !== undefined
        ? p.holeEdgeY === "back"
          ? p.holeDY
          : p.h - p.holeDY - p.holeH
        : (p.h - p.holeH) / 2 + (p.holeY ?? 0);
  return { x, y, w: p.holeW, h: p.holeH };
}
/** Space the magnetic snap leaves between neighbouring pieces on a slab. */
export const SNAP_GAP = 4;
/** Gap actually used: never less than the saw blade, so snapped pieces pass checks. */
export const pieceGap = (pr: Project) => Math.max(SNAP_GAP, pr.kerf);

/**
 * First free position for a w × h footprint on a slab, keeping the edge trim
 * and the piece gap. Candidate corners come from the slab margin and the
 * right/bottom edges of existing pieces (bottom-left packing), scanned
 * top-to-bottom, left-to-right. Returns null when nothing fits.
 */
export function findFreeSpot(
  pr: Project,
  slabId: string,
  w: number,
  h: number,
  ignoreId?: string,
): { x: number; y: number } | null {
  const slab = pr.slabs.find((s) => s.id === slabId);
  if (!slab) return null;
  const gap = pieceGap(pr);
  const others = pr.pieces
    .filter((p) => p.slab === slabId && p.id !== ignoreId)
    .map((p) => ({ x: p.x, y: p.y, ...footprint(p) }));
  const blocked = pr.defects.filter((d) => d.slab === slabId);
  const xs = [pr.margin, ...others.map((o) => o.x + o.w + gap)],
    ys = [pr.margin, ...others.map((o) => o.y + o.h + gap)];
  const fits = (x: number, y: number) =>
    x + w <= slab.w - pr.margin &&
    y + h <= slab.h - pr.margin &&
    others.every(
      (o) => x + w + gap <= o.x || o.x + o.w + gap <= x || y + h + gap <= o.y || o.y + o.h + gap <= y,
    ) &&
    blocked.every((d) => x + w <= d.x || d.x + d.w <= x || y + h <= d.y || d.y + d.h <= y);
  for (const y of [...new Set(ys)].sort((a, b) => a - b))
    for (const x of [...new Set(xs)].sort((a, b) => a - b)) if (fits(x, y)) return { x, y };
  return null;
}

/**
 * Remove a slab and its defect marks. Its pieces move to the first remaining
 * slab, each into a free spot, keeping the original piece order. Returns the
 * project unchanged if it is the only slab.
 */
export function removeSlab(pr: Project, slabId: string): Project {
  const dest = pr.slabs.find((s) => s.id !== slabId);
  if (!dest) return pr;
  let next: Project = {
    ...pr,
    slabs: pr.slabs.filter((s) => s.id !== slabId),
    defects: pr.defects.filter((d) => d.slab !== slabId),
    pieces: pr.pieces.filter((q) => q.slab !== slabId),
  };
  for (const q of pr.pieces.filter((q) => q.slab === slabId)) {
    const f = footprint(q);
    const spot = findFreeSpot(next, dest.id, f.w, f.h) ?? { x: next.margin, y: next.margin };
    next = { ...next, pieces: [...next.pieces, { ...q, slab: dest.id, ...spot }] };
  }
  const order = new Map(pr.pieces.map((q, i) => [q.id, i]));
  next.pieces.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return next;
}

/**
 * A check result. `placement` issues (overlap, saw gap, slab edge, defects)
 * can be fixed by moving pieces; `opening` issues need the piece edited.
 */
export type Issue = { id: string; related?: string; text: string; kind?: "placement" | "opening" };
/** True when a placement issue involves the given piece. */
export const hasIssue = (list: Issue[], id: string) =>
  list.some((w) => w.id === id || w.related === id);
/**
 * The opening's position as edge distances, for display and editing. Works
 * for legacy centre offsets too (edges default to left / front).
 */
export function holeDistances(p: Piece) {
  const o = opening(p);
  const edgeX: HoleEdgeX = p.holeEdgeX ?? "left",
    edgeY: HoleEdgeY = p.holeEdgeY ?? "front";
  return {
    edgeX,
    dx: Math.round((edgeX === "right" ? p.w - o.x - o.w : o.x) * 10) / 10,
    edgeY,
    dy: Math.round((edgeY === "back" ? o.y : p.h - o.y - o.h) * 10) / 10,
  };
}

/** Patch that sets the opening's distance and/or edge, keeping the other axis in place. */
export function setHoleDistance(
  p: Piece,
  change: { edgeX?: HoleEdgeX; dx?: number; edgeY?: HoleEdgeY; dy?: number },
): Partial<Piece> {
  const d = holeDistances(p);
  const o = opening(p);
  const edgeX = change.edgeX ?? d.edgeX,
    edgeY = change.edgeY ?? d.edgeY;
  // Switching edge keeps the opening where it is, so recompute the distance.
  const dx = change.dx ?? (edgeX === "right" ? p.w - o.x - o.w : o.x);
  const dy = change.dy ?? (edgeY === "back" ? o.y : p.h - o.y - o.h);
  const clean = (n: number) => Math.round(n * 10) / 10;
  return {
    holeEdgeX: edgeX,
    holeDX: clean(dx),
    holeEdgeY: edgeY,
    holeDY: clean(dy),
    holeX: undefined,
    holeY: undefined,
  };
}

/** Move the opening in piece coordinates (+x right, +y towards the front). */
export function nudgeHole(p: Piece, dx: number, dy: number): Partial<Piece> {
  const d = holeDistances(p);
  return setHoleDistance(p, {
    dx: Math.max(0, d.dx + (d.edgeX === "right" ? -dx : dx)),
    dy: Math.max(0, d.dy + (d.edgeY === "back" ? dy : -dy)),
  });
}

/**
 * The piece's openings. Pieces saved with the legacy single opening
 * (holeW/holeH and its position fields) read as a one-item list.
 */
export function openingsOf(p: Piece): Opening[] {
  if (p.openings) return p.openings;
  if (!(p.holeW > 0 && p.holeH > 0)) return [];
  const d = holeDistances(p);
  return [{ id: "opening-1", w: p.holeW, h: p.holeH, kind: p.holeKind, r: p.holeR, edgeX: d.edgeX, dx: d.dx, edgeY: d.edgeY, dy: d.dy }];
}

/** Box of an opening in piece-local mm. */
export function openingBox(p: Pick<Piece, "w" | "h">, o: Opening) {
  return {
    x: o.edgeX === "right" ? p.w - o.dx - o.w : o.dx,
    y: o.edgeY === "back" ? o.dy : p.h - o.dy - o.h,
    w: o.w,
    h: o.h,
  };
}

/** Patch that stores a new opening list and clears the legacy fields. */
export function setOpenings(list: Opening[]): Partial<Piece> {
  return {
    openings: list,
    holeW: 0,
    holeH: 0,
    holeX: undefined,
    holeY: undefined,
    holeDX: undefined,
    holeDY: undefined,
    holeEdgeX: undefined,
    holeEdgeY: undefined,
    holeKind: undefined,
    holeR: undefined,
  };
}

/** Outlines of all openings in piece-local mm. */
export function pieceHoles(p: Piece): Pt[][] {
  return openingsOf(p)
    .filter((o) => o.w > 0 && o.h > 0)
    .map((o) => holeOutline(openingBox(p, o), o.kind, o.r ?? 0));
}

/** Finished stone area of a piece in mm² (shape minus openings). */
export function pieceArea(p: Piece) {
  return Math.max(0, area(pieceOutline(p)) - pieceHoles(p).reduce((a, h) => a + area(h), 0));
}

/** Piece outline in slab millimetres (position and rotation applied). */
export function outlineOnSlab(p: Piece): Pt[] {
  const m = placement(p);
  return pieceOutline(p).map(m.slab);
}

/**
 * Placement checks. Pieces are compared by their real outlines (circles,
 * arches, curves, free forms), not their bounding boxes.
 */
export function issues(pr: Project): Issue[] {
  const out: Issue[] = [];
  const outlines = new Map(pr.pieces.map((p) => [p.id, outlineOnSlab(p)]));
  for (const p of pr.pieces) {
    const s = pr.slabs.find((s) => s.id === p.slab);
    const b = footprint(p);
    if (!s) continue;
    if (
      p.x < pr.margin ||
      p.y < pr.margin ||
      p.x + b.w > s.w - pr.margin ||
      p.y + b.h > s.h - pr.margin
    )
      out.push({ id: p.id, kind: "placement", text: p.name + ": outside usable slab edge" });
    if (p.holeW > 0 !== p.holeH > 0)
      out.push({ id: p.id, kind: "opening", text: p.name + ": invalid opening dimensions" });
    const shape = pieceOutline(p);
    const holes = openingsOf(p).map((o) => ({ o, pts: holeOutline(openingBox(p, o), o.kind, o.r ?? 0) }));
    holes.forEach(({ o, pts }, n) => {
      const name = `${p.name}: ${o.label || `opening ${n + 1}`}`;
      if (!(o.w > 0 && o.h > 0) || o.w >= p.w || o.h >= p.h) out.push({ id: p.id, kind: "opening", text: name + " has invalid dimensions" });
      else if (!containsPolygon(shape, pts)) out.push({ id: p.id, kind: "opening", text: name + " extends outside the piece" });
      // Openings need the saw gap between them, too.
      for (let k = n + 1; k < holes.length; k++)
        if (tooClose(pts, holes[k].pts, pr.kerf))
          out.push({ id: p.id, kind: "opening", text: `${name} is too close to ${holes[k].o.label || `opening ${k + 1}`}` });
    });
    const mine = outlines.get(p.id)!;
    for (const q of pr.pieces) {
      if (q.id <= p.id || q.slab !== p.slab) continue;
      if (tooClose(mine, outlines.get(q.id)!, pr.kerf)) {
        const text = p.name + " / " + q.name + ": overlap or insufficient blade gap";
        out.push({ id: p.id, related: q.id, kind: "placement", text });
      }
    }
    for (const d of pr.defects.filter((d) => d.slab === p.slab)) {
      if (tooClose(mine, roundedRect(d.w, d.h, undefined, d.x, d.y), 0))
        out.push({ id: p.id, kind: "placement", text: p.name + ": intersects a marked defect" });
    }
  }
  return out;
}
// ---------------------------------------------------------------- validation
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const optNum = (n: unknown, min: number, max: number) => n === undefined || num(n, min, max);
const oneOf = (v: unknown, options: readonly unknown[]) => options.includes(v);
const PHOTO = /^\/(demo-slab\.png|api\/images\?id=[a-zA-Z0-9-]+)$/;
const isPhoto = (v: unknown) => typeof v === "string" && PHOTO.test(v);
const isCrop = (c: unknown, min: number, max: number) =>
  isObj(c) && [c.x, c.y, c.w, c.h].every((n) => num(n, min, max)) && (c.w as number) > 0 && (c.h as number) > 0;
const isPt = (p: unknown, min: number, max: number) => isObj(p) && num(p.x, min, max) && num(p.y, min, max);

function validSlab(s: unknown) {
  if (!isObj(s)) return false;
  const edit = s.edit, adj = s.adjustments, cal = s.calibration;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    isPhoto(s.image) &&
    [s.w, s.h, s.thickness].every((n) => num(n, 1e-9, 20000)) &&
    optNum(s.photoWidth, 0, 1e6) &&
    optNum(s.photoHeight, 0, 1e6) &&
    (s.crop === undefined || isCrop(s.crop, 0, 1)) &&
    (cal === undefined || (isObj(cal) && [cal.tl, cal.tr, cal.br, cal.bl].every((q) => isPt(q, 0, 1)))) &&
    (edit === undefined ||
      (isObj(edit) &&
        isPhoto(edit.source) &&
        [edit.straighten, edit.vertical, edit.horizontal].every((n) => num(n, -EDIT_LIMIT, EDIT_LIMIT)) &&
        isCrop(edit.crop, -10, 10))) &&
    (adj === undefined || (isObj(adj) && [adj.straighten, adj.perspectiveV, adj.perspectiveH].every((n) => num(n, -45, 45)))) &&
    (s.mirror === undefined || typeof s.mirror === "boolean")
  );
}

function validPiece(q: unknown, slabIds: Set<unknown>) {
  if (!isObj(q)) return false;
  return (
    typeof q.id === "string" &&
    typeof q.name === "string" &&
    slabIds.has(q.slab) &&
    [q.w, q.h].every((n) => num(n, 1e-9, 20000)) &&
    [q.ax, q.ay, q.holeW, q.holeH].every((n) => num(n, 0, 50000)) &&
    // A rotated piece may overhang the slab edge (flagged by the checks).
    [q.x, q.y].every((n) => num(n, -20000, 50000)) &&
    [q.holeX, q.holeY].every((n) => optNum(n, -20000, 20000)) &&
    validShape(q.shape) &&
    validEdges(q.edges) &&
    (q.holeKind === undefined || oneOf(q.holeKind, ["rect", "rounded", "ellipse"])) &&
    optNum(q.holeR, 0, 5000) &&
    (q.holeEdgeX === undefined || oneOf(q.holeEdgeX, ["left", "right"])) &&
    (q.holeEdgeY === undefined || oneOf(q.holeEdgeY, ["front", "back"])) &&
    [q.holeDX, q.holeDY].every((n) => optNum(n, -20000, 20000)) &&
    (q.openings === undefined || (Array.isArray(q.openings) && q.openings.length <= 20 && q.openings.every(validOpening))) &&
    (q.finishes === undefined || validFinishes(q.finishes)) &&
    optNum(q.az, 0, 50000) &&
    [q.rx, q.ry, q.rz].every((n) => optNum(n, -360, 360)) &&
    typeof q.rot === "boolean" &&
    optNum(q.slabAngle, -360, 360) &&
    (q.cutAngle === undefined || oneOf(q.cutAngle, [0, 45])) &&
    typeof q.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(q.color)
  );
}

function validDefect(d: unknown, slabIds: Set<unknown>) {
  if (!isObj(d)) return false;
  return (
    typeof d.id === "string" &&
    slabIds.has(d.slab) &&
    [d.x, d.y, d.w, d.h].every((n) => num(n, 0, 20000)) &&
    (d.points === undefined ||
      (Array.isArray(d.points) && d.points.length >= 2 && d.points.every((pt) => isPt(pt, -1e6, 1e6)))) &&
    optNum(d.brush, 1e-9, 1000)
  );
}

function validOpening(o: unknown) {
  return (
    isObj(o) &&
    typeof o.id === "string" &&
    (o.label === undefined || (typeof o.label === "string" && o.label.length <= 40)) &&
    num(o.w, 0, 20000) &&
    num(o.h, 0, 20000) &&
    (o.kind === undefined || oneOf(o.kind, ["rect", "rounded", "ellipse"])) &&
    optNum(o.r, 0, 5000) &&
    oneOf(o.edgeX, ["left", "right"]) &&
    oneOf(o.edgeY, ["front", "back"]) &&
    num(o.dx, -20000, 20000) &&
    num(o.dy, -20000, 20000)
  );
}

/** Checks untrusted project JSON (saved files, backups, API input). */
export function validProject(input: unknown): input is Project {
  if (!isObj(input)) return false;
  const p = input;
  if (typeof p.name !== "string" || p.name.length > 150) return false;
  if (!Array.isArray(p.slabs) || !p.slabs.length || p.slabs.length > 30) return false;
  if (!Array.isArray(p.pieces) || p.pieces.length > 100) return false;
  if (!Array.isArray(p.defects) || p.defects.length > 100) return false;
  if (![p.kerf, p.margin].every((n) => num(n, 0, 500))) return false;
  if (!validPricing(p.pricing)) return false;
  if (!p.slabs.every(validSlab)) return false;
  const slabIds = new Set(p.slabs.map((s: Obj) => s.id));
  return p.pieces.every((q) => validPiece(q, slabIds)) && p.defects.every((d) => validDefect(d, slabIds));
}
