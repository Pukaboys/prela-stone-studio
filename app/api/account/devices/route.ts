import { currentAccount, publicAccount, sameOriginJson, saveAccount } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Remove a computer from the licence (frees an activation). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const a = await currentAccount(req);
  if (!a) return err(401, "Sign in first.");
  const { deviceId } = await body<{ deviceId: string }>(req);
  a.licence.devices = a.licence.devices.filter((d) => d.id !== deviceId);
  await saveAccount(a);
  return ok({ account: publicAccount(a) });
}
