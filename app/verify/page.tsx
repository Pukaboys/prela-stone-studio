"use client";
/** Opened from the confirmation email: confirms the address, then on to the studio. */
import { useEffect, useState } from "react";
import "../site.css";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";

export default function Verify() {
  const [state, setState] = useState<{ kind: "working" } | { kind: "ok"; email: string } | { kind: "error"; message: string }>({ kind: "working" });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as { email?: string; error?: string };
        setState(r.ok ? { kind: "ok", email: json.email ?? "" } : { kind: "error", message: json.error ?? "This link did not work." });
      })
      .catch(() => setState({ kind: "error", message: "Could not reach the server. Check your connection and open the link again." }));
  }, []);

  return (
    <div className="site">
      <SiteHeader signedIn={false} />
      <main className="auth-page">
        <div className="auth-card">
          {state.kind === "working" && <h1>Confirming your email…</h1>}
          {state.kind === "ok" && (
            <>
              <h1>Email confirmed</h1>
              <p className="auth-ok" role="status">
                Thank you{state.email ? `, ${state.email} is confirmed` : ""}. You can now use the studio and activate the desktop app.
              </p>
              <a className="btn btn-primary auth-submit" href="/studio">
                Open the studio
              </a>
            </>
          )}
          {state.kind === "error" && (
            <>
              <h1>Link not valid</h1>
              <p className="auth-error" role="alert">
                {state.message}
              </p>
              <a className="btn btn-ghost auth-submit" href="/account">
                Go to my account
              </a>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
