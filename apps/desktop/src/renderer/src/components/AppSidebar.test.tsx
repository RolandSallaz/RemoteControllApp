import assert from "node:assert/strict";
import React, { createRef } from "react";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AppSidebar } from "./AppSidebar";

const noop = (): void => undefined;

test("AppSidebar renders host status and transfer controls", () => {
  const markup = renderToStaticMarkup(
    <AppSidebar
      appMode="host"
      backendStatus={{ status: "running", url: "http://127.0.0.1:47315" }}
      canConnect
      captureLocalInput={false}
      captureMode="desktop"
      connectInFullscreen
      disconnectShortcut="Ctrl+Alt+D"
      discoveredServers={[]}
      fileInputRef={createRef<HTMLInputElement>()}
      frameRate={30}
      isConnected
      isDiscovering={false}
      isSetupSettingsOpen={false}
      peer={{ clientId: "viewer-1", role: "viewer", displayName: "DESKTOP-01" }}
      receiveStreamAudio
      recentServers={[]}
      role="host"
      serverLatencies={new Map()}
      serverUrl="http://127.0.0.1:47315"
      status="Ready"
      switchMonitorShortcut="Ctrl+Alt+M"
      transferLabel="report.txt"
      transferProgress={50}
      viewerFrameRate={30}
      onCaptureLocalInputChange={noop}
      onCaptureModeChange={noop}
      onConnect={noop}
      onConnectInFullscreenChange={noop}
      onDisconnect={noop}
      onDisconnectShortcutChange={noop}
      onFileInputChange={noop}
      onFrameRateChange={noop}
      onOpenHostSettings={noop}
      onReceiveAudioChange={noop}
      onScanServers={noop}
      onSelectFile={noop}
      onServerUrlChange={noop}
      onSetupSettingsToggle={noop}
      onSwitchMonitorShortcutChange={noop}
      onViewerFrameRateChange={noop}
    />
  );

  assert.match(markup, /Embedded Server/);
  assert.match(markup, /Running/);
  assert.match(markup, /DESKTOP-01/);
  assert.match(markup, /report\.txt/);
  assert.match(markup, /50%/);
});

test("AppSidebar renders viewer discovery and recent servers", () => {
  const markup = renderToStaticMarkup(
    <AppSidebar
      appMode="viewer"
      backendStatus={{ status: "disabled" }}
      canConnect
      captureLocalInput={false}
      captureMode="desktop"
      connectInFullscreen
      disconnectShortcut="Ctrl+Alt+D"
      discoveredServers={[{
        id: "server-1",
        name: "Office Host",
        address: "192.0.2.10",
        port: 47315,
        url: "http://192.0.2.10:47315",
        lastSeen: 1
      }]}
      fileInputRef={createRef<HTMLInputElement>()}
      frameRate={30}
      isConnected={false}
      isDiscovering={false}
      isSetupSettingsOpen
      receiveStreamAudio
      recentServers={["http://example.test:47315"]}
      role="viewer"
      serverLatencies={new Map([["http://192.0.2.10:47315", 12]])}
      serverUrl="http://192.0.2.10:47315"
      status="Ready"
      switchMonitorShortcut="Ctrl+Alt+M"
      viewerFrameRate={30}
      onCaptureLocalInputChange={noop}
      onCaptureModeChange={noop}
      onConnect={noop}
      onConnectInFullscreenChange={noop}
      onDisconnect={noop}
      onDisconnectShortcutChange={noop}
      onFileInputChange={noop}
      onFrameRateChange={noop}
      onOpenHostSettings={noop}
      onReceiveAudioChange={noop}
      onScanServers={noop}
      onSelectFile={noop}
      onServerUrlChange={noop}
      onSetupSettingsToggle={noop}
      onSwitchMonitorShortcutChange={noop}
      onViewerFrameRateChange={noop}
    />
  );

  assert.match(markup, /LAN Servers/);
  assert.match(markup, /Office Host/);
  assert.match(markup, /12 ms/);
  assert.match(markup, /example\.test:47315/);
  assert.match(markup, /Connection Settings/);
});
