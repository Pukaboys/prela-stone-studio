// Jeo Stone Studio — desktop shell (Electron main process).
//
// The desktop app runs the same Node.js server as the website (vinext
// standalone build), privately on 127.0.0.1, and shows it in a window.
// Projects and slab photos are stored on this computer in
//   Windows: %APPDATA%\Jeo Stone Studio\data
//   macOS:   ~/Library/Application Support/Jeo Stone Studio/data
"use strict";

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PREFERRED_PORT = 47821;
const isMac = process.platform === "darwin";

// Packaged: the server is copied next to the app as an extra resource.
// Development (`pnpm desktop`): use the fresh build in dist/standalone.
const serverDir = app.isPackaged
  ? path.join(process.resourcesPath, "server")
  : path.join(__dirname, "..", "..", "dist", "standalone");

// The smoke test must never write into the user's real projects folder.
if (process.env.JEO_SMOKE_TEST === "1")
  app.setPath("userData", path.join(require("node:os").tmpdir(), `jeo-smoke-${Date.now()}`));

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let baseUrl = "";

/**
 * Before the rename the app was "Prela Stone Studio" and kept its data in
 * that app-data folder. Copy it into the new folder once so nothing is lost.
 */
function migrateOldData(dataDir) {
  const fs = require("node:fs");
  const old = path.join(app.getPath("appData"), "Prela Stone Studio", "data");
  try {
    if (fs.existsSync(old) && !fs.existsSync(dataDir)) fs.cpSync(old, dataDir, { recursive: true });
  } catch (error) {
    console.error("Could not copy data from the old app folder", error);
  }
}

/** A free localhost port, preferring a fixed one so the app's origin is stable. */
function findPort(preferred) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => {
      const any = net.createServer();
      any.listen(0, "127.0.0.1", () => {
        const { port } = any.address();
        any.close(() => resolve(port));
      });
    });
    probe.listen(preferred, "127.0.0.1", () => probe.close(() => resolve(preferred)));
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("The studio server did not start in time.");
}

async function startServer() {
  const port = await findPort(PREFERRED_PORT);
  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "production";
  process.env.DATA_DIR = path.join(app.getPath("userData"), "data");
  migrateOldData(process.env.DATA_DIR);
  // Enables desktop-only features in the server (website sync).
  process.env.JEO_DESKTOP = "1";
  // Where licences are activated and checked.
  process.env.JEO_LICENSE_SERVER = LICENSE_SERVER;
  // server.js reads PORT/HOST and starts listening when imported.
  await import(pathToFileURL(path.join(serverDir, "server.js")).href);
  baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl + "/");
}

function isInternal(url) {
  return url === baseUrl || url.startsWith(baseUrl + "/");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: "Jeo Stone Studio",
    backgroundColor: "#141a1e",
    show: false,
    autoHideMenuBar: !isMac,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Keep the window on the studio; open any other link in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInternal(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isInternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.loadURL(baseUrl + "/studio");
  mainWindow.on("closed", () => (mainWindow = null));
}

// ---------------------------------------------------------------- updates
// The website sells the app, issues licences and hosts the installers.
// Set "licenseServer" in desktop/app/package.json to the website address.
// For testing an unpackaged build, JEO_LICENSE_SERVER can point at a local server.
const LICENSE_SERVER = String(
  (!app.isPackaged && process.env.JEO_LICENSE_SERVER) || require("./package.json").licenseServer || "",
).replace(/\/+$/, "");

/** Compare "1.2.3" style versions: >0 when a is newer than b. */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/**
 * Ask the website for the newest version and offer it. `manual` shows a
 * message even when the app is up to date or offline.
 */
async function checkForUpdates(manual = false) {
  try {
    if (!LICENSE_SERVER) throw new Error("No website is configured for updates.");
    const res = await fetch(`${LICENSE_SERVER}/api/app-version`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`The website replied ${res.status}`);
    const latest = String((await res.json()).version || "").replace(/^v/, "");
    if (latest && compareVersions(latest, app.getVersion()) > 0) {
      const { response } = await dialog.showMessageBox({
        type: "info",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
        message: `Jeo Stone Studio ${latest} is available`,
        detail: `You have version ${app.getVersion()}. Your account page opens in the browser; download and install it over this version — your projects stay.`,
      });
      if (response === 0) shell.openExternal(`${LICENSE_SERVER}/account`);
    } else if (manual) {
      dialog.showMessageBox({ type: "info", message: "You have the latest version.", detail: `Version ${app.getVersion()}.` });
    }
  } catch (error) {
    if (manual) dialog.showMessageBox({ type: "warning", message: "Could not check for updates.", detail: String(error?.message || error) });
  }
}

function buildMenu() {
  const openData = {
    label: "Open Data Folder",
    click: () => shell.openPath(path.join(app.getPath("userData"), "data")),
  };
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [openData, { type: "separator" }, isMac ? { role: "close" } : { role: "quit" }] },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Check for Updates…", click: () => checkForUpdates(true) },
        { label: "My Account (website)", click: () => LICENSE_SERVER && shell.openExternal(`${LICENSE_SERVER}/account`) },
        { type: "separator" },
        { label: `Version ${app.getVersion()}`, enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

app.on("activate", () => {
  if (app.isReady() && baseUrl && !BrowserWindow.getAllWindows().length) createWindow();
});

/**
 * `JEO_SMOKE_TEST=1`: start the server, load the studio in a hidden window,
 * print what rendered and whether saving works, then quit. Used to verify a
 * build without opening a window.
 */
async function smokeTest() {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  // Optional: activate with a test account first (JEO_SMOKE_EMAIL / JEO_SMOKE_PASSWORD).
  let activation = null;
  if (process.env.JEO_SMOKE_EMAIL) {
    const res = await fetch(baseUrl + "/api/desktop/licence", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ action: "activate", email: process.env.JEO_SMOKE_EMAIL, password: process.env.JEO_SMOKE_PASSWORD }),
    });
    activation = res.status;
  }
  await win.loadURL(baseUrl + "/studio");
  await new Promise((r) => setTimeout(r, 2500));
  const report = await win.webContents.executeJavaScript(`(async () => {
    const save = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "", name: "Smoke test", slabs: [{ id: "s1", name: "x", w: 3200, h: 2000, thickness: 20, image: "/demo-slab.png" }], pieces: [], defects: [], kerf: 4, margin: 20 }) });
    const listRes = await fetch("/api/projects");
    const list = listRes.ok ? await listRes.json() : [];
    return {
      title: document.title,
      tabs: [...document.querySelectorAll("[data-slot=tabs-trigger]")].map((t) => t.textContent),
      pieceRows: document.querySelectorAll(".pieces-row:not(.pieces-header)").length,
      activationScreen: !!document.querySelector(".signin-card"),
      licence: await (await fetch("/api/desktop/licence")).json(),
      saveStatus: save.status,
      savedProjects: listRes.ok ? list.length : "locked (" + listRes.status + ")",
    };
  })()`);
  console.log("SMOKE " + JSON.stringify({ activation, ...report, dataDir: process.env.DATA_DIR, serverDir }));
  app.exit(0);
}

app.whenReady().then(async () => {
  buildMenu();
  try {
    await startServer();
    if (process.env.JEO_SMOKE_TEST === "1") return smokeTest();
    createWindow();
    // Quietly look for a newer release a few seconds after start.
    setTimeout(() => checkForUpdates(false), 5000);
  } catch (error) {
    dialog.showErrorBox(
      "Jeo Stone Studio could not start",
      `${error instanceof Error ? error.message : String(error)}\n\nServer folder: ${serverDir}`,
    );
    app.quit();
  }
});
