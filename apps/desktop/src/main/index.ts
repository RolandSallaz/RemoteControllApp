import { existsSync, mkdirSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, dialog, ipcMain, nativeImage, shell } from "electron";
import type { HostSettings, UpdateHostSettingsPayload } from "@remote-control/shared";

import { discoverServers } from "./discoveryClient.js";
import {
  getEmbeddedBackendSettingsToken,
  getEmbeddedBackendStatus,
  startEmbeddedBackend,
  stopEmbeddedBackend
} from "./backendProcess.js";
import { applyHostControl } from "./hostControl.js";
import {
  sanitizeAppendIncomingTransferPayload,
  sanitizeBoolean,
  sanitizeControlMessage,
  sanitizeHostAccessPasswordInput,
  sanitizeHostPresencePayload,
  sanitizeOptionalFilePath,
  sanitizeServerUrl,
  sanitizeStartIncomingTransferPayload,
  sanitizeTransferId,
  sanitizeViewerSettingsPayload
} from "./ipcValidation.js";
import { startAutoUpdate } from "./updater.js";
import { getProductName, normalizeAppMode } from "../shared/appMeta.js";
import { isTrustedExternalUrl } from "./externalUrl.js";
import { createUniqueFilePath, sanitizeFileName } from "./fileTransfer.js";
import {
  attachTrustedExternalOpenHandler,
  buildHostSettingsWindowOptions,
  buildMainWindowOptions,
  loadWindowContent
} from "./windowManagement.js";
import { registerWindowIpcHandlers } from "./windowIpc.js";
import { registerAppIpcHandlers, type ViewerSettings } from "./appIpc.js";
import { registerFileIpcHandlers, type IncomingFileSaveSession } from "./fileIpc.js";

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
  const window = new BrowserWindow(buildMainWindowOptions(appMode, currentDir, windowTitle));

  attachTrustedExternalOpenHandler(window, openTrustedExternalUrl);

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

  void loadWindowContent(window, currentDir, isDev, process.env.ELECTRON_RENDERER_URL).then(() => {
    window.setTitle(windowTitle);
  });

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
  registerWindowIpcHandlers({
    ipcMain,
    BrowserWindow,
    getMainWindow: () => mainWindow,
    openHostSettingsWindow
  });
  registerAppIpcHandlers({
    appMode,
    ipcMain,
    getLoginItemOpenAtLogin: () => app.getLoginItemSettings().openAtLogin,
    setLoginItemOpenAtLogin: (enabled) => {
      app.setLoginItemSettings({ openAtLogin: enabled });
    },
    getHostSettings,
    updateHostSettings,
    readHostSettingsFile,
    writeHostSettingsFile,
    hashAccessPassword,
    sanitizeBoolean,
    sanitizeHostAccessPasswordInput,
    sanitizeHostPresencePayload,
    readAppSettings,
    writeAppSettings,
    getViewerSettings,
    sanitizeViewerSettingsPayload,
    sanitizeServerUrl,
    updateTray,
    showHostNotification,
    getLastViewerName: () => lastViewerName,
    setLastViewerName: (name) => {
      lastViewerName = name;
    }
  });
  registerFileIpcHandlers({
    appMode,
    ipcMain,
    getHostSettings,
    updateHostSettings: async (payload) => {
      await updateHostSettings(payload);
    },
    readAppSettings,
    writeAppSettings,
    getDefaultSaveDirectory,
    showOpenDialog: async (options) => await dialog.showOpenDialog({
      title: options.title,
      properties: ["openDirectory", "createDirectory"],
      defaultPath: options.defaultPath
    }),
    openPath: (targetPath) => shell.openPath(targetPath),
    sanitizeOptionalFilePath,
    sanitizeStartIncomingTransferPayload,
    sanitizeAppendIncomingTransferPayload,
    sanitizeTransferId,
    sanitizeFileName,
    createUniqueFilePath,
    mkdir: async (path, options) => {
      await mkdir(path, options);
    },
    appendFile,
    rename,
    unlink,
    incomingFileSaves
  });

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

  ipcMain.handle("control:message", async (_event, message: unknown) => {
    const controlMessage = sanitizeControlMessage(message);
    if (!controlMessage) {
      return { ok: false, error: "Invalid control message" };
    }

    try {
      await applyHostControl(controlMessage);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("backend:status", () => getEmbeddedBackendStatus());

  ipcMain.handle("discovery:scan", async () => {
    return await discoverServers();
  });

}

function openHostSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow(buildHostSettingsWindowOptions(currentDir, mainWindow));
  settingsWindow.on("closed", () => {
    settingsWindow = undefined;
    mainWindow?.webContents.send("host-settings-closed");
  });

  attachTrustedExternalOpenHandler(settingsWindow, openTrustedExternalUrl);
  void loadWindowContent(settingsWindow, currentDir, isDev, process.env.ELECTRON_RENDERER_URL, "host-settings");
}

function getDefaultSaveDirectory(): string {
  return join(app.getPath("downloads"), "RemoteControl");
}

type AppSettings = {
  saveDirectory?: string;
  recentServers?: string[];
  viewer?: ViewerSettings;
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
    ...sanitizeViewerSettingsPayload(settings.viewer)
  };
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
  if (isTrustedExternalUrl(url)) {
    void shell.openExternal(url);
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
