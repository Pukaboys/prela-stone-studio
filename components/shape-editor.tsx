"use client";
/**
 * Piece shape editor: rectangle with square / rounded / chamfered corners,
 * circle or ellipse, arch, curved band, and free form (edit points, presets,
 * or scan from a photo). Shows a live, dimensioned preview.
 */
import { useRef, useState } from "react";
import { FlipHorizontal2, FlipVertical2, RotateCw, ScanLine, Trash2 } from "lucide-react";
import Num from "@/components/num-field";
import ShapeScanner, { type ScannedShape } from "@/components/shape-scanner";
import { pieceArea, pieceHole, type Piece } from "@/lib/model";
import {
  CORNER_NAMES,
  SHAPE_LABEL,
  SQUARE,
  bounds,
  pathD,
  pieceOutline,
  shapeSize,
  type Corner,
  type Corners,
  type PieceShape,
  type Pt,
  type ShapeKind,
} from "@/lib/shapes";

type Draft = Piece;

const KINDS: ShapeKind[] = ["rect", "ellipse", "arch", "bend", "polygon"];
const PRESETS: { name: string; points: Pt[] }[] = [
  { name: "L shape", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.6, y: 1 }, { x: 0.6, y: 0.4 }, { x: 0, y: 0.4 }] },
  { name: "Trapezoid", points: [{ x: 0.2, y: 0 }, { x: 0.8, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
  { name: "Triangle", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
  { name: "Hexagon", points: [0, 1, 2, 3, 4, 5].map((i) => ({ x: 0.5 + 0.5 * Math.cos((Math.PI / 3) * i), y: 0.5 + 0.5 * Math.sin((Math.PI / 3) * i) })) },
];
const BEND_DEFAULT = { kind: "bend", band: 300, radius: 400, angle: 90, legA: 300, legB: 300 } as const;

/** Re-fit a free form so its points span 0..1 again, keeping its real size. */
function refitPolygon(d: Draft): Draft {
  if (d.shape?.kind !== "polygon") return d;
  const b = bounds(d.shape.points);
  if (b.w <= 0 || b.h <= 0) return d;
  return {
    ...d,
    w: Math.round(d.w * b.w * 10) / 10,
    h: Math.round(d.h * b.h * 10) / 10,
    shape: { kind: "polygon", points: d.shape.points.map((p) => ({ x: (p.x - b.x) / b.w, y: (p.y - b.y) / b.h })) },
  };
}

function CornerControl({
  name,
  corner,
  onChange,
  onAll,
}: {
  name: string;
  corner: Corner;
  onChange: (c: Corner) => void;
  onAll: () => void;
}) {
  return (
    <div className="corner-control">
      <div className="corner-head">
        <b>{name}</b>
        <button type="button" className="quiet" onClick={onAll} title="Use this corner on all four corners">
          Apply to all
        </button>
      </div>
      <div className="seg3" role="radiogroup" aria-label={`${name} corner`}>
        {(
          [
            ["square", "Square"],
            ["radius", "Radius"],
            ["chamfer", "Chamfer"],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={corner.type === t}
            onClick={() =>
              corner.type !== t &&
              onChange(t === "square" ? SQUARE : t === "radius" ? { type: "radius", r: 50 } : { type: "chamfer", x: 100, y: 100 })
            }
          >
            {label}
          </button>
        ))}
      </div>
      {corner.type === "radius" && <Num compact label={`${name} radius`} value={corner.r} onChange={(r) => onChange({ type: "radius", r })} />}
      {corner.type === "chamfer" && (
        <div className="twocol">
          <Num compact label={`${name} chamfer along X`} value={corner.x} onChange={(x) => onChange({ ...corner, x })} />
          <Num compact label={`${name} chamfer along Y`} value={corner.y} onChange={(y) => onChange({ ...corner, y })} />
        </div>
      )}
    </div>
  );
}

export default function ShapeEditor({
  piece,
  onApply,
  onCancel,
}: {
  piece: Piece;
  onApply: (values: Pick<Piece, "w" | "h" | "shape">) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>({ ...piece });
  const [scanning, setScanning] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const kind: ShapeKind = d.shape?.kind ?? "rect";
  const set = (values: Partial<Draft>) => setD((x) => ({ ...x, ...values }));
  const setShape = (shape: PieceShape) => {
    const natural = shapeSize(shape);
    setD((x) => ({ ...x, shape, ...(natural ?? {}) }));
  };

  function switchKind(k: ShapeKind) {
    if (k === kind) return;
    setActive(null);
    // A curved band sizes itself; leaving it for a box-sized shape restores the
    // piece's own size (unless the piece was a band to begin with).
    const size = kind === "bend" && piece.shape?.kind !== "bend" ? { w: piece.w, h: piece.h } : { w: d.w, h: d.h };
    if (k === "rect") setD((x) => ({ ...x, ...size, shape: { kind: "rect" } }));
    else if (k === "ellipse") setD((x) => ({ ...x, ...size, shape: { kind: "ellipse" } }));
    else if (k === "arch") setD((x) => ({ ...x, ...size, shape: { kind: "arch", rise: Math.round(Math.min(size.h, size.w / 2)) } }));
    else if (k === "bend") setShape({ ...BEND_DEFAULT });
    else {
      // Start from the current outline so any shape can be fine-tuned point by point.
      const pts = pieceOutline(d);
      const step = Math.max(1, Math.floor(pts.length / 60));
      setShape({ kind: "polygon", points: pts.filter((_, i) => i % step === 0).map((p) => ({ x: p.x / d.w, y: p.y / d.h })) });
    }
  }

  // ---- free-form point editing
  const svgPoint = (e: React.PointerEvent) => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: Math.min(1, Math.max(0, q.x / d.w)), y: Math.min(1, Math.max(0, q.y / d.h)) };
  };
  const points = d.shape?.kind === "polygon" ? d.shape.points : [];
  const setPoints = (pts: Pt[]) => set({ shape: { kind: "polygon", points: pts } });
  function insertPoint(i: number, e: React.MouseEvent) {
    const m = svg.current!.getScreenCTM()!.inverse();
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    const p = { x: Math.min(1, Math.max(0, q.x / d.w)), y: Math.min(1, Math.max(0, q.y / d.h)) };
    setPoints([...points.slice(0, i + 1), p, ...points.slice(i + 1)]);
    setActive(i + 1);
  }
  function removePoint(i: number) {
    if (points.length <= 3) return;
    setPoints(points.filter((_, k) => k !== i));
    setActive(null);
  }
  const transform = (f: (p: Pt) => Pt, swap = false) => {
    setPoints(points.map(f));
    if (swap) set({ w: d.h, h: d.w });
  };

  function useScan([s]: ScannedShape[]) {
    setScanning(false);
    if (!s) return;
    setD((x) => ({ ...x, w: s.w, h: s.h, shape: { kind: "polygon", points: s.points } }));
  }

  if (scanning) return <ShapeScanner multiple={false} onUse={useScan} onCancel={() => setScanning(false)} />;

  const outline = pieceOutline(d);
  const hole = pieceHole(d);
  const pad = Math.max(d.w, d.h) * 0.14;
  const font = Math.max(d.w, d.h) * 0.045;
  const natural = d.shape ? shapeSize(d.shape) : null;
  const corners: Corners = d.shape?.kind === "rect" && d.shape.corners ? d.shape.corners : [SQUARE, SQUARE, SQUARE, SQUARE];
  const setCorner = (i: number, c: Corner) => {
    const next = [...corners] as Corners;
    next[i] = c;
    setShape({ kind: "rect", corners: next });
  };

  return (
    <div className="shape-editor">
      <div className="shape-kinds" role="radiogroup" aria-label="Shape">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => switchKind(k)}>
            <KindIcon kind={k} />
            {SHAPE_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="shape-body">
        <div className="shape-preview">
          <svg
            ref={svg}
            viewBox={`${-pad} ${-pad} ${d.w + pad * 2} ${d.h + pad * 2}`}
            onPointerMove={(e) => {
              if (drag.current === null) return;
              const p = svgPoint(e);
              setPoints(points.map((q, i) => (i === drag.current ? p : q)));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
            role="img"
            aria-label={`${SHAPE_LABEL[kind]} preview, ${d.w} by ${d.h} millimetres`}
          >
            <rect x={0} y={0} width={d.w} height={d.h} className="shape-box" style={{ strokeWidth: font * 0.08 }} />
            <path d={pathD(outline) + (hole ? pathD(hole) : "")} fillRule="evenodd" className="shape-fill" style={{ strokeWidth: font * 0.12 }} />
            {/* dimensions */}
            <g className="shape-dim" style={{ fontSize: font, strokeWidth: font * 0.06 }}>
              <line x1={0} y1={-pad * 0.45} x2={d.w} y2={-pad * 0.45} />
              <text x={d.w / 2} y={-pad * 0.6} textAnchor="middle">{d.w} mm</text>
              <line x1={-pad * 0.45} y1={0} x2={-pad * 0.45} y2={d.h} />
              <text transform={`translate(${-pad * 0.6} ${d.h / 2}) rotate(-90)`} textAnchor="middle">{d.h} mm</text>
              <text x={d.w / 2} y={d.h + pad * 0.7} textAnchor="middle" className="shape-side">Front</text>
            </g>
            {kind === "polygon" &&
              points.map((p, i) => {
                const q = points[(i + 1) % points.length];
                return (
                  <line
                    key={"e" + i}
                    x1={p.x * d.w}
                    y1={p.y * d.h}
                    x2={q.x * d.w}
                    y2={q.y * d.h}
                    className="shape-edge-hit"
                    style={{ strokeWidth: font * 0.6 }}
                    onDoubleClick={(e) => insertPoint(i, e)}
                  >
                    <title>Double-click to add a point</title>
                  </line>
                );
              })}
            {kind === "polygon" &&
              points.map((p, i) => (
                <circle
                  key={"p" + i}
                  cx={p.x * d.w}
                  cy={p.y * d.h}
                  r={font * 0.32}
                  className={"shape-point" + (active === i ? " active" : "")}
                  tabIndex={0}
                  role="button"
                  aria-label={`Point ${i + 1}`}
                  onPointerDown={(e) => {
                    e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                    drag.current = i;
                    setActive(i);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Delete" || e.key === "Backspace") removePoint(i);
                  }}
                />
              ))}
          </svg>
          <p className="hint">
            {kind === "polygon"
              ? "Drag points to shape the piece. Double-click an edge to add a point; select a point and press Delete to remove it."
              : `Finished area ${(pieceArea(d) / 1e6).toFixed(3)} m² · the bottom edge is the front.`}
          </p>
        </div>

        <div className="shape-params">
          {kind !== "bend" && (
            <div className="twocol">
              {kind === "ellipse" && d.w === d.h ? (
                <Num label="Diameter" value={d.w} min={10} onChange={(n) => set({ w: n, h: n })} />
              ) : (
                <>
                  <Num label="Width" value={d.w} min={10} onChange={(w) => set({ w })} />
                  <Num label="Height" value={d.h} min={10} onChange={(h) => set({ h })} />
                </>
              )}
            </div>
          )}

          {kind === "ellipse" && (
            <label className="check">
              <input type="checkbox" checked={d.w === d.h} onChange={(e) => e.target.checked && set({ h: d.w })} /> Circle (equal
              width and height)
            </label>
          )}

          {kind === "rect" && (
            <div className="corner-grid">
              {[0, 1, 3, 2].map((i) => (
                <CornerControl
                  key={i}
                  name={CORNER_NAMES[i]}
                  corner={corners[i]}
                  onChange={(c) => setCorner(i, c)}
                  onAll={() => setShape({ kind: "rect", corners: [corners[i], corners[i], corners[i], corners[i]] })}
                />
              ))}
            </div>
          )}

          {kind === "arch" && d.shape?.kind === "arch" && (
            <>
              <Num label="Curve height (rise)" value={d.shape.rise} max={d.h} onChange={(rise) => setShape({ kind: "arch", rise })} />
              <div className="preset-row">
                <button type="button" onClick={() => setShape({ kind: "arch", rise: Math.min(d.h, Math.round(d.w / 2)) })}>
                  Half circle
                </button>
                <button type="button" onClick={() => setShape({ kind: "arch", rise: d.h })}>
                  Full height
                </button>
              </div>
            </>
          )}

          {kind === "bend" && d.shape?.kind === "bend" && (
            <>
              <div className="twocol">
                <Num label="Band width" value={d.shape.band} min={1} onChange={(band) => setShape({ ...(d.shape as typeof BEND_DEFAULT), band })} />
                <Num label="Inner radius" value={d.shape.radius} onChange={(radius) => setShape({ ...(d.shape as typeof BEND_DEFAULT), radius })} />
                <Num label="Turn angle" unit="°" value={d.shape.angle} min={1} max={180} onChange={(angle) => setShape({ ...(d.shape as typeof BEND_DEFAULT), angle })} />
                <span />
                <Num label="Straight start" value={d.shape.legA} onChange={(legA) => setShape({ ...(d.shape as typeof BEND_DEFAULT), legA })} />
                <Num label="Straight end" value={d.shape.legB} onChange={(legB) => setShape({ ...(d.shape as typeof BEND_DEFAULT), legB })} />
              </div>
              {natural && (
                <p className="hint">
                  Overall size {natural.w} × {natural.h} mm (follows from the values above).
                </p>
              )}
            </>
          )}

          {kind === "polygon" && (
            <>
              <button type="button" className="primary scan-button" onClick={() => setScanning(true)}>
                <ScanLine /> Scan shape from photo
              </button>
              <div className="preset-row">
                {PRESETS.map((p) => (
                  <button key={p.name} type="button" onClick={() => setPoints(p.points)}>
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="preset-row">
                <button type="button" onClick={() => transform((p) => ({ x: 1 - p.x, y: p.y }))} title="Mirror left–right">
                  <FlipHorizontal2 size={15} /> Mirror
                </button>
                <button type="button" onClick={() => transform((p) => ({ x: p.x, y: 1 - p.y }))} title="Mirror front–back">
                  <FlipVertical2 size={15} /> Flip
                </button>
                <button type="button" onClick={() => transform((p) => ({ x: 1 - p.y, y: p.x }), true)} title="Rotate the shape 90°">
                  <RotateCw size={15} /> Rotate 90°
                </button>
                <button
                  type="button"
                  className="danger"
                  disabled={active === null || points.length <= 3}
                  onClick={() => active !== null && removePoint(active)}
                >
                  <Trash2 size={15} /> Point
                </button>
              </div>
              <p className="hint">{points.length} points. Width and height scale the whole shape.</p>
            </>
          )}
        </div>
      </div>

      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            const done = refitPolygon(d);
            onApply({ w: done.w, h: done.h, shape: done.shape?.kind === "rect" && !done.shape.corners ? undefined : done.shape });
          }}
        >
          Apply shape
        </button>
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: ShapeKind }) {
  const common = { fill: "currentColor", fillOpacity: 0.25, stroke: "currentColor", strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 32 24" width={32} height={24} aria-hidden>
      {kind === "rect" && <path d="M3 4h20l6 6v10H3z" {...common} />}
      {kind === "ellipse" && <circle cx={16} cy={12} r={9} {...common} />}
      {kind === "arch" && <path d="M5 21v-8a11 9 0 0 1 22 0v8z" {...common} />}
      {kind === "bend" && <path d="M4 4h8a14 14 0 0 1 14 14v3h-6v-3a8 8 0 0 0-8-8H4z" {...common} />}
      {kind === "polygon" && <path d="M4 18 7 5l9 3 6-4 6 9-7 8z" {...common} />}
    </svg>
  );
}
