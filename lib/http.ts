/** Small response helpers for the API routes. */
export const noStore = { "Cache-Control": "no-store" };
export const ok = (data: unknown, headers: Record<string, string> = {}) => Response.json(data, { headers: { ...noStore, ...headers } });
export const err = (status: number, error: string) => Response.json({ error }, { status, headers: noStore });

/** Largest JSON body the small API actions accept. */
const MAX_JSON_BYTES = 256 * 1024;

export class TooLarge extends Error {}

/**
 * The request body, refused (TooLarge) as soon as it passes `max` bytes, so
 * an oversized or endless upload is never buffered in memory.
 */
export async function readBytes(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new TooLarge();
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export const readText = async (req: Request, max: number) => new TextDecoder().decode(await readBytes(req, max));

export async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return (JSON.parse(await readText(req, MAX_JSON_BYTES)) ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}

/** Constant-time string comparison (secrets, signatures). */
export function safeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
