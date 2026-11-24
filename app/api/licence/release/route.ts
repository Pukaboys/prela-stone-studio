import { logActivity } from "@/lib/activity";
import { updateAccount } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { verifyLicence } from "@/lib/licence-token";

/** "Sign out" in the desktop app: frees this computer's activation. */
export async function POST(req: Request) {
  const { token } = await body<{ token: string }>(req);
  const p = await verifyLicence(String(token ?? ""));
  if (!p) return err(401, "Invalid licence.");
  let device = "";
  const account = await updateAccount(p.acc, (a) => {
    device = a.licence.devices.find((d) => d.id === p.dev)?.name ?? "";
    const before = a.licence.devices.length;
    a.licence.devices = a.licence.devices.filter((d) => d.id !== p.dev);
    return a.licence.devices.length !== before;
  });
  if (account && device) await logActivity(req, account, "Signed out of the desktop app", { device, detail: "computer freed" });
  return ok({ released: true });
}
