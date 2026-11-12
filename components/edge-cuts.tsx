"use client";
/**
 * Edge cut editor: for each side (back, right, front, left) choose straight,
 * 45° mitre below (top face full, slope underneath) or 45° mitre above
 * (bottom face full, top shorter). Small cross-section icons show the profile.
 */
import { CUT_LABEL, SIDES, SIDE_LABEL, edgeCutsOf, type EdgeCut, type Side } from "@/lib/edges";
import type { Piece } from "@/lib/model";

const CUTS: EdgeCut[] = ["straight", "below", "above"];

/** Cross-section of the stone at an edge (edge on the right, top face up). */
export function CutIcon({ cut, size = 26 }: { cut: EdgeCut; size?: number }) {
  const shape =
    cut === "straight" ? "M2 4H22V16H2Z" : cut === "below" ? "M2 4H22L10 16H2Z" : "M2 4H10L22 16H2Z";
  return (
    <svg className="cut-icon" width={size} height={(size * 20) / 26} viewBox="0 0 24 20" aria-hidden>
      <path d={shape} fill="currentColor" fillOpacity={0.3} stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
      <line x1={2} y1={18.5} x2={22} y2={18.5} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 2" />
    </svg>
  );
}

export default function EdgeCutsEditor({
  piece,
  thickness,
  onPatch,
}: {
  piece: Piece;
  /** Slab thickness: the width of a 45° mitre. */
  thickness: number;
  onPatch: (values: Partial<Piece>) => void;
}) {
  const cuts = edgeCutsOf(piece);
  const set = (next: Record<Side, EdgeCut>) =>
    onPatch({
      // Only store mitred sides; the legacy whole-piece angle is replaced.
      edges: Object.fromEntries(SIDES.filter((s) => next[s] !== "straight").map((s) => [s, next[s]])),
      cutAngle: undefined,
    });
  const all = SIDES.every((s) => cuts[s] === cuts.back) ? cuts.back : null;

  return (
    <div className="edge-cuts">
      {[...SIDES, "all" as const].map((side) => (
        <div key={side} className={"edge-row" + (side === "all" ? " all" : "")}>
          <span className="edge-name">{side === "all" ? "All sides" : SIDE_LABEL[side]}</span>
          <div className="edge-options" role="radiogroup" aria-label={`${side === "all" ? "All sides" : SIDE_LABEL[side]} edge cut`}>
            {CUTS.map((cut) => {
              const on = side === "all" ? all === cut : cuts[side] === cut;
              return (
                <button
                  key={cut}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={"cut-" + cut}
                  title={CUT_LABEL[cut]}
                  onClick={() =>
                    set(side === "all" ? { back: cut, right: cut, front: cut, left: cut } : { ...cuts, [side]: cut })
                  }
                >
                  <CutIcon cut={cut} />
                  <span>{cut === "straight" ? "90°" : cut === "below" ? "45° ▼" : "45° ▲"}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="hint">
        <b>45° ▼ below</b>: the top face stays full size and the cut slopes in underneath (e.g. a countertop edge
        meeting an apron). <b>45° ▲ above</b>: the bottom stays full size and the top is {thickness} mm shorter.
        Back is the wall side, front the bottom edge in the drawings.
      </p>
    </div>
  );
}

const SIDE_COLOR: Record<EdgeCut, string> = { straight: "#6f8189", below: "#f2be70", above: "#65cbd5" };

/** Tiny square with each side coloured by its cut (Pieces page). */
export function EdgeCutsBadge({ piece }: { piece: Piece }) {
  const c = edgeCutsOf(piece);
  const mitres = SIDES.filter((s) => c[s] !== "straight").length;
  const line = (side: Side, x1: number, y1: number, x2: number, y2: number) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={SIDE_COLOR[c[side]]} strokeWidth={c[side] === "straight" ? 1.5 : 3.5} strokeLinecap="round" />
  );
  return (
    <span className="edge-badge">
      <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden>
        {line("back", 3, 3, 19, 3)}
        {line("right", 19, 3, 19, 19)}
        {line("front", 19, 19, 3, 19)}
        {line("left", 3, 19, 3, 3)}
      </svg>
      <span>{mitres ? `${mitres} × 45°` : "90°"}</span>
    </span>
  );
}
