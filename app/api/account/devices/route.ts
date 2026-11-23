import { currentSession, publicAccount, sameOriginJson, updateAccount } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Remove a computer from the licence (frees an activation). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const s = await currentSession(req);
  if (!s) return err(401, "Sign in first.");
  const { deviceId } = await body<{ deviceId: string }>(req);
  const a = await updateAccount(s.account.id, (x) => {
    x.licence.devices = x.licence.devices.filter((d) => d.id !== deviceId);
  });
  return ok({ account: publicAccount(a ?? s.account, s.sessionId) });
}
