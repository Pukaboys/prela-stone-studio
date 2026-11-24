import { logActivity } from "@/lib/activity";
import { getAccount } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { LicenceRefused, issueToken } from "@/lib/licence-server";
import { verifyLicence } from "@/lib/licence-token";

/** Daily check-in from the desktop app: renewals, removed computers. */
export async function POST(req: Request) {
  const { token } = await body<{ token: string }>(req);
  const p = await verifyLicence(String(token ?? ""));
  if (!p) return err(401, "Invalid licence.");
  const a = await getAccount(p.acc);
  if (!a) return err(403, "This licence no longer exists.");
  const device = a.licence.devices.find((d) => d.id === p.dev)?.name ?? "Computer";
  try {
    const t = await issueToken(a, p.dev, undefined, false);
    // The app checks in when it opens and once a day; one entry per computer per day is enough.
    await logActivity(req, a, "Desktop app opened (licence check)", { device, once: { key: p.dev, ms: 864e5 } });
    return ok({ token: t });
  } catch (e) {
    if (e instanceof LicenceRefused) {
      await logActivity(req, a, "Desktop licence check refused", { device, detail: e.message, once: { key: p.dev, ms: 864e5 } });
      return err(e.status, e.message);
    }
    console.error(e);
    return err(503, "Could not check the licence.");
  }
}
