/** Test helper: turn on the owner's two-step login, and unlock later browsers. */
import { hotp, stepAt } from "@/lib/totp";

type Post = (body: unknown) => Promise<Response>;

/** First setup in this browser; returns the key and the recovery codes. */
export async function setUpTwoStep(post: Post) {
  const { secret } = (await (await post({ action: "start" })).json()) as { secret: string };
  const r = await post({ action: "confirm", code: hotp(secret, stepAt(Date.now())) });
  if (r.status !== 200) throw new Error("two-step setup failed: " + (await r.text()));
  const { recovery } = (await r.json()) as { recovery: string[] };
  return { secret, recovery };
}

/** Unlock another browser with one recovery code (each works once). */
export async function unlockWith(post: Post, recovery: string[]) {
  const r = await post({ action: "verify", code: recovery.shift()! });
  if (r.status !== 200) throw new Error("unlock failed: " + (await r.text()));
}
