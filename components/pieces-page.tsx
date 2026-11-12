"use client";
/**
 * Pieces page: define every piece of the job (size, slab, orientation, edge
 * cut and opening) in one table before planning cuts on the slab layout.
 * Rows collapse into cards on narrow screens.
 */
import {
  ArrowRight,
  Check,
  Copy,
  Crosshair,
  Plus,
  ScanLine,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import Num from "@/components/num-field";
import { hasIssue, pieceArea, rotateOnSlab, slabAngleOf, type Issue, type Piece, type Project } from "@/lib/model";
import { SHAPE_LABEL } from "@/lib/shapes";
import ShapeThumb from "@/components/shape-thumb";
import { EdgeCutsBadge } from "@/components/edge-cuts";
import { edgeSummary } from "@/lib/edges";
import { openingSummary } from "@/components/openings-editor";

type Props = {
  project: Project;
  selected: string;
  warnings: Issue[];
  onSelect: (piece: Piece) => void;
  onPatch: (piece: Piece, values: Partial<Piece>) => void;
  onMoveToSlab: (piece: Piece, slabId: string) => void;
  onAdd: () => void;
  onDuplicate: (piece: Piece) => void;
  onDelete: (piece: Piece) => void;
  onPlace: (piece: Piece) => void;
  onEditShape: (piece: Piece) => void;
  onScan: () => void;
  onEditEdges: (piece: Piece) => void;
  onEditOpenings: (piece: Piece) => void;
  onContinue: () => void;
};

const m2 = (mm2: number) => (mm2 / 1e6).toFixed(2);

export default function PiecesPage({
  project,
  selected,
  warnings,
  onSelect,
  onPatch,
  onMoveToSlab,
  onAdd,
  onDuplicate,
  onDelete,
  onPlace,
  onEditShape,
  onScan,
  onEditEdges,
  onEditOpenings,
  onContinue,
}: Props) {
  const pieces = project.pieces;
  const area = pieces.reduce((a, p) => a + pieceArea(p), 0);
  const flagged = pieces.filter((p) => hasIssue(warnings, p.id)).length;

  return (
    <section className="pieces-page" aria-labelledby="pieces-title">
      <header className="pieces-head">
        <div>
          <h2 id="pieces-title">
            <span className="sectionno">01</span> Pieces
          </h2>
          <p>
            Enter every piece of the job, then plan the cuts on the slab layout. Sizes are the
            finished dimensions in millimetres.
          </p>
        </div>
        <div className="pieces-head-actions">
          <button onClick={onAdd}>
            <Plus /> Add piece
          </button>
          <button onClick={onScan}>
            <ScanLine /> Scan shapes
          </button>
          <button className="primary" onClick={onContinue} disabled={!pieces.length}>
            Plan cuts on slab <ArrowRight />
          </button>
        </div>
      </header>

      <div className="pieces-summary" role="list">
        <div role="listitem">
          <small>Pieces</small>
          <b>{pieces.length}</b>
        </div>
        <div role="listitem">
          <small>Finished area</small>
          <b>
            {m2(area)} <em>m²</em>
          </b>
        </div>
        <div role="listitem">
          <small>Slabs used</small>
          <b>{new Set(pieces.map((p) => p.slab)).size}</b>
        </div>
        <div role="listitem" className={flagged ? "warn" : "ok"}>
          <small>Placement</small>
          <b>
            {flagged ? <TriangleAlert size={16} /> : <Check size={16} />}{" "}
            {flagged ? `${flagged} need attention` : "All clear"}
          </b>
        </div>
      </div>

      {pieces.length === 0 ? (
        <div className="pieces-empty">
          <p>No pieces yet. Add the countertops, backsplashes and panels for this job.</p>
          <button className="primary" onClick={onAdd}>
            <Plus /> Add first piece
          </button>
        </div>
      ) : (
        <div className="pieces-table" role="table" aria-label="Pieces">
          <div className="pieces-row pieces-header" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Name</span>
            <span role="columnheader">Shape</span>
            <span role="columnheader">Width × height</span>
            <span role="columnheader">Slab</span>
            <span role="columnheader">Angle on slab</span>
            <span role="columnheader">Edge cuts</span>
            <span role="columnheader">Openings</span>
            <span role="columnheader" className="sr-only">
              Actions
            </span>
          </div>
          {pieces.map((p, i) => {
            const warn = warnings.filter((w) => w.id === p.id || w.related === p.id);
            return (
              <div
                key={p.id}
                role="row"
                className={"pieces-row" + (selected === p.id ? " selected" : "") + (warn.length ? " flagged" : "")}
                onFocusCapture={() => selected !== p.id && onSelect(p)}
                onClick={() => selected !== p.id && onSelect(p)}
              >
                <span role="cell" className="pc-index" data-label="#">
                  <i style={{ background: p.color }} />
                  {String(i + 1).padStart(2, "0")}
                  {warn.length > 0 && (
                    <TriangleAlert
                      className="warningicon"
                      size={14}
                      aria-label={warn.map((w) => w.text).join("; ")}
                    />
                  )}
                </span>
                <span role="cell" className="pc-name" data-label="Name">
                  <input
                    aria-label={`Piece ${i + 1} name`}
                    value={p.name}
                    maxLength={60}
                    onChange={(e) => onPatch(p, { name: e.target.value.slice(0, 60) })}
                  />
                </span>
                <span role="cell" data-label="Shape">
                  <button
                    className="pc-shape"
                    title="Edit shape"
                    aria-label={`Shape of ${p.name}: ${SHAPE_LABEL[p.shape?.kind ?? "rect"]}. Edit shape`}
                    onClick={() => onEditShape(p)}
                  >
                    <ShapeThumb piece={p} size={30} />
                    <span>{SHAPE_LABEL[p.shape?.kind ?? "rect"]}</span>
                  </button>
                </span>
                {p.shape?.kind === "bend" ? (
                  <span role="cell" className="pc-fixed" data-label="Width × height" title="Set by the curved band in the shape editor">
                    {p.w} × {p.h} mm
                  </span>
                ) : (
                  <span role="cell" className="pc-pair" data-label="Width × height">
                    <Num compact label="Width" value={p.w} min={10} onChange={(w) => onPatch(p, { w })} />
                    <b aria-hidden>×</b>
                    <Num compact label="Height" value={p.h} min={10} onChange={(h) => onPatch(p, { h })} />
                  </span>
                )}
                <span role="cell" data-label="Slab">
                  <select
                    aria-label={`Slab for ${p.name}`}
                    value={p.slab}
                    onChange={(e) => onMoveToSlab(p, e.target.value)}
                  >
                    {project.slabs.map((s, n) => (
                      <option key={s.id} value={s.id}>
                        {String(n + 1).padStart(2, "0")} · {s.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span role="cell" data-label="Angle on slab">
                  <Num
                    compact
                    label={`Angle of ${p.name} on the slab`}
                    unit="°"
                    min={-180}
                    max={180}
                    value={slabAngleOf(p)}
                    onChange={(angle) => onPatch(p, rotateOnSlab(p, angle))}
                  />
                </span>
                <span role="cell" data-label="Edge cuts">
                  <button
                    className="pc-edges"
                    title={edgeSummary(p)}
                    aria-label={`Edge cuts of ${p.name}: ${edgeSummary(p)}. Edit edge cuts`}
                    onClick={() => onEditEdges(p)}
                  >
                    <EdgeCutsBadge piece={p} />
                  </button>
                </span>
                <span role="cell" data-label="Openings">
                  <button
                    className="pc-openings"
                    title={openingSummary(p)}
                    aria-label={`Openings of ${p.name}: ${openingSummary(p)}. Edit openings`}
                    onClick={() => onEditOpenings(p)}
                  >
                    <span>{openingSummary(p)}</span>
                  </button>
                </span>
                <span role="cell" className="pc-actions">
                  <button title="Show on slab layout" aria-label={`Show ${p.name} on slab layout`} onClick={() => onPlace(p)}>
                    <Crosshair size={15} />
                  </button>
                  <button title="Duplicate" aria-label={`Duplicate ${p.name}`} onClick={() => onDuplicate(p)}>
                    <Copy size={15} />
                  </button>
                  <button
                    className="danger"
                    title="Delete"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => onDelete(p)}
                  >
                    <Trash2 size={15} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {pieces.length > 0 && (
        <div className="pieces-foot">
          <button className="textbutton" onClick={onAdd}>
            <Plus size={16} /> Add another piece
          </button>
          <span>
            New pieces are placed in the first free spot on their slab, {Math.max(4, project.kerf)} mm
            apart.
          </span>
        </div>
      )}
    </section>
  );
}
