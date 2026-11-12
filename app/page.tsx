"use client";
import { useState, useRef, useEffect } from "react";
import Assembly3D from "@/components/assembly-3d";
import Num from "@/components/num-field";
import OpeningsEditor from "@/components/openings-editor";
import SignIn from "@/components/sign-in";
import QuotePanel from "@/components/quote-panel";
import SyncPanel from "@/components/sync-panel";
import ShapeThumb from "@/components/shape-thumb";
import EdgeCutsEditor from "@/components/edge-cuts";
import { edgeCutsOf, mitreStrips } from "@/lib/edges";
import ShapeEditor from "@/components/shape-editor";
import ShapeScanner, { type ScannedShape } from "@/components/shape-scanner";
import { SHAPE_LABEL, pathD, pieceOutline } from "@/lib/shapes";
import PiecesPage from "@/components/pieces-page";
import AssemblyPad, { applyDelta } from "@/components/assembly-pad";
import type { ModelFormat } from "@/lib/export-3d";
import PhotoEditor, { bakeEdit, type EditSettings } from "@/components/photo-editor";
import {
  Plus,
  Upload,
  RotateCw,
  Undo2,
  Redo2,
  Download,
  Save,
  FolderOpen,
  Layers,
  ScanLine,
  Move,
  Trash2,
  Check,
  TriangleAlert,
  Maximize2,
  ArrowUpRight,
  Copy,
  SlidersHorizontal,
  ZoomIn,
  ZoomOut,
  LayoutGrid,
  Wand2,
  FlipHorizontal2,
  Printer,
  Receipt,
  LogOut,
  Crop,
  Box,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  demo,
  colors,
  footprint,
  issues,
  hasIssue,
  pieceGap,
  findFreeSpot,
  removeSlab,
  placement,
  rotateOnSlab,
  slabAngleOf,
  pieceArea,
  pieceHoles,
  validProject,
  slabCrop,
  slabImageRect,
  type Project,
  type Piece,
  type PhotoCrop,
  type Defect,
  type Slab,
} from "@/lib/model";
/** Slab photo thumbnail with a clear placeholder when the photo is not in this copy. */
function SlabThumb({ src, alt, mirror }: { src: string; alt: string; mirror?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <span className="thumb-missing" role="img" aria-label={`${alt}: photo missing`}>
        Photo missing
        <small>Use Replace photo in Slab settings</small>
      </span>
    );
  return <img src={src} alt={alt} className={mirror ? "mirrored" : undefined} onError={() => setFailed(true)} />;
}
function ZoomBoard({
  zoom,
  children,
  className = "",
}: {
  zoom: number;
  children: React.ReactNode;
  className?: string;
}) {
  const inner = useRef<HTMLDivElement>(null),
    [height, setHeight] = useState(0);
  useEffect(() => {
    const svg = inner.current?.querySelector("svg");
    if (!svg) return;
    const observer = new ResizeObserver(() => setHeight(svg.clientHeight));
    observer.observe(svg);
    setHeight(svg.clientHeight);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className={"board-scroll " + className}
      style={height ? { height } : undefined}
    >
      <div
        ref={inner}
        className="board-inner zoom-board"
        style={
          {
            width: zoom * 100 + "%",
            minWidth: 0,
            height: height ? height * zoom : undefined,
            "--board-zoom": zoom,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

function cropPoint(e: React.PointerEvent<HTMLDivElement>, host: HTMLDivElement) {
  const r = host.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
  };
}

function DefectPainter({ slab, crop, defects, onAdd }: { slab: Slab; crop: PhotoCrop; defects: Defect[]; onAdd: (defect: Defect) => void }) {
  const host = useRef<HTMLDivElement>(null), stroke = useRef<{ x: number; y: number }[]>([]), c = crop; const [draft, setDraft] = useState<{ x: number; y: number }[]>([]); const [brush, setBrush] = useState(45);
  function toSlab(e: React.PointerEvent<HTMLDivElement>) { if (!host.current) return { x: 0, y: 0 }; const p = cropPoint(e, host.current); return { x: p.x * slab.w, y: p.y * slab.h }; }
  function begin(e: React.PointerEvent<HTMLDivElement>) { stroke.current = [toSlab(e)]; setDraft(stroke.current); host.current?.setPointerCapture(e.pointerId); }
  function move(e: React.PointerEvent<HTMLDivElement>) { if (!stroke.current.length) return; const p = toSlab(e), last = stroke.current[stroke.current.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) < 8) return; stroke.current = [...stroke.current, p]; setDraft(stroke.current); }
  function finish(e: React.PointerEvent<HTMLDivElement>) { if (stroke.current.length < 2) { stroke.current = []; setDraft([]); return; } const points = stroke.current, xs = points.map((p) => p.x), ys = points.map((p) => p.y); onAdd({ id: crypto.randomUUID(), slab: slab.id, x: Math.min(...xs) - brush / 2, y: Math.min(...ys) - brush / 2, w: Math.max(brush, Math.max(...xs) - Math.min(...xs) + brush), h: Math.max(brush, Math.max(...ys) - Math.min(...ys) + brush), points, brush }); stroke.current = []; setDraft([]); host.current?.releasePointerCapture(e.pointerId); }
  function line(points: { x: number; y: number }[]) { return points.map((p) => `${p.x},${p.y}`).join(" "); }
  const previewAspect = ((c.w * (slab.photoWidth ?? slab.w)) / (c.h * (slab.photoHeight ?? slab.h)));
  return <div><div ref={host} className="defect-painter" style={{ aspectRatio: previewAspect }} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { stroke.current = []; setDraft([]); }}><img src={slab.image} alt="Slab defect painting surface" style={{ left: `${-c.x * 100 / c.w}%`, top: `${-c.y * 100 / c.h}%`, width: `${100 / c.w}%`, height: `${100 / c.h}%`, transform: slab.mirror ? "scaleX(-1)" : undefined }} /><svg viewBox={`0 0 ${slab.w} ${slab.h}`} preserveAspectRatio="none">{defects.map((d) => d.points?.length ? <polyline key={d.id} points={line(d.points)} fill="none" stroke="#ff625b" strokeWidth={d.brush ?? brush} strokeLinecap="round" strokeLinejoin="round" /> : <rect key={d.id} x={d.x} y={d.y} width={d.w} height={d.h} fill="#f46d6888" stroke="#ff7770" />)}{draft.length > 1 && <polyline points={line(draft)} fill="none" stroke="#ffd166" strokeWidth={brush} strokeLinecap="round" strokeLinejoin="round" />}</svg></div><label className="brush-control">Brush size <input type="range" min="10" max="180" value={brush} onChange={(e) => setBrush(Number(e.target.value))} /><span>{brush} mm</span></label><p className="hint">Paint defects freely with the brush over damaged areas of the slab.</p></div>;
}
/** Build stamp (date and commit) injected at build time; "dev" in tests. */
const BUILD = typeof __BUILD_INFO__ !== "undefined" ? __BUILD_INFO__ : { commit: "dev", date: "" };

type DialogId = "" | "slab" | "photo" | "shape" | "edges" | "openings" | "quote" | "scan" | "projects" | "export" | "checks" | "help" | "defects";
const dialogCopy: Record<Exclude<DialogId, "">, { title: string; description: string }> = {
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
};
type SaveState = "new" | "dirty" | "saved";
const saveLabels: Record<SaveState, string> = {
  new: "Not saved yet",
  dirty: "Unsaved changes",
  saved: "All changes saved",
};
type ProjectSummary = { id: string; name: string; updated: string };
type DragState = {
  id: string;
  assembly: boolean;
  start: { x: number; y: number };
  x: number;
  y: number;
  recorded: boolean;
};
const ZOOM_MIN = 0.5,
  ZOOM_MAX = 3,
  ZOOM_STEP = 0.25;

/**
 * Entry: when the website has a team password (STUDIO_PASSWORD), show the
 * sign-in screen until this browser has a session; otherwise open directly.
 */
export default function Studio() {
  const [auth, setAuth] = useState<{ required: boolean; signedIn: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ required: boolean; signedIn: boolean }>)
      .then(setAuth)
      .catch(() => setAuth({ required: false, signedIn: true }));
  }, []);
  if (!auth) return <main className="studio" aria-busy="true" />;
  if (auth.required && !auth.signedIn)
    return <SignIn onSignedIn={() => setAuth({ required: true, signedIn: true })} />;
  return <StudioApp canSignOut={auth.required} />;
}

