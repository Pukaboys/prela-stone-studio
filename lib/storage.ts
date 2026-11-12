/**
 * Server-side storage that runs on both Cloudflare Workers and plain Node.js.
 *
 * - On Cloudflare, objects go to the R2 bucket bound as `BUCKET`.
 * - On Node.js (e.g. Hostinger), objects are written to the filesystem under
 *   `DATA_DIR` (default: `~/jeo-stone-studio-data`; an existing
 *   `~/prela-stone-studio-data` from before the rename keeps being used). Keep this outside the
 *   deployed app folder so redeploys do not wipe saved projects and photos.
 *
 * `cloudflare:workers` is imported dynamically: Node cannot load that URL
 * scheme, so a failed import means "not on Cloudflare".
 */

export type StoredObject = {
  body: ReadableStream | Uint8Array;
  contentType?: string;
};
export type ListedObject = {
  key: string;
  uploaded: Date;
  meta: Record<string, string>;
};
export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    data: ArrayBuffer | string,
    contentType: string,
    meta?: Record<string, string>,
  ): Promise<void>;
  list(prefix: string): Promise<ListedObject[]>;
}

type CloudflareEnv = Record<string, unknown> & { BUCKET?: R2Bucket };

let cloudflareEnv: Promise<CloudflareEnv | null> | undefined;
function getCloudflareEnv() {
  cloudflareEnv ??= import(/* @vite-ignore */ "cloudflare:workers")
    .then((m) => ((m as unknown as { env?: CloudflareEnv }).env ?? null))
    .catch(() => null);
  return cloudflareEnv;
}

/** Reads a secret or setting from the Worker env, falling back to process.env. */
export async function getSetting(name: string): Promise<string | undefined> {
  const env = await getCloudflareEnv();
  const value = env?.[name];
  if (typeof value === "string" && value) return value;
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function r2Store(bucket: R2Bucket): ObjectStore {
  return {
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? { body: obj.body, contentType: obj.httpMetadata?.contentType } : null;
    },
    async put(key, data, contentType, meta) {
      await bucket.put(key, data, {
        httpMetadata: { contentType },
        customMetadata: meta,
      });
    },
    async list(prefix) {
      const result = await bucket.list({
        prefix,
        include: ["customMetadata"],
        limit: 1000,
      } as R2ListOptions & { include: string[] });
      return result.objects.map((o) => ({
        key: o.key,
        uploaded: o.uploaded,
        meta: o.customMetadata ?? {},
      }));
    },
  };
}

async function fileStore(): Promise<ObjectStore> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const fsSync = await import("node:fs");
  const fresh = path.join(os.homedir(), "jeo-stone-studio-data");
  const legacy = path.join(os.homedir(), "prela-stone-studio-data");
  // Keep using the folder from before the rename so saved projects stay.
  const fallback = !fsSync.existsSync(fresh) && fsSync.existsSync(legacy) ? legacy : fresh;
  const root = path.resolve(process.env.DATA_DIR || fallback);
  const resolve = (key: string) => {
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw Error("Invalid storage key");
    return file;
  };
  const sidecar = (file: string) => file + ".meta.json";
  type Meta = { contentType: string; meta?: Record<string, string> };
  return {
    async get(key) {
      const file = resolve(key);
      try {
        const [bytes, info] = await Promise.all([
          fs.readFile(file),
          fs.readFile(sidecar(file), "utf8").catch(() => "{}"),
        ]);
        const { contentType } = JSON.parse(info) as Partial<Meta>;
        return { body: new Uint8Array(bytes), contentType };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async put(key, data, contentType, meta) {
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const bytes = typeof data === "string" ? data : new Uint8Array(data);
      // Write to a temp file and rename so readers never see a partial file.
      const tmp = file + "." + crypto.randomUUID() + ".tmp";
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, file);
      await fs.writeFile(sidecar(file), JSON.stringify({ contentType, meta } satisfies Meta));
    },
    async list(prefix) {
      const dir = resolve(prefix.replace(/\/$/, ""));
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
      const files = names.filter((n) => !n.endsWith(".meta.json") && !n.endsWith(".tmp"));
      return Promise.all(
        files.map(async (name) => {
          const file = path.join(dir, name);
          const [stat, info] = await Promise.all([
            fs.stat(file),
            fs.readFile(sidecar(file), "utf8").catch(() => "{}"),
          ]);
          return {
            key: prefix + name,
            uploaded: stat.mtime,
            meta: (JSON.parse(info) as Partial<Meta>).meta ?? {},
          };
        }),
      );
    },
  };
}

let store: Promise<ObjectStore> | undefined;
export function getStore(): Promise<ObjectStore> {
  store ??= getCloudflareEnv().then((env) =>
    env?.BUCKET ? r2Store(env.BUCKET) : fileStore(),
  );
  return store;
}
