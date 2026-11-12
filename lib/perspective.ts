/**
 * Perspective correction for slab photos taken at an angle.
 *
 * detectQuad   finds the slab's four corners in a photo (document-scanner
 *              style): edge gradients → Hough lines → the best quadrilateral
 *              of two roughly horizontal and two roughly vertical lines,
 *              scored by how much edge runs along its sides.
 * squareToQuad maps the unit square onto any quadrilateral (projective), so
 *              the corrected photo can be drawn point by point.
 */
import type { RawImage } from "@/lib/trace";

export type Pt = { x: number; y: number };
export type Quad = { tl: Pt; tr: Pt; br: Pt; bl: Pt };

/** Projective map of the unit square (u, v ∈ 0..1) onto the quad (Heckbert). */
export function squareToQuad(q: Quad): (u: number, v: number) => Pt {
  const { tl: p0, tr: p1, br: p2, bl: p3 } = q;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
    g = 0; h = 0;
  } else {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

/** A sensible starting frame when nothing is detected. */
export const DEFAULT_QUAD: Quad = { tl: { x: 0.08, y: 0.1 }, tr: { x: 0.92, y: 0.1 }, br: { x: 0.92, y: 0.9 }, bl: { x: 0.08, y: 0.9 } };

const area = (q: Pt[]) => {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i], r = q[(i + 1) % q.length];
    s += p.x * r.y - r.x * p.y;
  }
  return Math.abs(s) / 2;
};
const convex = (q: Pt[]) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
};

type Line = { theta: number; rho: number; votes: number };
const intersect = (a: Line, b: Line): Pt | null => {
  const ca = Math.cos(a.theta), sa = Math.sin(a.theta), cb = Math.cos(b.theta), sb = Math.sin(b.theta);
  const det = ca * sb - sa * cb;
  if (Math.abs(det) < 1e-6) return null;
  return { x: (a.rho * sb - b.rho * sa) / det, y: (ca * b.rho - cb * a.rho) / det };
};

/**
 * Find the slab outline in a photo. Returns corners normalised to 0..1 of
 * the image (they may lie slightly outside when the slab is cut off by the
 * frame), with a 0..1 confidence; null when no convincing outline is found.
 */
