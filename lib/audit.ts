/**
 * Admin activity log: who did what on the admin page, when and from where.
 * One JSON file per month in the data folder (audit/2026-11.json).
 */
import { clientIp } from "@/lib/accounts";
import { getStore } from "@/lib/storage";

export type AuditEntry = {
  at: string;
  action: string;
  /** Email of the account that did it. */
  by: string;
  ip: string;
  /** Email of the customer it was done to, if any. */
  target?: string;
  detail?: string;
};

const MAX_PER_MONTH = 5000;
const monthKey = (d: Date) => `audit/${d.toISOString().slice(0, 7)}.json`;

async function read(key: string): Promise<AuditEntry[]> {
  const obj = await (await getStore()).get(key);
  if (!obj) return [];
  try {
    const list = JSON.parse(await new Response(obj.body as BodyInit).text());
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// One write at a time, so entries are never lost to overlapping saves.
let queue: Promise<unknown> = Promise.resolve();

export function audit(req: Request, by: string, action: string, target?: string, detail?: string) {
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    action,
    by,
    ip: clientIp(req),
    ...(target ? { target } : {}),
    ...(detail ? { detail: detail.slice(0, 300) } : {}),
  };
  const run = queue.then(async () => {
    const key = monthKey(new Date(entry.at));
    const list = await read(key);
    list.push(entry);
    await (await getStore()).put(key, JSON.stringify(list.slice(-MAX_PER_MONTH)), "application/json");
  });
  queue = run.catch((e) => console.error("[audit]", e));
  return run;
}

/** The newest entries (this month and last month), newest first. */
export async function recentAudit(limit = 200): Promise<AuditEntry[]> {
  await queue;
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const all = [...(await read(monthKey(prev))), ...(await read(monthKey(now)))];
  return all.reverse().slice(0, limit);
}
