/**
 * Customer activity log: what happened on each customer account, when, from
 * which address and which browser or computer (sign-ins, wrong passwords,
 * password changes, desktop activations, downloads, sync, plans added).
 *
 * One JSON file per customer per month (activity/<accountId>/2026-11.json).
 * Kept KEEP_MONTHS months, then deleted. Never stores passwords, codes,
 * links or project contents.
 */
import { browserName, clientIp, listAccounts, withAccountLock, type Account } from "@/lib/accounts";
import { auditSince } from "@/lib/audit";
import { getStore } from "@/lib/storage";

export type ActivityEntry = {
  at: string;
  action: string;
  ip: string;
  /** Browser ("Chrome on Windows") or desktop computer name. */
  device?: string;
  detail?: string;
  /** Admin email, when the owner did it from the admin page. */
  by?: string;
  /** Rebuilt from the account's records, from before the log started (no IP address). */
  earlier?: true;
};
export type ActivityRow = ActivityEntry & { email: string };

export const KEEP_MONTHS = 12;
const MAX_PER_MONTH = 3000;
const ID = /^[a-f0-9-]{36}$/;
const prefixOf = (id: string) => `activity/${id}/`;
const month = (d: Date) => d.toISOString().slice(0, 7);
/** The oldest month still kept. */
function firstKeptMonth(now = new Date()) {
  return month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - KEEP_MONTHS, 1)));
}
const cutoff = (now = Date.now()) => new Date(now - KEEP_MONTHS * 30.44 * 864e5).toISOString();

async function read(key: string): Promise<ActivityEntry[]> {
  const obj = await (await getStore()).get(key);
  if (!obj) return [];
  try {
    const list = JSON.parse(await new Response(obj.body as BodyInit).text());
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Months stored for one customer ("2026-11"), oldest first. */
async function monthsOf(id: string) {
  const list = await (await getStore()).list(prefixOf(id));
  return list
    .map((o) => /(\d{4}-\d{2})\.json$/.exec(o.key)?.[1])
    .filter((m): m is string => !!m)
    .sort();
}

async function pruneAccount(id: string, now = new Date()) {
  const store = await getStore();
  const first = firstKeptMonth(now);
  for (const m of await monthsOf(id)) if (m < first) await store.remove(`${prefixOf(id)}${m}.json`);
}

/** Delete everything older than KEEP_MONTHS, for every customer. */
export async function pruneActivity(now = new Date()) {
  const ids = new Set<string>();
  for (const o of await (await getStore()).list("activity/")) {
    const m = /^activity\/([a-f0-9-]{36})(\/|$)/.exec(o.key);
    if (m) ids.add(m[1]);
  }
  for (const id of ids) await withAccountLock("activity:" + id, () => pruneAccount(id, now));
}
let lastPrune = 0;

// The same event at most once per window (e.g. "sign-in blocked" while someone keeps trying).
const recent = new Map<string, number>();
function seenRecently(key: string, ms: number) {
  const now = Date.now();
  if ((recent.get(key) ?? 0) > now - ms) return true;
  if (recent.size > 10_000) for (const [k, t] of recent) if (t < now - 3600e3) recent.delete(k);
  recent.set(key, now);
  return false;
}

export type LogOptions = { detail?: string; device?: string; by?: string; once?: { key: string; ms: number } };

/**
 * Write one entry to the customer's log. Never throws: a log problem must
 * not stop a sign-in or a download.
 */
export async function logActivity(req: Request | null, account: Pick<Account, "id">, action: string, o: LogOptions = {}) {
  const id = account.id;
  if (!ID.test(id)) return;
  if (o.once && seenRecently(`${id}|${action}|${o.once.key}`, o.once.ms)) return;
  const device = o.device ?? (req ? browserName(req.headers.get("user-agent")) : undefined);
  const entry: ActivityEntry = {
    at: new Date().toISOString(),
    action,
    ip: req ? clientIp(req) : "",
    ...(device ? { device: device.slice(0, 80) } : {}),
    ...(o.detail ? { detail: o.detail.slice(0, 300) } : {}),
    ...(o.by ? { by: o.by } : {}),
  };
  try {
    await withAccountLock("activity:" + id, async () => {
      const store = await getStore();
      const key = `${prefixOf(id)}${month(new Date(entry.at))}.json`;
      const list = await read(key);
      if (list.length === 0) await pruneAccount(id); // new month: drop this customer's old months
      list.push(entry);
      await store.put(key, JSON.stringify(list.slice(-MAX_PER_MONTH)), "application/json");
    });
    if (Date.now() - lastPrune > 864e5) {
      lastPrune = Date.now();
      void pruneActivity().catch((e) => console.error("[activity] prune", e));
    }
  } catch (e) {
    console.error("[activity]", e);
  }
}

/** One customer's log, newest first (at most the last `months` months, never past KEEP_MONTHS). */
export async function activityFor(id: string, months = KEEP_MONTHS): Promise<ActivityEntry[]> {
  if (!ID.test(id)) return [];
  const now = new Date();
  const from = month(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - Math.min(months, KEEP_MONTHS) + 1, 1)));
  const oldest = cutoff();
  const all: ActivityEntry[] = [];
  for (const m of await monthsOf(id)) if (m >= from) all.push(...(await read(`${prefixOf(id)}${m}.json`)));
  return all.filter((e) => e.at >= oldest).sort((a, b) => b.at.localeCompare(a.at));
}

