/**
 * Desktop installers for licensed customers.
 *
 * The owner uploads them on /admin (in 4 MB pieces, so the web host's upload
 * limit does not matter) and publishes a version. Files live in the data
 * folder under downloads/, described by downloads/manifest.json:
 *   { version, notes, published, windows, macArm, macIntel, sizes, sha256 }
 * Downloads stream from disk (resumable), and the desktop app's update check
 * reads the version.
 */
import { createHash } from "node:crypto";
import { getStore } from "@/lib/storage";

export const PLATFORMS = {
  windows: { field: "windows", label: "Windows", ext: [".exe"] },
  "mac-arm": { field: "macArm", label: "Mac (Apple Silicon)", ext: [".dmg", ".zip"] },
  "mac-intel": { field: "macIntel", label: "Mac (Intel)", ext: [".dmg", ".zip"] },
} as const;
export type Platform = keyof typeof PLATFORMS;
type Field = (typeof PLATFORMS)[Platform]["field"];

export type Manifest = {
  version?: string;
  notes?: string;
  published?: string;
  windows?: string;
  macArm?: string;
  macIntel?: string;
  sizes?: Partial<Record<Field, number>>;
  sha256?: Partial<Record<Field, string>>;
};
export type UploadedFile = { name: string; size: number; sha256: string };

export const CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_INSTALLER_BYTES = 600 * 1024 * 1024;
const MANIFEST = "downloads/manifest.json";
const UPLOADS = "downloads/.uploads/";

export class ReleaseError extends Error {}

export async function manifest(): Promise<Manifest> {
  const obj = await (await getStore()).get(MANIFEST);
  if (!obj) return {};
  try {
    return JSON.parse(await new Response(obj.body as BodyInit).text()) as Manifest;
  } catch {
    return {};
  }
}

/** Disk access (installers are too large to keep in memory). Node file store only. */
async function disk() {
  const store = await getStore();
  if (!store.filePath) throw new ReleaseError("Installer uploads work on the Node server (Hostinger), not on Cloudflare.");
  const fs = await import("node:fs");
  const path = await import("node:path");
  return { store, fs, path, file: (key: string) => store.filePath!(key) };
}

export const validUploadId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
/** Safe file name: letters, digits, spaces, dots, dashes, brackets; keeps the extension. */
export function safeName(name: string) {
  if (/[\\/]|\.\./.test(name)) throw new ReleaseError("Invalid file name.");
  const clean = name.replace(/[^\w .()+-]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
  if (!clean || clean.includes("..")) throw new ReleaseError("Invalid file name.");
  return clean;
}

/** Append one piece at `offset`; a repeated piece (same offset) is ignored, so retries are safe. */
export async function appendChunk(uploadId: string, offset: number, bytes: Uint8Array) {
  if (!validUploadId(uploadId)) throw new ReleaseError("Invalid upload.");
  if (bytes.byteLength > CHUNK_BYTES) throw new ReleaseError("Piece too large.");
  const { fs, path, file } = await disk();
  const part = file(UPLOADS + uploadId + ".part");
  await fs.promises.mkdir(path.dirname(part), { recursive: true });
  const size = await fs.promises.stat(part).then((s) => s.size, () => 0);
  if (offset + bytes.byteLength <= size) return size; // already have it
  if (offset !== size) throw new ReleaseError(`Expected the piece at ${size}.`);
  if (size + bytes.byteLength > MAX_INSTALLER_BYTES) throw new ReleaseError("The file is too large.");
  await fs.promises.appendFile(part, bytes);
  return size + bytes.byteLength;
}

/** Check the finished upload and move it into downloads/ under its name. */
export async function finishUpload(uploadId: string, platform: Platform, fileName: string, size: number): Promise<UploadedFile> {
  if (!validUploadId(uploadId) || !PLATFORMS[platform]) throw new ReleaseError("Invalid upload.");
  const name = safeName(fileName);
  if (!PLATFORMS[platform].ext.some((e) => name.toLowerCase().endsWith(e)))
    throw new ReleaseError(`${PLATFORMS[platform].label} needs a ${PLATFORMS[platform].ext.join(" or ")} file.`);
  const { fs, file } = await disk();
  const part = file(UPLOADS + uploadId + ".part");
  const stat = await fs.promises.stat(part).catch(() => null);
  if (!stat || stat.size !== size) throw new ReleaseError("The upload is incomplete. Try again.");
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) =>
    fs.createReadStream(part).on("data", (d) => hash.update(d)).on("end", () => resolve()).on("error", reject),
  );
  await fs.promises.rename(part, file("downloads/" + name));
  return { name, size, sha256: hash.digest("hex") };
}

/** Make a version live. Platforms not given keep their current file; unused old files are removed. */
export async function publish(version: string, notes: string, files: Partial<Record<Platform, UploadedFile>>): Promise<Manifest> {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(version)) throw new ReleaseError("Version like 1.0.1.");
  const { store, fs, file } = await disk();
  const m = await manifest();
  const next: Manifest = { ...m, version, notes: notes.trim().slice(0, 1000) || undefined, published: new Date().toISOString(), sizes: { ...m.sizes }, sha256: { ...m.sha256 } };
  for (const [platform, f] of Object.entries(files) as [Platform, UploadedFile][]) {
    const field = PLATFORMS[platform]?.field;
    if (!field || !f) continue;
    const name = safeName(f.name);
    if (!(await fs.promises.stat(file("downloads/" + name)).catch(() => null))) throw new ReleaseError(`${name} was not uploaded.`);
    next[field] = name;
    next.sizes![field] = f.size;
    next.sha256![field] = f.sha256;
  }
  await store.put(MANIFEST, JSON.stringify(next, null, 2), "application/json");
  // Remove installers no version points to any more.
  const keep = new Set([next.windows, next.macArm, next.macIntel].filter(Boolean));
  for (const entry of await fs.promises.readdir(file("downloads")).catch(() => [] as string[])) {
    if (entry === "manifest.json" || entry.startsWith(".") || entry.endsWith(".meta.json") || keep.has(entry)) continue;
    await fs.promises.unlink(file("downloads/" + entry)).catch(() => undefined);
  }
  return next;
}

/** Stop offering one platform. */
export async function removePlatform(platform: Platform) {
  const field = PLATFORMS[platform]?.field;
  if (!field) throw new ReleaseError("Unknown platform.");
  const { store, fs, file } = await disk();
  const m = await manifest();
  const old = m[field];
  delete m[field];
  delete m.sizes?.[field];
  delete m.sha256?.[field];
  await store.put(MANIFEST, JSON.stringify(m, null, 2), "application/json");
  if (old) await fs.promises.unlink(file("downloads/" + old)).catch(() => undefined);
  return m;
}

/** A stream of an installer (whole, or from a byte offset for resumed downloads). */
export async function openInstaller(name: string, range?: { start: number; end?: number }) {
  const { fs, file } = await disk();
  const path = file("downloads/" + safeName(name));
  const stat = await fs.promises.stat(path).catch(() => null);
  if (!stat) return null;
  const start = range?.start ?? 0;
  const end = Math.min(range?.end ?? stat.size - 1, stat.size - 1);
  if (start > end) return { size: stat.size, start, end, stream: null };
  const { Readable } = await import("node:stream");
  const stream = Readable.toWeb(fs.createReadStream(path, { start, end })) as ReadableStream;
  return { size: stat.size, start, end, stream };
}
