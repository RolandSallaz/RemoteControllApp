import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, renameSync, statSync, unlinkSync, type WriteStream } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import { app } from "electron";

export type EmbeddedBackendStatus = {
  status: "disabled" | "starting" | "running" | "stopped" | "error";
  port?: number;
  url?: string;
  error?: string;
};

let backendProcess: ChildProcess | undefined;
let backendStatus: EmbeddedBackendStatus = { status: "disabled" };
let backendLogStream: WriteStream | undefined;
let backendSettingsToken: string | undefined;
const backendLogMaxBytes = 5 * 1024 * 1024;
const backendLogBackups = 3;

export async function startEmbeddedBackend(options: {
  appMode: "combined" | "host" | "viewer";
  isDev: boolean;
}): Promise<EmbeddedBackendStatus> {
  if (options.appMode !== "host") {
    backendStatus = { status: "disabled" };
    return backendStatus;
  }

  if (backendProcess) {
    return backendStatus;
  }

  const port = await findAvailablePort(Number(process.env.REMOTE_CONTROL_BACKEND_PORT ?? 47315));
  const url = `http://localhost:${port}`;
  backendSettingsToken = randomBytes(32).toString("base64url");
  backendStatus = { status: "starting", port, url };

  const env = {
    ...process.env,
    PORT: String(port),
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
    DISCOVERY_ENABLED: "true",
    REMOTE_CONTROL_SETTINGS_TOKEN: backendSettingsToken,
    REMOTE_CONTROL_SERVER_NAME: process.env.REMOTE_CONTROL_SERVER_NAME ?? "RemoteControl Server",
    REMOTE_CONTROL_SETTINGS_PATH: join(app.getPath("userData"), "host-settings.json")
  };

  const spawnConfig = options.isDev ? getDevBackendSpawnConfig() : getPackagedBackendSpawnConfig();

  backendProcess = spawn(spawnConfig.command, spawnConfig.args, {
    cwd: spawnConfig.cwd,
    env: {
      ...env,
      ...spawnConfig.env
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  backendLogStream = openBackendLogStream();
  backendProcess.stdout?.pipe(backendLogStream, { end: false });
  backendProcess.stderr?.pipe(backendLogStream, { end: false });

  backendProcess.once("spawn", () => {
    backendStatus = { status: "running", port, url };
  });

  backendProcess.once("error", (error) => {
    backendStatus = { status: "error", port, url, error: error.message };
    closeBackendLogStream();
    backendProcess = undefined;
    backendSettingsToken = undefined;
  });

  backendProcess.once("exit", (code, signal) => {
    backendStatus = {
      status: "stopped",
      port,
      url,
      error: code === 0 || code === null ? undefined : `Exited with code ${code}${signal ? ` (${signal})` : ""}`
    };
    closeBackendLogStream();
    backendProcess = undefined;
    backendSettingsToken = undefined;
  });

  return backendStatus;
}

export function getEmbeddedBackendStatus(): EmbeddedBackendStatus {
  return backendStatus;
}

export function getEmbeddedBackendSettingsToken(): string | undefined {
  return backendSettingsToken;
}

export function stopEmbeddedBackend(): void {
  if (!backendProcess) {
    return;
  }

  backendProcess.kill();
  backendProcess = undefined;
  backendSettingsToken = undefined;
  closeBackendLogStream();
  backendStatus = { ...backendStatus, status: "stopped" };
}

function openBackendLogStream(): WriteStream {
  const logPath = join(app.getPath("userData"), "backend.log");
  rotateBackendLog(logPath);
  return createWriteStream(logPath, { flags: "a" });
}

function closeBackendLogStream(): void {
  backendLogStream?.end();
  backendLogStream = undefined;
}

function rotateBackendLog(logPath: string): void {
  try {
    if (!existsSync(logPath) || statSync(logPath).size < backendLogMaxBytes) {
      return;
    }

    const oldestLogPath = `${logPath}.${backendLogBackups}`;
    if (existsSync(oldestLogPath)) {
      unlinkSync(oldestLogPath);
    }

    for (let index = backendLogBackups - 1; index >= 1; index -= 1) {
      const currentPath = `${logPath}.${index}`;
      if (existsSync(currentPath)) {
        renameSync(currentPath, `${logPath}.${index + 1}`);
      }
    }

    renameSync(logPath, `${logPath}.1`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to rotate backend log: ${reason}`);
  }
}

function getDevBackendSpawnConfig(): {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
} {
  const workspaceRoot = resolve(app.getAppPath(), "../..");
  return {
    command: process.env.NODE_BINARY ?? "node",
    args: [join(workspaceRoot, "apps/server/dist/main.js")],
    cwd: workspaceRoot
  };
}

function getPackagedBackendSpawnConfig(): {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
} {
  return {
    command: process.execPath,
    args: [join(app.getAppPath(), "backend/main.js")],
    cwd: process.resourcesPath,
    env: {
      ELECTRON_RUN_AS_NODE: "1"
    }
  };
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 20; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available backend port found from ${startPort} to ${startPort + 19}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();

    server.once("error", () => {
      resolvePort(false);
    });

    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });

    server.listen(port, "0.0.0.0");
  });
}
