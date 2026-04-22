import { existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, Menu, desktopCapturer, dialog, ipcMain, shell } from "electron";
import type { ControlMessage } from "@remote-control/shared";

import { discoverServers } from "./discoveryClient.js";
import { getEmbeddedBackendStatus, startEmbeddedBackend, stopEmbeddedBackend } from "./backendProcess.js";
import { applyHostControl } from "./hostControl.js";
import { startAutoUpdate } from "./updater.js";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const currentDir = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);
const productName = getProductName(appMode);
const settingsPath = join(app.getPath("userData"), "settings.json");

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
    title: productName,
    backgroundColor: "#0b0d14",
    webPreferences: {
      preload: join(currentDir, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(productName);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process gone: ${details.reason} (${details.exitCode})`);
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL).then(() => {
      window.setTitle(productName);
    });
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html")).then(() => {
      window.setTitle(productName);
    });
  }
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

app.on("before-quit", () => {
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

  ipcMain.handle("files:get-settings", async () => {
    const settings = await readAppSettings();
    return {
      saveDirectory: settings.saveDirectory ?? getDefaultSaveDirectory()
    };
  });

  ipcMain.handle("files:choose-directory", async () => {
    const currentSettings = await readAppSettings();
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
    await writeAppSettings({ ...currentSettings, saveDirectory: nextPath });
    return { ok: true, canceled: false, path: nextPath };
  });

  ipcMain.handle("files:open-folder", async (_event, path?: string) => {
    try {
      const targetPath = path || (await readAppSettings()).saveDirectory || getDefaultSaveDirectory();
      await shell.openPath(targetPath);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:save", async (_event, payload: { name: string; bytes: Uint8Array }) => {
    try {
      const settings = await readAppSettings();
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

  ipcMain.handle("discovery:scan", async () => {
    return await discoverServers();
  });
}

function sanitizeFileName(name: string): string {
  const cleaned = basename(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned || "remote-control-file.bin";
}

function getDefaultSaveDirectory(): string {
  return join(app.getPath("downloads"), "RemoteControl");
}

type AppSettings = {
  saveDirectory?: string;
};

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
