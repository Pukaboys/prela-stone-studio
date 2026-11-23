import { updateAccount } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { verifyLicence } from "@/lib/licence-token";

/** "Sign out" in the desktop app: frees this computer's activation. */
export async function POST(req: Request) {
  const { token } = await body<{ token: string }>(req);
  const p = await verifyLicence(String(token ?? ""));
  if (!p) return err(401, "Invalid licence.");
  await updateAccount(p.acc, (a) => {
    const before = a.licence.devices.length;
    a.licence.devices = a.licence.devices.filter((d) => d.id !== p.dev);
    return a.licence.devices.length !== before;
  });
  return ok({ released: true });
}
