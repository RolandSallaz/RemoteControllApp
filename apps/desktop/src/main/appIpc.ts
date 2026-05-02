import type { DesktopAppMode } from "../shared/appMeta.js";

type IpcMainLike = {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
};

type AppSettings = {
  saveDirectory?: string;
  recentServers?: string[];
  viewer?: ViewerSettings;
};

type ViewerFrameRate = 15 | 30 | 60;

export type ViewerSettings = {
  captureLocalInput: boolean;
  connectInFullscreen: boolean;
  disconnectShortcut: string;
  frameRate: ViewerFrameRate;
  receiveAudio: boolean;
  switchMonitorShortcut: string;
  takeControl: boolean;
};

type AppIpcDependencies = {
  appMode: DesktopAppMode;
  ipcMain: IpcMainLike;
  getLoginItemOpenAtLogin: () => boolean;
  setLoginItemOpenAtLogin: (enabled: boolean) => void;
  getDeviceName: () => string;
  getHostSettings: () => Promise<Record<string, unknown> & { launchOnStartup?: boolean }>;
  updateHostSettings: (payload: Record<string, unknown>) => Promise<unknown>;
  readHostSettingsFile: () => Promise<Record<string, unknown> & {
    accessPassword?: string;
    accessPasswordHash?: string;
    requireViewerApproval?: boolean;
  }>;
  writeHostSettingsFile: (settings: Record<string, unknown>) => Promise<void>;
  hashAccessPassword: (password: string) => Promise<string>;
  sanitizeBoolean: (value: unknown) => boolean | undefined;
  sanitizeHostAccessPasswordInput: (value: unknown) => string | undefined;
  sanitizeHostPresencePayload: (value: unknown) => { connected: boolean; viewerName?: string } | undefined;
  readAppSettings: () => Promise<AppSettings>;
  writeAppSettings: (settings: AppSettings) => Promise<void>;
  getViewerSettings: (settings: AppSettings) => ViewerSettings;
  sanitizeViewerSettingsPayload: (payload: unknown) => Partial<ViewerSettings>;
  sanitizeServerUrl: (value: unknown) => string | undefined;
  updateTray: (connected: boolean, viewerName?: string) => void;
  showHostNotification: (title: string, body: string) => void;
  getLastViewerName: () => string | undefined;
  setLastViewerName: (name: string | undefined) => void;
};

