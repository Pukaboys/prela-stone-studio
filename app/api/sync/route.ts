/**
 * Desktop <-> website sync (desktop app only).
 *
 * The desktop app's local server talks to the website on the user's behalf,
 * using this computer's signed licence ("Authorization: Licence <token>"), so
 * no password is needed and it does not take one of the account's browser
 * places. Projects travel with their slab photos; the project ID is kept, so
 * uploading again updates the same copy.
 *
 * Disabled unless JEO_DESKTOP=1 (set by the desktop app), so the public
 * website cannot be used to make requests to other servers.
 */
import { validProject, type Project } from "@/lib/model";
import { verifyLicence } from "@/lib/licence-token";
import { getStore, type ObjectStore } from "@/lib/storage";
import { localLicence, localToken } from "@/lib/studio-access";

const STORED = /^\/api\/images\?id=([a-zA-Z0-9-]+)$/;
type Link = { url: string; token: string };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const available = () => typeof process !== "undefined" && process.env.JEO_DESKTOP === "1";
const server = () => String(process.env.JEO_LICENSE_SERVER ?? "").replace(/\/+$/, "");

async function readJson<T>(store: ObjectStore, key: string): Promise<T | null> {
  const obj = await store.get(key);
  if (!obj) return null;
  return JSON.parse(await new Response(obj.body as BodyInit).text()) as T;
}

/** The website and this computer's licence, or null when not activated. */
async function link(): Promise<Link | null> {
  const token = await localToken();
  return server() && token ? { url: server(), token } : null;
}

async function remote(s: Link, path: string, init: RequestInit = {}) {
  const res = await fetch(s.url + path, { ...init, headers: { ...(init.headers as object), Authorization: `Licence ${s.token}` }, redirect: "manual" });
  if (res.status === 401) throw Error("The website did not accept this computer. Sign out of the app and sign in again.");
  if (res.status === 402) throw Error("Your licence has ended. Renew it on your account page on the website.");
  if (!res.ok) throw Error(`Website replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Every stored photo a project links to. */
const photos = (p: Project) =>
  [...new Set(p.slabs.flatMap((s) => [s.image, s.edit?.source]).filter((u): u is string => !!u && STORED.test(u)))];

function relink(p: Project, map: Map<string, string>): Project {
  const r = (u: string) => map.get(u) ?? u;
  return { ...p, slabs: p.slabs.map((s) => ({ ...s, image: r(s.image), ...(s.edit ? { edit: { ...s.edit, source: r(s.edit.source) } } : {}) })) };
}

export async function GET() {
  if (!available()) return json({ available: false });
  const s = await link();
  const email = s ? ((await verifyLicence(s.token))?.email ?? null) : null;
  return json({ available: true, connected: !!s, url: s?.url ?? null, email });
}

export async function POST(req: Request) {
  if (!available()) return json({ error: "Sync is only available in the desktop app." }, 404);
  const store = await getStore();
  try {
    const body = (await req.json()) as { action?: string; id?: string };
    const s = await link();
    if (!s) return json({ error: "Sign in to the app with your account first." }, 400);
    if (!(await localLicence()).ok) return json({ error: "Limited mode: renew your licence or connect to the internet to sync." }, 402);

    if (body.action === "list") return json(await (await remote(s, "/api/projects")).json());

    const id = String(body.id ?? "");
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return json({ error: "Invalid project." }, 400);

    if (body.action === "push") {
      const local = await readJson<Project>(store, `projects/${id}.json`);
      if (!local || !validProject(local)) return json({ error: "Save the project before uploading it." }, 400);
      const map = new Map<string, string>();
      for (const url of photos(local)) {
        const obj = await store.get("images/" + STORED.exec(url)![1]);
        if (!obj) continue;
        const bytes = await new Response(obj.body as BodyInit).arrayBuffer();
        const up = await remote(s, "/api/images", { method: "POST", headers: { "Content-Type": obj.contentType || "image/jpeg" }, body: bytes });
        map.set(url, ((await up.json()) as { url: string }).url);
      }
      const res = await remote(s, "/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(relink(local, map)),
      });
      return json({ ok: true, id: ((await res.json()) as { id: string }).id, photos: map.size });
    }

    if (body.action === "pull") {
      const project = (await (await remote(s, "/api/projects?id=" + id)).json()) as Project;
      if (!validProject(project)) return json({ error: "The website project could not be read." }, 502);
      const map = new Map<string, string>();
      for (const url of photos(project)) {
        const res = await remote(s, url);
        const newId = crypto.randomUUID();
        await store.put("images/" + newId, await res.arrayBuffer(), res.headers.get("content-type") || "image/jpeg");
        map.set(url, "/api/images?id=" + newId);
      }
      const local = relink(project, map);
      await store.put(`projects/${id}.json`, JSON.stringify(local), "application/json", { name: local.name });
      return json({ ok: true, id, photos: map.size });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
}
