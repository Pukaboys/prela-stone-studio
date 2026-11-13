import { AccountError, clientIp, fail, limited, passwordProblem, publicAccount, readLinkToken, saveAccount, sameOriginJson, setPassword, startSession } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Set a new password from an emailed reset link; signs out every browser and signs this one in. */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const ip = "reset:" + clientIp(req);
  if (limited(ip, 10)) return err(429, "Too many attempts. Wait 15 minutes and try again.");
  const b = await body<{ token: string; password: string }>(req);
  const a = await readLinkToken("reset", String(b.token ?? ""));
  if (!a) {
    fail(ip);
    return err(400, "This reset link is no longer valid. Ask for a new one.");
  }
  const problem = passwordProblem(String(b.password ?? ""));
  if (problem) return err(400, problem);
  await setPassword(a, String(b.password));
  // Getting the link proves the address works.
  if (a.emailVerified !== true) {
    a.emailVerified = true;
    await saveAccount(a);
  }
  try {
    return ok({ account: publicAccount(a) }, { "Set-Cookie": await startSession(req, a) });
  } catch (e) {
    if (e instanceof AccountError) return err(409, e.message);
    throw e;
  }
}
