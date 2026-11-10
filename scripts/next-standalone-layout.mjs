// Mirror vinext's standalone build into the folder layout that Next.js hosts
// (such as Hostinger's Next.js preset) look for:
//
//   .next/standalone/server.js   self-contained Node server (run with node)
//   .next/static/                hashed client assets, served at /_next/static
//   .next/BUILD_ID
//
// vinext writes its standalone server to dist/standalone/. Its server.js
// resolves everything relative to its own folder, so a copy works as-is.
import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";

const source = "dist/standalone";
if (!existsSync(`${source}/server.js`)) {
  console.log("No standalone output; skipping .next layout.");
  process.exit(0);
}

rmSync(".next/standalone", { recursive: true, force: true });
rmSync(".next/static", { recursive: true, force: true });
mkdirSync(".next", { recursive: true });
cpSync(source, ".next/standalone", { recursive: true });
if (existsSync("dist/client/_next/static"))
  cpSync("dist/client/_next/static", ".next/static", { recursive: true });
if (existsSync("dist/server/BUILD_ID")) copyFileSync("dist/server/BUILD_ID", ".next/BUILD_ID");

console.log("  Copied standalone server to .next/standalone/server.js");
