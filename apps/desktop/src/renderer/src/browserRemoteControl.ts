import {
  REMOTE_CONTROL_DISCOVERY_RESPONSE,
  type DiscoveredServer,
  type DiscoveryResponse
} from "@remote-control/shared";

import type { ViewerSettings } from "./env";

type BrowserIncomingTransfer = {
  chunks: Uint8Array[];
  name: string;
  receivedBytes: number;
  size: number;
};

const viewerSettingsKey = "remote-control.viewer-settings";
const recentServersKey = "remote-control.recent-servers";
const defaultViewerSettings: ViewerSettings = {
  captureLocalInput: false,
  connectInFullscreen: true,
  disconnectShortcut: "Ctrl+Alt+Shift+D",
  frameRate: 30,
  receiveAudio: true,
  switchMonitorShortcut: "Ctrl+Alt+Shift+M"
};

const incomingTransfers = new Map<string, BrowserIncomingTransfer>();

export function ensureRemoteControlApi(): void {
  if (window.remoteControl) {
    return;
  }

  window.remoteControl = {
    appMode: "viewer",
    isBrowser: true,
    productName: "RemoteControl Web Viewer",
    getDeviceName: async () => getBrowserDeviceName(),
    getBackendStatus: async () => ({ status: "disabled" }),
    getLaunchSettings: async () => ({ launchOnStartup: false }),
    setLaunchOnStartup: async () => ({ ok: false, error: "Launch on startup is only available in the desktop app" }),
    getHostAccessSettings: async () => ({
      accessPassword: "",
      accessPasswordSet: false,
      requireViewerApproval: false
    }),
    setHostAccessPassword: async () => ({ ok: false, error: "Host settings are only available in the desktop app" }),
    setRequireViewerApproval: async () => ({ ok: false, error: "Host settings are only available in the desktop app" }),
    updateHostPresence: async () => ({ ok: true }),
    discoverServers: discoverBrowserServer,
    getViewerSettings: async () => readViewerSettings(),
    updateViewerSettings: async (settings) => writeViewerSettings(settings),
    getRecentServers: async () => readRecentServers(),
    addRecentServer: async (serverUrl) => addRecentServer(serverUrl),
    getDesktopSources: async () => [],
    openHostSettings: async () => undefined,
    onHostSettingsClosed: () => () => undefined,
    onHostShutdownRequested: () => () => undefined,
    toggleFullscreen: toggleBrowserFullscreen,
    getFullscreenState: async () => ({ isFullScreen: Boolean(document.fullscreenElement) }),
    applyControlMessage: async () => ({ ok: false, error: "Host control is only available in the desktop app" }),
    getFileSettings: async () => ({ saveDirectory: "" }),
    chooseSaveDirectory: async () => ({ ok: false, canceled: true }),
    openSaveDirectory: async () => ({ ok: false, error: "Opening folders is only available in the desktop app" }),
    startIncomingFileTransfer: async (transferId, name, size) => startIncomingFileTransfer(transferId, name, size),
    appendIncomingFileTransfer: async (transferId, _index, bytes) => appendIncomingFileTransfer(transferId, bytes),
    completeIncomingFileTransfer: async (transferId) => completeIncomingFileTransfer(transferId),
    abortIncomingFileTransfer: async (transferId) => {
      incomingTransfers.delete(transferId);
      return { ok: true };
    },
    readClipboardData: () => ({}),
    writeClipboardData: (data) => {
      if (data.text) {
        void navigator.clipboard?.writeText(data.text);
      }
    },
    readClipboardText: () => "",
    writeClipboardText: (text) => {
      void navigator.clipboard?.writeText(text);
    }
  };
}

export function getBrowserDefaultServerUrl(): string {
  return window.remoteControl?.isBrowser && isHttpOrigin(window.location.origin)
    ? window.location.origin
    : "http://localhost:47315";
}

async function discoverBrowserServer(): Promise<DiscoveredServer[]> {
  if (!isHttpOrigin(window.location.origin)) {
    return [];
  }

  try {
    const response = await fetch(`${window.location.origin}/discovery`, {
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) {
      return [];
    }

    const discovery = await response.json() as Partial<DiscoveryResponse>;
    if (!isDiscoveryResponse(discovery)) {
      return [];
    }

    return [{
      id: discovery.id,
      name: discovery.name,
      address: window.location.hostname,
      port: discovery.port,
      url: discovery.url || window.location.origin,
      lastSeen: Date.now()
    }];
  } catch {
    return [];
  }
}

async function toggleBrowserFullscreen(): Promise<{ ok: boolean; isFullScreen?: boolean; error?: string }> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }

    return { ok: true, isFullScreen: Boolean(document.fullscreenElement) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function startIncomingFileTransfer(
  transferId: string,
  name: string,
  size: number
): { ok: boolean; path?: string; error?: string } {
  incomingTransfers.set(transferId, {
    chunks: [],
    name,
    receivedBytes: 0,
    size
  });
  return { ok: true, path: name };
}

function appendIncomingFileTransfer(
  transferId: string,
  bytes: Uint8Array
): { ok: boolean; receivedBytes?: number; error?: string } {
  const transfer = incomingTransfers.get(transferId);
  if (!transfer) {
    return { ok: false, error: "Unknown file transfer" };
  }

  transfer.chunks.push(bytes);
  transfer.receivedBytes += bytes.byteLength;
  return { ok: true, receivedBytes: transfer.receivedBytes };
}

function completeIncomingFileTransfer(transferId: string): { ok: boolean; path?: string; error?: string } {
  const transfer = incomingTransfers.get(transferId);
  if (!transfer) {
    return { ok: false, error: "Unknown file transfer" };
  }

  incomingTransfers.delete(transferId);
  const blob = new Blob(transfer.chunks.map(copyChunkToArrayBuffer));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = transfer.name;
  link.click();
  URL.revokeObjectURL(url);

  return { ok: true, path: transfer.name };
}

function readViewerSettings(): ViewerSettings {
  return {
    ...defaultViewerSettings,
    ...readJson<Partial<ViewerSettings>>(viewerSettingsKey, {})
  };
}

function writeViewerSettings(settings: Partial<ViewerSettings>): ViewerSettings {
  const nextSettings = {
    ...readViewerSettings(),
    ...settings
  };
  localStorage.setItem(viewerSettingsKey, JSON.stringify(nextSettings));
  return nextSettings;
}

function readRecentServers(): string[] {
  return readJson<string[]>(recentServersKey, []);
}

function addRecentServer(serverUrl: string): { ok: boolean; recentServers: string[] } {
  const normalizedServerUrl = serverUrl.trim();
  const recentServers = [
    normalizedServerUrl,
    ...readRecentServers().filter((item) => item !== normalizedServerUrl)
  ].filter(Boolean).slice(0, 5);

  localStorage.setItem(recentServersKey, JSON.stringify(recentServers));
  return { ok: true, recentServers };
}

function copyChunkToArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(chunk.byteLength);
  new Uint8Array(buffer).set(chunk);
  return buffer;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function getBrowserDeviceName(): string {
  const platform = navigator.platform || "Browser";
  return `${platform} Viewer`;
}

function isDiscoveryResponse(value: Partial<DiscoveryResponse>): value is DiscoveryResponse {
  return value.type === REMOTE_CONTROL_DISCOVERY_RESPONSE
    && value.version === 1
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.port === "number";
}

function isHttpOrigin(origin: string): boolean {
  return origin.startsWith("http://") || origin.startsWith("https://");
}
