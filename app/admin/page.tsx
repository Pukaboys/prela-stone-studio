"use client";
/** Owner page: customers, and switching on a plan after a customer pays. */
import { useEffect, useMemo, useState } from "react";
import "../site.css";
import { TwoStepCode, TwoStepSetup } from "@/components/site/admin-2fa";
import AdminReleases from "@/components/site/admin-releases";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import type { PublicAccount } from "@/lib/accounts";
import { PLANS } from "@/lib/plans";

type Row = PublicAccount & { createdAt: string };
type Activity = { at: string; action: string; by: string; ip: string; target?: string; detail?: string };
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const PLAN_LABEL: Record<string, string> = { trial: "Trial", monthly: "Monthly", yearly: "Yearly" };

async function post(data: unknown) {
  const r = await fetch("/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const json = (await r.json().catch(() => ({}))) as { account?: Row; error?: string };
  if (r.status === 428) window.location.reload(); // two-step code expired: ask again
  if (!r.ok || !json.account) throw new Error(json.error ?? `Request failed (${r.status}).`);
  return json.account;
}

function Customer({ row, onChange, onError }: { row: Row; onChange: (r: Row) => void; onError: (m: string) => void }) {
  const [plan, setPlan] = useState<string>(PLANS[PLANS.length - 1].id);
  const [amount, setAmount] = useState(String(PLANS[PLANS.length - 1].price));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const l = row.licence;
  const run = async (data: object, confirmText: string) => {
    if (!confirm(confirmText)) return;
    setBusy(true);
    try {
      onChange(await post({ accountId: row.id, ...data }));
      setNote("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="admin-row">
      <div className="admin-who">
        <b>{row.name || row.email}</b>
        {row.name && <small>{row.email}</small>}
        <small>
          Joined {fmtDate(row.createdAt)} · {row.devices.length} of {l.maxDevices} computers · {row.browsers.length} of {row.maxBrowsers} browsers
          {row.browsers.length > 0 && ` (${row.browsers.map((b) => b.name).join(", ")})`}
        </small>
      </div>
      <div className={l.active ? "status-ok" : "status-bad"}>
        {PLAN_LABEL[l.plan] ?? l.plan} · {l.active ? `until ${fmtDate(l.expiresAt)} (${l.daysLeft} d)` : `ended ${fmtDate(l.expiresAt)}`}
      </div>
      <form
        className="admin-grant"
        onSubmit={(e) => {
          e.preventDefault();
          const p = PLANS.find((x) => x.id === plan)!;
          run({ action: "grant", plan, amount, note }, `Add ${p.name} (${p.days} days) for ${row.email}, paid €${amount}?`);
        }}
      >
        <select
          aria-label="Plan"
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
            setAmount(String(PLANS.find((p) => p.id === e.target.value)?.price ?? ""));
          }}
        >
          {PLANS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · €{p.price}
            </option>
          ))}
        </select>
        <input aria-label="Amount paid (€)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <input aria-label="Note" placeholder="Note (e.g. bank transfer ref.)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        <button className="btn btn-primary btn-sm" disabled={busy}>
          Add plan
        </button>
        {l.active && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => run({ action: "end" }, `End the licence of ${row.email} now? The studio locks for them.`)}
          >
            End now
          </button>
        )}
        {row.browsers.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => run({ action: "signout" }, `Sign ${row.email} out of every browser? They can then sign in again.`)}
          >
            Sign out browsers
          </button>
        )}
      </form>
      {row.payments.length > 0 && (
        <small className="admin-payments">
          {row.payments
            .slice(-3)
            .reverse()
            .map((p) => `${fmtDate(p.at)}: ${PLAN_LABEL[p.plan]} €${p.amount}${p.note ? ` (${p.note})` : ""}`)
            .join(" · ")}
        </small>
      )}
    </li>
  );
}

