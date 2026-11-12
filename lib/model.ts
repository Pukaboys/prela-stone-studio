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
  edit?: PhotoEdit;
};
export type CutAngle = 0 | 45;
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

export type Issue = { id: string; related?: string; text: string };
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

/** Opening outline in piece-local mm, or null for a solid piece. */
export function pieceHole(p: Piece): Pt[] | null {
  if (!(p.holeW > 0 && p.holeH > 0)) return null;
  return holeOutline(opening(p), p.holeKind, p.holeR ?? 0);
}

/** Finished stone area of a piece in mm² (shape minus opening). */
export function pieceArea(p: Piece) {
  const hole = pieceHole(p);
  return Math.max(0, area(pieceOutline(p)) - (hole ? area(hole) : 0));
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
      out.push({ id: p.id, text: p.name + ": outside usable slab edge" });
    if (p.holeW > 0 !== p.holeH > 0 || p.holeW >= p.w || p.holeH >= p.h)
      out.push({ id: p.id, text: p.name + ": invalid opening dimensions" });
    const hole = pieceHole(p);
    if (hole && !containsPolygon(pieceOutline(p), hole))
      out.push({ id: p.id, text: p.name + ": opening extends outside piece" });
    const mine = outlines.get(p.id)!;
    for (const q of pr.pieces) {
      if (q.id <= p.id || q.slab !== p.slab) continue;
      if (tooClose(mine, outlines.get(q.id)!, pr.kerf)) {
        const text = p.name + " / " + q.name + ": overlap or insufficient blade gap";
        out.push({ id: p.id, related: q.id, text });
      }
    }
    for (const d of pr.defects.filter((d) => d.slab === p.slab)) {
      if (tooClose(mine, roundedRect(d.w, d.h, undefined, d.x, d.y), 0))
        out.push({ id: p.id, text: p.name + ": intersects a marked defect" });
    }
  }
  return out;
}
export function validProject(p: any): p is Project {
  return (
    !!p &&
    typeof p.name === "string" &&
    p.name.length <= 150 &&
    Array.isArray(p.slabs) &&
    p.slabs.length <= 30 &&
    p.slabs.length > 0 &&
    Array.isArray(p.pieces) &&
    p.pieces.length <= 100 &&
    Array.isArray(p.defects) &&
    p.defects.length <= 100 &&
    [p.kerf, p.margin].every((n) => Number.isFinite(n) && n >= 0 && n <= 500) &&
    p.slabs.every(
      (s: any) =>
        typeof s.id === "string" &&
        typeof s.name === "string" &&
        typeof s.image === "string" &&
        /^\/(demo-slab\.png|api\/images\?id=[a-zA-Z0-9-]+)$/.test(s.image) &&
        [s.w, s.h, s.thickness].every(
          (n) => Number.isFinite(n) && n > 0 && n <= 20000,
        ) &&
        (s.photoWidth === undefined || Number.isFinite(s.photoWidth)) &&
        (s.photoHeight === undefined || Number.isFinite(s.photoHeight)) &&
        (s.crop === undefined || [s.crop.x, s.crop.y, s.crop.w, s.crop.h].every((n: number) => Number.isFinite(n) && n >= 0 && n <= 1) && s.crop.w > 0 && s.crop.h > 0) &&
        (s.calibration === undefined || [s.calibration.tl, s.calibration.tr, s.calibration.br, s.calibration.bl].every((p: { x: number; y: number }) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) &&
        (s.edit === undefined ||
          (typeof s.edit === "object" &&
            typeof s.edit.source === "string" &&
            /^\/(demo-slab\.png|api\/images\?id=[a-zA-Z0-9-]+)$/.test(s.edit.source) &&
            [s.edit.straighten, s.edit.vertical, s.edit.horizontal].every(
              (n: number) => Number.isFinite(n) && Math.abs(n) <= EDIT_LIMIT,
            ) &&
            !!s.edit.crop &&
            [s.edit.crop.x, s.edit.crop.y, s.edit.crop.w, s.edit.crop.h].every(
              (n: number) => Number.isFinite(n) && Math.abs(n) <= 10,
            ) &&
            s.edit.crop.w > 0 &&
            s.edit.crop.h > 0)) &&
        (s.adjustments === undefined || [s.adjustments.straighten, s.adjustments.perspectiveV, s.adjustments.perspectiveH].every((n: number) => Number.isFinite(n) && Math.abs(n) <= 45)),
    ) &&
    p.pieces.every(
      (q: any) =>
        typeof q.id === "string" &&
        typeof q.name === "string" &&
        p.slabs.some((s: any) => s.id === q.slab) &&
        [q.w, q.h].every((n) => Number.isFinite(n) && n > 0 && n <= 20000) &&
        [q.ax, q.ay, q.holeW, q.holeH].every(
          (n) => Number.isFinite(n) && n >= 0 && n <= 50000,
        ) &&
        // A rotated piece may overhang the slab edge (flagged by the checks).
        [q.x, q.y].every((n) => Number.isFinite(n) && n >= -20000 && n <= 50000) &&
        [q.holeX, q.holeY].every(
          (n) =>
            n === undefined || (Number.isFinite(n) && Math.abs(n) <= 20000),
        ) &&
        validShape(q.shape) &&
        (q.holeKind === undefined || ["rect", "rounded", "ellipse"].includes(q.holeKind)) &&
        (q.holeR === undefined || (Number.isFinite(q.holeR) && q.holeR >= 0 && q.holeR <= 5000)) &&
        (q.holeEdgeX === undefined || q.holeEdgeX === "left" || q.holeEdgeX === "right") &&
        (q.holeEdgeY === undefined || q.holeEdgeY === "front" || q.holeEdgeY === "back") &&
        [q.holeDX, q.holeDY].every(
          (n) => n === undefined || (Number.isFinite(n) && n >= -20000 && n <= 20000),
        ) &&
        (q.az === undefined ||
          (Number.isFinite(q.az) && q.az >= 0 && q.az <= 50000)) &&
        [q.rx, q.ry, q.rz].every(
          (n) => n === undefined || (Number.isFinite(n) && Math.abs(n) <= 360),
        ) &&
        typeof q.rot === "boolean" &&
        (q.slabAngle === undefined || (Number.isFinite(q.slabAngle) && Math.abs(q.slabAngle) <= 360)) &&
        (q.cutAngle === undefined || [0, 45].includes(q.cutAngle)) &&
        /^#[0-9a-f]{6}$/i.test(q.color),
    ) &&
    p.defects.every(
      (d: any) =>
        typeof d.id === "string" &&
        p.slabs.some((s: any) => s.id === d.slab) &&
        [d.x, d.y, d.w, d.h].every(
          (n) => Number.isFinite(n) && n >= 0 && n <= 20000,
        ) &&
        (d.points === undefined || (Array.isArray(d.points) && d.points.length >= 2 && d.points.every((point: any) => Number.isFinite(point.x) && Number.isFinite(point.y)))) &&
        (d.brush === undefined || (Number.isFinite(d.brush) && d.brush > 0 && d.brush <= 1000)),
    )
  );
}
