import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import type { ControlMessage, DiscoveredServer, HostSource, PeerJoinedPayload, PeerRole } from "@remote-control/shared";

import type { DesktopCaptureSource, EmbeddedBackendStatus } from "./env";
import { RemoteControlClient, type CaptureMode, type FrameRate } from "./webrtc/RemoteControlClient";

const defaultServerUrl = "http://localhost:47315";
const defaultSessionId = "LAN";
const appMode = window.remoteControl.appMode;
const fixedRole: PeerRole | undefined = appMode === "combined" ? undefined : appMode;

export function App(): ReactElement {
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
  const [hostSources, setHostSources] = useState<HostSource[]>([]);
  const [activeRemoteSourceId, setActiveRemoteSourceId] = useState<string | undefined>();
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [portInput, setPortInput] = useState("47315");
  const [isRestarting, setIsRestarting] = useState(false);
  const [backendStatus, setBackendStatus] = useState<EmbeddedBackendStatus>({ status: "disabled" });
  const [captureMode, setCaptureMode] = useState<CaptureMode>("desktop");
  const [frameRate, setFrameRate] = useState<FrameRate>(30);

  const clientRef = useRef<RemoteControlClient | undefined>(undefined);
  const hostAutoConnectStartedRef = useRef(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId),
    [selectedSourceId, sources]
  );

  useEffect(() => {
    document.title = window.remoteControl.productName;
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
    if (appMode !== "host") return;

    async function pollBackend(): Promise<void> {
      const backend = await window.remoteControl.getBackendStatus();
      if (backend.port) setPortInput(String(backend.port));
    }

    void pollBackend();
    const interval = window.setInterval(() => void pollBackend(), 2000);
    return () => window.clearInterval(interval);
  }, []);

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
      onLocalStream: setLocalStream,
      onRemoteStream: setRemoteStream
    });

    clientRef.current = client;
    setIsConnected(true);

    try {
      await client.connect();
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
    setHostSources([]);
    setActiveRemoteSourceId(undefined);
    setPeer(undefined);
    setStatus("Disconnected");
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

  async function syncEmbeddedBackend(): Promise<void> {
    const backend = await window.remoteControl.getBackendStatus();
    setBackendStatus(backend);
    if (!backend.url) return;
    setServerUrl(backend.url);
    if (!isConnected) {
      setStatus(backend.status === "running" ? `Backend ready: ${backend.url}` : `Backend ${backend.status}: ${backend.url}`);
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

  async function handleRestartBackend(): Promise<void> {
    const port = parseInt(portInput, 10);
    if (!port || port < 1024 || port > 65535) return;
    setIsRestarting(true);
    try {
      if (isConnected) disconnect();
      hostAutoConnectStartedRef.current = false;
      const next = await window.remoteControl.restartBackend(port);
      if (next.url) setServerUrl(next.url);
      setStatus(`Server restarted on port ${next.port}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRestarting(false);
    }
  }

  const canConnect = Boolean(serverUrl.trim() && sessionId.trim() && (role === "viewer" || selectedSourceId));

  return (
    <div className={`app-shell${appMode === "host" ? " host-mode" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-icon">RC</div>
          <div className="brand-text">
            <h1>{window.remoteControl.productName}</h1>
            <span>v1.0 · Secure</span>
          </div>
        </div>

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
                    <span className="server-stat-value mono">{backendStatus.url ?? "—"}</span>
                  </div>
                  <div className="server-stat-row">
                    <span className="server-stat-label">Viewer</span>
                    <span className="server-stat-value accent">{peer ? (peer.displayName ?? "Connected") : "None"}</span>
                  </div>
                </div>

                {appMode !== "host" && (
                <div className="port-row">
                  <div className="field" style={{ flex: 1, margin: 0 }}>
                    <label>Port</label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={portInput}
                      onChange={(e) => setPortInput(e.target.value)}
                      disabled={isRestarting}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-restart"
                    onClick={() => void handleRestartBackend()}
                    disabled={isRestarting || portInput === String(backendStatus.port)}
                    title="Restart server on this port"
                  >
                    {isRestarting ? "…" : "Restart"}
                  </button>
                </div>
                )}
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
                placeholder="http://localhost:3001"
              />
            </div>

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

            {role === "viewer" && (
              <label className="toggle-field">
                <input
                  type="checkbox"
                  checked={controlEnabled}
                  onChange={(event) => setControlEnabled(event.target.checked)}
                  disabled={!isConnected}
                />
                <span>
                  <strong>Take control</strong>
                  <small>Send mouse and keyboard input to the host</small>
                </span>
              </label>
            )}

            {role === "viewer" && hostSources.length > 1 && (
              <div className="field">
                <label>Monitor</label>
                <select
                  value={activeRemoteSourceId ?? ""}
                  onChange={(event) => switchRemoteSource(event.target.value)}
                  disabled={!isConnected}
                >
                  {hostSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {role === "viewer" && (
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

      {appMode !== "host" && (
        <section className="video-stage">
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
            <RemoteVideo videoRef={remoteVideoRef} controlEnabled={controlEnabled} onControl={sendControl} />
          ) : (
            <VideoEmpty
              icon="📡"
              title="Waiting for stream"
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

function RemoteVideo({
  videoRef,
  controlEnabled,
  onControl
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  controlEnabled: boolean;
  onControl: (message: ControlMessage) => void;
}): ReactElement {
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
      className={`desktop-video interactive${controlEnabled ? "" : " control-disabled"}`}
      autoPlay
      playsInline
      tabIndex={controlEnabled ? 0 : -1}
      onContextMenu={(event) => event.preventDefault()}
      onPointerMove={(event) => {
        if (!controlEnabled) return;
        onControl({ kind: "pointer", event: { type: "move", ...pointerPosition(event) } });
      }}
      onPointerDown={(event) => {
        if (!controlEnabled) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        onControl({
          kind: "pointer",
          event: { type: "click", button: mapPointerButton(event.button), ...pointerPosition(event) }
        });
      }}
      onWheel={(event) => {
        if (!controlEnabled) return;
        onControl({ kind: "pointer", event: { type: "scroll", deltaX: event.deltaX, deltaY: event.deltaY } });
      }}
      onKeyDown={(event) => {
        if (!controlEnabled) return;
        if (event.repeat) return;
        onControl({ kind: "keyboard", event: { type: "keyDown", code: event.code, key: event.key } });
      }}
      onKeyUp={(event) => {
        if (!controlEnabled) return;
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

function getDefaultCaptureSource(sources: DesktopCaptureSource[]): DesktopCaptureSource | undefined {
  return sources.find((source) => {
    const name = source.name.toLowerCase();
    return name.includes("screen") || name.includes("display") || name.includes("entire");
  }) ?? sources[0];
}
