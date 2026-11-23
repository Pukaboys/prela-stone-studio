import { ACCOUNT_TRIES, checkPassword, currentAccount, fail, passwordProblem, limited, sameOriginJson, setPassword, startSession } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Change the password (signs out every other session). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const a = await currentAccount(req);
  if (!a) return err(401, "Sign in first.");
  const tries = `password:${a.email}`;
  if (limited(tries, ACCOUNT_TRIES)) return err(429, "Too many attempts. Wait 15 minutes and try again.");
  const b = await body<{ current: string; next: string }>(req);
  if (!(await checkPassword(a, String(b.current ?? "")))) {
    fail(tries);
    return err(400, "Your current password is wrong.");
  }
  const problem = passwordProblem(String(b.next ?? ""));
  if (problem) return err(400, problem);
  await setPassword(a, String(b.next));
  return ok({ changed: true }, { "Set-Cookie": await startSession(req, a) });
}
