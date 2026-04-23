import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEmbeddedBackendEnv,
  createEmbeddedBackendController,
  findAvailablePort,
  formatEmbeddedBackendExitError,
  getDevBackendSpawnConfig,
  getPackagedBackendSpawnConfig,
  isPortAvailable,
  rotateBackendLog
} from "./backendProcess.js";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function createChildProcessDouble() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pipes: string[] = [];
  let killed = 0;

  const process = {
    stdout: {
      pipe: (_destination: unknown, options?: { end?: boolean }) => {
        pipes.push(`stdout:${String(options?.end)}`);
      }
    },
    stderr: {
      pipe: (_destination: unknown, options?: { end?: boolean }) => {
        pipes.push(`stderr:${String(options?.end)}`);
      }
    },
    once: (event: string, listener: (...args: unknown[]) => unknown) => {
      handlers.set(event, listener);
    },
    kill: () => {
      killed += 1;
      return true;
    }
  };

  return {
    emitError: (error: Error) => {
      handlers.get("error")?.(error);
    },
    emitExit: (code: number | null, signal: NodeJS.Signals | null) => {
      handlers.get("exit")?.(code, signal);
    },
    emitSpawn: () => {
      handlers.get("spawn")?.();
    },
    getKilled: () => killed,
    pipes,
    process
  };
}

test("buildEmbeddedBackendEnv applies defaults and settings file path", () => {
  const env = buildEmbeddedBackendEnv({
    port: 47315,
    processEnv: {},
    serverName: "Office Host",
    settingsToken: "token-123",
    userDataPath: "C:/Users/Me/AppData"
  });

  assert.deepEqual({
    ...env,
    REMOTE_CONTROL_SETTINGS_PATH: normalizePath(env.REMOTE_CONTROL_SETTINGS_PATH ?? "")
  }, {
    PORT: "47315",
    CORS_ORIGIN: "*",
    DISCOVERY_ENABLED: "true",
    REMOTE_CONTROL_SETTINGS_TOKEN: "token-123",
    REMOTE_CONTROL_SERVER_NAME: "Office Host",
    REMOTE_CONTROL_SETTINGS_PATH: "C:/Users/Me/AppData/host-settings.json"
  });
});

test("spawn config helpers resolve dev and packaged backend entry points", () => {
  assert.deepEqual(
    {
      ...getDevBackendSpawnConfig("C:/repo/apps/desktop", "custom-node"),
      args: getDevBackendSpawnConfig("C:/repo/apps/desktop", "custom-node").args.map(normalizePath),
      cwd: normalizePath(getDevBackendSpawnConfig("C:/repo/apps/desktop", "custom-node").cwd)
    },
    {
      command: "custom-node",
      args: ["C:/repo/apps/server/dist/main.js"],
      cwd: "C:/repo"
    }
  );

  assert.deepEqual(
    {
      ...getPackagedBackendSpawnConfig("C:/app/resources/app", "C:/RemoteControl.exe", "C:/app/resources"),
      args: getPackagedBackendSpawnConfig("C:/app/resources/app", "C:/RemoteControl.exe", "C:/app/resources")
        .args
        .map(normalizePath),
      cwd: normalizePath(getPackagedBackendSpawnConfig("C:/app/resources/app", "C:/RemoteControl.exe", "C:/app/resources").cwd)
    },
    {
      command: "C:/RemoteControl.exe",
      args: ["C:/app/resources/app/backend/main.js"],
      cwd: "C:/app/resources",
      env: {
        ELECTRON_RUN_AS_NODE: "1"
      }
    }
  );
});

