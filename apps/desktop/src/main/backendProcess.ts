import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, renameSync, statSync, unlinkSync, type WriteStream } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);

export type EmbeddedBackendStatus = {
  status: "disabled" | "starting" | "running" | "stopped" | "error";
  port?: number;
  url?: string;
  error?: string;
};

type AppLike = {
  getAppPath: () => string;
  getPath: (name: "userData") => string;
};

type BackendPipeSourceLike = {
  pipe: (destination: BackendLogStreamLike, options?: { end?: boolean }) => unknown;
};

type BackendLogStreamLike = Pick<WriteStream, "end">;

type BackendChildProcessLike = {
  stdout?: BackendPipeSourceLike | null;
  stderr?: BackendPipeSourceLike | null;
  once(event: "spawn", listener: () => void): void;
  once(event: "error", listener: (error: Error) => void): void;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(): boolean;
};

type PortProbeServerLike = {
  once(event: "error", listener: () => void): void;
  once(event: "listening", listener: () => void): void;
  close: (callback: () => void) => void;
  listen: (port: number, host: string) => void;
};

type BackendSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: ["ignore", "pipe", "pipe"];
  windowsHide: boolean;
};

type LogRotationDependencies = {
  existsSync: (path: string) => boolean;
  renameSync: (oldPath: string, newPath: string) => void;
  statSync: (path: string) => { size: number };
  unlinkSync: (path: string) => void;
};

type BackendProcessDependencies = {
  app: AppLike;
  createServer: () => PortProbeServerLike;
  createWriteStream: (path: string, options: { flags: "a" }) => BackendLogStreamLike;
  existsSync: LogRotationDependencies["existsSync"];
  nodeBinary: string;
  processEnv: NodeJS.ProcessEnv;
  processExecPath: string;
  processResourcesPath: string;
  randomBytes: typeof randomBytes;
  renameSync: LogRotationDependencies["renameSync"];
  spawn: (command: string, args: string[], options: BackendSpawnOptions) => BackendChildProcessLike;
  statSync: LogRotationDependencies["statSync"];
  unlinkSync: LogRotationDependencies["unlinkSync"];
  warn: (message: string) => void;
};

type EmbeddedBackendController = {
  getEmbeddedBackendSettingsToken: () => string | undefined;
  getEmbeddedBackendStatus: () => EmbeddedBackendStatus;
  startEmbeddedBackend: (options: {
    appMode: "combined" | "host" | "viewer";
    isDev: boolean;
  }) => Promise<EmbeddedBackendStatus>;
  stopEmbeddedBackend: () => void;
};

const backendLogMaxBytes = 5 * 1024 * 1024;
const backendLogBackups = 3;