export function registerAppIpcHandlers({
  appMode,
  ipcMain,
  getLoginItemOpenAtLogin,
  setLoginItemOpenAtLogin,
  getDeviceName,
  getHostSettings,
  updateHostSettings,
  readHostSettingsFile,
  writeHostSettingsFile,
  hashAccessPassword,
  sanitizeBoolean,
  sanitizeHostAccessPasswordInput,
  sanitizeHostPresencePayload,
  readAppSettings,
  writeAppSettings,
  getViewerSettings,
  sanitizeViewerSettingsPayload,
  sanitizeServerUrl,
  updateTray,
  showHostNotification,
  getLastViewerName,
  setLastViewerName
}: AppIpcDependencies): void {
  ipcMain.handle("app:get-device-name", () => sanitizeDeviceName(getDeviceName()));

  ipcMain.handle("app:get-launch-settings", async () => {
    if (appMode !== "host") {
      return { launchOnStartup: false };
    }

    let settings: Record<string, unknown> & { launchOnStartup?: boolean } = {};
    try {
      settings = await getHostSettings();
    } catch {
      // The embedded backend may still be starting. Fall back to the local OS login setting.
    }

    return {
      launchOnStartup: settings.launchOnStartup ?? getLoginItemOpenAtLogin()
    };
  });

  ipcMain.handle("app:set-launch-settings", async (_event, enabled: unknown) => {
    if (appMode !== "host") {
      return { ok: false, error: "Launch settings are available only in host mode" };
    }

    const launchOnStartup = sanitizeBoolean(enabled);
    if (typeof launchOnStartup !== "boolean") {
      return { ok: false, error: "Invalid launch setting" };
    }

    try {
      const previousOpenAtLogin = getLoginItemOpenAtLogin();
      setLoginItemOpenAtLogin(launchOnStartup);

      try {
        await updateHostSettings({ launchOnStartup });
      } catch (error) {
        setLoginItemOpenAtLogin(previousOpenAtLogin);
        throw error;
      }

      return { ok: true, launchOnStartup };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("app:get-host-access-settings", async () => {
    if (appMode !== "host") {
      return {
        accessPassword: "",
        accessPasswordSet: false,
        requireViewerApproval: true
      };
    }

    const settings = await readHostSettingsFile();
    return {
      accessPassword: settings.accessPasswordHash ? "" : settings.accessPassword ?? "",
      accessPasswordSet: Boolean(settings.accessPasswordHash || settings.accessPassword),
      requireViewerApproval: settings.requireViewerApproval ?? true
    };
  });

  ipcMain.handle("app:set-host-access-password", async (_event, password: unknown) => {
    if (appMode !== "host") {
      return { ok: false, error: "Host password settings are available only in host mode" };
    }

    const passwordValue = sanitizeHostAccessPasswordInput(password);
    if (typeof passwordValue !== "string") {
      return { ok: false, error: "Invalid host password" };
    }

    try {
      const normalizedPassword = passwordValue.trim();
      const settings = await readHostSettingsFile();
      const {
        accessPassword: _legacyAccessPassword,
        accessPasswordHash: _previousAccessPasswordHash,
        ...safeSettings
      } = settings;
      const nextSettings = {
        ...safeSettings,
        accessPasswordHash: normalizedPassword
          ? await hashAccessPassword(normalizedPassword)
          : undefined
      };
      await writeHostSettingsFile(nextSettings);
      return {
        ok: true,
        accessPassword: "",
        accessPasswordSet: Boolean(normalizedPassword)
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("app:set-require-viewer-approval", async (_event, enabled: unknown) => {
    if (appMode !== "host") {
      return { ok: false, error: "Host approval settings are available only in host mode" };
    }

    const requireViewerApproval = sanitizeBoolean(enabled);
    if (typeof requireViewerApproval !== "boolean") {
      return { ok: false, error: "Invalid approval setting" };
    }

    try {
      const settings = await readHostSettingsFile();
      await writeHostSettingsFile({
        ...settings,
        requireViewerApproval
      });
      return { ok: true, requireViewerApproval };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("app:update-host-presence", (_event, payload: unknown) => {
    if (appMode !== "host") {
      return { ok: false };
    }

    const hostPresence = sanitizeHostPresencePayload(payload);
    if (!hostPresence) {
      return { ok: false };
    }

    updateTray(hostPresence.connected, hostPresence.viewerName);
    const previousViewerName = getLastViewerName();
    setLastViewerName(hostPresence.connected ? hostPresence.viewerName : undefined);

    if (hostPresence.connected && hostPresence.viewerName && hostPresence.viewerName !== previousViewerName) {
      showHostNotification("Viewer connected", `${hostPresence.viewerName} connected to this host`);
    }

    if (!hostPresence.connected && previousViewerName) {
      showHostNotification("Viewer disconnected", `${previousViewerName} disconnected`);
    }

    return { ok: true };
  });

  ipcMain.handle("viewer:get-settings", async () => {
    const settings = await readAppSettings();
    return getViewerSettings(settings);
  });

  ipcMain.handle("viewer:update-settings", async (_event, payload: unknown) => {
    const settings = await readAppSettings();
    const nextViewerSettings: ViewerSettings = {
      ...getViewerSettings(settings),
      ...sanitizeViewerSettingsPayload(payload)
    };

    await writeAppSettings({
      ...settings,
      viewer: nextViewerSettings
    });

    return nextViewerSettings;
  });

  ipcMain.handle("history:get-servers", async () => {
    const settings = await readAppSettings();
    return settings.recentServers ?? [];
  });

  ipcMain.handle("history:add-server", async (_event, serverUrl: unknown) => {
    const normalized = sanitizeServerUrl(serverUrl);
    if (!normalized) {
      return { ok: false };
    }

    const settings = await readAppSettings();
    const nextRecentServers = [normalized, ...(settings.recentServers ?? []).filter((item) => item !== normalized)].slice(0, 8);
    await writeAppSettings({ ...settings, recentServers: nextRecentServers });
    return { ok: true, recentServers: nextRecentServers };
  });
}

function sanitizeDeviceName(value: string): string {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalized.slice(0, 80) || "Unknown device";
}
