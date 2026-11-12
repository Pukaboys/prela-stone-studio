// electron-builder afterPack hook.
// electron-builder never copies folders named node_modules through
// extraResources, but the standalone server needs its own node_modules.
// Copy it into <resources>/server/node_modules after the app is packed.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const source = path.join(packager.projectDir, "dist", "standalone", "node_modules");
  const target = path.join(resources, "server", "node_modules");
  if (!fs.existsSync(source)) throw new Error(`Missing ${source}. Run "pnpm run build" first.`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true, dereference: true });
  console.log(`  • copied server node_modules  to=${path.relative(packager.projectDir, target)}`);
};
