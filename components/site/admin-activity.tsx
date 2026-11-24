"use client";
/** Admin: customer activity log (sign-ins, wrong passwords, desktop app, downloads…) with CSV export. */
import { useEffect, useMemo, useState } from "react";

type Entry = { at: string; action: string; ip: string; device?: string; detail?: string; by?: string; email: string };
type Customer = { id: string; email: string; name?: string };

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Rough groups for the filter. */
const KINDS: { id: string; label: string; test: (a: string) => boolean }[] = [
  { id: "", label: "Everything", test: () => true },
  { id: "warn", label: "Warnings (wrong password, blocked, refused)", test: (a) => /wrong|blocked|refused/i.test(a) },
  { id: "signin", label: "Sign-ins and sign-outs", test: (a) => /signed (in|out)|account created/i.test(a) },
  { id: "password", label: "Password and email", test: (a) => /password|email/i.test(a) },
  { id: "desktop", label: "Desktop app and computers", test: (a) => /desktop|computer/i.test(a) },
  { id: "download", label: "Downloads", test: (a) => /download/i.test(a) },
  { id: "plan", label: "Plans and licences", test: (a) => /plan|licence/i.test(a) },
];

export default function AdminActivity({ customers, selected, onSelect, tick = 0 }: { customers: Customer[]; selected: string; onSelect: (id: string) => void; tick?: number }) {
  const [months, setMonths] = useState(1);
  const [kind, setKind] = useState("");
  const query = selected ? `account=${encodeURIComponent(selected)}` : `months=${months}`;
  const want = `${query}#${tick}`;
  // The answer for one query; a different query shows "Loading…" until its answer arrives.
  const [got, setGot] = useState<{ for: string; entries: Entry[] | null; total: number; error: string }>({ for: "", entries: null, total: 0, error: "" });
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/activity?${query}`, { cache: "no-store" }).then(async (r) => {
      if (r.status === 428) return window.location.reload();
      const json = (await r.json().catch(() => ({}))) as { entries?: Entry[]; total?: number; error?: string };
      if (!live) return;
      if (!r.ok) setGot({ for: want, entries: null, total: 0, error: json.error ?? `Could not load the activity (${r.status}).` });
      else setGot({ for: want, entries: json.entries ?? [], total: json.total ?? 0, error: "" });
    });
    return () => {
      live = false;
    };
  }, [query, want]);
  const current = got.for === want;
  const entries = current ? got.entries : null;
  const total = current ? got.total : 0;
  const error = current ? got.error : "";

  const shown = useMemo(() => {
    const k = KINDS.find((x) => x.id === kind) ?? KINDS[0];
    return (entries ?? []).filter((e) => k.test(e.action));
  }, [entries, kind]);
  const who = customers.find((c) => c.id === selected);

  return (
    <section className="account-card" id="customer-activity">
      <h2>Customer activity</h2>
      <p className="muted">
        What each customer did: sign-ins, wrong passwords, password changes, desktop app, downloads and plans, with time, IP address and
        browser or computer. Kept 12 months, then deleted automatically.
      </p>
      <div className="admin-grant">
        <select aria-label="Customer" value={selected} onChange={(e) => onSelect(e.target.value)}>
          <option value="">All customers</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ? `${c.name} (${c.email})` : c.email}
            </option>
          ))}
        </select>
        {!selected && (
          <select aria-label="Period" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            <option value={1}>This month</option>
            <option value={3}>Last 3 months</option>
            <option value={12}>Last 12 months</option>
          </select>
        )}
        <select aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <a className="btn btn-ghost btn-sm" href={`/api/admin/activity?${query}&format=csv`} download>
          Download CSV
        </a>
      </div>
      {error && (
        <p className="account-message error" role="alert">
          {error}
        </p>
      )}
      {!entries && !error ? (
        <p className="muted">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="muted">Nothing {kind ? "of this kind " : ""}yet{who ? ` for ${who.email}` : ""}.</p>
      ) : (
        <>
          {total > (entries?.length ?? 0) && <p className="muted">Showing the newest {entries!.length} of {total}. The CSV file has them all.</p>}
          <ul className="activity-list">
            {shown.map((e, i) => (
              <li key={e.at + i} className={/wrong|blocked|refused/i.test(e.action) ? "activity-warn" : undefined}>
                <time>{fmtTime(e.at)}</time>
                <span>
                  <b>{e.action}</b>
                  {!selected && <> · {e.email}</>}
                  {(e.detail || e.by) && <small>{[e.detail, e.by && `by ${e.by}`].filter(Boolean).join(" · ")}</small>}
                </span>
                <small className="activity-who">{[e.device, e.ip].filter(Boolean).join(" · ")}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
