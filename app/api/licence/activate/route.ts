import { checkPassword, clientIp, fail, findByEmail, forgive, limited } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { LicenceRefused, issueToken } from "@/lib/licence-server";

/** Desktop app activation: email + password + this computer's id → signed licence. */
export async function POST(req: Request) {
  const b = await body<{ email: string; password: string; deviceId: string; deviceName: string }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  const key = `activate:${clientIp(req)}:${email}`;
  if (limited(key)) return err(429, "Too many attempts. Wait 15 minutes and try again.");
  const a = email ? await findByEmail(email) : null;
  if (!a || !(await checkPassword(a, String(b.password ?? "")))) {
    fail(key);
    await new Promise((r) => setTimeout(r, 400));
    return err(401, "Wrong email or password.");
  }
  forgive(key);
  try {
    return ok({ token: await issueToken(a, String(b.deviceId ?? ""), b.deviceName) });
  } catch (e) {
    if (e instanceof LicenceRefused) return err(e.status, e.message);
    console.error(e);
    return err(503, e instanceof Error ? e.message : "Activation failed.");
  }
}
