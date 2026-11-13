"use client";
/**
 * Studio settings: cutting rules saved with the project, and working
 * preferences for this computer.
 */
import Num from "@/components/num-field";
import { CUT_DEFAULTS, cutRules, type CutRules, type Project } from "@/lib/model";
import { DEFAULT_PREFS, PREF_LIMITS, type Prefs } from "@/lib/preferences";

type Change = (fn: (p: Project) => Project, record?: boolean) => void;

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export default function SettingsContent({
  project,
  change,
  prefs,
  setPrefs,
  notify,
}: {
  project: Project;
  change: Change;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  notify: (text: string) => void;
}) {
  const rules = cutRules(project);
  const setRule = (k: keyof CutRules) => (v: number) => change((p) => ({ ...p, cut: { ...p.cut, [k]: v } }));
  const pref = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs({ ...prefs, [k]: v });
  const lim = (k: keyof typeof PREF_LIMITS) => ({ min: PREF_LIMITS[k][0], max: PREF_LIMITS[k][1] });

  return (
    <div className="settings">
      <section>
        <h3>Cutting rules · this project</h3>
        <p className="hint">Saved with the project. The placement checks, magnetic snap and Auto-arrange follow them.</p>
        <div className="settings-grid">
          <Num label="Saw blade thickness" value={project.kerf} max={500} onChange={(kerf) => change((p) => ({ ...p, kerf }))} />
          <Num label="Edge trim (each slab side)" value={project.margin} max={500} onChange={(margin) => change((p) => ({ ...p, margin }))} />
          <Num label="Space between pieces" value={rules.gap} max={1000} onChange={setRule("gap")} />
          <Num label="Distance from defects" value={rules.defectClearance} max={1000} onChange={setRule("defectClearance")} />
          <Num label="Cut-out to piece edge (0 = off)" value={rules.openingEdge} max={1000} onChange={setRule("openingEdge")} />
          <Num label="Between cut-outs (0 = saw only)" value={rules.openingGap} max={1000} onChange={setRule("openingGap")} />
        </div>
        <p className="hint">
          Pieces always keep at least the saw thickness apart ({Math.max(rules.gap, project.kerf)} mm now). A cut-out closer than the set distance to the edge, or to another
          cut-out, is listed in the placement checks.
        </p>
        <div className="settings-actions">
          <button
            onClick={() => {
              setPrefs({ ...prefs, newProject: { kerf: project.kerf, margin: project.margin, ...rules } });
              notify("New projects will start with these cutting rules.");
            }}
          >
            Use for new projects
          </button>
          <button
            className="quiet"
            onClick={() => change((p) => ({ ...p, kerf: DEFAULT_PREFS.newProject.kerf, margin: DEFAULT_PREFS.newProject.margin, cut: { ...CUT_DEFAULTS } }))}
          >
            Standard values
          </button>
        </div>
      </section>

      <section>
        <h3>Working · this computer</h3>
        <p className="hint">Kept on this computer or browser, for every project.</p>
        <Toggle label="Magnetic snap" hint="Pieces snap to the edge trim and to neighbours, keeping the space between pieces." checked={prefs.snap} onChange={pref("snap")} />
        <div className="settings-grid">
          <Num label="Snap distance" value={prefs.snapDistance} {...lim("snapDistance")} onChange={pref("snapDistance")} />
          <Num label="Move grid" value={prefs.grid} {...lim("grid")} onChange={pref("grid")} />
          <Num label="Arrow-key step (Shift × 10)" value={prefs.nudge} {...lim("nudge")} onChange={pref("nudge")} />
          <Num label="Wheel rotation step" unit="°" value={prefs.rotateStep} {...lim("rotateStep")} onChange={pref("rotateStep")} />
          <Num label="New slab thickness" value={prefs.slabThickness} {...lim("slabThickness")} onChange={pref("slabThickness")} />
          <Num label="New piece width" value={prefs.pieceW} {...lim("pieceW")} onChange={pref("pieceW")} />
          <Num label="New piece height" value={prefs.pieceH} {...lim("pieceH")} onChange={pref("pieceH")} />
        </div>
        <Toggle label="Autosave" hint="Save a few seconds after each change." checked={prefs.autosave} onChange={pref("autosave")} />
        <Toggle label="Open the last project on start" checked={prefs.reopenLast} onChange={pref("reopenLast")} />
        <div className="settings-actions">
          <button
            className="quiet"
            onClick={() => {
              setPrefs({ ...DEFAULT_PREFS, newProject: prefs.newProject });
              notify("Working preferences reset.");
            }}
          >
            Reset working preferences
          </button>
        </div>
      </section>
    </div>
  );
}
