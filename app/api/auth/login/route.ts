import { logActivity } from "@/lib/activity";
import { ACCOUNT_TRIES, AccountError, clientIp, fail, findByEmail, forgive, limited, passwordMatches, publicAccount, sameOriginJson, startSession } from "@/lib/accounts";
import { body, err, ok } from "@/lib/http";
import { isDesktop } from "@/lib/studio-access";

/** Sign in with email and password (refused when the account is already open in the maximum number of browsers). */
export async function POST(req: Request) {
  if (isDesktop()) return err(404, "Sign in on the website.");
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const b = await body<{ email: string; password: string }>(req);
  const email = String(b.email ?? "").trim().toLowerCase();
  const ip = clientIp(req);
  const key = `login:${ip}:${email}`;
  const acct = `password:${email}`;
  if (limited(key) || limited("login-ip:" + ip, 30) || limited(acct, ACCOUNT_TRIES)) {
    const who = email ? await findByEmail(email) : null;
    if (who) await logActivity(req, who, "Sign-in blocked: too many attempts", { once: { key: ip, ms: 15 * 60e3 } });
    return err(429, "Too many attempts. Wait 15 minutes and try again.");
  }
  const a = email ? await findByEmail(email) : null;
  if (!(await passwordMatches(a, String(b.password ?? "")))) {
    fail(key);
    fail("login-ip:" + ip);
    fail(acct);
    if (a) await logActivity(req, a, "Wrong password", { detail: "website sign-in" });
    await new Promise((r) => setTimeout(r, 400));
    return err(401, "Wrong email or password.");
  }
  forgive(key);
  try {
    const cookie = await startSession(req, a!);
    await logActivity(req, a!, "Signed in");
    return ok({ account: publicAccount(a!) }, { "Set-Cookie": cookie });
  } catch (e) {
    if (e instanceof AccountError) {
      await logActivity(req, a!, "Sign-in refused: browser limit reached");
      return err(409, e.message);
    }
    throw e;
  }
}
