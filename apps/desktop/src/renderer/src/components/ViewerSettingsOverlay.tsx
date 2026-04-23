import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject
} from "react";
import type { HostSource } from "@remote-control/shared";

import {
  formatBitrate,
  formatLatency,
  formatPacketLoss
} from "../appLogic";
import type { ConnectionStats, FrameRate } from "../webrtc/RemoteControlClient";
import {
  HotkeyField,
  HotkeysPanel,
  SettingsToggle
} from "./common";

const viewerOverlayButtonSize = 38;
const viewerOverlayMargin = 8;
const viewerOverlayGap = 8;
const viewerPanelSafeMargin = 14;
const viewerSettingsPanelWidth = 360;
const viewerHotkeysPanelWidth = 340;

type ViewerOverlayPosition = {
  top: number;
  right: number;
};

type ViewerOverlayDragState = {
  moved: boolean;
  pointerId: number;
  startRight: number;
  startTop: number;
  startX: number;
  startY: number;
};

type SettingsTab = "control" | "stream" | "files";

export function ViewerSettingsOverlay({
  activeRemoteSourceId,
  captureLocalInput,
  connectionStats,
  connectInFullscreen,
  controlEnabled,
  disconnectShortcut,
  fileInputRef,
  frameRate,
  hostSources,
  isFullscreen,
  isHotkeysOpen,
  isOpen,
  receiveAudio,
  saveDirectory,
  switchMonitorShortcut,
  transferLabel,
  transferProgress,
  onChooseSaveDirectory,
  onClose,
  onDisconnect,
  onFileInputChange,
  onSelectFile,
  onSwitchRemoteSource,
  onToggleCaptureLocalInput,
  onToggleConnectInFullscreen,
  onToggle,
  onToggleControl,
  onToggleFullscreen,
  onChangeFrameRate,
  onChangeDisconnectShortcut,
  onChangeSwitchMonitorShortcut,
  onToggleReceiveAudio
}: {
  activeRemoteSourceId?: string;
  captureLocalInput: boolean;
  connectionStats?: ConnectionStats;
  connectInFullscreen: boolean;
  controlEnabled: boolean;
  disconnectShortcut: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  frameRate: FrameRate;
  hostSources: HostSource[];
  isFullscreen: boolean;
  isHotkeysOpen: boolean;
  isOpen: boolean;
  receiveAudio: boolean;
  saveDirectory: string;
  switchMonitorShortcut: string;
  transferLabel?: string;
  transferProgress?: number;
  onChooseSaveDirectory: () => void;
  onClose: () => void;
  onDisconnect: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectFile: () => void;
  onSwitchRemoteSource: (sourceId: string) => void;
  onToggleCaptureLocalInput: (enabled: boolean) => void;
  onToggleConnectInFullscreen: (enabled: boolean) => void;
  onToggle: () => void;
  onToggleControl: (enabled: boolean) => void;
  onToggleFullscreen: () => void;
  onChangeFrameRate: (frameRate: FrameRate) => void;
  onChangeDisconnectShortcut: (shortcut: string) => void;
  onChangeSwitchMonitorShortcut: (shortcut: string) => void;
  onToggleReceiveAudio: (enabled: boolean) => void;
}): ReactElement {
  const [position, setPosition] = useState<ViewerOverlayPosition>({ top: 14, right: 14 });
  const [isHotkeysHintOpen, setIsHotkeysHintOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("control");
  const dragRef = useRef<ViewerOverlayDragState | undefined>(undefined);
  const skipNextClickRef = useRef(false);
  const showHotkeysHint = isHotkeysHintOpen && !isHotkeysOpen && !isOpen;

  useEffect(() => {
    const handleResize = (): void => {
      setPosition((current) => clampViewerOverlayPosition(current));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) {
      return;
    }

    dragRef.current = {
      moved: false,
      pointerId: event.pointerId,
      startRight: position.right,
      startTop: position.top,
      startX: event.clientX,
      startY: event.clientY
    };
    setIsHotkeysHintOpen(false);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true;
      setIsHotkeysHintOpen(false);
    }

    if (!drag.moved) {
      return;
    }

    event.preventDefault();
    setPosition(clampViewerOverlayPosition({
      top: drag.startTop + deltaY,
      right: drag.startRight - deltaX
    }));
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (drag.moved) {
      event.preventDefault();
      event.stopPropagation();
      skipNextClickRef.current = true;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = undefined;
  }

  function handleOverlayClick(event: MouseEvent<HTMLButtonElement>): void {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    onToggle();
    setIsHotkeysHintOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className={`viewer-overlay-toggle${isOpen ? " active" : ""}`}
        style={{ top: position.top, right: position.right }}
        onClick={handleOverlayClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseEnter={() => setIsHotkeysHintOpen(true)}
        onMouseLeave={() => setIsHotkeysHintOpen(false)}
        onFocus={() => setIsHotkeysHintOpen(true)}
        onBlur={() => setIsHotkeysHintOpen(false)}
        aria-label="Open viewer settings"
      >
        RC
      </button>

      {showHotkeysHint && (
        <HotkeysPanel
          disconnectShortcut={disconnectShortcut}
          switchMonitorShortcut={switchMonitorShortcut}
          variant="popover"
          style={getViewerHotkeysPanelStyle(position)}
        />
      )}

      {isOpen && (
        <div
          className="viewer-settings-panel"
          style={getViewerSettingsPanelStyle(position)}
          role="dialog"
          aria-label="Viewer settings"
        >
          <div className="viewer-settings-header">
            <div className="viewer-settings-title-row">
              <div>
                <div className="section-label">Remote Control</div>
                <h2>Settings</h2>
              </div>
              <button type="button" className="btn-icon" onClick={onClose} aria-label="Close settings">
                X
              </button>
            </div>
            {connectionStats && (
              <div className="viewer-stats-bar">
                <div className="viewer-stat">
                  <span className="viewer-stat-label">Ping</span>
                  <strong>{formatLatency(connectionStats.latencyMs)}</strong>
                </div>
                <div className="viewer-stat-sep" />
                <div className="viewer-stat">
                  <span className="viewer-stat-label">Video</span>
                  <strong>{formatBitrate(connectionStats.videoBitrateKbps)}</strong>
                </div>
                <div className="viewer-stat-sep" />
                <div className="viewer-stat">
                  <span className="viewer-stat-label">Audio</span>
                  <strong>{formatBitrate(connectionStats.audioBitrateKbps)}</strong>
                </div>
                <div className="viewer-stat-sep" />
                <div className="viewer-stat">
                  <span className="viewer-stat-label">Loss</span>
                  <strong className={connectionStats.packetLossPercent != null && connectionStats.packetLossPercent > 2 ? "stat-warn" : ""}>
                    {formatPacketLoss(connectionStats.packetLossPercent, connectionStats.packetsLost)}
                  </strong>
                </div>
              </div>
            )}
          </div>

          <div className="viewer-settings-tabs" role="tablist">
            {(["control", "stream", "files"] as const).map((nextTab) => (
              <button
                key={nextTab}
                type="button"
                role="tab"
                aria-selected={tab === nextTab}
                className={`viewer-settings-tab${tab === nextTab ? " active" : ""}`}
                onClick={() => setTab(nextTab)}
              >
                {nextTab === "control" ? "Control" : nextTab === "stream" ? "Stream" : "Files"}
              </button>
            ))}
          </div>

          <div className="viewer-settings-body" role="tabpanel">
            {tab === "control" && (
              <>
                <SettingsToggle
                  checked={controlEnabled}
                  onChange={onToggleControl}
                  label="Take control"
                  sub="Send mouse and keyboard input to the host"
                />
                <SettingsToggle
                  checked={captureLocalInput}
                  onChange={onToggleCaptureLocalInput}
                  label="Capture local input"
                  sub="All input routed to remote PC. Press Ctrl+Alt+Shift+Esc to exit."
                />
                <div className="settings-group-label">Shortcuts</div>
                <HotkeyField
                  label="Disconnect"
                  value={disconnectShortcut}
                  onChange={onChangeDisconnectShortcut}
                />
                <HotkeyField
                  label="Switch monitor"
                  value={switchMonitorShortcut}
                  onChange={onChangeSwitchMonitorShortcut}
                />
              </>
            )}

            {tab === "stream" && (
              <>
                <SettingsToggle
                  checked={receiveAudio}
                  onChange={onToggleReceiveAudio}
                  label="Receive audio"
                  sub="Play audio from the remote stream"
                />
                <SettingsToggle
                  checked={connectInFullscreen}
                  onChange={onToggleConnectInFullscreen}
                  label="Connect in fullscreen"
                  sub="Enter fullscreen automatically after connecting"
                />
                <div className="field">
                  <label>Frame rate</label>
                  <select
                    value={frameRate}
                    onChange={(event) => onChangeFrameRate(Number(event.target.value) as FrameRate)}
                  >
                    <option value={15}>15 FPS - low bandwidth</option>
                    <option value={30}>30 FPS - balanced</option>
                    <option value={60}>60 FPS - smooth</option>
                  </select>
                </div>
                {hostSources.length > 1 && (
                  <div className="field">
                    <label>Monitor</label>
                    <select
                      value={activeRemoteSourceId ?? ""}
                      onChange={(event) => onSwitchRemoteSource(event.target.value)}
                    >
                      {hostSources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}

            {tab === "files" && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: "none" }}
                  onChange={onFileInputChange}
                />
                <button type="button" className="settings-action-btn" onClick={onSelectFile}>
                  Send File to Host
                </button>
                <div className="settings-inline-row">
                  <button type="button" className="secondary-action" onClick={onChooseSaveDirectory}>
                    Receive Folder
                  </button>
                  <span className="path-hint" title={saveDirectory}>{saveDirectory || "Not set"}</span>
                </div>
                {transferLabel && (
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
                )}
                <div className="drop-hint">Drag files onto the remote screen to send them to the host.</div>
              </>
            )}
          </div>

          <div className="viewer-settings-footer">
            <button type="button" className="secondary-action" onClick={onToggleFullscreen}>
              {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </button>
            <button type="button" className="connect-btn btn-danger" onClick={onDisconnect}>
              Disconnect
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function clampViewerOverlayPosition(position: ViewerOverlayPosition): ViewerOverlayPosition {
  const maxTop = Math.max(viewerOverlayMargin, window.innerHeight - viewerOverlayButtonSize - viewerOverlayMargin);
  const maxRight = Math.max(viewerOverlayMargin, window.innerWidth - viewerOverlayButtonSize - viewerOverlayMargin);
  return {
    top: clamp(position.top, viewerOverlayMargin, maxTop),
    right: clamp(position.right, viewerOverlayMargin, maxRight)
  };
}

function getViewerSettingsPanelStyle(position: ViewerOverlayPosition): CSSProperties {
  const right = getViewerPanelRight(position, viewerSettingsPanelWidth);
  const belowTop = position.top + viewerOverlayButtonSize + viewerOverlayGap;
  const availableBelow = window.innerHeight - belowTop - viewerOverlayMargin;
  const availableAbove = position.top - viewerOverlayGap - viewerOverlayMargin;

  if (availableBelow >= 320 || availableBelow >= availableAbove) {
    return {
      top: belowTop,
      right,
      maxHeight: `calc(100vh - ${belowTop + viewerOverlayMargin}px)`
    };
  }

  return {
    bottom: window.innerHeight - position.top + viewerOverlayGap,
    right,
    maxHeight: Math.max(180, availableAbove)
  };
}

function getViewerHotkeysPanelStyle(position: ViewerOverlayPosition): CSSProperties {
  const right = getViewerPanelRight(position, viewerHotkeysPanelWidth);
  const belowTop = position.top + viewerOverlayButtonSize + viewerOverlayGap;
  const availableBelow = window.innerHeight - belowTop - viewerOverlayMargin;
  const availableAbove = position.top - viewerOverlayGap - viewerOverlayMargin;

  if (availableBelow >= 180 || availableBelow >= availableAbove) {
    return {
      top: belowTop,
      right
    };
  }

  return {
    bottom: window.innerHeight - position.top + viewerOverlayGap,
    right
  };
}

function getViewerPanelRight(position: ViewerOverlayPosition, preferredWidth: number): number {
  const availableWidth = Math.max(0, window.innerWidth - viewerPanelSafeMargin * 2);
  const panelWidth = Math.min(preferredWidth, availableWidth);
  const maxRight = Math.max(viewerPanelSafeMargin, window.innerWidth - panelWidth - viewerPanelSafeMargin);
  return clamp(position.right, viewerPanelSafeMargin, maxRight);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
