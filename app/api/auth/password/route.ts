import { checkPassword, currentAccount, passwordProblem, sameOriginJson, setPassword, startSession } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";

/** Change the password (signs out every other session). */
export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const a = await currentAccount(req);
  if (!a) return err(401, "Sign in first.");
  const b = await body<{ current: string; next: string }>(req);
  if (!(await checkPassword(a, String(b.current ?? "")))) return err(400, "Your current password is wrong.");
  const problem = passwordProblem(String(b.next ?? ""));
  if (problem) return err(400, problem);
  await setPassword(a, String(b.next));
  return ok({ changed: true }, { "Set-Cookie": await startSession(req, a) });
}
