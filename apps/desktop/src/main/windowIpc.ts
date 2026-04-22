type WindowLike = {
  isFullScreen: () => boolean;
  setFullScreen: (state: boolean) => void;
};

type BrowserWindowStaticLike = {
  getFocusedWindow: () => WindowLike | null;
};

type IpcMainLike = {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
};

type WindowIpcDependencies = {
  ipcMain: IpcMainLike;
  BrowserWindow: BrowserWindowStaticLike;
  getMainWindow: () => WindowLike | undefined;
  openHostSettingsWindow: () => void;
};

export function registerWindowIpcHandlers({
  ipcMain,
  BrowserWindow,
  getMainWindow,
  openHostSettingsWindow
}: WindowIpcDependencies): void {
  ipcMain.handle("window:toggle-fullscreen", () => {
    const window = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    if (!window) {
      return { ok: false };
    }

    const nextState = !window.isFullScreen();
    window.setFullScreen(nextState);
    return { ok: true, isFullScreen: nextState };
  });

  ipcMain.handle("window:get-fullscreen", () => {
    const window = BrowserWindow.getFocusedWindow() ?? getMainWindow();
    return { isFullScreen: window?.isFullScreen() ?? false };
  });

  ipcMain.handle("window:open-host-settings", () => {
    openHostSettingsWindow();
  });
}
