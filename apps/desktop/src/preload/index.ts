import { clipboard, contextBridge, ipcRenderer } from "electron";
import type { ControlMessage } from "@remote-control/shared";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);

contextBridge.exposeInMainWorld("remoteControl", {
  appMode,
  productName: getProductName(appMode),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),
  getLaunchSettings: () => ipcRenderer.invoke("app:get-launch-settings"),
  setLaunchOnStartup: (enabled: boolean) => ipcRenderer.invoke("app:set-launch-settings", enabled),
  getHostAccessSettings: () => ipcRenderer.invoke("app:get-host-access-settings"),
  setHostAccessPassword: (password: string) => ipcRenderer.invoke("app:set-host-access-password", password),
  updateHostPresence: (payload: { connected: boolean; viewerName?: string }) => ipcRenderer.invoke("app:update-host-presence", payload),
  discoverServers: () => ipcRenderer.invoke("discovery:scan"),
  getViewerSettings: () => ipcRenderer.invoke("viewer:get-settings"),
  updateViewerSettings: (settings: unknown) => ipcRenderer.invoke("viewer:update-settings", settings),
  getRecentServers: () => ipcRenderer.invoke("history:get-servers"),
  addRecentServer: (serverUrl: string) => ipcRenderer.invoke("history:add-server", serverUrl),
  getDesktopSources: () => ipcRenderer.invoke("desktop:get-sources"),
  openHostSettings: () => ipcRenderer.invoke("window:open-host-settings"),
  onHostSettingsClosed: (callback: () => void) => {
    ipcRenderer.on("host-settings-closed", callback);
    return () => ipcRenderer.off("host-settings-closed", callback);
  },
  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  getFullscreenState: () => ipcRenderer.invoke("window:get-fullscreen"),
  applyControlMessage: (message: ControlMessage) => ipcRenderer.invoke("control:message", message),
  getFileSettings: () => ipcRenderer.invoke("files:get-settings"),
  chooseSaveDirectory: () => ipcRenderer.invoke("files:choose-directory"),
  openSaveDirectory: (path?: string) => ipcRenderer.invoke("files:open-folder", path),
  saveIncomingFile: (name: string, bytes: Uint8Array) => ipcRenderer.invoke("files:save", { name, bytes }),
  readClipboardText: () => clipboard.readText(),
  writeClipboardText: (text: string) => clipboard.writeText(text)
});

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
