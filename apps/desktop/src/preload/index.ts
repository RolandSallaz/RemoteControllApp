import { contextBridge, ipcRenderer } from "electron";
import type { ControlMessage } from "@remote-control/shared";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);

contextBridge.exposeInMainWorld("remoteControl", {
  appMode,
  productName: getProductName(appMode),
  getBackendStatus: () => ipcRenderer.invoke("backend:status"),
  discoverServers: () => ipcRenderer.invoke("discovery:scan"),
  getDesktopSources: () => ipcRenderer.invoke("desktop:get-sources"),
  applyControlMessage: (message: ControlMessage) => ipcRenderer.invoke("control:message", message)
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
