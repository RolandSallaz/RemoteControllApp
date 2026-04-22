import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "../../..");
const command = process.argv[2] ?? "dev";
const appMode = process.argv[3];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

if (appMode) {
  env.REMOTE_CONTROL_APP_MODE = appMode;
}

const electronViteCli = resolve(workspaceRoot, "node_modules/electron-vite/bin/electron-vite.js");
const child = spawn(process.execPath, [electronViteCli, command], {
  cwd: resolve(scriptDir, ".."),
  env,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
