/**
 * Installers for licensed customers. Upload them to the data folder:
 *   downloads/manifest.json  { "version": "1.0.1", "windows": "Jeo Stone Studio Setup 1.0.1.exe",
 *                              "macArm": "Jeo Stone Studio-1.0.1-arm64.dmg", "macIntel": "Jeo Stone Studio-1.0.1-x64.dmg" }
 *   downloads/<those files>
 */
import { getStore } from "@/lib/storage";

export type Manifest = { version?: string; windows?: string; macArm?: string; macIntel?: string; notes?: string };

export async function manifest(): Promise<Manifest> {
  const obj = await (await getStore()).get("downloads/manifest.json");
  if (!obj) return {};
  try {
    return JSON.parse(await new Response(obj.body as BodyInit).text()) as Manifest;
  } catch {
    return {};
  }
}
