"use client";
/**
 * Desktop app: licence notice under the header.
 * - Limited mode (licence ended, or no check-in for 7 days): what is switched
 *   off, with "Check again", "Renew" and "Sign in again".
 * - Offline with little grace left: how many days of full use remain.
 */
import { useState } from "react";
import { AlertTriangle, LockKeyhole, RefreshCw } from "lucide-react";
import type { StudioUser } from "@/components/studio/gate";

type DesktopUser = Extract<StudioUser, { mode: "desktop" }>;

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");

export default function LicenceBanner({ user }: { user: DesktopUser }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const check = async () => {
    setBusy(true);
    setNote("");
    try {
      await user.recheck();
      setNote("Checked.");
    } catch {
      setNote("Could not reach the website. Check the internet connection.");
    } finally {
      setBusy(false);
    }
  };

  if (user.limited) {
    const offline = user.reason === "offline-too-long";
    return (
      <div className="licence-banner limited" role="alert">
        <LockKeyhole size={18} />
        <div>
          <b>Limited mode</b>
          <span>
            {offline
              ? `The app could not check your licence since ${fmt(user.lastCheck)}. Connect to the internet and press Check again.`
              : `Your licence ended on ${fmt(user.expiresAt)}. Renew it on your account, then press Check again.`}{" "}
            Until then you can open and look at projects; adding pieces, saving, photos, exports and downloads are switched off.
          </span>
        </div>
        <div className="licence-actions">
          <button onClick={check} disabled={busy}>
            <RefreshCw size={15} /> {busy ? "Checking…" : "Check again"}
          </button>
          {user.server && !offline && (
            <a className="button-link primary" href={`${user.server}/account`} target="_blank" rel="noreferrer">
              Renew
            </a>
          )}
          <button
            className="quiet"
            onClick={async () => {
              await fetch("/api/desktop/licence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signout" }) });
              window.location.reload();
            }}
          >
            Sign in with another account
          </button>
          {note && <small>{note}</small>}
        </div>
      </div>
    );
  }

  if (user.online === false && user.offlineDaysLeft <= 3)
    return (
      <div className="licence-banner offline" role="status">
        <AlertTriangle size={18} />
        <div>
          <b>Offline</b>
          <span>
            Connect to the internet within {user.offlineDaysLeft} day{user.offlineDaysLeft === 1 ? "" : "s"} so the app can check your licence. Otherwise it
            switches to limited mode (view only) until it can.
          </span>
        </div>
        <div className="licence-actions">
          <button onClick={check} disabled={busy}>
            <RefreshCw size={15} /> {busy ? "Checking…" : "Check again"}
          </button>
          {note && <small>{note}</small>}
        </div>
      </div>
    );

  return null;
}
