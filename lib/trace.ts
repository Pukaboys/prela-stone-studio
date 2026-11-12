/**
 * Shape scanner: find shapes in a photo or drawing and trace their outlines.
 *
 *   1. grayscale → threshold (Otsu, adjustable) → foreground mask
 *      (polarity picked from the image border: shapes are whatever differs
 *      from the background)
 *   2. connected components (each separate shape)
 *   3. outer contour of each component (Moore-neighbour tracing)
 *   4. simplify the contour (Ramer–Douglas–Peucker)
 *
 * Works on raw RGBA pixels so it runs in the browser on a canvas and is
 * testable without a DOM.
 */
export type Px = { x: number; y: number };
export type RawImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };
export type TracedShape = {
  /** Outline in image pixels (simplified, closed). */
  contour: Px[];
  /** Bounding box in pixels (pixel edges, so w/h are true pixel extents). */
  box: { x: number; y: number; w: number; h: number };
  /** Outline normalised to 0..1 of the box, for PieceShape polygons. */
  points: Px[];
  areaPx: number;
};
export type TraceOptions = {
  /** 0..255; undefined = automatic (Otsu). */
  threshold?: number;
  /** true = shapes are darker than the background; undefined = detect. */
  darkShapes?: boolean;
  /** Simplification tolerance in pixels. */
  detail?: number;
  /** Ignore specks smaller than this share of the image (0..1). */
  minShare?: number;
};

export function grayscale(img: RawImage) {
  const g = new Uint8Array(img.width * img.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    const a = img.data[i + 3] / 255;
    // Transparent pixels count as white background.
    g[j] = Math.round((0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a));
  }
  return g;
}

/** Otsu's threshold: the gray level that best separates two classes. */
export function otsu(gray: Uint8Array) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Whether the background (image border) is light, i.e. shapes are dark. */
function borderIsLight(gray: Uint8Array, w: number, h: number, t: number) {
  let light = 0, n = 0;
  const at = (x: number, y: number) => {
    n++;
    if (gray[y * w + x] > t) light++;
  };
  for (let x = 0; x < w; x++) { at(x, 0); at(x, h - 1); }
  for (let y = 0; y < h; y++) { at(0, y); at(w - 1, y); }
  return light >= n / 2;
}

const DIRS: Px[] = [
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
]; // clockwise on screen, starting west

/** Outer boundary of the component labelled `id`, as pixel centres. */
function traceContour(labels: Int32Array, w: number, h: number, id: number, start: number): Px[] {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
  const s = { x: start % w, y: Math.floor(start / w) };
  const contour: Px[] = [s];
  let p = s, back = 0; // start is the top-left-most pixel, so its west neighbour is outside
  const limit = w * h * 4;
  for (let steps = 0; steps < limit; steps++) {
    let found = -1;
    for (let i = 1; i <= 8; i++) {
      const d = (back + i) % 8;
      if (inside(p.x + DIRS[d].x, p.y + DIRS[d].y)) {
        found = d;
        break;
      }
    }
    if (found < 0) break; // single pixel
    const next = { x: p.x + DIRS[found].x, y: p.y + DIRS[found].y };
    // The neighbour checked just before `found` is outside; it becomes the new backtrack.
    const prev = DIRS[(found + 7) % 8];
    const bx = p.x + prev.x - next.x, by = p.y + prev.y - next.y;
    back = DIRS.findIndex((d) => d.x === bx && d.y === by);
    if (back < 0) back = (found + 4) % 8;
    if (next.x === s.x && next.y === s.y && contour.length > 2) {
      // Back at the start: done once the walk would repeat its first step.
      const second = contour[1];
      let again = -1;
      for (let i = 1; i <= 8; i++) {
        const d = (back + i) % 8;
        if (inside(s.x + DIRS[d].x, s.y + DIRS[d].y)) { again = d; break; }
      }
      if (again >= 0 && s.x + DIRS[again].x === second.x && s.y + DIRS[again].y === second.y) break;
    }
    contour.push(next);
    p = next;
  }
  return contour;
}