export function createEmbeddedBackendController(dependencies: BackendProcessDependencies): EmbeddedBackendController {
  let backendProcess: BackendChildProcessLike | undefined;
  let backendStatus: EmbeddedBackendStatus = { status: "disabled" };
  let backendLogStream: BackendLogStreamLike | undefined;
  let backendSettingsToken: string | undefined;

  async function startEmbeddedBackend(options: {
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

    const port = await findAvailablePort(
      Number(dependencies.processEnv.REMOTE_CONTROL_BACKEND_PORT ?? 47315),
      (candidatePort) => isPortAvailable(candidatePort, dependencies.createServer)
    );
    const url = `http://localhost:${port}`;
    backendSettingsToken = dependencies.randomBytes(32).toString("base64url");
    backendStatus = { status: "starting", port, url };

    const spawnConfig = options.isDev
      ? getDevBackendSpawnConfig(dependencies.app.getAppPath(), dependencies.nodeBinary)
      : getPackagedBackendSpawnConfig(
        dependencies.app.getAppPath(),
        dependencies.processExecPath,
        dependencies.processResourcesPath
      );
    const env = buildEmbeddedBackendEnv({
      port,
      processEnv: dependencies.processEnv,
      serverName: dependencies.processEnv.REMOTE_CONTROL_SERVER_NAME ?? "RemoteControl Server",
      settingsToken: backendSettingsToken,
      userDataPath: dependencies.app.getPath("userData")
    });

    backendProcess = dependencies.spawn(spawnConfig.command, spawnConfig.args, {
      cwd: spawnConfig.cwd,
      env: {
        ...env,
        ...spawnConfig.env
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    backendLogStream = openBackendLogStream(dependencies.app.getPath("userData"), dependencies);
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
        error: formatEmbeddedBackendExitError(code, signal)
      };
      closeBackendLogStream();
      backendProcess = undefined;
      backendSettingsToken = undefined;
    });

    return backendStatus;
  }

  function getEmbeddedBackendStatus(): EmbeddedBackendStatus {
    return backendStatus;
  }

  function getEmbeddedBackendSettingsToken(): string | undefined {
    return backendSettingsToken;
  }

  function stopEmbeddedBackend(): void {
    if (!backendProcess) {
      return;
    }

    backendProcess.kill();
    backendProcess = undefined;
    backendSettingsToken = undefined;
    closeBackendLogStream();
    backendStatus = { ...backendStatus, status: "stopped" };
  }

  function closeBackendLogStream(): void {
    backendLogStream?.end();
    backendLogStream = undefined;
  }

  return {
    getEmbeddedBackendSettingsToken,
    getEmbeddedBackendStatus,
    startEmbeddedBackend,
    stopEmbeddedBackend
  };
}

export function buildEmbeddedBackendEnv(options: {
  port: number;
  processEnv: NodeJS.ProcessEnv;
  serverName: string;
  settingsToken: string;
  userDataPath: string;
}): NodeJS.ProcessEnv {
  return {
    ...options.processEnv,
    PORT: String(options.port),
    CORS_ORIGIN: options.processEnv.CORS_ORIGIN ?? "*",
    DISCOVERY_ENABLED: "true",
    REMOTE_CONTROL_SETTINGS_TOKEN: options.settingsToken,
    REMOTE_CONTROL_SERVER_NAME: options.serverName,
    REMOTE_CONTROL_SETTINGS_PATH: join(options.userDataPath, "host-settings.json")
  };
}

export function openBackendLogStream(
  userDataPath: string,
  dependencies: Pick<
    BackendProcessDependencies,
    "createWriteStream" | "existsSync" | "renameSync" | "statSync" | "unlinkSync" | "warn"
  >
): BackendLogStreamLike {
  const logPath = join(userDataPath, "backend.log");
  rotateBackendLog(logPath, dependencies, dependencies.warn);
  return dependencies.createWriteStream(logPath, { flags: "a" });
}

export function rotateBackendLog(
  logPath: string,
  dependencies: LogRotationDependencies,
  warn: (message: string) => void = (message) => console.warn(message),
  maxBytes = backendLogMaxBytes,
  backups = backendLogBackups
): void {
  try {
    if (!dependencies.existsSync(logPath) || dependencies.statSync(logPath).size < maxBytes) {
      return;
    }

    const oldestLogPath = `${logPath}.${backups}`;
    if (dependencies.existsSync(oldestLogPath)) {
      dependencies.unlinkSync(oldestLogPath);
    }

    for (let index = backups - 1; index >= 1; index -= 1) {
      const currentPath = `${logPath}.${index}`;
      if (dependencies.existsSync(currentPath)) {
        dependencies.renameSync(currentPath, `${logPath}.${index + 1}`);
      }
    }

    dependencies.renameSync(logPath, `${logPath}.1`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warn(`Failed to rotate backend log: ${reason}`);
  }
}

export function getDevBackendSpawnConfig(appPath: string, nodeBinary = process.env.NODE_BINARY ?? "node"): {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
} {
  const workspaceRoot = resolve(appPath, "../..");
  return {
    command: nodeBinary,
    args: [join(workspaceRoot, "apps/server/dist/main.js")],
    cwd: workspaceRoot
  };
}

export function getPackagedBackendSpawnConfig(
  appPath: string,
  processExecPath = process.execPath,
  processResourcesPath = process.resourcesPath
): {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
} {
  return {
    command: processExecPath,
    args: [join(appPath, "backend/main.js")],
    cwd: processResourcesPath,
    env: {
      ELECTRON_RUN_AS_NODE: "1"
    }
  };
}

export async function findAvailablePort(
  startPort: number,
  isPortAvailableFn: (port: number) => Promise<boolean> = isPortAvailable,
  searchSpan = 20
): Promise<number> {
  for (let port = startPort; port < startPort + searchSpan; port += 1) {
    if (await isPortAvailableFn(port)) {
      return port;
    }
  }

  throw new Error(`No available backend port found from ${startPort} to ${startPort + searchSpan - 1}`);
}

export function formatEmbeddedBackendExitError(
  code: number | null,
  signal: NodeJS.Signals | null
): string | undefined {
  return code === 0 || code === null ? undefined : `Exited with code ${code}${signal ? ` (${signal})` : ""}`;
}

export function isPortAvailable(
  port: number,
  createNetServer: () => PortProbeServerLike = createServer
): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createNetServer();

    server.once("error", () => {
      resolvePort(false);
    });

    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });

    server.listen(port, "0.0.0.0");
  });
}

let defaultEmbeddedBackendController: EmbeddedBackendController | undefined;

function getDefaultEmbeddedBackendController(): EmbeddedBackendController {
  defaultEmbeddedBackendController ??= createEmbeddedBackendController(createDefaultBackendProcessDependencies());
  return defaultEmbeddedBackendController;
}

function createDefaultBackendProcessDependencies(): BackendProcessDependencies {
  const { app } = require("electron") as typeof import("electron");

  return {
    app,
    createServer,
    createWriteStream,
    existsSync,
    nodeBinary: process.env.NODE_BINARY ?? "node",
    processEnv: process.env,
    processExecPath: process.execPath,
    processResourcesPath: process.resourcesPath,
    randomBytes,
    renameSync,
    spawn: (command, args, options) => spawn(command, args, options) as unknown as BackendChildProcessLike,
    statSync,
    unlinkSync,
    warn: (message) => console.warn(message)
  };
}

export async function startEmbeddedBackend(options: {
  appMode: "combined" | "host" | "viewer";
  isDev: boolean;
}): Promise<EmbeddedBackendStatus> {
  return await getDefaultEmbeddedBackendController().startEmbeddedBackend(options);
}

export function getEmbeddedBackendStatus(): EmbeddedBackendStatus {
  return getDefaultEmbeddedBackendController().getEmbeddedBackendStatus();
}

export function getEmbeddedBackendSettingsToken(): string | undefined {
  return getDefaultEmbeddedBackendController().getEmbeddedBackendSettingsToken();
}

export function stopEmbeddedBackend(): void {
  getDefaultEmbeddedBackendController().stopEmbeddedBackend();
}
