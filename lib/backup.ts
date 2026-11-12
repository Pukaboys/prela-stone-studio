/**
 * Self-contained project backups.
 *
 * Slab photos live in the storage of the copy that uploaded them (the website
 * on Hostinger, or the desktop app's data folder). A project only links to
 * them (`/api/images?id=…`), so a plain project file opened in another copy
 * shows broken photos. Backups therefore embed every photo, and restoring a
 * backup uploads the photos into the current copy and rewrites the links.
 *
 * File format (version 2):
 *   { format: "prela-stone-studio-backup", version: 2, exportedAt,
 *     project: Project, images: { "<original url>": "data:image/…;base64,…" } }
 * Older backups (a bare Project) still open; their photos are reported as
 * missing if this copy does not have them.
 */
import { validProject, type Project } from "@/lib/model";

const FORMAT = "prela-stone-studio-backup";
const STORED = /^\/api\/images\?id=[a-zA-Z0-9-]+$/;

type BackupFile = {
  format: typeof FORMAT;
  version: 2;
  exportedAt: string;
  project: Project;
  images: Record<string, string>;
};

/** Every stored photo a project links to (current slab photos and originals kept for re-editing). */
function photoUrls(project: Project) {
  const urls = new Set<string>();
  for (const s of project.slabs) {
    if (STORED.test(s.image)) urls.add(s.image);
    if (s.edit && STORED.test(s.edit.source)) urls.add(s.edit.source);
  }
  return [...urls];
}

function toDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error("Could not read a slab photo."));
    reader.readAsDataURL(blob);
  });
}

/** Build a backup file that includes the slab photos. */
export async function createBackup(project: Project): Promise<Blob> {
  const images: Record<string, string> = {};
  await Promise.all(
    photoUrls(project).map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw Error("A slab photo is missing from this copy, so it cannot be included in the backup.");
      images[url] = await toDataUrl(await res.blob());
    }),
  );
  const file: BackupFile = {
    format: FORMAT,
    version: 2,
    exportedAt: new Date().toISOString(),
    project,
    images,
  };
  return new Blob([JSON.stringify(file)], { type: "application/json" });
}

async function upload(dataUrl: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const type = ["image/jpeg", "image/png", "image/webp"].includes(blob.type) ? blob.type : "image/jpeg";
  const res = await fetch("/api/images", { method: "POST", headers: { "Content-Type": type }, body: blob });
  if (!res.ok) throw Error(await res.text());
  return ((await res.json()) as { url: string }).url;
}

async function exists(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Read a backup (new or old format), upload its photos into this copy and
 * return the project with updated photo links. `missing` lists slabs whose
 * photo is neither embedded nor available here (old-format backups).
 */
export async function restoreBackup(text: string): Promise<{ project: Project; missing: string[] }> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error("This file is not a project backup.");
  }
  const isBackup = !!data && typeof data === "object" && (data as BackupFile).format === FORMAT;
  const project = (isBackup ? (data as BackupFile).project : data) as Project;
  const images = isBackup ? ((data as BackupFile).images ?? {}) : {};
  if (!validProject(project)) throw Error("Invalid project backup.");

  // Upload each embedded photo once, then point the slabs at the new copies.
  const moved = new Map<string, string>();
  for (const url of photoUrls(project)) {
    const embedded = images[url];
    if (typeof embedded === "string" && embedded.startsWith("data:image/")) moved.set(url, await upload(embedded));
  }
  const relink = (url: string) => moved.get(url) ?? url;
  const restored: Project = {
    ...project,
    id: "",
    slabs: project.slabs.map((s) => ({
      ...s,
      image: relink(s.image),
      ...(s.edit ? { edit: { ...s.edit, source: relink(s.edit.source) } } : {}),
    })),
  };

  const missing: string[] = [];
  for (const s of restored.slabs)
    if (STORED.test(s.image) && !moved.has(s.image) && !(await exists(s.image))) missing.push(s.name);
  return { project: restored, missing };
}
