"use client";
/**
 * Who may open the studio.
 * Website:     signed in with an active trial or plan (otherwise → sign in,
 *              or the account page to renew).
 * Desktop app: signed in on this computer (otherwise → sign-in screen). With
 *              a valid licence everything works; when the licence ended or
 *              the app was offline for too long it opens in limited mode
 *              (view only). The licence is checked again every few hours.
 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, LockKeyhole, Mail } from "lucide-react";

export type DesktopLicence = {
  ok: boolean;
  /** Signed in, but the licence ended or the app was offline too long: view only. */
  limited: boolean;
  reason: string | null;
  email: string | null;
  plan: string | null;
  expiresAt: string | null;
  lastCheck: string | null;
  offlineDaysLeft: number;
  /** Result of the last check-in attempt (null: none was needed). */
  online: boolean | null;
  server: string;
};
export type StudioUser =
  | { mode: "web"; email: string; plan: string; daysLeft: number }
  | ({ mode: "desktop"; recheck: () => Promise<void> } & DesktopLicence);

const RECHECK_MS = 2 * 3600e3;

type Me = { desktop: boolean; account: { email: string; emailVerified: boolean; licence: { active: boolean; plan: string; daysLeft: number } } | null };

const REASON: Record<string, string> = {
  missing: "Sign in with your Jeo Stone Studio account to activate this computer.",
  invalid: "The licence on this computer is not valid. Sign in again to activate it.",
  device: "This licence belongs to another computer. Sign in to activate this one.",
  expired: "Your licence has ended. Renew it on your account page, then sign in again.",
  "offline-too-long": "The app has been offline for too long. Connect to the internet and sign in again.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="signin">
      <div className="signin-card">{children}</div>
    </main>
  );
}

function Activate({ licence, onDone }: { licence: DesktopLicence; onDone: (l: DesktopLicence) => void }) {
  const [email, setEmail] = useState(licence.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <span className="brandmark">
        <KeyRound size={22} />
      </span>
      <h1>
        JEO <span>STONE STUDIO</span>
      </h1>
      <p>{REASON[licence.reason ?? "missing"] ?? REASON.missing}</p>
      <form
        className="signin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/desktop/licence", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "activate", email, password }),
            });
            const data = (await r.json()) as DesktopLicence & { error?: string };
            if (!r.ok || !data.ok) setError(data.error ?? "Activation failed.");
            else onDone(data);
          } catch {
            setError("Could not reach the licence server. Check the internet connection.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Activating…" : "Activate this computer"}
        </button>
      </form>
      {licence.server && (
        <p className="signin-links">
          No account yet? <a href={`${licence.server}/login?mode=signup`}>Start the free trial</a> ·{" "}
          <a href={`${licence.server}/account`}>Buy or renew</a>
        </p>
      )}
    </Shell>
  );
}

/** Website: the email address must be confirmed before the studio opens. */
function Unverified({ email }: { email: string }) {
  const [note, setNote] = useState("");
  return (
    <Shell>
      <span className="brandmark">
        <Mail size={22} />
      </span>
      <h1>
        JEO <span>STONE STUDIO</span>
      </h1>
      <p>
        Confirm your email address to open the studio. We sent a link to <b>{email}</b>; open it, then press Continue.
      </p>
      <button className="primary" onClick={() => window.location.reload()}>
        Continue
      </button>
      <button
        onClick={async () => {
          const r = await fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resend" }) });
          const json = (await r.json().catch(() => ({}))) as { error?: string };
          setNote(r.ok ? "Sent. Check your inbox and spam folder." : (json.error ?? "Could not send the email."));
        }}
      >
        Send the link again
      </button>
      {note && <p className="hint">{note}</p>}
    </Shell>
  );
}

export default function StudioGate({ children }: { children: (user: StudioUser) => React.ReactNode }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; user: StudioUser }
    | { kind: "activate"; licence: DesktopLicence }
    | { kind: "expired"; email: string }
    | { kind: "unverified"; email: string }
  >({ kind: "loading" });

  // Desktop: full use, limited mode, or the sign-in screen.
  const checkDesktop = useCallback(async (force = false) => {
    const lic = (await (await fetch("/api/desktop/licence" + (force ? "?check=1" : ""), { cache: "no-store" })).json()) as DesktopLicence;
    setState(
      lic.ok || lic.limited
        ? { kind: "ready", user: { mode: "desktop", ...lic, recheck: () => checkDesktop(true) } }
        : { kind: "activate", licence: lic },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = (await (await fetch("/api/auth/me", { cache: "no-store" })).json()) as Me;
        if (cancelled) return;
        if (me.desktop) {
          if (!cancelled) await checkDesktop();
          return;
        }
        if (!me.account) {
          window.location.href = "/login?next=/studio";
          return;
        }
        if (!me.account.emailVerified) {
          setState({ kind: "unverified", email: me.account.email });
          return;
        }
        const l = me.account.licence;
        setState(
          l.active
            ? { kind: "ready", user: { mode: "web", email: me.account.email, plan: l.plan, daysLeft: l.daysLeft } }
            : { kind: "expired", email: me.account.email },
        );
      } catch {
        if (!cancelled) setState({ kind: "expired", email: "" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkDesktop]);

  // Desktop: check the licence again every few hours while the app is open.
  const desktop = state.kind === "ready" && state.user.mode === "desktop";
  useEffect(() => {
    if (!desktop) return;
    const t = setInterval(() => checkDesktop().catch(() => undefined), RECHECK_MS);
    return () => clearInterval(t);
  }, [desktop, checkDesktop]);

  // Online: if this browser is signed out elsewhere (My account → Browsers,
  // password change), the next studio request gets 401 → back to sign in.
  const web = state.kind === "ready" && state.user.mode === "web";
  useEffect(() => {
    if (!web) return;
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
      if (res.status === 401 && /\/api\/(projects|images)/.test(url)) window.location.href = "/login?next=/studio&signedout=1";
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, [web]);

  if (state.kind === "loading") return <main className="studio" aria-busy="true" />;
  if (state.kind === "activate")
    return <Activate licence={state.licence} onDone={() => checkDesktop()} />;
  if (state.kind === "unverified") return <Unverified email={state.email} />;
  if (state.kind === "expired")
    return (
      <Shell>
        <span className="brandmark">
          <LockKeyhole size={22} />
        </span>
        <h1>
          JEO <span>STONE STUDIO</span>
        </h1>
        <p>Your trial or plan has ended{state.email ? ` for ${state.email}` : ""}. Renew it to keep planning — your projects are kept.</p>
        <a className="primary button-link" href="/account">
          Go to my account
        </a>
      </Shell>
    );
  return <>{children(state.user)}</>;
}
