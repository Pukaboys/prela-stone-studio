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
  try {
    return ok({ token: await issueToken(a, p.dev, undefined, false) });
  } catch (e) {
    if (e instanceof LicenceRefused) return err(e.status, e.message);
    console.error(e);
    return err(503, "Could not check the licence.");
  }
}
