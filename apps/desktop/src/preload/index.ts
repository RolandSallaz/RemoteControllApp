import { createRequire } from "node:module";

import { createRemoteControlApi } from "./remoteControlApi.js";
import { normalizeAppMode, type DesktopAppMode } from "../shared/appMeta.js";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const require = createRequire(import.meta.url);

type ContextBridgeLike = {
  exposeInMainWorld: (key: string, value: unknown) => void;
};

type PreloadElectronDependencies<TClipboard, TIpcRenderer, TNativeImage> = {
  clipboard: TClipboard;
  contextBridge: ContextBridgeLike;
  ipcRenderer: TIpcRenderer;
  nativeImage: TNativeImage;
};

export function exposeRemoteControlApi<TClipboard, TIpcRenderer, TNativeImage>(options: {
  appMode: DesktopAppMode;
  clipboard: TClipboard;
  contextBridge: ContextBridgeLike;
  ipcRenderer: TIpcRenderer;
  nativeImage: TNativeImage;
}) {
  const api = createRemoteControlApi({
    appMode: options.appMode,
    clipboard: options.clipboard as never,
    ipcRenderer: options.ipcRenderer as never,
    nativeImage: options.nativeImage as never
  });

  options.contextBridge.exposeInMainWorld("remoteControl", api);
  return api;
}

export function resolvePreloadAppMode(appMode: "combined" | "host" | "viewer"): DesktopAppMode {
  return normalizeAppMode(appMode);
}

function runPreload(): void {
  const { clipboard, contextBridge, ipcRenderer, nativeImage } =
    require("electron") as typeof import("electron");

  exposeRemoteControlApi({
    appMode: resolvePreloadAppMode(__REMOTE_CONTROL_APP_MODE__),
    clipboard,
    contextBridge,
    ipcRenderer,
    nativeImage
  });
}

if (process.versions.electron) {
  runPreload();
}
