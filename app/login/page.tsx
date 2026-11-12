"use client";
/** Sign in, or create an account (starts the free trial). */
import { useEffect, useState } from "react";
import "../site.css";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { TRIAL_DAYS } from "@/lib/plans";

/** Only same-site paths are allowed as a return address. */
function safeNext(raw: string | null) {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/account";
}

export default function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [next, setNext] = useState("/account");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // Apply the link's options after the first render (keeps server and client markup equal).
    Promise.resolve().then(() => {
      if (q.get("mode") === "signup") setMode("signup");
      setNext(safeNext(q.get("next")));
      if (q.get("signedout")) setError("This browser was signed out from another browser or by a password change. Sign in again.");
    });
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ account: unknown }>)
      .then((me) => me.account && window.location.replace(safeNext(q.get("next"))))
      .catch(() => undefined);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setError(data.error ?? "Something went wrong. Please try again.");
      else window.location.href = next;
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="site">
      <SiteHeader signedIn={false} />
      <main className="auth-page">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "signin"} onClick={() => setMode("signin")}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === "signup"} onClick={() => setMode("signup")}>
              Create account
            </button>
          </div>
          <h1>{mode === "signup" ? `Start your ${TRIAL_DAYS}-day free trial` : "Welcome back"}</h1>
          <p className="muted">
            {mode === "signup"
              ? "Every feature, in the browser and on one computer. No card needed."
              : "Sign in to open the studio, manage your licence and download the app."}
          </p>
          {mode === "signup" && (
            <label className="auth-field">
              <span>Name or company (optional)</span>
              <input value={form.name} onChange={set("name")} autoComplete="organization" maxLength={80} />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input type="email" value={form.email} onChange={set("email")} autoComplete="username" required autoFocus />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={set("password")}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? 10 : undefined}
              required
            />
            {mode === "signup" && <small>At least 10 characters, with letters and a number.</small>}
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signup" ? "Create account and start trial" : "Sign in"}
          </button>
          <p className="auth-foot muted">
            {mode === "signup" ? "Already have an account? " : "New here? "}
            <button type="button" className="link" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
              {mode === "signup" ? "Sign in" : `Start the ${TRIAL_DAYS}-day free trial`}
            </button>
          </p>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
