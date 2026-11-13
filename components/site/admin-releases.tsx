"use client";
/** Admin: upload desktop installers in pieces and publish a version. */
import { useEffect, useState } from "react";
import type { Manifest, Platform, UploadedFile } from "@/lib/downloads";

const CHUNK = 4 * 1024 * 1024;
const LIST: { id: Platform; field: "windows" | "macArm" | "macIntel"; label: string; accept: string }[] = [
  { id: "windows", field: "windows", label: "Windows", accept: ".exe" },
  { id: "mac-arm", field: "macArm", label: "Mac (Apple Silicon)", accept: ".dmg,.zip" },
  { id: "mac-intel", field: "macIntel", label: "Mac (Intel)", accept: ".dmg,.zip" },
];
const mb = (n?: number) => (n ? `${(n / 1048576).toFixed(1)} MB` : "");
/** "Jeo Stone Studio Setup 1.0.1.exe" → "1.0.1". */
const versionIn = (name: string) => /(\d+\.\d+\.\d+)/.exec(name)?.[1] ?? null;
const nextVersion = (v?: string) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? "");
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "1.0.0";
};

async function json<T>(r: Response): Promise<T> {
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (r.status === 428) window.location.reload(); // two-step code expired
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status}).`);
  return data;
}
const postJson = (data: unknown) =>
  fetch("/api/admin/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

/** Send one file in 4 MB pieces (each retried), then have the server check and keep it. */
async function uploadFile(platform: Platform, file: File, progress: (sent: number) => void): Promise<UploadedFile> {
  const id = crypto.randomUUID();
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const piece = file.slice(offset, offset + CHUNK);
    for (let attempt = 1; ; attempt++) {
      try {
        await json(
          await fetch(`/api/admin/release?upload=${id}&offset=${offset}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: piece }),
        );
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    progress(Math.min(file.size, offset + CHUNK));
  }
  return json<UploadedFile>(await postJson({ action: "finish", upload: id, platform, name: file.name, size: file.size }));
}

export default function AdminReleases({ onChanged }: { onChanged: () => void }) {
  const [m, setM] = useState<Manifest | null>(null);
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<Partial<Record<Platform, File>>>({});
  const [sent, setSent] = useState<Partial<Record<Platform, number>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/release", { cache: "no-store" })
      .then((r) => json<{ manifest: Manifest }>(r))
      .then(({ manifest }) => {
        setM(manifest);
        setVersion(nextVersion(manifest.version));
        setNotes(manifest.notes ?? "");
      })
      .catch((e: Error) => setMessage({ kind: "error", text: e.message }));
  }, []);

  const chosen = LIST.filter((p) => files[p.id]);
  // The app compares its own version with this one: they must match, or installed apps keep asking to update.
  const mismatch = chosen.map((p) => files[p.id]!.name).filter((name) => versionIn(name) && versionIn(name) !== version);
  const total = chosen.reduce((n, p) => n + files[p.id]!.size, 0);
  const done = chosen.reduce((n, p) => n + (sent[p.id] ?? 0), 0);

  async function publishNow() {
    setBusy(true);
    setMessage(null);
    try {
      const uploaded: Partial<Record<Platform, UploadedFile>> = {};
      for (const p of chosen) uploaded[p.id] = await uploadFile(p.id, files[p.id]!, (n) => setSent((s) => ({ ...s, [p.id]: n })));
      const { manifest } = await json<{ manifest: Manifest }>(await postJson({ action: "publish", version, notes, files: uploaded }));
      setM(manifest);
      setFiles({});
      setSent({});
      setVersion(nextVersion(manifest.version));
      setMessage({ kind: "ok", text: `Version ${manifest.version} is live. Customers can download it, and desktop apps will offer the update.` });
      onChanged();
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-card releases">
      <h2>Desktop app downloads</h2>
      {m && (
        <p className="muted">
          {m.version ? `Live: version ${m.version}${m.published ? ` · published ${new Date(m.published).toLocaleDateString()}` : ""}` : "Nothing published yet."}
        </p>
      )}
      {m && (
        <ul className="release-files">
          {LIST.map((p) => (
            <li key={p.id}>
              <b>{p.label}</b>
              {m[p.field] ? (
                <>
                  <span>
                    {m[p.field]} · {mb(m.sizes?.[p.field])}
                    {m.sha256?.[p.field] && <small title={m.sha256[p.field]}>SHA-256 {m.sha256[p.field]!.slice(0, 16)}…</small>}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={async () => {
                      if (!confirm(`Stop offering the ${p.label} download?`)) return;
                      try {
                        setM((await json<{ manifest: Manifest }>(await postJson({ action: "remove", platform: p.id }))).manifest);
                        onChanged();
                      } catch (e) {
                        setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
                      }
                    }}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="muted">not offered</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Publish a new version</h3>
      <p className="muted">
        Build the installers (Windows: <code>pnpm desktop:win</code> → release folder; Mac: GitHub → Actions → Desktop installers), choose them below and publish. Platforms
        you leave empty keep their current file.
      </p>
      <div className="release-form">
        <label className="auth-field">
          <span>Version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.1" disabled={busy} />
        </label>
        <label className="auth-field release-notes">
          <span>What&apos;s new (shown with the update)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000} disabled={busy} />
        </label>
        {LIST.map((p) => (
          <label key={p.id} className="auth-field">
            <span>
              {p.label} ({p.accept})
            </span>
            <input
              type="file"
              accept={p.accept}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                const v = f && versionIn(f.name);
                if (v) setVersion(v);
                setFiles((all) => {
                  const next = { ...all };
                  if (f) next[p.id] = f;
                  else delete next[p.id];
                  return next;
                });
              }}
            />
            {files[p.id] && (
              <small>
                {mb(files[p.id]!.size)}
                {sent[p.id] !== undefined && ` · ${Math.round(((sent[p.id] ?? 0) / files[p.id]!.size) * 100)}% uploaded`}
              </small>
            )}
          </label>
        ))}
      </div>
      {mismatch.length > 0 && (
        <p className="account-message error" role="alert">
          {mismatch.join(", ")} is not version {version}. Use the version the installer was built with, or installed apps will keep offering an update.
        </p>
      )}
      {busy && total > 0 && (
        <div className="release-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((done / total) * 100)}>
          <span style={{ width: `${(done / total) * 100}%` }} />
        </div>
      )}
      {message && (
        <p className={"account-message " + message.kind} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      <button className="btn btn-primary" disabled={busy || !/^\d+\.\d+\.\d+$/.test(version) || mismatch.length > 0} onClick={publishNow}>
        {busy ? `Uploading… ${total ? Math.round((done / total) * 100) : 100}%` : chosen.length ? `Upload and publish ${version}` : `Publish ${version} (no new files)`}
      </button>
    </section>
  );
}
