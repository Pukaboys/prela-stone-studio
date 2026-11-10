import { getStore } from "@/lib/storage";

const ID = /^[a-zA-Z0-9-]+$/;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 8_000_000;

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !ID.test(id)) return new Response("Invalid image", { status: 400 });
    const obj = await (await getStore()).get("images/" + id);
    if (!obj) return new Response("Image not found", { status: 404 });
    return new Response(obj.body as BodyInit, {
      headers: {
        "Content-Type": obj.contentType || "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("Image unavailable", { status: 503 });
  }
}

export async function POST(req: Request) {
  try {
    const mime = req.headers.get("content-type") || "";
    if (!TYPES.includes(mime))
      return new Response("Use a JPG, PNG or WebP image.", { status: 400 });
    if (Number(req.headers.get("content-length")) > MAX_BYTES)
      return new Response("Image exceeds 8 MB", { status: 413 });
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES)
      return new Response("Image exceeds 8 MB", { status: 413 });
    const id = crypto.randomUUID();
    await (await getStore()).put("images/" + id, bytes, mime);
    return Response.json({ url: "/api/images?id=" + id });
  } catch (e) {
    console.error(e);
    return new Response("Upload failed. Please try again.", { status: 503 });
  }
}
