"use client";
/**
 * Website sync, shown in the desktop app's Projects window: connect to the
 * website once, upload the open project, or download website projects.
 */
import { useEffect, useState } from "react";
import { CloudDownload, CloudUpload, Link2, Unlink } from "lucide-react";

type Status = { available: boolean; connected?: boolean; url?: string | null };
type Remote = { id: string; name: string; updated: string };

async function call(body: object) {
  const r = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
  if (!r.ok || data.error) throw Error(data.error ?? `Sync failed (${r.status}).`);
  return data;
}

export default function SyncPanel({
  saveCurrent,
  onDownloaded,
  notify,
}: {
  /** Save the open project locally and return its id (null if saving failed). */
  saveCurrent: () => Promise<string | null>;
  /** Open a project that was just downloaded. */
  onDownloaded: (id: string) => void;
  notify: (kind: "success" | "error", text: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [remote, setRemote] = useState<Remote[] | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch("/api/sync")
      .then((r) => r.json() as Promise<Status>)
      .then(setStatus)
      .catch(() => setStatus({ available: false }));
  }, []);
  if (!status?.available) return null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify("error", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const refresh = () => run("list", async () => setRemote((await call({ action: "list" })) as unknown as Remote[]));

  return (
    <section className="sync">
      <h3>Website sync</h3>
      {!status.connected ? (
        <form
          className="sync-connect"
          onSubmit={(e) => {
            e.preventDefault();
            run("connect", async () => {
              const r = await call({ action: "connect", url, password });
              setPassword("");
              setStatus({ available: true, connected: true, url: r.url as string });
              notify("success", "Connected to the website.");
            });
          }}
        >
          <label className="field">
            <span>Website address</span>
            <input type="url" placeholder="https://your-site.example" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </label>
          <label className="field">
            <span>Team password</span>
            <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="primary" disabled={!!busy || !url}>
            <Link2 size={15} /> {busy === "connect" ? "Connecting…" : "Connect"}
          </button>
          <p className="hint">The password is used once to sign in; only the session is kept on this computer.</p>
        </form>
      ) : (
        <>
          <p className="sync-status">
            Connected to <b>{status.url}</b>
            <button
              className="quiet"
              onClick={() =>
                run("disconnect", async () => {
                  await call({ action: "disconnect" });
                  setStatus({ available: true, connected: false });
                  setRemote(null);
                })
              }
            >
              <Unlink size={14} /> Disconnect
            </button>
          </p>
          <div className="sync-actions">
            <button
              disabled={!!busy}
              onClick={() =>
                run("push", async () => {
                  const id = await saveCurrent();
                  if (!id) return;
                  const r = await call({ action: "push", id });
                  notify("success", `Uploaded to the website with ${r.photos} photo${r.photos === 1 ? "" : "s"}.`);
                })
              }
            >
              <CloudUpload size={16} /> {busy === "push" ? "Uploading…" : "Upload this project"}
            </button>
            <button disabled={!!busy} onClick={refresh}>
              <CloudDownload size={16} /> {busy === "list" ? "Loading…" : remote ? "Refresh website projects" : "Show website projects"}
            </button>
          </div>
          {remote && (
            <ul className="sync-list">
              {remote.length === 0 && <li className="hint">No projects on the website yet.</li>}
              {remote.map((p) => (
                <li key={p.id}>
                  <span>
                    <b>{p.name}</b>
                    <small>{new Date(p.updated).toLocaleString()}</small>
                  </span>
                  <button
                    disabled={!!busy}
                    onClick={() =>
                      run("pull:" + p.id, async () => {
                        await call({ action: "pull", id: p.id });
                        notify("success", `Downloaded “${p.name}”.`);
                        onDownloaded(p.id);
                      })
                    }
                  >
                    <CloudDownload size={15} /> {busy === "pull:" + p.id ? "Downloading…" : "Download"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
