import assert from "node:assert/strict";
import { test } from "node:test";

import { registerAppIpcHandlers } from "./appIpc.js";

test("registerAppIpcHandlers handles host state and viewer preferences", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let openAtLogin = false;
  let lastViewerName: string | undefined;
  const notifications: Array<{ title: string; body: string }> = [];
  let appSettings = {
    recentServers: ["http://old"],
    viewer: {
      captureLocalInput: false,
      connectInFullscreen: true,
      disconnectShortcut: "D",
      frameRate: 30 as const,
      receiveAudio: true,
      switchMonitorShortcut: "M"
    }
  };

  registerAppIpcHandlers({
    appMode: "host",
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
    getLoginItemOpenAtLogin: () => openAtLogin,
    setLoginItemOpenAtLogin: (enabled) => {
      openAtLogin = enabled;
    },
    getHostSettings: async () => ({ launchOnStartup: undefined }),
    updateHostSettings: async () => undefined,
    readHostSettingsFile: async () => ({ accessPasswordHash: "hash", requireViewerApproval: true }),
    writeHostSettingsFile: async () => undefined,
    hashAccessPassword: async (password) => `hashed:${password}`,
    sanitizeBoolean: (value) => typeof value === "boolean" ? value : undefined,
    sanitizeHostAccessPasswordInput: (value) => typeof value === "string" ? value : undefined,
    sanitizeHostPresencePayload: (value) => value as { connected: boolean; viewerName?: string },
    readAppSettings: async () => appSettings,
    writeAppSettings: async (settings) => {
      appSettings = settings as typeof appSettings;
    },
    getViewerSettings: (settings) => ({
      captureLocalInput: false,
      connectInFullscreen: true,
      disconnectShortcut: "D",
      frameRate: 30,
      receiveAudio: true,
      switchMonitorShortcut: "M",
      ...settings.viewer
    }),
    sanitizeViewerSettingsPayload: () => ({ receiveAudio: false }),
    sanitizeServerUrl: (value) => typeof value === "string" ? value : undefined,
    updateTray: () => undefined,
    showHostNotification: (title, body) => notifications.push({ title, body }),
    getLastViewerName: () => lastViewerName,
    setLastViewerName: (name) => {
      lastViewerName = name;
    }
  });

  assert.deepEqual(await handlers.get("app:get-launch-settings")?.(), { launchOnStartup: false });
  assert.deepEqual(await handlers.get("app:set-launch-settings")?.({}, true), { ok: true, launchOnStartup: true });
  assert.equal(openAtLogin, true);
  assert.deepEqual(await handlers.get("app:get-host-access-settings")?.(), {
    accessPassword: "",
    accessPasswordSet: true,
    requireViewerApproval: true
  });
  assert.deepEqual(await handlers.get("app:update-host-presence")?.({}, { connected: true, viewerName: "Alice" }), { ok: true });
  assert.equal(lastViewerName, "Alice");
  assert.deepEqual(notifications, [{
    title: "Viewer connected",
    body: "Alice connected to this host"
  }]);

  assert.deepEqual(await handlers.get("viewer:update-settings")?.({}, { receiveAudio: false }), {
    captureLocalInput: false,
    connectInFullscreen: true,
    disconnectShortcut: "D",
    frameRate: 30,
    receiveAudio: false,
    switchMonitorShortcut: "M"
  });
  assert.deepEqual(await handlers.get("history:add-server")?.({}, "http://new"), {
    ok: true,
    recentServers: ["http://new", "http://old"]
  });
});

test("registerAppIpcHandlers falls back to local launch setting while backend is unavailable", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  registerAppIpcHandlers({
    appMode: "host",
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
    getLoginItemOpenAtLogin: () => true,
    setLoginItemOpenAtLogin: () => undefined,
    getHostSettings: async () => {
      throw new TypeError("fetch failed");
    },
    updateHostSettings: async () => undefined,
    readHostSettingsFile: async () => ({}),
    writeHostSettingsFile: async () => undefined,
    hashAccessPassword: async () => "hash",
    sanitizeBoolean: () => undefined,
    sanitizeHostAccessPasswordInput: () => undefined,
    sanitizeHostPresencePayload: () => undefined,
    readAppSettings: async () => ({}),
    writeAppSettings: async () => undefined,
    getViewerSettings: () => ({
      captureLocalInput: false,
      connectInFullscreen: true,
      disconnectShortcut: "D",
      frameRate: 30,
      receiveAudio: true,
      switchMonitorShortcut: "M"
    }),
    sanitizeViewerSettingsPayload: () => ({}),
    sanitizeServerUrl: () => undefined,
    updateTray: () => undefined,
    showHostNotification: () => undefined,
    getLastViewerName: () => undefined,
    setLastViewerName: () => undefined
  });

  assert.deepEqual(await handlers.get("app:get-launch-settings")?.(), {
    launchOnStartup: true
  });
});
