"use client";
/** Two-step login screens for the admin page: first setup, and entering a code. */
import qrcode from "qrcode-generator";
import { useState } from "react";

async function call(data: unknown) {
  const r = await fetch("/api/admin/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!r.ok) throw new Error(json.error ?? `Request failed (${r.status}).`);
  return json;
}

function qrDataUrl(text: string) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 4);
}

function CodeInput({ value, onChange, allowRecovery }: { value: string; onChange: (v: string) => void; allowRecovery?: boolean }) {
  return (
    <label className="auth-field">
      <span>{allowRecovery ? "6-digit code (or a recovery code)" : "6-digit code from the app"}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={allowRecovery ? "text" : "numeric"}
        autoComplete="one-time-code"
        maxLength={allowRecovery ? 12 : 6}
        required
        autoFocus
        className="code-input"
      />
    </label>
  );
}

/** First setup (or a new phone): scan the QR code, confirm with a code, save the recovery codes. */
export function TwoStepSetup({ onDone, replacing = false }: { onDone: () => void; replacing?: boolean }) {
  const [key, setKey] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (recovery)
    return (
      <section className="account-card twostep">
        <h2>Save your recovery codes</h2>
        <p className="muted">
          If you lose your phone, each of these codes opens the admin page once. Keep them somewhere safe (printed, or in a password manager). They are shown only now.
        </p>
        <ul className="recovery-codes">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="download-row">
          <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(recovery.join("\n"))}>
            Copy codes
          </button>
          <button className="btn btn-primary" onClick={onDone}>
            I saved them, continue
          </button>
        </div>
      </section>
    );

  return (
    <section className="account-card twostep">
      <h2>{replacing ? "Set up a new authenticator" : "Set up two-step login"}</h2>
      <p className="muted">
        The admin page asks for a code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password…), so your password alone
        is not enough.
      </p>
      {!key ? (
        <>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setKey((await call({ action: "start" })) as { secret: string; uri: string });
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Start
          </button>
        </>
      ) : (
        <form
          className="twostep-setup"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              setRecovery(((await call({ action: "confirm", code })) as { recovery: string[] }).recovery);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <ol>
            <li>In the app, add an account and scan this code.</li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <img className="twostep-qr" src={qrDataUrl(key.uri)} alt="QR code for your authenticator app" width={220} height={220} />
          <p className="muted">
            Can&apos;t scan? Enter this key in the app: <code className="twostep-key">{key.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          </p>
          <CodeInput value={code} onChange={setCode} />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "Checking…" : "Turn on two-step login"}
          </button>
        </form>
      )}
    </section>
  );
}

/** Code (or recovery code) to unlock the admin page in this browser. */
export function TwoStepCode({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="account-card twostep"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await call({ action: "verify", code });
          onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Two-step login</h2>
      <p className="muted">Open your authenticator app and enter the code for Jeo Stone Studio. This browser then stays unlocked for 12 hours.</p>
      <CodeInput value={code} onChange={setCode} allowRecovery />
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