function StudioApp({ canSignOut }: { canSignOut: boolean }) {
  const [pr, setPr] = useState<Project>(demo),
    [sid, setSid] = useState("s1"),
    [selected, setSelected] = useState("p1"),
    [view, setView] = useState("pieces"),
    [dialog, setDialog] = useState<DialogId>(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<SaveState>("new"),
    [projects, setProjects] = useState<ProjectSummary[]>([]),
    [loadError, setLoadError] = useState(""),
    [zoom, setZoom] = useState(1),
    [showLabels, setShowLabels] = useState(true),
    [assembly3d, setAssembly3d] = useState(true);
  const replacePhoto = useRef(false);
  const past = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    [historyTick, historyUpdate] = useState(0),
    file = useRef<HTMLInputElement>(null),
    jsonFile = useRef<HTMLInputElement>(null),
    drag = useRef<DragState | null>(null),
    current = useRef(pr);
  current.current = pr;
  const slab = pr.slabs.find((s) => s.id === sid) || pr.slabs[0],
    piece = pr.pieces.find((p) => p.id === selected),
    photoCrop = slabCrop(slab),
    slabImage = slabImageRect(slab),
    warnings = issues(pr),
    slabPieces = pr.pieces.filter((p) => p.slab === slab.id);
  const used =
    (slabPieces.reduce((a, p) => a + pieceArea(p), 0) / (slab.w * slab.h)) * 100;
  const assemblyCorners = pr.pieces.flatMap((p) => {
    const angle = ((p.rz ?? 0) * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle);
    return [
      [0, 0],
      [p.w, 0],
      [p.w, p.h],
      [0, p.h],
    ].map(([x, y]) => ({ x: p.ax + x * c - y * s, y: p.ay + x * s + y * c }));
  });
  const assemblyMinX = Math.min(0, ...assemblyCorners.map((p) => p.x)),
    assemblyMinY = Math.min(0, ...assemblyCorners.map((p) => p.y));
  const aw = Math.max(
      2200,
      Math.max(0, ...assemblyCorners.map((p) => p.x)) - assemblyMinX + 100,
    ),
    ah = Math.max(
      1500,
      Math.max(0, ...assemblyCorners.map((p) => p.y)) - assemblyMinY + 100,
    );
  function checkpoint() {
    past.current.push(structuredClone(current.current));
    if (past.current.length > 50) past.current.shift();
    future.current = [];
    historyUpdate((x) => x + 1);
  }
  function change(fn: (p: Project) => Project, record = true) {
    if (record) checkpoint();
    setPr((p) => fn(p));
    setSaved("dirty");
  }
  function patch(v: Partial<Piece>) {
    if (piece)
      change((p) => ({
        ...p,
        pieces: p.pieces.map((q) => (q.id === piece.id ? { ...q, ...v } : q)),
      }));
  }
  function undo(redo = false) {
    const src = redo ? future : past,
      dst = redo ? past : future;
    const p = src.current.pop();
    if (p) {
      dst.current.push(current.current);
      setPr(p);
      setSaved("dirty");
      historyUpdate((x) => x + 1);
    }
  }
  function addPiece() {
    const id = crypto.randomUUID();
    change((p) => {
      const spot = findFreeSpot(p, slab.id, 800, 600) ?? { x: p.margin, y: p.margin };
      return {
      ...p,
      pieces: [
        ...p.pieces,
        {
          id,
          name: "Piece " + (p.pieces.length + 1),
          slab: slab.id,
          w: 800,
          h: 600,
          x: spot.x,
          y: spot.y,
          ax: 0,
          ay: Math.max(0, ...p.pieces.map((q) => q.ay + q.h + 20)),
          rot: false,
          holeW: 0,
          holeH: 0,
          holeEdgeX: "left",
          holeDX: 0,
          holeEdgeY: "front",
          holeDY: 0,
          color: colors[p.pieces.length % colors.length],
        },
      ],
      };
    });
    setSelected(id);
  }
  function duplicatePiece(source: Piece) {
    const id = crypto.randomUUID();
    change((p) => {
      const f = footprint(source);
      const spot = findFreeSpot(p, source.slab, f.w, f.h) ?? {
        x: source.x + 50,
        y: source.y + 50,
      };
      return {
      ...p,
      pieces: [
        ...p.pieces,
        {
          ...source,
          id,
          name: (source.name + " copy").slice(0, 60),
          x: spot.x,
          y: spot.y,
          ax: source.ax + 50,
          ay: source.ay + 50,
          color: colors[p.pieces.length % colors.length],
        },
      ],
      };
    });
    setSelected(id);
  }
  /**
   * Delete a slab and its defect marks. Its pieces are not lost: they move to
   * the first remaining slab, each into a free spot. The last slab cannot be
   * deleted because a project needs at least one.
   */
  function deleteSlab(target: Slab) {
    const before = current.current;
    const rest = before.slabs.filter((s) => s.id !== target.id);
    if (!rest.length) {
      toast.error("A project needs at least one slab.");
      return;
    }
    const moving = before.pieces.filter((p) => p.slab === target.id);
    const question = moving.length
      ? `Delete slab “${target.name}”?\n\nIts ${moving.length} piece${moving.length > 1 ? "s" : ""} will move to “${rest[0].name}”.`
      : `Delete slab “${target.name}”?`;
    if (!window.confirm(question)) return;
    change((p) => removeSlab(p, target.id));
    if (sid === target.id) setSid(rest[0].id);
    if (dialog === "slab" || dialog === "photo") setDialog("");
    toast(`Deleted slab “${target.name}”`, {
      description: moving.length ? `${moving.length} piece${moving.length > 1 ? "s" : ""} moved to “${rest[0].name}”.` : undefined,
      action: { label: "Undo", onClick: () => undo() },
    });
  }
  /** Add each scanned shape as a free-form piece in the first free spot. */
  function addScannedPieces(shapes: ScannedShape[]) {
    if (!shapes.length) return;
    let firstId = "";
    change((p) => {
      let next = p;
      shapes.forEach((sh, n) => {
        const id = crypto.randomUUID();
        if (!n) firstId = id;
        const spot = findFreeSpot(next, slab.id, sh.w, sh.h) ?? { x: next.margin, y: next.margin };
        next = {
          ...next,
          pieces: [
            ...next.pieces,
            {
              id,
              name: `Scanned ${next.pieces.length + 1}`,
              slab: slab.id,
              w: sh.w,
              h: sh.h,
              ...spot,
              ax: 0,
              ay: Math.max(0, ...next.pieces.map((q) => q.ay + q.h + 20)),
              rot: false,
              holeW: 0,
              holeH: 0,
              color: colors[next.pieces.length % colors.length],
              shape: { kind: "polygon", points: sh.points },
            },
          ],
        };
      });
      return next;
    });
    if (firstId) setSelected(firstId);
    setDialog("");
    toast.success(`Added ${shapes.length} scanned piece${shapes.length > 1 ? "s" : ""}`);
  }
  /** Automatic layout; `onlyProblems` keeps well-placed pieces where they are. */
  async function arrange(onlyProblems: boolean) {
    const { autoArrange } = await import("@/lib/nesting");
    const r = autoArrange(current.current, { onlyProblems });
    if (!r.placed && !r.unplaced.length) return;
    change(() => r.project);
    const left = issues(r.project).length;
    const msg = `${r.placed} piece${r.placed === 1 ? "" : "s"} placed${r.unplaced.length ? `; no room for ${r.unplaced.join(", ")}` : ""}`;
    if (r.unplaced.length || left) toast.warning(msg, { description: left ? `${left} placement issue${left === 1 ? "" : "s"} left. Add a slab or resize pieces.` : undefined, action: { label: "Undo", onClick: () => undo() } });
    else toast.success(msg, { action: { label: "Undo", onClick: () => undo() } });
  }
  /** Patch any piece by id (the inspector's `patch` only edits the selection). */
  function patchPiece(id: string, values: Partial<Piece>, record = true) {
    change(
      (p) => ({ ...p, pieces: p.pieces.map((q) => (q.id === id ? { ...q, ...values } : q)) }),
      record,
    );
  }
  /** Move a piece to another slab, into its first free spot. */
  function moveToSlab(target: Piece, slabId: string) {
    const f = footprint(target);
    const spot = findFreeSpot(current.current, slabId, f.w, f.h, target.id) ?? {
      x: current.current.margin,
      y: current.current.margin,
    };
    patchPiece(target.id, { slab: slabId, ...spot });
    setSelected(target.id);
    setSid(slabId);
  }
  function deletePiece(target: Piece) {
    change((p) => ({
      ...p,
      pieces: p.pieces.filter((q) => q.id !== target.id),
    }));
    setSelected("");
    toast(`Deleted “${target.name}”`, {
      action: { label: "Undo", onClick: () => undo() },
    });
  }
  /** Save to this copy's project store; returns the project id, or null on failure. */
  async function save(): Promise<string | null> {
    setBusy(true);
    try {
      const snapshot = current.current;
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      if (!r.ok) throw Error(await r.text());
      const { id } = (await r.json()) as { id: string };
      setPr((p) => ({ ...p, id }));
      setSaved(
        current.current === snapshot ? "saved" : "dirty",
      );
      toast.success("Project saved");
      return id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function openProjects() {
    setDialog("projects");
    setLoadError("");
    setProjects([]);
    try {
      const r = await fetch("/api/projects");
      if (!r.ok) throw Error(await r.text());
      setProjects(await r.json());
    } catch (e) {
      setLoadError(String(e));
    }
  }
  async function load(id: string) {
    if (
      saved === "dirty" &&
      !window.confirm("Open this project and discard unsaved changes?")
    )
      return;
    try {
      const r = await fetch("/api/projects?id=" + id);
      if (!r.ok) throw Error(await r.text());
      const p = await r.json();
      if (!validProject(p)) throw Error("This project could not be read.");
      checkpoint();
      setPr(p);
      setSid(p.slabs[0].id);
      setSelected(p.pieces[0]?.id || "");
      setSaved("saved");
      setDialog("");
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function upload(f?: File) {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      toast.error(
        "Choose JPG, PNG, or WebP. For iPhone photos, export as JPG.",
      );
      return;
    }
    if (f.size > 25000000) {
      toast.error("Choose an image under 25 MB.");
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(f);
      const photoWidth = bitmap.width,
        photoHeight = bitmap.height;
      const scale = Math.min(1, 2400 / Math.max(photoWidth, photoHeight));
      const c = document.createElement("canvas");
      c.width = photoWidth * scale;
      c.height = photoHeight * scale;
      c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        c.toBlob(
          (b) => (b ? resolve(b) : reject(Error("Could not process image"))),
          "image/jpeg",
          0.92,
        ),
      );
      const r = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      if (!r.ok) throw Error(await r.text());
      const { url } = (await r.json()) as { url: string },
        id = crypto.randomUUID();
      const replacement = replacePhoto.current;
      const targetId = replacement ? sid : id;
      const targetW = replacement ? slab.w : 3200;
      const targetH = replacement ? slab.h : 2000;
      const sourceAspect = photoWidth / photoHeight;
      const targetAspect = targetW / targetH;
      const crop = sourceAspect > targetAspect
        ? { x: (1 - targetAspect / sourceAspect) / 2, y: 0, w: targetAspect / sourceAspect, h: 1 }
        : { x: 0, y: (1 - sourceAspect / targetAspect) / 2, w: 1, h: sourceAspect / targetAspect };
      change((p) => {
        const next = {
          id: targetId,
          name: f.name.replace(/\.[^.]+$/, ""),
          w: targetW,
          h: targetH,
          thickness: replacement ? slab.thickness : 20,
          image: url,
          photoWidth,
          photoHeight,
          crop,
          // A new photo invalidates any corner calibration or adjustments
          // made for the previous one.
          calibration: undefined,
          adjustments: undefined,
          edit: undefined,
        };
        return { ...p, slabs: replacement ? p.slabs.map((s) => s.id === sid ? { ...s, ...next } : s) : [...p.slabs, next] };
      });
      replacePhoto.current = false;
      setSid(targetId);
      setDialog("photo");
      toast.success(
        "Photo uploaded. Straighten and frame the slab, then confirm its dimensions.",
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  /** Bake the editor settings into a corrected photo and use it for the slab. */
  async function applyPhotoEdit(image: HTMLImageElement, settings: EditSettings) {
    const target = slab;
    const source = target.edit?.source ?? target.image;
    try {
      const baked = await bakeEdit(image, settings, target.w / target.h);
      const r = await fetch("/api/images", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: baked.blob,
      });
      if (!r.ok) throw Error(await r.text());
      const { url } = (await r.json()) as { url: string };
      change((p) => ({
        ...p,
        slabs: p.slabs.map((s) =>
          s.id === target.id
            ? {
                ...s,
                image: url,
                photoWidth: baked.width,
                photoHeight: baked.height,
                crop: { x: 0, y: 0, w: 1, h: 1 },
                calibration: undefined,
                adjustments: undefined,
                edit: { source, ...settings },
              }
            : s,
        ),
      }));
      setDialog("slab");
      toast.success("Slab photo straightened and framed.");
    } catch (e) {
      toast.error(String(e));
    }
  }
  function point(e: React.PointerEvent<SVGElement>) {
    const svg =
      e.currentTarget.ownerSVGElement || (e.currentTarget as SVGSVGElement);
    const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.getScreenCTM()!.inverse(),
    );
    return { x: q.x, y: q.y };
  }
  function start(
    e: React.PointerEvent<SVGElement>,
    p: Piece,
    assembly = false,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(p.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    const q = point(e);
    drag.current = {
      id: p.id,
      assembly,
      start: q,
      x: assembly ? p.ax : p.x,
      y: assembly ? p.ay : p.y,
      recorded: false,
    };
  }
  /**
   * Magnetic snap on the slab. Pieces snap to the edge trim, align with a
   * neighbour's left/right (top/bottom) edge, or sit next to it with exactly
   * `pieceGap` mm of space (4 mm, or the saw thickness if larger). A snapped
   * axis keeps its exact value; a free axis rounds to a 5 mm grid.
   */
  function snapPosition(project: Project, moving: Piece, x: number, y: number) {
    const slab = project.slabs.find((s) => s.id === moving.slab);
    const grid = (v: number) => Math.max(0, Math.round(v / 5) * 5);
    if (!slab) return { x: grid(x), y: grid(y) };
    const f = footprint(moving),
      gap = pieceGap(project),
      threshold = 30,
      xs = [project.margin, slab.w - project.margin - f.w],
      ys = [project.margin, slab.h - project.margin - f.h];
    for (const other of project.pieces) {
      if (other.id === moving.id || other.slab !== moving.slab) continue;
      const o = footprint(other);
      xs.push(other.x, other.x + o.w - f.w, other.x + o.w + gap, other.x - f.w - gap);
      ys.push(other.y, other.y + o.h - f.h, other.y + o.h + gap, other.y - f.h - gap);
    }
    const snap = (value: number, candidates: number[]) => {
      let best = value,
        distance = threshold;
      for (const c of candidates)
        if (c >= 0 && Math.abs(c - value) <= distance) {
          best = c;
          distance = Math.abs(c - value);
        }
      return distance < threshold || best !== value ? best : grid(value);
    };
    return { x: snap(x, xs), y: snap(y, ys) };
  }
  function move(e: React.PointerEvent<SVGElement>) {
    if (!drag.current) return;
    const d = drag.current,
      q = point(e);
    const rawX = d.x + q.x - d.start.x,
      rawY = d.y + q.y - d.start.y;
    let x = Math.max(0, Math.round(rawX / 5) * 5),
      y = Math.max(0, Math.round(rawY / 5) * 5);
    if (!d.assembly) {
      const moving = current.current.pieces.find((p) => p.id === d.id);
      if (moving) {
        const snapped = snapPosition(current.current, moving, rawX, rawY);
        x = snapped.x;
        y = snapped.y;
      }
    }
    if (x === d.x && y === d.y && !d.recorded) return;
    if (!d.recorded) {
      checkpoint();
      d.recorded = true;
    }
    change(
      (p) => ({
        ...p,
        pieces: p.pieces.map((a) =>
          a.id === d.id
            ? { ...a, ...(d.assembly ? { ax: x, ay: y } : { x, y }) }
            : a,
        ),
      }),
      false,
    );
  }
  function keys(
    e: React.KeyboardEvent<SVGGElement>,
    p: Piece,
    assembly = false,
  ) {
    const v: Record<string, number[]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!v[e.key]) return;
    e.preventDefault();
    const step = e.shiftKey ? 50 : 5;
    const [dx, dy] = v[e.key];
    change((a) => ({
      ...a,
      pieces: a.pieces.map((q) =>
        q.id === p.id
          ? {
              ...q,
              ...(assembly
                ? {
                    ax: Math.max(0, q.ax + dx * step),
                    ay: Math.max(0, q.ay + dy * step),
                  }
                : {
                    x: Math.max(0, q.x + dx * step),
                    y: Math.max(0, q.y + dy * step),
                  }),
            }
          : q,
      ),
    }));
  }
  function download(data: Blob, name: string) {
    const u = URL.createObjectURL(data),
      a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  const fileBase = () =>
    (pr.name || "prela-assembly")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "prela-assembly";
  /** Backup file with the slab photos embedded, so it opens in any copy of the studio. */
  async function exportBackup() {
    const id = toast.loading("Preparing backup with slab photos…");
    try {
      const { createBackup } = await import("@/lib/backup");
      const blob = await createBackup(current.current);
      download(blob, `${fileBase()}-backup.json`);
      toast.success(`Backup downloaded (${(blob.size / 1e6).toFixed(1)} MB, photos included)`, { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    }
  }
  async function exportModel(format: ModelFormat) {
    const id = toast.loading(`Preparing 3D model (.${format})…`);
    try {
      const { exportAssembly } = await import("@/lib/export-3d");
      const blob = await exportAssembly(current.current, format);
      download(blob, `${fileBase()}.${format}`);
      toast.success(`3D model downloaded (.${format}, ${(blob.size / 1e6).toFixed(1)} MB)`, { id });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { id });
    }
  }
  async function exportSvg() {
    try {
      const root = document.getElementById(
        "assembly-svg",
      ) as unknown as SVGSVGElement;
      if (!root) throw Error("Show the assembly preview first.");
      const copy = root.cloneNode(true) as SVGSVGElement;
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      copy.setAttribute("width", "1800");
      copy.setAttribute("height", String(Math.round((1800 * ah) / aw)));
      const embedded = new Map<string, Promise<string>>();
      const embed = async (href: string) => {
        const response = await fetch(href);
        if (!response.ok) throw Error("Could not include a slab image.");
        const b = await response.blob();
        return new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(Error("Could not include a slab image."));
          r.readAsDataURL(b);
        });
      };
      for (const el of Array.from(copy.querySelectorAll("image"))) {
        const href = el.getAttribute("href")!;
        if (!embedded.has(href)) embedded.set(href, embed(href));
        el.setAttribute("href", await embedded.get(href)!);
      }
      download(
        new Blob([new XMLSerializer().serializeToString(copy)], {
          type: "image/svg+xml",
        }),
        "prela-assembly.svg",
      );
    } catch (e) {
      toast.error(String(e));
    }
  }
  // Scroll over a piece on the slab to rotate it (5°, Shift 1°, Ctrl/⌘ 15°).
  // A burst of wheel steps is one undo step.
  const slabSvg = useRef<SVGSVGElement>(null);
  const lastWheel = useRef(0);
  const wheelRotate = useRef<(id: string, e: WheelEvent) => void>(() => {});
  wheelRotate.current = (id, e) => {
    const p = current.current.pieces.find((q) => q.id === id);
    const delta = Math.sign(e.deltaY || e.deltaX);
    if (!p || !delta) return;
    const step = e.shiftKey ? 1 : e.ctrlKey || e.metaKey ? 15 : 5;
    const angle = Math.round((slabAngleOf(p) + delta * step) / step) * step;
    const now = Date.now();
    if (now - lastWheel.current > 700) checkpoint();
    lastWheel.current = now;
    change((pr) => ({ ...pr, pieces: pr.pieces.map((q) => (q.id === id ? { ...q, ...rotateOnSlab(q, angle) } : q)) }), false);
    if (selected !== id) {
      setSelected(id);
      setSid(p.slab);
    }
  };
  useEffect(() => {
    const svg = slabSvg.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      const g = (e.target as Element | null)?.closest?.("[data-piece]");
      if (!g) return; // not over a piece: scroll the page as usual
      e.preventDefault();
      wheelRotate.current(g.getAttribute("data-piece")!, e);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [view]);
  const shortcut = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcut.current = (e) => {
    const mod = e.ctrlKey || e.metaKey,
      key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      if (!busy) save();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (dialog || target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (mod && key === "z") {
      e.preventDefault();
      undo(e.shiftKey);
    } else if (mod && key === "y") {
      e.preventDefault();
      undo(true);
    } else if (mod && key === "d" && piece) {
      e.preventDefault();
      duplicatePiece(piece);
    } else if ((e.key === "Delete" || e.key === "Backspace") && piece && !mod) {
      e.preventDefault();
      deletePiece(piece);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcut.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (saved !== "dirty") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saved]);
  useEffect(() => {
    // Optional WebMCP hook (browsers/agents that expose document.modelContext).
    type ModelContext = { registerTool?: (tool: unknown, options: { signal: AbortSignal }) => unknown };
    const ctx = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      ctx.registerTool!(
        {
          name: "get_slab_layout",
          description:
            "Read current slab dimensions, pieces, and placement warnings.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true },
          execute: (input: unknown) => {
            if (
              !input ||
              typeof input !== "object" ||
              Object.keys(input).length
            )
              throw Error("Expected an empty object.");
            return { ...current.current, warnings: issues(current.current) };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  return (
    <main className="studio">
      <Toaster theme="dark" position="bottom-right" />
      <header className="topbar">
        <div className="brand">
          <span className="brandmark">
            <ScanLine size={23} />
          </span>
          <div>
            <b>
              PRELA<span> STONE STUDIO</span>
            </b>
            <small>Slab planning & vein matching</small>
          </div>
        </div>
        <div className="topactions">
          {canSignOut && (
            <button
              className="quiet signout"
              title="Sign out of the studio on this browser"
              onClick={async () => {
                if (saved === "dirty" && !confirm("Sign out and discard unsaved changes?")) return;
                await fetch("/api/session", { method: "DELETE" });
                window.location.reload();
              }}
            >
              <LogOut size={16} /> <span>Sign out</span>
            </button>
          )}
          <button onClick={openProjects}>
            <FolderOpen /> <span>Projects</span>
          </button>
          <button onClick={() => setDialog("export")}>
            <Download />
            <span>Export</span>
          </button>
          <button className="primary" onClick={save} disabled={busy}>
            <Save />
            {busy ? "Working…" : "Save project"}
          </button>
        </div>
      </header>
      <div className="projectbar">
        <div>
          <span className="eyebrow">WORKSPACE / </span>
          <input
            aria-label="Project name"
            value={pr.name}
            onChange={(e) =>
              change((p) => ({ ...p, name: e.target.value.slice(0, 150) }))
            }
          />
          <span className={"save-status " + saved} role="status">
            {saveLabels[saved]}
          </span>
        </div>
        <button className="quiet" onClick={() => setDialog("help")}>
          How it works <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="workgrid">
        <aside className="leftpanel">
          <div className="panelhead">
            <h2>
              <Layers /> Slabs
            </h2>
            <span>{pr.slabs.length.toString().padStart(2, "0")}</span>
          </div>
          <div className="slablist">
            {pr.slabs.map((s, i) => (
              <div key={s.id} className="slabcard-wrap">
                <button
                  className={"slabcard " + (slab.id === s.id ? "active" : "")}
                  onClick={() => setSid(s.id)}
                >
                  <div className="thumb">
                    <SlabThumb key={s.image} src={s.image} alt={s.name} mirror={s.mirror} />
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    {slab.id === s.id && <Check size={16} />}
                  </div>
                  <b>{s.name}</b>
                  <small>
                    {s.w} × {s.h} × {s.thickness} mm
                  </small>
                </button>
                {pr.slabs.length > 1 && (
                  <button
                    className="slab-delete danger"
                    title="Delete slab"
                    aria-label={`Delete slab ${s.name}`}
                    onClick={() => deleteSlab(s)}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="upload"
            disabled={busy}
            onClick={() => { replacePhoto.current = false; file.current?.click(); }}
          >
            <Upload size={17} /> Upload slab photo
          </button>
          <input
            ref={file}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <p className="hint">Straight-on photo, cropped to the slab edges.</p>
          <div className="panelhead pieceheading">
            <h2>Pieces</h2>
            <button aria-label="Add piece" title="Add piece" onClick={addPiece}>
              <Plus size={18} />
            </button>
          </div>
          <div className="piecelist">
            {!pr.pieces.length && (
              <p className="empty">No pieces yet. Add one to start planning.</p>
            )}
            {pr.pieces.map((p, i) => (
              <button
                key={p.id}
                className={selected === p.id ? "selected" : ""}
                onClick={() => {
                  setSelected(p.id);
                  setSid(p.slab);
                }}
              >
                <span className="piece-number" style={{ color: p.color }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.w} × {p.h} mm
                  </small>
                </span>
                {hasIssue(warnings, p.id) && (
                  <TriangleAlert className="warningicon" size={14} />
                )}
              </button>
            ))}
          </div>
          <button className="textbutton" onClick={addPiece}>
            <Plus size={16} /> Add piece
          </button>
          <div className="sidebarfoot">
            PRELA MERMER <span>Planning studio · build {BUILD.date} · {BUILD.commit}</span>
          </div>
        </aside>
        <section className="workspace">
          <div className="toolbar">
            <Tabs value={view} onValueChange={setView}>
              <TabsList>
                <TabsTrigger value="pieces">1 · Pieces</TabsTrigger>
                <TabsTrigger value="slab">2 · Slab layout</TabsTrigger>
                <TabsTrigger value="assembly">3 · Assembly</TabsTrigger>
                <TabsTrigger value="split">Split view</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="toolicons">
              <button
                aria-label="Undo"
                title="Undo (Ctrl+Z)"
                disabled={!past.current.length}
                onClick={() => undo()}
              >
                <Undo2 />
              </button>
              <button
                aria-label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                disabled={!future.current.length}
                onClick={() => undo(true)}
              >
                <Redo2 />
              </button>
              {view !== "pieces" && (
              <>
              <i />
              <button
                title="Zoom out"
                aria-label="Zoom out"
                disabled={zoom <= ZOOM_MIN}
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
              >
                <ZoomOut />
              </button>
              <button
                className="zoom-readout"
                title="Reset zoom to 100%"
                aria-label={"Zoom " + Math.round(zoom * 100) + "%, reset"}
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                title="Zoom in"
                aria-label="Zoom in"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
              >
                <ZoomIn />
              </button>
              <button
                title="Fit view"
                aria-label="Fit view"
                onClick={() => setZoom(1)}
              >
                <Maximize2 />
              </button>
              </>
              )}
            </div>
          </div>
          {view === "pieces" ? (
            <PiecesPage
              project={pr}
              selected={selected}
              warnings={warnings}
              onSelect={(p) => {
                setSelected(p.id);
                setSid(p.slab);
              }}
              onPatch={(p, values) => patchPiece(p.id, values)}
              onMoveToSlab={moveToSlab}
              onAdd={addPiece}
              onDuplicate={duplicatePiece}
              onDelete={deletePiece}
              onEditShape={(p) => {
                setSelected(p.id);
                setSid(p.slab);
                setDialog("shape");
              }}
              onScan={() => setDialog("scan")}
              onEditOpenings={(p) => {
                setSelected(p.id);
                setSid(p.slab);
                setDialog("openings");
              }}
              onEditEdges={(p) => {
                setSelected(p.id);
                setSid(p.slab);
                setDialog("edges");
              }}
              onPlace={(p) => {
                setSelected(p.id);
                setSid(p.slab);
                setView("slab");
              }}
              onContinue={() => {
                if (piece) setSid(piece.slab);
                setView("slab");
              }}
            />
          ) : (
          <>
          <div className={"canvases " + view}>
            {view !== "assembly" && (
              <section className="canvaspanel">
                <div className="canvashead">
                  <h2>
                    <span className="sectionno">02</span> Slab layout
                  </h2>
                  <div className="canvashead-actions">
                    <button
                      className="quiet"
                      title="Place every piece on the slabs automatically (largest first, 4 mm apart)"
                      onClick={() => arrange(false)}
                    >
                      <LayoutGrid size={15} /> Auto-arrange
                    </button>
                    <button
                      className="quiet"
                      title="Move only pieces that overlap, overhang or hit a defect"
                      disabled={!warnings.length}
                      onClick={() => arrange(true)}
                    >
                      <Wand2 size={15} /> Fix problems
                    </button>
                    <button className="quiet" onClick={() => setDialog("slab")}>
                      <SlidersHorizontal size={15} /> Slab settings
                    </button>
                  </div>
                </div>
                <ZoomBoard zoom={zoom}>
                  <svg
                    ref={slabSvg}
                    className="slab-svg"
                    viewBox={`-130 -140 ${slab.w + 260} ${slab.h + 280}`}
                    role="img"
                    aria-label="Slab layout. Drag pieces or use arrow keys to position them."
                  >
                    <text
                      x={slab.w / 2}
                      y={-65}
                      textAnchor="middle"
                      className="ruler"
                    >
                      {slab.w} mm
                    </text>
                    <text
                      transform={`translate(-70 ${slab.h / 2}) rotate(-90)`}
                      textAnchor="middle"
                      className="ruler"
                    >
                      {slab.h} mm
                    </text>
                    <defs><clipPath id={`slab-clip-${slab.id}`}><rect x={0} y={0} width={slab.w} height={slab.h} /></clipPath></defs>
                    <image
                      href={slab.image}
                      x={slabImage.x}
                      y={slabImage.y}
                      width={slabImage.w}
                      height={slabImage.h}
                      preserveAspectRatio="none"
                      transform={slab.mirror ? `matrix(-1 0 0 1 ${slab.w} 0)` : undefined}
                      clipPath={`url(#slab-clip-${slab.id})`}
                    />
                    <rect
                      x={pr.margin}
                      y={pr.margin}
                      width={Math.max(0, slab.w - pr.margin * 2)}
                      height={Math.max(0, slab.h - pr.margin * 2)}
                      fill="none"
                      stroke="#242b2b"
                      strokeWidth={4}
                      strokeDasharray="18 14"
                    />
                    {pr.defects
                      .filter((d) => d.slab === slab.id)
                      .map((d) => (
                        <g key={d.id}>
                          {d.points?.length ? <polyline points={d.points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#ee4545" strokeWidth={d.brush ?? 80} strokeLinecap="round" strokeLinejoin="round" /> : <rect x={d.x} y={d.y} width={d.w} height={d.h} fill="#e45d5d99" stroke="#ee4545" strokeWidth={6} />}
                          <text
                            x={d.x + 10}
                            y={d.y + 60}
                            fontSize={45}
                            fill="white"
                          >
                            DEFECT
                          </text>
                        </g>
                      ))}
                    {slabPieces.map((p) => {
                      // Draw the slab footprint: a 90° rotated piece occupies h × w.
                      const m = placement(p),
                        f = { w: m.w, h: m.h },
                        angle = slabAngleOf(p),
                        shapePath = pathD(pieceOutline(p).map(m.local)),
                        holePath = pieceHoles(p).map((h) => pathD(h.map(m.local))).join(""),
                        plain = (!p.shape || p.shape.kind === "rect") && angle % 90 === 0,
                        labelW = Math.max(0, Math.min(f.w - 36, 510)),
                        labelX = plain ? 18 : (f.w - labelW) / 2,
                        labelY = plain ? 18 : f.h / 2 - 60,
                        index = pr.pieces.indexOf(p) + 1;
                      return (
                        <g
                          key={p.id}
                          transform={`translate(${p.x} ${p.y})`}
                          data-piece={p.id}
                          tabIndex={0}
                          role="button"
                          aria-label={p.name + " position"}
                          onKeyDown={(e) => keys(e, p)}
                          onPointerDown={(e) => start(e, p)}
                          onPointerMove={move}
                          onPointerUp={() => (drag.current = null)}
                          onPointerCancel={() => (drag.current = null)}
                          className="draggable"
                        >
                          {!plain && (
                            <rect
                              width={f.w}
                              height={f.h}
                              fill="none"
                              stroke={p.color}
                              strokeOpacity={0.35}
                              strokeWidth={3}
                              strokeDasharray="10 10"
                            />
                          )}
                          <path
                            d={shapePath}
                            fill={p.color}
                            fillOpacity={selected === p.id ? 0.24 : 0.1}
                            stroke={
                              hasIssue(warnings, p.id)
                                ? "#f46d68"
                                : p.color
                            }
                            strokeWidth={selected === p.id ? 10 : 5}
                          />
                          {mitreStrips(pieceOutline(p), edgeCutsOf(p), pr.slabs.find((x) => x.id === p.slab)?.thickness ?? 20).map((st, k) => (
                            <path
                              key={"m" + k}
                              d={pathD(st.pts.map(m.local))}
                              className={"mitre-strip " + st.cut}
                            >
                              <title>{st.cut === "below" ? "45° mitre below" : "45° mitre above"}</title>
                            </path>
                          ))}
                          {holePath && (
                            <path
                              d={holePath}
                              fill="#151b1f99"
                              stroke={p.color}
                              strokeWidth={5}
                              strokeDasharray="12 8"
                            />
                          )}
                          {showLabels && (
                            <>
                              <rect
                                x={labelX}
                                y={labelY}
                                width={labelW}
                                height={120}
                                rx={12}
                                fill="#14201fe8"
                              />
                              <text x={labelX + 27} y={labelY + 79} fontSize={55} fill={p.color}>
                                {String(index).padStart(2, "0")} · {p.name}
                              </text>
                              <text
                                x={f.w / 2}
                                y={f.h - 35}
                                textAnchor="middle"
                                fontSize={43}
                                fill="#151c1c"
                                stroke="white"
                                strokeWidth={3}
                                paintOrder="stroke"
                              >
                                {p.w} × {p.h}
                                {angle ? ` · ${angle}°` : ""}
                              </text>
                            </>
                          )}
                          {selected === p.id &&
                            [
                              [0, 0],
                              [f.w, 0],
                              [0, f.h],
                              [f.w, f.h],
                            ].map(([x, y], i) => (
                              <rect
                                key={i}
                                x={x - 15}
                                y={y - 15}
                                width={30}
                                height={30}
                                fill={p.color}
                                stroke="#172024"
                                strokeWidth={4}
                              />
                            ))}
                        </g>
                      );
                    })}
                  </svg>
                </ZoomBoard>
                <div className="canvascaption">
                  <span>
                    <Move size={14} /> Drag a piece to explore the veins ·
                    magnetic snap leaves {pieceGap(pr)} mm between pieces
                  </span>
                  <span>
                    {slab.w} × {slab.h} mm
                  </span>
                </div>
              </section>
            )}
            {view !== "slab" && (
              <section className="canvaspanel assemblypanel">
                <div className="canvashead">
                  <h2>
                    <span className="sectionno">03</span> Assembly preview
                  </h2>
                  <div
                    className="assembly-view-toggle"
                    role="group"
                    aria-label="Assembly view"
                  >
                    <button
                      aria-pressed={!assembly3d}
                      onClick={() => setAssembly3d(false)}
                    >
                      2D
                    </button>
                    <button
                      aria-pressed={assembly3d}
                      onClick={() => setAssembly3d(true)}
                    >
                      3D
                    </button>
                    <button
                      className="assembly-download"
                      title="Download 3D model (.glb)"
                      aria-label="Download 3D model"
                      onClick={() => exportModel("glb")}
                    >
                      <Download size={14} /> 3D file
                    </button>
                  </div>
                </div>
                {assembly3d && (
                  <Assembly3D
                    project={pr}
                    selected={selected}
                    onMoveStart={checkpoint}
                    onTransform={(id, values) =>
                      change(
                        (p) => ({
                          ...p,
                          pieces: p.pieces.map((q) =>
                            q.id === id ? { ...q, ...values } : q,
                          ),
                        }),
                        false,
                      )
                    }
                    onMove={(id, ax, ay) =>
                      change(
                        (p) => ({
                          ...p,
                          pieces: p.pieces.map((q) =>
                            q.id === id ? { ...q, ax, ay } : q,
                          ),
                        }),
                        false,
                      )
                    }
                    onSelect={(id) => {
                      setSelected(id);
                      const p = pr.pieces.find((q) => q.id === id);
                      if (p) setSid(p.slab);
                    }}
                  />
                )}
                <div className="assembly-2d" hidden={assembly3d}>
                  <ZoomBoard zoom={zoom} className="assemblyboard">
                    <svg
                      id="assembly-svg"
                      className="assembly-svg"
                      viewBox={`${assemblyMinX - 80} ${assemblyMinY - 80} ${aw + 160} ${ah + 160}`}
                      role="img"
                      aria-label="Assembly preview. Drag pieces to position the finished layout."
                    >
                      <rect
                        x={assemblyMinX - 80}
                        y={assemblyMinY - 80}
                        width={aw + 160}
                        height={ah + 160}
                        fill="#151b1f"
                      />
                      {pr.pieces.map((p, i) => {
                        const s = pr.slabs.find((s) => s.id === p.slab)!,
                          outlinePath = pathD(pieceOutline(p)),
                          holePath = pieceHoles(p).map(pathD).join(""),
                          img = slabImageRect(s);
                        return (
                          <g
                            key={p.id}
                            transform={`translate(${p.ax} ${p.ay}) rotate(${p.rz ?? 0})`}
                            tabIndex={0}
                            role="button"
                            aria-label={p.name + " assembly position"}
                            onPointerDown={(e) => start(e, p, true)}
                            onPointerMove={move}
                            onPointerUp={() => (drag.current = null)}
                            onPointerCancel={() => (drag.current = null)}
                            onKeyDown={(e) => keys(e, p, true)}
                            className="draggable"
                          >
                            <defs>
                              <clipPath id={"clip-" + p.id}>
                                <path
                                  d={outlinePath + holePath}
                                  clipRule="evenodd"
                                />
                              </clipPath>
                            </defs>
                            <g clipPath={`url(#clip-${p.id})`}>
                              <rect width={p.w} height={p.h} fill="#42474b" />
                              <image
                                href={s.image}
                                x={img.x}
                                y={img.y}
                                width={img.w}
                                height={img.h}
                                preserveAspectRatio="none"
                                transform={(() => {
                                  // slab = origin + R·piece  →  piece = Rᵀ·(slab − origin)
                                  const m = placement(p), c = m.cos, n = m.sin, o = m.origin;
                                  const [a, b, cc, d, e, f] = [c, -n, n, c, -(c * o.x + n * o.y), n * o.x - c * o.y];
                                  // A book-matched slab's photo is mirrored left–right first.
                                  return s.mirror
                                    ? `matrix(${-a} ${-b} ${cc} ${d} ${a * s.w + e} ${b * s.w + f})`
                                    : `matrix(${a} ${b} ${cc} ${d} ${e} ${f})`;
                                })()}
                              />
                            </g>
                            <path
                              d={outlinePath + holePath}
                              fill="none"
                              stroke={selected === p.id ? p.color : "#727777"}
                              strokeWidth={selected === p.id ? 6 : 2}
                            />
                            {showLabels && (
                              <g>
                                <rect
                                  x={12}
                                  y={12}
                                  width={360}
                                  height={70}
                                  rx={8}
                                  fill="#14201feb"
                                />
                                <text x={27} y={61} fontSize={39} fill="white">
                                  {String(i + 1).padStart(2, "0")} · {p.name}
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      })}
                    </svg>
                  </ZoomBoard>
                </div>
                <div className="canvascaption">
                  <span>
                    {assembly3d
                      ? "Move pieces or orbit using the controls above"
                      : "Drag to arrange the finished pieces"}
                  </span>
                  {!assembly3d && (
                    <button
                      className="quiet"
                      onClick={() => setShowLabels((v) => !v)}
                    >
                      {showLabels ? "Hide labels" : "Show labels"}
                    </button>
                  )}
                </div>
                <AssemblyPad
                  pieces={pr.pieces}
                  piece={piece}
                  onSelect={(id) => {
                    const p = pr.pieces.find((q) => q.id === id);
                    if (!p) return;
                    setSelected(id);
                    setSid(p.slab);
                  }}
                  onBegin={checkpoint}
                  onDelta={(id, delta) =>
                    change(
                      (p) => ({
                        ...p,
                        pieces: p.pieces.map((q) => (q.id === id ? { ...q, ...applyDelta(q, delta) } : q)),
                      }),
                      false,
                    )
                  }
                  onReset={(id) => patchPiece(id, { rx: 0, ry: 0, rz: 0 })}
                />
              </section>
            )}
          </div>
          <div className="statsbar">
            <div>
              <small>Slab area</small>
              <b>
                {((slab.w * slab.h) / 1e6).toFixed(2)} <em>m²</em>
              </b>
            </div>
            <div>
              <small>Allocated area</small>
              <b>
                {((used * slab.w * slab.h) / 1e8).toFixed(2)} <em>m²</em>
              </b>
            </div>
            <div className="util">
              <small>
                Slab utilization <b>{used.toFixed(1)}%</b>
              </small>
              <div>
                <span style={{ width: Math.min(used, 100) + "%" }} />
              </div>
            </div>
            <button
              className={"checkstatus " + (warnings.length ? "warn" : "")}
              onClick={() => setDialog("checks")}
            >
              {warnings.length ? (
                <TriangleAlert size={18} />
              ) : (
                <Check size={18} />
              )}{" "}
              {warnings.length
                ? `${warnings.length} placement issue${warnings.length > 1 ? "s" : ""}`
                : "Placement checks passed"}
            </button>
          </div>
          <p className="workspace-note">
            {slab.image === "/demo-slab.png"
              ? "Illustrative demo texture. Upload your actual slab before planning a job."
              : "Photo mapped to your entered dimensions. Confirm scale and measurements before cutting."}
          </p>
          </>
          )}
        </section>
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
          </div>
        </aside>
      </div>
      <Dialog open={!!dialog} onOpenChange={(o) => !o && setDialog("")}>
        <DialogContent
          className={
            "studio-dialog" +
            (dialog === "photo" ? " photo-dialog" : "") +
            (dialog === "shape" || dialog === "scan" || dialog === "quote" ? " wide-dialog" : "")
          }
        >
          <DialogTitle>{dialog && dialogCopy[dialog].title}</DialogTitle>
          <DialogDescription>
            {dialog && dialogCopy[dialog].description}
          </DialogDescription>
          {dialog === "slab" && (
            <>
              <label className="field">
                <span>Slab name</span>
                <input
                  value={slab.name}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      slabs: p.slabs.map((s) =>
                        s.id === slab.id ? { ...s, name: e.target.value } : s,
                      ),
                    }))
                  }
                />
              </label>
              <label className="check mirror-toggle">
                <input
                  type="checkbox"
                  checked={!!slab.mirror}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      slabs: p.slabs.map((x) => (x.id === slab.id ? { ...x, mirror: e.target.checked || undefined } : x)),
                    }))
                  }
                />
                <FlipHorizontal2 size={15} /> Book-matched slab: show the photo mirrored
              </label>
              <div className="twocol">
                {(["w", "h", "thickness"] as const).map((key, i) => (
                  <Num
                    key={key}
                    label={["Width", "Height", "Thickness"][i]}
                    value={slab[key]}
                    min={1}
                    onChange={(n) =>
                      change((p) => ({
                        ...p,
                        slabs: p.slabs.map((s) =>
                          s.id === slab.id ? { ...s, [key]: n } : s,
                        ),
                      }))
                    }
                  />
                ))}
              </div>
              <div className="photo-entry">
                <div className="photo-entry-thumb">
                  <img src={slab.image} alt={slab.name} className={slab.mirror ? "mirrored" : undefined} />
                </div>
                <div>
                  <b>Slab photo</b>
                  <p className="hint">
                    {slab.edit
                      ? `Straighten ${slab.edit.straighten.toFixed(1)}° · vertical ${slab.edit.vertical.toFixed(1)}° · horizontal ${slab.edit.horizontal.toFixed(1)}°`
                      : "Straighten the photo, fix perspective and frame the slab edges."}
                  </p>
                  <button className="primary" onClick={() => setDialog("photo")}>
                    <Crop size={16} /> Adjust photo
                  </button>
                </div>
              </div>
              <h3>Paint slab defects</h3>
              <DefectPainter
                slab={slab}
                crop={photoCrop}
                defects={pr.defects.filter((d) => d.slab === slab.id)}
                onAdd={(defect) => change((p) => ({ ...p, defects: [...p.defects, defect] }))}
              />
              <div className="calibration-card">
                <div className="row-between">
                  <div>
                    <b>Photo calibration</b>
                    <p className="hint">The entered slab dimensions map the photo to real millimetres.</p>
                  </div>
                  <button className="quiet" onClick={() => { replacePhoto.current = true; file.current?.click(); }}>Replace photo</button>
                </div>
                {slab.photoWidth && slab.photoHeight ? (
                  <p className="hint">Source image: {slab.photoWidth} × {slab.photoHeight} px · calibrated scale: {(slab.w / slab.photoWidth).toFixed(3)} mm/px</p>
                ) : (
                  <p className="hint">Upload a straight-on photo, then enter the measured width and height above.</p>
                )}
              </div>
              <p className="hint">
                For accurate matching, photograph the whole slab. Use Adjust
                photo to straighten it and line the frame up with the slab
                edges, then confirm the measured width and height.
              </p>
              <div className="dialog-actions">
                <button
                  className="danger"
                  disabled={pr.slabs.length <= 1}
                  title={
                    pr.slabs.length <= 1
                      ? "A project needs at least one slab"
                      : "Delete this slab"
                  }
                  onClick={() => deleteSlab(slab)}
                >
                  <Trash2 size={16} /> Delete slab
                </button>
                <button className="primary" onClick={() => setDialog("")}>
                  Apply dimensions
                </button>
              </div>
            </>
          )}
          {dialog === "shape" && piece && (
            <ShapeEditor
              key={piece.id}
              piece={piece}
              onCancel={() => setDialog("")}
              onApply={(values) => {
                patch(values);
                setDialog("");
                toast.success(`Shape updated: ${SHAPE_LABEL[values.shape?.kind ?? "rect"]}`);
              }}
            />
          )}
          {dialog === "edges" && piece && (
            <>
              <div className="edges-dialog-head">
                <ShapeThumb piece={piece} size={44} />
                <b>{piece.name}</b>
              </div>
              <EdgeCutsEditor
                piece={piece}
                thickness={pr.slabs.find((x) => x.id === piece.slab)?.thickness ?? 20}
                onPatch={patch}
              />
              <div className="dialog-actions">
                <span />
                <button className="primary" onClick={() => setDialog("")}>
                  Done
                </button>
              </div>
            </>
          )}
          {dialog === "openings" && piece && (
            <>
              <div className="edges-dialog-head">
                <ShapeThumb piece={piece} size={44} />
                <b>{piece.name}</b>
              </div>
              <OpeningsEditor piece={piece} onPatch={patch} />
              <div className="dialog-actions">
                <span />
                <button className="primary" onClick={() => setDialog("")}>
                  Done
                </button>
              </div>
            </>
          )}
          {dialog === "quote" && (
            <QuotePanel
              project={pr}
              onPricing={(pricing) => change((p) => ({ ...p, pricing }), false)}
              onPrint={async () => {
                const { reportHtml, printHtml } = await import("@/lib/print-report");
                const { DEFAULT_PRICING } = await import("@/lib/production");
                printHtml(reportHtml(current.current, { quote: { ...DEFAULT_PRICING, ...current.current.pricing } }));
              }}
            />
          )}
          {dialog === "scan" && (
            <ShapeScanner multiple onCancel={() => setDialog("")} onUse={addScannedPieces} />
          )}
          {dialog === "photo" && (
            <PhotoEditor
              key={slab.id + (slab.edit?.source ?? slab.image)}
              src={slab.edit?.source ?? slab.image}
              initial={slab.edit}
              onCancel={() => setDialog("slab")}
              onApply={applyPhotoEdit}
            />
          )}
          {dialog === "projects" && (
            <>
              <div className="projectlist">
                {loadError ? (
                  <p className="error">{loadError}</p>
                ) : projects.length ? (
                  projects.map((p) => (
                    <button key={p.id} onClick={() => load(p.id)}>
                      <FolderOpen size={18} />
                      <span>
                        <b>{p.name}</b>
                        <small>{new Date(p.updated).toLocaleString()}</small>
                      </span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))
                ) : (
                  <p className="hint">
                    No saved projects loaded. Save your workspace to keep it
                    here.
                  </p>
                )}
              </div>
              <SyncPanel
                saveCurrent={save}
                onDownloaded={(id) => load(id)}
                notify={(kind, text) => (kind === "success" ? toast.success(text) : toast.error(text))}
              />
              <button
                onClick={() => {
                  if (
                    saved === "dirty" &&
                    !confirm("Discard unsaved changes and start a new project?")
                  )
                    return;
                  checkpoint();
                  const p = demo();
                  p.name = "Untitled project";
                  p.pieces = [];
                  setPr(p);
                  setSid("s1");
                  setSelected("");
                  setSaved("new");
                  setDialog("");
                }}
              >
                <Plus /> New project
              </button>
            </>
          )}
          {dialog === "export" && (
            <div className="exportactions">
              <button onClick={exportBackup}>
                <Download /> Download project backup
              </button>
              <button onClick={() => jsonFile.current?.click()}>
                <Upload /> Open project backup
              </button>
              <button
                onClick={async () => {
                  const { reportHtml, printHtml } = await import("@/lib/print-report");
                  printHtml(reportHtml(current.current));
                }}
              >
                <Printer /> Print cut list / Save PDF
              </button>
              <button
                onClick={async () => {
                  const { projectDxf } = await import("@/lib/production");
                  download(new Blob([projectDxf(current.current)], { type: "application/dxf" }), `${fileBase()}.dxf`);
                  toast.success("DXF downloaded (millimetres; layers CUT, OPENING, MITRE, SLAB)");
                }}
              >
                <Download /> Download DXF for CNC / saw
              </button>
              <button onClick={() => setDialog("quote")}>
                <Receipt /> Quote…
              </button>
              <button onClick={() => exportModel("glb")}>
                <Box /> Download 3D model (.glb)
              </button>
              <button onClick={() => exportModel("usdz")}>
                <Box /> Download 3D model for iPhone AR (.usdz)
              </button>
              <button onClick={exportSvg}>
                <ScanLine /> Download assembly SVG
              </button>
              <button onClick={() => window.print()}>
                <Download /> Print layout / Save PDF
              </button>
              <p className="hint">
                Backups include the slab photos, so they open on the website and
                in the desktop app. 3D models
                are in metres with the slab texture; .glb opens in Windows 3D
                Viewer, Blender and SketchUp, .usdz in AR on iPhone and iPad.
                Planning layouts only; not machine-ready cutting files. Review
                dimensions and allowances with your operator.
              </p>
            </div>
          )}
          {dialog === "checks" && (
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
          )}
          {dialog === "help" && (
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
          )}
          {dialog === "help" && (
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
          )}
          {dialog === "defects" && (
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
          )}
        </DialogContent>
      </Dialog>
      <input
        ref={jsonFile}
        type="file"
        accept="application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (jsonFile.current) jsonFile.current.value = "";
          if (!f) return;
          if (saved === "dirty" && !confirm("Replace unsaved changes with this backup?")) return;
          const id = toast.loading("Opening backup and restoring slab photos…");
          try {
            const { restoreBackup } = await import("@/lib/backup");
            const { project: p, missing } = await restoreBackup(await f.text());
            checkpoint();
            setPr(p);
            setSid(p.slabs[0].id);
            setSelected(p.pieces[0]?.id || "");
            setSaved("dirty");
            setDialog("");
            if (missing.length)
              toast.warning("Backup opened, but some slab photos are missing", {
                id,
                duration: 12000,
                description: `${missing.join(", ")}: this backup was made before photos were included. Export the backup again from the copy that has the photos, or use Replace photo in Slab settings.`,
              });
            else toast.success("Backup opened with its slab photos", { id });
          } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err), { id });
          }
        }}
      />
    </main>
  );
}