/** Every customer's log together, newest first. */
export async function allActivity(months = 1, accounts?: Account[]): Promise<ActivityRow[]> {
  const list = accounts ?? (await listAccounts());
  const rows = await Promise.all(list.map(async (a) => (await activityFor(a.id, months)).map((e) => ({ ...e, email: a.email }))));
  return rows.flat().sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------- history from before the log
/**
 * What the account itself remembers from before this log existed: sign-up,
 * payments, computers, signed-in browsers, and the owner's actions on it.
 */
export function earlierHistory(a: Account, adminLog: { at: string; action: string; by: string; target?: string; detail?: string }[]): ActivityEntry[] {
  const e = (at: string | undefined, action: string, o: Partial<ActivityEntry> = {}): ActivityEntry[] =>
    at && !Number.isNaN(Date.parse(at)) ? [{ at: new Date(at).toISOString(), action, ip: "", earlier: true, ...o }] : [];
  const planName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
  return [
    ...e(a.createdAt, "Account created"),
    ...a.payments.flatMap((p) => e(p.at, `${planName(p.plan)} plan added`, { detail: `€${p.amount}${p.note ? ` · ${p.note}` : ""}` })),
    ...a.licence.devices.flatMap((d) => [
      ...e(d.activatedAt, "Desktop app activated on a new computer", { device: d.name }),
      ...(d.lastSeen !== d.activatedAt ? e(d.lastSeen, "Desktop app opened (licence check)", { device: d.name }) : []),
    ]),
    ...(a.sessions ?? []).flatMap((s) => [
      ...e(s.createdAt, "Signed in", { device: s.name }),
      ...(s.lastSeen !== s.createdAt ? e(s.lastSeen, "Used the website", { device: s.name }) : []),
    ]),
    ...adminLog.filter((x) => x.target === a.email).flatMap((x) => e(x.at, x.action, { by: x.by, ...(x.detail ? { detail: x.detail } : {}) })),
  ];
}

/**
 * Once per account: add earlierHistory to its log (marked "earlier"). Runs
 * when the owner opens the admin page; accounts already done are skipped.
 */
export async function fillEarlierHistory(accounts: Account[]) {
  const store = await getStore();
  const todo: Account[] = [];
  for (const a of accounts) if (!(await store.get(`${prefixOf(a.id)}earlier.json`))) todo.push(a);
  if (!todo.length) return 0;
  const adminLog = await auditSince(KEEP_MONTHS);
  const oldest = cutoff();
  for (const a of todo) {
    await withAccountLock("activity:" + a.id, async () => {
      if (await store.get(`${prefixOf(a.id)}earlier.json`)) return;
      const byMonth = new Map<string, ActivityEntry[]>();
      for (const x of earlierHistory(a, adminLog)) if (x.at >= oldest) byMonth.set(x.at.slice(0, 7), [...(byMonth.get(x.at.slice(0, 7)) ?? []), x]);
      for (const [m, add] of byMonth) {
        const key = `${prefixOf(a.id)}${m}.json`;
        const list = [...(await read(key)), ...add].sort((x, y) => x.at.localeCompare(y.at));
        await store.put(key, JSON.stringify(list.slice(-MAX_PER_MONTH)), "application/json");
      }
      await store.put(`${prefixOf(a.id)}earlier.json`, JSON.stringify({ at: new Date().toISOString() }), "application/json");
    });
  }
  return todo.length;
}

// ---------------------------------------------------------------- CSV
/** One CSV cell; text that a spreadsheet would run as a formula is made plain. */
function cell(v: unknown) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function activityCsv(rows: ActivityRow[]) {
  const head = ["Time (UTC)", "Customer", "Action", "Details", "IP address", "Browser / computer", "Done by"];
  const lines = rows.map((r) =>
    [r.at.replace("T", " ").slice(0, 19), r.email, r.action, r.earlier ? [r.detail, "from account records"].filter(Boolean).join(" · ") : r.detail, r.ip, r.device, r.by ?? "customer"].map(cell).join(","),
  );
  // BOM so Excel opens it as UTF-8.
  return "﻿" + [head.join(","), ...lines].join("\r\n") + "\r\n";
}
