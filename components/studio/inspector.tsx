"use client";
/** Right-hand panel: properties of the selected piece and global cutting parameters. */
import { ArrowUpRight, Copy, RotateCw, SlidersHorizontal, Trash2 } from "lucide-react";
import EdgeCutsEditor from "@/components/edge-cuts";
import Num from "@/components/num-field";
import OpeningsEditor from "@/components/openings-editor";
import ShapeThumb from "@/components/shape-thumb";
import { rotateOnSlab, slabAngleOf, type Piece, type Project, type Slab } from "@/lib/model";
import { SHAPE_LABEL } from "@/lib/shapes";
import type { DialogId } from "@/lib/studio-config";

export default function Inspector({
  project: pr,
  piece,
  slab,
  patch,
  change,
  setDialog,
  moveToSlab,
  duplicatePiece,
  deletePiece,
}: {
  project: Project;
  piece?: Piece;
  slab: Slab;
  patch: (values: Partial<Piece>) => void;
  change: (fn: (p: Project) => Project, record?: boolean) => void;
  setDialog: (d: DialogId) => void;
  moveToSlab: (piece: Piece, slabId: string) => void;
  duplicatePiece: (piece: Piece) => void;
  deletePiece: (piece: Piece) => void;
}) {
  return (
    <aside className="inspector">
      <div className="panelhead">
        <h2>Piece properties</h2>
        <SlidersHorizontal size={17} />
      </div>
      {piece ? (
        <>
          <div className="selectionlabel">
            <span style={{ background: piece.color }} /> SELECTED PIECE
          </div>
          <label className="field">
            <span>Name</span>
            <input
              value={piece.name}
              onChange={(e) => patch({ name: e.target.value.slice(0, 60) })}
            />
          </label>
          <button className="shape-entry" onClick={() => setDialog("shape")}>
            <ShapeThumb piece={piece} size={46} />
            <span>
              <b>{SHAPE_LABEL[piece.shape?.kind ?? "rect"]}</b>
              <small>Edit shape, corners and curves</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
          {piece.shape?.kind === "bend" ? (
            <p className="hint">
              Size {piece.w} × {piece.h} mm, set by the curved band&apos;s
              values in the shape editor.
            </p>
          ) : (
          <div className="twocol">
            <Num
              label="Width"
              value={piece.w}
              min={10}
              onChange={(w) => patch({ w })}
            />
            <Num
              label="Height"
              value={piece.h}
              min={10}
              onChange={(h) => patch({ h })}
            />
          </div>
          )}
          <h3>Position on slab</h3>
          {piece.slab !== slab.id && (
            <button
              className="fullbutton"
              onClick={() => moveToSlab(piece, slab.id)}
            >
              Move to selected slab
            </button>
          )}
          <div className="twocol">
            <Num label="X" value={piece.x} min={-20000} onChange={(x) => patch({ x })} />
            <Num label="Y" value={piece.y} min={-20000} onChange={(y) => patch({ y })} />
          </div>
          <div className="slab-angle">
            <Num
              label="Angle on slab"
              unit="°"
              min={-180}
              max={180}
              value={slabAngleOf(piece)}
              onChange={(a) => patch(rotateOnSlab(piece, a))}
            />
            <button
              type="button"
              title="Reset the angle to 0°"
              disabled={!slabAngleOf(piece)}
              onClick={() => patch(rotateOnSlab(piece, 0))}
            >
              <RotateCw size={15} /> 0°
            </button>
          </div>
          <p className="hint">
            Scroll over the piece on the slab to rotate it: 5° per step,
            Shift for 1°, Ctrl for 15°.
          </p>
          <h3>Edge cuts</h3>
          <EdgeCutsEditor
            piece={piece}
            thickness={pr.slabs.find((x) => x.id === piece.slab)?.thickness ?? 20}
            onPatch={patch}
          />
          <h3>Assembly position</h3>
          <div className="twocol">
            <Num
              label="X"
              value={piece.ax}
              max={50000}
              onChange={(ax) => patch({ ax })}
            />
            <Num
              label="Y"
              value={piece.ay}
              max={50000}
              onChange={(ay) => patch({ ay })}
            />
          </div>
          <Num
            label="Z height"
            value={piece.az ?? 0}
            max={50000}
            onChange={(az) => patch({ az })}
          />
          <h3>Assembly rotation</h3>
          <div className="twocol">
            {(["rx", "ry", "rz"] as const).map((key, i) => (
              <Num
                key={key}
                label={["X tilt", "Y tilt", "Z turn"][i]}
                value={piece[key] ?? 0}
                min={-360}
                max={360}
                unit="°"
                onChange={(angle) => patch({ [key]: angle })}
              />
            ))}
          </div>
          <button
            className="fullbutton"
            onClick={() => patch({ rx: 0, ry: 0, rz: 0 })}
          >
            Reset assembly rotation
          </button>
          <p className="hint">
            Z is vertical height. Rotation is around the piece origin; X/Y
            tilt it upright and Z turns it on the assembly plane.
          </p>
          <h3>Openings</h3>
          <OpeningsEditor piece={piece} onPatch={patch} />
          <div className="pieceactions">
            <button
              title="Duplicate piece (Ctrl+D)"
              onClick={() => duplicatePiece(piece)}
            >
              <Copy size={15} /> Duplicate
            </button>
            <button
              className="danger"
              title="Delete piece (Del)"
              aria-label="Delete selected piece"
              onClick={() => deletePiece(piece)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </>
      ) : (
        <p className="hint">Select a piece on the slab or add a new one.</p>
      )}
      <div className="cutsettings">
          <h3>Global cutting parameters</h3>
        <div className="twocol">
          <Num
              label="Saw thickness"
            value={pr.kerf}
            max={500}
            onChange={(kerf) => change((p) => ({ ...p, kerf }))}
          />
          <Num
            label="Edge trim"
            value={pr.margin}
            max={500}
            onChange={(margin) => change((p) => ({ ...p, margin }))}
          />
        </div>
        <button className="textbutton" onClick={() => setDialog("defects")}>
          Manage slab defects <ArrowUpRight size={14} />
        </button>
        <button className="textbutton" onClick={() => setDialog("settings")}>
          More cutting rules and settings <ArrowUpRight size={14} />
        </button>
      </div>
    </aside>
  );
}
