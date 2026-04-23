import assert from "node:assert/strict";
import React, { createRef } from "react";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { VideoStage } from "./VideoStage";

const noop = (): void => undefined;

const baseProps = {
  activeRemoteSourceId: undefined,
  appMode: "viewer" as const,
  captureLocalInput: false,
  connectionStats: undefined,
  connectInFullscreen: true,
  controlEnabled: false,
  disconnectShortcut: "Ctrl+Alt+D",
  fileInputRef: createRef<HTMLInputElement>(),
  hostSources: [],
  isDraggingFile: false,
  isFullscreen: false,
  isHotkeysOpen: false,
  isViewerMode: true,
  isViewerSettingsOpen: false,
  localVideoRef: createRef<HTMLVideoElement>(),
  peer: undefined,
  receiveStreamAudio: true,
  remoteVideoRef: createRef<HTMLVideoElement>(),
  role: "viewer" as const,
  saveDirectory: "",
  selectedSource: undefined,
  switchMonitorShortcut: "Ctrl+Alt+M",
  transferLabel: undefined,
  transferProgress: undefined,
  viewerFrameRate: 30 as const,
  onChangeDisconnectShortcut: noop,
  onChangeSwitchMonitorShortcut: noop,
  onChooseSaveDirectory: noop,
  onCloseHotkeys: noop,
  onCloseViewerSettings: noop,
  onControl: noop,
  onDisconnect: noop,
  onFileInputChange: noop,
  onInputCaptureChange: noop,
  onSelectFile: noop,
  onSwitchRemoteSource: noop,
  onSwitchToNextRemoteSource: noop,
  onToggleCaptureLocalInput: noop,
  onToggleConnectInFullscreen: noop,
  onToggleControl: noop,
  onToggleFullscreen: noop,
  onToggleReceiveAudio: noop,
  onToggleViewerSettings: noop,
  onViewerFrameRateChange: noop
};

test("VideoStage is hidden for disconnected viewer setup mode", () => {
  const markup = renderToStaticMarkup(
    <VideoStage {...baseProps} isConnected={false} />
  );

  assert.equal(markup, "");
});

test("VideoStage renders connected viewer controls", () => {
  const markup = renderToStaticMarkup(
    <VideoStage
      {...baseProps}
      isConnected
      isHotkeysOpen
      peer={{ clientId: "host-1", role: "host", displayName: "Office Host" }}
    />
  );

  assert.match(markup, /Remote Desktop/);
  assert.match(markup, /Office Host is connected/);
  assert.match(markup, /Keyboard Shortcuts/);
  assert.match(markup, /RC/);
});
