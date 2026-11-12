/** Small response helpers for the API routes. */
export const noStore = { "Cache-Control": "no-store" };
export const ok = (data: unknown, headers: Record<string, string> = {}) => Response.json(data, { headers: { ...noStore, ...headers } });
export const err = (status: number, error: string) => Response.json({ error }, { status, headers: noStore });
export async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return ((await req.json()) ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}
