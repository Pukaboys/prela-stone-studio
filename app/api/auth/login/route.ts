import { AccountError, checkPassword, clientIp, fail, findByEmail, forgive, limited, publicAccount, sameOriginJson, startSession } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { isDesktop } from "@/lib/studio-access";

/** Sign in with email and password (refused when the account is already open in the maximum number of browsers). */
export async function POST(req: Request) {
  if (isDesktop()) return err(404, "Sign in on the website.");
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const b = await body<{ email: string; password: string }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  const key = `login:${clientIp(req)}:${email}`;
  if (limited(key) || limited("login-ip:" + clientIp(req), 30))
    return err(429, "Too many attempts. Wait 15 minutes and try again.");
  const a = email ? await findByEmail(email) : null;
  if (!a || !(await checkPassword(a, String(b.password ?? "")))) {
    fail(key);
    fail("login-ip:" + clientIp(req));
    await new Promise((r) => setTimeout(r, 400));
    return err(401, "Wrong email or password.");
  }
  forgive(key);
  try {
    const cookie = await startSession(req, a);
    return ok({ account: publicAccount(a) }, { "Set-Cookie": cookie });
  } catch (e) {
    if (e instanceof AccountError) return err(409, e.message);
    throw e;
  }
}
