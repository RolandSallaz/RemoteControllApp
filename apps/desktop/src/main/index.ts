import { existsSync, mkdirSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, dialog, ipcMain, nativeImage, shell } from "electron";
import type { ControlMessage, HostSettings, UpdateHostSettingsPayload } from "@remote-control/shared";

import { discoverServers } from "./discoveryClient.js";
import {
  getEmbeddedBackendSettingsToken,
  getEmbeddedBackendStatus,
  startEmbeddedBackend,
  stopEmbeddedBackend
} from "./backendProcess.js";
import { applyHostControl } from "./hostControl.js";
import { startAutoUpdate } from "./updater.js";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const currentDir = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);
const productName = getProductName(appMode);
const windowTitle = `${productName} v${app.getVersion()}`;
const settingsPath = join(app.getPath("userData"), "settings.json");
const scrypt = promisify(scryptCallback);
const passwordHashPrefix = "scrypt:v1";
const passwordSaltBytes = 16;
const passwordKeyBytes = 32;
const incomingFileSaves = new Map<string, IncomingFileSaveSession>();
let mainWindow: BrowserWindow | undefined;
let settingsWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let hostShutdownNotificationSent = false;
let lastViewerName: string | undefined;
const hostShutdownGracePeriodMs = 350;

configureAppProfile();

