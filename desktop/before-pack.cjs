// electron-builder beforePack hook: seal the studio server.
//
// The server (dist/standalone, with its node_modules) is packed into one
// archive, resources/server.asar, and its SHA-256 is written into the app
// (desktop/app/server-integrity.json). That file ends up inside app.asar,
// which Electron itself checks at start (asar integrity fuse), and main.cjs
// refuses to start a server.asar whose hash differs. So changing any server
// file (for example to skip the licence check) stops the app from starting.
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");

exports.default = async function beforePack(context) {
  const root = context.packager.projectDir;
  const source = path.join(root, "dist", "standalone");
  if (!fs.existsSync(path.join(source, "server.js"))) throw new Error(`Missing ${source}. Run "pnpm run build" first.`);

  // Copy with links resolved (pnpm links packages; an archive cannot point outside itself).
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "jeo-server-"));
  try {
    fs.cpSync(source, staging, { recursive: true, dereference: true });
    const outDir = path.join(root, "desktop", ".pack", "resources");
    fs.mkdirSync(outDir, { recursive: true });
    const archive = path.join(outDir, "server.asar");
    fs.rmSync(archive, { force: true });
    await asar.createPackageWithOptions(staging, archive, {});
    const sha256 = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    fs.writeFileSync(path.join(root, "desktop", "app", "server-integrity.json"), JSON.stringify({ sha256 }) + "\n");
    console.log(`  • sealed server  file=${path.relative(root, archive)} size=${(fs.statSync(archive).size / 1048576).toFixed(0)}MB sha256=${sha256.slice(0, 12)}…`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
};
