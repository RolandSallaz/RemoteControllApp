import type { PeerRole } from "@remote-control/shared";

import type { DesktopAppMode, DesktopCaptureSource } from "./env";

export type RemoteControlViewStateInput = {
  appMode: DesktopAppMode;
  isConnected: boolean;
  role: PeerRole;
  selectedSourceId: string;
  serverUrl: string;
  sessionId: string;
};

export type RemoteControlViewState = {
  appShellClassName: string;
  canConnect: boolean;
  isViewerConnected: boolean;
  isViewerMode: boolean;
};

export function getRemoteControlViewState({
  appMode,
  isConnected,
  role,
  selectedSourceId,
  serverUrl,
  sessionId
}: RemoteControlViewStateInput): RemoteControlViewState {
  const isViewerMode = appMode !== "host" && role === "viewer";
  const isViewerConnected = isViewerMode && isConnected;
  const appShellClassName = [
    "app-shell",
    appMode === "host" ? "host-mode" : "",
    isViewerMode && !isConnected ? "viewer-setup-mode" : "",
    isViewerConnected ? "viewer-connected-mode" : ""
  ].filter(Boolean).join(" ");

  return {
    appShellClassName,
    canConnect: Boolean(serverUrl.trim() && sessionId.trim() && (role === "viewer" || selectedSourceId)),
    isViewerConnected,
    isViewerMode
  };
}

export function getDisplayName(role: PeerRole, deviceName: string): string {
  const normalizedDeviceName = deviceName.trim();
  if (role === "viewer") {
    return normalizedDeviceName || "Viewer";
  }

  return "Server";
}

export function getDefaultCaptureSource(sources: DesktopCaptureSource[]): DesktopCaptureSource | undefined {
  return sources.find((source) => {
    const name = source.name.toLowerCase();
    return name.includes("screen") || name.includes("display") || name.includes("entire");
  }) ?? sources[0];
}

export function extractServerLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function formatLatency(value?: number): string {
  return typeof value === "number" ? `${value} ms` : "-";
}

export function formatBitrate(value?: number): string {
  return typeof value === "number" && value > 0 ? `${value} kbps` : "-";
}

export function formatPacketLoss(percent?: number, packetsLost?: number): string {
  if (typeof percent !== "number") {
    return "-";
  }

  return `${percent}%${typeof packetsLost === "number" ? ` (${packetsLost})` : ""}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
