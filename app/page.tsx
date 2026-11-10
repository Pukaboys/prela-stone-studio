"use client";
import { useState, useRef, useEffect } from "react";
import Assembly3D from "@/components/assembly-3d";
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
  opening,
  issues,
  hasIssue,
  validProject,
  pieceAngle,
  slabCrop,
  slabImageRect,
  type Project,
  type Piece,
  type CutAngle,
  type PhotoCrop,
  type PhotoQuad,
  type PhotoAdjustments,
  type Defect,
  type Slab,
} from "@/lib/model";
/**
 * Numeric field that keeps a local text draft, so users can clear the field
 * and type a new value. Only valid, in-range numbers are committed; the field
 * reverts to the last committed value on blur or Escape.
 */
function Num({
  label,
  value,
  onChange,
  min = 0,
  max = 20000,
  unit = "mm",
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  // `draft` is null while the field is not being edited, so it always shows
  // the committed value; while focused it holds whatever the user typed.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const parsed = Number(text);
  const invalid =
    draft !== null &&
    (text.trim() === "" || !Number.isFinite(parsed) || parsed < min || parsed > max);
  return (
    <label className={"field" + (invalid ? " invalid" : "")}>
      <span>{label}</span>
      <div>
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          value={text}
          aria-invalid={invalid || undefined}
          title={`${min} – ${max} ${unit}`}
          onFocus={() => setDraft(String(value))}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            const n = Number(next);
            if (next.trim() !== "" && Number.isFinite(n) && n >= min && n <= max && n !== value)
              onChange(n);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
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

type PixelPoint = { x: number; y: number };

function homography(destination: PixelPoint[], source: PixelPoint[]) {
  const matrix: number[][] = [], values: number[] = [];
  destination.forEach((p, i) => {
    const q = source[i];
    matrix.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y]); values.push(q.x);
    matrix.push([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y]); values.push(q.y);
  });
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++) if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]]; [values[i], values[pivot]] = [values[pivot], values[i]];
    const divisor = matrix[i][i];
    for (let k = i; k < 8; k++) matrix[i][k] /= divisor;
    values[i] /= divisor;
    for (let j = 0; j < 8; j++) if (j !== i) {
      const factor = matrix[j][i];
      for (let k = i; k < 8; k++) matrix[j][k] -= factor * matrix[i][k];
      values[j] -= factor * values[i];
    }
  }
  return (p: PixelPoint): PixelPoint => { const d = values[6] * p.x + values[7] * p.y + 1; return { x: (values[0] * p.x + values[1] * p.y + values[2]) / d, y: (values[3] * p.x + values[4] * p.y + values[5]) / d }; };
}

function triangleTransform(source: PixelPoint[], destination: PixelPoint[]) {
  const [s0, s1, s2] = source, [d0, d1, d2] = destination;
  const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  const coefficient = (v0: number, v1: number, v2: number) => [
    (v0 * (s1.y - s2.y) + v1 * (s2.y - s0.y) + v2 * (s0.y - s1.y)) / det,
    (v0 * (s2.x - s1.x) + v1 * (s0.x - s2.x) + v2 * (s1.x - s0.x)) / det,
    (v0 * (s1.x * s2.y - s2.x * s1.y) + v1 * (s2.x * s0.y - s0.x * s2.y) + v2 * (s0.x * s1.y - s1.x * s0.y)) / det,
  ];
  const x = coefficient(d0.x, d1.x, d2.x), y = coefficient(d0.y, d1.y, d2.y);
  return [x[0], y[0], x[1], y[1], x[2], y[2]] as const;
}

