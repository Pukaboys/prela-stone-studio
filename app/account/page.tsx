"use client";
/** Account: licence status, PayPal checkout, computers, downloads, password. */
import { useCallback, useEffect, useRef, useState } from "react";
import "../site.css";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import type { PublicAccount } from "@/lib/accounts";
import { PLANS, type Plan } from "@/lib/plans";

type PayPalConfig = { clientId: string | null; currency: string; live: boolean };
type PayPalButtons = { render: (el: HTMLElement) => Promise<void>; close?: () => void };
type PayPalSdk = { Buttons: (o: object) => PayPalButtons };
declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
const PLAN_LABEL: Record<string, string> = { trial: "Free trial", monthly: "Monthly plan", yearly: "Yearly plan" };

async function post<T>(url: string, data: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(json.error ?? `Request failed (${r.status}).`);
  return json;
}

function loadPayPal(clientId: string, currency: string) {
  return new Promise<PayPalSdk>((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal);
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons`;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal did not load.")));
    s.onerror = () => reject(new Error("PayPal could not be loaded. Check your connection or ad blocker."));
    document.head.appendChild(s);
  });
}

function PayButtons({ plan, config, onPaid, onError }: { plan: Plan; config: PayPalConfig; onPaid: (a: PublicAccount) => void; onError: (m: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let buttons: PayPalButtons | undefined;
    let cancelled = false;
    if (!config.clientId) return;
    loadPayPal(config.clientId, config.currency)
      .then((paypal) => {
        if (cancelled || !host.current) return;
        buttons = paypal.Buttons({
          style: { layout: "vertical", shape: "rect", label: "pay", height: 42 },
          createOrder: async () => (await post<{ id: string }>("/api/paypal/order", { plan: plan.id })).id,
          onApprove: async (data: { orderID: string }) => {
            try {
              onPaid((await post<{ account: PublicAccount }>("/api/paypal/capture", { orderId: data.orderID })).account);
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            }
          },
          onError: () => onError("PayPal reported a problem. No money was taken; please try again."),
        });
        host.current.innerHTML = "";
        return buttons.render(host.current);
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      cancelled = true;
      buttons?.close?.();
    };
  }, [plan.id, config.clientId, config.currency, onPaid, onError]);
  return <div ref={host} className="paypal-host" />;
}

export default function AccountPage() {
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [config, setConfig] = useState<PayPalConfig | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ account: PublicAccount | null; desktop: boolean }>)
      .then((me) => {
        if (me.desktop) window.location.replace("/studio");
        else if (!me.account) window.location.replace("/login?next=/account");
        else setAccount(me.account);
      });
    fetch("/api/paypal/config")
      .then((r) => r.json() as Promise<PayPalConfig>)
      .then(setConfig)
      .catch(() => setConfig({ clientId: null, currency: "EUR", live: false }));
    fetch("/api/app-version")
      .then((r) => r.json() as Promise<{ version: string | null }>)
      .then((v) => setVersion(v.version))
      .catch(() => undefined);
  }, []);

  const onPaid = useCallback((a: PublicAccount) => {
    setAccount(a);
    setMessage({ kind: "ok", text: `Thank you! Your licence now runs until ${fmtDate(a.licence.expiresAt)}.` });
    window.scrollTo({ top: 0, behavior: "smooth" });
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
              : "Paying again extends your licence from its current end date."}
          </p>
        </section>

        <section className="account-card" id="plans">
          <h2>{l.plan === "trial" ? "Choose a plan" : "Renew or extend"}</h2>
          {!config ? (
            <p className="muted">Loading payment options…</p>
          ) : !config.clientId ? (
            <p className="muted">Online payment is not set up yet. Please contact us to buy a licence.</p>
          ) : (
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
                  <PayButtons plan={p} config={config} onPaid={onPaid} onError={onError} />
                </div>
              ))}
            </div>
          )}
          {config && !config.live && config.clientId && <p className="sandbox-note">Test mode: PayPal sandbox, no real money is taken.</p>}
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
                        {fmtDate(p.at)} · PayPal order {p.orderId}
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
