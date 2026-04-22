import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, Menu, desktopCapturer, ipcMain, shell } from "electron";
import type { ControlMessage } from "@remote-control/shared";

import { discoverServers } from "./discoveryClient.js";
import { getEmbeddedBackendStatus, startEmbeddedBackend, stopEmbeddedBackend } from "./backendProcess.js";
import { applyHostControl } from "./hostControl.js";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const currentDir = dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);
const productName = getProductName(appMode);

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

  ipcMain.handle("discovery:scan", async () => {
    return await discoverServers();
  });
}
