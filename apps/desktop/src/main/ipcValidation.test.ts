import assert from "node:assert/strict";
import { test } from "node:test";

import {
  maxIncomingFileChunkBytes,
  maxIncomingFileTransferBytes,
  sanitizeAppendIncomingTransferPayload,
  sanitizeBoolean,
  sanitizeControlMessage,
  sanitizeHostAccessPasswordInput,
  sanitizeHostPresencePayload,
  sanitizeOptionalFilePath,
  sanitizeServerUrl,
  sanitizeStartIncomingTransferPayload,
  sanitizeTransferId,
  sanitizeViewerSettingsPayload
} from "./ipcValidation.js";

test("sanitizeControlMessage accepts bounded pointer and keyboard events", () => {
  assert.deepEqual(
    sanitizeControlMessage({
      kind: "pointer",
      event: {
        type: "move",
        sourceId: "screen:2",
        x: 10.4,
        y: 20.6,
        screenWidth: 1920,
        screenHeight: 1080
      }
    }),
    {
      kind: "pointer",
      event: {
        type: "move",
        sourceId: "screen:2",
        x: 10,
        y: 21,
        screenWidth: 1920,
        screenHeight: 1080
      }
    }
  );

  assert.deepEqual(
    sanitizeControlMessage({
      kind: "keyboard",
      event: {
        type: "keyDown",
        code: "KeyA",
        key: "a"
      }
    }),
    {
      kind: "keyboard",
      event: {
        type: "keyDown",
        code: "KeyA",
        key: "a"
      }
    }
  );
});

test("sanitizeControlMessage rejects malformed or oversized control events", () => {
  assert.equal(sanitizeControlMessage({ kind: "pointer", event: { type: "move", x: 1 } }), undefined);
  assert.equal(
    sanitizeControlMessage({
      kind: "pointer",
      event: {
        type: "click",
        button: "side",
        x: 10,
        y: 10,
        screenWidth: 100,
        screenHeight: 100
      }
    }),
    undefined
  );
  assert.deepEqual(
    sanitizeControlMessage({
      kind: "pointer",
      event: {
        type: "scroll",
        deltaX: 10_000,
        deltaY: -10_000
      }
    }),
    {
      kind: "pointer",
      event: {
        type: "scroll",
        deltaX: 5000,
        deltaY: -5000
      }
    }
  );
  assert.equal(
    sanitizeControlMessage({
      kind: "keyboard",
      event: {
        type: "typeText",
        text: "x".repeat(4097)
      }
    }),
    undefined
  );
  assert.equal(
    sanitizeControlMessage({
      kind: "keyboard",
      event: {
        type: "press",
        code: "KeyA",
        key: "a"
      }
    }),
    undefined
  );
});

test("settings validators reject unsafe IPC payloads", () => {
  assert.equal(sanitizeBoolean(true), true);
  assert.equal(sanitizeBoolean("true"), undefined);
  assert.equal(sanitizeHostAccessPasswordInput("secret"), "secret");
  assert.equal(sanitizeHostAccessPasswordInput("x".repeat(257)), undefined);
  assert.deepEqual(sanitizeHostPresencePayload({ connected: true, viewerName: " Viewer " }), {
    connected: true,
    viewerName: "Viewer"
  });
  assert.deepEqual(sanitizeHostPresencePayload({ connected: false, viewerName: "   " }), {
    connected: false
  });
  assert.equal(sanitizeHostPresencePayload({ connected: "yes" }), undefined);
  assert.equal(sanitizeServerUrl("file:///tmp/app"), undefined);
  assert.equal(sanitizeServerUrl("https://example.com/path/"), "https://example.com/path");
  assert.equal(sanitizeServerUrl("not-a-url"), undefined);
  assert.equal(sanitizeServerUrl(" http://localhost:47315/ "), "http://localhost:47315");
  assert.equal(sanitizeOptionalFilePath(undefined), undefined);
  assert.equal(sanitizeOptionalFilePath("C:\\Temp\\Folder"), "C:\\Temp\\Folder");
  assert.equal(sanitizeOptionalFilePath("x".repeat(2049)), undefined);
  assert.deepEqual(
    sanitizeViewerSettingsPayload({
      captureLocalInput: true,
      frameRate: 120,
      receiveAudio: false,
      switchMonitorShortcut: "Ctrl+Alt+Shift+M",
      takeControl: true,
      disconnectShortcut: "x".repeat(65)
    }),
    {
      captureLocalInput: true,
      receiveAudio: false,
      switchMonitorShortcut: "Ctrl+Alt+Shift+M",
      takeControl: true
    }
  );
});

test("file transfer validators enforce ids, sizes and chunk limits", () => {
  assert.equal(sanitizeTransferId(" transfer-1 "), "transfer-1");
  assert.equal(sanitizeTransferId("../transfer-1"), undefined);
  assert.equal(sanitizeTransferId("x".repeat(81)), undefined);
  assert.deepEqual(
    sanitizeStartIncomingTransferPayload({
      transferId: "transfer-1",
      name: "report.txt",
      size: 1024
    }),
    {
      transferId: "transfer-1",
      name: "report.txt",
      size: 1024
    }
  );

  assert.equal(
    sanitizeStartIncomingTransferPayload({
      transferId: "transfer-1",
      name: "report.txt",
      size: maxIncomingFileTransferBytes + 1
    }),
    undefined
  );
  assert.equal(
    sanitizeStartIncomingTransferPayload({
      transferId: "transfer-1",
      name: "report.txt",
      size: -1
    }),
    undefined
  );

  assert.equal(
    sanitizeAppendIncomingTransferPayload({
      transferId: "bad/id",
      index: 0,
      bytes: new Uint8Array(1)
    }),
    undefined
  );

  assert.equal(
    sanitizeAppendIncomingTransferPayload({
      transferId: "transfer-1",
      index: 0,
      bytes: new Uint8Array(maxIncomingFileChunkBytes + 1)
    }),
    undefined
  );
  assert.equal(
    sanitizeAppendIncomingTransferPayload({
      transferId: "transfer-1",
      index: -1,
      bytes: new Uint8Array([1, 2, 3])
    }),
    undefined
  );

  assert.deepEqual(
    sanitizeAppendIncomingTransferPayload({
      transferId: "transfer-1",
      index: 1,
      bytes: new Uint8Array([1, 2, 3])
    }),
    {
      transferId: "transfer-1",
      index: 1,
      bytes: new Uint8Array([1, 2, 3])
    }
  );
});
