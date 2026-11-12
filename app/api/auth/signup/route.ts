import { AccountError, clientIp, createAccount, fail, limited, passwordProblem, publicAccount, sameOriginJson, sessionCookie, validEmail } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { isDesktop } from "@/lib/studio-access";

/** Create an account (starts the free trial) and sign in. */
export async function POST(req: Request) {
  if (isDesktop()) return err(404, "Create your account on the website.");
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const ip = "signup:" + clientIp(req);
  if (limited(ip, 5)) return err(429, "Too many new accounts from this connection. Try again later.");
  const b = await body<{ email: string; password: string; name: string }>(req);
  const email = String(b.email ?? ""), password = String(b.password ?? "");
  if (!validEmail(email.trim())) return err(400, "Enter a valid email address.");
  const problem = passwordProblem(password);
  if (problem) return err(400, problem);
  try {
    const a = await createAccount(email, password, typeof b.name === "string" ? b.name : undefined);
    fail(ip); // count successful sign-ups too (max 5 per 15 minutes per address)
    return ok({ account: publicAccount(a) }, { "Set-Cookie": await sessionCookie(req, a) });
  } catch (e) {
    if (e instanceof AccountError) return err(409, e.message);
    console.error(e);
    return err(503, "Could not create the account. Please try again.");
  }
}
