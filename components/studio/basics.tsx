"use client";
/** Small building blocks of the studio screen. */
import { useEffect, useRef, useState } from "react";
import type { Defect, PhotoCrop, Slab } from "@/lib/model";

/** Slab photo thumbnail with a clear placeholder when the photo is not in this copy. */
export function SlabThumb({ src, alt, mirror }: { src: string; alt: string; mirror?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className="thumb-missing" role="img" aria-label={`${alt}: photo missing`}>
        Photo missing
        <small>Use Replace photo in Slab settings</small>
      </span>
    );
  return <img src={src} alt={alt} className={mirror ? "mirrored" : undefined} onError={() => setFailed(true)} />;
}
export function ZoomBoard({
  zoom,
  children,
  className = "",
}: {
  zoom: number;
  children: React.ReactNode;
  className?: string;
}) {
  const inner = useRef<HTMLDivElement>(null),
    [height, setHeight] = useState(0);
  useEffect(() => {
    const svg = inner.current?.querySelector("svg");
    if (!svg) return;
    const observer = new ResizeObserver(() => setHeight(svg.clientHeight));
    observer.observe(svg);
    setHeight(svg.clientHeight);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className={"board-scroll " + className}
      style={height ? { height } : undefined}
    >
      <div
        ref={inner}
        className="board-inner zoom-board"
        style={
          {
            width: zoom * 100 + "%",
            minWidth: 0,
            height: height ? height * zoom : undefined,
            "--board-zoom": zoom,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

function cropPoint(e: React.PointerEvent<HTMLDivElement>, host: HTMLDivElement) {
  const r = host.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  };
}

export function DefectPainter({ slab, crop, defects, onAdd }: { slab: Slab; crop: PhotoCrop; defects: Defect[]; onAdd: (defect: Defect) => void }) {
  const host = useRef<HTMLDivElement>(null), stroke = useRef<{ x: number; y: number }[]>([]), c = crop; const [draft, setDraft] = useState<{ x: number; y: number }[]>([]); const [brush, setBrush] = useState(45);
  function toSlab(e: React.PointerEvent<HTMLDivElement>) { if (!host.current) return { x: 0, y: 0 }; const p = cropPoint(e, host.current); return { x: p.x * slab.w, y: p.y * slab.h }; }
  function begin(e: React.PointerEvent<HTMLDivElement>) { stroke.current = [toSlab(e)]; setDraft(stroke.current); host.current?.setPointerCapture(e.pointerId); }
  function move(e: React.PointerEvent<HTMLDivElement>) { if (!stroke.current.length) return; const p = toSlab(e), last = stroke.current[stroke.current.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) < 8) return; stroke.current = [...stroke.current, p]; setDraft(stroke.current); }
  function finish(e: React.PointerEvent<HTMLDivElement>) { if (stroke.current.length < 2) { stroke.current = []; setDraft([]); return; } const points = stroke.current, xs = points.map((p) => p.x), ys = points.map((p) => p.y); onAdd({ id: crypto.randomUUID(), slab: slab.id, x: Math.min(...xs) - brush / 2, y: Math.min(...ys) - brush / 2, w: Math.max(brush, Math.max(...xs) - Math.min(...xs) + brush), h: Math.max(brush, Math.max(...ys) - Math.min(...ys) + brush), points, brush }); stroke.current = []; setDraft([]); host.current?.releasePointerCapture(e.pointerId); }
  function line(points: { x: number; y: number }[]) { return points.map((p) => `${p.x},${p.y}`).join(" "); }
  const previewAspect = ((c.w * (slab.photoWidth ?? slab.w)) / (c.h * (slab.photoHeight ?? slab.h)));
  return <div><div ref={host} className="defect-painter" style={{ aspectRatio: previewAspect }} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { stroke.current = []; setDraft([]); }}><img src={slab.image} alt="Slab defect painting surface" style={{ left: `${-c.x * 100 / c.w}%`, top: `${-c.y * 100 / c.h}%`, width: `${100 / c.w}%`, height: `${100 / c.h}%`, transform: slab.mirror ? "scaleX(-1)" : undefined }} /><svg viewBox={`0 0 ${slab.w} ${slab.h}`} preserveAspectRatio="none">{defects.map((d) => d.points?.length ? <polyline key={d.id} points={line(d.points)} fill="none" stroke="#ff625b" strokeWidth={d.brush ?? brush} strokeLinecap="round" strokeLinejoin="round" /> : <rect key={d.id} x={d.x} y={d.y} width={d.w} height={d.h} fill="#f46d6888" stroke="#ff7770" />)}{draft.length > 1 && <polyline points={line(draft)} fill="none" stroke="#ffd166" strokeWidth={brush} strokeLinecap="round" strokeLinejoin="round" />}</svg></div><label className="brush-control">Brush size <input type="range" min="10" max="180" value={brush} onChange={(e) => setBrush(Number(e.target.value))} /><span>{brush} mm</span></label><p className="hint">Paint defects freely with the brush over damaged areas of the slab.</p></div>;
}
