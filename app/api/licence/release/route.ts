import { getAccount, saveAccount } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { verifyLicence } from "@/lib/licence-token";

/** "Sign out" in the desktop app: frees this computer's activation. */
export async function POST(req: Request) {
  const { token } = await body<{ token: string }>(req);
  const p = await verifyLicence(String(token ?? ""));
  if (!p) return err(401, "Invalid licence.");
  const a = await getAccount(p.acc);
  if (a) {
    a.licence.devices = a.licence.devices.filter((d) => d.id !== p.dev);
    await saveAccount(a);
  }
  return ok({ released: true });
}
