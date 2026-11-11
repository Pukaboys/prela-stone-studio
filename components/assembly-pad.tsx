"use client";
/**
 * Touch-friendly controls for positioning the selected piece in the assembly:
 * move X / Y / Z and rotate around Z (turn) and X / Y (tilt). Buttons repeat
 * while held; one press-and-hold is one undo step.
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import type { Piece } from "@/lib/model";

type Delta = Partial<Record<"ax" | "ay" | "az" | "rx" | "ry" | "rz", number>>;

const MOVE_STEPS = [1, 10, 50, 100];
const ANGLE_STEPS = [1, 5, 15, 45, 90];

/** Wrap an angle into (-180, 180]. */
const wrap = (a: number) => {
  const r = ((((a + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : Math.round(r * 10) / 10;
};

export function applyDelta(p: Piece, d: Delta): Partial<Piece> {
  const out: Partial<Piece> = {};
  if (d.ax) out.ax = Math.min(50000, Math.max(0, p.ax + d.ax));
  if (d.ay) out.ay = Math.min(50000, Math.max(0, p.ay + d.ay));
  if (d.az) out.az = Math.min(50000, Math.max(0, (p.az ?? 0) + d.az));
  if (d.rx) out.rx = wrap((p.rx ?? 0) + d.rx);
  if (d.ry) out.ry = wrap((p.ry ?? 0) + d.ry);
  if (d.rz) out.rz = wrap((p.rz ?? 0) + d.rz);
  return out;
}

function HoldButton({
  label,
  onBegin,
  onStep,
  children,
}: {
  label: string;
  onBegin: () => void;
  onStep: () => void;
  children: React.ReactNode;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const start = () => {
    stop();
    onBegin();
    onStep();
    let delay = 380;
    const tick = () => {
      onStep();
      delay = Math.max(60, delay * 0.8);
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, delay);
  };
  return (
    <button
      type="button"
      className="pad-btn"
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (!e.repeat) onBegin();
          onStep();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export default function AssemblyPad({
  pieces,
  piece,
  onSelect,
  onBegin,
  onDelta,
  onReset,
}: {
  pieces: Piece[];
  piece?: Piece;
  onSelect: (id: string) => void;
  /** Called once per press, before the first step (records undo history). */
  onBegin: () => void;
  onDelta: (id: string, delta: Delta) => void;
  onReset: (id: string) => void;
}) {
  const [moveStep, setMoveStep] = useState(10);
  const [angleStep, setAngleStep] = useState(5);
  const [tab, setTab] = useState<"move" | "rotate">("move");
  if (!pieces.length) return null;

  const btn = (label: string, delta: Delta, icon: React.ReactNode, text?: string) => (
    <HoldButton
      label={label}
      onBegin={onBegin}
      onStep={() => piece && onDelta(piece.id, delta)}
    >
      {icon}
      {text && <span>{text}</span>}
    </HoldButton>
  );
  const m = moveStep,
    a = angleStep;

  return (
    <div className="assembly-pad" aria-label="Piece position controls">
      <div className="pad-top">
        <label className="pad-piece">
          <span className="sr-only">Piece</span>
          <i style={{ background: piece?.color }} />
          <select value={piece?.id ?? ""} onChange={(e) => onSelect(e.target.value)}>
            {!piece && <option value="">Select a piece</option>}
            {pieces.map((p, i) => (
              <option key={p.id} value={p.id}>
                {String(i + 1).padStart(2, "0")} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="pad-tabs" role="tablist" aria-label="Control set">
          <button role="tab" aria-selected={tab === "move"} onClick={() => setTab("move")}>
            Move
          </button>
          <button role="tab" aria-selected={tab === "rotate"} onClick={() => setTab("rotate")}>
            Rotate
          </button>
        </div>
      </div>

      {piece && tab === "move" && (
        <div className="pad-body">
          <div className="pad-cross" role="group" aria-label="Move on the floor plane">
            <span />
            {btn(`Move back ${m} mm (Y−)`, { ay: -m }, <ArrowUp />, "Y−")}
            <span />
            {btn(`Move left ${m} mm (X−)`, { ax: -m }, <ArrowLeft />, "X−")}
            <output className="pad-readout">
              <small>X</small> {Math.round(piece.ax)}
              <small>Y</small> {Math.round(piece.ay)}
            </output>
            {btn(`Move right ${m} mm (X+)`, { ax: m }, <ArrowRight />, "X+")}
            <span />
            {btn(`Move forward ${m} mm (Y+)`, { ay: m }, <ArrowDown />, "Y+")}
            <span />
          </div>
          <div className="pad-column" role="group" aria-label="Height">
            {btn(`Raise ${m} mm (Z+)`, { az: m }, <ChevronsUp />, "Z+")}
            <output className="pad-readout">
              <small>Z</small> {Math.round(piece.az ?? 0)}
            </output>
            {btn(`Lower ${m} mm (Z−)`, { az: -m }, <ChevronsDown />, "Z−")}
          </div>
          <div className="pad-steps" role="radiogroup" aria-label="Move step">
            {MOVE_STEPS.map((s) => (
              <button key={s} role="radio" aria-checked={moveStep === s} onClick={() => setMoveStep(s)}>
                {s} mm
              </button>
            ))}
          </div>
        </div>
      )}

      {piece && tab === "rotate" && (
        <div className="pad-body rotate">
          <div className="pad-rot" role="group" aria-label="Rotation">
            {(
              [
                ["rz", "Turn (Z)"],
                ["rx", "Tilt X"],
                ["ry", "Tilt Y"],
              ] as const
            ).map(([k, name]) => (
              <div key={k} className="pad-rot-row">
                {btn(`${name} −${a}°`, { [k]: -a }, <RotateCcw />)}
                <output className="pad-readout">
                  <small>{name}</small> {(piece[k] ?? 0).toFixed(0)}°
                </output>
                {btn(`${name} +${a}°`, { [k]: a }, <RotateCw />)}
              </div>
            ))}
          </div>
          <div className="pad-steps" role="radiogroup" aria-label="Angle step">
            {ANGLE_STEPS.map((s) => (
              <button key={s} role="radio" aria-checked={angleStep === s} onClick={() => setAngleStep(s)}>
                {s}°
              </button>
            ))}
            <button className="pad-reset" onClick={() => onReset(piece.id)}>
              Reset rotation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
