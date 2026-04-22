import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseDataChannelMessage,
  sanitizeClipboardSyncMessage,
  sanitizeFileTransferChunkMessage,
  sanitizeFileTransferStartMessage,
  sanitizeHostCommandMessage,
  sanitizeHostStateMessage
} from "./RemoteControlClient.ts";

test("data channel parser rejects oversized raw messages", () => {
  const oversized = `"${"x".repeat(13 * 1024 * 1024)}"`;
  assert.equal(parseDataChannelMessage(oversized), undefined);
});

test("host state validation rejects duplicates and unknown active source", () => {
  assert.equal(sanitizeHostStateMessage({
    kind: "host-state",
    sources: [
      { id: "screen:1", name: "Primary" },
      { id: "screen:1", name: "Duplicate" }
    ]
  }), undefined);

  assert.equal(sanitizeHostStateMessage({
    kind: "host-state",
    activeSourceId: "screen:2",
    sources: [{ id: "screen:1", name: "Primary" }]
  }), undefined);
});

test("host command validation requires an actual stream update payload", () => {
  assert.equal(sanitizeHostCommandMessage({
    kind: "host-command",
    command: { type: "update-stream-settings" }
  }), undefined);

  assert.deepEqual(sanitizeHostCommandMessage({
    kind: "host-command",
    command: { type: "update-stream-settings", frameRate: 60 }
  }), {
    kind: "host-command",
    command: { type: "update-stream-settings", frameRate: 60 }
  });
});

test("clipboard sync validation accepts safe image urls and rejects malformed payloads", () => {
  const validImage = "data:image/png;base64,QUJDRA==";
  assert.deepEqual(sanitizeClipboardSyncMessage({
    kind: "clipboard-sync",
    imageDataUrl: validImage,
    text: "hello"
  }), {
    kind: "clipboard-sync",
    imageDataUrl: validImage,
    text: "hello"
  });

  assert.equal(sanitizeClipboardSyncMessage({
    kind: "clipboard-sync",
    imageDataUrl: "data:text/html;base64,QUJDRA=="
  }), undefined);

  assert.equal(sanitizeClipboardSyncMessage({
    kind: "clipboard-sync",
    imageDataUrl: "data:image/png;base64,***"
  }), undefined);
});

test("file transfer validation enforces mime types and decoded chunk size", () => {
  assert.deepEqual(sanitizeFileTransferStartMessage({
    kind: "file-transfer-start",
    transferId: "t1",
    name: "report.bin",
    mimeType: "bad mime",
    size: 12
  }), {
    kind: "file-transfer-start",
    transferId: "t1",
    name: "report.bin",
    mimeType: "application/octet-stream",
    size: 12
  });

  const chunkBase64 = Buffer.from("hello").toString("base64");
  assert.deepEqual(sanitizeFileTransferChunkMessage({
    kind: "file-transfer-chunk",
    transferId: "t1",
    index: 0,
    data: chunkBase64
  }), {
    kind: "file-transfer-chunk",
    transferId: "t1",
    index: 0,
    data: chunkBase64
  });

  const oversizedChunk = Buffer.alloc((72 * 1024) + 1, 1).toString("base64");
  assert.equal(sanitizeFileTransferChunkMessage({
    kind: "file-transfer-chunk",
    transferId: "t1",
    index: 0,
    data: oversizedChunk
  }), undefined);
});
