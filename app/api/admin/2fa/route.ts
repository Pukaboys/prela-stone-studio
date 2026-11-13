import { fail, forgive, limited, sameOriginJson, saveAccount } from "@/lib/accounts";
import { ADMIN_MFA_HOURS, mfaFresh, ownerSession } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { body, err, ok } from "@/lib/http";
import { checkTotp, findRecoveryCode, newRecoveryCodes, newSecret, otpauthUri } from "@/lib/totp";

/**
 * Two-step login for the owner.
 * GET                                  → { enabled, fresh }
 * POST { action: "start" }             → new key { secret, uri } (first setup, or a new phone after a code)
 * POST { action: "confirm", code }     → turns it on; returns 10 recovery codes (shown once)
 * POST { action: "verify", code }      → code or recovery code; unlocks admin in this browser for 12 hours
 */
export async function GET(req: Request) {
  const o = await ownerSession(req);
  if (o instanceof Response) return o;
  return ok({ enabled: !!o.account.totp, fresh: mfaFresh(o.session), hours: ADMIN_MFA_HOURS });
}

export async function POST(req: Request) {
  if (!sameOriginJson(req)) return err(400, "Bad request.");
  const o = await ownerSession(req);
  if (o instanceof Response) return o;
  const a = o.account;
  const b = await body<{ action: string; code: string }>(req);
  const key = "admin-2fa:" + a.id;

  if (b.action === "start") {
    // Replacing a working setup needs a fresh code first.
    if (a.totp && !mfaFresh(o.session)) return err(403, "Enter a current code first.");
    const secret = newSecret();
    a.totpPending = { secret, at: new Date().toISOString() };
    await saveAccount(a);
    return ok({ secret, uri: otpauthUri(a.email, secret) });
  }

  if (limited(key, 5)) return err(429, "Too many wrong codes. Wait 15 minutes and try again.");

  if (b.action === "confirm") {
    const p = a.totpPending;
    if (!p || Date.now() - new Date(p.at).getTime() > 30 * 60e3) return err(400, "Start the setup again.");
    if (a.totp && !mfaFresh(o.session)) return err(403, "Enter a current code first.");
    const step = checkTotp(p.secret, String(b.code ?? ""));
    if (step === null) {
      fail(key);
      return err(400, "That code is not right. Check the time on your phone and try the newest code.");
    }
    forgive(key);
    const { codes, hashes } = newRecoveryCodes();
    a.totp = { secret: p.secret, enabledAt: new Date().toISOString(), lastStep: step, recovery: hashes };
    delete a.totpPending;
    o.session.mfaAt = new Date().toISOString();
    await saveAccount(a);
    await audit(req, a.email, "Two-step login set up");
    return ok({ recovery: codes });
  }

  if (b.action === "verify") {
    if (!a.totp) return err(400, "Two-step login is not set up.");
    const code = String(b.code ?? "").trim();
    let how = "";
    const step = checkTotp(a.totp.secret, code, a.totp.lastStep);
    if (step !== null) {
      a.totp.lastStep = step;
      how = "code";
    } else {
      const i = findRecoveryCode(a.totp.recovery, code);
      if (i >= 0) {
        a.totp.recovery.splice(i, 1); // each recovery code works once
        how = "recovery code";
      }
    }
    if (!how) {
      fail(key);
      await audit(req, a.email, "Wrong two-step code");
      return err(400, "That code is not right.");
    }
    forgive(key);
    o.session.mfaAt = new Date().toISOString();
    await saveAccount(a);
    await audit(req, a.email, how === "code" ? "Admin unlocked" : "Admin unlocked with a recovery code", undefined, how === "recovery code" ? `${a.totp.recovery.length} recovery codes left` : undefined);
    return ok({ ok: true, recoveryLeft: a.totp.recovery.length });
  }

  return err(400, "Unknown action.");
}