function createWindow(): void {
  const isHostMode = appMode === "host";
  const window = new BrowserWindow({
    width: isHostMode ? 340 : 1280,
    height: isHostMode ? 320 : 820,
    minWidth: isHostMode ? 340 : 960,
    minHeight: isHostMode ? 320 : 640,
    maxWidth: isHostMode ? 340 : undefined,
    maxHeight: isHostMode ? 320 : undefined,
    resizable: !isHostMode,
    maximizable: !isHostMode,
    autoHideMenuBar: true,
    title: windowTitle,
    backgroundColor: "#0b0d14",
    webPreferences: {
      preload: join(currentDir, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openTrustedExternalUrl(url);
    return { action: "deny" };
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(windowTitle);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process gone: ${details.reason} (${details.exitCode})`);
  });

  if (isHostMode) {
    window.on("close", (event) => {
      if (isQuitting) {
        return;
      }

      event.preventDefault();
      window.hide();
    });
  }

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL).then(() => {
      window.setTitle(windowTitle);
    });
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html")).then(() => {
      window.setTitle(windowTitle);
    });
  }

  mainWindow = window;
}

function configureAppProfile(): void {
  app.setName(productName);

  const profileName = isDev ? `${productName} Dev` : productName;
  const userDataPath = join(app.getPath("appData"), profileName);
  const sessionDataPath = join(userDataPath, "Session Data");
  const cachePath = join(sessionDataPath, "Cache");

  mkdirSync(cachePath, { recursive: true });
  app.setPath("userData", userDataPath);
  app.setPath("sessionData", sessionDataPath);
  app.commandLine.appendSwitch("disk-cache-dir", cachePath);
}

function normalizeAppMode(value: string): "combined" | "host" | "viewer" {
  if (value === "host" || value === "viewer") {
    return value;
  }

  return "combined";
}

function getProductName(mode: "combined" | "host" | "viewer"): string {
  if (mode === "host") {
    return "RemoteControl Server";
  }

  if (mode === "viewer") {
    return "RemoteControl Client";
  }

  return "RemoteControl";
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  void startEmbeddedBackend({ appMode, isDev });
  createWindow();
  if (appMode === "host") {
    createTray();
    void syncLaunchOnStartup();
  }
  startAutoUpdate(appMode, isDev);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopEmbeddedBackend();
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (shouldDelayQuitForHostShutdown()) {
    event.preventDefault();
    notifyHostShutdownAndQuit();
    return;
  }

  isQuitting = true;
  stopEmbeddedBackend();
});

function registerIpcHandlers(): void {
  ipcMain.handle("desktop:get-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 360, height: 220 }
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  });

  ipcMain.handle("control:message", async (_event, message: ControlMessage) => {
    try {
      await applyHostControl(message);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("backend:status", () => getEmbeddedBackendStatus());

  ipcMain.handle("window:toggle-fullscreen", () => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    if (!window) {
      return { ok: false };
    }

    const nextState = !window.isFullScreen();
    window.setFullScreen(nextState);
    return { ok: true, isFullScreen: nextState };
  });

  ipcMain.handle("window:get-fullscreen", () => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    return { isFullScreen: window?.isFullScreen() ?? false };
  });

  ipcMain.handle("app:get-launch-settings", async () => {
    if (appMode !== "host") {
      return {
        launchOnStartup: false
      };
    }

    const settings = await getHostSettings();
    return {
      launchOnStartup: settings.launchOnStartup ?? app.getLoginItemSettings().openAtLogin
    };
  });

  ipcMain.handle("app:set-launch-settings", async (_event, enabled: boolean) => {
    if (appMode !== "host") {
      return { ok: false, error: "Launch settings are available only in host mode" };
    }

    try {
      const previousOpenAtLogin = app.getLoginItemSettings().openAtLogin;
      app.setLoginItemSettings({
        openAtLogin: enabled
      });

      try {
        await updateHostSettings({
          launchOnStartup: enabled
        });
      } catch (error) {
        app.setLoginItemSettings({
          openAtLogin: previousOpenAtLogin
        });
        throw error;
      }

      return { ok: true, launchOnStartup: enabled };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("app:get-host-access-settings", async () => {
    if (appMode !== "host") {
      return {
        accessPassword: "",
        accessPasswordSet: false,
        requireViewerApproval: true
      };
    }

    const settings = await readHostSettingsFile();
    return {
      accessPassword: settings.accessPasswordHash ? "" : settings.accessPassword ?? "",
      accessPasswordSet: Boolean(settings.accessPasswordHash || settings.accessPassword),
      requireViewerApproval: settings.requireViewerApproval ?? true
    };
  });

  ipcMain.handle("app:set-host-access-password", async (_event, password: string) => {
    if (appMode !== "host") {
      return { ok: false, error: "Host password settings are available only in host mode" };
    }

    try {
      const normalizedPassword = password.trim();
      const settings = await readHostSettingsFile();
      const {
        accessPassword: _legacyAccessPassword,
        accessPasswordHash: _previousAccessPasswordHash,
        ...safeSettings
      } = settings;
      const nextSettings = {
        ...safeSettings,
        accessPasswordHash: normalizedPassword
          ? await hashAccessPassword(normalizedPassword)
          : undefined
      };
      await writeHostSettingsFile(nextSettings);
      return {
        ok: true,
        accessPassword: "",
        accessPasswordSet: Boolean(normalizedPassword)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("app:set-require-viewer-approval", async (_event, enabled: boolean) => {
    if (appMode !== "host") {
      return { ok: false, error: "Host approval settings are available only in host mode" };
    }

    try {
      const settings = await readHostSettingsFile();
      await writeHostSettingsFile({
        ...settings,
        requireViewerApproval: enabled
      });
      return { ok: true, requireViewerApproval: enabled };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("app:update-host-presence", (_event, payload: { connected: boolean; viewerName?: string }) => {
    if (appMode !== "host") {
      return { ok: false };
    }

    updateTray(payload.connected, payload.viewerName);
    const previousViewerName = lastViewerName;
    lastViewerName = payload.connected ? payload.viewerName : undefined;

    if (payload.connected && payload.viewerName && payload.viewerName !== previousViewerName) {
      showHostNotification("Viewer connected", `${payload.viewerName} connected to this host`);
    }

    if (!payload.connected && previousViewerName) {
      showHostNotification("Viewer disconnected", `${previousViewerName} disconnected`);
    }

    return { ok: true };
  });

  ipcMain.handle("viewer:get-settings", async () => {
    const settings = await readAppSettings();
    return getViewerSettings(settings);
  });

  ipcMain.handle("viewer:update-settings", async (_event, payload: Partial<ViewerSettings>) => {
    const settings = await readAppSettings();
    const nextViewerSettings: ViewerSettings = {
      ...getViewerSettings(settings),
      ...sanitizeViewerSettings(payload)
    };

    await writeAppSettings({
      ...settings,
      viewer: nextViewerSettings
    });

    return nextViewerSettings;
  });

  ipcMain.handle("history:get-servers", async () => {
    const settings = await readAppSettings();
    return settings.recentServers ?? [];
  });

  ipcMain.handle("history:add-server", async (_event, serverUrl: string) => {
    const normalized = serverUrl.trim();
    if (!normalized) {
      return { ok: false };
    }

    const settings = await readAppSettings();
    const nextRecentServers = [normalized, ...(settings.recentServers ?? []).filter((item) => item !== normalized)].slice(0, 8);
    await writeAppSettings({ ...settings, recentServers: nextRecentServers });
    return { ok: true, recentServers: nextRecentServers };
  });

  ipcMain.handle("files:get-settings", async () => {
    const settings = appMode === "host"
      ? await getHostSettings()
      : await readAppSettings();
    return {
      saveDirectory: settings.saveDirectory ?? getDefaultSaveDirectory()
    };
  });

  ipcMain.handle("files:choose-directory", async () => {
    const currentSettings = appMode === "host"
      ? await getHostSettings()
      : await readAppSettings();
    const selected = await dialog.showOpenDialog({
      title: "Select folder for incoming files",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: currentSettings.saveDirectory ?? getDefaultSaveDirectory()
    });

    if (selected.canceled || selected.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
        path: currentSettings.saveDirectory ?? getDefaultSaveDirectory()
      };
    }

    const nextPath = selected.filePaths[0];
    if (appMode === "host") {
      await updateHostSettings({ saveDirectory: nextPath });
    } else {
      await writeAppSettings({ ...currentSettings, saveDirectory: nextPath });
    }
    return { ok: true, canceled: false, path: nextPath };
  });

  ipcMain.handle("files:open-folder", async (_event, path?: string) => {
    try {
      const settings = appMode === "host"
        ? await getHostSettings()
        : await readAppSettings();
      const targetPath = path || settings.saveDirectory || getDefaultSaveDirectory();
      await shell.openPath(targetPath);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:save", async (_event, payload: { name: string; bytes: Uint8Array }) => {
    try {
      const settings = appMode === "host"
        ? await getHostSettings()
        : await readAppSettings();
      const saveDirectory = settings.saveDirectory ?? getDefaultSaveDirectory();
      await mkdir(saveDirectory, { recursive: true });

      const safeName = sanitizeFileName(payload.name);
      const filePath = await createUniqueFilePath(saveDirectory, safeName);
      await writeFile(filePath, Buffer.from(payload.bytes));

      return { ok: true, path: filePath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:start-incoming-transfer", async (_event, payload: { transferId: string; name: string; size: number }) => {
    try {
      const transferId = sanitizeTransferId(payload.transferId);
      if (!transferId) {
        return { ok: false, error: "Invalid file transfer id" };
      }

      if (!Number.isInteger(payload.size) || payload.size < 0) {
        return { ok: false, error: "Invalid file transfer size" };
      }

      if (incomingFileSaves.has(transferId)) {
        return { ok: false, error: "File transfer already exists" };
      }

      const settings = appMode === "host"
        ? await getHostSettings()
        : await readAppSettings();
      const saveDirectory = settings.saveDirectory ?? getDefaultSaveDirectory();
      await mkdir(saveDirectory, { recursive: true });

      const safeName = sanitizeFileName(payload.name);
      const filePath = await createUniqueFilePath(saveDirectory, safeName);
      incomingFileSaves.set(transferId, {
        expectedChunkIndex: 0,
        expectedSize: payload.size,
        filePath,
        receivedBytes: 0
      });

      return { ok: true, path: filePath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:append-incoming-transfer", async (_event, payload: { transferId: string; index: number; bytes: Uint8Array }) => {
    try {
      const transferId = sanitizeTransferId(payload.transferId);
      const transfer = transferId ? incomingFileSaves.get(transferId) : undefined;
      if (!transferId || !transfer) {
        return { ok: false, error: "Unknown file transfer" };
      }

      if (payload.index !== transfer.expectedChunkIndex) {
        return { ok: false, error: "Out-of-order file chunk" };
      }

      const bytes = Buffer.from(payload.bytes);
      if (transfer.receivedBytes + bytes.byteLength > transfer.expectedSize) {
        incomingFileSaves.delete(transferId);
        await unlink(transfer.filePath).catch(() => undefined);
        return { ok: false, error: "File transfer exceeded expected size" };
      }

      await appendFile(transfer.filePath, bytes);
      transfer.receivedBytes += bytes.byteLength;
      transfer.expectedChunkIndex += 1;
      return { ok: true, receivedBytes: transfer.receivedBytes };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:complete-incoming-transfer", async (_event, transferIdValue: string) => {
    try {
      const transferId = sanitizeTransferId(transferIdValue);
      const transfer = transferId ? incomingFileSaves.get(transferId) : undefined;
      if (!transferId || !transfer) {
        return { ok: false, error: "Unknown file transfer" };
      }

      incomingFileSaves.delete(transferId);
      if (transfer.receivedBytes !== transfer.expectedSize) {
        await unlink(transfer.filePath).catch(() => undefined);
        return { ok: false, error: "File transfer incomplete" };
      }

      return { ok: true, path: transfer.filePath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:abort-incoming-transfer", async (_event, transferIdValue: string) => {
    const transferId = sanitizeTransferId(transferIdValue);
    const transfer = transferId ? incomingFileSaves.get(transferId) : undefined;
    if (transferId && transfer) {
      incomingFileSaves.delete(transferId);
      await unlink(transfer.filePath).catch(() => undefined);
    }

    return { ok: true };
  });

  ipcMain.handle("discovery:scan", async () => {
    return await discoverServers();
  });

  ipcMain.handle("window:open-host-settings", () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }

    settingsWindow = new BrowserWindow({
      width: 380,
      height: 440,
      resizable: false,
      maximizable: false,
      minimizable: false,
      autoHideMenuBar: true,
      title: "Host Settings",
      backgroundColor: "#0b0d14",
      parent: mainWindow,
      modal: true,
      webPreferences: {
        preload: join(currentDir, "../preload/index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    settingsWindow.on("closed", () => {
      settingsWindow = undefined;
      mainWindow?.webContents.send("host-settings-closed");
    });

    settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
      openTrustedExternalUrl(url);
      return { action: "deny" };
    });

    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      void settingsWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}?page=host-settings`);
    } else {
      void settingsWindow.loadFile(join(currentDir, "../renderer/index.html"), {
        query: { page: "host-settings" }
      });
    }
  });
}

