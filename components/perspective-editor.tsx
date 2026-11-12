"use client";
/**
 * Four-corner perspective correction for slab photos taken at an angle.
 * The slab's corners are found automatically (lib/perspective.detectQuad);
 * the user can drag any corner, with a magnifier for precision, and sees a
 * live preview of the straightened slab before saving.
 */
import { useEffect, useRef, useState } from "react";
import { ScanSearch, RotateCcw } from "lucide-react";
import type { EditSettings } from "@/components/photo-editor";
import { DEFAULT_QUAD, detectQuad, squareToQuad, type Pt, type Quad } from "@/lib/perspective";

const CORNERS = ["tl", "tr", "br", "bl"] as const;
type Corner = (typeof CORNERS)[number];
const LABEL: Record<Corner, string> = { tl: "Back left", tr: "Back right", br: "Front right", bl: "Front left" };

export default function PerspectiveEditor({
  src,
  initialQuad,
  slabAspect,
  onCancel,
  onApply,
}: {
  src: string;
  initialQuad?: Quad;
  /** Slab width / height (the straightened photo is drawn at this ratio). */
  slabAspect: number;
  onCancel: () => void;
  onApply: (image: HTMLImageElement, settings: EditSettings) => Promise<void>;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [small, setSmall] = useState<ImageData | null>(null);
  const [quad, setQuad] = useState<Quad | null>(initialQuad ?? null);
  const [status, setStatus] = useState("Loading photo…");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Corner | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLCanvasElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  function autoDetect(data: ImageData) {
    const r = detectQuad(data);
    if (r) {
      setQuad(r.quad);
      setStatus(
        r.confidence > 0.6
          ? "Slab corners found automatically. Check them and drag any corner that is off."
          : "Corners found, but the edges are faint. Please check every corner.",
      );
    } else {
      setQuad(DEFAULT_QUAD);
      setStatus("Couldn't find the slab edges. Drag the four corners onto the slab corners.");
    }
  }

  // Load the photo (and a small copy for detection and the live preview).
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const k = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      setImage(img);
      setSmall(data);
      if (initialQuad) setStatus("Drag any corner to adjust. Auto-detect finds the corners again.");
      else autoDetect(data);
    };
    img.onerror = () => !cancelled && setStatus("The photo could not be loaded.");
    img.src = src;
    return () => {
      cancelled = true;
    };
    // initialQuad only seeds the first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Photo fitted into the stage.
  const iw = image?.naturalWidth ?? 1, ih = image?.naturalHeight ?? 1;
  const fit = Math.min((size.w - 24) / iw, (size.h - 24) / ih);
  const ox = (size.w - iw * fit) / 2, oy = (size.h - ih * fit) / 2;
  const toScreen = (p: Pt) => ({ x: ox + p.x * iw * fit, y: oy + p.y * ih * fit });
  const toNorm = (x: number, y: number) => ({
    x: Math.min(1.02, Math.max(-0.02, (x - ox) / (iw * fit))),
    y: Math.min(1.02, Math.max(-0.02, (y - oy) / (ih * fit))),
  });

  // Draw the stage: photo, outline, dimmed outside, magnifier while dragging.
  useEffect(() => {
    const cv = stage.current;
    if (!cv || !image || !quad || size.w < 10) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.drawImage(image, ox, oy, iw * fit, ih * fit);
    const pts = CORNERS.map((k) => toScreen(quad[k]));
    ctx.fillStyle = "rgba(6,9,11,.55)";
    ctx.beginPath();
    ctx.rect(0, 0, size.w, size.h);
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.strokeStyle = "#bde96e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    if (active) {
      // Magnifier: 3× view around the dragged corner, in the opposite corner of the stage.
      const p = toScreen(quad[active]);
      const R = Math.min(70, size.w / 6), zoom = 3;
      const cx = p.x < size.w / 2 ? size.w - R - 12 : R + 12, cy = R + 12;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      const sx = ((p.x - ox) / fit) - R / (zoom * fit), sy = ((p.y - oy) / fit) - R / (zoom * fit);
      ctx.fillStyle = "#000";
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
      ctx.drawImage(image, sx, sy, (2 * R) / (zoom * fit), (2 * R) / (zoom * fit), cx - R, cy - R, 2 * R, 2 * R);
      ctx.strokeStyle = "#bde96e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, quad, size, active]);

  // Live preview of the straightened slab.
  useEffect(() => {
    const cv = preview.current;
    if (!cv || !small || !quad) return;
    const PW = 260, PH = Math.max(40, Math.round(PW / Math.max(0.2, slabAspect)));
    cv.width = PW;
    cv.height = PH;
    const ctx = cv.getContext("2d")!;
    const out = ctx.createImageData(PW, PH);
    const W = small.width, H = small.height;
    const map = squareToQuad({
      tl: { x: quad.tl.x * W, y: quad.tl.y * H }, tr: { x: quad.tr.x * W, y: quad.tr.y * H },
      br: { x: quad.br.x * W, y: quad.br.y * H }, bl: { x: quad.bl.x * W, y: quad.bl.y * H },
    });
    for (let y = 0; y < PH; y++)
      for (let x = 0; x < PW; x++) {
        const s = map((x + 0.5) / PW, (y + 0.5) / PH);
        const sx = Math.round(s.x), sy = Math.round(s.y), j = (y * PW + x) * 4;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) {
          out.data[j] = 42; out.data[j + 1] = 50; out.data[j + 2] = 54; out.data[j + 3] = 255;
          continue;
        }
        const i = (sy * W + sx) * 4;
        out.data[j] = small.data[i]; out.data[j + 1] = small.data[i + 1]; out.data[j + 2] = small.data[i + 2]; out.data[j + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  }, [small, quad, slabAspect]);

  const local = (e: React.PointerEvent) => {
    const r = host.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!quad) return;
    const p = local(e);
    let best: Corner | null = null, dist = 34; // generous for fingers
    for (const k of CORNERS) {
      const c = toScreen(quad[k]), d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < dist) { dist = d; best = k; }
    }
    if (!best) return;
    setActive(best);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!active || !quad) return;
    const p = local(e);
    setQuad({ ...quad, [active]: toNorm(p.x, p.y) });
  }

  return (
    <div className="persp">
      <div
        ref={host}
        className="persp-stage"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
      >
        <canvas ref={stage} style={{ width: size.w, height: size.h }} role="img" aria-label="Slab photo with the four slab corners" />
        {quad &&
          CORNERS.map((k) => {
            const c = toScreen(quad[k]);
            return (
              <span key={k} className={"persp-handle" + (active === k ? " active" : "")} style={{ left: c.x, top: c.y }} title={LABEL[k]} />
            );
          })}
      </div>
      <div className="persp-side">
        <p className="persp-status" role="status">{status}</p>
        <div className="persp-preview">
          <small>Straightened slab</small>
          <canvas ref={preview} />
        </div>
        <div className="persp-tools">
          <button type="button" disabled={!small || busy} onClick={() => small && autoDetect(small)}>
            <ScanSearch size={16} /> Auto-detect corners
          </button>
          <button type="button" disabled={busy} onClick={() => { setQuad(DEFAULT_QUAD); setStatus("Drag the four corners onto the slab corners."); }}>
            <RotateCcw size={16} /> Reset
          </button>
        </div>
        <p className="hint">
          Put each handle on a corner of the slab, even if it is hidden behind a clamp: follow the slab edges to where they meet. The outline
          becomes the whole slab at its measured width × height.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!image || !quad || busy}
            onClick={async () => {
              if (!image || !quad) return;
              setBusy(true);
              try {
                await onApply(image, { straighten: 0, vertical: 0, horizontal: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, quad });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Straighten slab"}
          </button>
        </div>
      </div>
    </div>
  );
}