export function detectQuad(img: RawImage): { quad: Quad; confidence: number } | null {
  // 1. Work on a small copy.
  const scale = Math.min(1, 420 / Math.max(img.width, img.height));
  const W = Math.max(8, Math.round(img.width * scale)), H = Math.max(8, Math.round(img.height * scale));
  const gray = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale)), sy = Math.min(img.height - 1, Math.floor(y / scale));
      const i = (sy * img.width + sx) * 4;
      gray[y * W + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    }
  // 2. Blur (two box passes) to suppress fine veining.
  const blur = (src: Float32Array) => {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), r = 2;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += src[y * W + xx]; n++; } }
        tmp[y * W + x] = s / n;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += tmp[yy * W + x]; n++; } }
        out[y * W + x] = s / n;
      }
    return out;
  };
  const g = blur(blur(gray));
  // 3. Sobel gradients.
  const mag = new Float32Array(W * H), dir = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = (xx: number, yy: number) => g[yy * W + xx];
      const gx = p(x + 1, y - 1) + 2 * p(x + 1, y) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x - 1, y) - p(x - 1, y + 1);
      const gy = p(x - 1, y + 1) + 2 * p(x, y + 1) + p(x + 1, y + 1) - p(x - 1, y - 1) - 2 * p(x, y - 1) - p(x + 1, y - 1);
      mag[y * W + x] = Math.hypot(gx, gy);
      dir[y * W + x] = Math.atan2(gy, gx);
    }
  const sorted = Float32Array.from(mag).sort();
  const thresh = Math.max(8, sorted[Math.floor(sorted.length * 0.88)]);
  // 4. Hough transform, voting only near each pixel's gradient direction.
  const T = 180, diag = Math.ceil(Math.hypot(W, H)), R = diag * 2 + 1;
  const acc = new Float32Array(T * R);
  const cos = new Float32Array(T), sin = new Float32Array(T);
  for (let t = 0; t < T; t++) { cos[t] = Math.cos((t * Math.PI) / T); sin[t] = Math.sin((t * Math.PI) / T); }
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const m = mag[y * W + x];
      if (m < thresh) continue;
      const t0 = Math.round(((dir[y * W + x] % Math.PI) + Math.PI) % Math.PI / Math.PI * T);
      for (let k = -6; k <= 6; k++) {
        const t = (((t0 + k) % T) + T) % T;
        const rho = Math.round(x * cos[t] + y * sin[t]) + diag;
        acc[t * R + rho] += m;
      }
    }
  // 5. Strongest separated lines.
  const lines: Line[] = [];
  const idx = Array.from(acc.keys()).filter((i) => acc[i] > 0).sort((a, b) => acc[b] - acc[a]);
  for (const i of idx) {
    if (lines.length >= 40) break;
    const t = Math.floor(i / R), rho = (i % R) - diag;
    const theta = (t * Math.PI) / T;
    if (lines.some((l) => {
      let dt = Math.abs(l.theta - theta);
      dt = Math.min(dt, Math.PI - dt);
      return dt < (8 * Math.PI) / 180 && Math.abs(Math.abs(l.rho) - Math.abs(rho)) < 12;
    })) continue;
    lines.push({ theta, rho, votes: acc[i] });
  }
  // Normal near 90° → horizontal-ish line; near 0°/180° → vertical-ish.
  const deg = (l: Line) => (l.theta * 180) / Math.PI;
  const horiz = lines.filter((l) => Math.abs(deg(l) - 90) < 35).slice(0, 12);
  const vert = lines.filter((l) => deg(l) < 40 || deg(l) > 140).slice(0, 12);
  if (horiz.length < 2 || vert.length < 2) return null;

  // 6. Score every quad: edge support along its sides × size.
  const support = (a: Pt, b: Pt) => {
    const n = 60, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    let hit = 0, seen = 0;
    for (let i = 0; i <= n; i++) {
      const px = a.x + ((b.x - a.x) * i) / n, py = a.y + ((b.y - a.y) * i) / n;
      seen++;
      if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue; // off-frame: no edge
      let best = 0;
      for (let k = -2; k <= 2; k++) {
        const x = Math.round(px + nx * k), y = Math.round(py + ny * k);
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const m = mag[y * W + x];
        const align = Math.abs(Math.cos(dir[y * W + x]) * nx + Math.sin(dir[y * W + x]) * ny);
        if (align > 0.85 && m > best) best = m;
      }
      if (best >= thresh) hit++;
    }
    return hit / seen;
  };
  let bestQuad: Pt[] | null = null, bestScore = 0, bestSupport = 0;
  for (let i = 0; i < horiz.length; i++)
    for (let j = i + 1; j < horiz.length; j++)
      for (let k = 0; k < vert.length; k++)
        for (let m = k + 1; m < vert.length; m++) {
          const pts = [intersect(horiz[i], vert[k]), intersect(horiz[i], vert[m]), intersect(horiz[j], vert[m]), intersect(horiz[j], vert[k])];
          if (pts.some((p) => !p)) continue;
          const q = order(pts as Pt[]);
          if (!convex(q)) continue;
          if (q.some((p) => p.x < -0.03 * W || p.y < -0.03 * H || p.x > 1.03 * W || p.y > 1.03 * H)) continue;
          const a = area(q) / (W * H);
          if (a < 0.12) continue;
          const s = [0, 1, 2, 3].map((e) => support(q[e], q[(e + 1) % 4]));
          const sup = (s[0] + s[1] + s[2] + s[3]) / 4;
          if (Math.min(...s) < 0.12) continue; // every side needs some real edge
          const score = sup * Math.pow(a, 0.2);
          if (score > bestScore) { bestScore = score; bestQuad = q; bestSupport = sup; }
        }
  if (!bestQuad) return null;
  const n = (p: Pt) => ({ x: p.x / W, y: p.y / H });
  const [tl, tr, br, bl] = bestQuad.map(n);
  return { quad: { tl, tr, br, bl }, confidence: Math.min(1, bestSupport * 1.4) };
}

/** Order four points as top-left, top-right, bottom-right, bottom-left. */
export function order(pts: Pt[]): Pt[] {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // Start at the corner with the smallest x + y (top-left), clockwise on screen.
  const start = byAngle.reduce((best, p, i) => (p.x + p.y < byAngle[best].x + byAngle[best].y ? i : best), 0);
  return [0, 1, 2, 3].map((k) => byAngle[(start + k) % 4]);
}
