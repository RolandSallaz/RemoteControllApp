import type { ChangeEvent, ReactElement, RefObject } from "react";
import type { DiscoveredServer, PeerJoinedPayload, PeerRole } from "@remote-control/shared";

import { extractServerLabel } from "../appLogic";
import type { DesktopAppMode, EmbeddedBackendStatus } from "../env";
import type { CaptureMode, FrameRate } from "../webrtc/RemoteControlClient";
import { HotkeyField, ServerStatusBadge, SettingsToggle } from "./common";

export function AppSidebar({
  appMode,
  backendStatus,
  canConnect,
  captureLocalInput,
  captureMode,
  connectInFullscreen,
  disconnectShortcut,
  discoveredServers,
  fileInputRef,
  frameRate,
  isConnected,
  isDiscovering,
  isSetupSettingsOpen,
  peer,
  receiveStreamAudio,
  recentServers,
  role,
  serverLatencies,
  serverUrl,
  status,
  switchMonitorShortcut,
  transferLabel,
  transferProgress,
  viewerFrameRate,
  onCaptureLocalInputChange,
  onCaptureModeChange,
  onConnect,
  onConnectInFullscreenChange,
  onDisconnect,
  onDisconnectShortcutChange,
  onFileInputChange,
  onFrameRateChange,
  onOpenHostSettings,
  onReceiveAudioChange,
  onScanServers,
  onSelectFile,
  onServerUrlChange,
  onSetupSettingsToggle,
  onSwitchMonitorShortcutChange,
  onViewerFrameRateChange
}: {
  appMode: DesktopAppMode;
  backendStatus: EmbeddedBackendStatus;
  canConnect: boolean;
  captureLocalInput: boolean;
  captureMode: CaptureMode;
  connectInFullscreen: boolean;
  disconnectShortcut: string;
  discoveredServers: DiscoveredServer[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  frameRate: FrameRate;
  isConnected: boolean;
  isDiscovering: boolean;
  isSetupSettingsOpen: boolean;
  peer?: PeerJoinedPayload;
  receiveStreamAudio: boolean;
  recentServers: string[];
  role: PeerRole;
  serverLatencies: Map<string, number>;
  serverUrl: string;
  status: string;
  switchMonitorShortcut: string;
  transferLabel?: string;
  transferProgress?: number;
  viewerFrameRate: FrameRate;
  onCaptureLocalInputChange: (enabled: boolean) => void;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onConnect: () => void;
  onConnectInFullscreenChange: (enabled: boolean) => void;
  onDisconnect: () => void;
  onDisconnectShortcutChange: (shortcut: string) => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onFrameRateChange: (frameRate: FrameRate) => void;
  onOpenHostSettings: () => void;
  onReceiveAudioChange: (enabled: boolean) => void;
  onScanServers: () => void;
  onSelectFile: () => void;
  onServerUrlChange: (url: string) => void;
  onSetupSettingsToggle: () => void;
  onSwitchMonitorShortcutChange: (shortcut: string) => void;
  onViewerFrameRateChange: (frameRate: FrameRate) => void;
}): ReactElement {
  return (
    <aside className="sidebar">
      <div className="status-bar">
        <div className={`status-dot ${isConnected ? "connected" : ""}`} />
        <span className="status-text">{status}</span>
      </div>

      <div className="sidebar-body">
        {appMode === "host" && (
          <HostSidebarSections
            backendStatus={backendStatus}
            fileInputRef={fileInputRef}
            isConnected={isConnected}
            peer={peer}
            transferLabel={transferLabel}
            transferProgress={transferProgress}
            onFileInputChange={onFileInputChange}
            onOpenHostSettings={onOpenHostSettings}
            onSelectFile={onSelectFile}
          />
        )}

        {appMode !== "host" && (
          <ViewerSetupSections
            captureLocalInput={captureLocalInput}
            captureMode={captureMode}
            connectInFullscreen={connectInFullscreen}
            disconnectShortcut={disconnectShortcut}
            discoveredServers={discoveredServers}
            frameRate={frameRate}
            isConnected={isConnected}
            isDiscovering={isDiscovering}
            isSetupSettingsOpen={isSetupSettingsOpen}
            receiveStreamAudio={receiveStreamAudio}
            recentServers={recentServers}
            role={role}
            serverLatencies={serverLatencies}
            serverUrl={serverUrl}
            switchMonitorShortcut={switchMonitorShortcut}
            viewerFrameRate={viewerFrameRate}
            onCaptureLocalInputChange={onCaptureLocalInputChange}
            onCaptureModeChange={onCaptureModeChange}
            onConnectInFullscreenChange={onConnectInFullscreenChange}
            onDisconnectShortcutChange={onDisconnectShortcutChange}
            onFrameRateChange={onFrameRateChange}
            onReceiveAudioChange={onReceiveAudioChange}
            onScanServers={onScanServers}
            onServerUrlChange={onServerUrlChange}
            onSetupSettingsToggle={onSetupSettingsToggle}
            onSwitchMonitorShortcutChange={onSwitchMonitorShortcutChange}
            onViewerFrameRateChange={onViewerFrameRateChange}
          />
        )}

        {peer && (
          <>
            <div className="divider" />
            <div className="section">
              <div className="section-label">Peer</div>
              <div className="peer-badge">
                <div className="peer-badge-dot" />
                <span className="peer-badge-text">
                  {peer.displayName ?? peer.role} connected
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {appMode !== "host" && (
        <div className="sidebar-footer">
          {isConnected ? (
            <button type="button" className="connect-btn btn-danger" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="connect-btn btn-primary"
              onClick={onConnect}
              disabled={!canConnect}
            >
              Connect
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

function HostSidebarSections({
  backendStatus,
  fileInputRef,
  isConnected,
  peer,
  transferLabel,
  transferProgress,
  onFileInputChange,
  onOpenHostSettings,
  onSelectFile
}: {
  backendStatus: EmbeddedBackendStatus;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isConnected: boolean;
  peer?: PeerJoinedPayload;
  transferLabel?: string;
  transferProgress?: number;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpenHostSettings: () => void;
  onSelectFile: () => void;
}): ReactElement {
  return (
    <>
      <div className="section">
        <div className="section-label">Embedded Server</div>
        <div className="server-card">
          <div className="server-stat-row">
            <span className="server-stat-label">Status</span>
            <ServerStatusBadge status={backendStatus.status} />
          </div>
          <div className="server-stat-row">
            <span className="server-stat-label">Address</span>
            <span className="server-stat-value mono">{backendStatus.url ?? "-"}</span>
          </div>
          <div className="server-stat-row">
            <span className="server-stat-label">Viewer</span>
            <span className="server-stat-value accent">{peer ? (peer.displayName ?? "Connected") : "None"}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-label">File Transfer</div>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={onFileInputChange}
        />
        <div className="host-actions">
          <button
            type="button"
            className="connect-btn"
            onClick={onSelectFile}
            disabled={!isConnected || !peer}
          >
            Send File To Viewer
          </button>
          <button type="button" onClick={onOpenHostSettings}>
            Settings
          </button>
          {transferLabel && (
            <TransferStatus transferLabel={transferLabel} transferProgress={transferProgress} />
          )}
        </div>
      </div>
    </>
  );
}

function ViewerSetupSections({
  captureLocalInput,
  captureMode,
  connectInFullscreen,
  disconnectShortcut,
  discoveredServers,
  frameRate,
  isConnected,
  isDiscovering,
  isSetupSettingsOpen,
  receiveStreamAudio,
  recentServers,
  role,
  serverLatencies,
  serverUrl,
  switchMonitorShortcut,
  viewerFrameRate,
  onCaptureLocalInputChange,
  onCaptureModeChange,
  onConnectInFullscreenChange,
  onDisconnectShortcutChange,
  onFrameRateChange,
  onReceiveAudioChange,
  onScanServers,
  onServerUrlChange,
  onSetupSettingsToggle,
  onSwitchMonitorShortcutChange,
  onViewerFrameRateChange
}: {
  captureLocalInput: boolean;
  captureMode: CaptureMode;
  connectInFullscreen: boolean;
  disconnectShortcut: string;
  discoveredServers: DiscoveredServer[];
  frameRate: FrameRate;
  isConnected: boolean;
  isDiscovering: boolean;
  isSetupSettingsOpen: boolean;
  receiveStreamAudio: boolean;
  recentServers: string[];
  role: PeerRole;
  serverLatencies: Map<string, number>;
  serverUrl: string;
  switchMonitorShortcut: string;
  viewerFrameRate: FrameRate;
  onCaptureLocalInputChange: (enabled: boolean) => void;
  onCaptureModeChange: (mode: CaptureMode) => void;
  onConnectInFullscreenChange: (enabled: boolean) => void;
  onDisconnectShortcutChange: (shortcut: string) => void;
  onFrameRateChange: (frameRate: FrameRate) => void;
  onReceiveAudioChange: (enabled: boolean) => void;
  onScanServers: () => void;
  onServerUrlChange: (url: string) => void;
  onSetupSettingsToggle: () => void;
  onSwitchMonitorShortcutChange: (shortcut: string) => void;
  onViewerFrameRateChange: (frameRate: FrameRate) => void;
}): ReactElement {
  return (
    <>
      {role === "viewer" && !isConnected && (
        <div className="setup-section">
          <div className="setup-section-header">
            <span className="section-label">LAN Servers</span>
            <button
              type="button"
              className="setup-scan-btn"
              onClick={onScanServers}
              disabled={isDiscovering}
            >
              {isDiscovering ? "Scanning..." : "Scan"}
            </button>
          </div>
          {discoveredServers.length === 0 ? (
            <div className="setup-empty-hint">
              {isDiscovering
                ? "Searching for servers on your network..."
                : "Press Scan to find servers on your local network."}
            </div>
          ) : (
            <div className="setup-server-grid">
              {discoveredServers.map((server) => (
                <button
                  type="button"
                  key={`${server.address}:${server.port}`}
                  className={`setup-server-card${serverUrl === server.url ? " selected" : ""}`}
                  onClick={() => onServerUrlChange(server.url)}
                  disabled={isConnected}
                >
                  <span className="setup-server-name">{server.name}</span>
                  <span className="setup-server-addr">{server.url}</span>
                  {serverLatencies.has(server.url) && (
                    <span className="setup-server-ping">{serverLatencies.get(server.url)} ms</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="setup-section">
        <label className="setup-field-label">Server Address</label>
        <input
          value={serverUrl}
          onChange={(event) => onServerUrlChange(event.target.value)}
          disabled={isConnected}
          placeholder="http://192.168.1.x:47315"
        />
      </div>

      {role === "viewer" && !isConnected && recentServers.length > 0 && (
        <div className="setup-section">
          <div className="section-label">Recent</div>
          <div className="setup-recent-list">
            {recentServers.map((item) => (
              <button
                type="button"
                key={item}
                className={`setup-recent-pill${serverUrl === item ? " selected" : ""}`}
                onClick={() => onServerUrlChange(item)}
                disabled={isConnected}
              >
                {extractServerLabel(item)}
              </button>
            ))}
          </div>
        </div>
      )}

      {role === "host" && (
        <div className="setup-section">
          <label className="setup-field-label">Capture Mode</label>
          <div className="role-tabs">
            <button
              type="button"
              className={`role-tab ${captureMode === "desktop" ? "active" : ""}`}
              onClick={() => onCaptureModeChange("desktop")}
              disabled={isConnected}
            >
              Desktop
            </button>
            <button
              type="button"
              className={`role-tab ${captureMode === "game" ? "active" : ""}`}
              onClick={() => onCaptureModeChange("game")}
              disabled={isConnected}
            >
              Game
            </button>
          </div>
        </div>
      )}

      {role === "host" && (
        <div className="setup-section">
          <label className="setup-field-label">Frame Rate</label>
          <select value={frameRate} onChange={(event) => onFrameRateChange(Number(event.target.value) as FrameRate)} disabled={isConnected}>
            <option value={15}>15 FPS - low bandwidth</option>
            <option value={30}>30 FPS - balanced</option>
            <option value={60}>60 FPS - smooth / games</option>
          </select>
        </div>
      )}

      {role === "viewer" && !isConnected && (
        <div className="setup-section">
          <button
            type="button"
            className="setup-settings-toggle"
            onClick={onSetupSettingsToggle}
          >
            <span>Connection Settings</span>
            <span className={`setup-settings-chevron${isSetupSettingsOpen ? " open" : ""}`}>v</span>
          </button>
          {isSetupSettingsOpen && (
            <div className="setup-settings-body">
              <SettingsToggle
                checked={connectInFullscreen}
                onChange={onConnectInFullscreenChange}
                label="Connect in fullscreen"
                sub="Enter fullscreen automatically after connecting"
              />
              <SettingsToggle
                checked={captureLocalInput}
                onChange={onCaptureLocalInputChange}
                label="Capture local input"
                sub="Route all input to the remote PC"
              />
              <SettingsToggle
                checked={receiveStreamAudio}
                onChange={onReceiveAudioChange}
                label="Receive audio"
              />
              <div className="field">
                <label>Frame rate</label>
                <select
                  value={viewerFrameRate}
                  onChange={(event) => onViewerFrameRateChange(Number(event.target.value) as FrameRate)}
                >
                  <option value={15}>15 FPS - low bandwidth</option>
                  <option value={30}>30 FPS - balanced</option>
                  <option value={60}>60 FPS - smooth</option>
                </select>
              </div>
              <HotkeyField label="Switch monitor" value={switchMonitorShortcut} onChange={onSwitchMonitorShortcutChange} />
              <HotkeyField label="Disconnect" value={disconnectShortcut} onChange={onDisconnectShortcutChange} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

function TransferStatus({
  transferLabel,
  transferProgress
}: {
  transferLabel: string;
  transferProgress?: number;
}): ReactElement {
  return (
    <div className="transfer-status">
      <div className="transfer-meta">
        <span className="transfer-name">{transferLabel}</span>
        <span className="transfer-percent">{transferProgress ?? 0}%</span>
      </div>
      <div className="transfer-bar">
        <div
          className="transfer-bar-fill"
          style={{ width: `${transferProgress ?? 0}%` }}
        />
      </div>
    </div>
  );
}
