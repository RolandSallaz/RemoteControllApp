import { clipboard, contextBridge, ipcRenderer, nativeImage } from "electron";
import type { ControlMessage } from "@remote-control/shared";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);

type ClipboardData = {
  html?: string;
  imageDataUrl?: string;
  text?: string;
};

contextBridge.exposeInMainWorld("remoteControl", {
  appMode,
  productName: getProductName(appMode),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),
  getLaunchSettings: () => ipcRenderer.invoke("app:get-launch-settings"),
  setLaunchOnStartup: (enabled: boolean) => ipcRenderer.invoke("app:set-launch-settings", enabled),
  getHostAccessSettings: () => ipcRenderer.invoke("app:get-host-access-settings"),
  setHostAccessPassword: (password: string) => ipcRenderer.invoke("app:set-host-access-password", password),
  setRequireViewerApproval: (enabled: boolean) => ipcRenderer.invoke("app:set-require-viewer-approval", enabled),
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
  onHostShutdownRequested: (callback: () => void) => {
    const handler = (): void => callback();
    ipcRenderer.on("app:host-shutdown-requested", handler);
    return () => ipcRenderer.off("app:host-shutdown-requested", handler);
  },
  toggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  getFullscreenState: () => ipcRenderer.invoke("window:get-fullscreen"),
  applyControlMessage: (message: ControlMessage) => ipcRenderer.invoke("control:message", message),
  getFileSettings: () => ipcRenderer.invoke("files:get-settings"),
  chooseSaveDirectory: () => ipcRenderer.invoke("files:choose-directory"),
  openSaveDirectory: (path?: string) => ipcRenderer.invoke("files:open-folder", path),
  saveIncomingFile: (name: string, bytes: Uint8Array) => ipcRenderer.invoke("files:save", { name, bytes }),
  startIncomingFileTransfer: (transferId: string, name: string, size: number) =>
    ipcRenderer.invoke("files:start-incoming-transfer", { transferId, name, size }),
  appendIncomingFileTransfer: (transferId: string, index: number, bytes: Uint8Array) =>
    ipcRenderer.invoke("files:append-incoming-transfer", { transferId, index, bytes }),
  completeIncomingFileTransfer: (transferId: string) => ipcRenderer.invoke("files:complete-incoming-transfer", transferId),
  abortIncomingFileTransfer: (transferId: string) => ipcRenderer.invoke("files:abort-incoming-transfer", transferId),
  readClipboardData: () => readClipboardData(),
  writeClipboardData: (data: ClipboardData) => writeClipboardData(data),
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

function readClipboardData(): ClipboardData {
  const image = clipboard.readImage();
  return {
    html: clipboard.readHTML() || undefined,
    imageDataUrl: image.isEmpty() ? undefined : image.toDataURL(),
    text: clipboard.readText() || undefined
  };
}

function writeClipboardData(data: ClipboardData): void {
  const image = data.imageDataUrl
    ? nativeImage.createFromDataURL(data.imageDataUrl)
    : undefined;

  clipboard.write({
    html: data.html,
    image,
    text: data.text
  });
}