export default function Admin() {
  const [state, setState] = useState<"loading" | "setup" | "code" | "ready" | "replace">("loading");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [recoveryLeft, setRecoveryLeft] = useState(0);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    fetch("/api/admin/accounts", { cache: "no-store" }).then(async (r) => {
      if (r.status === 401) return window.location.replace("/login?next=/admin");
      const json = (await r.json()) as { accounts?: Row[]; activity?: Activity[]; recoveryLeft?: number; error?: string; need?: "setup" | "code" };
      if (r.status === 428) return setState(json.need === "setup" ? "setup" : "code");
      if (!r.ok) return setError(json.error ?? "Not allowed.");
      setRows(json.accounts ?? []);
      setActivity(json.activity ?? []);
      setRecoveryLeft(json.recoveryLeft ?? 0);
      setState("ready");
    });
  }, [tick]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !s || r.email.includes(s) || (r.name ?? "").toLowerCase().includes(s));
  }, [rows, q]);
  const paying = (rows ?? []).filter((r) => r.licence.active && r.licence.plan !== "trial").length;
  const trials = (rows ?? []).filter((r) => r.licence.active && r.licence.plan === "trial").length;

  return (
    <div className="site">
      <SiteHeader signedIn />
      <main className="account-page wrap">
        <div className="account-head">
          <div>
            <p className="eyebrow">Owner</p>
            <h1>Customers</h1>
            {rows && state === "ready" && (
              <p className="muted">
                {rows.length} accounts · {paying} paying · {trials} on trial
              </p>
            )}
          </div>
          <div className="account-actions">
            <a className="btn btn-ghost" href="/account">
              My account
            </a>
          </div>
        </div>
        {error && (
          <p className="account-message error" role="alert">
            {error}
          </p>
        )}
        {state === "setup" && <TwoStepSetup onDone={reload} />}
        {state === "code" && <TwoStepCode onDone={reload} />}
        {state === "replace" && <TwoStepSetup replacing onDone={reload} />}
        {state === "ready" && rows && (
          <>
            {recoveryLeft <= 3 && (
              <p className="account-message error" role="alert">
                Only {recoveryLeft} recovery code{recoveryLeft === 1 ? "" : "s"} left. Set up the authenticator again (below) to get new ones.
              </p>
            )}
            <section className="account-card">
              <label className="auth-field">
                <span>Search by email or name</span>
                <input value={q} onChange={(e) => setQ(e.target.value)} type="search" />
              </label>
              <p className="muted">When a customer has paid, choose the plan and the amount they paid and press Add plan. Paying again extends from the current end date.</p>
              {shown.length === 0 ? (
                <p className="muted">No accounts{q ? " match" : " yet"}.</p>
              ) : (
                <ul className="admin-list">
                  {shown.map((r) => (
                    <Customer
                      key={r.id}
                      row={r}
                      onError={setError}
                      onChange={(n) => {
                        setRows((all) => (all ?? []).map((x) => (x.id === n.id ? n : x)));
                        reload(); // refresh the activity log
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
            <AdminReleases onChanged={reload} />
            <section className="account-card">
              <h2>Activity</h2>
              <p className="muted">Every admin action and two-step login, with time and IP address (this month and last month).</p>
              {activity.length === 0 ? (
                <p className="muted">Nothing yet.</p>
              ) : (
                <ul className="activity-list">
                  {activity.map((e, i) => (
                    <li key={e.at + i}>
                      <time>{fmtTime(e.at)}</time>
                      <span>
                        <b>{e.action}</b>
                        {e.target && <> · {e.target}</>}
                        {e.detail && <small>{e.detail}</small>}
                      </span>
                      <small className="activity-who">
                        {e.by} · {e.ip}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="account-card">
              <h2>Two-step login</h2>
              <p className="muted">
                On · {recoveryLeft} recovery code{recoveryLeft === 1 ? "" : "s"} left. This browser asks for a new code every 12 hours.
              </p>
              <button className="btn btn-ghost" onClick={() => setState("replace")}>
                Set up a new phone / new recovery codes
              </button>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
