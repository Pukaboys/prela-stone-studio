import { logActivity } from "@/lib/activity";
import { currentAccount, licenceStatus } from "@/lib/accounts";
import { PLATFORMS, manifest, openInstaller, type Platform } from "@/lib/downloads";

/**
 * Installer download: only for signed-in accounts with an active paid
 * plan. Streams from disk, and supports resuming (HTTP Range).
 */
export async function GET(req: Request) {
  const a = await currentAccount(req);
  if (!a) return Response.redirect(new URL("/login?next=/account", req.url), 302);
  if (!licenceStatus(a).active) {
    await logActivity(req, a, "Download refused", { detail: "licence ended", once: { key: "ended", ms: 3600e3 } });
    return new Response("Your licence has ended. Renew it on your account page.", { status: 402 });
  }
  // The desktop app comes with a paid plan, not with the free trial.
  if (a.licence.plan === "trial")
    return new Response("The desktop app comes with a paid plan. Choose a plan on your account page.", { status: 402 });
  const platform = new URL(req.url).searchParams.get("platform") as Platform;
  const current = await manifest();
  const name = PLATFORMS[platform] ? current[PLATFORMS[platform].field] : undefined;
  const missing = () => new Response("This download is not available yet.", { status: 404 });
  if (!name) return missing();

  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const file = await openInstaller(name, m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined } : undefined).catch(() => null);
  if (!file) return missing();
  // Resumed parts of the same download are not logged again.
  if (!m || Number(m[1]) === 0)
    await logActivity(req, a, "Downloaded the desktop app", { detail: `${PLATFORMS[platform].label} · version ${current.version ?? "?"}` });
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  if (!file.stream) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.size}` } });
  headers["Content-Length"] = String(file.end - file.start + 1);
  if (m) headers["Content-Range"] = `bytes ${file.start}-${file.end}/${file.size}`;
  return new Response(file.stream, { status: m ? 206 : 200, headers });
}
