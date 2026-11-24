import { getAccount, listAccounts } from "@/lib/accounts";
import { KEEP_MONTHS, activityCsv, activityFor, allActivity, type ActivityRow } from "@/lib/activity";
import { adminAccess } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { err, ok } from "@/lib/http";

/**
 * Owner only: the customer activity log.
 * GET ?account=<id>        one customer (the last 12 months)
 * GET                      every customer (?months=1..12, default 1)
 * add &format=csv to download it as a spreadsheet file.
 */
export async function GET(req: Request) {
  const me = await adminAccess(req);
  if (me instanceof Response) return me;
  const q = new URL(req.url).searchParams;
  const csv = q.get("format") === "csv";
  const id = q.get("account");
  let rows: ActivityRow[];
  let label: string;
  if (id) {
    const a = await getAccount(id);
    if (!a) return err(404, "No such account.");
    rows = (await activityFor(a.id)).map((e) => ({ ...e, email: a.email }));
    label = a.email;
  } else {
    const months = Math.min(KEEP_MONTHS, Math.max(1, Math.floor(Number(q.get("months") ?? (csv ? KEEP_MONTHS : 1))) || 1));
    rows = await allActivity(months, await listAccounts());
    label = `all customers, ${months} month${months === 1 ? "" : "s"}`;
  }
  if (!csv) return ok({ entries: rows.slice(0, 1000), total: rows.length, keepMonths: KEEP_MONTHS });

  await audit(req, me.account.email, "Exported customer activity (CSV)", id ? label : undefined, `${rows.length} entries${id ? "" : ` · ${label}`}`);
  const name = `activity-${id ? label.replace(/[^\w.-]+/g, "_") : "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(activityCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
