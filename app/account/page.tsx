"use client";
/** Account: licence status, buying a plan, computers, downloads, password. */
import { useCallback, useEffect, useState } from "react";
import "../site.css";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import type { PublicAccount } from "@/lib/accounts";
import { PLANS } from "@/lib/plans";
import { CONTACT } from "@/lib/site-config";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const PLAN_LABEL: Record<string, string> = { trial: "Free trial", monthly: "Monthly plan", yearly: "Yearly plan" };

async function post<T>(url: string, data: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(json.error ?? `Request failed (${r.status}).`);
  return json;
}

/** Ways to reach the owner to buy a plan (from lib/site-config). */
const contactLinks = (subject: string) =>
  [
    CONTACT.email && { href: `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}`, label: `Email ${CONTACT.email}` },
    CONTACT.whatsapp && { href: `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(subject)}`, label: "WhatsApp" },
    CONTACT.phone && { href: `tel:${CONTACT.phone.replace(/\s+/g, "")}`, label: `Call ${CONTACT.phone}` },
  ].filter((x): x is { href: string; label: string } => !!x);

export default function AccountPage() {
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [owner, setOwner] = useState(false);
  const [ownerPending, setOwnerPending] = useState(false);
  const [mail, setMail] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, number | null>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ account: PublicAccount | null; desktop: boolean; owner?: boolean; ownerPending?: boolean; mail?: boolean }>)
      .then((me) => {
        if (me.desktop) window.location.replace("/studio");
        else if (!me.account) window.location.replace("/login?next=/account");
        else {
          setAccount(me.account);
          setOwner(!!me.owner);
          setOwnerPending(!!me.ownerPending);
          setMail(!!me.mail);
        }
      });
    fetch("/api/app-version")
      .then((r) => r.json() as Promise<{ version: string | null; downloads?: Record<string, number | null> }>)
      .then((v) => {
        setVersion(v.version);
        setDownloads(v.downloads ?? {});
      })
      .catch(() => undefined);
  }, []);

  const onError = useCallback((text: string) => setMessage({ kind: "error", text }), []);

  if (!account) return <div className="site"><SiteHeader signedIn /><main className="account-page wrap" aria-busy="true" /></div>;
  const l = account.licence;

  return (
    <div className="site">
      <SiteHeader signedIn />
      <main className="account-page wrap">
        <div className="account-head">
          <div>
            <p className="eyebrow">My account</p>
            <h1>{account.name || account.email}</h1>
            {account.name && <p className="muted">{account.email}</p>}
          </div>
          <div className="account-actions">
            <a className="btn btn-primary" href="/studio">Open the studio</a>
            {owner && (
              <a className="btn btn-ghost" href="/admin">
                Customers
              </a>
            )}
            <button
              className="btn btn-ghost"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                window.location.href = "/";
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        {message && (
          <p className={"account-message " + message.kind} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        )}

        {ownerPending && (
          <div className="verify-banner" role="status">
            <p>
              <b>Owner account.</b>{" "}
              {mail
                ? "To open the admin page, prove this is your mailbox: we send a confirmation link to it."
                : `Email is not set up yet. To open the admin page, set ADMIN_ACCOUNT_ID = ${account.id} in the website settings (Hostinger → Environment variables).`}
            </p>
            {mail && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  try {
                    await post("/api/auth/verify", { action: "resend" });
                    setMessage({ kind: "ok", text: `We sent a confirmation link to ${account.email}.` });
                  } catch (e) {
                    onError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Send the link
              </button>
            )}
          </div>
        )}

        {!account.emailVerified && (
          <div className="verify-banner" role="status">
            <p>
              <b>Confirm your email.</b> We sent a link to {account.email}. Open it to use the studio and the desktop app.
            </p>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                try {
                  await post("/api/auth/verify", { action: "resend" });
                  setMessage({ kind: "ok", text: `We sent a new link to ${account.email}. Check your spam folder too.` });
                } catch (e) {
                  onError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Send the link again
            </button>
          </div>
        )}

        <section className="account-card licence-card">
          <div>
            <h2>{PLAN_LABEL[l.plan] ?? l.plan}</h2>
            <p className={l.active ? "status-ok" : "status-bad"}>
              {l.active
                ? `Active until ${fmtDate(l.expiresAt)} · ${l.daysLeft} day${l.daysLeft === 1 ? "" : "s"} left`
                : `Ended on ${fmtDate(l.expiresAt)}`}
            </p>
          </div>
          <p className="muted">
            {l.plan === "trial"
              ? "Choose a plan below to keep using the studio after the trial. Your projects are kept."
              : "Buying again extends your licence from its current end date."}
          </p>
        </section>

        <section className="account-card" id="plans">
          <h2>{l.plan === "trial" ? "Choose a plan" : "Renew or extend"}</h2>
          <div className="plan-grid">
            {PLANS.map((p) => (
              <div key={p.id} className="plan-option">
                <div className="plan-head">
                  <b>{p.name}</b>
                  {p.note && <span className="badge">{p.note}</span>}
                </div>
                <p className="price">
                  €{p.price} <small>{p.per}</small>
                </p>
                <p className="muted">Every feature · online studio + {p.devices} computers</p>
              </div>
            ))}
          </div>
          <h3>How to buy</h3>
          <ol className="buy-steps">
            <li>Contact us with the plan you want and your account email ({account.email}).</li>
            <li>We send you the bank details; pay by bank transfer.</li>
            <li>As soon as the payment arrives your licence is extended. You see it here, and the desktop app updates by itself.</li>
          </ol>
          <div className="buy-contact">
            {contactLinks(`Jeo Stone Studio licence for ${account.email}`).map((c) => (
              <a key={c.href} className="btn btn-ghost" href={c.href}>
                {c.label}
              </a>
            ))}
            {contactLinks("").length === 0 && (
              <a className="btn btn-ghost" href="/#contact">
                Contact us
              </a>
            )}
          </div>
        </section>

        <section className="account-card">
          <h2>Desktop app</h2>
          <p className="muted">
            Download, install and sign in with this account. Your licence works on {l.maxDevices} computer{l.maxDevices === 1 ? "" : "s"}
            {version ? ` · latest version ${version}` : ""}.
          </p>
          <div className="download-row">
            {(
              [
                ["windows", "Windows"],
                ["mac-arm", "Mac (Apple Silicon)"],
                ["mac-intel", "Mac (Intel)"],
              ] as const
            ).map(([id, label]) =>
              downloads[id] != null ? (
                <a key={id} className="btn btn-ghost" href={`/api/download?platform=${id}`}>
                  {label}
                  {downloads[id] ? <small className="dl-size">{(downloads[id]! / 1048576).toFixed(0)} MB</small> : null}
                </a>
              ) : (
                <span key={id} className="btn btn-ghost is-disabled" aria-disabled="true" title="Coming soon">
                  {label} <small className="dl-size">soon</small>
                </span>
              ),
            )}
          </div>
          <h3>Computers using your licence ({account.devices.length} of {l.maxDevices})</h3>
          {account.devices.length === 0 ? (
            <p className="muted">None yet. Sign in to the desktop app to activate a computer.</p>
          ) : (
            <ul className="device-list">
              {account.devices.map((d) => (
                <li key={d.id}>
                  <span>
                    <b>{d.name}</b>
                    <small>Activated {fmtDate(d.activatedAt)} · last seen {fmtDate(d.lastSeen)}</small>
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      if (!confirm(`Remove “${d.name}”? It will ask to sign in again.`)) return;
                      try {
                        setAccount((await post<{ account: PublicAccount }>("/api/account/devices", { deviceId: d.id })).account);
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="account-card" id="browsers">
          <h2>
            Browsers ({account.browsers.length} of {account.maxBrowsers})
          </h2>
          <p className="muted">
            The online studio can be open in {account.maxBrowsers} browsers at a time. To use another browser, sign out in one of these first.
          </p>
          <ul className="device-list">
            {account.browsers.map((b) => (
              <li key={b.id}>
                <span>
                  <b>
                    {b.name}
                    {b.current ? " · this browser" : ""}
                  </b>
                  <small>
                    Signed in {fmtDate(b.createdAt)} · last used {fmtDate(b.lastSeen)}
                  </small>
                </span>
                {!b.current && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      if (!confirm(`Sign out “${b.name}”?`)) return;
                      try {
                        setAccount((await post<{ account: PublicAccount }>("/api/account/browsers", { sessionId: b.id })).account);
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="account-card">
          <h2>Password</h2>
          <form
            className="password-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await post("/api/auth/password", pw);
                setPw({ current: "", next: "" });
                setMessage({ kind: "ok", text: "Password changed. Other devices and browsers were signed out." });
              } catch (err) {
                onError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <label className="auth-field">
              <span>Current password</span>
              <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
            </label>
            <label className="auth-field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
            </label>
            <button className="btn btn-ghost">Change password</button>
          </form>
        </section>

        {account.payments.length > 0 && (
          <section className="account-card">
            <h2>Payments</h2>
            <ul className="device-list">
              {account.payments
                .slice()
                .reverse()
                .map((p) => (
                  <li key={p.orderId}>
                    <span>
                      <b>{PLAN_LABEL[p.plan]} · €{p.amount}</b>
                      <small>
                        {fmtDate(p.at)}
                        {p.note ? ` · ${p.note}` : ""}
                      </small>
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
