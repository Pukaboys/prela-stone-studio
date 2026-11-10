export type PhotoCrop = { x: number; y: number; w: number; h: number };
export type PhotoQuad = {
  tl: { x: number; y: number };
  tr: { x: number; y: number };
  br: { x: number; y: number };
  bl: { x: number; y: number };
};
export type PhotoAdjustments = { straighten: number; perspectiveV: number; perspectiveH: number };
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
};
export type CutAngle = 0 | 45;
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
  holeX?: number;
  holeY?: number;
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
export const footprint = (p: Piece) => ({
  w: p.rot ? p.h : p.w,
  h: p.rot ? p.w : p.h,
});
export function opening(p: Piece, onSlab = false) {
  const x = (p.w - p.holeW) / 2 + (p.holeX ?? 0),
    y = (p.h - p.holeH) / 2 + (p.holeY ?? 0);
  if (!onSlab) return { x, y, w: p.holeW, h: p.holeH };
  return p.rot
    ? { x: p.x + p.h - y - p.holeH, y: p.y + x, w: p.holeH, h: p.holeW }
    : { x: p.x + x, y: p.y + y, w: p.holeW, h: p.holeH };
}
export function issues(pr: Project) {
  const out: { id: string; text: string }[] = [];
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
      )
        out.push({
          id: p.id,
          text: p.name + " / " + q.name + ": overlap or insufficient blade gap",
        });
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