async function rectifySlabImage(dataUrl: string, calibration: PhotoQuad, slab: Slab) {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(Error("Could not decode the slab photo.")); });
  const width = 1600, height = Math.max(1, Math.round(width * slab.h / slab.w));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const source = [calibration.tl, calibration.tr, calibration.br, calibration.bl].map((p) => ({ x: p.x * image.naturalWidth, y: p.y * image.naturalHeight }));
  const map = homography([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], source);
  const grid = 24;
  const drawTriangle = (ss: PixelPoint[], dd: PixelPoint[]) => { ctx.save(); ctx.beginPath(); ctx.moveTo(dd[0].x, dd[0].y); ctx.lineTo(dd[1].x, dd[1].y); ctx.lineTo(dd[2].x, dd[2].y); ctx.closePath(); ctx.clip(); ctx.setTransform(...triangleTransform(ss, dd)); ctx.drawImage(image, 0, 0); ctx.restore(); };
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const d00 = { x: x * width / grid, y: y * height / grid }, d10 = { x: (x + 1) * width / grid, y: y * height / grid }, d11 = { x: (x + 1) * width / grid, y: (y + 1) * height / grid }, d01 = { x: x * width / grid, y: (y + 1) * height / grid };
    const s00 = map(d00), s10 = map(d10), s11 = map(d11), s01 = map(d01);
    drawTriangle([s00, s10, s11], [d00, d10, d11]); drawTriangle([s00, s11, s01], [d00, d11, d01]);
  }
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(Error("Could not create the corrected slab image.")), "image/png"));
}

function photoPerspectiveTransform(adjustments: PhotoAdjustments) {
  return `perspective(900px) rotateX(${adjustments.perspectiveV}deg) rotateY(${-adjustments.perspectiveH}deg) rotate(${adjustments.straighten}deg)`;
}

