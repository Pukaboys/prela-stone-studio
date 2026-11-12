// Set the desktop app version (used by the release workflow: tag v1.2.3 → 1.2.3).
import { readFileSync, writeFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Expected a version like 1.2.3, got "${process.argv[2] ?? ""}".`);
  process.exit(1);
}
const file = "desktop/app/package.json";
const pkg = JSON.parse(readFileSync(file, "utf8"));
pkg.version = version;
writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log(`Desktop app version ${version}`);
