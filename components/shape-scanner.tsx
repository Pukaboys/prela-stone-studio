"use client";
/**
 * Shape scanner: photograph a template (or open a drawing / screenshot), find
 * every shape in it, set the real size of one shape, and turn the shapes into
 * free-form pieces.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImageUp, ScanLine } from "lucide-react";
import Num from "@/components/num-field";
import { pointInPolygon } from "@/lib/shapes";
import { traceShapes, type RawImage } from "@/lib/trace";

export type ScannedShape = { name: string; w: number; h: number; points: { x: number; y: number }[] };

const MAX_SIDE = 1000;
const COLORS = ["#bde96e", "#65cbd5", "#ddaeec", "#f2be70", "#95aafa", "#ff8f88"];

export default function ShapeScanner({
  multiple,
  onUse,
  onCancel,
}: {
  /** true: add every selected shape as a new piece; false: pick one shape. */
  multiple: boolean;
  onUse: (shapes: ScannedShape[]) => void;
  onCancel: () => void;
}) {
  const [image, setImage] = useState<{ raw: RawImage; url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [threshold, setThreshold] = useState<number | undefined>(undefined);
  const [dark, setDark] = useState<boolean | undefined>(undefined);
  const [detail, setDetail] = useState(1);
  const [chosen, setChosen] = useState<number[]>([]);
  const [reference, setReference] = useState(0);
  const [refWidth, setRefWidth] = useState(1000);
  const canvas = useRef<HTMLCanvasElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const result = useMemo(
    () => (image ? traceShapes(image.raw, { threshold, darkShapes: dark, detail }) : null),
    [image, threshold, dark, detail],
  );
  const shapes = useMemo(() => result?.shapes ?? [], [result]);

  // A new trace starts with every shape (or the largest one) selected.
  const [tracedFor, setTracedFor] = useState<typeof result>(null);
  if (result !== tracedFor) {
    setTracedFor(result);
    const all = shapes.map((_, i) => i);
    setChosen(multiple ? all : all.length ? [shapes.reduce((b, s, i) => (s.areaPx > shapes[b].areaPx ? i : b), 0)] : []);
    setReference((r) => (r < shapes.length ? r : 0));
  }

  async function load(f?: File) {
    if (!f) return;
    setError("");
    try {
      const bitmap = await createImageBitmap(f);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bitmap.width * scale);
      c.height = Math.round(bitmap.height * scale);
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      setImage({ raw: ctx.getImageData(0, 0, c.width, c.height), url: c.toDataURL("image/jpeg", 0.85), name: f.name });
      setThreshold(undefined);
      setDark(undefined);
    } catch {
      setError("This image could not be opened. Use a JPG, PNG or WebP photo.");
    }
  }

  // Draw the photo with the traced outlines.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !image) return;
    const img = new Image();
    img.onload = () => {
      cv.width = image.raw.width;
      cv.height = image.raw.height;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "rgba(10,14,16,.35)";
      ctx.fillRect(0, 0, cv.width, cv.height);
      const lw = Math.max(2, cv.width / 400);
      shapes.forEach((s, i) => {
        const on = chosen.includes(i), color = COLORS[i % COLORS.length];
        ctx.beginPath();
        s.contour.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = on ? color + "66" : "rgba(255,255,255,.08)";
        ctx.fill();
        ctx.lineWidth = on ? lw * 1.6 : lw;
        ctx.strokeStyle = on ? color : "rgba(255,255,255,.55)";
        ctx.stroke();
        const r = Math.max(12, cv.width / 60);
        const cx = s.box.x + s.box.w / 2, cy = s.box.y + s.box.h / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = on ? color : "#2a3236";
        ctx.fill();
        ctx.fillStyle = on ? "#14201f" : "#fff";
        ctx.font = `700 ${r * 1.1}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), cx, cy + 1);
      });
    };
    img.src = image.url;
  }, [image, shapes, chosen]);

  function pick(e: React.PointerEvent<HTMLCanvasElement>) {
    const cv = e.currentTarget, r = cv.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height };
    const i = shapes.findIndex((s) => pointInPolygon(p, s.contour));
    if (i < 0) return;
    if (multiple) setChosen((c) => (c.includes(i) ? c.filter((k) => k !== i) : [...c, i].sort((a, b) => a - b)));
    else setChosen([i]);
  }

  const ref = shapes[reference];
  const mmPerPx = ref ? refWidth / ref.box.w : 0;
  const size = (i: number) => ({
    w: Math.round(shapes[i].box.w * mmPerPx),
    h: Math.round(shapes[i].box.h * mmPerPx),
  });
  function use() {
    onUse(
      chosen.map((i, n) => ({
        name: `Scanned ${multiple ? n + 1 : ""}`.trim(),
        ...size(i),
        points: shapes[i].points,
      })),
    );
  }

  return (
    <div className="scanner">
      <div className="scanner-sources">
        <button type="button" onClick={() => camera.current?.click()}>
          <Camera /> Take photo
        </button>
        <button type="button" onClick={() => file.current?.click()}>
          <ImageUp /> Choose image
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => load(e.target.files?.[0])} />
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => load(e.target.files?.[0])} />
        <span className="hint">
          Lay the template on a contrasting floor and photograph it from straight above. Drawings and screenshots work too.
        </span>
      </div>

      {error && <p className="error">{error}</p>}

      {!image ? (
        <div className="scanner-empty">
          <ScanLine />
          <p>Open a photo or drawing of the shapes to trace their outlines.</p>
        </div>
      ) : (
        <>
          <div className="scanner-stage">
            <canvas ref={canvas} onPointerDown={pick} aria-label="Photo with detected shapes; click a shape to select it" role="img" />
          </div>
          <div className="scanner-controls">
            <label className="scanner-slider">
              <span>Threshold</span>
              <input
                type="range"
                min={1}
                max={254}
                value={result?.threshold ?? 128}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <button type="button" className="quiet" onClick={() => setThreshold(undefined)} disabled={threshold === undefined}>
                Auto
              </button>
            </label>
            <label className="scanner-slider">
              <span>Smoothing</span>
              <input type="range" min={0.4} max={6} step={0.1} value={detail} onChange={(e) => setDetail(Number(e.target.value))} />
              <b>{detail.toFixed(1)}</b>
            </label>
            <div className="scanner-polarity" role="radiogroup" aria-label="Shape colour">
              {(
                [
                  [true, "Dark shapes"],
                  [false, "Light shapes"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={(result?.darkShapes ?? true) === v}
                  onClick={() => setDark(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {shapes.length === 0 ? (
            <p className="hint">No shapes found. Try the other shape colour or move the threshold.</p>
          ) : (
            <div className="scanner-result">
              <div className="scanner-scale">
                <b>Real size</b>
                <span>Width of shape</span>
                <select value={reference} onChange={(e) => setReference(Number(e.target.value))} aria-label="Reference shape">
                  {shapes.map((_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <Num compact label="Real width of the reference shape" value={refWidth} min={1} onChange={setRefWidth} />
                <span className="hint">The other shapes are scaled the same way.</span>
              </div>
              <ul className="scanner-list">
                {shapes.map((s, i) => {
                  const d = size(i);
                  return (
                    <li key={i}>
                      <label>
                        <input
                          type={multiple ? "checkbox" : "radio"}
                          name="scanned-shape"
                          checked={chosen.includes(i)}
                          onChange={() =>
                            multiple
                              ? setChosen((c) => (c.includes(i) ? c.filter((k) => k !== i) : [...c, i].sort((a, b) => a - b)))
                              : setChosen([i])
                          }
                        />
                        <i style={{ background: COLORS[i % COLORS.length] }} />
                        Shape {i + 1}
                        <small>
                          {d.w} × {d.h} mm · {s.points.length} points
                        </small>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!chosen.length || !mmPerPx} onClick={use}>
          {multiple ? `Add ${chosen.length} piece${chosen.length === 1 ? "" : "s"}` : "Use this shape"}
        </button>
      </div>
    </div>
  );
}
