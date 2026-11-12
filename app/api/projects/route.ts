import { validProject } from "@/lib/model";
import { requireStudio } from "@/lib/studio-access";
import { getStore } from "@/lib/storage";

const ID = /^[a-zA-Z0-9-]+$/;
const MAX_CHARS = 500_000;

export async function GET(req: Request) {
  try {
    const access = await requireStudio(req);
    if (access instanceof Response) return access;
    const { prefix } = access;
    const store = await getStore();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      if (!ID.test(id)) return new Response("Invalid project", { status: 400 });
      const obj = await store.get(prefix + "projects/" + id + ".json");
      if (!obj) return new Response("Project not found", { status: 404 });
      return new Response(obj.body as BodyInit, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const list = await store.list(prefix + "projects/");
    return Response.json(
      list
        .filter((o) => o.key.endsWith(".json"))
        .map((o) => ({
          id: o.key.slice((prefix + "projects/").length, -".json".length),
          name: o.meta.name || "Untitled",
          updated: o.uploaded,
        }))
        .sort((a, b) => b.updated.getTime() - a.updated.getTime()),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error(e);
    return new Response("Could not load projects. Please try again.", { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireStudio(req);
    if (access instanceof Response) return access;
    const { prefix } = access;
    const raw = await req.text();
    if (raw.length > MAX_CHARS) return new Response("Project too large", { status: 413 });
    const p = JSON.parse(raw);
    if (!validProject(p)) return new Response("Invalid project data", { status: 400 });
    const id = p.id || crypto.randomUUID();
    if (!ID.test(id)) return new Response("Invalid project ID", { status: 400 });
    p.id = id;
    await (await getStore()).put(prefix + "projects/" + id + ".json", JSON.stringify(p), "application/json", {
      name: p.name,
    });
    return Response.json({ id });
  } catch (e) {
    console.error(e);
    return new Response("Could not save. Your work is still open; please try again.", {
      status: 503,
    });
  }
}
