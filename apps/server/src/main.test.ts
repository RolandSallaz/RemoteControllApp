import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bootstrapServer,
  defaultPort,
  findAvailablePort,
  getCorsOrigin,
  getRequestedPort,
  isPortAvailable
} from "./main.js";

test("getRequestedPort validates explicit and fallback values", () => {
  assert.equal(getRequestedPort("47315"), 47315);
  assert.equal(getRequestedPort("0"), defaultPort);
  assert.equal(getRequestedPort("65536"), defaultPort);
  assert.equal(getRequestedPort("not-a-number"), defaultPort);
  assert.equal(getRequestedPort(undefined, 5000), 5000);
});

test("getCorsOrigin trims configured origins and falls back to wildcard", () => {
  assert.equal(getCorsOrigin(undefined), true);
  assert.equal(getCorsOrigin(""), true);
  assert.deepEqual(getCorsOrigin(" https://a.example , https://b.example "), [
    "https://a.example",
    "https://b.example"
  ]);
  assert.equal(getCorsOrigin(" , "), true);
});

test("findAvailablePort and isPortAvailable probe sequentially", async () => {
  const attempted: number[] = [];
  const port = await findAvailablePort(6000, async (candidate) => {
    attempted.push(candidate);
    return candidate === 6002;
  }, 5);

  assert.equal(port, 6002);
  assert.deepEqual(attempted, [6000, 6001, 6002]);
  await assert.rejects(() => findAvailablePort(65000, async () => false, 2), /65000 to 65001/);

  assert.equal(await isPortAvailable(47315, () => ({
    once: (event, listener) => {
      if (event === "listening") {
        setImmediate(listener);
      }
    },
    close: (callback) => callback(),
    listen: () => undefined
  })), true);

  assert.equal(await isPortAvailable(47315, () => ({
    once: (event, listener) => {
      if (event === "error") {
        setImmediate(listener);
      }
    },
    close: () => undefined,
    listen: () => undefined
  })), false);
});

test("bootstrapServer configures Nest app with resolved port and CORS", async () => {
  const calls: string[] = [];
  const enabledCors: Array<{ credentials: true; origin: true | string[] }> = [];
  const listenedPorts: number[] = [];
  let envPort: number | undefined;

  const port = await bootstrapServer({
    requestedPort: 48000,
    corsOrigin: ["https://viewer.example"],
    findAvailablePortFn: async (requestedPort) => {
      calls.push(`find:${requestedPort}`);
      return 48002;
    },
    createApp: async (corsOptions) => {
      calls.push(`create:${Array.isArray(corsOptions.origin) ? corsOptions.origin.join(",") : corsOptions.origin}`);
      return {
        enableCors: (options) => {
          enabledCors.push(options);
        },
        listen: async (nextPort) => {
          listenedPorts.push(nextPort);
        }
      };
    },
    setPortEnv: (nextPort) => {
      envPort = nextPort;
    },
    log: (message) => {
      calls.push(`log:${message}`);
    }
  });

  assert.equal(port, 48002);
  assert.equal(envPort, 48002);
  assert.deepEqual(enabledCors, [{
    origin: ["https://viewer.example"],
    credentials: true
  }]);
  assert.deepEqual(listenedPorts, [48002]);
  assert.deepEqual(calls, [
    "find:48000",
    "create:https://viewer.example",
    "log:RemoteControl signaling server listening on http://localhost:48002"
  ]);
});
