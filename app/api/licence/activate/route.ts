import { logActivity } from "@/lib/activity";
import { ACCOUNT_TRIES, clientIp, fail, findByEmail, forgive, limited, passwordMatches } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { LicenceRefused, issueToken } from "@/lib/licence-server";

/** Desktop app activation: email + password + this computer's id → signed licence. */
export async function POST(req: Request) {
  const b = await body<{ email: string; password: string; deviceId: string; deviceName: string }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  const ip = clientIp(req);
  const computer = String(b.deviceName ?? "").slice(0, 60) || "Computer";
  const key = `activate:${ip}:${email}`;
  const acct = `password:${email}`;
  if (limited(key) || limited("activate-ip:" + ip, 30) || limited(acct, ACCOUNT_TRIES)) {
    const who = email ? await findByEmail(email) : null;
    if (who) await logActivity(req, who, "Sign-in blocked: too many attempts", { device: computer, detail: "desktop app", once: { key: ip, ms: 15 * 60e3 } });
    return err(429, "Too many attempts. Wait 15 minutes and try again.");
  }
  const a = email ? await findByEmail(email) : null;
  if (!(await passwordMatches(a, String(b.password ?? "")))) {
    fail(key);
    fail("activate-ip:" + ip);
    fail(acct);
    if (a) await logActivity(req, a, "Wrong password", { device: computer, detail: "desktop app" });
    await new Promise((r) => setTimeout(r, 400));
    return err(401, "Wrong email or password.");
  }
  forgive(key);
  try {
    const known = a!.licence.devices.some((d) => d.id === String(b.deviceId ?? ""));
    const token = await issueToken(a!, String(b.deviceId ?? ""), b.deviceName);
    await logActivity(req, a!, known ? "Signed in to the desktop app" : "Desktop app activated on a new computer", { device: computer });
    return ok({ token });
  } catch (e) {
    if (e instanceof LicenceRefused) {
      await logActivity(req, a!, "Desktop activation refused", { device: computer, detail: e.message });
      return err(e.status, e.message);
    }
    console.error(e);
    return err(503, "Activation failed.");
  }
}
