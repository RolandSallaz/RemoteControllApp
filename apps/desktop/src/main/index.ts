import { existsSync, mkdirSync } from "node:fs";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
import { getProductName, normalizeAppMode, type DesktopAppMode } from "../shared/appMeta.js";
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

const require = createRequire(import.meta.url);
const hostShutdownGracePeriodMs = 350;
const passwordHashPrefix = "scrypt:v1";
const passwordSaltBytes = 16;
const passwordKeyBytes = 32;

export type AppSettings = {
  saveDirectory?: string;
  recentServers?: string[];
  viewer?: ViewerSettings;
};

type AppProfilePaths = {
  cachePath: string;
  profileName: string;
  sessionDataPath: string;
  userDataPath: string;
};

type AppLike = {
  getPath: (name: "appData" | "downloads" | "userData") => string;
  setName: (name: string) => void;
  setPath: (name: "sessionData" | "userData", value: string) => void;
  commandLine: {
    appendSwitch: (name: string, value: string) => void;
  };
};

type BrowserWindowLike = {
  focus: () => void;
  hide: () => void;
  isDestroyed?: () => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  setTitle: (title: string) => void;
  show: () => void;
  webContents: {
    isDestroyed?: () => boolean;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    send: (channel: string, ...args: unknown[]) => void;
  };
};

type BrowserWindowConstructor = new (options: unknown) => BrowserWindowLike;

type IpcMainLike = {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
};

type DesktopCapturerLike = {
  getSources: (options: {
    thumbnailSize: { height: number; width: number };
    types: Array<"screen" | "window">;
  }) => Promise<Array<{
    id: string;
    name: string;
    thumbnail: { toDataURL: () => string };
  }>>;
};

type NativeImageLike = {
  createFromDataURL: (dataUrl: string) => {
    resize: (options: { height: number; width: number }) => unknown;
  };
};

type NotificationLike = {
  create: (options: { body: string; silent: boolean; title: string }) => { show: () => void };
  isSupported: () => boolean;
};

type TimerLike = {
  unref?: () => void;
};

export const defaultViewerSettings: ViewerSettings = {
  captureLocalInput: false,
  connectInFullscreen: true,
  disconnectShortcut: "Ctrl+Alt+Shift+D",
  frameRate: 30,
  receiveAudio: true,
  switchMonitorShortcut: "Ctrl+Alt+Shift+M"
};

export function buildAppProfilePaths(appDataPath: string, productName: string, isDev: boolean): AppProfilePaths {
  const profileName = isDev ? `${productName} Dev` : productName;
  const userDataPath = join(appDataPath, profileName);
  const sessionDataPath = join(userDataPath, "Session Data");
  const cachePath = join(sessionDataPath, "Cache");

  return {
    cachePath,
    profileName,
    sessionDataPath,
    userDataPath
  };
}

export function configureAppProfile(
  app: AppLike,
  productName: string,
  isDev: boolean,
  mkdirSyncFn: typeof mkdirSync = mkdirSync
): AppProfilePaths {
  app.setName(productName);

  const paths = buildAppProfilePaths(app.getPath("appData"), productName, isDev);
  mkdirSyncFn(paths.cachePath, { recursive: true });
  app.setPath("userData", paths.userDataPath);
  app.setPath("sessionData", paths.sessionDataPath);
  app.commandLine.appendSwitch("disk-cache-dir", paths.cachePath);

  return paths;
}

export function createMainWindow(options: {
  BrowserWindow: BrowserWindowConstructor;
  appMode: DesktopAppMode;
  attachTrustedExternalOpenHandler: (window: BrowserWindowLike, handler: (url: string) => void) => void;
  buildMainWindowOptions: typeof buildMainWindowOptions;
  currentDir: string;
  getIsQuitting: () => boolean;
  isDev: boolean;
  loadWindowContent: typeof loadWindowContent;
  openTrustedExternalUrl: (url: string) => void;
  rendererUrl?: string;
  windowTitle: string;
}): BrowserWindowLike {
  const isHostMode = options.appMode === "host";
  const window = new options.BrowserWindow(
    options.buildMainWindowOptions(options.appMode, options.currentDir, options.windowTitle)
  );

  options.attachTrustedExternalOpenHandler(window, options.openTrustedExternalUrl);

  window.on("page-title-updated", (event) => {
    (event as { preventDefault: () => void }).preventDefault();
    window.setTitle(options.windowTitle);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    const goneDetails = details as { exitCode: number; reason: string };
    console.error(`Renderer process gone: ${goneDetails.reason} (${goneDetails.exitCode})`);
  });

  if (isHostMode) {
    window.on("close", (event) => {
      if (options.getIsQuitting()) {
        return;
      }

      (event as { preventDefault: () => void }).preventDefault();
      window.hide();
    });
  }

  void options.loadWindowContent(
    window as never,
    options.currentDir,
    options.isDev,
    options.rendererUrl
  ).then(() => {
    window.setTitle(options.windowTitle);
  });

  return window;
}

