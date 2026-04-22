import assert from "node:assert/strict";
import { test } from "node:test";

import { registerWindowIpcHandlers } from "./windowIpc.js";

test("registerWindowIpcHandlers toggles fullscreen and opens settings", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const window = {
    fullScreen: false,
    isFullScreen() {
      return this.fullScreen;
    },
    setFullScreen(state: boolean) {
      this.fullScreen = state;
    }
  };

  let openSettingsCalls = 0;

  registerWindowIpcHandlers({
    ipcMain: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    },
    BrowserWindow: {
      getFocusedWindow: () => window
    },
    getMainWindow: () => undefined,
    openHostSettingsWindow: () => {
      openSettingsCalls += 1;
    }
  });

  assert.deepEqual(await handlers.get("window:get-fullscreen")?.(), { isFullScreen: false });
  assert.deepEqual(await handlers.get("window:toggle-fullscreen")?.(), { ok: true, isFullScreen: true });
  assert.equal(window.fullScreen, true);

  await handlers.get("window:open-host-settings")?.();
  assert.equal(openSettingsCalls, 1);
});
