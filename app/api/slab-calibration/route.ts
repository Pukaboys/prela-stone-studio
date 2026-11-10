import { env } from "cloudflare:workers";

type Point = { x: number; y: number };
type Calibration = { tl: Point; tr: Point; br: Point; bl: Point };

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tl: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
    tr: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
    br: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
    bl: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
  },
  required: ["tl", "tr", "br", "bl"],
};

function validCalibration(value: unknown): value is Calibration {
  if (!value || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  return ["tl", "tr", "br", "bl"].every((key) => {
    const p = q[key] as Record<string, unknown> | undefined;
    return !!p && typeof p.x === "number" && typeof p.y === "number" && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  });
}

function responseText(result: Record<string, unknown>): string {
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  if (typeof first?.message?.content === "string") return first.message.content;
  if (typeof result.output_text === "string") return result.output_text;
  const output = Array.isArray(result.output) ? result.output : [];
  for (const item of output) {
    const content = item && typeof item === "object" && Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const key = (env as unknown as { OPENAI_API_KEY?: string }).OPENAI_API_KEY || (typeof process !== "undefined" ? process.env.OPENAI_API_KEY : undefined);
    if (!key) return new Response("OPENAI_API_KEY is not configured on the server.", { status: 503 });
    const body = await req.json() as { image?: string };
    if (!body.image?.startsWith("data:image/")) return new Response("Send the slab image as a data URL.", { status: 400 });
    if (body.image.length > 12000000) return new Response("Image is too large for AI calibration.", { status: 413 });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Find the visible rectangular stone slab in this photo. Return the four outer slab corners, not the photo edges, crane, plastic, ground, or background. Coordinates must be normalized from 0 to 1 relative to the entire image: tl is top-left, tr top-right, br bottom-right, bl bottom-left. If a corner is partly hidden, estimate where the slab edge meets the occlusion. Return only JSON with this shape: {\"tl\":{\"x\":0,\"y\":0},\"tr\":{\"x\":0,\"y\":0},\"br\":{\"x\":0,\"y\":0},\"bl\":{\"x\":0,\"y\":0}}" },
            { type: "image_url", image_url: { url: body.image, detail: "high" } },
          ],
        }],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("OpenAI slab calibration error", response.status, detail);
      return new Response(`OpenAI request failed (${response.status}). Check the API key, model access, and image size.`, { status: 502 });
    }
    const result = await response.json() as Record<string, unknown>;
    const text = responseText(result).replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const calibration = text ? JSON.parse(text) : null;
    if (!validCalibration(calibration)) return new Response("AI did not return usable slab corners.", { status: 502 });
    return Response.json({ calibration });
  } catch (error) {
    console.error(error);
    return new Response(`AI slab calibration failed: ${error instanceof Error ? error.message : "unknown error"}`, { status: 500 });
  }
}
