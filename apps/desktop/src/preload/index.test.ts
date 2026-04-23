import assert from "node:assert/strict";
import { test } from "node:test";

import { exposeRemoteControlApi, resolvePreloadAppMode } from "./index.js";

test("resolvePreloadAppMode keeps supported desktop modes", () => {
  assert.equal(resolvePreloadAppMode("host"), "host");
  assert.equal(resolvePreloadAppMode("viewer"), "viewer");
  assert.equal(resolvePreloadAppMode("combined"), "combined");
});

test("exposeRemoteControlApi registers the renderer bridge API", () => {
  const exposures: Array<{ key: string; value: unknown }> = [];

  const api = exposeRemoteControlApi({
    appMode: "viewer",
    clipboard: {
      readHTML: () => "",
      readImage: () => ({
        isEmpty: () => true,
        toDataURL: () => ""
      }),
      readText: () => "",
      write: () => undefined,
      writeText: () => undefined
    },
    contextBridge: {
      exposeInMainWorld: (key, value) => {
        exposures.push({ key, value });
      }
    },
    ipcRenderer: {
      invoke: async () => undefined,
      on: () => undefined,
      off: () => undefined
    },
    nativeImage: {
      createFromDataURL: (dataUrl: string) => ({ dataUrl })
    }
  });

  assert.equal(exposures.length, 1);
  assert.equal(exposures[0]?.key, "remoteControl");
  assert.equal(exposures[0]?.value, api);
  assert.equal((api as { appMode: string; productName: string }).appMode, "viewer");
  assert.equal((api as { appMode: string; productName: string }).productName, "RemoteControl Client");
});
