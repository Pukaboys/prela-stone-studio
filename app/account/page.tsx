"use client";
/** Account: licence status, buying a plan, computers, downloads, password. */
import Link from "next/link";
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
  const [version, setVersion] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ account: PublicAccount | null; desktop: boolean; owner?: boolean }>)
      .then((me) => {
        if (me.desktop) window.location.replace("/studio");
        else if (!me.account) window.location.replace("/login?next=/account");
        else {
          setAccount(me.account);
          setOwner(!!me.owner);
        }
      });
    fetch("/api/app-version")
      .then((r) => r.json() as Promise<{ version: string | null }>)
      .then((v) => setVersion(v.version))
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
              <Link className="btn btn-ghost" href="/#contact" prefetch={false}>
                Contact us
              </Link>
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
            <a className="btn btn-ghost" href="/api/download?platform=windows">Windows</a>
            <a className="btn btn-ghost" href="/api/download?platform=mac-arm">Mac (Apple Silicon)</a>
            <a className="btn btn-ghost" href="/api/download?platform=mac-intel">Mac (Intel)</a>
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
