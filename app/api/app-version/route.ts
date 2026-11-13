import { manifest } from "@/lib/downloads";
import { ok } from "@/lib/http";

/** Latest desktop version (update check in the desktop app) and which installers are offered. */
export async function GET() {
  const m = await manifest();
  const size = (f: "windows" | "macArm" | "macIntel") => (m[f] ? (m.sizes?.[f] ?? 0) : null);
  return ok({
    version: m.version ?? null,
    notes: m.notes ?? null,
    published: m.published ?? null,
    // Size in bytes per installer, or null when not offered.
    downloads: { windows: size("windows"), "mac-arm": size("macArm"), "mac-intel": size("macIntel") },
  });
}
