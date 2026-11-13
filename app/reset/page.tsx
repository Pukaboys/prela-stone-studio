"use client";
/**
 * Forgotten password.
 * Without ?token: ask for the email and send a reset link.
 * With ?token (from the email): choose a new password.
 */
import { useEffect, useState } from "react";
import "../site.css";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";

async function post(url: string, data: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const json = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(json.error ?? `Something went wrong (${r.status}).`);
  return json;
}

export default function Reset() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    // After the first render (keeps server and client markup equal).
    Promise.resolve().then(() => setToken(t));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="site">
      <SiteHeader signedIn={false} />
      <main className="auth-page">
        {token ? (
          <form
            className="auth-card"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await post("/api/auth/reset", { token, password });
                window.location.href = "/account";
              });
            }}
          >
            <h1>Choose a new password</h1>
            <p className="muted">Setting a new password signs out every browser that uses this account.</p>
            <label className="auth-field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
              <small>At least 10 characters, with letters and a number.</small>
            </label>
            {error && (
              <p className="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? "Please wait…" : "Save new password"}
            </button>
            {error && (
              <p className="auth-foot muted">
                <a href="/reset">
                  Ask for a new link
                </a>
              </p>
            )}
          </form>
        ) : (
          <form
            className="auth-card"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await post("/api/auth/forgot", { email });
                setDone(email);
              });
            }}
          >
            <h1>Forgot your password?</h1>
            {done ? (
              <p className="auth-ok" role="status">
                If an account exists for {done}, we have sent it a link to choose a new password. It works for 1 hour. Check your spam folder if it does not arrive.
              </p>
            ) : (
              <>
                <p className="muted">Enter your account email and we send you a link to choose a new password.</p>
                <label className="auth-field">
                  <span>Email</span>
                  <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
                </label>
                {error && (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="btn btn-primary auth-submit" disabled={busy}>
                  {busy ? "Please wait…" : "Send reset link"}
                </button>
              </>
            )}
            <p className="auth-foot muted">
              <a href="/login">
                Back to sign in
              </a>
            </p>
          </form>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