function sanitizeFileName(name: string): string {
  const fallbackName = "remote-control-file.bin";
  const normalizedName = name.normalize("NFKC").replace(/\\/g, "/");
  const hasTraversalSegment = normalizedName
    .split("/")
    .some((segment) => segment === "." || segment === "..");

  if (hasTraversalSegment) {
    return fallbackName;
  }

  const cleaned = basename(normalizedName)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("..") || isReservedWindowsFileName(cleaned)) {
    return fallbackName;
  }

  return cleaned.slice(0, 180);
}

function sanitizeTransferId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return /^[A-Za-z0-9._-]{1,80}$/.test(normalized) ? normalized : undefined;
}

function isReservedWindowsFileName(name: string): boolean {
  const stem = name.split(".")[0]?.toLowerCase();
  if (!stem) {
    return true;
  }

  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem);
}

function getDefaultSaveDirectory(): string {
  return join(app.getPath("downloads"), "RemoteControl");
}

type AppSettings = {
  saveDirectory?: string;
  recentServers?: string[];
  viewer?: ViewerSettings;
};

type IncomingFileSaveSession = {
  expectedChunkIndex: number;
  expectedSize: number;
  filePath: string;
  receivedBytes: number;
};

type ViewerFrameRate = 15 | 30 | 60;

