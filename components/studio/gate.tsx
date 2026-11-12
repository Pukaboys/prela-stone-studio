"use client";
/**
 * Who may open the studio.
 * Website:     signed in with an active trial or plan (otherwise → sign in,
 *              or the account page to renew).
 * Desktop app: a valid licence on this computer (otherwise → activation).
 */
import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";

export type StudioUser =
  | { mode: "web"; email: string; plan: string; daysLeft: number }
  | { mode: "desktop"; email: string | null; plan: string | null; expiresAt: string | null; server: string };

type Me = { desktop: boolean; account: { email: string; licence: { active: boolean; plan: string; daysLeft: number } } | null };
type DesktopLicence = { ok: boolean; reason: string | null; email: string | null; plan: string | null; expiresAt: string | null; server: string };

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

export default function StudioGate({ children }: { children: (user: StudioUser) => React.ReactNode }) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; user: StudioUser }
    | { kind: "activate"; licence: DesktopLicence }
    | { kind: "expired"; email: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = (await (await fetch("/api/auth/me", { cache: "no-store" })).json()) as Me;
        if (cancelled) return;
        if (me.desktop) {
          const lic = (await (await fetch("/api/desktop/licence", { cache: "no-store" })).json()) as DesktopLicence;
          if (cancelled) return;
          setState(lic.ok ? { kind: "ready", user: { mode: "desktop", ...lic } } : { kind: "activate", licence: lic });
          return;
        }
        if (!me.account) {
          window.location.href = "/login?next=/studio";
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
  }, []);

  if (state.kind === "loading") return <main className="studio" aria-busy="true" />;
  if (state.kind === "activate")
    return <Activate licence={state.licence} onDone={(l) => setState({ kind: "ready", user: { mode: "desktop", ...l } })} />;
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
