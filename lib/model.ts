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
  rot: boolean;
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
export const footprint = (p: Piece) => ({
  w: p.rot ? p.h : p.w,
  h: p.rot ? p.w : p.h,
});
export function opening(p: Piece, onSlab = false) {
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
  if (!onSlab) return { x, y, w: p.holeW, h: p.holeH };
  return p.rot
    ? { x: p.x + p.h - y - p.holeH, y: p.y + x, w: p.holeH, h: p.holeW }
    : { x: p.x + x, y: p.y + y, w: p.holeW, h: p.holeH };
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

export function issues(pr: Project): Issue[] {
  const out: Issue[] = [];
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
    const hole = opening(p);
    if (
      p.holeW > 0 &&
      p.holeH > 0 &&
      (hole.x < 0 ||
        hole.y < 0 ||
        hole.x + hole.w > p.w ||
        hole.y + hole.h > p.h)
    )
      out.push({ id: p.id, text: p.name + ": opening extends outside piece" });
    for (const q of pr.pieces) {
      if (q.id <= p.id || q.slab !== p.slab) continue;
      const c = footprint(q);
      if (
        p.x < q.x + c.w + pr.kerf &&
        p.x + b.w + pr.kerf > q.x &&
        p.y < q.y + c.h + pr.kerf &&
        p.y + b.h + pr.kerf > q.y
      ) {
        const text = p.name + " / " + q.name + ": overlap or insufficient blade gap";
        out.push({ id: p.id, related: q.id, text });
      }
    }
    for (const d of pr.defects.filter((d) => d.slab === p.slab)) {
      if (
        p.x < d.x + d.w &&
        p.x + b.w > d.x &&
        p.y < d.y + d.h &&
        p.y + b.h > d.y
      )
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
        [q.x, q.y, q.ax, q.ay, q.holeW, q.holeH].every(
          (n) => Number.isFinite(n) && n >= 0 && n <= 50000,
        ) &&
        [q.holeX, q.holeY].every(
          (n) =>
            n === undefined || (Number.isFinite(n) && Math.abs(n) <= 20000),
        ) &&
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
