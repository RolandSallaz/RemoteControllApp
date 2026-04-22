import type { ControlMessage } from "@remote-control/shared";

import { getProductName, type DesktopAppMode } from "../shared/appMeta.js";

export type ClipboardData = {
  html?: string;
  imageDataUrl?: string;
  text?: string;
};

type ClipboardWritePayload<TImage> = {
  html?: string;
  image?: TImage;
  text?: string;
};

type IpcRendererLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, callback: (...args: unknown[]) => void) => void;
  off: (channel: string, callback: (...args: unknown[]) => void) => void;
};

type ClipboardLike<TImage> = {
  readHTML: () => string;
  readImage: () => { isEmpty: () => boolean; toDataURL: () => string };
  readText: () => string;
  write: (data: ClipboardWritePayload<TImage>) => void;
  writeText: (text: string) => void;
};

type NativeImageLike<TImage> = {
  createFromDataURL: (dataUrl: string) => TImage;
};

type RemoteControlApiDependencies<TImage> = {
  appMode: DesktopAppMode;
  clipboard: ClipboardLike<TImage>;
  ipcRenderer: IpcRendererLike;
  nativeImage: NativeImageLike<TImage>;
};

export function createRemoteControlApi<TImage>({
  appMode,
  clipboard,
  ipcRenderer,
  nativeImage
}: RemoteControlApiDependencies<TImage>) {
  return {
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
    startIncomingFileTransfer: (transferId: string, name: string, size: number) =>
      ipcRenderer.invoke("files:start-incoming-transfer", { transferId, name, size }),
    appendIncomingFileTransfer: (transferId: string, index: number, bytes: Uint8Array) =>
      ipcRenderer.invoke("files:append-incoming-transfer", { transferId, index, bytes }),
    completeIncomingFileTransfer: (transferId: string) => ipcRenderer.invoke("files:complete-incoming-transfer", transferId),
    abortIncomingFileTransfer: (transferId: string) => ipcRenderer.invoke("files:abort-incoming-transfer", transferId),
    readClipboardData: () => readClipboardData(clipboard),
    writeClipboardData: (data: ClipboardData) => writeClipboardData(clipboard, nativeImage, data),
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (text: string) => clipboard.writeText(text)
  };
}

export function readClipboardData<TImage>(clipboard: ClipboardLike<TImage>): ClipboardData {
  const image = clipboard.readImage();
  return {
    html: clipboard.readHTML() || undefined,
    imageDataUrl: image.isEmpty() ? undefined : image.toDataURL(),
    text: clipboard.readText() || undefined
  };
}

export function writeClipboardData<TImage>(
  clipboard: ClipboardLike<TImage>,
  nativeImage: NativeImageLike<TImage>,
  data: ClipboardData
): void {
  const image = data.imageDataUrl
    ? nativeImage.createFromDataURL(data.imageDataUrl)
    : undefined;

  clipboard.write({
    html: data.html,
    image,
    text: data.text
  });
}
