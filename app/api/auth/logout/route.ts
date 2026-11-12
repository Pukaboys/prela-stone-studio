import { clearSessionCookie } from "@/lib/accounts";
import { ok } from "@/lib/http";

export async function POST(req: Request) {
  return ok({ signedIn: false }, { "Set-Cookie": clearSessionCookie(req) });
}
