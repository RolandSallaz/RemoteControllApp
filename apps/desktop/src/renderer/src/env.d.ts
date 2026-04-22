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

declare global {
  interface Window {
    remoteControl: {
      appMode: DesktopAppMode;
      productName: string;
      getBackendStatus: () => Promise<EmbeddedBackendStatus>;
      discoverServers: () => Promise<DiscoveredServer[]>;
      getDesktopSources: () => Promise<DesktopCaptureSource[]>;
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
