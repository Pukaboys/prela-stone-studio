/**
 * Desktop app only: the licence on this computer.
 * GET  → status (checks in online once a day when possible)
 * POST { action: "activate", email, password } | { action: "signout" }
 */
import { body, err, ok } from "@/lib/http";
import { deviceId, isDesktop, localLicence, localToken, saveLocalToken } from "@/lib/studio-access";
import { getSetting } from "@/lib/storage";

async function server() {
  return ((await getSetting("JEO_LICENSE_SERVER")) ?? "").replace(/\/+$/, "");
}

async function call(path: string, data: unknown) {
  const base = await server();
  if (!base) throw new Error("No licence server is configured for this app.");
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  return { status: res.status, ...json };
}

async function status() {
  let lic = await localLicence();
  // Check in once a day: renewals, plan changes, removed computers.
  if (lic.ok && lic.needsRefresh) {
    try {
      const r = await call("/api/licence/refresh", { token: await localToken() });
      if (r.token) await saveLocalToken(r.token);
      else if (r.status === 403 || r.status === 401) await saveLocalToken(null);
      lic = await localLicence();
    } catch {
      // Offline: keep working until the offline grace period runs out.
    }
  }
  const p = "payload" in lic ? lic.payload : undefined;
  return {
    ok: lic.ok,
    reason: lic.ok ? null : lic.reason,
    email: p?.email ?? null,
    plan: p?.plan ?? null,
    expiresAt: p ? new Date(p.exp).toISOString() : null,
    server: await server(),
  };
}

export async function GET() {
  if (!isDesktop()) return err(404, "Not available.");
  return ok(await status());
}

export async function POST(req: Request) {
  if (!isDesktop()) return err(404, "Not available.");
  const b = await body<{ action: string; email: string; password: string }>(req);
  try {
    if (b.action === "activate") {
      const os = await import("node:os");
      const r = await call("/api/licence/activate", {
        email: String(b.email ?? ""),
        password: String(b.password ?? ""),
        deviceId: await deviceId(),
        deviceName: os.hostname(),
      });
      if (!r.token) return err(r.status >= 400 ? r.status : 502, r.error ?? "Activation failed.");
      await saveLocalToken(r.token);
      return ok(await status());
    }
    if (b.action === "signout") {
      const token = await localToken();
      if (token) await call("/api/licence/release", { token }).catch(() => undefined);
      await saveLocalToken(null);
      return ok(await status());
    }
    return err(400, "Unknown action.");
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return err(503, timeout ? "The licence server did not answer. Check the internet connection." : e instanceof Error ? e.message : "Activation failed.");
  }
}
