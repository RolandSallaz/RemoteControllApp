import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractServerLabel,
  formatBitrate,
  formatFileSize,
  formatLatency,
  formatPacketLoss,
  getDefaultCaptureSource,
  getDisplayName,
  getRemoteControlViewState
} from "./appLogic";

test("viewer identity uses the device name instead of a generated viewer label", () => {
  assert.equal(getDisplayName("viewer", "DESKTOP-01"), "DESKTOP-01");
  assert.equal(getDisplayName("viewer", "  Laptop  "), "Laptop");
  assert.equal(getDisplayName("viewer", "   "), "Viewer");
  assert.equal(getDisplayName("host", "DESKTOP-01"), "Server");
});

test("connection view state derives setup and connected modes", () => {
  assert.deepEqual(getRemoteControlViewState({
    appMode: "viewer",
    isConnected: false,
    role: "viewer",
    selectedSourceId: "",
    serverUrl: " http://localhost:47315 ",
    sessionId: " LAN "
  }), {
    appShellClassName: "app-shell viewer-setup-mode",
    canConnect: true,
    isViewerConnected: false,
    isViewerMode: true
  });

  assert.deepEqual(getRemoteControlViewState({
    appMode: "viewer",
    isConnected: true,
    role: "viewer",
    selectedSourceId: "",
    serverUrl: "http://localhost:47315",
    sessionId: "LAN"
  }), {
    appShellClassName: "app-shell viewer-connected-mode",
    canConnect: true,
    isViewerConnected: true,
    isViewerMode: true
  });
});

test("host connection state requires a capture source", () => {
  assert.equal(getRemoteControlViewState({
    appMode: "host",
    isConnected: false,
    role: "host",
    selectedSourceId: "",
    serverUrl: "http://localhost:47315",
    sessionId: "LAN"
  }).canConnect, false);

  assert.deepEqual(getRemoteControlViewState({
    appMode: "host",
    isConnected: false,
    role: "host",
    selectedSourceId: "screen:1",
    serverUrl: "http://localhost:47315",
    sessionId: "LAN"
  }), {
    appShellClassName: "app-shell host-mode",
    canConnect: true,
    isViewerConnected: false,
    isViewerMode: false
  });
});

test("capture source selection prefers screen display sources", () => {
  const fallback = { id: "window:1", name: "Application", thumbnail: "" };
  const display = { id: "screen:1", name: "Entire Screen", thumbnail: "" };

  assert.deepEqual(getDefaultCaptureSource([fallback, display]), display);
  assert.deepEqual(getDefaultCaptureSource([fallback]), fallback);
  assert.equal(getDefaultCaptureSource([]), undefined);
});

test("renderer formatting helpers keep connection stats readable", () => {
  assert.equal(extractServerLabel("http://example.test:47315/path"), "example.test:47315");
  assert.equal(extractServerLabel("not a url"), "not a url");
  assert.equal(formatLatency(42), "42 ms");
  assert.equal(formatLatency(), "-");
  assert.equal(formatBitrate(1200), "1200 kbps");
  assert.equal(formatBitrate(0), "-");
  assert.equal(formatPacketLoss(1.5, 3), "1.5% (3)");
  assert.equal(formatPacketLoss(), "-");
  assert.equal(formatFileSize(1024), "1 KB");
  assert.equal(formatFileSize(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatFileSize(2 * 1024 * 1024 * 1024), "2.0 GB");
});
