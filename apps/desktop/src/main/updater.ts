import { app, dialog } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export function startAutoUpdate(appMode: "combined" | "host" | "viewer", isDev: boolean): void {
  if (isDev || appMode === "combined" || !app.isPackaged) {
    return;
  }

  autoUpdater.channel = appMode === "host" ? "server" : "client";
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log(`[updater] checking for updates on channel "${autoUpdater.channel}"`);
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[updater] update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[updater] no updates available");
  });

  autoUpdater.on("error", (error) => {
    console.error(`[updater] ${error.message}`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const windowTitle = appMode === "host" ? "RemoteControl Server" : "RemoteControl Client";
    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: windowTitle,
      message: "An update has been downloaded",
      detail: `Version ${info.version} is ready to install. Restart now to apply it.`
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify();
  }, 1500);
}
