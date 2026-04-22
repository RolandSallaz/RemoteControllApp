import { clipboard, contextBridge, ipcRenderer, nativeImage } from "electron";
import { createRemoteControlApi } from "./remoteControlApi.js";
import { normalizeAppMode } from "../shared/appMeta.js";

declare const __REMOTE_CONTROL_APP_MODE__: "combined" | "host" | "viewer";

const appMode = normalizeAppMode(__REMOTE_CONTROL_APP_MODE__);

contextBridge.exposeInMainWorld("remoteControl", createRemoteControlApi({
  appMode,
  clipboard,
  ipcRenderer,
  nativeImage
}));
