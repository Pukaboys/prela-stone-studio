"use client";
/**
 * Openings of a piece (sinks, tap holes, hobs…): any number, each with its
 * size, shape and distances from the piece edges to the opening's edges.
 */
import { Plus, Trash2 } from "lucide-react";
import Num from "@/components/num-field";
import { openingBox, openingsOf, setOpenings, type Opening, type Piece } from "@/lib/model";
import type { HoleKind } from "@/lib/shapes";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

/** Common openings, positioned sensibly on the piece. */
function preset(p: Piece, kind: "sink" | "tap" | "hob" | "custom"): Opening {
  const centreX = (w: number) => ({ edgeX: "left" as const, dx: Math.max(0, Math.round((p.w - w) / 2)) });
  switch (kind) {
    case "sink":
      return { id: uid(), label: "Sink", w: 500, h: 400, kind: "rounded", r: 10, ...centreX(500), edgeY: "front", dy: 100 };
    case "tap":
      return { id: uid(), label: "Tap hole", w: 35, h: 35, kind: "ellipse", ...centreX(35), edgeY: "back", dy: 50 };
    case "hob":
      return { id: uid(), label: "Hob", w: 560, h: 490, kind: "rect", ...centreX(560), edgeY: "front", dy: 60 };
    default:
      return { id: uid(), w: 300, h: 200, kind: "rect", ...centreX(300), edgeY: "front", dy: 100 };
  }
}

function Seg<T extends string>({ value, options, label, onChange }: { value: T; options: [T, string][]; label: string; onChange: (v: T) => void }) {
  return (
    <div className="hole-edge" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => value !== v && onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function openingSummary(p: Piece) {
  const list = openingsOf(p);
  if (!list.length) return "None";
  return list
    .map((o, i) => `${o.label || `Opening ${i + 1}`} ${o.kind === "ellipse" && o.w === o.h ? `Ø${o.w}` : `${o.w}×${o.h}`}`)
    .join(", ");
}

export default function OpeningsEditor({ piece, onPatch }: { piece: Piece; onPatch: (values: Partial<Piece>) => void }) {
  const list = openingsOf(piece);
  const save = (next: Opening[]) => onPatch(setOpenings(next));
  const update = (i: number, values: Partial<Opening>) => save(list.map((o, k) => (k === i ? { ...o, ...values } : o)));

  /** Switch the reference edge without moving the opening. */
  const switchEdge = (i: number, axis: "x" | "y", edge: string) => {
    const o = list[i], box = openingBox(piece, o);
    if (axis === "x") update(i, { edgeX: edge as Opening["edgeX"], dx: edge === "right" ? piece.w - box.x - o.w : box.x });
    else update(i, { edgeY: edge as Opening["edgeY"], dy: edge === "back" ? box.y : piece.h - box.y - o.h });
  };
  /** Move in piece coordinates (+x right, +y towards the front). */
  const nudge = (i: number, dx: number, dy: number) => {
    const o = list[i];
    update(i, {
      dx: Math.max(0, o.dx + (o.edgeX === "right" ? -dx : dx)),
      dy: Math.max(0, o.dy + (o.edgeY === "back" ? dy : -dy)),
    });
  };

  return (
    <div className="openings">
      {list.map((o, i) => (
        <div key={o.id} className="opening-card">
          <div className="opening-head">
            <input
              aria-label={`Opening ${i + 1} name`}
              placeholder={`Opening ${i + 1}`}
              value={o.label ?? ""}
              maxLength={40}
              onChange={(e) => update(i, { label: e.target.value || undefined })}
            />
            <button type="button" className="danger" aria-label={`Remove ${o.label || `opening ${i + 1}`}`} title="Remove opening" onClick={() => save(list.filter((_, k) => k !== i))}>
              <Trash2 size={15} />
            </button>
          </div>
          <div className="twocol">
            <Num label="Width" value={o.w} min={1} onChange={(w) => update(i, o.kind === "ellipse" && o.w === o.h ? { w, h: w } : { w })} />
            <Num label="Height" value={o.h} min={1} onChange={(h) => update(i, { h })} />
          </div>
          <Seg<HoleKind>
            label="Opening shape"
            value={o.kind ?? "rect"}
            options={[["rect", "Square"], ["rounded", "Rounded"], ["ellipse", "Round"]]}
            onChange={(kind) => update(i, { kind, ...(kind === "rounded" && !o.r ? { r: 20 } : {}) })}
          />
          {o.kind === "rounded" && <Num label="Corner radius" value={o.r ?? 0} max={5000} onChange={(r) => update(i, { r })} />}
          <div className="opening-dist">
            <span>Distance from</span>
            <Seg value={o.edgeX} label="Horizontal reference edge" options={[["left", "Left"], ["right", "Right"]]} onChange={(e) => switchEdge(i, "x", e)} />
            <Num compact label={`Distance from ${o.edgeX} edge`} value={o.dx} onChange={(dx) => update(i, { dx })} />
            <span>Distance from</span>
            <Seg value={o.edgeY} label="Depth reference edge" options={[["front", "Front"], ["back", "Back"]]} onChange={(e) => switchEdge(i, "y", e)} />
            <Num compact label={`Distance from ${o.edgeY} edge`} value={o.dy} onChange={(dy) => update(i, { dy })} />
          </div>
          <div className="opening-actions" role="group" aria-label="Nudge opening">
            {(
              [
                ["Left", -1, 0, "←"],
                ["Right", 1, 0, "→"],
                ["Back", 0, -1, "↑"],
                ["Front", 0, 1, "↓"],
              ] as const
            ).map(([name, dx, dy, arrow]) => (
              <button
                key={name}
                type="button"
                title={`Move 5 mm towards the ${name.toLowerCase()} (Shift: 50 mm)`}
                onClick={(e) => nudge(i, dx * (e.shiftKey ? 50 : 5), dy * (e.shiftKey ? 50 : 5))}
              >
                {arrow} {name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="opening-add">
        {(
          [
            ["sink", "Sink"],
            ["tap", "Tap hole"],
            ["hob", "Hob"],
            ["custom", "Other"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => save([...list, preset(piece, k)])}>
            <Plus size={14} /> {label}
          </button>
        ))}
      </div>
      <p className="hint">
        Distances run from the chosen piece edge to the edge of the opening. Back is the wall side, front the bottom edge in
        the drawings.
      </p>
    </div>
  );
}
