/** Small drawing of a piece's outline and opening, scaled to fit. */
import { pieceHoles, type Piece } from "@/lib/model";
import { pathD, pieceOutline } from "@/lib/shapes";

export default function ShapeThumb({
  piece,
  size = 40,
  color,
}: {
  piece: Piece;
  size?: number;
  color?: string;
}) {
  const pad = Math.max(piece.w, piece.h) * 0.06;
  return (
    <svg
      className="shape-thumb"
      width={size}
      height={size}
      viewBox={`${-pad} ${-pad} ${piece.w + pad * 2} ${piece.h + pad * 2}`}
      aria-hidden
    >
      <path
        d={pathD(pieceOutline(piece)) + pieceHoles(piece).map(pathD).join("")}
        fillRule="evenodd"
        fill={color ?? piece.color}
        fillOpacity={0.35}
        stroke={color ?? piece.color}
        strokeWidth={Math.max(piece.w, piece.h) * 0.035}
        vectorEffect="non-scaling-stroke"
        style={{ strokeWidth: 1.5 }}
      />
    </svg>
  );
}
