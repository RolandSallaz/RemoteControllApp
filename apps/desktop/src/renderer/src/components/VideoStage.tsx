import type { ChangeEvent, ReactElement, RefObject } from "react";
import type { ControlMessage, HostSource, PeerJoinedPayload, PeerRole } from "@remote-control/shared";

import type { DesktopAppMode, DesktopCaptureSource } from "../env";
import type { ConnectionStats, FrameRate } from "../webrtc/RemoteControlClient";
import { HotkeysPanel, VideoEmpty } from "./common";
import { RemoteVideo } from "./RemoteVideo";
import { ViewerSettingsOverlay } from "./ViewerSettingsOverlay";

export function VideoStage({
  activeRemoteSourceId,
  appMode,
  captureLocalInput,
  connectionStats,
  connectInFullscreen,
  controlEnabled,
  disconnectShortcut,
  fileInputRef,
  hostSources,
  isConnected,
  isDraggingFile,
  isFullscreen,
  isHotkeysOpen,
  isViewerMode,
  isViewerSettingsOpen,
  localVideoRef,
  peer,
  receiveStreamAudio,
  remoteVideoRef,
  role,
  saveDirectory,
  selectedSource,
  switchMonitorShortcut,
  transferLabel,
  transferProgress,
  viewerFrameRate,
  onChangeDisconnectShortcut,
  onChangeSwitchMonitorShortcut,
  onChooseSaveDirectory,
  onCloseHotkeys,
  onCloseViewerSettings,
  onControl,
  onDisconnect,
  onFileInputChange,
  onInputCaptureChange,
  onSelectFile,
  onSwitchRemoteSource,
  onSwitchToNextRemoteSource,
  onToggleCaptureLocalInput,
  onToggleConnectInFullscreen,
  onToggleControl,
  onToggleFullscreen,
  onToggleReceiveAudio,
  onToggleViewerSettings,
  onViewerFrameRateChange
}: {
  activeRemoteSourceId?: string;
  appMode: DesktopAppMode;
  captureLocalInput: boolean;
  connectionStats?: ConnectionStats;
  connectInFullscreen: boolean;
  controlEnabled: boolean;
  disconnectShortcut: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  hostSources: HostSource[];
  isConnected: boolean;
  isDraggingFile: boolean;
  isFullscreen: boolean;
  isHotkeysOpen: boolean;
  isViewerMode: boolean;
  isViewerSettingsOpen: boolean;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  peer?: PeerJoinedPayload;
  receiveStreamAudio: boolean;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  role: PeerRole;
  saveDirectory: string;
  selectedSource?: DesktopCaptureSource;
  switchMonitorShortcut: string;
  transferLabel?: string;
  transferProgress?: number;
  viewerFrameRate: FrameRate;
  onChangeDisconnectShortcut: (shortcut: string) => void;
  onChangeSwitchMonitorShortcut: (shortcut: string) => void;
  onChooseSaveDirectory: () => void;
  onCloseHotkeys: () => void;
  onCloseViewerSettings: () => void;
  onControl: (message: ControlMessage) => void;
  onDisconnect: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onInputCaptureChange: (enabled: boolean) => void;
  onSelectFile: () => void;
  onSwitchRemoteSource: (sourceId: string) => void;
  onSwitchToNextRemoteSource: () => void;
  onToggleCaptureLocalInput: (enabled: boolean) => void;
  onToggleConnectInFullscreen: (enabled: boolean) => void;
  onToggleControl: (enabled: boolean) => void;
  onToggleFullscreen: () => void;
  onToggleReceiveAudio: (enabled: boolean) => void;
  onToggleViewerSettings: () => void;
  onViewerFrameRateChange: (frameRate: FrameRate) => void;
}): ReactElement | null {
  if (appMode === "host" || (isViewerMode && !isConnected)) {
    return null;
  }

  return (
    <section
      className={`video-stage${role === "viewer" && isDraggingFile ? " drag-active" : ""}`}
    >
      <div className="video-overlay-header">
        <div>
          <div className="video-stage-title">
            {role === "host" ? "Shared Desktop" : "Remote Desktop"}
            {selectedSource && role === "host" ? ` - ${selectedSource.name}` : ""}
          </div>
          <div className="video-stage-sub">
            {peer ? `${peer.displayName ?? peer.role} is connected` : "Waiting for peer..."}
          </div>
        </div>
      </div>

      {role === "viewer" && (
        <div className={`video-drop-overlay${isDraggingFile ? " visible" : ""}`}>
          <div className="video-drop-card">
            <div className="video-drop-title">Drop files to transfer</div>
            <div className="video-drop-sub">Release to send the file to the remote host</div>
          </div>
        </div>
      )}

      {role === "host" ? (
        isConnected ? (
          <video ref={localVideoRef} className="desktop-video" autoPlay muted playsInline />
        ) : (
          <VideoEmpty
            icon="SCREEN"
            title="Ready to share"
            sub={
              selectedSource
                ? `Will share "${selectedSource.name}" when connected`
                : "Select a capture source and connect"
            }
          />
        )
      ) : isConnected ? (
        <>
          <RemoteVideo
            videoRef={remoteVideoRef}
            controlEnabled={controlEnabled}
            disconnectShortcut={disconnectShortcut}
            inputCaptureEnabled={captureLocalInput && controlEnabled}
            receiveAudio={receiveStreamAudio}
            switchMonitorShortcut={switchMonitorShortcut}
            onControl={onControl}
            onDisconnectShortcut={onDisconnect}
            onInputCaptureChange={onInputCaptureChange}
            onSwitchMonitorShortcut={onSwitchToNextRemoteSource}
            onToggleFullscreen={onToggleFullscreen}
          />
          {captureLocalInput && controlEnabled && (
            <div className="input-capture-hint">
              Input captured. Press Ctrl+Alt+Shift+Esc to exit.
            </div>
          )}
          <ViewerSettingsOverlay
            activeRemoteSourceId={activeRemoteSourceId}
            captureLocalInput={captureLocalInput}
            connectionStats={connectionStats}
            connectInFullscreen={connectInFullscreen}
            controlEnabled={controlEnabled}
            disconnectShortcut={disconnectShortcut}
            fileInputRef={fileInputRef}
            frameRate={viewerFrameRate}
            hostSources={hostSources}
            isFullscreen={isFullscreen}
            isHotkeysOpen={isHotkeysOpen}
            isOpen={isViewerSettingsOpen}
            receiveAudio={receiveStreamAudio}
            saveDirectory={saveDirectory}
            switchMonitorShortcut={switchMonitorShortcut}
            transferLabel={transferLabel}
            transferProgress={transferProgress}
            onChooseSaveDirectory={onChooseSaveDirectory}
            onClose={onCloseViewerSettings}
            onDisconnect={onDisconnect}
            onFileInputChange={onFileInputChange}
            onSelectFile={onSelectFile}
            onToggleConnectInFullscreen={onToggleConnectInFullscreen}
            onToggleCaptureLocalInput={onToggleCaptureLocalInput}
            onSwitchRemoteSource={onSwitchRemoteSource}
            onToggle={onToggleViewerSettings}
            onToggleControl={onToggleControl}
            onToggleFullscreen={onToggleFullscreen}
            onChangeFrameRate={onViewerFrameRateChange}
            onChangeDisconnectShortcut={onChangeDisconnectShortcut}
            onChangeSwitchMonitorShortcut={onChangeSwitchMonitorShortcut}
            onToggleReceiveAudio={onToggleReceiveAudio}
          />
          {isHotkeysOpen && (
            <HotkeysPanel
              disconnectShortcut={disconnectShortcut}
              switchMonitorShortcut={switchMonitorShortcut}
              onClose={onCloseHotkeys}
            />
          )}
        </>
      ) : (
        <VideoEmpty
          icon="SCREEN"
          title="Remote Desktop"
          sub="Enter the session code and connect to the host"
        />
      )}
    </section>
  );
}