test("rotateBackendLog rotates backups and warns on failure", () => {
  const operations: string[] = [];
  const warnings: string[] = [];
  const existing = new Set([
    "C:/logs/backend.log",
    "C:/logs/backend.log.1",
    "C:/logs/backend.log.2",
    "C:/logs/backend.log.3"
  ]);

  rotateBackendLog("C:/logs/backend.log", {
    existsSync: (path) => existing.has(path),
    renameSync: (from, to) => {
      operations.push(`rename:${normalizePath(from)}=>${normalizePath(to)}`);
    },
    statSync: () => ({ size: 99 }),
    unlinkSync: (path) => {
      operations.push(`unlink:${normalizePath(path)}`);
    }
  }, (message) => warnings.push(message), 10, 4);

  assert.deepEqual(operations, [
    "rename:C:/logs/backend.log.3=>C:/logs/backend.log.4",
    "rename:C:/logs/backend.log.2=>C:/logs/backend.log.3",
    "rename:C:/logs/backend.log.1=>C:/logs/backend.log.2",
    "rename:C:/logs/backend.log=>C:/logs/backend.log.1"
  ]);
  assert.deepEqual(warnings, []);

  rotateBackendLog("C:/logs/backend.log", {
    existsSync: () => true,
    renameSync: () => {
      throw new Error("access denied");
    },
    statSync: () => ({ size: 99 }),
    unlinkSync: () => undefined
  }, (message) => warnings.push(message), 10, 2);

  assert.equal(warnings.at(-1), "Failed to rotate backend log: access denied");
});

test("findAvailablePort and isPortAvailable probe candidate ports", async () => {
  const seenPorts: number[] = [];
  const port = await findAvailablePort(5000, async (candidate) => {
    seenPorts.push(candidate);
    return candidate === 5002;
  }, 5);

  assert.equal(port, 5002);
  assert.deepEqual(seenPorts, [5000, 5001, 5002]);
  await assert.rejects(() => findAvailablePort(7000, async () => false, 2), /7000 to 7001/);

  assert.equal(await isPortAvailable(47315, () => ({
    once: (event, listener) => {
      if (event === "listening") {
        setImmediate(listener);
      }
    },
    close: (callback) => callback(),
    listen: () => undefined
  })), true);

  assert.equal(await isPortAvailable(47316, () => ({
    once: (event, listener) => {
      if (event === "error") {
        setImmediate(listener);
      }
    },
    close: () => undefined,
    listen: () => undefined
  })), false);
});

test("embedded backend controller skips non-host mode and manages process lifecycle", async () => {
  const child = createChildProcessDouble();
  const createdLogs: string[] = [];
  const warnings: string[] = [];
  let logEnds = 0;
  let spawnCount = 0;
  const spawned: Array<{ command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }> = [];

  const controller = createEmbeddedBackendController({
    app: {
      getAppPath: () => "C:/repo/apps/desktop",
      getPath: () => "C:/Users/Me/AppData/RemoteControl"
    },
    createServer: () => ({
      once: (event, listener) => {
        if (event === "listening") {
          setImmediate(listener);
        }
      },
      close: (callback) => callback(),
      listen: () => undefined
    }),
    createWriteStream: (path) => {
      createdLogs.push(normalizePath(path));
      return {
        end: () => {
          logEnds += 1;
        }
      };
    },
    existsSync: () => false,
    nodeBinary: "custom-node",
    processEnv: {
      REMOTE_CONTROL_BACKEND_PORT: "49000",
      REMOTE_CONTROL_SERVER_NAME: "Office Host"
    },
    processExecPath: "C:/RemoteControl.exe",
    processResourcesPath: "C:/app/resources",
    randomBytes: () => Buffer.from("secret-token"),
    renameSync: () => undefined,
    spawn: (command, args, options) => {
      spawnCount += 1;
      spawned.push({
        command,
        args: args.map(normalizePath),
        cwd: normalizePath(options.cwd),
        env: options.env
      });
      return child.process;
    },
    statSync: () => ({ size: 0 }),
    unlinkSync: () => undefined,
    warn: (message) => warnings.push(message)
  });

  assert.deepEqual(await controller.startEmbeddedBackend({
    appMode: "viewer",
    isDev: true
  }), { status: "disabled" });
  assert.equal(spawnCount, 0);

  const startResult = await controller.startEmbeddedBackend({
    appMode: "host",
    isDev: true
  });

  assert.deepEqual(startResult, {
    status: "starting",
    port: 49000,
    url: "http://localhost:49000"
  });
  assert.equal(spawnCount, 1);
  assert.equal(controller.getEmbeddedBackendSettingsToken(), Buffer.from("secret-token").toString("base64url"));
  assert.deepEqual(spawned.map((entry) => ({
    ...entry,
    env: {
      ...entry.env,
      REMOTE_CONTROL_SETTINGS_PATH: normalizePath(entry.env.REMOTE_CONTROL_SETTINGS_PATH ?? "")
    }
  })), [{
    command: "custom-node",
    args: ["C:/repo/apps/server/dist/main.js"],
    cwd: "C:/repo",
    env: {
      REMOTE_CONTROL_BACKEND_PORT: "49000",
      REMOTE_CONTROL_SERVER_NAME: "Office Host",
      PORT: "49000",
      CORS_ORIGIN: "*",
      DISCOVERY_ENABLED: "true",
      REMOTE_CONTROL_SETTINGS_TOKEN: Buffer.from("secret-token").toString("base64url"),
      REMOTE_CONTROL_SETTINGS_PATH: "C:/Users/Me/AppData/RemoteControl/host-settings.json"
    }
  }]);
  assert.deepEqual(createdLogs, ["C:/Users/Me/AppData/RemoteControl/backend.log"]);
  assert.deepEqual(child.pipes, ["stdout:false", "stderr:false"]);
  assert.deepEqual(warnings, []);

  assert.deepEqual(await controller.startEmbeddedBackend({
    appMode: "host",
    isDev: true
  }), startResult);
  assert.equal(spawnCount, 1);

  child.emitSpawn();
  assert.deepEqual(controller.getEmbeddedBackendStatus(), {
    status: "running",
    port: 49000,
    url: "http://localhost:49000"
  });

  controller.stopEmbeddedBackend();
  assert.equal(child.getKilled(), 1);
  assert.equal(logEnds, 1);
  assert.equal(controller.getEmbeddedBackendSettingsToken(), undefined);
  assert.deepEqual(controller.getEmbeddedBackendStatus(), {
    status: "stopped",
    port: 49000,
    url: "http://localhost:49000"
  });
});