function perpendicular(p: Px, a: Px, b: Px) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  return len ? Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len : Math.hypot(p.x - a.x, p.y - a.y);
}
function rdp(pts: Px[], eps: number): Px[] {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicular(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}
/** Simplify a closed outline: split at the point farthest from the start, simplify both halves. */
export function simplifyClosed(pts: Px[], eps: number): Px[] {
  if (pts.length < 4) return pts;
  let far = 0, max = 0;
  pts.forEach((p, i) => {
    const d = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    if (d > max) { max = d; far = i; }
  });
  const a = rdp(pts.slice(0, far + 1), eps), b = rdp([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Light 5-point smoothing of a closed pixel outline: removes the pixel staircase. */
export function smoothClosed(pts: Px[]): Px[] {
  const n = pts.length;
  if (n < 8) return pts;
  const k = [1, 2, 3, 2, 1], sum = 9;
  return pts.map((_, i) => {
    let x = 0, y = 0;
    for (let j = -2; j <= 2; j++) {
      const q = pts[(i + j + n) % n];
      x += q.x * k[j + 2];
      y += q.y * k[j + 2];
    }
    return { x: x / sum, y: y / sum };
  });
}

export function traceShapes(img: RawImage, opts: TraceOptions = {}): { shapes: TracedShape[]; threshold: number; darkShapes: boolean } {
  const { width: w, height: h } = img;
  const gray = grayscale(img);
  const threshold = opts.threshold ?? otsu(gray);
  const darkShapes = opts.darkShapes ?? borderIsLight(gray, w, h, threshold);
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < fg.length; i++) fg[i] = darkShapes ? +(gray[i] <= threshold) : +(gray[i] > threshold);

  // Connected components (8-connected), iterative flood fill.
  const labels = new Int32Array(w * h);
  const comps: { id: number; start: number; area: number; minX: number; minY: number; maxX: number; maxY: number }[] = [];
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i] || labels[i]) continue;
    const id = ++next;
    const c = { id, start: i, area: 0, minX: w, minY: h, maxX: 0, maxY: 0 };
    let top = 0;
    stack[top++] = i;
    labels[i] = id;
    while (top) {
      const k = stack[--top], x = k % w, y = (k - x) / w;
      c.area++;
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x;
      if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      for (const d of DIRS) {
        const nx = x + d.x, ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (fg[n] && !labels[n]) { labels[n] = id; stack[top++] = n; }
      }
    }
    comps.push(c);
  }

  const minArea = Math.max(30, (opts.minShare ?? 0.0015) * w * h);
  const eps = Math.max(0.3, opts.detail ?? 1.0);
  const shapes = comps
    .filter((c) => c.area >= minArea)
    .sort((a, b) => b.area - a.area)
    .slice(0, 40)
    .map((c) => {
      const raw = traceContour(labels, w, h, c.id, c.start).map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
      const contour = simplifyClosed(smoothClosed(raw), eps);
      const box = { x: c.minX, y: c.minY, w: c.maxX - c.minX + 1, h: c.maxY - c.minY + 1 };
      // Stretch the outline to fill 0..1 exactly, so the piece box is the shape's extent.
      const xs = contour.map((p) => p.x), ys = contour.map((p) => p.y);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      const spanX = Math.max(...xs) - minX || 1, spanY = Math.max(...ys) - minY || 1;
      const points = contour.map((p) => ({ x: (p.x - minX) / spanX, y: (p.y - minY) / spanY }));
      return { contour, box, points, areaPx: c.area };
    })
    .filter((s) => s.contour.length >= 3)
    // Reading order: top to bottom, then left to right.
    .sort((a, b) => (Math.abs(a.box.y - b.box.y) > Math.min(a.box.h, b.box.h) / 2 ? a.box.y - b.box.y : a.box.x - b.box.x));
  return { shapes, threshold, darkShapes };
}
