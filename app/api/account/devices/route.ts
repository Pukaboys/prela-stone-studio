import { logActivity } from "@/lib/activity";
import { currentSession, publicAccount, sameOriginJson, updateAccount } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Remove a computer from the licence (frees an activation). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const s = await currentSession(req);
  if (!s) return err(401, "Sign in first.");
  const { deviceId } = await body<{ deviceId: string }>(req);
  let removed = "";
  const a = await updateAccount(s.account.id, (x) => {
    removed = x.licence.devices.find((d) => d.id === deviceId)?.name ?? "";
    x.licence.devices = x.licence.devices.filter((d) => d.id !== deviceId);
  });
  if (removed) await logActivity(req, s.account, "Computer removed from licence", { detail: removed });
  return ok({ account: publicAccount(a ?? s.account, s.sessionId) });
}