test("embedded backend controller tracks child error and exit transitions", async () => {
  const firstChild = createChildProcessDouble();
  const secondChild = createChildProcessDouble();
  let spawnCount = 0;
  let logEnds = 0;

  const controller = createEmbeddedBackendController({
    app: {
      getAppPath: () => "C:/repo/apps/desktop",
      getPath: () => "C:/Users/Me/AppData/RemoteControl"
    },
    createServer: () => ({
      once: (event, listener) => {
        if (event === "listening") {
          setImmediate(listener);
        }
      },
      close: (callback) => callback(),
      listen: () => undefined
    }),
    createWriteStream: () => ({
      end: () => {
        logEnds += 1;
      }
    }),
    existsSync: () => false,
    nodeBinary: "node",
    processEnv: {},
    processExecPath: "C:/RemoteControl.exe",
    processResourcesPath: "C:/app/resources",
    randomBytes: () => Buffer.from("another-secret"),
    renameSync: () => undefined,
    spawn: () => {
      spawnCount += 1;
      return spawnCount === 1 ? firstChild.process : secondChild.process;
    },
    statSync: () => ({ size: 0 }),
    unlinkSync: () => undefined,
    warn: () => undefined
  });

  await controller.startEmbeddedBackend({ appMode: "host", isDev: false });
  firstChild.emitError(new Error("spawn failed"));
  assert.deepEqual(controller.getEmbeddedBackendStatus(), {
    status: "error",
    port: 47315,
    url: "http://localhost:47315",
    error: "spawn failed"
  });
  assert.equal(logEnds, 1);
  assert.equal(controller.getEmbeddedBackendSettingsToken(), undefined);

  await controller.startEmbeddedBackend({ appMode: "host", isDev: false });
  secondChild.emitExit(12, "SIGTERM");
  assert.deepEqual(controller.getEmbeddedBackendStatus(), {
    status: "stopped",
    port: 47315,
    url: "http://localhost:47315",
    error: "Exited with code 12 (SIGTERM)"
  });
  assert.equal(logEnds, 2);
  assert.equal(controller.getEmbeddedBackendSettingsToken(), undefined);

  assert.equal(formatEmbeddedBackendExitError(0, null), undefined);
  assert.equal(formatEmbeddedBackendExitError(null, "SIGTERM"), undefined);
  assert.equal(formatEmbeddedBackendExitError(7, null), "Exited with code 7");
});
