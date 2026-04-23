import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactElement,
  type ReactNode
} from "react";
import type {
  ControlMessage,
  PeerRole,
  ViewerApprovalRequestPayload
} from "@remote-control/shared";

import type { DesktopCaptureSource, EmbeddedBackendStatus, ViewerSettings } from "./env";
import {
  type CaptureMode,
  type FrameRate
} from "./webrtc/RemoteControlClient";
import {
  formatFileSize,
  getDefaultCaptureSource,
  getDisplayName,
  getRemoteControlViewState,
  hasDraggedFiles
} from "./appLogic";
import { AppOverlays } from "./components/AppOverlays";
import { AppSidebar } from "./components/AppSidebar";
import { HostSettingsPage } from "./components/HostSettingsPage";
import { VideoStage } from "./components/VideoStage";
import { useFullscreen } from "./hooks/useFullscreen";
import { useServerDiscovery } from "./hooks/useServerDiscovery";
import { useWebRTC } from "./hooks/useWebRTC";
import { isEditableTarget, isKeyboardShortcut } from "./hotkeys";

const defaultServerUrl = "http://localhost:47315";
const defaultSessionId = "LAN";
const appMode = window.remoteControl.appMode;
const isSettingsPage = new URLSearchParams(window.location.search).get("page") === "host-settings";
const fixedRole: PeerRole | undefined = appMode === "combined" ? undefined : appMode;

export function App(): ReactElement {
  return (
    <AppErrorBoundary>
      {isSettingsPage ? <HostSettingsPage /> : <RemoteControlApp />}
    </AppErrorBoundary>
  );
}

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error?: Error;
};

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Renderer crashed", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="error-boundary">
        <div className="error-card">
          <div className="section-label">Renderer Error</div>
          <h1>Something went wrong</h1>
          <p>{this.state.error.message || "The UI hit an unexpected error."}</p>
          <button type="button" className="connect-btn btn-danger" onClick={() => window.location.reload()}>
            Reload UI
          </button>
        </div>
      </div>
    );
  }
}

