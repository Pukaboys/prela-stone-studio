// Make dist/standalone truly self-contained.
//
// vinext's standalone output copies vinext's own dependencies but not the
// packages it expects the host project to provide (React and friends). On a
// host that runs inside the project folder (Hostinger), Node finds them in
// the project's node_modules; in the desktop app the server runs from its own
// folder and fails with "Cannot find package 'react'".
//
// This copies each runtime package — and everything it depends on — from the
// project's node_modules (pnpm layout, symlinks resolved) into
// dist/standalone/node_modules.
import { cpSync, existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "dist", "standalone", "node_modules");
// Packages the vinext production server imports at runtime.
const RUNTIME = ["react", "react-dom", "react-server-dom-webpack", "@vitejs/plugin-rsc"];

if (!existsSync(TARGET)) {
  console.log("No standalone output; skipping.");
  process.exit(0);
}

/** Find `name` the way Node would, starting from `fromDir` and walking up. */
function locate(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    // Inside pnpm's store a package's dependencies are its siblings.
    const sibling = path.join(dir, name);
    if (path.basename(path.dirname(sibling)) === "node_modules" && existsSync(path.join(sibling, "package.json")))
      return realpathSync(sibling);
    if (path.dirname(dir) === dir) return null;
  }
}

const copied = [];
const seen = new Set();
function include(name, fromDir, optional = false) {
  if (seen.has(name)) return;
  seen.add(name);
  const source = locate(name, fromDir);
  if (!source) {
    if (!optional) throw new Error(`Cannot find runtime package "${name}" (needed by the standalone server).`);
    return;
  }
  const pkg = JSON.parse(readFileSync(path.join(source, "package.json"), "utf8"));
  const dest = path.join(TARGET, name);
  if (!existsSync(dest)) {
    cpSync(source, dest, { recursive: true, dereference: true });
    copied.push(`${name}@${pkg.version}`);
  }
  // pnpm keeps a package's dependencies next to it: <store>/<pkg>/node_modules/<dep>
  const storeDir = name.startsWith("@") ? path.dirname(path.dirname(source)) : path.dirname(source);
  for (const dep of Object.keys(pkg.dependencies ?? {})) include(dep, storeDir);
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) include(dep, storeDir, true);
}

for (const name of RUNTIME) include(name, ROOT);
console.log(
  copied.length
    ? `  Added ${copied.length} runtime packages to dist/standalone: ${copied.join(", ")}`
    : "  Standalone server already has all runtime packages.",
);
