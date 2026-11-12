import { manifest } from "@/lib/downloads";
import { ok } from "@/lib/http";

/** Latest desktop version, for the update check in the desktop app. */
export async function GET() {
  const m = await manifest();
  return ok({ version: m.version ?? null, notes: m.notes ?? null });
}
