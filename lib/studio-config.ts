/** Studio screen configuration: dialogs, save states, zoom limits, build stamp. */
/** Build stamp (date and commit) injected at build time; "dev" in tests. */
export const BUILD = typeof __BUILD_INFO__ !== "undefined" ? __BUILD_INFO__ : { commit: "dev", date: "" };

export type DialogId = "" | "slab" | "photo" | "shape" | "edges" | "openings" | "quote" | "scan" | "projects" | "export" | "checks" | "help" | "defects" | "settings";
export const dialogCopy: Record<Exclude<DialogId, "">, { title: string; description: string }> = {
  slab: { title: "Slab settings", description: "Use the actual measurements of the photographed slab." },
  photo: { title: "Adjust slab photo", description: "Straighten, correct perspective and frame the slab edges." },
  shape: { title: "Piece shape", description: "Rectangle with shaped corners, circle, arch, curved band or free form." },
  scan: { title: "Scan shapes", description: "Trace pieces from a photo of templates or a drawing." },
  edges: { title: "Edge cuts", description: "Straight or 45° mitre on each side, below or above." },
  openings: { title: "Openings", description: "Sinks, tap holes, hobs and other cut-outs, positioned from the edges." },
  quote: { title: "Quote", description: "Prices per m², per metre of edge and per cut-out; totals update as you type." },
  projects: { title: "Your projects", description: "Saved projects are available when you return." },
  export: { title: "Export project", description: "Keep a project file or share the planned layout." },
  checks: { title: "Placement checks", description: "Rectangular placement checks for the current project." },
  help: { title: "From slab to finished surface", description: "Plan the pattern before you make the cut." },
  defects: { title: "Marked defects", description: "Mark damaged areas so placement checks keep pieces clear of them." },
  settings: { title: "Settings", description: "Cutting rules for this project, and how the studio works on this computer." },
};
export type SaveState = "new" | "dirty" | "saved";
export const saveLabels: Record<SaveState, string> = {
  new: "Not saved yet",
  dirty: "Unsaved changes",
  saved: "All changes saved",
};
export type ProjectSummary = { id: string; name: string; updated: string };
export type DragState = {
  id: string;
  assembly: boolean;
  start: { x: number; y: number };
  x: number;
  y: number;
  recorded: boolean;
};
export const ZOOM_MIN = 0.5,
  ZOOM_MAX = 3,
  ZOOM_STEP = 0.25;