function RemoteControlApp(): ReactElement {
  const [role, setRole] = useState<PeerRole>(fixedRole ?? "host");
  const [serverUrl, setServerUrl] = useState(defaultServerUrl);
  const [sessionId] = useState(defaultSessionId);
  const [deviceName, setDeviceName] = useState("");
  const [sources, setSources] = useState<DesktopCaptureSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [status, setStatus] = useState("Ready to connect");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [saveDirectory, setSaveDirectory] = useState("");
  const [isHotkeysOpen, setIsHotkeysOpen] = useState(false);
  const [backendStatus, setBackendStatus] = useState<EmbeddedBackendStatus>({ status: "disabled" });
  const [captureMode, setCaptureMode] = useState<CaptureMode>("desktop");
  const [frameRate, setFrameRate] = useState<FrameRate>(30);
  const [recentServers, setRecentServers] = useState<string[]>([]);
  const [isViewerSettingsOpen, setIsViewerSettingsOpen] = useState(false);
  const [connectInFullscreen, setConnectInFullscreen] = useState(true);
  const [captureLocalInput, setCaptureLocalInput] = useState(false);
  const [disconnectShortcut, setDisconnectShortcut] = useState("Ctrl+Alt+Shift+D");
  const [viewerFrameRate, setViewerFrameRate] = useState<FrameRate>(30);
  const [receiveStreamAudio, setReceiveStreamAudio] = useState(true);
  const [switchMonitorShortcut, setSwitchMonitorShortcut] = useState("Ctrl+Alt+Shift+M");
  const [passwordPrompt, setPasswordPrompt] = useState<{ message: string; password: string } | undefined>();
  const [viewerApprovalPrompt, setViewerApprovalPrompt] = useState<ViewerApprovalRequestPayload | undefined>();
  const [isSetupSettingsOpen, setIsSetupSettingsOpen] = useState(false);

  const webRtc = useWebRTC();
  const {
    enterFullscreen,
    isFullscreen,
    leaveFullscreen,
    syncFullscreenState,
    toggleFullscreen
  } = useFullscreen();
  const hostAutoConnectStartedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const passwordPromptResolverRef = useRef<((password?: string) => void) | undefined>(undefined);
  const viewerApprovalResolverRef = useRef<((approved: boolean) => void) | undefined>(undefined);
  const displayName = getDisplayName(role, deviceName);
  const {
    activeRemoteSourceId,
    connectionStats,
    controlEnabled,
    hostSources,
    isConnected,
    localStream,
    peer,
    receivedFileNotice,
    remoteStream,
    transferLabel,
    transferProgress
  } = webRtc;
  const {
    discoveredServers,
    isDiscovering,
    scanServers,
    serverLatencies
  } = useServerDiscovery({
    defaultServerUrl,
    isConnected,
    serverUrl,
    setServerUrl,
    setStatus
  });

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId),
    [selectedSourceId, sources]
  );

  useEffect(() => {
    void loadFileSettings();
    void loadViewerSettings();
    void loadRecentServers();
    void loadDeviceName();
    void syncFullscreenState();
  }, []);

  useEffect(() => {
    if (appMode !== "host") return;
    return window.remoteControl.onHostSettingsClosed(() => {
      void loadFileSettings();
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
    if (appMode !== "host") {
      return;
    }

    return window.remoteControl.onHostShutdownRequested(() => {
      setStatus("Host is shutting down");
      webRtc.announceHostShutdown("Host is shutting down");
    });
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

      if (event.key === "Escape" && isHotkeysOpen) {
        event.preventDefault();
        setIsHotkeysOpen(false);
        return;
      }

      if (event.key === "?" && !isEditableTarget(event.target) && isConnected) {
        event.preventDefault();
        setIsHotkeysOpen((v) => !v);
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
  }, [appMode, isConnected, isFullscreen, isHotkeysOpen, isViewerSettingsOpen]);

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
    try {
      await webRtc.connect({
        role,
        sessionId: sessionId.trim(),
        serverUrl: serverUrl.trim(),
        displayName: displayName.trim() || role,
        captureSourceId: role === "host" ? selectedSourceId : undefined,
        captureMode: role === "host" ? captureMode : undefined,
        frameRate: role === "host" ? frameRate : undefined,
        onStatus: setStatus,
        onControlReady: () => {
          if (role === "viewer") {
            webRtc.sendHostStreamSettings({
              audioEnabled: receiveStreamAudio,
              frameRate: viewerFrameRate
            });
          }
        },
        onPasswordRequired: requestServerPassword,
        onViewerApprovalRequest: requestViewerApproval
      });

      if (role === "viewer") {
        const result = await window.remoteControl.addRecentServer(serverUrl.trim());
        if (result.recentServers) {
          setRecentServers(result.recentServers);
        }
        if (captureLocalInput) {
          webRtc.setControlEnabled(true);
        }
        if (connectInFullscreen) {
          await enterFullscreen();
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function disconnect(): void {
    webRtc.disconnect();
    viewerApprovalResolverRef.current?.(false);
    viewerApprovalResolverRef.current = undefined;
    setViewerApprovalPrompt(undefined);
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

    webRtc.sendControlMessage(message);
  }

  function switchRemoteSource(sourceId: string): void {
    webRtc.switchRemoteSource(sourceId);
  }

  async function sendSelectedFile(file: File): Promise<void> {
    await webRtc.sendFile(file, setStatus);
  }

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024 && !window.confirm(`Send "${file.name}" (${formatFileSize(file.size)}) to the remote host?`)) {
        event.target.value = "";
        return;
      }
      void sendSelectedFile(file);
    }
    event.target.value = "";
  }

  function handleFileDragOver(event: React.DragEvent<HTMLElement>): void {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (!isConnected || !peer) {
      return;
    }

    setIsDraggingFile(true);
  }

  function handleFileDragLeave(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDraggingFile(false);
  }

  function handleFileDrop(event: React.DragEvent<HTMLElement>): void {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    setIsDraggingFile(false);

    if (!isConnected || !peer) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (file) {
      if (file.size > 50 * 1024 * 1024 && !window.confirm(`Send "${file.name}" (${formatFileSize(file.size)}) to the remote host?`)) {
        return;
      }
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
        webRtc.setControlEnabled(true);
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

  async function loadDeviceName(): Promise<void> {
    try {
      setDeviceName(await window.remoteControl.getDeviceName());
    } catch {
      setDeviceName("");
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
      webRtc.disconnect();
      void leaveFullscreen();
    }
  }

  function requestViewerApproval(request: ViewerApprovalRequestPayload): Promise<boolean> {
    if (appMode !== "host" || viewerApprovalResolverRef.current) {
      return Promise.resolve(false);
    }

    setViewerApprovalPrompt(request);
    setStatus(`${request.displayName ?? "Viewer"} is requesting access`);
    return new Promise((resolve) => {
      viewerApprovalResolverRef.current = resolve;
    });
  }

  function resolveViewerApproval(approved: boolean): void {
    viewerApprovalResolverRef.current?.(approved);
    viewerApprovalResolverRef.current = undefined;
    setViewerApprovalPrompt(undefined);
    setStatus(approved ? "Viewer approved" : "Viewer rejected");
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

    webRtc.sendHostStreamSettings({
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
      webRtc.setControlEnabled(true);
      setIsViewerSettingsOpen(false);
    }
  }

  function changeControlEnabled(enabled: boolean): void {
    webRtc.setControlEnabled(enabled);
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

  function confirmAndDisconnect(): void {
    if (window.confirm("Disconnect from the remote host?")) {
      disconnect();
    }
  }

  const {
    appShellClassName,
    canConnect,
    isViewerMode
  } = getRemoteControlViewState({
    appMode,
    isConnected,
    role,
    selectedSourceId,
    serverUrl,
    sessionId
  });

  return (
    <div
      className={appShellClassName}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      <AppOverlays
        isHostFileDropVisible={role === "host" && isDraggingFile && isConnected && Boolean(peer)}
        passwordPrompt={passwordPrompt}
        receivedFileNotice={receivedFileNotice}
        viewerApprovalPrompt={viewerApprovalPrompt}
        onCloseReceivedFile={webRtc.clearReceivedFileNotice}
        onOpenReceivedFolder={(path) => void openReceivedFolder(path)}
        onPasswordChange={(password) => setPasswordPrompt((current) => current ? { ...current, password } : current)}
        onResolvePassword={resolvePasswordPrompt}
        onResolveViewerApproval={resolveViewerApproval}
      />

      <AppSidebar
        appMode={appMode}
        backendStatus={backendStatus}
        canConnect={canConnect}
        captureLocalInput={captureLocalInput}
        captureMode={captureMode}
        connectInFullscreen={connectInFullscreen}
        disconnectShortcut={disconnectShortcut}
        discoveredServers={discoveredServers}
        fileInputRef={fileInputRef}
        frameRate={frameRate}
        isConnected={isConnected}
        isDiscovering={isDiscovering}
        isSetupSettingsOpen={isSetupSettingsOpen}
        peer={peer}
        receiveStreamAudio={receiveStreamAudio}
        recentServers={recentServers}
        role={role}
        serverLatencies={serverLatencies}
        serverUrl={serverUrl}
        status={status}
        switchMonitorShortcut={switchMonitorShortcut}
        transferLabel={transferLabel}
        transferProgress={transferProgress}
        viewerFrameRate={viewerFrameRate}
        onCaptureLocalInputChange={changeCaptureLocalInput}
        onCaptureModeChange={setCaptureMode}
        onConnect={() => void connect()}
        onConnectInFullscreenChange={changeConnectInFullscreen}
        onDisconnect={confirmAndDisconnect}
        onDisconnectShortcutChange={changeDisconnectShortcut}
        onFileInputChange={handleFileInputChange}
        onFrameRateChange={setFrameRate}
        onOpenHostSettings={() => void window.remoteControl.openHostSettings()}
        onReceiveAudioChange={changeReceiveStreamAudio}
        onScanServers={() => void scanServers()}
        onSelectFile={() => fileInputRef.current?.click()}
        onServerUrlChange={setServerUrl}
        onSetupSettingsToggle={() => setIsSetupSettingsOpen((value) => !value)}
        onSwitchMonitorShortcutChange={changeSwitchMonitorShortcut}
        onViewerFrameRateChange={changeViewerFrameRate}
      />

      <VideoStage
        activeRemoteSourceId={activeRemoteSourceId}
        appMode={appMode}
        captureLocalInput={captureLocalInput}
        connectionStats={connectionStats}
        connectInFullscreen={connectInFullscreen}
        controlEnabled={controlEnabled}
        disconnectShortcut={disconnectShortcut}
        fileInputRef={fileInputRef}
        hostSources={hostSources}
        isConnected={isConnected}
        isDraggingFile={isDraggingFile}
        isFullscreen={isFullscreen}
        isHotkeysOpen={isHotkeysOpen}
        isViewerMode={isViewerMode}
        isViewerSettingsOpen={isViewerSettingsOpen}
        localVideoRef={localVideoRef}
        peer={peer}
        receiveStreamAudio={receiveStreamAudio}
        remoteVideoRef={remoteVideoRef}
        role={role}
        saveDirectory={saveDirectory}
        selectedSource={selectedSource}
        switchMonitorShortcut={switchMonitorShortcut}
        transferLabel={transferLabel}
        transferProgress={transferProgress}
        viewerFrameRate={viewerFrameRate}
        onChangeDisconnectShortcut={changeDisconnectShortcut}
        onChangeSwitchMonitorShortcut={changeSwitchMonitorShortcut}
        onChooseSaveDirectory={() => void chooseSaveDirectory()}
        onCloseHotkeys={() => setIsHotkeysOpen(false)}
        onCloseViewerSettings={() => setIsViewerSettingsOpen(false)}
        onControl={sendControl}
        onDisconnect={confirmAndDisconnect}
        onFileInputChange={handleFileInputChange}
        onInputCaptureChange={changeCaptureLocalInput}
        onSelectFile={() => fileInputRef.current?.click()}
        onSwitchRemoteSource={switchRemoteSource}
        onSwitchToNextRemoteSource={switchToNextRemoteSource}
        onToggleCaptureLocalInput={changeCaptureLocalInput}
        onToggleConnectInFullscreen={changeConnectInFullscreen}
        onToggleControl={changeControlEnabled}
        onToggleFullscreen={() => void toggleFullscreen()}
        onToggleReceiveAudio={changeReceiveStreamAudio}
        onToggleViewerSettings={() => setIsViewerSettingsOpen((value) => !value)}
        onViewerFrameRateChange={changeViewerFrameRate}
      />
    </div>
  );
}
