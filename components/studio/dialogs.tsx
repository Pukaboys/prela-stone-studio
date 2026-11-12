"use client";
/** Simple dialog bodies of the studio: help, placement checks, defect list. */
import { Check, Plus, Trash2, TriangleAlert } from "lucide-react";
import Num from "@/components/num-field";
import type { Issue, Project, Slab } from "@/lib/model";

export function HelpContent() {
  return (
<>
            <ol className="help">
              <li>
                <b>Upload a real slab.</b> Straighten it and frame its edges,
                then enter width, height and thickness in millimetres.
              </li>
              <li>
                <b>Create your pieces.</b> Set their size and rectangular
                openings and their offsets.
              </li>
              <li>
                <b>Match the veins.</b> Move pieces on the slab. Watch the
                texture change in the assembly preview.
              </li>
              <li>
                <b>Arrange and review.</b> Arrange pieces in the 2D or 3D
                assembly. Check gaps and edges, then save or export.
              </li>
            </ol>
          
            <dl className="shortcuts">
              <dt><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd></dt>
              <dd>Move focused piece 5 mm (Shift: 50 mm)</dd>
              <dt><kbd>Ctrl</kbd><kbd>Z</kbd></dt>
              <dd>Undo</dd>
              <dt><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd></dt>
              <dd>Redo</dd>
              <dt><kbd>Ctrl</kbd><kbd>S</kbd></dt>
              <dd>Save project</dd>
              <dt><kbd>Ctrl</kbd><kbd>D</kbd></dt>
              <dd>Duplicate selected piece</dd>
              <dt><kbd>Scroll</kbd></dt>
              <dd>Rotate the piece under the pointer on the slab (Shift 1°, Ctrl 15°)</dd>
              <dt><kbd>Del</kbd></dt>
              <dd>Delete selected piece</dd>
            </dl>
          
</>
  );
}

export function ChecksContent({ warnings }: { warnings: Issue[] }) {
  return (
            <>
              {warnings.length ? (
                <ul className="warnings">
                  {warnings.map((w, i) => (
                    <li key={w.id + i}>
                      <TriangleAlert size={17} />
                      {w.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="success">
                  <Check /> All pieces clear the slab edge, blade gap, and
                  marked defects.
                </p>
              )}
              <p className="hint">
                Utilization uses the sum of rectangular piece areas before
                openings. Overlapping pieces inflate that figure. Checks do not
                validate cutting sequence, internal corner radii, or stone
                strength.
              </p>
            </>
          
  );
}

export function DefectsContent({
  project: pr,
  slab,
  change,
}: {
  project: Project;
  slab: Slab;
  change: (fn: (p: Project) => Project, record?: boolean) => void;
}) {
  return (
            <>
              <button
                onClick={() =>
                  change((p) => ({
                    ...p,
                    defects: [
                      ...p.defects,
                      {
                        id: crypto.randomUUID(),
                        slab: slab.id,
                        x: 100,
                        y: 100,
                        w: 100,
                        h: 100,
                      },
                    ],
                  }))
                }
              >
                <Plus /> Add exclusion
              </button>
              <div className="defectlist">
                {pr.defects
                  .filter((d) => d.slab === slab.id)
                  .map((d, i) => (
                    <div key={d.id}>
                      <b>Defect {i + 1}</b>
                      <div className="twocol">
                        {(["x", "y", "w", "h"] as const).map((k) => (
                          <Num
                            key={k}
                            label={k.toUpperCase()}
                            value={d[k]}
                            onChange={(n) =>
                              change((p) => ({
                                ...p,
                                defects: p.defects.map((a) =>
                                  a.id === d.id ? { ...a, [k]: n } : a,
                                ),
                              }))
                            }
                          />
                        ))}
                      </div>
                      <button
                        onClick={() =>
                          change((p) => ({
                            ...p,
                            defects: p.defects.filter((a) => a.id !== d.id),
                          }))
                        }
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  ))}
              </div>
            </>
          
  );
}
