import type { ControlMessage, DiscoveredServer } from "@remote-control/shared";

export type DesktopCaptureSource = {
  id: string;
  name: string;
  thumbnail: string;
};

export type DesktopAppMode = "combined" | "host" | "viewer";

export type EmbeddedBackendStatus = {
  status: "disabled" | "starting" | "running" | "stopped" | "error";
  port?: number;
  url?: string;
  error?: string;
};

export type ViewerSettings = {
  captureLocalInput: boolean;
  connectInFullscreen: boolean;
  disconnectShortcut: string;
  frameRate: 15 | 30 | 60;
  receiveAudio: boolean;
  switchMonitorShortcut: string;
};

declare global {
  interface Window {
    remoteControl: {
      appMode: DesktopAppMode;
      productName: string;
      getBackendStatus: () => Promise<EmbeddedBackendStatus>;
      getLaunchSettings: () => Promise<{ launchOnStartup: boolean }>;
      setLaunchOnStartup: (enabled: boolean) => Promise<{ ok: boolean; launchOnStartup?: boolean; error?: string }>;
      getHostAccessSettings: () => Promise<{ accessPassword: string }>;
      setHostAccessPassword: (password: string) => Promise<{ ok: boolean; accessPassword?: string; error?: string }>;
      updateHostPresence: (payload: { connected: boolean; viewerName?: string }) => Promise<{ ok: boolean }>;
      discoverServers: () => Promise<DiscoveredServer[]>;
      getViewerSettings: () => Promise<ViewerSettings>;
      updateViewerSettings: (settings: Partial<ViewerSettings>) => Promise<ViewerSettings>;
      getRecentServers: () => Promise<string[]>;
      addRecentServer: (serverUrl: string) => Promise<{ ok: boolean; recentServers?: string[] }>;
      getDesktopSources: () => Promise<DesktopCaptureSource[]>;
      openHostSettings: () => Promise<void>;
      onHostSettingsClosed: (callback: () => void) => () => void;
      toggleFullscreen: () => Promise<{ ok: boolean; isFullScreen?: boolean }>;
      getFullscreenState: () => Promise<{ isFullScreen: boolean }>;
      applyControlMessage: (message: ControlMessage) => Promise<{ ok: boolean; error?: string }>;
      getFileSettings: () => Promise<{ saveDirectory: string }>;
      chooseSaveDirectory: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
      openSaveDirectory: (path?: string) => Promise<{ ok: boolean; error?: string }>;
      saveIncomingFile: (name: string, bytes: Uint8Array) => Promise<{ ok: boolean; path?: string; error?: string }>;
      readClipboardText: () => string;
      writeClipboardText: (text: string) => void;
    };
  }
}
