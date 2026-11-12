"use client";
/**
 * iPhone-style photo calibration: straighten, vertical and horizontal
 * perspective dials with a scrubbing ruler, plus a crop frame with a
 * rule-of-thirds grid. The same projective transform drives the live canvas
 * preview and the final bake, so the saved slab image matches the preview.
 *
 * Coordinate spaces
 *   source   pixels of the original photo
 *   display  centered, normalized space after straighten/perspective
 *            (half of the photo's longer side = 1). The crop lives here.
 *   canvas   CSS pixels of the preview canvas
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EDIT_LIMIT, type PhotoCrop } from "@/lib/model";
import { squareToQuad, type Quad } from "@/lib/perspective";

export type EditSettings = {
  straighten: number;
  vertical: number;
  horizontal: number;
  crop: PhotoCrop;
  /** Four slab corners (0..1 of the photo): when set, the photo is corrected
   * by perspective so this outline becomes the whole slab. */
  quad?: Quad;
};
type Pt = { x: number; y: number };
type Mat = number[]; // 3×3, row-major
type Tool = "straighten" | "vertical" | "horizontal";

const PERSPECTIVE_STRENGTH = 0.5;
const MIN_CROP = 0.08;

// ---------------------------------------------------------------- matrices
const mul = (a: Mat, b: Mat): Mat => {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return r;
};
const apply = (m: Mat, p: Pt): Pt => {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
};
function invert(m: Mat): Mat {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Source pixels → display space for the given dial values. */
export function editMatrix(e: Omit<EditSettings, "crop">, width: number, height: number): Mat {
  const s = Math.max(width, height) / 2;
  const normalize: Mat = [1 / s, 0, -width / 2 / s, 0, 1 / s, -height / 2 / s, 0, 0, 1];
  // Keystone: positive vertical widens the top, positive horizontal widens the right.
  const perspective: Mat = [
    1, 0, 0,
    0, 1, 0,
    -Math.tan(rad(e.horizontal)) * PERSPECTIVE_STRENGTH,
    Math.tan(rad(e.vertical)) * PERSPECTIVE_STRENGTH,
    1,
  ];
  const c = Math.cos(rad(e.straighten)), n = Math.sin(rad(e.straighten));
  const rotate: Mat = [c, -n, 0, n, c, 0, 0, 0, 1];
  return mul(rotate, mul(perspective, normalize));
}

function bounds(points: Pt[]): PhotoCrop {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
const corners = (w: number, h: number): Pt[] => [
  { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
];
/** Bounding box of the transformed photo in display space. */
export function photoBounds(e: Omit<EditSettings, "crop">, width: number, height: number) {
  const m = editMatrix(e, width, height);
  return bounds(corners(width, height).map((p) => apply(m, p)));
}
function clampCrop(c: PhotoCrop, b: PhotoCrop): PhotoCrop {
  const w = Math.min(Math.max(c.w, MIN_CROP), b.w), h = Math.min(Math.max(c.h, MIN_CROP), b.h);
  return {
    x: Math.min(Math.max(c.x, b.x), b.x + b.w - w),
    y: Math.min(Math.max(c.y, b.y), b.y + b.h - h),
    w,
    h,
  };
}

// ---------------------------------------------------------------- drawing
/** Affine transform mapping triangle s onto triangle d (canvas setTransform args). */
function triangleTransform(s: Pt[], d: Pt[]) {
  const [s0, s1, s2] = s, [d0, d1, d2] = d;
  const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  const k = (v0: number, v1: number, v2: number) => [
    (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / det,
    (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / det,
    (v0 * (s1.x * s2.y - s2.x * s1.y) + v1 * (s2.x * s0.y - s0.x * s2.y) + v2 * (s0.x * s1.y - s1.x * s0.y)) / det,
  ];
  const x = k(d0.x, d1.x, d2.x), y = k(d0.y, d1.y, d2.y);
  return [x[0], y[0], x[1], y[1], x[2], y[2]] as const;
}

/**
 * Draw `image` warped by a projective map. The warp is approximated with a
 * mesh of affine triangles over the *destination* grid (`toSource` maps
 * destination pixels back to image pixels). Triangles are expanded slightly
 * to hide hairline seams.
 */
function drawWarped(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageScale: number,
  dest: PhotoCrop,
  toSource: (p: Pt) => Pt,
  grid: number,
  base: DOMMatrix,
) {
  const tri = (s: Pt[], d: Pt[]) => {
    const cx = (d[0].x + d[1].x + d[2].x) / 3, cy = (d[0].y + d[1].y + d[2].y) / 3;
    const grow = (p: Pt) => ({ x: p.x + Math.sign(p.x - cx) * 0.6, y: p.y + Math.sign(p.y - cy) * 0.6 });
    ctx.save();
    ctx.setTransform(base);
    ctx.beginPath();
    const g = d.map(grow);
    ctx.moveTo(g[0].x, g[0].y);
    ctx.lineTo(g[1].x, g[1].y);
    ctx.lineTo(g[2].x, g[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(...triangleTransform(s.map((p) => ({ x: p.x * imageScale, y: p.y * imageScale })), d));
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  };
  for (let gy = 0; gy < grid; gy++)
    for (let gx = 0; gx < grid; gx++) {
      const p = (i: number, j: number) => ({
        x: dest.x + (dest.w * (gx + i)) / grid,
        y: dest.y + (dest.h * (gy + j)) / grid,
      });
      const d00 = p(0, 0), d10 = p(1, 0), d11 = p(1, 1), d01 = p(0, 1);
      const s00 = toSource(d00), s10 = toSource(d10), s11 = toSource(d11), s01 = toSource(d01);
      tri([s00, s10, s11], [d00, d10, d11]);
      tri([s00, s11, s01], [d00, d11, d01]);
    }
}

/**
 * Render the final corrected photo: the crop frame becomes the whole output,
 * sized to the slab's real aspect ratio so millimetres map evenly to pixels.
 */
export async function bakeEdit(
  image: HTMLImageElement,
  e: EditSettings,
  slabAspect: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const longest = 2400;
  const width = slabAspect >= 1 ? longest : Math.round(longest * slabAspect);
  const height = slabAspect >= 1 ? Math.round(longest / slabAspect) : longest;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#2a3236";
  ctx.fillRect(0, 0, width, height);
  let toSource: (p: Pt) => Pt;
  if (e.quad) {
    // Four-corner perspective correction: the outline becomes the full slab.
    const W = image.naturalWidth, H = image.naturalHeight, q = e.quad;
    const px = (p: Pt) => ({ x: p.x * W, y: p.y * H });
    const map = squareToQuad({ tl: px(q.tl), tr: px(q.tr), br: px(q.br), bl: px(q.bl) });
    toSource = (p) => map(p.x / width, p.y / height);
  } else {
    const inv = invert(editMatrix(e, image.naturalWidth, image.naturalHeight));
    toSource = (p) => apply(inv, { x: e.crop.x + (p.x / width) * e.crop.w, y: e.crop.y + (p.y / height) * e.crop.h });
  }
  drawWarped(ctx, image, 1, { x: 0, y: 0, w: width, h: height }, toSource, 32, new DOMMatrix());
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(Error("Could not create the corrected photo."))), "image/jpeg", 0.92),
  );
  return { blob, width, height };
}

// ---------------------------------------------------------------- UI bits
function ToolIcon({ tool }: { tool: Tool }) {
  if (tool === "straighten")
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="7" fill="currentColor" />
        <path d="M2 12h20" stroke="var(--dial-bg)" strokeWidth="2.2" />
        <path d="M2 12h20" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  if (tool === "vertical")
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M8 5h8l3 14H5z" fill="currentColor" />
        <path d="M12 2v20" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 8v8l14 3V5z" fill="currentColor" />
      <path d="M2 12h20" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

const TOOL_LABEL: Record<Tool, string> = {
  straighten: "Straighten",
  vertical: "Vertical perspective",
  horizontal: "Horizontal perspective",
};

function Dial({ tool, value, active, onClick }: { tool: Tool; value: number; active: boolean; onClick: () => void }) {
  const r = 26, len = 2 * Math.PI * r, frac = Math.min(1, Math.abs(value) / EDIT_LIMIT);
  const shown = Math.round(value);
  return (
    <button
      type="button"
      className={"pe-dial" + (active ? " active" : "") + (shown ? " changed" : "")}
      aria-pressed={active}
      aria-label={`${TOOL_LABEL[tool]}: ${shown}°`}
      title={TOOL_LABEL[tool]}
      onClick={onClick}
    >
      <svg className="pe-ring" viewBox="0 0 60 60" aria-hidden>
        <circle cx="30" cy="30" r={r} className="pe-ring-track" />
        {shown !== 0 && (
          <circle
            cx="30"
            cy="30"
            r={r}
            className="pe-ring-value"
            strokeDasharray={`${len * frac} ${len}`}
            transform={value < 0 ? "translate(60 0) scale(-1 1) rotate(-90 30 30)" : "rotate(-90 30 30)"}
          />
        )}
      </svg>
      <span className="pe-dial-face">{active && shown !== 0 ? shown : <ToolIcon tool={tool} />}</span>
    </button>
  );
}

const PX_PER_DEGREE = 8;
function Ruler({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const set = (v: number) => onChange(Math.round(Math.max(-EDIT_LIMIT, Math.min(EDIT_LIMIT, v)) * 10) / 10);
  return (
    <div
      className="pe-ruler"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={-EDIT_LIMIT}
      aria-valuemax={EDIT_LIMIT}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(1)}°`}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, v: value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current) set(drag.current.v - (e.clientX - drag.current.x) / PX_PER_DEGREE);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => set(0)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 5 : 0.5;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(value - step);
        else if (e.key === "ArrowRight" || e.key === "ArrowUp") set(value + step);
        else if (e.key === "Home" || e.key === "0") set(0);
        else return;
        e.preventDefault();
      }}
    >
      <div
        className="pe-ruler-ticks"
        style={{
          left: `calc(50% - ${(value + EDIT_LIMIT) * PX_PER_DEGREE}px)`,
          width: EDIT_LIMIT * 2 * PX_PER_DEGREE + 2,
        }}
      >
        <span className="pe-ruler-zero" style={{ left: EDIT_LIMIT * PX_PER_DEGREE }} />
      </div>
      <span className="pe-ruler-needle" />
    </div>
  );
}

// ---------------------------------------------------------------- editor
type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export default function PhotoEditor({
  src,
  initial,
  onCancel,
  onApply,
}: {
  src: string;
  initial?: EditSettings;
  onCancel: () => void;
  onApply: (image: HTMLImageElement, settings: EditSettings) => Promise<void>;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<Tool>("straighten");
  const [dials, setDials] = useState({
    straighten: initial?.straighten ?? 0,
    vertical: initial?.vertical ?? 0,
    horizontal: initial?.horizontal ?? 0,
  });
  const [crop, setCrop] = useState<PhotoCrop | null>(initial?.crop ?? null);
  const [dragging, setDragging] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const action = useRef<{ handle: Handle; start: Pt; crop: PhotoCrop } | null>(null);

  // Load the original photo, plus a downscaled copy for a fast live preview.
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (cancelled) return;
      const scale = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight));
      const small = document.createElement("canvas");
      small.width = Math.round(img.naturalWidth * scale);
      small.height = Math.round(img.naturalHeight * scale);
      small.getContext("2d")!.drawImage(img, 0, 0, small.width, small.height);
      setImage(img);
      setPreview(small);
    };
    img.onerror = () => !cancelled && setError("The slab photo could not be loaded.");
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = image?.naturalWidth ?? 1, H = image?.naturalHeight ?? 1;
  const frame = useMemo(() => photoBounds(dials, W, H), [dials, W, H]);
  // Without a saved crop, frame the whole photo.
  const activeCrop = crop ? clampCrop(crop, frame) : frame;

  // Display ↔ canvas mapping, fitted to the transformed photo.
  const view = useMemo(() => {
    const pad = 22;
    const scale = Math.min((size.w - pad * 2) / frame.w, (size.h - pad * 2) / frame.h);
    return {
      scale,
      ox: size.w / 2 - (frame.x + frame.w / 2) * scale,
      oy: size.h / 2 - (frame.y + frame.h / 2) * scale,
    };
  }, [size, frame]);
  const toCanvas = useCallback((p: Pt) => ({ x: view.ox + p.x * view.scale, y: view.oy + p.y * view.scale }), [view]);
  const toDisplay = (p: Pt) => ({ x: (p.x - view.ox) / view.scale, y: (p.y - view.oy) / view.scale });

  // Render preview.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !preview || !image || size.w < 10 || view.scale <= 0) return;
    const raf = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(size.w * dpr);
      cv.height = Math.round(size.h * dpr);
      const ctx = cv.getContext("2d")!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const base = new DOMMatrix([dpr, 0, 0, dpr, 0, 0]);
      const m = editMatrix(dials, W, H);
      const inv = invert(m);
      const tl = toCanvas({ x: frame.x, y: frame.y });
      const dest = { x: tl.x, y: tl.y, w: frame.w * view.scale, h: frame.h * view.scale };
      const toSource = (p: Pt) => apply(inv, toDisplay(p));
      // Clip to the real photo outline so the mesh does not paint outside it.
      ctx.save();
      ctx.setTransform(base);
      ctx.beginPath();
      corners(W, H).forEach((p, i) => {
        const c = toCanvas(apply(m, p));
        if (i) ctx.lineTo(c.x, c.y);
        else ctx.moveTo(c.x, c.y);
      });
      ctx.closePath();
      ctx.clip();
      const flat = !dials.vertical && !dials.horizontal;
      drawWarped(ctx, preview, preview.width / W, dest, toSource, flat ? 1 : 18, base);
      ctx.restore();

      // Dim outside the crop, then frame, grid and corner handles.
      const c0 = toCanvas({ x: activeCrop.x, y: activeCrop.y });
      const cw = activeCrop.w * view.scale, ch = activeCrop.h * view.scale;
      ctx.setTransform(base);
      ctx.fillStyle = "rgba(8,10,12,.62)";
      ctx.beginPath();
      ctx.rect(0, 0, size.w, size.h);
      ctx.rect(c0.x, c0.y, cw, ch);
      ctx.fill("evenodd");
      ctx.strokeStyle = dragging ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.32)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        ctx.moveTo(c0.x + cw * t, c0.y);
        ctx.lineTo(c0.x + cw * t, c0.y + ch);
        ctx.moveTo(c0.x, c0.y + ch * t);
        ctx.lineTo(c0.x + cw, c0.y + ch * t);
      }
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(c0.x, c0.y, cw, ch);
      ctx.lineWidth = 4;
      ctx.lineCap = "square";
      const L = Math.min(22, cw / 3, ch / 3);
      ctx.beginPath();
      for (const [x, y, dx, dy] of [
        [c0.x, c0.y, 1, 1], [c0.x + cw, c0.y, -1, 1],
        [c0.x, c0.y + ch, 1, -1], [c0.x + cw, c0.y + ch, -1, -1],
      ]) {
        ctx.moveTo(x, y + dy * L);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * L, y);
      }
      // Edge midpoint ticks
      const M = Math.min(16, cw / 4, ch / 4);
      ctx.moveTo(c0.x + cw / 2 - M, c0.y); ctx.lineTo(c0.x + cw / 2 + M, c0.y);
      ctx.moveTo(c0.x + cw / 2 - M, c0.y + ch); ctx.lineTo(c0.x + cw / 2 + M, c0.y + ch);
      ctx.moveTo(c0.x, c0.y + ch / 2 - M); ctx.lineTo(c0.x, c0.y + ch / 2 + M);
      ctx.moveTo(c0.x + cw, c0.y + ch / 2 - M); ctx.lineTo(c0.x + cw, c0.y + ch / 2 + M);
      ctx.stroke();
    });
    return () => cancelAnimationFrame(raf);
    // toDisplay derives from view; listing view covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, image, dials, frame, view, activeCrop.x, activeCrop.y, activeCrop.w, activeCrop.h, size, dragging, W, H, toCanvas]);

  function hit(p: Pt): Handle | null {
    const c0 = toCanvas({ x: activeCrop.x, y: activeCrop.y });
    const c1 = toCanvas({ x: activeCrop.x + activeCrop.w, y: activeCrop.y + activeCrop.h });
    const near = 18;
    const L = Math.abs(p.x - c0.x) < near, R = Math.abs(p.x - c1.x) < near;
    const T = Math.abs(p.y - c0.y) < near, B = Math.abs(p.y - c1.y) < near;
    const inX = p.x > c0.x - near && p.x < c1.x + near, inY = p.y > c0.y - near && p.y < c1.y + near;
    if (T && L) return "nw";
    if (T && R) return "ne";
    if (B && L) return "sw";
    if (B && R) return "se";
    if (T && inX) return "n";
    if (B && inX) return "s";
    if (L && inY) return "w";
    if (R && inY) return "e";
    if (p.x > c0.x && p.x < c1.x && p.y > c0.y && p.y < c1.y) return "move";
    return null;
  }
  const local = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const [cursor, setCursor] = useState("default");
  const CURSORS: Record<Handle, string> = {
    move: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
    nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  };

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = local(e), handle = hit(p);
    if (!handle) return;
    action.current = { handle, start: toDisplay(p), crop: activeCrop };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const p = local(e);
    const a = action.current;
    if (!a) {
      const h = hit(p);
      setCursor(h ? CURSORS[h] : "default");
      return;
    }
    const q = toDisplay(p), dx = q.x - a.start.x, dy = q.y - a.start.y, c = a.crop;
    if (a.handle === "move") {
      setCrop(clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, frame));
      return;
    }
    let { x, y, w, h } = c;
    const right = c.x + c.w, bottom = c.y + c.h;
    if (a.handle.includes("w")) {
      x = Math.min(Math.max(frame.x, c.x + dx), right - MIN_CROP);
      w = right - x;
    }
    if (a.handle.includes("e")) w = Math.max(MIN_CROP, Math.min(frame.x + frame.w - c.x, c.w + dx));
    if (a.handle.includes("n")) {
      y = Math.min(Math.max(frame.y, c.y + dy), bottom - MIN_CROP);
      h = bottom - y;
    }
    if (a.handle.includes("s")) h = Math.max(MIN_CROP, Math.min(frame.y + frame.h - c.y, c.h + dy));
    setCrop({ x, y, w, h });
  }
  function endDrag() {
    action.current = null;
    setDragging(false);
  }

  const changed =
    dials.straighten !== 0 || dials.vertical !== 0 || dials.horizontal !== 0 || crop !== null;
  function reset() {
    setDials({ straighten: 0, vertical: 0, horizontal: 0 });
    setCrop(null);
  }
  async function done() {
    if (!image) return;
    setBusy(true);
    try {
      await onApply(image, { ...dials, crop: activeCrop });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pe">
      <div className="pe-top">
        <button type="button" className="pe-pill" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="pe-reset" onClick={reset} disabled={!changed || busy}>
          RESET
        </button>
        <button type="button" className="pe-pill pe-done" onClick={done} disabled={!image || busy}>
          {busy ? "Saving…" : "Done"}
        </button>
      </div>
      <div
        ref={host}
        className="pe-stage"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => !action.current && setCursor("default")}
      >
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} aria-label="Slab photo with crop frame" role="img" />
        {!image && !error && <p className="pe-status">Loading photo…</p>}
        {error && <p className="pe-status error">{error}</p>}
      </div>
      <div className="pe-controls">
        <div className="pe-dials" role="group" aria-label="Adjustment">
          {(["straighten", "vertical", "horizontal"] as Tool[]).map((t) => (
            <Dial key={t} tool={t} value={dials[t]} active={tool === t} onClick={() => setTool(t)} />
          ))}
        </div>
        <div className="pe-readout">
          {TOOL_LABEL[tool]} <b>{dials[tool].toFixed(1)}°</b>
        </div>
        <Ruler
          label={TOOL_LABEL[tool]}
          value={dials[tool]}
          onChange={(v) => setDials((d) => ({ ...d, [tool]: v }))}
        />
        <p className="pe-hint">
          Line the frame up with the slab&apos;s edges. Drag the ruler to straighten or fix perspective;
          double-click it to reset. The framed area is mapped to the slab&apos;s measured width × height.
        </p>
      </div>
    </div>
  );
}
