/**
 * Working preferences for this computer / browser (not saved in projects):
 * snapping, move and rotate steps, sizes for new slabs and pieces, autosave,
 * and the cutting values new projects start with.
 */
import { CUT_DEFAULTS, type CutRules } from "@/lib/model";

export type Prefs = {
  /** Magnetic snap to edges and neighbouring pieces. */
  snap: boolean;
  /** How close (mm) a piece must come before it snaps. */
  snapDistance: number;
  /** Free movement rounds to this grid (mm). */
  grid: number;
  /** Arrow keys move a piece this far (mm); Shift × 10. */
  nudge: number;
  /** Mouse-wheel rotation step (degrees); Shift = 1°, Ctrl = 15°. */
  rotateStep: number;
  /** Thickness given to a newly uploaded slab (mm). */
  slabThickness: number;
  /** Size of a new piece (mm). */
  pieceW: number;
  pieceH: number;
  autosave: boolean;
  /** Open the last project when the studio starts. */
  reopenLast: boolean;
  /** Cutting values a new project starts with. */
  newProject: { kerf: number; margin: number } & CutRules;
};

export const DEFAULT_PREFS: Prefs = {
  snap: true,
  snapDistance: 30,
  grid: 5,
  nudge: 5,
  rotateStep: 5,
  slabThickness: 20,
  pieceW: 800,
  pieceH: 600,
  autosave: true,
  reopenLast: true,
  newProject: { kerf: 4, margin: 20, ...CUT_DEFAULTS },
};

/** Allowed range per numeric preference. */
export const PREF_LIMITS = {
  snapDistance: [1, 200],
  grid: [1, 100],
  nudge: [1, 500],
  rotateStep: [1, 90],
  slabThickness: [1, 200],
  pieceW: [10, 5000],
  pieceH: [10, 5000],
} as const;

const KEY = "jeo-studio-preferences";
const inRange = (v: unknown, [lo, hi]: readonly [number, number]) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Stored preferences merged over the defaults; anything invalid falls back. */
export function loadPrefs(): Prefs {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
  } catch {
    raw = {};
  }
  const out: Prefs = structuredClone(DEFAULT_PREFS);
  for (const k of ["snap", "autosave", "reopenLast"] as const) if (typeof raw[k] === "boolean") out[k] = raw[k] as boolean;
  for (const [k, range] of Object.entries(PREF_LIMITS) as [keyof typeof PREF_LIMITS, readonly [number, number]][])
    if (inRange(raw[k], range)) out[k] = raw[k] as number;
  const np = raw.newProject as Record<string, unknown> | undefined;
  if (np && typeof np === "object")
    for (const k of Object.keys(out.newProject) as (keyof Prefs["newProject"])[])
      if (inRange(np[k], [0, k === "kerf" || k === "margin" ? 500 : 1000])) out.newProject[k] = np[k] as number;
  return out;
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the preferences last until the window closes */
  }
}