type ViewerSettings = {
  captureLocalInput: boolean;
  connectInFullscreen: boolean;
  disconnectShortcut: string;
  frameRate: ViewerFrameRate;
  receiveAudio: boolean;
  switchMonitorShortcut: string;
};

const defaultViewerSettings: ViewerSettings = {
  captureLocalInput: false,
  connectInFullscreen: true,
  disconnectShortcut: "Ctrl+Alt+Shift+D",
  frameRate: 30,
  receiveAudio: true,
  switchMonitorShortcut: "Ctrl+Alt+Shift+M"
};

function getViewerSettings(settings: AppSettings): ViewerSettings {
  return {
    ...defaultViewerSettings,
    ...sanitizeViewerSettings(settings.viewer)
  };
}

function sanitizeViewerSettings(settings?: Partial<ViewerSettings>): Partial<ViewerSettings> {
  if (!settings) {
    return {};
  }

  const sanitized: Partial<ViewerSettings> = {};
  if (typeof settings.captureLocalInput === "boolean") {
    sanitized.captureLocalInput = settings.captureLocalInput;
  }
  if (typeof settings.connectInFullscreen === "boolean") {
    sanitized.connectInFullscreen = settings.connectInFullscreen;
  }
  if (typeof settings.disconnectShortcut === "string") {
    sanitized.disconnectShortcut = settings.disconnectShortcut.trim();
  }
  if (settings.frameRate === 15 || settings.frameRate === 30 || settings.frameRate === 60) {
    sanitized.frameRate = settings.frameRate;
  }
  if (typeof settings.receiveAudio === "boolean") {
    sanitized.receiveAudio = settings.receiveAudio;
  }
  if (typeof settings.switchMonitorShortcut === "string") {
    sanitized.switchMonitorShortcut = settings.switchMonitorShortcut.trim();
  }

  return sanitized;
}

async function readAppSettings(): Promise<AppSettings> {
  try {
    if (!existsSync(settingsPath)) {
      return {};
    }

    const raw = await readFile(settingsPath, "utf8");
    return JSON.parse(raw) as AppSettings;
  } catch {
    return {};
  }
}

