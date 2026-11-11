"use client";
/**
 * Opening (sink, hob…) position as distances from the piece edges:
 * "from Left/Right ___ mm" and "from Front/Back ___ mm". The distance runs
 * from the chosen piece edge to the nearest edge of the opening.
 */
import Num from "@/components/num-field";
import { holeDistances, setHoleDistance, type Piece } from "@/lib/model";

function Edge<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="hole-edge" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => value !== v && onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export default function HolePosition({
  piece,
  onPatch,
  compact = false,
}: {
  piece: Piece;
  onPatch: (values: Partial<Piece>) => void;
  compact?: boolean;
}) {
  const d = holeDistances(piece);
  const disabled = !(piece.holeW > 0 && piece.holeH > 0);
  return (
    <div className={"hole-position" + (compact ? " compact" : "")} aria-disabled={disabled || undefined}>
      <div className="hole-axis">
        {!compact && <span className="hole-label">Distance from</span>}
        <Edge
          label="Horizontal reference edge"
          options={[
            ["left", "Left"],
            ["right", "Right"],
          ]}
          value={d.edgeX}
          onChange={(edgeX) => onPatch(setHoleDistance(piece, { edgeX }))}
        />
        <Num
          compact
          label={`Distance from ${d.edgeX} edge`}
          value={d.dx}
          min={0}
          onChange={(dx) => onPatch(setHoleDistance(piece, { dx }))}
        />
      </div>
      <div className="hole-axis">
        {!compact && <span className="hole-label">Distance from</span>}
        <Edge
          label="Depth reference edge"
          options={[
            ["front", "Front"],
            ["back", "Back"],
          ]}
          value={d.edgeY}
          onChange={(edgeY) => onPatch(setHoleDistance(piece, { edgeY }))}
        />
        <Num
          compact
          label={`Distance from ${d.edgeY} edge`}
          value={d.dy}
          min={0}
          onChange={(dy) => onPatch(setHoleDistance(piece, { dy }))}
        />
      </div>
    </div>
  );
}