function AiPhotoEditor({ slab, onAiEdit }: { slab: Slab; onAiEdit: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function edit() { setBusy(true); try { await onAiEdit(); } finally { setBusy(false); } }
  return <div className="photo-calibrator"><div className="photo-calibrator-canvas ai-photo-editor" style={{ aspectRatio: (slab.photoWidth ?? slab.w) / (slab.photoHeight ?? slab.h) }}><img src={slab.image} alt="Slab source photo" /></div><div className="photo-calibrator-actions"><button className="primary" disabled={busy} onClick={edit}>{busy ? "AI is editing the slab…" : "AI isolate and straighten slab"}</button><span>The original photo will be replaced with a centered, front-facing slab on a transparent background.</span></div><div className="photo-adjustments"><b>AI photo edit</b><span>It removes the background and corrects perspective automatically. No corner calibration is required.</span></div></div>;
}

function DefectPainter({ slab, crop, calibration, adjustments, defects, onAdd }: { slab: Slab; crop: PhotoCrop; calibration?: PhotoQuad; adjustments?: PhotoAdjustments; defects: Defect[]; onAdd: (defect: Defect) => void }) {
  const host = useRef<HTMLDivElement>(null), stroke = useRef<{ x: number; y: number }[]>([]), c = crop; const [draft, setDraft] = useState<{ x: number; y: number }[]>([]); const [brush, setBrush] = useState(45);
  function toSlab(e: React.PointerEvent<HTMLDivElement>) { if (!host.current) return { x: 0, y: 0 }; const p = cropPoint(e, host.current); return { x: p.x * slab.w, y: p.y * slab.h }; }
  function begin(e: React.PointerEvent<HTMLDivElement>) { stroke.current = [toSlab(e)]; setDraft(stroke.current); host.current?.setPointerCapture(e.pointerId); }
  function move(e: React.PointerEvent<HTMLDivElement>) { if (!stroke.current.length) return; const p = toSlab(e), last = stroke.current[stroke.current.length - 1]; if (Math.hypot(p.x - last.x, p.y - last.y) < 8) return; stroke.current = [...stroke.current, p]; setDraft(stroke.current); }
  function finish(e: React.PointerEvent<HTMLDivElement>) { if (stroke.current.length < 2) { stroke.current = []; setDraft([]); return; } const points = stroke.current, xs = points.map((p) => p.x), ys = points.map((p) => p.y); onAdd({ id: crypto.randomUUID(), slab: slab.id, x: Math.min(...xs) - brush / 2, y: Math.min(...ys) - brush / 2, w: Math.max(brush, Math.max(...xs) - Math.min(...xs) + brush), h: Math.max(brush, Math.max(...ys) - Math.min(...ys) + brush), points, brush }); stroke.current = []; setDraft([]); host.current?.releasePointerCapture(e.pointerId); }
  function line(points: { x: number; y: number }[]) { return points.map((p) => `${p.x},${p.y}`).join(" "); }
  const previewAspect = ((c.w * (slab.photoWidth ?? slab.w)) / (c.h * (slab.photoHeight ?? slab.h)));
  const a = adjustments ?? { straighten: 0, perspectiveV: 0, perspectiveH: 0 };
  const imageTransform = photoPerspectiveTransform(a);
  const calibratedPoints = calibration ? (["tl", "tr", "br", "bl"] as const).map((key) => `${((calibration[key].x - c.x) / c.w) * slab.w},${((calibration[key].y - c.y) / c.h) * slab.h}`).join(" ") : "";
  return <div><div ref={host} className="defect-painter" style={{ aspectRatio: previewAspect }} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { stroke.current = []; setDraft([]); }}><img src={slab.image} alt="Slab defect painting surface" style={{ left: `${-c.x * 100 / c.w}%`, top: `${-c.y * 100 / c.h}%`, width: `${100 / c.w}%`, height: `${100 / c.h}%`, transform: imageTransform }} /><svg viewBox={`0 0 ${slab.w} ${slab.h}`} preserveAspectRatio="none">{calibratedPoints && <polygon points={calibratedPoints} fill="#bde96e18" stroke="#bde96e" strokeWidth={10} strokeDasharray="28 18" />}{defects.map((d) => d.points?.length ? <polyline key={d.id} points={line(d.points)} fill="none" stroke="#ff625b" strokeWidth={d.brush ?? brush} strokeLinecap="round" strokeLinejoin="round" /> : <rect key={d.id} x={d.x} y={d.y} width={d.w} height={d.h} fill="#f46d6888" stroke="#ff7770" />)}{draft.length > 1 && <polyline points={line(draft)} fill="none" stroke="#ffd166" strokeWidth={brush} strokeLinecap="round" strokeLinejoin="round" />}</svg></div><label className="brush-control">Brush size <input type="range" min="10" max="180" value={brush} onChange={(e) => setBrush(Number(e.target.value))} /><span>{brush} mm</span></label><p className="hint">Paint defects freely with the brush. The green outline is the calibrated slab boundary.</p></div>;
}
type DialogId = "" | "slab" | "projects" | "export" | "checks" | "help" | "defects";
const dialogCopy: Record<Exclude<DialogId, "">, { title: string; description: string }> = {
  slab: { title: "Slab settings", description: "Use the actual measurements of the photographed slab." },
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

export default function Studio() {
  const [pr, setPr] = useState<Project>(demo),
    [sid, setSid] = useState("s1"),
    [selected, setSelected] = useState("p1"),
    [view, setView] = useState("split"),
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
    photoCalibration = slab.calibration,
    photoAdjustments = slab.adjustments ?? { straighten: 0, perspectiveV: 0, perspectiveH: 0 },
    warnings = issues(pr),
    slabPieces = pr.pieces.filter((p) => p.slab === slab.id);
  const used =
    (slabPieces.reduce((a, p) => a + p.w * p.h, 0) / (slab.w * slab.h)) * 100;
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
    change((p) => ({
      ...p,
      pieces: [
        ...p.pieces,
        {
          id,
          name: "Piece " + (p.pieces.length + 1),
          slab: slab.id,
          w: 800,
          h: 600,
          x: pr.margin,
          y: pr.margin,
          ax: 0,
          ay: Math.max(0, ...p.pieces.map((q) => q.ay + q.h + 20)),
          rot: false,
          holeW: 0,
          holeH: 0,
          holeX: 0,
          holeY: 0,
          color: colors[p.pieces.length % colors.length],
        },
      ],
    }));
    setSelected(id);
  }
  function duplicatePiece(source: Piece) {
    const id = crypto.randomUUID();
    change((p) => ({
      ...p,
      pieces: [
        ...p.pieces,
        {
          ...source,
          id,
          name: (source.name + " copy").slice(0, 60),
          x: source.x + 50,
          y: source.y + 50,
          ax: source.ax + 50,
          ay: source.ay + 50,
          color: colors[p.pieces.length % colors.length],
        },
      ],
    }));
    setSelected(id);
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
  async function save() {
    setBusy(true);
    try {
      const snapshot = pr;
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
    } catch (e) {
      toast.error(String(e));
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
        };
        return { ...p, slabs: replacement ? p.slabs.map((s) => s.id === sid ? { ...s, ...next } : s) : [...p.slabs, next] };
      });
      replacePhoto.current = false;
      setSid(targetId);
      setDialog("slab");
      toast.success(
        "Photo uploaded. Calibrate the slab dimensions before placing pieces.",
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function calibrateWithAI() {
    try {
      const imageResponse = await fetch(slab.image);
      const imageBlob = await imageResponse.blob();
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(Error("Could not read the slab image."));
        reader.readAsDataURL(imageBlob);
      });
      const response = await fetch("/api/slab-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: imageData }) });
      if (!response.ok) throw Error(await response.text());
      const result = await response.json() as { image?: string; calibration?: PhotoQuad; fallback?: boolean };
      const corrected = result.image
        ? await (await fetch(result.image)).blob()
        : result.calibration
          ? await rectifySlabImage(imageData, result.calibration, slab)
          : (() => { throw Error("AI returned no edited slab image."); })();
      const correctedBitmap = await createImageBitmap(corrected);
      const uploadResponse = await fetch("/api/images", { method: "POST", headers: { "Content-Type": "image/png" }, body: corrected });
      if (!uploadResponse.ok) throw Error(await uploadResponse.text());
      const uploaded = await uploadResponse.json() as { url: string };
      const correctedCalibration: PhotoQuad = { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
      change((p) => ({ ...p, slabs: p.slabs.map((s) => s.id === slab.id ? { ...s, image: uploaded.url, photoWidth: correctedBitmap.width, photoHeight: correctedBitmap.height, crop: { x: 0, y: 0, w: 1, h: 1 }, calibration: correctedCalibration, adjustments: { straighten: 0, perspectiveV: 0, perspectiveH: 0 } } : s) }));
      correctedBitmap.close();
      toast.success(result.fallback ? "Slab straightened automatically using AI corner detection." : "AI edited the slab: front-facing, centered, and isolated.");
    } catch (error) {
      toast.error(String(error));
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
  function snapPosition(project: Project, moving: Piece, x: number, y: number) {
    const slab = project.slabs.find((s) => s.id === moving.slab);
    if (!slab) return { x, y };
    const f = footprint(moving),
      gap = project.kerf,
      threshold = Math.max(12, gap * 3),
      xs = [project.margin, slab.w - project.margin - f.w],
      ys = [project.margin, slab.h - project.margin - f.h];
    for (const other of project.pieces) {
      if (other.id === moving.id || other.slab !== moving.slab) continue;
      const o = footprint(other);
      xs.push(
        other.x,
        other.x + o.w,
        other.x + o.w + gap,
        other.x - f.w - gap,
        other.x + o.w - f.w,
      );
      ys.push(
        other.y,
        other.y + o.h,
        other.y + o.h + gap,
        other.y - f.h - gap,
        other.y + o.h - f.h,
      );
    }
    const nearest = (value: number, candidates: number[]) => {
      const candidate = candidates.reduce(
        (best, current) =>
          Math.abs(current - value) < Math.abs(best - value) ? current : best,
        candidates[0],
      );
      return Math.abs(candidate - value) <= threshold ? candidate : value;
    };
    return {
      x: Math.max(0, Math.round(nearest(x, xs) / 5) * 5),
      y: Math.max(0, Math.round(nearest(y, ys) / 5) * 5),
    };
  }
  function move(e: React.PointerEvent<SVGElement>) {
    if (!drag.current) return;
    const d = drag.current,
      q = point(e);
    let x = Math.max(0, Math.round((d.x + q.x - d.start.x) / 5) * 5),
      y = Math.max(0, Math.round((d.y + q.y - d.start.y) / 5) * 5);
    if (!d.assembly) {
      const moving = current.current.pieces.find((p) => p.id === d.id);
      if (moving) {
        const snapped = snapPosition(current.current, moving, x, y);
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
    const ctx = (document as any).modelContext;
    if (!ctx?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      ctx.registerTool(
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
          execute: (input: any) => {
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
              <button
                key={s.id}
                className={"slabcard " + (slab.id === s.id ? "active" : "")}
                onClick={() => setSid(s.id)}
              >
                <div className="thumb">
                  <img src={s.image} alt={s.name} />
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  {slab.id === s.id && <Check size={16} />}
                </div>
                <b>{s.name}</b>
                <small>
                  {s.w} × {s.h} × {s.thickness} mm
                </small>
              </button>
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
            PRELA MERMER <span>Planning studio · v1</span>
          </div>
        </aside>
        <section className="workspace">
          <div className="toolbar">
            <Tabs value={view} onValueChange={setView}>
              <TabsList>
                <TabsTrigger value="split">Split view</TabsTrigger>
                <TabsTrigger value="slab">Slab layout</TabsTrigger>
                <TabsTrigger value="assembly">Assembly</TabsTrigger>
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
            </div>
          </div>
          <div className={"canvases " + view}>
            {view !== "assembly" && (
              <section className="canvaspanel">
                <div className="canvashead">
                  <h2>
                    <span className="sectionno">01</span> Slab layout
                  </h2>
                  <button className="quiet" onClick={() => setDialog("slab")}>
                    <SlidersHorizontal size={15} /> Slab settings
                  </button>
                </div>
                <ZoomBoard zoom={zoom}>
                  <svg
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
                      style={{ transform: photoPerspectiveTransform(photoAdjustments), transformOrigin: "center center", transformBox: "fill-box" }}
                      preserveAspectRatio="none"
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
                      const f = footprint(p),
                        slabHole = opening(p, true),
                        hole = { ...slabHole, x: slabHole.x - p.x, y: slabHole.y - p.y },
                        index = pr.pieces.indexOf(p) + 1;
                      return (
                        <g
                          key={p.id}
                          transform={`translate(${p.x} ${p.y})`}
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
                          <rect
                            x={0}
                            y={0}
                            width={f.w}
                            height={f.h}
                            fill={p.color}
                            fillOpacity={selected === p.id ? 0.24 : 0.1}
                            stroke={
                              hasIssue(warnings, p.id)
                                ? "#f46d68"
                                : p.color
                            }
                            strokeWidth={selected === p.id ? 10 : 5}
                          />
                          {p.holeW > 0 && p.holeH > 0 && (
                            <rect
                              x={hole.x}
                              y={hole.y}
                              width={hole.w}
                              height={hole.h}
                              fill="#151b1f99"
                              stroke={p.color}
                              strokeWidth={5}
                              strokeDasharray="12 8"
                            />
                          )}
                          {showLabels && (
                            <>
                              <rect
                                x={18}
                                y={18}
                                width={Math.max(0, Math.min(f.w - 36, 510))}
                                height={120}
                                rx={12}
                                fill="#14201fe8"
                              />
                              <text x={45} y={97} fontSize={55} fill={p.color}>
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
                                {p.rot ? " · 90°" : ""}
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
                    magnetic snap {pr.kerf} mm
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
                    <span className="sectionno">02</span> Assembly preview
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
                          hole = opening(p),
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
                                  d={
                                    `M0 0H${p.w}V${p.h}H0Z` +
                                    (p.holeW && p.holeH
                                      ? ` M${hole.x} ${hole.y}v${p.holeH}h${p.holeW}v-${p.holeH}Z`
                                      : "")
                                  }
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
                                transform={
                                  p.rot
                                    ? `matrix(0 -1 1 0 ${-p.y} ${p.x + p.h})`
                                    : `translate(${-p.x} ${-p.y})`
                                }
                              />
                            </g>
                            <rect
                              width={p.w}
                              height={p.h}
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
              <h3>Position on slab</h3>
              {piece.slab !== slab.id && (
                <button
                  className="fullbutton"
                  onClick={() =>
                    patch({ slab: slab.id, x: pr.margin, y: pr.margin })
                  }
                >
                  Move to selected slab
                </button>
              )}
              <div className="twocol">
                <Num label="X" value={piece.x} onChange={(x) => patch({ x })} />
                <Num label="Y" value={piece.y} onChange={(y) => patch({ y })} />
              </div>
              <button
                className="fullbutton"
                onClick={() => patch({ rot: !piece.rot })}
              >
                <RotateCw size={16} /> Rotate piece 90°{" "}
                <span>{piece.rot ? "90°" : "0°"}</span>
              </button>
              <h3>Blade cut angle</h3>
              <div className="angle-options">
                {([0, 45] as CutAngle[]).map((angle) => (
                  <button
                    key={angle}
                    className={pieceAngle(piece) === angle ? "active" : ""}
                    onClick={() => patch({ cutAngle: angle })}
                  >
                    <RotateCw size={14} /> {angle}°
                  </button>
                ))}
              </div>
              <p className="hint">
                45° cuts the edge with a bevel over the slab; it does not rotate the piece layout.
              </p>
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
              <h3>Opening</h3>
              <div className="twocol">
                <Num
                  label="Width"
                  value={piece.holeW}
                  onChange={(holeW) => patch({ holeW })}
                />
                <Num
                  label="Height"
                  value={piece.holeH}
                  onChange={(holeH) => patch({ holeH })}
                />
              </div>
              <div className="twocol">
                <Num
                  label="X offset"
                  value={piece.holeX ?? 0}
                  min={-20000}
                  onChange={(holeX) => patch({ holeX })}
                />
                <Num
                  label="Y offset"
                  value={piece.holeY ?? 0}
                  min={-20000}
                  onChange={(holeY) => patch({ holeY })}
                />
              </div>
              <div className="opening-actions">
                {(["X", "Y"] as const).flatMap((axis) =>
                  [-1, 1].map((direction) => (
                    <button
                      key={axis + direction}
                      title="Move opening 5 mm; Shift-click for 50 mm"
                      onClick={(e) => {
                        const key = axis === "X" ? "holeX" : "holeY";
                        patch({
                          [key]: Math.max(
                            -20000,
                            Math.min(
                              20000,
                              (piece[key] ?? 0) +
                                direction * (e.shiftKey ? 50 : 5),
                            ),
                          ),
                        });
                      }}
                    >
                      {axis}
                      {direction > 0 ? "+" : "−"}
                    </button>
                  )),
                )}
              </div>
              <p className="hint">
                Offsets from center: X+ right, X− left, Y+ down, Y− up. Set
                width and height to 0 for a solid piece.
              </p>
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
        <DialogContent className="studio-dialog">
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
              <AiPhotoEditor slab={slab} onAiEdit={calibrateWithAI} />
              <h3>Paint slab defects</h3>
              <DefectPainter
                slab={slab}
                crop={photoCrop}
                calibration={photoCalibration}
                adjustments={photoAdjustments}
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
                For accurate matching, photograph the slab square-on. Use AI
                isolate and straighten to correct perspective, then confirm the
                measured width and height.
              </p>
              <button className="primary" onClick={() => setDialog("")}>
                Apply dimensions
              </button>
            </>
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
              <button
                onClick={() =>
                  download(
                    new Blob([JSON.stringify(pr, null, 2)], {
                      type: "application/json",
                    }),
                    "prela-project.json",
                  )
                }
              >
                <Download /> Download project backup
              </button>
              <button onClick={() => jsonFile.current?.click()}>
                <Upload /> Open project backup
              </button>
              <button onClick={exportSvg}>
                <ScanLine /> Download assembly SVG
              </button>
              <button onClick={() => window.print()}>
                <Download /> Print layout / Save PDF
              </button>
              <p className="hint">
                Project files reference photos stored in this app. Planning
                layouts only; not machine-ready cutting files. Review dimensions
                and allowances with your operator.
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
                <b>Upload a real slab.</b> Straighten it with AI if needed, then
                enter width, height and thickness in millimetres.
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
          try {
            const f = e.target.files?.[0];
            if (!f) return;
            const p = JSON.parse(await f.text());
            if (!validProject(p)) throw Error("Invalid project backup.");
            if (
              saved === "dirty" &&
              !confirm("Replace unsaved changes with this backup?")
            )
              return;
            checkpoint();
            p.id = "";
            setPr(p);
            setSid(p.slabs[0].id);
            setSelected(p.pieces[0]?.id || "");
            setSaved("dirty");
            setDialog("");
            toast.success("Backup opened");
          } catch (e) {
            toast.error(String(e));
          }
          if (jsonFile.current) jsonFile.current.value = "";
        }}
      />
    </main>
  );
}
