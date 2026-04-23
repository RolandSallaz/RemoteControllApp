import assert from "node:assert/strict";
import { test } from "node:test";

import { configureAutoUpdate } from "./updater.js";

function createAutoUpdaterDouble() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let checkCalls = 0;
  let installCalls = 0;

  return {
    autoUpdater: {
      channel: undefined as string | undefined,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: (event: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(event, listener);
      },
      checkForUpdatesAndNotify: () => {
        checkCalls += 1;
      },
      quitAndInstall: () => {
        installCalls += 1;
      }
    },
    emit: async (event: string, payload?: unknown) => {
      await handlers.get(event)?.(payload);
    },
    getCheckCalls: () => checkCalls,
    getInstallCalls: () => installCalls
  };
}

test("configureAutoUpdate skips disabled app modes and unpackaged runs", () => {
  const updater = createAutoUpdaterDouble();
  let scheduled = false;

  assert.equal(configureAutoUpdate({
    app: { isPackaged: false },
    appMode: "viewer",
    autoUpdater: updater.autoUpdater,
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    isDev: false,
    scheduleUpdateCheck: () => {
      scheduled = true;
    }
  }), false);

  assert.equal(scheduled, false);
  assert.equal(updater.autoUpdater.channel, undefined);
  assert.equal(updater.getCheckCalls(), 0);
});

test("configureAutoUpdate configures updater handlers and schedules a check", async () => {
  const updater = createAutoUpdaterDouble();
  const logs: string[] = [];
  const errors: string[] = [];
  let scheduledCheck: (() => void) | undefined;
  let scheduledDelay = 0;

  assert.equal(configureAutoUpdate({
    app: { isPackaged: true },
    appMode: "host",
    autoUpdater: updater.autoUpdater,
    dialog: { showMessageBox: async () => ({ response: 1 }) },
    isDev: false,
    logger: {
      log: (message) => logs.push(message),
      error: (message) => errors.push(message)
    },
    scheduleUpdateCheck: (callback, delayMs) => {
      scheduledCheck = callback;
      scheduledDelay = delayMs;
    }
  }), true);

  assert.equal(updater.autoUpdater.channel, "server");
  assert.equal(updater.autoUpdater.autoDownload, true);
  assert.equal(updater.autoUpdater.autoInstallOnAppQuit, true);
  assert.equal(scheduledDelay, 1500);

  scheduledCheck?.();
  assert.equal(updater.getCheckCalls(), 1);

  await updater.emit("checking-for-update");
  await updater.emit("update-available", { version: "0.2.6" });
  await updater.emit("update-not-available");
  await updater.emit("error", new Error("boom"));

  assert.deepEqual(logs, [
    "[updater] checking for updates on channel \"server\"",
    "[updater] update available: 0.2.6",
    "[updater] no updates available"
  ]);
  assert.deepEqual(errors, ["[updater] boom"]);
});

test("configureAutoUpdate prompts to restart after a downloaded update", async () => {
  const updater = createAutoUpdaterDouble();
  const dialogs: Array<{ title: string; detail: string }> = [];

  configureAutoUpdate({
    app: { isPackaged: true },
    appMode: "viewer",
    autoUpdater: updater.autoUpdater,
    dialog: {
      showMessageBox: async (options) => {
        dialogs.push({ title: options.title, detail: options.detail });
        return { response: 0 };
      }
    },
    isDev: false,
    scheduleUpdateCheck: () => undefined
  });

  await updater.emit("update-downloaded", { version: "0.2.7" });

  assert.deepEqual(dialogs, [{
    title: "RemoteControl Client",
    detail: "Version 0.2.7 is ready to install. Restart now to apply it."
  }]);
  assert.equal(updater.getInstallCalls(), 1);
});
