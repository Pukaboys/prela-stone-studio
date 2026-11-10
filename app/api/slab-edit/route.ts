import { env } from "cloudflare:workers";

type Point = { x: number; y: number };
type Calibration = { tl: Point; tr: Point; br: Point; bl: Point };

function decodeDataUrl(value: string) {
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) throw Error("Invalid image data.");
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return { mime: match[1] === "image/jpg" ? "image/jpeg" : match[1], bytes };
}

function parseCalibration(value: unknown): Calibration | null {
  if (!value || typeof value !== "object") return null;
  const q = value as Record<string, unknown>;
  const points = ["tl", "tr", "br", "bl"].map((key) => q[key] as Record<string, unknown> | undefined);
  return points.every((p) => p && typeof p.x === "number" && typeof p.y === "number" && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
    ? value as Calibration : null;
}

async function detectCorners(key: string, image: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: [
        { type: "text", text: "Find the visible rectangular stone slab. Ignore the crane, sky, ground, plastic, supports, and photo edges. Return only JSON with normalized 0..1 coordinates for the slab corners: {\"tl\":{\"x\":0,\"y\":0},\"tr\":{\"x\":0,\"y\":0},\"br\":{\"x\":0,\"y\":0},\"bl\":{\"x\":0,\"y\":0}}." },
        { type: "image_url", image_url: { url: image, detail: "high" } },
      ] }],
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) return null;
  const result = await response.json() as { choices?: { message?: { content?: string } }[] };
  try { return parseCalibration(JSON.parse(result.choices?.[0]?.message?.content ?? "")); } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const key = (env as unknown as { OPENAI_API_KEY?: string }).OPENAI_API_KEY || (typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined);
    if (!key) return new Response("OPENAI_API_KEY is not configured on the server.", { status: 503 });
    const body = await req.json() as { image?: string };
    if (!body.image?.startsWith("data:image/")) return new Response("Send the slab image as a data URL.", { status: 400 });
    if (body.image.length > 20000000) return new Response("Image is too large for AI editing.", { status: 413 });
    const source = decodeDataUrl(body.image);
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("image", new Blob([source.bytes], { type: source.mime }), `slab-input.${source.mime.split("/")[1]}`);
    form.append("prompt", "Edit this exact photograph of a stone slab. Keep the original stone material, veins, color, texture, chips, and real slab shape. Isolate only the complete slab and remove the crane, sky, ground, plastic, supports, and every other background object. Correct the camera perspective so the slab is viewed perfectly straight-on and centered, with its left and right edges vertical and its top and bottom edges horizontal. Do not invent furniture, edges, markings, or new stone texture. Output only the isolated slab image with transparent background outside the slab.");
    form.append("background", "transparent");
    form.append("output_format", "png");
    form.append("size", "1536x1024");
    form.append("input_fidelity", "high");
    const response = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    if (!response.ok) {
      const detail = await response.text();
      console.error("OpenAI slab edit error", response.status, detail);
      const calibration = await detectCorners(key, body.image);
      if (calibration) return Response.json({ calibration, fallback: true });
      return new Response(`OpenAI image edit failed (${response.status}). Check image-model access and billing.`, { status: 502 });
    }
    const result = await response.json() as { data?: { b64_json?: string }[] };
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) return new Response("OpenAI returned no edited image.", { status: 502 });
    return Response.json({ image: `data:image/png;base64,${encoded}` });
  } catch (error) {
    console.error(error);
    return new Response(`AI slab editing failed: ${error instanceof Error ? error.message : "unknown error"}`, { status: 500 });
  }
}
