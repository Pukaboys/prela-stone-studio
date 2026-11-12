"use client";
/** Team password screen shown when the website requires signing in. */
import { useState } from "react";
import { LockKeyhole } from "lucide-react";

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (r.ok) onSignedIn();
      else setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not sign in.");
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit}>
        <span className="brandmark">
          <LockKeyhole size={22} />
        </span>
        <h1>
          JEO <span>STONE STUDIO</span>
        </h1>
        <p>Enter the team password to open the studio.</p>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error || undefined}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