export function getDefaultSaveDirectory(downloadsPath: string): string {
  return join(downloadsPath, "RemoteControl");
}

export function getViewerSettings(
  settings: AppSettings,
  sanitizeViewerSettings: typeof sanitizeViewerSettingsPayload = sanitizeViewerSettingsPayload
): ViewerSettings {
  return {
    ...defaultViewerSettings,
    ...sanitizeViewerSettings(settings.viewer)
  };
}

export async function readJsonSettings<T extends object>(
  path: string,
  existsSyncFn: (path: string) => boolean = existsSync,
  readFileFn: typeof readFile = readFile
): Promise<T> {
  try {
    if (!existsSyncFn(path)) {
      return {} as T;
    }

    const raw = await readFileFn(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

export async function writeJsonSettings<T extends object>(
  path: string,
  value: T,
  mkdirFn: typeof mkdir = mkdir,
  writeFileFn: typeof writeFile = writeFile,
  dirnameFn: typeof dirname = dirname
): Promise<void> {
  await mkdirFn(dirnameFn(path), { recursive: true });
  await writeFileFn(path, JSON.stringify(value, null, 2), "utf8");
}

export async function syncLaunchOnStartup(options: {
  getHostSettingsWithRetry: () => Promise<HostSettings>;
  setLoginItemOpenAtLogin: (enabled: boolean) => void;
}): Promise<void> {
  const settings = await options.getHostSettingsWithRetry();
  if (typeof settings.launchOnStartup === "boolean") {
    options.setLoginItemOpenAtLogin(settings.launchOnStartup);
  }
}

export async function getHostSettingsFromBackend(
  appMode: DesktopAppMode,
  fetchBackendFn: (path: string, init?: RequestInit) => Promise<Response>
): Promise<HostSettings> {
  if (appMode !== "host") {
    return {};
  }

  const response = await fetchBackendFn("/settings/host");
  return await response.json() as HostSettings;
}

export async function updateHostSettingsViaBackend(
  appMode: DesktopAppMode,
  payload: UpdateHostSettingsPayload,
  fetchBackendFn: (path: string, init?: RequestInit) => Promise<Response>
): Promise<HostSettings> {
  if (appMode !== "host") {
    return {};
  }

  const response = await fetchBackendFn("/settings/host", {
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return await response.json() as HostSettings;
}

export function getHostSettingsPath(userDataPath: string): string {
  return join(userDataPath, "host-settings.json");
}

export async function getHostSettingsWithRetry(
  getHostSettingsFn: () => Promise<HostSettings>,
  delayFn: (ms: number) => Promise<void> = delay,
  retries = 10,
  retryDelayMs = 300
): Promise<HostSettings> {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await getHostSettingsFn();
    } catch (error) {
      lastError = error;
      await delayFn(retryDelayMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Could not load host settings from embedded backend");
}

export async function fetchBackend(options: {
  backendStatus: { url?: string };
  fetchFn?: typeof fetch;
  init?: RequestInit;
  path: string;
  settingsToken?: string;
}): Promise<Response> {
  if (!options.backendStatus.url) {
    throw new Error("Embedded backend is not available");
  }

  const headers = new Headers(options.init?.headers);
  if (options.settingsToken) {
    headers.set("x-remote-control-settings-token", options.settingsToken);
  }

  const response = await (options.fetchFn ?? fetch)(new URL(options.path, `${options.backendStatus.url}/`), {
    ...options.init,
    headers
  });
  if (!response.ok) {
    throw new Error(`Embedded backend request failed: ${response.status}`);
  }

  return response;
}

export async function hashAccessPassword(
  password: string,
  options: {
    keyBytes?: number;
    passwordHashPrefix?: string;
    randomBytes?: typeof randomBytes;
    saltBytes?: number;
    scrypt?: (password: string, salt: Buffer, keylen: number) => Promise<Buffer | Uint8Array>;
  } = {}
): Promise<string> {
  const salt = (options.randomBytes ?? randomBytes)(options.saltBytes ?? passwordSaltBytes);
  const derivedKey = await (options.scrypt ?? defaultScryptPromise)(password, salt, options.keyBytes ?? passwordKeyBytes);
  return [
    options.passwordHashPrefix ?? passwordHashPrefix,
    salt.toString("base64"),
    Buffer.from(derivedKey).toString("base64")
  ].join("$");
}

export function delay(
  ms: number,
  scheduleTimeout: (callback: () => void, timeoutMs: number) => unknown = setTimeout
): Promise<void> {
  return new Promise((resolveDelay) => {
    scheduleTimeout(resolveDelay, ms);
  });
}

export function getTrayStatusText(connected: boolean, viewerName?: string): string {
  return connected
    ? `Connected${viewerName ? `: ${viewerName}` : ""}`
    : "Waiting for viewer";
}

export function createTrayMenuTemplate(options: {
  connected: boolean;
  onOpen: () => void;
  onQuit: () => void;
  viewerName?: string;
}): Array<{ click?: () => void; enabled?: boolean; label: string }> {
  return [
    {
      label: options.connected
        ? `Connected${options.viewerName ? ` to ${options.viewerName}` : ""}`
        : "Waiting for viewer",
      enabled: false
    },
    {
      label: "Open",
      click: options.onOpen
    },
    {
      label: "Quit",
      click: options.onQuit
    }
  ];
}

export function updateTray(options: {
  Menu: { buildFromTemplate: (template: Array<{ click?: () => void; enabled?: boolean; label: string }>) => unknown };
  connected: boolean;
  onOpen: () => void;
  onQuit: () => void;
  productName: string;
  tray?: { setContextMenu: (menu: unknown) => void; setToolTip: (tooltip: string) => void };
  viewerName?: string;
}): void {
  if (!options.tray) {
    return;
  }

  const statusText = getTrayStatusText(options.connected, options.viewerName);
  options.tray.setToolTip(`${options.productName}: ${statusText}`);
  options.tray.setContextMenu(options.Menu.buildFromTemplate(createTrayMenuTemplate({
    connected: options.connected,
    viewerName: options.viewerName,
    onOpen: options.onOpen,
    onQuit: options.onQuit
  })));
}

export function createTrayIconSvg(): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="64" height="64" rx="14" fill="#11131d"/>
      <path d="M18 18h28a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H34l-6 6v-6H18a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4Z" fill="#4f7cff"/>
      <circle cx="24" cy="30" r="3" fill="#ffffff"/>
      <circle cx="32" cy="30" r="3" fill="#ffffff"/>
      <circle cx="40" cy="30" r="3" fill="#ffffff"/>
    </svg>
  `;
}

export function createTrayIcon(nativeImage: NativeImageLike): unknown {
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(createTrayIconSvg()).toString("base64")}`
  ).resize({
    width: 16,
    height: 16
  });
}

export function createHostTray(options: {
  onDoubleClick: () => void;
  onOpen: () => void;
  onQuit: () => void;
  productName: string;
  Tray: new (icon: unknown) => {
    on: (event: string, listener: () => void) => void;
    setContextMenu: (menu: unknown) => void;
    setToolTip: (tooltip: string) => void;
  };
  icon: unknown;
  Menu: { buildFromTemplate: (template: Array<{ click?: () => void; enabled?: boolean; label: string }>) => unknown };
}) {
  const tray = new options.Tray(options.icon);
  tray.setToolTip(`${options.productName}: waiting for viewer`);
  tray.on("double-click", options.onDoubleClick);
  updateTray({
    tray,
    Menu: options.Menu,
    productName: options.productName,
    connected: false,
    onOpen: options.onOpen,
    onQuit: options.onQuit
  });
  return tray;
}

export async function openTrustedExternalUrl(
  url: string,
  isTrustedExternalUrlFn: (url: string) => boolean = isTrustedExternalUrl,
  openExternal: (url: string) => Promise<unknown> | unknown
): Promise<boolean> {
  if (!isTrustedExternalUrlFn(url)) {
    return false;
  }

  await openExternal(url);
  return true;
}

export function showHostNotification(options: {
  appMode: DesktopAppMode;
  body: string;
  notification: NotificationLike;
  title: string;
}): boolean {
  if (options.appMode !== "host" || !options.notification.isSupported()) {
    return false;
  }

  options.notification.create({
    title: options.title,
    body: options.body,
    silent: false
  }).show();
  return true;
}

export function shouldDelayQuitForHostShutdown(options: {
  appMode: DesktopAppMode;
  hostShutdownNotificationSent: boolean;
  mainWindow?: BrowserWindowLike;
}): boolean {
  return options.appMode === "host"
    && !options.hostShutdownNotificationSent
    && Boolean(
      options.mainWindow
      && !options.mainWindow.isDestroyed?.()
      && !options.mainWindow.webContents.isDestroyed?.()
    );
}

export function notifyHostShutdownAndQuit(options: {
  appQuit: () => void;
  gracePeriodMs?: number;
  mainWindow?: BrowserWindowLike;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => unknown;
  stopEmbeddedBackend: () => void;
}): unknown {
  options.mainWindow?.webContents.send("app:host-shutdown-requested");

  const timer = (options.scheduleTimeout ?? setTimeout)(() => {
    options.stopEmbeddedBackend();
    options.appQuit();
  }, options.gracePeriodMs ?? hostShutdownGracePeriodMs) as TimerLike | undefined;

  timer?.unref?.();
  return timer;
}

export function registerDirectIpcHandlers(options: {
  applyHostControl: typeof applyHostControl;
  desktopCapturer: DesktopCapturerLike;
  discoverServers: typeof discoverServers;
  getEmbeddedBackendStatus: typeof getEmbeddedBackendStatus;
  ipcMain: IpcMainLike;
  sanitizeControlMessage: typeof sanitizeControlMessage;
}): void {
  options.ipcMain.handle("desktop:get-sources", async () => {
    const sources = await options.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 360, height: 220 }
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  });

  options.ipcMain.handle("control:message", async (_event, message: unknown) => {
    const controlMessage = options.sanitizeControlMessage(message);
    if (!controlMessage) {
      return { ok: false, error: "Invalid control message" };
    }

    try {
      await options.applyHostControl(controlMessage);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  options.ipcMain.handle("backend:status", () => options.getEmbeddedBackendStatus());

  options.ipcMain.handle("discovery:scan", async () => {
    return await options.discoverServers();
  });
}

const defaultScryptPromise = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

function runDesktopMain(): void {
  const electron = require("electron") as typeof import("electron");
  const { app, BrowserWindow, Menu, Notification, Tray, desktopCapturer, dialog, ipcMain, nativeImage, shell } = electron;

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);
  const productName = getProductName(appMode);
  const windowTitle = `${productName} v${app.getVersion()}`;
  const incomingFileSaves = new Map<string, IncomingFileSaveSession>();
  let mainWindow: BrowserWindowLike | undefined;
  let settingsWindow: BrowserWindowLike | undefined;
  let tray: {
    on: (event: string, listener: () => void) => void;
    setContextMenu: (menu: unknown) => void;
    setToolTip: (tooltip: string) => void;
  } | undefined;
  let isQuitting = false;
  let hostShutdownNotificationSent = false;
  let lastViewerName: string | undefined;

  configureAppProfile(app, productName, isDev);

  function getAppSettingsPath(): string {
    return join(app.getPath("userData"), "settings.json");
  }

  function createWindow(): void {
    mainWindow = createMainWindow({
      BrowserWindow: BrowserWindow as unknown as BrowserWindowConstructor,
      appMode,
      attachTrustedExternalOpenHandler: attachTrustedExternalOpenHandler as never,
      buildMainWindowOptions,
      currentDir,
      getIsQuitting: () => isQuitting,
      isDev,
      loadWindowContent,
      openTrustedExternalUrl: (url) => {
        void openTrustedExternalUrl(url, isTrustedExternalUrl, (nextUrl) => shell.openExternal(nextUrl));
      },
      rendererUrl: process.env.ELECTRON_RENDERER_URL,
      windowTitle
    });
  }

  async function readAppSettings(): Promise<AppSettings> {
    return await readJsonSettings<AppSettings>(getAppSettingsPath(), existsSync, readFile);
  }

  async function writeAppSettings(settings: AppSettings): Promise<void> {
    await writeJsonSettings(getAppSettingsPath(), settings, mkdir, writeFile, dirname);
  }

  async function getHostSettings(): Promise<HostSettings> {
    return await getHostSettingsFromBackend(appMode, async (path, init) => {
      return await fetchBackend({
        backendStatus: getEmbeddedBackendStatus(),
        settingsToken: getEmbeddedBackendSettingsToken(),
        path,
        init
      });
    });
  }

  async function updateHostSettings(payload: UpdateHostSettingsPayload): Promise<HostSettings> {
    return await updateHostSettingsViaBackend(appMode, payload, async (path, init) => {
      return await fetchBackend({
        backendStatus: getEmbeddedBackendStatus(),
        settingsToken: getEmbeddedBackendSettingsToken(),
        path,
        init
      });
    });
  }

  async function readHostSettingsFile(): Promise<HostSettings> {
    return await readJsonSettings<HostSettings>(getHostSettingsPath(app.getPath("userData")), existsSync, readFile);
  }

  async function writeHostSettingsFile(settings: HostSettings): Promise<void> {
    await writeJsonSettings(getHostSettingsPath(app.getPath("userData")), settings, mkdir, writeFile, dirname);
  }

  async function syncLaunchOnStartupSettings(): Promise<void> {
    await syncLaunchOnStartup({
      getHostSettingsWithRetry: async () => await getHostSettingsWithRetry(getHostSettings, delay),
      setLoginItemOpenAtLogin: (enabled) => {
        app.setLoginItemSettings({ openAtLogin: enabled });
      }
    });
  }

  function updateHostTray(connected: boolean, viewerName?: string): void {
    updateTray({
      tray,
      Menu,
      productName,
      connected,
      viewerName,
      onOpen: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
      onQuit: () => {
        isQuitting = true;
        app.quit();
      }
    });
  }

  function openHostSettingsWindow(): void {
    if (settingsWindow && !settingsWindow.isDestroyed?.()) {
      settingsWindow.focus();
      return;
    }

    settingsWindow = new BrowserWindow(buildHostSettingsWindowOptions(currentDir, mainWindow as never)) as unknown as BrowserWindowLike;
    settingsWindow.on("closed", () => {
      settingsWindow = undefined;
      mainWindow?.webContents.send("host-settings-closed");
    });

    attachTrustedExternalOpenHandler(settingsWindow as never, (url) => {
      void openTrustedExternalUrl(url, isTrustedExternalUrl, (nextUrl) => shell.openExternal(nextUrl));
    });
    void loadWindowContent(
      settingsWindow as never,
      currentDir,
      isDev,
      process.env.ELECTRON_RENDERER_URL,
      "host-settings"
    );
  }

  function registerIpcHandlers(): void {
    registerWindowIpcHandlers({
      ipcMain,
      BrowserWindow,
      getMainWindow: () => mainWindow as never,
      openHostSettingsWindow
    });
    registerAppIpcHandlers({
      appMode,
      ipcMain,
      getLoginItemOpenAtLogin: () => app.getLoginItemSettings().openAtLogin,
      setLoginItemOpenAtLogin: (enabled) => {
        app.setLoginItemSettings({ openAtLogin: enabled });
      },
      getDeviceName: hostname,
      getHostSettings,
      updateHostSettings,
      readHostSettingsFile,
      writeHostSettingsFile,
      hashAccessPassword: async (password) => await hashAccessPassword(password, { scrypt: defaultScryptPromise }),
      sanitizeBoolean,
      sanitizeHostAccessPasswordInput,
      sanitizeHostPresencePayload,
      readAppSettings,
      writeAppSettings,
      getViewerSettings,
      sanitizeViewerSettingsPayload,
      sanitizeServerUrl,
      updateTray: updateHostTray,
      showHostNotification: (title, body) => {
        showHostNotification({
          appMode,
          title,
          body,
          notification: {
            isSupported: () => Notification.isSupported(),
            create: (options) => new Notification(options)
          }
        });
      },
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
      getDefaultSaveDirectory: () => getDefaultSaveDirectory(app.getPath("downloads")),
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
    registerDirectIpcHandlers({
      ipcMain,
      desktopCapturer,
      sanitizeControlMessage,
      applyHostControl,
      getEmbeddedBackendStatus,
      discoverServers
    });
  }

  function createTrayIfNeeded(): void {
    tray = createHostTray({
      Tray: Tray as never,
      Menu,
      icon: createTrayIcon(nativeImage),
      productName,
      onDoubleClick: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
      onOpen: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
      onQuit: () => {
        isQuitting = true;
        app.quit();
      }
    });
  }

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerIpcHandlers();
    void startEmbeddedBackend({ appMode, isDev });
    createWindow();
    if (appMode === "host") {
      createTrayIfNeeded();
      void syncLaunchOnStartupSettings();
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
    if (shouldDelayQuitForHostShutdown({
      appMode,
      hostShutdownNotificationSent,
      mainWindow
    })) {
      (event as { preventDefault: () => void }).preventDefault();
      hostShutdownNotificationSent = true;
      isQuitting = true;
      notifyHostShutdownAndQuit({
        mainWindow,
        stopEmbeddedBackend,
        appQuit: () => app.quit(),
        gracePeriodMs: hostShutdownGracePeriodMs
      });
      return;
    }

    isQuitting = true;
    stopEmbeddedBackend();
  });
}

if (process.versions.electron) {
  runDesktopMain();
}
