/**
 * Desktop app only: the licence on this computer.
 * GET  → status. Checks in with the website whenever online (each start and
 *        every few hours; ?check=1 forces it): renewals, plan changes and
 *        removed computers. Offline, the app keeps full use for
 *        OFFLINE_GRACE_DAYS since the last check-in, then runs in limited
 *        (view-only) mode, as it does when the licence has ended.
 * POST { action: "activate", email, password } | { action: "signout" }
 */
import { body, err, ok } from "@/lib/http";
import { OFFLINE_GRACE_DAYS, verifyLicence } from "@/lib/licence-token";
import { deviceId, isDesktop, isLimited, localLicence, localToken, saveLocalToken } from "@/lib/studio-access";
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

async function status(force = false) {
  let lic = await localLicence();
  let online: boolean | null = null; // null: no check needed right now
  const token = await localToken();
  // Check in when due, and always when the licence has ended or the app was
  // offline too long (a renewal or reconnection lifts limited mode).
  if (token && (force || isLimited(lic) || (lic.ok && lic.needsRefresh))) {
    try {
      const r = await call("/api/licence/refresh", { token });
      online = true;
      if (r.token) await saveLocalToken(r.token);
      else if (r.status === 403 || r.status === 401) await saveLocalToken(null); // computer removed: sign in again
      lic = await localLicence();
    } catch {
      online = false; // offline: full use continues until the grace period runs out
    }
  }
  const p = "payload" in lic ? lic.payload : token ? await verifyLicence(token) : null;
  const sinceCheck = p ? (Date.now() - p.iat) / 864e5 : 0;
  return {
    ok: lic.ok,
    limited: isLimited(lic),
    reason: lic.ok ? null : lic.reason,
    email: p?.email ?? null,
    plan: p?.plan ?? null,
    expiresAt: p ? new Date(p.exp).toISOString() : null,
    lastCheck: p ? new Date(p.iat).toISOString() : null,
    offlineDaysLeft: p ? Math.max(0, Math.ceil(OFFLINE_GRACE_DAYS - sinceCheck)) : 0,
    online,
    server: await server(),
  };
}

export async function GET(req: Request) {
  if (!isDesktop()) return err(404, "Not available.");
  return ok(await status(new URL(req.url).searchParams.has("check")));
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