async function writeAppSettings(settings: AppSettings): Promise<void> {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

async function syncLaunchOnStartup(): Promise<void> {
  const settings = await getHostSettingsWithRetry();
  if (typeof settings.launchOnStartup === "boolean") {
    app.setLoginItemSettings({
      openAtLogin: settings.launchOnStartup
    });
  }
}

async function getHostSettings(): Promise<HostSettings> {
  if (appMode !== "host") {
    return {};
  }

  const response = await fetchBackend("/settings/host");
  return await response.json() as HostSettings;
}

async function updateHostSettings(payload: UpdateHostSettingsPayload): Promise<HostSettings> {
  if (appMode !== "host") {
    return {};
  }

  const response = await fetchBackend("/settings/host", {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return await response.json() as HostSettings;
}

async function readHostSettingsFile(): Promise<HostSettings> {
  try {
    const path = getHostSettingsPath();
    if (!existsSync(path)) {
      return {};
    }

    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as HostSettings;
  } catch {
    return {};
  }
}

async function writeHostSettingsFile(settings: HostSettings): Promise<void> {
  const path = getHostSettingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings, null, 2), "utf8");
}

function getHostSettingsPath(): string {
  return join(app.getPath("userData"), "host-settings.json");
}

async function getHostSettingsWithRetry(): Promise<HostSettings> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await getHostSettings();
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Could not load host settings from embedded backend");
}

async function fetchBackend(path: string, init?: RequestInit): Promise<Response> {
  const backend = getEmbeddedBackendStatus();
  if (!backend.url) {
    throw new Error("Embedded backend is not available");
  }

  const headers = new Headers(init?.headers);
  const settingsToken = getEmbeddedBackendSettingsToken();
  if (settingsToken) {
    headers.set("x-remote-control-settings-token", settingsToken);
  }

  const response = await fetch(new URL(path, `${backend.url}/`), {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new Error(`Embedded backend request failed: ${response.status}`);
  }

  return response;
}

async function hashAccessPassword(password: string): Promise<string> {
  const salt = randomBytes(passwordSaltBytes);
  const derivedKey = await scrypt(password, salt, passwordKeyBytes) as Buffer;
  return [
    passwordHashPrefix,
    salt.toString("base64"),
    derivedKey.toString("base64")
  ].join("$");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip(`${productName}: waiting for viewer`);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  updateTray(false);
}

function updateTray(connected: boolean, viewerName?: string): void {
  if (!tray) {
    return;
  }

  const statusText = connected
    ? `Connected${viewerName ? `: ${viewerName}` : ""}`
    : "Waiting for viewer";

  tray.setToolTip(`${productName}: ${statusText}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: connected ? `Connected${viewerName ? ` to ${viewerName}` : ""}` : "Waiting for viewer",
      enabled: false
    },
    {
      label: "Open",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="64" height="64" rx="14" fill="#11131d"/>
      <path d="M18 18h28a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H34l-6 6v-6H18a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z" fill="#4f7cff"/>
      <circle cx="24" cy="30" r="3" fill="#ffffff"/>
      <circle cx="32" cy="30" r="3" fill="#ffffff"/>
      <circle cx="40" cy="30" r="3" fill="#ffffff"/>
    </svg>
  `;

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`).resize({
    width: 16,
    height: 16
  });
}

function openTrustedExternalUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:") {
      void shell.openExternal(parsed.toString());
    }
  } catch {
    // Ignore malformed or unsupported external URLs.
  }
}

function showHostNotification(title: string, body: string): void {
  if (appMode !== "host" || !Notification.isSupported()) {
    return;
  }

  new Notification({
    title,
    body,
    silent: false
  }).show();
}

function shouldDelayQuitForHostShutdown(): boolean {
  return appMode === "host"
    && !hostShutdownNotificationSent
    && Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed());
}

function notifyHostShutdownAndQuit(): void {
  hostShutdownNotificationSent = true;
  isQuitting = true;
  mainWindow?.webContents.send("app:host-shutdown-requested");

  const timer = setTimeout(() => {
    stopEmbeddedBackend();
    app.quit();
  }, hostShutdownGracePeriodMs);
  timer.unref?.();
}

async function createUniqueFilePath(directory: string, fileName: string): Promise<string> {
  const extension = extname(fileName);
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;

  for (let index = 0; index < 1000; index += 1) {
    const candidate = index === 0
      ? join(directory, fileName)
      : join(directory, `${baseName} (${index})${extension}`);

    try {
      await writeFile(candidate, new Uint8Array(), { flag: "wx" });
      return candidate;
    } catch {
      // try next suffix
    }
  }

  throw new Error(`Could not allocate file path for ${fileName}`);
}
