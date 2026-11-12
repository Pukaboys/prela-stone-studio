import {
  checkPassword,
  clearCookie,
  clearFailures,
  clientKey,
  isSignedIn,
  recordFailure,
  sessionCookie,
  studioPassword,
  tooManyAttempts,
} from "@/lib/auth";

const noStore = { "Cache-Control": "no-store" };

/** Whether a password is required and whether this browser is signed in. */
export async function GET(req: Request) {
  return Response.json({ required: !!(await studioPassword()), signedIn: await isSignedIn(req) }, { headers: noStore });
}

/** Sign in with the team password. */
export async function POST(req: Request) {
  if (!(await studioPassword())) return Response.json({ signedIn: true }, { headers: noStore });
  const key = clientKey(req);
  if (tooManyAttempts(key))
    return Response.json({ error: "Too many attempts. Wait 15 minutes and try again." }, { status: 429, headers: noStore });
  let password = "";
  try {
    password = String(((await req.json()) as { password?: unknown }).password ?? "");
  } catch {
    // empty or invalid body counts as a wrong password
  }
  if (!(await checkPassword(password))) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return Response.json({ error: "Wrong password." }, { status: 401, headers: noStore });
  }
  clearFailures(key);
  return Response.json({ signedIn: true }, { headers: { ...noStore, "Set-Cookie": await sessionCookie(req) } });
}

/** Sign out. */
export async function DELETE(req: Request) {
  return Response.json({ signedIn: false }, { headers: { ...noStore, "Set-Cookie": clearCookie(req) } });
}
