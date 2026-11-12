// Launch the desktop app from the latest build (`pnpm desktop`).
// Downloads the Electron binary on first use (normal installs skip it), and
// clears ELECTRON_RUN_AS_NODE, which VS Code sets for its terminals and which
// would make Electron behave like plain Node.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const install = spawnSync(process.execPath, [require.resolve("electron/install.js")], { stdio: "inherit" });
if (install.status !== 0) process.exit(install.status ?? 1);

const electron = require("electron"); // path to the Electron executable
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL("./app", import.meta.url))], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
