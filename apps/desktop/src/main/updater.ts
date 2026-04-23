import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type AppLike = {
  isPackaged: boolean;
};

type DialogLike = {
  showMessageBox: (options: {
    type: "info";
    buttons: string[];
    defaultId: number;
    cancelId: number;
    title: string;
    message: string;
    detail: string;
  }) => Promise<{ response: number }>;
};

type AutoUpdaterLike = {
  channel?: string | null;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: string, listener: (...args: unknown[]) => void | Promise<void>) => void;
  checkForUpdatesAndNotify: () => Promise<unknown> | unknown;
  quitAndInstall: () => void;
};

type LoggerLike = {
  log: (message: string) => void;
  error: (message: string) => void;
};

type UpdateInfoLike = {
  version: string;
};

type ConfigureAutoUpdateOptions = {
  app: AppLike;
  appMode: "combined" | "host" | "viewer";
  autoUpdater: AutoUpdaterLike;
  dialog: DialogLike;
  isDev: boolean;
  logger?: LoggerLike;
  scheduleUpdateCheck?: (callback: () => void, delayMs: number) => unknown;
};

export function configureAutoUpdate({
  app,
  appMode,
  autoUpdater,
  dialog,
  isDev,
  logger = console,
  scheduleUpdateCheck = setTimeout
}: ConfigureAutoUpdateOptions): boolean {
  if (isDev || appMode === "combined" || !app.isPackaged) {
    return false;
  }

  autoUpdater.channel = appMode === "host" ? "server" : "client";
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    logger.log(`[updater] checking for updates on channel "${autoUpdater.channel}"`);
  });

  autoUpdater.on("update-available", (info) => {
    const updateInfo = info as UpdateInfoLike;
    logger.log(`[updater] update available: ${updateInfo.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    logger.log("[updater] no updates available");
  });

  autoUpdater.on("error", (error) => {
    const updateError = error as Error;
    logger.error(`[updater] ${updateError.message}`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const updateInfo = info as UpdateInfoLike;
    const windowTitle = appMode === "host" ? "RemoteControl Server" : "RemoteControl Client";
    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: windowTitle,
      message: "An update has been downloaded",
      detail: `Version ${updateInfo.version} is ready to install. Restart now to apply it.`
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  scheduleUpdateCheck(() => {
    void autoUpdater.checkForUpdatesAndNotify();
  }, 1500);

  return true;
}

export function startAutoUpdate(appMode: "combined" | "host" | "viewer", isDev: boolean): void {
  const { app, dialog } = require("electron") as typeof import("electron");
  const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");

  configureAutoUpdate({
    app,
    appMode,
    autoUpdater: autoUpdater as unknown as AutoUpdaterLike,
    dialog,
    isDev
  });
}
