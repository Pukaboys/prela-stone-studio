"use client";
/**
 * Slab layout drawing: the slab photo, edge trim, defects, and every piece
 * on this slab with its real outline, openings, mitre strips and labels.
 * Pieces are dragged with the pointer, nudged with the arrow keys and turned
 * with the mouse wheel (the wheel listener lives in the studio).
 */
import { edgeCutsOf, mitreStrips } from "@/lib/edges";
import { hasIssue, pieceHoles, placement, slabAngleOf, type Issue, type Piece, type Project, type Slab } from "@/lib/model";
import { pathD, pieceOutline } from "@/lib/shapes";

export default function SlabCanvas({
  svgRef,
  project: pr,
  slab,
  slabImage,
  pieces,
  selected,
  warnings,
  showLabels,
  onPieceDown,
  onPieceMove,
  onPieceUp,
  onPieceKey,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  project: Project;
  slab: Slab;
  slabImage: { x: number; y: number; w: number; h: number };
  pieces: Piece[];
  selected: string;
  warnings: Issue[];
  showLabels: boolean;
  onPieceDown: (e: React.PointerEvent<SVGElement>, p: Piece) => void;
  onPieceMove: (e: React.PointerEvent<SVGElement>) => void;
  onPieceUp: () => void;
  onPieceKey: (e: React.KeyboardEvent<SVGGElement>, p: Piece) => void;
}) {
  return (
    <svg
      ref={svgRef}
      className="slab-svg"
      viewBox={`-130 -140 ${slab.w + 260} ${slab.h + 280}`}
      role="img"
      aria-label="Slab layout. Drag pieces or use arrow keys to position them."
    >
      <text
        x={slab.w / 2}
        y={-65}
        textAnchor="middle"
        className="ruler"
      >
        {slab.w} mm
      </text>
      <text
        transform={`translate(-70 ${slab.h / 2}) rotate(-90)`}
        textAnchor="middle"
        className="ruler"
      >
        {slab.h} mm
      </text>
      <defs><clipPath id={`slab-clip-${slab.id}`}><rect x={0} y={0} width={slab.w} height={slab.h} /></clipPath></defs>
      <image
        href={slab.image}
        x={slabImage.x}
        y={slabImage.y}
        width={slabImage.w}
        height={slabImage.h}
        preserveAspectRatio="none"
        transform={slab.mirror ? `matrix(-1 0 0 1 ${slab.w} 0)` : undefined}
        clipPath={`url(#slab-clip-${slab.id})`}
      />
      <rect
        x={pr.margin}
        y={pr.margin}
        width={Math.max(0, slab.w - pr.margin * 2)}
        height={Math.max(0, slab.h - pr.margin * 2)}
        fill="none"
        stroke="#242b2b"
        strokeWidth={4}
        strokeDasharray="18 14"
      />
      {pr.defects
        .filter((d) => d.slab === slab.id)
        .map((d) => (
          <g key={d.id}>
            {d.points?.length ? <polyline points={d.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#ee4545" strokeWidth={d.brush ?? 80} strokeLinecap="round" strokeLinejoin="round" /> : <rect x={d.x} y={d.y} width={d.w} height={d.h} fill="#e45d5d99" stroke="#ee4545" strokeWidth={6} />}
            <text
              x={d.x + 10}
              y={d.y + 60}
              fontSize={45}
              fill="white"
            >
              DEFECT
            </text>
          </g>
        ))}
      {pieces.map((p) => {
        // Draw the slab footprint: a 90° rotated piece occupies h × w.
        const m = placement(p),
          f = { w: m.w, h: m.h },
          angle = slabAngleOf(p),
          shapePath = pathD(pieceOutline(p).map(m.local)),
          holePath = pieceHoles(p).map((h) => pathD(h.map(m.local))).join(""),
          plain = (!p.shape || p.shape.kind === "rect") && angle % 90 === 0,
          labelW = Math.max(0, Math.min(f.w - 36, 510)),
          labelX = plain ? 18 : (f.w - labelW) / 2,
          labelY = plain ? 18 : f.h / 2 - 60,
          index = pr.pieces.indexOf(p) + 1;
        return (
          <g
            key={p.id}
            transform={`translate(${p.x} ${p.y})`}
            data-piece={p.id}
            tabIndex={0}
            role="button"
            aria-label={p.name + " position"}
            onKeyDown={(e) => onPieceKey(e, p)}
            onPointerDown={(e) => onPieceDown(e, p)}
            onPointerMove={onPieceMove}
            onPointerUp={onPieceUp}
            onPointerCancel={onPieceUp}
            className="draggable"
          >
            {!plain && (
              <rect
                width={f.w}
                height={f.h}
                fill="none"
                stroke={p.color}
                strokeOpacity={0.35}
                strokeWidth={3}
                strokeDasharray="10 10"
              />
            )}
            <path
              d={shapePath}
              fill={p.color}
              fillOpacity={selected === p.id ? 0.24 : 0.1}
              stroke={
                hasIssue(warnings, p.id)
                  ? "#f46d68"
                  : p.color
              }
              strokeWidth={selected === p.id ? 10 : 5}
            />
            {mitreStrips(pieceOutline(p), edgeCutsOf(p), pr.slabs.find((x) => x.id === p.slab)?.thickness ?? 20).map((st, k) => (
              <path
                key={"m" + k}
                d={pathD(st.pts.map(m.local))}
                className={"mitre-strip " + st.cut}
              >
                <title>{st.cut === "below" ? "45° mitre below" : "45° mitre above"}</title>
              </path>
            ))}
            {holePath && (
              <path
                d={holePath}
                fill="#151b1f99"
                stroke={p.color}
                strokeWidth={5}
                strokeDasharray="12 8"
              />
            )}
            {showLabels && (
              <>
                <rect
                  x={labelX}
                  y={labelY}
                  width={labelW}
                  height={120}
                  rx={12}
                  fill="#14201fe8"
                />
                <text x={labelX + 27} y={labelY + 79} fontSize={55} fill={p.color}>
                  {String(index).padStart(2, "0")} · {p.name}
                </text>
                <text
                  x={f.w / 2}
                  y={f.h - 35}
                  textAnchor="middle"
                  fontSize={43}
                  fill="#151c1c"
                  stroke="white"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {p.w} × {p.h}
                  {angle ? ` · ${angle}°` : ""}
                </text>
              </>
            )}
            {selected === p.id &&
              [
                [0, 0],
                [f.w, 0],
                [0, f.h],
                [f.w, f.h],
              ].map(([x, y], i) => (
                <rect
                  key={i}
                  x={x - 15}
                  y={y - 15}
                  width={30}
                  height={30}
                  fill={p.color}
                  stroke="#172024"
                  strokeWidth={4}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}
