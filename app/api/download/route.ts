import { currentAccount, licenceStatus } from "@/lib/accounts";
import { manifest } from "@/lib/downloads";
import { getStore } from "@/lib/storage";

const FILES = { windows: "windows", "mac-arm": "macArm", "mac-intel": "macIntel" } as const;

/** Installer download: only for signed-in accounts with an active trial or plan. */
export async function GET(req: Request) {
  const a = await currentAccount(req);
  if (!a) return Response.redirect(new URL("/login?next=/account", req.url), 302);
  if (!licenceStatus(a).active) return new Response("Your licence has ended. Renew it on your account page.", { status: 402 });
  const platform = new URL(req.url).searchParams.get("platform") as keyof typeof FILES;
  const name = FILES[platform] ? (await manifest())[FILES[platform]] : undefined;
  if (!name || /[\\/]|\.\./.test(name)) return new Response("This download is not available yet.", { status: 404 });
  const obj = await (await getStore()).get("downloads/" + name);
  if (!obj) return new Response("This download is not available yet.", { status: 404 });
  return new Response(obj.body as BodyInit, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
