import { currentAccount, publicAccount } from "@/lib/accounts";
import { ok } from "@/lib/http";
import { isDesktop, isOwner } from "@/lib/studio-access";

/** The signed-in account (or null) and whether this is the desktop app. */
export async function GET(req: Request) {
  if (isDesktop()) return ok({ desktop: true, account: null });
  const a = await currentAccount(req);
  return ok({ desktop: false, account: a ? publicAccount(a) : null, owner: a ? await isOwner(a) : false });
}
