import assert from "node:assert/strict";
import { test } from "node:test";

import { registerFileIpcHandlers } from "./fileIpc.js";

test("registerFileIpcHandlers manages save directory and transfer lifecycle", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const incomingFileSaves = new Map();
  const appended: Array<{ path: string; bytes: Buffer }> = [];
  let appSettings: Record<string, unknown> = {};

  registerFileIpcHandlers({
    appMode: "viewer",
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
    getHostSettings: async () => ({ saveDirectory: "C:/host" }),
    updateHostSettings: async () => undefined,
    readAppSettings: async () => appSettings,
    writeAppSettings: async (settings) => {
      appSettings = settings;
    },
    getDefaultSaveDirectory: () => "C:/downloads",
    showOpenDialog: async () => ({ canceled: false, filePaths: ["C:/chosen"] }),
    openPath: async () => "",
    sanitizeOptionalFilePath: (value) => typeof value === "string" ? value : undefined,
    sanitizeStartIncomingTransferPayload: (value) => value as { transferId: string; name: string; size: number },
    sanitizeAppendIncomingTransferPayload: (value) => value as { transferId: string; index: number; bytes: Uint8Array },
    sanitizeTransferId: (value) => typeof value === "string" ? value : undefined,
    sanitizeFileName: (name) => name,
    createUniqueFilePath: async (directory, fileName) => `${directory}/${fileName}`,
    mkdir: async () => undefined,
    appendFile: async (path, bytes) => {
      appended.push({ path, bytes });
    },
    unlink: async () => undefined,
    incomingFileSaves
  });

  assert.deepEqual(await handlers.get("files:get-settings")?.(), { saveDirectory: "C:/downloads" });
  assert.deepEqual(await handlers.get("files:choose-directory")?.(), {
    ok: true,
    canceled: false,
    path: "C:/chosen"
  });
  assert.deepEqual(await handlers.get("files:start-incoming-transfer")?.({}, {
    transferId: "t1",
    name: "file.txt",
    size: 3
  }), {
    ok: true,
    path: "C:/chosen/file.txt"
  });
  assert.deepEqual(await handlers.get("files:append-incoming-transfer")?.({}, {
    transferId: "t1",
    index: 0,
    bytes: new Uint8Array([1, 2])
  }), {
    ok: true,
    receivedBytes: 2
  });
  assert.deepEqual(await handlers.get("files:append-incoming-transfer")?.({}, {
    transferId: "t1",
    index: 1,
    bytes: new Uint8Array([3])
  }), {
    ok: true,
    receivedBytes: 3
  });
  assert.deepEqual(await handlers.get("files:complete-incoming-transfer")?.({}, "t1"), {
    ok: true,
    path: "C:/chosen/file.txt"
  });
  assert.equal(appended.length, 2);
});

test("registerFileIpcHandlers rejects invalid inputs and oversized chunks", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const unlinked: string[] = [];
  const incomingFileSaves = new Map([
    ["t2", {
      expectedChunkIndex: 0,
      expectedSize: 1,
      filePath: "C:/downloads/file.txt",
      receivedBytes: 0
    }]
  ]);

  registerFileIpcHandlers({
    appMode: "viewer",
    ipcMain: { handle: (channel, listener) => handlers.set(channel, listener) },
    getHostSettings: async () => ({ saveDirectory: "C:/host" }),
    updateHostSettings: async () => undefined,
    readAppSettings: async () => ({ saveDirectory: "C:/downloads" }),
    writeAppSettings: async () => undefined,
    getDefaultSaveDirectory: () => "C:/downloads",
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    openPath: async () => "",
    sanitizeOptionalFilePath: () => undefined,
    sanitizeStartIncomingTransferPayload: () => undefined,
    sanitizeAppendIncomingTransferPayload: (value) => value as { transferId: string; index: number; bytes: Uint8Array },
    sanitizeTransferId: (value) => typeof value === "string" ? value : undefined,
    sanitizeFileName: (name) => name,
    createUniqueFilePath: async () => "unused",
    mkdir: async () => undefined,
    appendFile: async () => undefined,
    unlink: async (path) => {
      unlinked.push(path);
    },
    incomingFileSaves
  });

  assert.deepEqual(await handlers.get("files:open-folder")?.({}, "bad"), {
    ok: false,
    error: "Invalid folder path"
  });
  assert.deepEqual(await handlers.get("files:start-incoming-transfer")?.({}, {}), {
    ok: false,
    error: "Invalid file transfer start payload"
  });
  assert.deepEqual(await handlers.get("files:append-incoming-transfer")?.({}, {
    transferId: "t2",
    index: 0,
    bytes: new Uint8Array([1, 2])
  }), {
    ok: false,
    error: "File transfer exceeded expected size"
  });
  assert.deepEqual(unlinked, ["C:/downloads/file.txt"]);
});
