import { join } from "node:path";

import type { BrowserWindow } from "electron";

import type { DesktopAppMode } from "../shared/appMeta.js";

type WindowLoadTarget =
  | { kind: "url"; value: string }
  | { kind: "file"; value: string; query?: Record<string, string> };

export function buildWindowWebPreferences(currentDir: string, sandbox = false) {
  return {
    preload: join(currentDir, "../preload/index.mjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox
  };
}

export function buildMainWindowOptions(
  appMode: DesktopAppMode,
  currentDir: string,
  windowTitle: string,
  sandbox = false
) {
  const isHostMode = appMode === "host";

  return {
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
    webPreferences: buildWindowWebPreferences(currentDir, sandbox)
  };
}

export function buildHostSettingsWindowOptions(
  currentDir: string,
  parent: BrowserWindow | undefined,
  sandbox = false
) {
  return {
    width: 380,
    height: 440,
    resizable: false,
    maximizable: false,
    minimizable: false,
    autoHideMenuBar: true,
    title: "Host Settings",
    backgroundColor: "#0b0d14",
    parent,
    modal: true,
    webPreferences: buildWindowWebPreferences(currentDir, sandbox)
  };
}

export function getWindowLoadTarget(
  currentDir: string,
  isDev: boolean,
  rendererUrl: string | undefined,
  page?: "host-settings"
): WindowLoadTarget {
  if (isDev && rendererUrl) {
    return {
      kind: "url",
      value: page ? `${rendererUrl}?page=${page}` : rendererUrl
    };
  }

  return {
    kind: "file",
    value: join(currentDir, "../renderer/index.html"),
    query: page ? { page } : undefined
  };
}

export async function loadWindowContent(
  window: BrowserWindow,
  currentDir: string,
  isDev: boolean,
  rendererUrl: string | undefined,
  page?: "host-settings"
): Promise<void> {
  const target = getWindowLoadTarget(currentDir, isDev, rendererUrl, page);
  if (target.kind === "url") {
    await window.loadURL(target.value);
    return;
  }

  await window.loadFile(target.value, target.query ? { query: target.query } : undefined);
}

export function attachTrustedExternalOpenHandler(
  window: BrowserWindow,
  openTrustedExternalUrl: (url: string) => void
): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openTrustedExternalUrl(url);
    return { action: "deny" as const };
  });
}
