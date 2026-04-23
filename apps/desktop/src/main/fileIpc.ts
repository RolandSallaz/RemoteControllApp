import type { DesktopAppMode } from "../shared/appMeta.js";

type IpcMainLike = {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
};

export type IncomingFileSaveSession = {
  expectedChunkIndex: number;
  expectedSize: number;
  filePath: string;
  tempFilePath: string;
  receivedBytes: number;
};

type FileIpcDependencies = {
  appMode: DesktopAppMode;
  ipcMain: IpcMainLike;
  getHostSettings: () => Promise<{ saveDirectory?: string }>;
  updateHostSettings: (payload: { saveDirectory: string }) => Promise<unknown>;
  readAppSettings: () => Promise<Record<string, unknown> & { saveDirectory?: string }>;
  writeAppSettings: (settings: Record<string, unknown>) => Promise<void>;
  getDefaultSaveDirectory: () => string;
  showOpenDialog: (options: {
    title: string;
    properties: string[];
    defaultPath: string;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  openPath: (targetPath: string) => Promise<string>;
  sanitizeOptionalFilePath: (value: unknown) => string | undefined;
  sanitizeStartIncomingTransferPayload: (value: unknown) =>
    | { transferId: string; name: string; size: number }
    | undefined;
  sanitizeAppendIncomingTransferPayload: (value: unknown) =>
    | { transferId: string; index: number; bytes: Uint8Array }
    | undefined;
  sanitizeTransferId: (value: unknown) => string | undefined;
  sanitizeFileName: (name: string) => string;
  createUniqueFilePath: (directory: string, fileName: string) => Promise<string>;
  mkdir: (path: string, options: { recursive: true }) => Promise<void>;
  appendFile: (path: string, bytes: Buffer) => Promise<void>;
  rename: (fromPath: string, toPath: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  incomingFileSaves: Map<string, IncomingFileSaveSession>;
};

export function registerFileIpcHandlers({
  appMode,
  ipcMain,
  getHostSettings,
  updateHostSettings,
  readAppSettings,
  writeAppSettings,
  getDefaultSaveDirectory,
  showOpenDialog,
  openPath,
  sanitizeOptionalFilePath,
  sanitizeStartIncomingTransferPayload,
  sanitizeAppendIncomingTransferPayload,
  sanitizeTransferId,
  sanitizeFileName,
  createUniqueFilePath,
  mkdir,
  appendFile,
  rename,
  unlink,
  incomingFileSaves
}: FileIpcDependencies): void {
  ipcMain.handle("files:get-settings", async () => {
    const settings = appMode === "host"
      ? await getHostSettings()
      : await readAppSettings();
    return {
      saveDirectory: settings.saveDirectory ?? getDefaultSaveDirectory()
    };
  });

  ipcMain.handle("files:choose-directory", async () => {
    const currentSettings = appMode === "host"
      ? await getHostSettings()
      : await readAppSettings();
    const selected = await showOpenDialog({
      title: "Select folder for incoming files",
      properties: ["openDirectory", "createDirectory"],
      defaultPath: currentSettings.saveDirectory ?? getDefaultSaveDirectory()
    });

    if (selected.canceled || selected.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
        path: currentSettings.saveDirectory ?? getDefaultSaveDirectory()
      };
    }

    const nextPath = selected.filePaths[0];
    if (appMode === "host") {
      await updateHostSettings({ saveDirectory: nextPath });
    } else {
      await writeAppSettings({ ...currentSettings, saveDirectory: nextPath });
    }
    return { ok: true, canceled: false, path: nextPath };
  });

  ipcMain.handle("files:open-folder", async (_event, path?: unknown) => {
    try {
      const requestedPath = sanitizeOptionalFilePath(path);
      if (path !== undefined && !requestedPath) {
        return { ok: false, error: "Invalid folder path" };
      }

      const settings = appMode === "host"
        ? await getHostSettings()
        : await readAppSettings();
      const targetPath = requestedPath || settings.saveDirectory || getDefaultSaveDirectory();
      await openPath(targetPath);
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:start-incoming-transfer", async (_event, payload: unknown) => {
    try {
      const transferPayload = sanitizeStartIncomingTransferPayload(payload);
      if (!transferPayload) {
        return { ok: false, error: "Invalid file transfer start payload" };
      }

      if (incomingFileSaves.has(transferPayload.transferId)) {
        return { ok: false, error: "File transfer already exists" };
      }

      const settings = appMode === "host"
        ? await getHostSettings()
        : await readAppSettings();
      const saveDirectory = settings.saveDirectory ?? getDefaultSaveDirectory();
      await mkdir(saveDirectory, { recursive: true });

      const safeName = sanitizeFileName(transferPayload.name);
      const filePath = await createUniqueFilePath(saveDirectory, safeName);
      const tempFilePath = `${filePath}.part`;
      incomingFileSaves.set(transferPayload.transferId, {
        expectedChunkIndex: 0,
        expectedSize: transferPayload.size,
        filePath,
        tempFilePath,
        receivedBytes: 0
      });

      return { ok: true, path: filePath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:append-incoming-transfer", async (_event, payload: unknown) => {
    try {
      const transferPayload = sanitizeAppendIncomingTransferPayload(payload);
      if (!transferPayload) {
        return { ok: false, error: "Invalid file transfer chunk payload" };
      }

      const transfer = incomingFileSaves.get(transferPayload.transferId);
      if (!transfer) {
        return { ok: false, error: "Unknown file transfer" };
      }

      if (transferPayload.index !== transfer.expectedChunkIndex) {
        return { ok: false, error: "Out-of-order file chunk" };
      }

      const bytes = Buffer.from(transferPayload.bytes);
      if (transfer.receivedBytes + bytes.byteLength > transfer.expectedSize) {
        incomingFileSaves.delete(transferPayload.transferId);
        await unlink(transfer.tempFilePath).catch(() => undefined);
        return { ok: false, error: "File transfer exceeded expected size" };
      }

      await appendFile(transfer.tempFilePath, bytes);
      transfer.receivedBytes += bytes.byteLength;
      transfer.expectedChunkIndex += 1;
      return { ok: true, receivedBytes: transfer.receivedBytes };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:complete-incoming-transfer", async (_event, transferIdValue: unknown) => {
    try {
      const transferId = sanitizeTransferId(transferIdValue);
      const transfer = transferId ? incomingFileSaves.get(transferId) : undefined;
      if (!transferId || !transfer) {
        return { ok: false, error: "Unknown file transfer" };
      }

      incomingFileSaves.delete(transferId);
      if (transfer.receivedBytes !== transfer.expectedSize) {
        await unlink(transfer.tempFilePath).catch(() => undefined);
        return { ok: false, error: "File transfer incomplete" };
      }

      await rename(transfer.tempFilePath, transfer.filePath);
      return { ok: true, path: transfer.filePath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, error: reason };
    }
  });

  ipcMain.handle("files:abort-incoming-transfer", async (_event, transferIdValue: unknown) => {
    const transferId = sanitizeTransferId(transferIdValue);
    const transfer = transferId ? incomingFileSaves.get(transferId) : undefined;
    if (transferId && transfer) {
      incomingFileSaves.delete(transferId);
      await unlink(transfer.tempFilePath).catch(() => undefined);
    }

    return { ok: true };
  });
}
