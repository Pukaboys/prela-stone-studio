// Prela Stone Studio — desktop shell (Electron main process).
//
// The desktop app runs the same Node.js server as the website (vinext
// standalone build), privately on 127.0.0.1, and shows it in a window.
// Projects and slab photos are stored on this computer in
//   Windows: %APPDATA%\Prela Stone Studio\data
//   macOS:   ~/Library/Application Support/Prela Stone Studio/data
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
if (process.env.PRELA_SMOKE_TEST === "1")
  app.setPath("userData", path.join(require("node:os").tmpdir(), `prela-smoke-${Date.now()}`));

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let baseUrl = "";

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
    title: "Prela Stone Studio",
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

  mainWindow.loadURL(baseUrl + "/");
  mainWindow.on("closed", () => (mainWindow = null));
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
 * `PRELA_SMOKE_TEST=1`: start the server, load the studio in a hidden window,
 * print what rendered and whether saving works, then quit. Used to verify a
 * build without opening a window.
 */
async function smokeTest() {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL(baseUrl + "/");
  await new Promise((r) => setTimeout(r, 2500));
  const report = await win.webContents.executeJavaScript(`(async () => {
    const save = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "", name: "Smoke test", slabs: [{ id: "s1", name: "x", w: 3200, h: 2000, thickness: 20, image: "/demo-slab.png" }], pieces: [], defects: [], kerf: 4, margin: 20 }) });
    const list = await (await fetch("/api/projects")).json();
    return {
      title: document.title,
      tabs: [...document.querySelectorAll("[data-slot=tabs-trigger]")].map((t) => t.textContent),
      pieceRows: document.querySelectorAll(".pieces-row:not(.pieces-header)").length,
      saveStatus: save.status,
      savedProjects: list.length,
    };
  })()`);
  console.log("SMOKE " + JSON.stringify({ ...report, dataDir: process.env.DATA_DIR, serverDir }));
  app.exit(0);
}

app.whenReady().then(async () => {
  buildMenu();
  try {
    await startServer();
    if (process.env.PRELA_SMOKE_TEST === "1") return smokeTest();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "Prela Stone Studio could not start",
      `${error instanceof Error ? error.message : String(error)}\n\nServer folder: ${serverDir}`,
    );
    app.quit();
  }
});
