import { sameOriginJson } from "@/lib/accounts";
import { adminAccess } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { PLATFORMS, ReleaseError, appendChunk, finishUpload, manifest, publish, removePlatform, type Platform, type UploadedFile } from "@/lib/downloads";
import { body, err, ok } from "@/lib/http";

/**
 * Owner only (two-step login): upload and publish desktop installers.
 * GET                                                   → current manifest
 * POST ?upload=<id>&offset=<n>  (raw bytes, ≤ 4 MB)     → { received }
 * POST { action: "finish", upload, platform, name, size } → { name, size, sha256 }
 * POST { action: "publish", version, notes, files }     → manifest
 * POST { action: "remove", platform }                   → manifest
 */
export async function GET(req: Request) {
  const me = await adminAccess(req);
  if (me instanceof Response) return me;
  return ok({ manifest: await manifest() });
}

/** Raw uploads cannot use the JSON check: require an Origin from this site instead. */
function sameOriginUpload(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const fail = (e: unknown) => {
  if (e instanceof ReleaseError) return err(400, e.message);
  console.error(e);
  return err(500, "Something went wrong with the upload.");
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const upload = url.searchParams.get("upload");

  if (upload) {
    if (!sameOriginUpload(req)) return err(400, "Bad request.");
    const me = await adminAccess(req);
    if (me instanceof Response) return me;
    try {
      const bytes = new Uint8Array(await req.arrayBuffer());
      return ok({ received: await appendChunk(upload, Number(url.searchParams.get("offset")), bytes) });
    } catch (e) {
      return fail(e);
    }
  }

  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const me = await adminAccess(req);
  if (me instanceof Response) return me;
  const b = await body<{ action: string; upload: string; platform: Platform; name: string; size: number; version: string; notes: string; files: Partial<Record<Platform, UploadedFile>> }>(req);
  try {
    if (b.action === "finish") return ok(await finishUpload(String(b.upload), b.platform as Platform, String(b.name ?? ""), Number(b.size)));
    if (b.action === "publish") {
      const m = await publish(String(b.version ?? "").trim(), String(b.notes ?? ""), b.files ?? {});
      const what = (Object.keys(b.files ?? {}) as Platform[]).map((p) => PLATFORMS[p]?.label).filter(Boolean).join(", ");
      await audit(req, me.account.email, `Published desktop app ${m.version}`, undefined, what ? `new files: ${what}` : "version / notes only");
      return ok({ manifest: m });
    }
    if (b.action === "remove") {
      const m = await removePlatform(b.platform as Platform);
      await audit(req, me.account.email, `Removed ${PLATFORMS[b.platform as Platform]?.label} download`);
      return ok({ manifest: m });
    }
    return err(400, "Unknown action.");
  } catch (e) {
    return fail(e);
  }
}
