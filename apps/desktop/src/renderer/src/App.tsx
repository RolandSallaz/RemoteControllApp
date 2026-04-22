import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import type { ControlMessage, DiscoveredServer, HostSource, PeerJoinedPayload, PeerRole } from "@remote-control/shared";

import type { DesktopCaptureSource, EmbeddedBackendStatus, ViewerSettings } from "./env";
import {
  RemoteControlClient,
  type CaptureMode,
  type ConnectionStats,
  type FrameRate
} from "./webrtc/RemoteControlClient";

const defaultServerUrl = "http://localhost:47315";
const defaultSessionId = "LAN";
const appMode = window.remoteControl.appMode;
const isSettingsPage = new URLSearchParams(window.location.search).get("page") === "host-settings";
const fixedRole: PeerRole | undefined = appMode === "combined" ? undefined : appMode;
const viewerOverlayButtonSize = 38;
const viewerOverlayMargin = 8;
const viewerOverlayGap = 8;

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

export function App(): ReactElement {
  if (isSettingsPage) {
    return <HostSettingsPage />;
  }

  const [role, setRole] = useState<PeerRole>(fixedRole ?? "host");
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [sessionId] = useState(defaultSessionId);
  const [displayName] = useState(() =>
    fixedRole === "host" ? "Server" : `Viewer ${Math.floor(Math.random() * 1000)}`
  );
  const [sources, setSources] = useState<DesktopCaptureSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [status, setStatus] = useState("Ready to connect");
  const [peer, setPeer] = useState<PeerJoinedPayload | undefined>();
  const [localStream, setLocalStream] = useState<MediaStream | undefined>();
  const [remoteStream, setRemoteStream] = useState<MediaStream | undefined>();
  const [isConnected, setIsConnected] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [transferProgress, setTransferProgress] = useState<number | undefined>();
  const [transferLabel, setTransferLabel] = useState<string | undefined>();
  const [connectionStats, setConnectionStats] = useState<ConnectionStats | undefined>();
  const [saveDirectory, setSaveDirectory] = useState("");
  const [receivedFileNotice, setReceivedFileNotice] = useState<{ name: string; path?: string } | undefined>();
  const [hostSources, setHostSources] = useState<HostSource[]>([]);
  const [activeRemoteSourceId, setActiveRemoteSourceId] = useState<string | undefined>();
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [backendStatus, setBackendStatus] = useState<EmbeddedBackendStatus>({ status: "disabled" });
  const [captureMode, setCaptureMode] = useState<CaptureMode>("desktop");
  const [frameRate, setFrameRate] = useState<FrameRate>(30);
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [hostAccessPassword, setHostAccessPassword] = useState("");
  const [recentServers, setRecentServers] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isViewerSettingsOpen, setIsViewerSettingsOpen] = useState(false);
  const [connectInFullscreen, setConnectInFullscreen] = useState(true);
  const [captureLocalInput, setCaptureLocalInput] = useState(false);
  const [disconnectShortcut, setDisconnectShortcut] = useState("Ctrl+Alt+Shift+D");
  const [viewerFrameRate, setViewerFrameRate] = useState<FrameRate>(30);
  const [receiveStreamAudio, setReceiveStreamAudio] = useState(true);
  const [switchMonitorShortcut, setSwitchMonitorShortcut] = useState("Ctrl+Alt+Shift+M");
  const [passwordPrompt, setPasswordPrompt] = useState<{ message: string; password: string } | undefined>();

  const clientRef = useRef<RemoteControlClient | undefined>(undefined);
  const hostAutoConnectStartedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const passwordPromptResolverRef = useRef<((password?: string) => void) | undefined>(undefined);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId),
    [selectedSourceId, sources]
  );

  useEffect(() => {
    void loadFileSettings();
    void loadHostAccessSettings();
    void loadLaunchSettings();
    void loadViewerSettings();
    void loadRecentServers();
    void syncFullscreenState();
  }, []);

  useEffect(() => {
    if (appMode !== "host") return;
    return window.remoteControl.onHostSettingsClosed(() => {
      void loadFileSettings();
      void loadHostAccessSettings();
      void loadLaunchSettings();
    });
  }, []);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream ?? null;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream ?? null;
    }
  }, [remoteStream]);

  useEffect(() => {
    remoteStream?.getAudioTracks().forEach((track) => {
      track.enabled = receiveStreamAudio;
    });
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !receiveStreamAudio;
    }
  }, [receiveStreamAudio, remoteStream]);

  useEffect(() => {
    if (role !== "host") return;
    void refreshSources();
  }, [role]);

  useEffect(() => {
    if (fixedRole) {
      setRole(fixedRole);
    }
  }, []);

  useEffect(() => {
    if (role !== "host" || appMode !== "host") {
      return;
    }

    void syncEmbeddedBackend();
    const interval = window.setInterval(() => {
      void syncEmbeddedBackend();
    }, 1000);

    return () => window.clearInterval(interval);
  }, [role]);

  useEffect(() => {
    if (role !== "viewer") {
      return;
    }

    void scanServers();
  }, [role]);

  useEffect(() => {
    if (appMode !== "host" || role !== "host" || isConnected || hostAutoConnectStartedRef.current) {
      return;
    }

    if (backendStatus.status !== "running" || !backendStatus.url || !selectedSourceId) {
      return;
    }

    hostAutoConnectStartedRef.current = true;
    void connect();
  }, [backendStatus.status, backendStatus.url, isConnected, role, selectedSourceId]);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (appMode !== "host") {
      return;
    }

    void window.remoteControl.updateHostPresence({
      connected: Boolean(peer),
      viewerName: peer?.displayName
    });
  }, [appMode, peer]);

  useEffect(() => {
    if (appMode === "host") {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && isViewerSettingsOpen) {
        event.preventDefault();
        setIsViewerSettingsOpen(false);
        return;
      }

      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
      }

      if (event.key === "Escape" && isFullscreen) {
        event.preventDefault();
        void toggleFullscreen();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [appMode, isFullscreen, isViewerSettingsOpen]);

  useEffect(() => {
    if (appMode === "host" || role !== "viewer" || !isConnected) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (isKeyboardShortcut(event, disconnectShortcut)) {
        event.preventDefault();
        event.stopPropagation();
        disconnect();
        return;
      }

      if (isKeyboardShortcut(event, switchMonitorShortcut)) {
        event.preventDefault();
        event.stopPropagation();
        switchToNextRemoteSource();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeRemoteSourceId, appMode, disconnectShortcut, hostSources, isConnected, role, switchMonitorShortcut]);

  async function refreshSources(): Promise<void> {
    try {
      const nextSources = await window.remoteControl.getDesktopSources();
      setSources(nextSources);
      setSelectedSourceId((current) => current || getDefaultCaptureSource(nextSources)?.id || "");
      setStatus(`Found ${nextSources.length} capture sources`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function connect(): Promise<void> {
    clientRef.current?.disconnect();

    const client = new RemoteControlClient({
      role,
      sessionId: sessionId.trim(),
      serverUrl: serverUrl.trim(),
      displayName: displayName.trim() || role,
      captureSourceId: role === "host" ? selectedSourceId : undefined,
      captureMode: role === "host" ? captureMode : undefined,
      frameRate: role === "host" ? frameRate : undefined,
      onStatus: setStatus,
      onPeer: setPeer,
      onHostSources: (nextSources, activeSourceId) => {
        setHostSources(nextSources);
        setActiveRemoteSourceId(activeSourceId);
      },
      onControlReady: () => {
        if (role === "viewer") {
          clientRef.current?.sendHostStreamSettings({
            audioEnabled: receiveStreamAudio,
            frameRate: viewerFrameRate
          });
        }
      },
      onPasswordRequired: requestServerPassword,
      onStats: setConnectionStats,
      onFileReceived: (file) => {
        setReceivedFileNotice(file);
      },
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream
    });

    clientRef.current = client;
    setIsConnected(true);

    try {
      await client.connect();
      if (role === "viewer") {
        const result = await window.remoteControl.addRecentServer(serverUrl.trim());
        if (result.recentServers) {
          setRecentServers(result.recentServers);
        }
        if (captureLocalInput) {
          setControlEnabled(true);
        }
        if (connectInFullscreen) {
          await enterFullscreen();
        }
      }
    } catch (error) {
      setIsConnected(false);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function disconnect(): void {
    clientRef.current?.disconnect();
    clientRef.current = undefined;
    setIsConnected(false);
    setControlEnabled(false);
    setTransferProgress(undefined);
    setTransferLabel(undefined);
    setConnectionStats(undefined);
    setHostSources([]);
    setActiveRemoteSourceId(undefined);
    setPeer(undefined);
    setReceivedFileNotice(undefined);
    setIsViewerSettingsOpen(false);
    setStatus("Disconnected");
    if (role === "viewer") {
      void leaveFullscreen();
    }
    if (appMode === "host") {
      hostAutoConnectStartedRef.current = false;
    }
  }

  function sendControl(message: ControlMessage): void {
    if (role !== "viewer" || !controlEnabled) {
      return;
    }

    clientRef.current?.sendControlMessage(message);
  }

  function switchRemoteSource(sourceId: string): void {
    setActiveRemoteSourceId(sourceId);
    clientRef.current?.sendHostCommand(sourceId);
  }

  async function sendSelectedFile(file: File): Promise<void> {
    if (!isConnected || !clientRef.current || !peer) {
      return;
    }

    setTransferLabel(file.name);
    setTransferProgress(0);
    setStatus(`Sending file: ${file.name}`);

    try {
      await clientRef.current.sendFile(file, setTransferProgress);
      setTransferProgress(100);
      setStatus(`File sent: ${file.name}`);
    } catch (error) {
      setTransferProgress(undefined);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) {
      void sendSelectedFile(file);
    }
    event.target.value = "";
  }

  function handleViewerFileDragOver(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (!isConnected) {
      return;
    }

    setIsDraggingFile(true);
  }

  function handleViewerFileDragLeave(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDraggingFile(false);
  }

  function handleViewerFileDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    setIsDraggingFile(false);

    if (!isConnected) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      void sendSelectedFile(file);
    }
  }

  async function syncEmbeddedBackend(): Promise<void> {
    const backend = await window.remoteControl.getBackendStatus();
    setBackendStatus(backend);
    if (!backend.url) return;
    setServerUrl(backend.url);
    if (!isConnected) {
      setStatus(backend.status === "running" ? `Backend ready: ${backend.url}` : `Backend ${backend.status}: ${backend.url}`);
    }
  }

  async function loadFileSettings(): Promise<void> {
    try {
      const settings = await window.remoteControl.getFileSettings();
      setSaveDirectory(settings.saveDirectory);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadLaunchSettings(): Promise<void> {
    try {
      const settings = await window.remoteControl.getLaunchSettings();
      setLaunchOnStartup(settings.launchOnStartup);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadHostAccessSettings(): Promise<void> {
    if (appMode !== "host") {
      return;
    }

    try {
      const settings = await window.remoteControl.getHostAccessSettings();
      setHostAccessPassword(settings.accessPassword);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadViewerSettings(): Promise<void> {
    if (appMode === "host") {
      return;
    }

    try {
      const settings = await window.remoteControl.getViewerSettings();
      setConnectInFullscreen(settings.connectInFullscreen);
      setCaptureLocalInput(settings.captureLocalInput);
      setDisconnectShortcut(settings.disconnectShortcut);
      setViewerFrameRate(settings.frameRate);
      setReceiveStreamAudio(settings.receiveAudio);
      setSwitchMonitorShortcut(settings.switchMonitorShortcut);
      if (settings.captureLocalInput) {
        setControlEnabled(true);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadRecentServers(): Promise<void> {
    try {
      setRecentServers(await window.remoteControl.getRecentServers());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function syncFullscreenState(): Promise<void> {
    try {
      const state = await window.remoteControl.getFullscreenState();
      setIsFullscreen(state.isFullScreen);
    } catch {
      // ignore state sync errors
    }
  }

  async function chooseSaveDirectory(): Promise<void> {
    try {
      const result = await window.remoteControl.chooseSaveDirectory();
      if (!result.ok) {
        if (result.path) {
          setSaveDirectory(result.path);
        }
        if (result.error) {
          setStatus(result.error);
        }
        return;
      }

      if (result.path) {
        setSaveDirectory(result.path);
        setStatus(`Incoming files folder: ${result.path}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function openReceivedFolder(path?: string): Promise<void> {
    const result = await window.remoteControl.openSaveDirectory(path);
    if (!result.ok && result.error) {
      setStatus(result.error);
    }
  }

  async function changeLaunchOnStartup(enabled: boolean): Promise<void> {
    setLaunchOnStartup(enabled);
    const result = await window.remoteControl.setLaunchOnStartup(enabled);
    if (!result.ok) {
      setLaunchOnStartup(!enabled);
      if (result.error) {
        setStatus(result.error);
      }
    }
  }

  async function changeHostAccessPassword(password: string): Promise<void> {
    setHostAccessPassword(password);
    const result = await window.remoteControl.setHostAccessPassword(password);
    if (!result.ok) {
      if (result.error) {
        setStatus(result.error);
      }
      return;
    }

    setHostAccessPassword(result.accessPassword ?? "");
    setStatus(result.accessPassword ? "Server password updated" : "Server password cleared");
  }

  function requestServerPassword(message: string): Promise<string | undefined> {
    setPasswordPrompt({ message, password: "" });
    return new Promise((resolve) => {
      passwordPromptResolverRef.current = resolve;
    });
  }

  function resolvePasswordPrompt(password?: string): void {
    passwordPromptResolverRef.current?.(password);
    passwordPromptResolverRef.current = undefined;
    setPasswordPrompt(undefined);
    if (typeof password !== "string") {
      setIsConnected(false);
      void leaveFullscreen();
    }
  }

  function saveViewerSettings(settings: Partial<ViewerSettings>): void {
    if (appMode === "host") {
      return;
    }

    void window.remoteControl.updateViewerSettings(settings).catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
    });
  }

  function sendViewerStreamSettings(frameRate = viewerFrameRate, receiveAudio = receiveStreamAudio): void {
    if (role !== "viewer" || !isConnected) {
      return;
    }

    clientRef.current?.sendHostStreamSettings({
      audioEnabled: receiveAudio,
      frameRate
    });
  }

  function changeConnectInFullscreen(enabled: boolean): void {
    setConnectInFullscreen(enabled);
    saveViewerSettings({ connectInFullscreen: enabled });
  }

  function changeCaptureLocalInput(enabled: boolean): void {
    setCaptureLocalInput(enabled);
    saveViewerSettings({ captureLocalInput: enabled });
    if (enabled) {
      setControlEnabled(true);
      setIsViewerSettingsOpen(false);
    }
  }

  function changeControlEnabled(enabled: boolean): void {
    setControlEnabled(enabled);
    if (!enabled && captureLocalInput) {
      changeCaptureLocalInput(false);
    }
  }

  function changeViewerFrameRate(nextFrameRate: FrameRate): void {
    setViewerFrameRate(nextFrameRate);
    saveViewerSettings({ frameRate: nextFrameRate });
    sendViewerStreamSettings(nextFrameRate, receiveStreamAudio);
  }

  function changeReceiveStreamAudio(enabled: boolean): void {
    setReceiveStreamAudio(enabled);
    saveViewerSettings({ receiveAudio: enabled });
    remoteStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    sendViewerStreamSettings(viewerFrameRate, enabled);
  }

  function changeSwitchMonitorShortcut(shortcut: string): void {
    setSwitchMonitorShortcut(shortcut);
    saveViewerSettings({ switchMonitorShortcut: shortcut });
  }

  function changeDisconnectShortcut(shortcut: string): void {
    setDisconnectShortcut(shortcut);
    saveViewerSettings({ disconnectShortcut: shortcut });
  }

  function switchToNextRemoteSource(): void {
    if (hostSources.length < 2) {
      return;
    }

    const activeIndex = hostSources.findIndex((source) => source.id === activeRemoteSourceId);
    const nextSource = hostSources[(activeIndex + 1 + hostSources.length) % hostSources.length] ?? hostSources[0];
    switchRemoteSource(nextSource.id);
  }

  async function toggleFullscreen(): Promise<void> {
    const result = await window.remoteControl.toggleFullscreen();
    if (result.ok) {
      setIsFullscreen(Boolean(result.isFullScreen));
    }
  }

  async function enterFullscreen(): Promise<void> {
    try {
      const state = await window.remoteControl.getFullscreenState();
      if (state.isFullScreen) {
        setIsFullscreen(true);
        return;
      }

      const result = await window.remoteControl.toggleFullscreen();
      if (result.ok) {
        setIsFullscreen(Boolean(result.isFullScreen));
      }
    } catch {
      // Fullscreen is a convenience; keep the session connected if it fails.
    }
  }

  async function leaveFullscreen(): Promise<void> {
    try {
      const state = await window.remoteControl.getFullscreenState();
      if (!state.isFullScreen) {
        setIsFullscreen(false);
        return;
      }

      const result = await window.remoteControl.toggleFullscreen();
      if (result.ok) {
        setIsFullscreen(Boolean(result.isFullScreen));
      }
    } catch {
      // ignore state sync errors
    }
  }

  async function scanServers(): Promise<void> {
    setIsDiscovering(true);
    try {
      const servers = await window.remoteControl.discoverServers();
      setDiscoveredServers(servers);

      if (!isConnected && servers[0] && serverUrl === defaultServerUrl) {
        setServerUrl(servers[0].url);
      }

      setStatus(servers.length > 0 ? `Found ${servers.length} server${servers.length === 1 ? "" : "s"} on LAN` : "No LAN servers found");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDiscovering(false);
    }
  }

  const isViewerMode = appMode !== "host" && role === "viewer";
  const isViewerConnected = isViewerMode && isConnected;
  const appShellClassName = [
    "app-shell",
    appMode === "host" ? "host-mode" : "",
    isViewerMode && !isConnected ? "viewer-setup-mode" : "",
    isViewerConnected ? "viewer-connected-mode" : ""
  ].filter(Boolean).join(" ");
  const canConnect = Boolean(serverUrl.trim() && sessionId.trim() && (role === "viewer" || selectedSourceId));

  return (
    <div className={appShellClassName}>
      {receivedFileNotice && (
        <div className="file-toast" role="status" aria-live="polite">
          <div className="file-toast-body">
            <div className="file-toast-title">File received</div>
            <div className="file-toast-text" title={receivedFileNotice.path ?? receivedFileNotice.name}>
              {receivedFileNotice.name}
            </div>
            {receivedFileNotice.path && (
              <div className="file-toast-path" title={receivedFileNotice.path}>
                {receivedFileNotice.path}
              </div>
            )}
          </div>
          <div className="file-toast-actions">
            <button type="button" onClick={() => void openReceivedFolder(receivedFileNotice.path)}>
              Open Folder
            </button>
            <button type="button" onClick={() => setReceivedFileNotice(undefined)}>
              Close
            </button>
          </div>
        </div>
      )}
      {passwordPrompt && (
        <div className="password-prompt-overlay">
          <form
            className="password-prompt-modal"
            onSubmit={(event) => {
              event.preventDefault();
              resolvePasswordPrompt(passwordPrompt.password);
            }}
          >
            <div className="password-prompt-header">
              <div>
                <div className="section-label">Password</div>
                <h2>Server Password</h2>
              </div>
            </div>
            <div className="password-prompt-body">
              <div className="field">
                <label>{passwordPrompt.message}</label>
                <input
                  autoFocus
                  type="password"
                  value={passwordPrompt.password}
                  onChange={(event) => setPasswordPrompt({
                    ...passwordPrompt,
                    password: event.target.value
                  })}
                  placeholder="Enter server password"
                />
              </div>
              <div className="password-prompt-actions">
                <button type="button" className="secondary-action" onClick={() => resolvePasswordPrompt(undefined)}>
                  Cancel
                </button>
                <button type="submit" className="connect-btn btn-primary" disabled={!passwordPrompt.password}>
                  Connect
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
      <aside className="sidebar">
        <div className="status-bar">
          <div className={`status-dot ${isConnected ? "connected" : ""}`} />
          <span className="status-text">{status}</span>
        </div>

        <div className="sidebar-body">
          {appMode === "host" && (
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
                  onChange={handleFileInputChange}
                />
                <div className="host-actions">
                  <button
                    type="button"
                    className="connect-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isConnected || !peer}
                  >
                    Send File To Viewer
                  </button>
                  <button
                    type="button"
                    onClick={() => void window.remoteControl.openHostSettings()}
                  >
                    Settings
                  </button>
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
                </div>
              </div>
            </>
          )}

          {appMode !== "host" && (
          <>
          <div className="section">
            <div className="field">
              <label>Server URL</label>
              <input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                disabled={isConnected}
                placeholder="http://192.168.1.25:3001"
              />
            </div>

            {role === "viewer" && !isConnected && recentServers.length > 0 && (
              <div className="field">
                <label>Recent Servers</label>
                <div className="server-list">
                  {recentServers.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={`server-item ${serverUrl === item ? "selected" : ""}`}
                      onClick={() => setServerUrl(item)}
                      disabled={isConnected}
                    >
                      <span className="server-name">{extractServerLabel(item)}</span>
                      <span className="server-url">{item}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {role === "host" && (
              <div className="field">
                <label>Capture Mode</label>
                <div className="role-tabs">
                  <button
                    type="button"
                    className={`role-tab ${captureMode === "desktop" ? "active" : ""}`}
                    onClick={() => setCaptureMode("desktop")}
                    disabled={isConnected}
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    className={`role-tab ${captureMode === "game" ? "active" : ""}`}
                    onClick={() => setCaptureMode("game")}
                    disabled={isConnected}
                  >
                    Game
                  </button>
                </div>
              </div>
            )}

            {role === "host" && (
              <div className="field">
                <label>Frame Rate</label>
                <select
                  value={frameRate}
                  onChange={(e) => setFrameRate(Number(e.target.value) as FrameRate)}
                  disabled={isConnected}
                >
                  <option value={15}>15 FPS — low bandwidth</option>
                  <option value={30}>30 FPS — balanced</option>
                  <option value={60}>60 FPS — smooth / games</option>
                </select>
              </div>
            )}

            {role === "viewer" && !isConnected && (
              <div className="viewer-setup-settings">
                <div className="section-label">Viewer Settings</div>

                <label className="toggle-field compact-toggle">
                  <input
                    type="checkbox"
                    checked={connectInFullscreen}
                    onChange={(event) => changeConnectInFullscreen(event.target.checked)}
                  />
                  <span>
                    <strong>Connect in fullscreen</strong>
                    <small>Enter fullscreen automatically after connecting</small>
                  </span>
                </label>

                <label className="toggle-field compact-toggle">
                  <input
                    type="checkbox"
                    checked={captureLocalInput}
                    onChange={(event) => changeCaptureLocalInput(event.target.checked)}
                  />
                  <span>
                    <strong>Capture local input</strong>
                    <small>Route keyboard and pointer input to the remote PC</small>
                  </span>
                </label>

                <div className="field">
                  <label>Stream FPS</label>
                  <select
                    value={viewerFrameRate}
                    onChange={(event) => changeViewerFrameRate(Number(event.target.value) as FrameRate)}
                  >
                    <option value={15}>15 FPS - low bandwidth</option>
                    <option value={30}>30 FPS - balanced</option>
                    <option value={60}>60 FPS - smooth</option>
                  </select>
                </div>

                <label className="toggle-field compact-toggle">
                  <input
                    type="checkbox"
                    checked={receiveStreamAudio}
                    onChange={(event) => changeReceiveStreamAudio(event.target.checked)}
                  />
                  <span>
                    <strong>Receive stream audio</strong>
                    <small>Play and request audio from the remote stream</small>
                  </span>
                </label>

                <HotkeyField
                  label="Switch monitor shortcut"
                  value={switchMonitorShortcut}
                  onChange={changeSwitchMonitorShortcut}
                />
                <HotkeyField
                  label="Disconnect shortcut"
                  value={disconnectShortcut}
                  onChange={changeDisconnectShortcut}
                />
              </div>
            )}

            {role === "viewer" && !isConnected && (
              <div className="lan-discovery">
                <div className="source-section-header">
                  <div className="section-label" style={{ margin: 0, padding: 0 }}>LAN Servers</div>
                  <button
                    type="button"
                    onClick={() => void scanServers()}
                    disabled={isDiscovering || isConnected}
                    style={{ fontSize: 12, minHeight: 26, padding: "0 8px" }}
                  >
                    {isDiscovering ? "Scanning" : "Scan"}
                  </button>
                </div>

                <div className="server-list">
                  {discoveredServers.length === 0 ? (
                    <div className="server-empty">No servers found yet.</div>
                  ) : (
                    discoveredServers.map((server) => (
                      <button
                        type="button"
                        key={`${server.address}:${server.port}`}
                        className={`server-item ${serverUrl === server.url ? "selected" : ""}`}
                        onClick={() => setServerUrl(server.url)}
                        disabled={isConnected}
                      >
                        <span className="server-name">{server.name}</span>
                        <span className="server-url">{server.url}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          </>
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
            <button type="button" className="connect-btn btn-danger" onClick={disconnect}>
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="connect-btn btn-primary"
              onClick={() => void connect()}
              disabled={!canConnect}
            >
              Connect
            </button>
          )}
        </div>
        )}
      </aside>

      {appMode !== "host" && (!isViewerMode || isConnected) && (
        <section
          className={`video-stage${role === "viewer" && isDraggingFile ? " drag-active" : ""}`}
          onDragOver={role === "viewer" ? handleViewerFileDragOver : undefined}
          onDragLeave={role === "viewer" ? handleViewerFileDragLeave : undefined}
          onDrop={role === "viewer" ? handleViewerFileDrop : undefined}
        >
          <div className="video-overlay-header">
            <div>
              <div className="video-stage-title">
                {role === "host" ? "Shared Desktop" : "Remote Desktop"}
                {selectedSource && role === "host" ? ` · ${selectedSource.name}` : ""}
              </div>
              <div className="video-stage-sub">
                {peer ? `${peer.displayName ?? peer.role} is connected` : "Waiting for peer…"}
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
                icon="🖥️"
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
                onControl={sendControl}
                onDisconnectShortcut={disconnect}
                onInputCaptureChange={changeCaptureLocalInput}
                onSwitchMonitorShortcut={switchToNextRemoteSource}
                onToggleFullscreen={() => void toggleFullscreen()}
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
                isOpen={isViewerSettingsOpen}
                receiveAudio={receiveStreamAudio}
                saveDirectory={saveDirectory}
                status={status}
                switchMonitorShortcut={switchMonitorShortcut}
                transferLabel={transferLabel}
                transferProgress={transferProgress}
                onChooseSaveDirectory={() => void chooseSaveDirectory()}
                onClose={() => setIsViewerSettingsOpen(false)}
                onDisconnect={disconnect}
                onFileInputChange={handleFileInputChange}
                onSelectFile={() => fileInputRef.current?.click()}
                onToggleConnectInFullscreen={changeConnectInFullscreen}
                onToggleCaptureLocalInput={changeCaptureLocalInput}
                onSwitchRemoteSource={switchRemoteSource}
                onToggle={() => setIsViewerSettingsOpen((value) => !value)}
                onToggleControl={changeControlEnabled}
                onToggleFullscreen={() => void toggleFullscreen()}
                onChangeFrameRate={changeViewerFrameRate}
                onChangeDisconnectShortcut={changeDisconnectShortcut}
                onChangeSwitchMonitorShortcut={changeSwitchMonitorShortcut}
                onToggleReceiveAudio={changeReceiveStreamAudio}
              />
            </>
          ) : (
            <VideoEmpty
              icon="SCREEN"
              title="Remote Desktop"
              sub="Enter the session code and connect to the host"
            />
          )}
        </section>
      )}
    </div>
  );
}

function ServerStatusBadge({ status }: { status: EmbeddedBackendStatus["status"] }): ReactElement {
  const map: Record<EmbeddedBackendStatus["status"], { label: string; cls: string }> = {
    running:  { label: "Running",  cls: "badge-running"  },
    starting: { label: "Starting", cls: "badge-starting" },
    stopped:  { label: "Stopped",  cls: "badge-stopped"  },
    error:    { label: "Error",    cls: "badge-error"    },
    disabled: { label: "Disabled", cls: "badge-stopped"  }
  };
  const { label, cls } = map[status];
  return <span className={`server-badge ${cls}`}>{label}</span>;
}

function VideoEmpty({
  icon,
  title,
  sub
}: {
  icon: string;
  title: string;
  sub: string;
}): ReactElement {
  return (
    <div className="video-empty">
      <div className="video-empty-icon">{icon}</div>
      <div className="video-empty-title">{title}</div>
      <div className="video-empty-sub">{sub}</div>
    </div>
  );
}

function HotkeyField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (shortcut: string) => void;
}): ReactElement {
  return (
    <div className="field hotkey-field">
      <label>{label}</label>
      <div className="hotkey-input-row">
        <input
          readOnly
          value={value}
          placeholder="Click and press shortcut"
          onKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === "Backspace" || event.key === "Delete") {
              onChange("");
              return;
            }

            const shortcut = hotkeyFromKeyboardEvent(event.nativeEvent);
            if (shortcut) {
              onChange(shortcut);
            }
          }}
        />
        <button type="button" className="btn-icon" onClick={() => onChange("")} aria-label={`Clear ${label}`}>
          X
        </button>
      </div>
    </div>
  );
}

function ViewerSettingsOverlay({
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
  isOpen,
  receiveAudio,
  saveDirectory,
  status,
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
  isOpen: boolean;
  receiveAudio: boolean;
  saveDirectory: string;
  status: string;
  switchMonitorShortcut: string;
  transferLabel?: string;
  transferProgress?: number;
  onChooseSaveDirectory: () => void;
  onClose: () => void;
  onDisconnect: () => void;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
  const dragRef = useRef<ViewerOverlayDragState | undefined>(undefined);
  const skipNextClickRef = useRef(false);

  useEffect(() => {
    const handleResize = (): void => {
      setPosition((current) => clampViewerOverlayPosition(current));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
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
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true;
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

  function handlePointerUp(event: React.PointerEvent<HTMLButtonElement>): void {
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

  function handleOverlayClick(event: React.MouseEvent<HTMLButtonElement>): void {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    onToggle();
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
        aria-label="Open viewer settings"
        title="Settings"
      >
        RC
      </button>

      {isOpen && (
        <div
          className="viewer-settings-panel"
          style={getViewerSettingsPanelStyle(position)}
          role="dialog"
          aria-label="Viewer settings"
        >
          <div className="viewer-settings-header">
            <div>
              <div className="section-label">Settings</div>
              <h2>Viewer Settings</h2>
            </div>
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Close settings">
              X
            </button>
          </div>

          <div className="viewer-settings-body">
            <div className="viewer-settings-status">
              <div className="status-dot connected" />
              <span>{status}</span>
            </div>

            <label className="toggle-field compact-toggle">
              <input
                type="checkbox"
                checked={connectInFullscreen}
                onChange={(event) => onToggleConnectInFullscreen(event.target.checked)}
              />
              <span>
                <strong>Connect in fullscreen</strong>
                <small>Enter fullscreen automatically after connecting</small>
              </span>
            </label>

            <label className="toggle-field compact-toggle">
              <input
                type="checkbox"
                checked={controlEnabled}
                onChange={(event) => onToggleControl(event.target.checked)}
              />
              <span>
                <strong>Take control</strong>
                <small>Send mouse and keyboard input to the host</small>
              </span>
            </label>

            <label className="toggle-field compact-toggle">
              <input
                type="checkbox"
                checked={captureLocalInput}
                onChange={(event) => onToggleCaptureLocalInput(event.target.checked)}
              />
              <span>
                <strong>Capture local input</strong>
                <small>All keyboard and pointer input goes to the remote PC. Press Ctrl+Alt+Shift+Esc to exit.</small>
              </span>
            </label>

            <div className="field">
              <label>Stream FPS</label>
              <select
                value={frameRate}
                onChange={(event) => onChangeFrameRate(Number(event.target.value) as FrameRate)}
              >
                <option value={15}>15 FPS - low bandwidth</option>
                <option value={30}>30 FPS - balanced</option>
                <option value={60}>60 FPS - smooth</option>
              </select>
            </div>

            <label className="toggle-field compact-toggle">
              <input
                type="checkbox"
                checked={receiveAudio}
                onChange={(event) => onToggleReceiveAudio(event.target.checked)}
              />
              <span>
                <strong>Receive stream audio</strong>
                <small>Play and request audio from the remote stream</small>
              </span>
            </label>

            <HotkeyField
              label="Switch monitor shortcut"
              value={switchMonitorShortcut}
              onChange={onChangeSwitchMonitorShortcut}
            />
            <HotkeyField
              label="Disconnect shortcut"
              value={disconnectShortcut}
              onChange={onChangeDisconnectShortcut}
            />

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

            <div className="field">
              <label>File Transfer</label>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: "none" }}
                onChange={onFileInputChange}
              />
              <button type="button" onClick={onSelectFile}>
                Choose File
              </button>
              <div className="drop-hint">
                Drag files directly onto the remote screen to send them to the host.
              </div>
              <div className="inline-actions">
                <button type="button" className="secondary-action" onClick={onChooseSaveDirectory}>
                  Receive Folder
                </button>
                <div className="path-hint" title={saveDirectory}>
                  {saveDirectory}
                </div>
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
            </div>

            {connectionStats && (
              <div className="stats-card">
                <div className="stats-card-title">Connection</div>
                <div className="stats-grid">
                  <div className="stats-item">
                    <span className="stats-label">Latency</span>
                    <strong>{formatLatency(connectionStats.latencyMs)}</strong>
                  </div>
                  <div className="stats-item">
                    <span className="stats-label">Video</span>
                    <strong>{formatBitrate(connectionStats.videoBitrateKbps)}</strong>
                  </div>
                  <div className="stats-item">
                    <span className="stats-label">Audio</span>
                    <strong>{formatBitrate(connectionStats.audioBitrateKbps)}</strong>
                  </div>
                  <div className="stats-item">
                    <span className="stats-label">Loss</span>
                    <strong>{formatPacketLoss(connectionStats.packetLossPercent, connectionStats.packetsLost)}</strong>
                  </div>
                </div>
              </div>
            )}

            <div className="viewer-settings-actions">
              <button type="button" className="secondary-action" onClick={onToggleFullscreen}>
                {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
              </button>
              <button type="button" className="connect-btn btn-danger" onClick={onDisconnect}>
                Disconnect
              </button>
            </div>
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
  const belowTop = position.top + viewerOverlayButtonSize + viewerOverlayGap;
  const availableBelow = window.innerHeight - belowTop - viewerOverlayMargin;
  const availableAbove = position.top - viewerOverlayGap - viewerOverlayMargin;

  if (availableBelow >= 320 || availableBelow >= availableAbove) {
    return {
      top: belowTop,
      right: position.right,
      maxHeight: `calc(100vh - ${belowTop + viewerOverlayMargin}px)`
    };
  }

  return {
    bottom: window.innerHeight - position.top + viewerOverlayGap,
    right: position.right,
    maxHeight: Math.max(180, availableAbove)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function RemoteVideo({
  videoRef,
  controlEnabled,
  disconnectShortcut,
  inputCaptureEnabled,
  receiveAudio,
  switchMonitorShortcut,
  onControl,
  onDisconnectShortcut,
  onInputCaptureChange,
  onSwitchMonitorShortcut,
  onToggleFullscreen
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  controlEnabled: boolean;
  disconnectShortcut: string;
  inputCaptureEnabled: boolean;
  receiveAudio: boolean;
  switchMonitorShortcut: string;
  onControl: (message: ControlMessage) => void;
  onDisconnectShortcut: () => void;
  onInputCaptureChange: (enabled: boolean) => void;
  onSwitchMonitorShortcut: () => void;
  onToggleFullscreen: () => void;
}): ReactElement {
  const virtualPointerRef = useRef({
    x: 0,
    y: 0,
    screenWidth: 0,
    screenHeight: 0
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.muted = !receiveAudio;
    video.volume = receiveAudio ? 1 : 0;
  }, [receiveAudio, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!controlEnabled || !inputCaptureEnabled || !video) {
      return;
    }

    const screenWidth = video.videoWidth || Math.round(video.getBoundingClientRect().width);
    const screenHeight = video.videoHeight || Math.round(video.getBoundingClientRect().height);
    virtualPointerRef.current = {
      x: Math.round(screenWidth / 2),
      y: Math.round(screenHeight / 2),
      screenWidth,
      screenHeight
    };

    video.focus();
    try {
      video.requestPointerLock();
    } catch {
      // Pointer lock can require a user gesture in some environments.
    }

    const keyboard = navigator as Navigator & {
      keyboard?: {
        lock?: () => Promise<void>;
        unlock?: () => void;
      };
    };
    void keyboard.keyboard?.lock?.();

    const handlePointerMove = (event: MouseEvent): void => {
      if (document.pointerLockElement !== video) {
        return;
      }

      const current = virtualPointerRef.current;
      const next = {
        x: clamp(current.x + event.movementX, 0, current.screenWidth),
        y: clamp(current.y + event.movementY, 0, current.screenHeight),
        screenWidth: current.screenWidth,
        screenHeight: current.screenHeight
      };
      virtualPointerRef.current = next;
      onControl({ kind: "pointer", event: { type: "move", ...next } });
    };

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      onControl({ kind: "pointer", event: { type: "scroll", deltaX: event.deltaX, deltaY: event.deltaY } });
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (isInputCaptureExitShortcut(event)) {
        onInputCaptureChange(false);
        return;
      }
      if (isKeyboardShortcut(event, disconnectShortcut)) {
        onDisconnectShortcut();
        return;
      }
      if (isKeyboardShortcut(event, switchMonitorShortcut)) {
        onSwitchMonitorShortcut();
        return;
      }

      if (!event.repeat) {
        onControl({ kind: "keyboard", event: { type: "keyDown", code: event.code, key: event.key } });
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (isInputCaptureExitShortcut(event)) {
        return;
      }

      onControl({ kind: "keyboard", event: { type: "keyUp", code: event.code, key: event.key } });
    };

    const handlePointerLockChange = (): void => {
      if (document.pointerLockElement !== video) {
        onInputCaptureChange(false);
      }
    };

    document.addEventListener("mousemove", handlePointerMove);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      keyboard.keyboard?.unlock?.();
      if (document.pointerLockElement === video) {
        document.exitPointerLock();
      }
    };
  }, [
    controlEnabled,
    disconnectShortcut,
    inputCaptureEnabled,
    onControl,
    onDisconnectShortcut,
    onInputCaptureChange,
    onSwitchMonitorShortcut,
    switchMonitorShortcut,
    videoRef
  ]);

  function pointerPosition(event: React.PointerEvent<HTMLVideoElement>): {
    x: number;
    y: number;
    screenWidth: number;
    screenHeight: number;
  } {
    const video = event.currentTarget;
    const rect = video.getBoundingClientRect();
    const screenWidth = video.videoWidth || Math.round(rect.width);
    const screenHeight = video.videoHeight || Math.round(rect.height);

    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * screenWidth),
      y: Math.round(((event.clientY - rect.top) / rect.height) * screenHeight),
      screenWidth,
      screenHeight
    };
  }

  return (
    <video
      ref={videoRef}
      className={`desktop-video interactive${controlEnabled ? "" : " control-disabled"}${inputCaptureEnabled ? " input-captured" : ""}`}
      autoPlay
      playsInline
      muted={!receiveAudio}
      tabIndex={controlEnabled ? 0 : -1}
      onDoubleClick={() => onToggleFullscreen()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerMove={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        onControl({ kind: "pointer", event: { type: "move", ...pointerPosition(event) } });
      }}
      onPointerDown={(event) => {
        if (!controlEnabled) return;
        event.currentTarget.focus();
        if (inputCaptureEnabled && document.pointerLockElement !== event.currentTarget) {
          try {
            event.currentTarget.requestPointerLock();
          } catch {
            // Pointer lock can require a user gesture in some environments.
          }
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        const pointer = inputCaptureEnabled ? virtualPointerRef.current : pointerPosition(event);
        onControl({
          kind: "pointer",
          event: { type: "click", button: mapPointerButton(event.button), ...pointer }
        });
      }}
      onWheel={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        onControl({ kind: "pointer", event: { type: "scroll", deltaX: event.deltaX, deltaY: event.deltaY } });
      }}
      onKeyDown={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        if (isKeyboardShortcut(event.nativeEvent, disconnectShortcut)) {
          event.preventDefault();
          onDisconnectShortcut();
          return;
        }
        if (isKeyboardShortcut(event.nativeEvent, switchMonitorShortcut)) {
          event.preventDefault();
          onSwitchMonitorShortcut();
          return;
        }
        if (event.repeat) return;
        onControl({ kind: "keyboard", event: { type: "keyDown", code: event.code, key: event.key } });
      }}
      onKeyUp={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        onControl({ kind: "keyboard", event: { type: "keyUp", code: event.code, key: event.key } });
      }}
    />
  );
}

function mapPointerButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function isInputCaptureExitShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && event.altKey && event.shiftKey && event.code === "Escape";
}

function isKeyboardShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const current = hotkeyFromKeyboardEvent(event);
  return Boolean(current && normalizeHotkey(current) === normalizeHotkey(shortcut));
}

function hotkeyFromKeyboardEvent(event: KeyboardEvent): string | undefined {
  const key = hotkeyKeyLabel(event);
  if (!key) {
    return undefined;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

function hotkeyKeyLabel(event: KeyboardEvent): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
    return undefined;
  }

  if (event.code.startsWith("Key")) {
    return event.code.slice(3).toUpperCase();
  }

  if (event.code.startsWith("Digit")) {
    return event.code.slice(5);
  }

  if (/^F\d{1,2}$/.test(event.code)) {
    return event.code;
  }

  const map: Record<string, string> = {
    Backquote: "`",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Equal: "=",
    Escape: "Esc",
    Home: "Home",
    Insert: "Insert",
    Minus: "-",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
    Space: "Space",
    Tab: "Tab"
  };

  return map[event.code] ?? event.key;
}

function normalizeHotkey(shortcut: string): string {
  return shortcut.replace(/\s+/g, "").replace(/\bEsc\b/gi, "Escape").toLowerCase();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select") ||
    target.isContentEditable
  );
}

function getDefaultCaptureSource(sources: DesktopCaptureSource[]): DesktopCaptureSource | undefined {
  return sources.find((source) => {
    const name = source.name.toLowerCase();
    return name.includes("screen") || name.includes("display") || name.includes("entire");
  }) ?? sources[0];
}

function formatLatency(value?: number): string {
  return typeof value === "number" ? `${value} ms` : "-";
}

function formatBitrate(value?: number): string {
  return typeof value === "number" && value > 0 ? `${value} kbps` : "-";
}

function formatPacketLoss(percent?: number, packetsLost?: number): string {
  if (typeof percent !== "number") {
    return "-";
  }

  return `${percent}%${typeof packetsLost === "number" ? ` (${packetsLost})` : ""}`;
}

function extractServerLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function HostSettingsPage(): ReactElement {
  const [saveDirectory, setSaveDirectory] = useState("");
  const [launchOnStartup, setLaunchOnStartup] = useState(false);
  const [hostAccessPassword, setHostAccessPassword] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void window.remoteControl.getFileSettings().then((s) => setSaveDirectory(s.saveDirectory));
    void window.remoteControl.getLaunchSettings().then((s) => setLaunchOnStartup(s.launchOnStartup));
    void window.remoteControl.getHostAccessSettings().then((s) => setHostAccessPassword(s.accessPassword));
  }, []);

  async function chooseSaveDirectory(): Promise<void> {
    const result = await window.remoteControl.chooseSaveDirectory();
    if (result.path) setSaveDirectory(result.path);
    if (result.error) setStatus(result.error);
  }

  async function changeLaunchOnStartup(enabled: boolean): Promise<void> {
    setLaunchOnStartup(enabled);
    const result = await window.remoteControl.setLaunchOnStartup(enabled);
    if (!result.ok) {
      setLaunchOnStartup(!enabled);
      if (result.error) setStatus(result.error);
    }
  }

  async function changeHostAccessPassword(password: string): Promise<void> {
    const result = await window.remoteControl.setHostAccessPassword(password);
    if (result.ok) {
      setHostAccessPassword(result.accessPassword ?? "");
    } else if (result.error) {
      setStatus(result.error);
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <div className="section-label">Host</div>
        <h2>Settings</h2>
      </div>

      {status && <div className="settings-page-status">{status}</div>}

      <div className="settings-page-body">
        <div className="field">
          <label>Incoming Files</label>
          <button type="button" onClick={() => void chooseSaveDirectory()}>
            Choose Folder
          </button>
          <div className="path-hint" title={saveDirectory}>{saveDirectory}</div>
        </div>

        <label className="toggle-field compact-toggle">
          <input
            type="checkbox"
            checked={launchOnStartup}
            onChange={(event) => void changeLaunchOnStartup(event.target.checked)}
          />
          <span>
            <strong>Launch at startup</strong>
            <small>Start host app when Windows starts</small>
          </span>
        </label>

        <div className="field">
          <label>Server Password</label>
          <input
            type="password"
            value={hostAccessPassword}
            onChange={(event) => setHostAccessPassword(event.target.value)}
            onBlur={() => void changeHostAccessPassword(hostAccessPassword)}
            placeholder="No password"
          />
          <div className="drop-hint">
            Viewers will be asked for this password before joining.
          </div>
        </div>
      </div>
    </div>
  );
}
