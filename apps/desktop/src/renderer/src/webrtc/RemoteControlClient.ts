import type {
  ClientToServerEvents,
  ClipboardSyncMessage,
  ControlMessage,
  DataChannelMessage,
  FileTransferAbortMessage,
  FileTransferChunkMessage,
  FileTransferCompleteMessage,
  FileTransferStartMessage,
  HostCommandMessage,
  HostSource,
  JoinSessionResponse,
  PeerJoinedPayload,
  PeerRole,
  RtcIceCandidate,
  RtcSessionDescription,
  ServerToClientEvents,
  TurnCredentials,
  ViewerApprovalRequestPayload
} from "@remote-control/shared";
import { io, type Socket } from "socket.io-client";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type CaptureMode = "desktop" | "game";
export type FrameRate = 15 | 30 | 60;

export type ConnectionStats = {
  latencyMs?: number;
  videoBitrateKbps?: number;
  audioBitrateKbps?: number;
  packetsLost?: number;
  packetLossPercent?: number;
};

export type RemoteControlDiagnosticCode =
  | "SIGNALING_CONNECTING"
  | "SIGNALING_CONNECTED"
  | "SIGNALING_DISCONNECTED"
  | "SIGNALING_ERROR"
  | "SIGNALING_RECONNECTING"
  | "SIGNALING_RECONNECTED"
  | "SESSION_JOINED"
  | "SESSION_JOIN_FAILED"
  | "SESSION_PASSWORD_REQUIRED"
  | "SESSION_PEER_LEFT"
  | "SESSION_SHUTDOWN"
  | "WEBRTC_STATE"
  | "WEBRTC_RECONNECT_SCHEDULED"
  | "WEBRTC_RECONNECT_FAILED"
  | "CONTROL_CHANNEL_NOT_READY"
  | "CONTROL_CHANNEL_READY"
  | "CONTROL_CHANNEL_CLOSED"
  | "CONTROL_CHANNEL_INVALID_MESSAGE"
  | "CAPTURE_STARTING"
  | "CAPTURE_SOURCE_UPDATED"
  | "STREAM_SETTINGS_UPDATED"
  | "CLIPBOARD_SYNC_INVALID"
  | "FILE_TRANSFER_REJECTED"
  | "FILE_TRANSFER_RECEIVING"
  | "FILE_TRANSFER_FAILED"
  | "FILE_TRANSFER_INCOMPLETE"
  | "FILE_TRANSFER_SAVED"
  | "FILE_TRANSFER_INTERRUPTED"
  | "NETWORK_RECOVERY";

export type RemoteControlDiagnostic = {
  code: RemoteControlDiagnosticCode;
  message: string;
  details?: Record<string, string | number | boolean | undefined>;
};

type IncomingFileTransfer = {
  checksum: number;
  failed: boolean;
  name: string;
  size: number;
  mimeType: string;
  nextChunkIndex: number;
  path?: string;
  queue: Promise<void>;
  receivedBytes: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
};

type ClipboardData = {
  html?: string;
  imageDataUrl?: string;
  text?: string;
};

const maxClipboardTextLength = 1 * 1024 * 1024;
const maxClipboardImageDataUrlLength = 12 * 1024 * 1024;
const maxFileTransferBytes = 256 * 1024 * 1024;
const maxFileTransferChunkBase64Length = 96 * 1024;
const maxFileTransferChunkBytes = 72 * 1024;
const maxFileTransferIdLength = 80;
const maxFileNameLength = 260;
const maxHostSources = 16;
const maxIncomingTransfers = 4;
const maxDataChannelMessageLength = 13 * 1024 * 1024;
const fileTransferReasonMaxLength = 256;
const incomingFileTransferTimeoutMs = 30_000;
const imageDataUrlPrefixPattern = /^data:image\/(?:png|jpeg|jpg|webp|gif|bmp);base64,/i;
const mimeTypePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const checksumPattern = /^[a-f0-9]{8}$/i;

export type RemoteControlClientOptions = {
  role: PeerRole;
  sessionId: string;
  serverUrl: string;
  displayName: string;
  captureSourceId?: string;
  captureMode?: CaptureMode;
  frameRate?: FrameRate;
  onStatus: (status: string) => void;
  onPeer: (peer: PeerJoinedPayload | undefined) => void;
  onHostSources?: (sources: HostSource[], activeSourceId?: string) => void;
  onControlReady?: () => void;
  onPasswordRequired?: (message: string) => Promise<string | undefined>;
  onViewerApprovalRequest?: (request: ViewerApprovalRequestPayload) => Promise<boolean>;
  onStats?: (stats: ConnectionStats | undefined) => void;
  onFileReceived?: (file: { name: string; path?: string }) => void;
  onDiagnostic?: (diagnostic: RemoteControlDiagnostic) => void;
  onLocalStream: (stream: MediaStream | undefined) => void;
  onRemoteStream: (stream: MediaStream | undefined) => void;
};

export class RemoteControlClient {
  private socket?: ClientSocket;
  private peerConnection?: RTCPeerConnection;
  private localStream?: MediaStream;
  private remoteStream?: MediaStream;
  private controlChannel?: RTCDataChannel;
  private videoTransceiver?: RTCRtpTransceiver;
  private audioTransceiver?: RTCRtpTransceiver;
  private peerClientId?: string;
  private currentCaptureSourceId?: string;
  private currentAudioEnabled = true;
  private currentFrameRate: FrameRate;
  private currentVideoBitrate: number;
  private iceServers: TurnCredentials[] = [{ urls: ["stun:stun.l.google.com:19302"] }];
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectInProgress = false;
  private isDisconnected = true;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private networkRecoveryTimer?: ReturnType<typeof setTimeout>;
  private removeNetworkRecoveryListeners?: () => void;
  private statsTimer?: ReturnType<typeof setInterval>;
  private statsPollingToken = 0;
  private clipboardTimer?: ReturnType<typeof setInterval>;
  private clipboardSyncToken = 0;
  private lastBitrateAdaptationAt = 0;
  private clipboardSnapshot = "";
  private remoteClipboardSnapshot?: string;
  private lastSessionPassword?: string;
  private readonly outgoingTransferAbortReasons = new Map<string, string>();
  private previousStatsSample?: {
    timestamp: number;
    videoBytes: number;
    audioBytes: number;
    packetsLost: number;
    packetsReceived: number;
  };
  private readonly incomingTransfers = new Map<string, IncomingFileTransfer>();

  constructor(private readonly options: RemoteControlClientOptions) {
    this.currentCaptureSourceId = options.captureSourceId;
    this.currentFrameRate = options.frameRate ?? 30;
    this.currentVideoBitrate = this.getInitialVideoBitrate();
  }

  async connect(): Promise<void> {
    this.isDisconnected = false;

    if (this.options.role === "host") {
      await this.startDesktopCapture();
    }

    this.reportStatus("SIGNALING_CONNECTING", "Connecting to signaling server");
    this.socket = io(this.options.serverUrl, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0.5
    });

    this.registerSocketHandlers(this.socket);
    this.registerNetworkRecoveryHandlers();
  }

  disconnect(): void {
    this.isDisconnected = true;
    this.reconnectInProgress = false;
    this.stopReconnectTimer();
    this.stopNetworkRecoveryTimer();
    this.unregisterNetworkRecoveryHandlers();
    this.stopSessionHeartbeat();
    this.stopStatsPolling();
    this.stopClipboardSync();
    for (const transferId of this.incomingTransfers.keys()) {
      void window.remoteControl.abortIncomingFileTransfer(transferId);
    }
    this.incomingTransfers.clear();
    this.controlChannel?.close();
    this.peerConnection?.close();
    this.socket?.disconnect();
    this.localStream?.getTracks().forEach((track) => track.stop());

    this.controlChannel = undefined;
    this.peerConnection = undefined;
    this.videoTransceiver = undefined;
    this.audioTransceiver = undefined;
    this.socket = undefined;
    this.localStream = undefined;
    this.remoteStream = undefined;
    this.peerClientId = undefined;
    this.lastSessionPassword = undefined;
    this.pendingCandidates.length = 0;
    this.previousStatsSample = undefined;
    this.options.onPeer(undefined);
    this.options.onHostSources?.([], undefined);
    this.options.onStats?.(undefined);
    this.options.onLocalStream(undefined);
    this.options.onRemoteStream(undefined);
    this.reportStatus("SIGNALING_DISCONNECTED", "Disconnected");
  }

  announceHostShutdown(reason = "Host is shutting down"): void {
    if (this.options.role !== "host" || !this.socket?.connected) {
      return;
    }

    this.socket.emit("session:shutdown", {
      sessionId: this.options.sessionId,
      reason
    });
  }

  sendControlMessage(message: ControlMessage): void {
    if (this.options.role !== "viewer") {
      return;
    }

    if (this.controlChannel?.readyState !== "open") {
      this.reportStatus("CONTROL_CHANNEL_NOT_READY", "Control channel is not ready yet");
      return;
    }

    this.controlChannel.send(JSON.stringify(message));
  }

  sendHostCommand(sourceId: string): void {
    if (this.options.role !== "viewer") {
      return;
    }

    if (this.controlChannel?.readyState !== "open") {
      this.reportStatus("CONTROL_CHANNEL_NOT_READY", "Control channel is not ready yet");
      return;
    }

    const message: DataChannelMessage = {
      kind: "host-command",
      command: {
        type: "switch-source",
        sourceId
      }
    };

    this.controlChannel.send(JSON.stringify(message));
  }

  sendHostStreamSettings(settings: { audioEnabled: boolean; frameRate: FrameRate }): void {
    if (this.options.role !== "viewer") {
      return;
    }

    if (this.controlChannel?.readyState !== "open") {
      this.reportStatus("CONTROL_CHANNEL_NOT_READY", "Control channel is not ready yet");
      return;
    }

    const message: HostCommandMessage = {
      kind: "host-command",
      command: {
        type: "update-stream-settings",
        audioEnabled: settings.audioEnabled,
        frameRate: settings.frameRate
      }
    };

    this.controlChannel.send(JSON.stringify(message));
  }

  async sendFile(file: File, onProgress?: (progress: number) => void): Promise<void> {
    if (file.size > maxFileTransferBytes) {
      throw new Error(`Failed to send ${file.name}: file is larger than ${formatBytes(maxFileTransferBytes)}`);
    }

    const channel = this.getOpenControlChannel();

    const transferId = createTransferId();
    this.outgoingTransferAbortReasons.delete(transferId);
    const startMessage: FileTransferStartMessage = {
      kind: "file-transfer-start",
      transferId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size
    };

    try {
      this.sendFileTransferMessage(channel, startMessage);

      const chunkSize = 48 * 1024;
      let offset = 0;
      let index = 0;
      let checksum = createFileTransferChecksum();

      while (offset < file.size) {
        this.ensureFileTransferChannelOpen(channel);
        this.throwIfOutgoingTransferAborted(transferId);

        const chunk = file.slice(offset, offset + chunkSize);
        const bytes = new Uint8Array(await chunk.arrayBuffer());
        checksum = updateFileTransferChecksum(checksum, bytes);
        const chunkMessage: FileTransferChunkMessage = {
          kind: "file-transfer-chunk",
          transferId,
          index,
          data: bytesToBase64(bytes)
        };

        this.sendFileTransferMessage(channel, chunkMessage);
        offset += chunk.size;
        index += 1;
        onProgress?.(Math.min(100, Math.round((offset / file.size) * 100)));
        await waitForChannelDrain(channel);
        this.throwIfOutgoingTransferAborted(transferId);
      }

      const completeMessage: FileTransferCompleteMessage = {
        kind: "file-transfer-complete",
        transferId,
        checksum: formatFileTransferChecksum(checksum)
      };

      this.sendFileTransferMessage(channel, completeMessage);
      await waitForChannelDrain(channel);
      this.throwIfOutgoingTransferAborted(transferId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.sendFileTransferAbort(channel, transferId, reason);
      throw new Error(`Failed to send ${file.name}: ${reason}`);
    } finally {
      this.outgoingTransferAbortReasons.delete(transferId);
    }
  }

  private registerSocketHandlers(socket: ClientSocket): void {
    socket.on("connect", () => {
      this.reportStatus("SIGNALING_CONNECTED", `Connected as ${this.options.role}`, {
        role: this.options.role
      });
      this.joinSession(this.lastSessionPassword);
    });

    socket.on("disconnect", () => {
      this.stopSessionHeartbeat();
      if (this.isDisconnected) {
        return;
      }

      this.reportStatus("SIGNALING_DISCONNECTED", "Signaling disconnected");
      this.scheduleReconnect();
    });

    socket.on("connect_error", (error) => {
      this.reportStatus("SIGNALING_ERROR", `Signaling error: ${error.message}`, {
        error: error.message
      });
    });

    socket.io.on("reconnect_attempt", (attempt) => {
      if (!this.isDisconnected) {
        this.reportStatus("SIGNALING_RECONNECTING", `Reconnecting signaling server (${attempt})`, {
          attempt
        });
      }
    });

    socket.io.on("reconnect", () => {
      if (!this.isDisconnected) {
        this.reportStatus("SIGNALING_RECONNECTED", "Signaling reconnected");
      }
    });

    socket.on("error", (payload) => {
      this.reportStatus("SIGNALING_ERROR", payload.message);
    });

    socket.on("turn:config", (payload) => {
      this.iceServers = payload.iceServers;
    });

    socket.on("session:approval-request", (request, respond) => {
      if (this.options.role !== "host" || !this.options.onViewerApprovalRequest) {
        respond({
          approved: false,
          reason: "Host approval is unavailable"
        });
        return;
      }

      void this.options.onViewerApprovalRequest(request)
        .then((approved) => {
          respond({
            approved,
            reason: approved ? undefined : "Rejected by host"
          });
        })
        .catch(() => {
          respond({
            approved: false,
            reason: "Host approval failed"
          });
        });
    });

    socket.on("session:joined", (peer) => {
      this.peerClientId = peer.clientId;
      this.options.onPeer(peer);

      if (this.options.role === "host") {
        void this.createOffer(peer.clientId);
      }
    });

    socket.on("session:left", (payload) => {
      if (payload.clientId === this.peerClientId) {
        this.peerClientId = undefined;
        this.resetPeerConnection();
        this.options.onPeer(undefined);
        this.remoteStream = undefined;
        this.options.onRemoteStream(undefined);
        this.options.onStats?.(undefined);
        this.reportStatus("SESSION_PEER_LEFT", "Peer left the session", {
          clientId: payload.clientId
        });
      }
    });

    socket.on("session:shutdown", (payload) => {
      if (payload.clientId === this.peerClientId) {
        this.peerClientId = undefined;
        this.resetPeerConnection();
        this.options.onPeer(undefined);
        this.remoteStream = undefined;
        this.options.onRemoteStream(undefined);
        this.options.onStats?.(undefined);
        this.reportStatus("SESSION_SHUTDOWN", payload.reason, {
          clientId: payload.clientId
        });
      }
    });

    socket.on("signal:offer", (payload) => {
      void this.handleOffer(payload.fromClientId, payload.description);
    });

    socket.on("signal:answer", (payload) => {
      void this.handleAnswer(payload.description);
    });

    socket.on("signal:ice-candidate", (payload) => {
      void this.handleIceCandidate(payload.candidate);
    });
  }

  private joinSession(password?: string): void {
    if (!this.socket) {
      return;
    }

    if (typeof password === "string") {
      this.lastSessionPassword = password;
    }

    this.socket.emit(
      "session:join",
      {
        sessionId: this.options.sessionId,
        role: this.options.role,
        displayName: this.options.displayName,
        password: password ?? this.lastSessionPassword
      },
      (response) => {
        void this.handleJoinResponse(response);
      }
    );
  }

  private async handleJoinResponse(response: JoinSessionResponse): Promise<void> {
    if ("clientId" in response) {
      this.reportStatus("SESSION_JOINED", `Joined session ${this.options.sessionId} as ${response.clientId}`, {
        sessionId: this.options.sessionId,
        clientId: response.clientId
      });
      this.startSessionHeartbeat();
      return;
    }

    if (response.passwordRequired && this.options.onPasswordRequired) {
      this.reportStatus("SESSION_PASSWORD_REQUIRED", response.error, {
        sessionId: this.options.sessionId
      });
      const password = await this.options.onPasswordRequired(response.error);
      if (typeof password === "string") {
        this.joinSession(password);
        return;
      }
    }

    this.reportStatus("SESSION_JOIN_FAILED", response.error, {
      sessionId: this.options.sessionId
    });
    this.disconnect();
  }

  private async startDesktopCapture(): Promise<void> {
    if (!this.currentCaptureSourceId) {
      throw new Error("Host mode requires a selected desktop source");
    }

    this.reportStatus("CAPTURE_STARTING", "Starting desktop capture", {
      sourceId: this.currentCaptureSourceId
    });

    const frameRate = this.currentFrameRate;
    const constraints = {
      audio: this.currentAudioEnabled
        ? {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: this.currentCaptureSourceId
            }
          }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: this.currentCaptureSourceId,
          maxFrameRate: frameRate
        }
      }
    } as unknown as MediaStreamConstraints;

    const peerConnection = this.ensurePeerConnection();
    const previousStream = this.localStream;
    const nextStream = await navigator.mediaDevices.getUserMedia(constraints);
    const nextVideoTrack = nextStream.getVideoTracks()[0];
    const nextAudioTrack = nextStream.getAudioTracks()[0];

    if (!nextVideoTrack) {
      nextStream.getTracks().forEach((track) => track.stop());
      throw new Error("Selected source did not provide a video track");
    }

    nextVideoTrack.contentHint = this.options.captureMode === "game" ? "motion" : "detail";

    const sender = peerConnection.getSenders().find((candidate) => candidate.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(nextVideoTrack);
    } else {
      this.videoTransceiver = peerConnection.addTransceiver(nextVideoTrack, {
        direction: "sendonly",
        streams: [nextStream]
      });
      this.setCodecPreferences(this.videoTransceiver);
    }

    const audioSender = this.audioTransceiver?.sender
      ?? peerConnection.getSenders().find((candidate) => candidate.track?.kind === "audio");
    if (nextAudioTrack) {
      if (audioSender) {
        await audioSender.replaceTrack(nextAudioTrack);
      } else {
        this.audioTransceiver = peerConnection.addTransceiver(nextAudioTrack, {
          direction: "sendonly",
          streams: [nextStream]
        });
      }
    } else if (audioSender) {
      await audioSender.replaceTrack(null);
    }

    previousStream?.getTracks().forEach((track) => track.stop());
    this.localStream = nextStream;
    this.options.onLocalStream(this.localStream);
    await this.publishHostState();
  }

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.peerConnection) {
      return this.peerConnection;
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !this.socket) {
        return;
      }

      this.socket.emit("signal:ice-candidate", {
        sessionId: this.options.sessionId,
        targetClientId: this.peerClientId,
        candidate: serializeIceCandidate(event.candidate.toJSON())
      });
    };

    peerConnection.ontrack = (event) => {
      const stream = event.streams[0] ?? this.ensureRemoteStream();
      if (event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else if (!stream.getTracks().some((track) => track.id === event.track.id)) {
        stream.addTrack(event.track);
      }

      this.options.onRemoteStream(stream);
      event.track.onended = () => {
        if (!this.remoteStream) {
          return;
        }

        const nextTracks = this.remoteStream.getTracks().filter((track) => track.readyState !== "ended");
        if (nextTracks.length === 0) {
          this.remoteStream = undefined;
          this.options.onRemoteStream(undefined);
          return;
        }

        this.options.onRemoteStream(this.remoteStream);
      };
    };

    peerConnection.onconnectionstatechange = () => {
      this.reportStatus("WEBRTC_STATE", `WebRTC state: ${peerConnection.connectionState}`, {
        connectionState: peerConnection.connectionState
      });
      if (peerConnection.connectionState === "connected" && this.options.role === "host") {
        void this.applyVideoEncoderParams();
      }

      if (peerConnection.connectionState === "connected") {
        this.stopReconnectTimer();
        this.reconnectInProgress = false;
        this.startStatsPolling();
      }

      if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "disconnected") {
        this.scheduleReconnect();
      }
    };

    if (this.options.role === "host") {
      this.controlChannel = peerConnection.createDataChannel("control");
      this.bindControlChannel(this.controlChannel);
    } else {
      peerConnection.ondatachannel = (event) => {
        this.controlChannel = event.channel;
        this.bindControlChannel(event.channel);
      };
    }

    this.peerConnection = peerConnection;
    return peerConnection;
  }

  private bindControlChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.reportStatus("CONTROL_CHANNEL_READY", "Control channel ready");
      this.startClipboardSync();
      this.options.onControlReady?.();
      if (this.options.role === "host") {
        void this.publishHostState();
      }
    };

    channel.onclose = () => {
      this.stopClipboardSync();
      this.failIncomingFileTransfers("Incoming file transfer interrupted");
      this.reportStatus("CONTROL_CHANNEL_CLOSED", "Control channel closed");
    };

    channel.onmessage = (event) => {
      const parsed = parseDataChannelMessage(event.data);
      if (!parsed) {
        this.reportStatus("CONTROL_CHANNEL_INVALID_MESSAGE", "Ignored invalid control channel message");
        return;
      }

      if (parsed.kind === "host-state") {
        if (this.options.role !== "host") {
          this.options.onHostSources?.(parsed.sources, parsed.activeSourceId);
        }
        return;
      }

      if (parsed.kind === "clipboard-sync") {
        void this.applyRemoteClipboard(parsed);
        return;
      }

      if (parsed.kind === "file-transfer-start") {
        this.beginIncomingFileTransfer(parsed);
        return;
      }

      if (parsed.kind === "file-transfer-chunk") {
        this.appendIncomingFileChunk(parsed);
        return;
      }

      if (parsed.kind === "file-transfer-complete") {
        void this.completeIncomingFileTransfer(parsed);
        return;
      }

      if (parsed.kind === "file-transfer-abort") {
        this.handleFileTransferAbort(parsed);
        return;
      }

      if (this.options.role !== "host") {
        return;
      }

      if (parsed.kind === "host-command") {
        void this.handleHostCommand(parsed);
        return;
      }

      void window.remoteControl.applyControlMessage(parsed).then((result) => {
        if (!result.ok && result.error) {
          this.options.onStatus(result.error);
        }
      });
    };
  }

  private async handleHostCommand(message: Extract<DataChannelMessage, { kind: "host-command" }>): Promise<void> {
    if (message.command.type === "update-stream-settings") {
      const nextFrameRate = message.command.frameRate ?? this.currentFrameRate;
      const nextAudioEnabled = typeof message.command.audioEnabled === "boolean"
        ? message.command.audioEnabled
        : this.currentAudioEnabled;
      const hasChanged = nextFrameRate !== this.currentFrameRate || nextAudioEnabled !== this.currentAudioEnabled;

      this.currentFrameRate = nextFrameRate;
      this.currentAudioEnabled = nextAudioEnabled;
      this.currentVideoBitrate = Math.min(this.currentVideoBitrate, this.getMaxVideoBitrate());

      if (hasChanged) {
        await this.startDesktopCapture();
        await this.applyVideoEncoderParams();
        this.reportStatus(
          "STREAM_SETTINGS_UPDATED",
          `Stream updated: ${this.currentFrameRate} FPS, audio ${this.currentAudioEnabled ? "on" : "off"}`,
          {
            frameRate: this.currentFrameRate,
            audioEnabled: this.currentAudioEnabled
          }
        );
      }
      return;
    }

    if (message.command.type !== "switch-source") {
      return;
    }

    if (message.command.sourceId === this.currentCaptureSourceId) {
      await this.publishHostState();
      return;
    }

    this.currentCaptureSourceId = message.command.sourceId;
    await this.startDesktopCapture();
    this.reportStatus("CAPTURE_SOURCE_UPDATED", "Capture source updated", {
      sourceId: this.currentCaptureSourceId
    });
  }

  private async publishHostState(): Promise<void> {
    if (this.options.role !== "host" || this.controlChannel?.readyState !== "open") {
      return;
    }

    const sources = await window.remoteControl.getDesktopSources();
    const message: DataChannelMessage = {
      kind: "host-state",
      activeSourceId: this.currentCaptureSourceId,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name
      }))
    };

    this.controlChannel.send(JSON.stringify(message));
  }

  private resetPeerConnection(): void {
    this.stopStatsPolling();
    this.stopReconnectTimer();
    this.controlChannel?.close();
    this.peerConnection?.close();
    this.controlChannel = undefined;
    this.peerConnection = undefined;
    this.remoteStream = undefined;
    this.videoTransceiver = undefined;
    this.audioTransceiver = undefined;
    this.pendingCandidates.length = 0;
    this.previousStatsSample = undefined;
    this.options.onRemoteStream(undefined);
  }

  private startSessionHeartbeat(): void {
    this.stopSessionHeartbeat();
    this.sendSessionHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendSessionHeartbeat();
    }, 30_000);
  }

  private stopSessionHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private sendSessionHeartbeat(): void {
    if (this.socket?.connected) {
      this.socket.emit("session:heartbeat", {
        sessionId: this.options.sessionId
      });
    }
  }

  private registerNetworkRecoveryHandlers(): void {
    if (this.removeNetworkRecoveryListeners) {
      return;
    }

    const handlePotentialResume = (): void => {
      this.scheduleNetworkRecovery();
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        this.scheduleNetworkRecovery();
      }
    };

    window.addEventListener("online", handlePotentialResume);
    window.addEventListener("focus", handlePotentialResume);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    this.removeNetworkRecoveryListeners = () => {
      window.removeEventListener("online", handlePotentialResume);
      window.removeEventListener("focus", handlePotentialResume);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }

  private unregisterNetworkRecoveryHandlers(): void {
    this.removeNetworkRecoveryListeners?.();
    this.removeNetworkRecoveryListeners = undefined;
  }

  private scheduleNetworkRecovery(): void {
    if (this.isDisconnected) {
      return;
    }

    this.stopNetworkRecoveryTimer();
    this.networkRecoveryTimer = setTimeout(() => {
      this.networkRecoveryTimer = undefined;
      void this.recoverAfterNetworkResume();
    }, 500);
  }

  private stopNetworkRecoveryTimer(): void {
    if (this.networkRecoveryTimer) {
      clearTimeout(this.networkRecoveryTimer);
      this.networkRecoveryTimer = undefined;
    }
  }

  private async recoverAfterNetworkResume(): Promise<void> {
    if (this.isDisconnected) {
      return;
    }

    if (this.socket && !this.socket.connected) {
      this.reportStatus("NETWORK_RECOVERY", "Network restored, reconnecting signaling");
      this.socket.connect();
      return;
    }

    if (!this.socket?.connected) {
      return;
    }

    this.reportStatus("NETWORK_RECOVERY", "Network restored, refreshing session");
    this.sendSessionHeartbeat();
    this.joinSession(this.lastSessionPassword);

    const connectionState = this.peerConnection?.connectionState;
    if (this.options.role === "host" && this.peerClientId && connectionState === "connected") {
      await this.createOffer(this.peerClientId, true);
      return;
    }

    if (connectionState === "failed" || connectionState === "disconnected" || connectionState === "closed") {
      this.resetPeerConnection();
    }
  }

  private scheduleReconnect(): void {
    if (this.isDisconnected || !this.peerClientId || this.reconnectTimer || this.reconnectInProgress) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.isDisconnected || !this.peerClientId || this.reconnectInProgress) {
        return;
      }

      this.reconnectInProgress = true;
      this.reportStatus("WEBRTC_RECONNECT_SCHEDULED", "Attempting WebRTC recovery");
      void this.recoverConnection()
        .catch((error) => {
          if (!this.isDisconnected) {
            const reason = error instanceof Error ? error.message : String(error);
            this.reportStatus("WEBRTC_RECONNECT_FAILED", `Reconnect failed: ${reason}`, {
              error: reason
            });
          }
        })
        .finally(() => {
          this.reconnectInProgress = false;
        });
    }, 1500);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private async recoverConnection(): Promise<void> {
    const peerClientId = this.peerClientId;
    if (this.isDisconnected || !peerClientId) {
      return;
    }

    this.resetPeerConnection();
    if (this.isDisconnected || this.peerClientId !== peerClientId) {
      return;
    }

    if (this.options.role === "host") {
      if (!this.localStream) {
        await this.startDesktopCapture();
      } else {
        const peerConnection = this.ensurePeerConnection();
        for (const track of this.localStream.getTracks()) {
          peerConnection.addTrack(track, this.localStream);
        }
      }

      if (!this.isDisconnected && this.socket?.connected) {
        await this.createOffer(peerClientId);
      }
    }
  }

  private startClipboardSync(): void {
    this.stopClipboardSync();
    this.clipboardSnapshot = getClipboardSnapshot(readClipboardDataForSync());
    const token = ++this.clipboardSyncToken;

    this.clipboardTimer = setInterval(() => {
      if (token !== this.clipboardSyncToken) {
        return;
      }

      const channel = this.controlChannel;
      if (channel?.readyState !== "open") {
        return;
      }

      const clipboardData = readClipboardDataForSync();
      const nextSnapshot = getClipboardSnapshot(clipboardData);
      if (nextSnapshot === this.clipboardSnapshot || nextSnapshot === this.remoteClipboardSnapshot) {
        this.clipboardSnapshot = nextSnapshot;
        return;
      }

      if (!hasClipboardData(clipboardData)) {
        this.clipboardSnapshot = nextSnapshot;
        return;
      }

      const message: ClipboardSyncMessage = {
        kind: "clipboard-sync",
        ...clipboardData
      };

      this.clipboardSnapshot = nextSnapshot;
      if (token === this.clipboardSyncToken && channel === this.controlChannel && channel.readyState === "open") {
        channel.send(JSON.stringify(message));
      }
    }, 800);
  }

  private stopClipboardSync(): void {
    this.clipboardSyncToken += 1;
    if (this.clipboardTimer) {
      clearInterval(this.clipboardTimer);
      this.clipboardTimer = undefined;
    }
  }

  private async applyRemoteClipboard(message: ClipboardSyncMessage): Promise<void> {
    const data = normalizeClipboardData(message);
    const nextSnapshot = getClipboardSnapshot(data);

    if (!hasClipboardData(data)) {
      this.reportStatus("CLIPBOARD_SYNC_INVALID", "Ignored empty or invalid clipboard payload");
      return;
    }

    this.remoteClipboardSnapshot = nextSnapshot;
    if (getClipboardSnapshot(readClipboardDataForSync()) !== nextSnapshot) {
      window.remoteControl.writeClipboardData(data);
    }
    this.clipboardSnapshot = nextSnapshot;
  }

  private beginIncomingFileTransfer(message: FileTransferStartMessage): void {
    const safeSize = Number.isFinite(message.size) ? Math.max(0, message.size) : 0;
    if (safeSize > maxFileTransferBytes) {
      this.reportStatus("FILE_TRANSFER_REJECTED", `File transfer rejected: ${message.name} is too large`, {
        name: message.name,
        size: safeSize
      });
      return;
    }

    if (this.incomingTransfers.has(message.transferId)) {
      this.reportStatus("FILE_TRANSFER_REJECTED", `File transfer rejected: duplicate transfer id for ${message.name}`, {
        name: message.name,
        transferId: message.transferId
      });
      return;
    }

    if (this.incomingTransfers.size >= maxIncomingTransfers) {
      this.reportStatus("FILE_TRANSFER_REJECTED", `File transfer rejected: too many active incoming files (${maxIncomingTransfers})`, {
        activeTransfers: this.incomingTransfers.size
      });
      return;
    }

    const transfer: IncomingFileTransfer = {
      checksum: createFileTransferChecksum(),
      failed: false,
      name: message.name,
      size: safeSize,
      mimeType: message.mimeType,
      nextChunkIndex: 0,
      queue: Promise.resolve(),
      receivedBytes: 0
    };
    transfer.queue = window.remoteControl
      .startIncomingFileTransfer(message.transferId, transfer.name, transfer.size)
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error ?? `Failed to start receiving ${transfer.name}`);
        }

        transfer.path = result.path;
      });
    transfer.queue.catch((error) => this.failIncomingFileTransfer(message.transferId, getErrorMessage(error)));
    this.incomingTransfers.set(message.transferId, transfer);
    this.refreshIncomingTransferTimeout(message.transferId, transfer);
    this.reportStatus("FILE_TRANSFER_RECEIVING", `Receiving file: ${message.name}`, {
      name: message.name,
      size: safeSize,
      transferId: message.transferId
    });
  }

  private appendIncomingFileChunk(message: FileTransferChunkMessage): void {
    const transfer = this.incomingTransfers.get(message.transferId);
    if (!transfer || !Number.isInteger(message.index) || message.index < 0) {
      return;
    }

    transfer.queue = transfer.queue
      .then(async () => {
        if (transfer.failed) {
          return;
        }

        if (message.index !== transfer.nextChunkIndex) {
          throw new Error("Out-of-order file chunk");
        }

        const chunk = base64ToBytes(message.data);
        if (transfer.receivedBytes + chunk.byteLength > transfer.size) {
          throw new Error("File transfer exceeded expected size");
        }

        const result = await window.remoteControl.appendIncomingFileTransfer(message.transferId, message.index, chunk);
        if (!result.ok) {
          throw new Error(result.error ?? "Failed to write file chunk");
        }

        transfer.receivedBytes += chunk.byteLength;
        transfer.checksum = updateFileTransferChecksum(transfer.checksum, chunk);
        transfer.nextChunkIndex += 1;
        this.refreshIncomingTransferTimeout(message.transferId, transfer);
      });
    transfer.queue.catch((error) => this.failIncomingFileTransfer(message.transferId, getErrorMessage(error)));
  }

  private async completeIncomingFileTransfer(message: FileTransferCompleteMessage): Promise<void> {
    const transfer = this.incomingTransfers.get(message.transferId);
    if (!transfer) {
      return;
    }

    await transfer.queue.catch(() => undefined);
    if (transfer.failed) {
      return;
    }

    this.incomingTransfers.delete(message.transferId);
    this.clearIncomingTransferTimeout(transfer);
    if (transfer.receivedBytes !== transfer.size) {
      await window.remoteControl.abortIncomingFileTransfer(message.transferId);
      this.reportStatus("FILE_TRANSFER_INCOMPLETE", `File transfer incomplete: ${transfer.name}`, {
        name: transfer.name,
        transferId: message.transferId
      });
      return;
    }

    if (message.checksum !== formatFileTransferChecksum(transfer.checksum)) {
      await window.remoteControl.abortIncomingFileTransfer(message.transferId);
      this.reportStatus("FILE_TRANSFER_FAILED", `File transfer checksum mismatch: ${transfer.name}`, {
        name: transfer.name,
        transferId: message.transferId
      });
      return;
    }

    const result = await window.remoteControl.completeIncomingFileTransfer(message.transferId);

    if (!result.ok) {
      this.reportStatus("FILE_TRANSFER_FAILED", result.error ?? `Failed to save ${transfer.name}`, {
        name: transfer.name,
        transferId: message.transferId
      });
      return;
    }

    this.options.onFileReceived?.({
      name: transfer.name,
      path: result.path
    });
    this.reportStatus("FILE_TRANSFER_SAVED", `Saved file to ${result.path}`, {
      name: transfer.name,
      transferId: message.transferId
    });
  }

  private failIncomingFileTransfer(transferId: string, reason: string): void {
    const transfer = this.incomingTransfers.get(transferId);
    if (!transfer || transfer.failed) {
      return;
    }

    transfer.failed = true;
    this.incomingTransfers.delete(transferId);
    this.clearIncomingTransferTimeout(transfer);
    void window.remoteControl.abortIncomingFileTransfer(transferId);
    this.sendFileTransferAbort(this.controlChannel, transferId, reason);
    this.reportStatus("FILE_TRANSFER_FAILED", `File transfer failed: ${transfer.name}: ${reason}`, {
      name: transfer.name,
      transferId,
      error: reason
    });
  }

  private failIncomingFileTransfers(reason: string): void {
    const transfers = [...this.incomingTransfers.entries()];
    const interruptedCount = transfers.length;
    if (interruptedCount === 0) {
      return;
    }

    this.incomingTransfers.clear();
    for (const [transferId, transfer] of transfers) {
      this.clearIncomingTransferTimeout(transfer);
      this.sendFileTransferAbort(this.controlChannel, transferId, reason);
    }
    this.reportStatus("FILE_TRANSFER_INTERRUPTED", `${reason}: ${interruptedCount} file${interruptedCount === 1 ? "" : "s"}`, {
      interruptedCount
    });
  }

  private handleFileTransferAbort(message: FileTransferAbortMessage): void {
    if (this.incomingTransfers.has(message.transferId)) {
      this.failIncomingFileTransfer(message.transferId, message.reason ?? "Transfer aborted by sender");
      return;
    }

    this.outgoingTransferAbortReasons.set(message.transferId, message.reason ?? "Transfer aborted by receiver");
    this.reportStatus("FILE_TRANSFER_FAILED", `Outgoing file transfer aborted: ${message.reason ?? "Transfer aborted by receiver"}`, {
      transferId: message.transferId
    });
  }

  private refreshIncomingTransferTimeout(transferId: string, transfer: IncomingFileTransfer): void {
    this.clearIncomingTransferTimeout(transfer);
    transfer.timeoutTimer = setTimeout(() => {
      transfer.timeoutTimer = undefined;
      this.failIncomingFileTransfer(transferId, "Timed out waiting for the next file chunk");
    }, incomingFileTransferTimeoutMs);
  }

  private clearIncomingTransferTimeout(transfer: IncomingFileTransfer): void {
    if (transfer.timeoutTimer) {
      clearTimeout(transfer.timeoutTimer);
      transfer.timeoutTimer = undefined;
    }
  }

  private throwIfOutgoingTransferAborted(transferId: string): void {
    const reason = this.outgoingTransferAbortReasons.get(transferId);
    if (reason) {
      this.outgoingTransferAbortReasons.delete(transferId);
      throw new Error(reason);
    }
  }

  private sendFileTransferAbort(channel: RTCDataChannel | undefined, transferId: string, reason: string): void {
    if (!channel || channel.readyState !== "open") {
      return;
    }

    const message: FileTransferAbortMessage = {
      kind: "file-transfer-abort",
      transferId,
      ...(sanitizeString(reason, fileTransferReasonMaxLength, false) ? { reason: sanitizeString(reason, fileTransferReasonMaxLength, false) } : {})
    };

    channel.send(JSON.stringify(message));
  }

  private reportStatus(
    code: RemoteControlDiagnosticCode,
    message: string,
    details?: Record<string, string | number | boolean | undefined>
  ): void {
    this.options.onStatus(message);
    this.options.onDiagnostic?.({
      code,
      message,
      details
    });
  }

  private getOpenControlChannel(): RTCDataChannel {
    const channel = this.controlChannel;
    if (!channel || channel.readyState !== "open") {
      throw new Error("Control channel is not ready yet");
    }

    return channel;
  }

  private sendFileTransferMessage(channel: RTCDataChannel, message: DataChannelMessage): void {
    this.ensureFileTransferChannelOpen(channel);
    channel.send(JSON.stringify(message));
  }

  private ensureFileTransferChannelOpen(channel: RTCDataChannel): void {
    if (channel !== this.controlChannel || channel.readyState !== "open") {
      throw new Error("Control channel closed during file transfer");
    }
  }

  private startStatsPolling(): void {
    this.stopStatsPolling();
    const token = ++this.statsPollingToken;
    this.statsTimer = setInterval(() => {
      void this.collectStats(token);
    }, 1000);
    void this.collectStats(token);
  }

  private stopStatsPolling(): void {
    this.statsPollingToken += 1;
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private async collectStats(token: number): Promise<void> {
    const peerConnection = this.peerConnection;
    if (token !== this.statsPollingToken || !peerConnection || peerConnection.connectionState !== "connected") {
      return;
    }

    const report = await peerConnection.getStats();
    if (token !== this.statsPollingToken || peerConnection !== this.peerConnection || peerConnection.connectionState !== "connected") {
      return;
    }

    let videoBytes = 0;
    let audioBytes = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let latencyMs: number | undefined;
    const timestamp = Date.now();

    for (const stat of report.values()) {
      if (stat.type === "candidate-pair" && "currentRoundTripTime" in stat && stat.nominated) {
        latencyMs = typeof stat.currentRoundTripTime === "number" ? Math.round(stat.currentRoundTripTime * 1000) : latencyMs;
      }

      if (this.options.role === "viewer" && stat.type === "inbound-rtp") {
        if (stat.kind === "video") {
          videoBytes += stat.bytesReceived ?? 0;
          packetsLost += stat.packetsLost ?? 0;
          packetsReceived += stat.packetsReceived ?? 0;
        }
        if (stat.kind === "audio") {
          audioBytes += stat.bytesReceived ?? 0;
        }
      }

      if (this.options.role === "host" && stat.type === "outbound-rtp") {
        if (stat.kind === "video") {
          videoBytes += stat.bytesSent ?? 0;
        }
        if (stat.kind === "audio") {
          audioBytes += stat.bytesSent ?? 0;
        }
      }

      if (this.options.role === "host" && stat.type === "remote-inbound-rtp" && stat.kind === "video") {
        packetsLost += stat.packetsLost ?? 0;
        packetsReceived += stat.packetsReceived ?? 0;
      }
    }

    const previous = this.previousStatsSample;
    this.previousStatsSample = { timestamp, videoBytes, audioBytes, packetsLost, packetsReceived };

    if (!previous) {
      return;
    }

    const elapsedSeconds = Math.max((timestamp - previous.timestamp) / 1000, 0.001);
    const videoBitrateKbps = Math.max(0, ((videoBytes - previous.videoBytes) * 8) / elapsedSeconds / 1000);
    const audioBitrateKbps = Math.max(0, ((audioBytes - previous.audioBytes) * 8) / elapsedSeconds / 1000);
    const intervalPacketsLost = Math.max(0, packetsLost - previous.packetsLost);
    const intervalPacketsReceived = Math.max(0, packetsReceived - previous.packetsReceived);
    const intervalPacketsTotal = intervalPacketsReceived + intervalPacketsLost;
    const packetLossPercent = intervalPacketsTotal > 0
      ? Math.round((intervalPacketsLost / intervalPacketsTotal) * 1000) / 10
      : 0;

    if (this.options.role === "host") {
      void this.adaptVideoBitrate(packetLossPercent, latencyMs);
    }

    this.options.onStats?.({
      latencyMs,
      videoBitrateKbps: Math.round(videoBitrateKbps),
      audioBitrateKbps: Math.round(audioBitrateKbps),
      packetsLost,
      packetLossPercent
    });
  }

  private setCodecPreferences(transceiver: RTCRtpTransceiver): void {
    const codecs = RTCRtpSender.getCapabilities?.("video")?.codecs;
    if (!codecs || !transceiver.setCodecPreferences) {
      return;
    }

    const preferred = ["VP9", "H264", "VP8"];
    const sorted = [
      ...preferred.flatMap((name) => codecs.filter((c) => c.mimeType.toUpperCase().includes(name))),
      ...codecs.filter((c) => !preferred.some((name) => c.mimeType.toUpperCase().includes(name)))
    ];

    try {
      transceiver.setCodecPreferences(sorted);
    } catch {
      // not supported in all contexts
    }
  }

  private async applyVideoEncoderParams(): Promise<void> {
    const sender = this.peerConnection?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) {
      return;
    }

    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }

    const frameRate = this.currentFrameRate;
    this.currentVideoBitrate = clamp(
      this.currentVideoBitrate,
      this.getMinVideoBitrate(),
      this.getMaxVideoBitrate()
    );

    for (const encoding of params.encodings) {
      encoding.maxBitrate = Math.round(this.currentVideoBitrate);
      encoding.maxFramerate = frameRate;
    }

    try {
      await sender.setParameters(params);
    } catch {
      // not supported in all contexts
    }
  }

  private async adaptVideoBitrate(packetLossPercent: number, latencyMs?: number): Promise<void> {
    if (this.options.role !== "host" || !Number.isFinite(packetLossPercent)) {
      return;
    }

    const now = Date.now();
    if (now - this.lastBitrateAdaptationAt < 3_000) {
      return;
    }

    const previousBitrate = this.currentVideoBitrate;
    const minBitrate = this.getMinVideoBitrate();
    const maxBitrate = this.getMaxVideoBitrate();
    const highLatency = typeof latencyMs === "number" && latencyMs > 350;
    const lowLatency = typeof latencyMs !== "number" || latencyMs < 180;
    let nextBitrate = previousBitrate;

    if (packetLossPercent > 5 || highLatency) {
      nextBitrate = previousBitrate * 0.72;
    } else if (packetLossPercent >= 2) {
      nextBitrate = previousBitrate * 0.86;
    } else if (packetLossPercent < 1 && lowLatency) {
      nextBitrate = previousBitrate * 1.08;
    }

    nextBitrate = clamp(nextBitrate, minBitrate, maxBitrate);
    if (Math.abs(nextBitrate - previousBitrate) < 150_000) {
      return;
    }

    this.currentVideoBitrate = nextBitrate;
    this.lastBitrateAdaptationAt = now;
    await this.applyVideoEncoderParams();
  }

  private getInitialVideoBitrate(): number {
    return Math.round(this.getMaxVideoBitrate() * 0.75);
  }

  private getMinVideoBitrate(): number {
    return this.options.captureMode === "game" ? 2_500_000 : 1_200_000;
  }

  private getMaxVideoBitrate(): number {
    const baselineBitrate = this.options.captureMode === "game" ? 15_000_000 : 8_000_000;
    const frameRateScale = this.currentFrameRate / 30;
    return Math.round(baselineBitrate * frameRateScale);
  }

  private async createOffer(targetClientId: string, iceRestart = false): Promise<void> {
    if (!this.socket) {
      return;
    }

    const peerConnection = this.ensurePeerConnection();
    const offer = await peerConnection.createOffer({
      iceRestart,
      offerToReceiveAudio: false,
      offerToReceiveVideo: false
    });

    await peerConnection.setLocalDescription(offer);
    this.socket.emit("signal:offer", {
      sessionId: this.options.sessionId,
      targetClientId,
      description: serializeDescription(offer)
    });
  }

  private async handleOffer(fromClientId: string, description: RtcSessionDescription): Promise<void> {
    if (!this.socket) {
      return;
    }

    this.peerClientId = fromClientId;
    const peerConnection = this.ensurePeerConnection();
    await peerConnection.setRemoteDescription(description as RTCSessionDescriptionInit);
    await this.flushPendingCandidates();

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    this.socket.emit("signal:answer", {
      sessionId: this.options.sessionId,
      targetClientId: fromClientId,
      description: serializeDescription(answer)
    });
  }

  private async handleAnswer(description: RtcSessionDescription): Promise<void> {
    const peerConnection = this.ensurePeerConnection();
    await peerConnection.setRemoteDescription(description as RTCSessionDescriptionInit);
    await this.flushPendingCandidates();
  }

  private async handleIceCandidate(candidate: RtcIceCandidate): Promise<void> {
    const rtcCandidate = candidate as RTCIceCandidateInit;
    const peerConnection = this.ensurePeerConnection();

    if (!peerConnection.remoteDescription) {
      this.pendingCandidates.push(rtcCandidate);
      return;
    }

    await peerConnection.addIceCandidate(rtcCandidate);
  }

  private async flushPendingCandidates(): Promise<void> {
    if (!this.peerConnection?.remoteDescription) {
      return;
    }

    while (this.pendingCandidates.length > 0) {
      const candidate = this.pendingCandidates.shift();
      if (candidate) {
        await this.peerConnection.addIceCandidate(candidate);
      }
    }
  }

  private ensureRemoteStream(): MediaStream {
    if (!this.remoteStream) {
      this.remoteStream = new MediaStream();
    }

    return this.remoteStream;
  }
}

function serializeDescription(description: RTCSessionDescriptionInit): RtcSessionDescription {
  return {
    type: description.type,
    sdp: description.sdp
  };
}

function serializeIceCandidate(candidate: RTCIceCandidateInit): RtcIceCandidate {
  return {
    candidate: candidate.candidate ?? "",
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment
  };
}

export function parseDataChannelMessage(value: unknown): DataChannelMessage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value.length > maxDataChannelMessageLength) {
    return undefined;
  }

  try {
    return sanitizeDataChannelMessage(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

export function sanitizeDataChannelMessage(value: unknown): DataChannelMessage | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  if (value.kind === "pointer") {
    return sanitizeControlPointerMessage(value);
  }

  if (value.kind === "keyboard") {
    return sanitizeControlKeyboardMessage(value);
  }

  if (value.kind === "host-state") {
    return sanitizeHostStateMessage(value);
  }

  if (value.kind === "host-command") {
    return sanitizeHostCommandMessage(value);
  }

  if (value.kind === "clipboard-sync") {
    return sanitizeClipboardSyncMessage(value);
  }

  if (value.kind === "file-transfer-start") {
    return sanitizeFileTransferStartMessage(value);
  }

  if (value.kind === "file-transfer-chunk") {
    return sanitizeFileTransferChunkMessage(value);
  }

  if (value.kind === "file-transfer-complete") {
    return sanitizeFileTransferCompleteMessage(value);
  }

  if (value.kind === "file-transfer-abort") {
    return sanitizeFileTransferAbortMessage(value);
  }

  return undefined;
}

function sanitizeControlPointerMessage(value: Record<string, unknown>): ControlMessage | undefined {
  if (!isRecord(value.event) || typeof value.event.type !== "string") {
    return undefined;
  }

  if (value.event.type === "move") {
    const pointer = sanitizePointerCoordinates(value.event);
    return pointer ? { kind: "pointer", event: { type: "move", ...pointer } } : undefined;
  }

  if (value.event.type === "click") {
    const pointer = sanitizePointerCoordinates(value.event);
    const button = value.event.button;
    if (!pointer || (button !== "left" && button !== "middle" && button !== "right")) {
      return undefined;
    }

    return { kind: "pointer", event: { type: "click", button, ...pointer } };
  }

  if (value.event.type === "scroll" && isFiniteNumber(value.event.deltaX) && isFiniteNumber(value.event.deltaY)) {
    return {
      kind: "pointer",
      event: {
        type: "scroll",
        deltaX: clamp(value.event.deltaX, -5000, 5000),
        deltaY: clamp(value.event.deltaY, -5000, 5000)
      }
    };
  }

  return undefined;
}

function sanitizeControlKeyboardMessage(value: Record<string, unknown>): ControlMessage | undefined {
  if (!isRecord(value.event) || typeof value.event.type !== "string") {
    return undefined;
  }

  if (value.event.type === "typeText") {
    const text = sanitizeString(value.event.text, 4096, false);
    return typeof text === "string" ? { kind: "keyboard", event: { type: "typeText", text } } : undefined;
  }

  if (value.event.type !== "keyDown" && value.event.type !== "keyUp") {
    return undefined;
  }

  const code = sanitizeString(value.event.code, 64);
  const key = sanitizeString(value.event.key, 64, false);
  if (!code || typeof key !== "string") {
    return undefined;
  }

  return {
    kind: "keyboard",
    event: {
      type: value.event.type,
      code,
      key
    }
  };
}

export function sanitizeHostStateMessage(value: Record<string, unknown>): DataChannelMessage | undefined {
  if (!Array.isArray(value.sources) || value.sources.length > maxHostSources) {
    return undefined;
  }

  const sources: HostSource[] = [];
  const sourceIds = new Set<string>();
  for (const source of value.sources) {
    if (!isRecord(source)) {
      return undefined;
    }

    const id = sanitizeString(source.id, 256);
    const name = sanitizeString(source.name, 256);
    if (!id || !name) {
      return undefined;
    }

    if (sourceIds.has(id)) {
      return undefined;
    }

    sourceIds.add(id);
    sources.push({ id, name });
  }

  const activeSourceId = sanitizeString(value.activeSourceId, 256);
  if (activeSourceId && !sourceIds.has(activeSourceId)) {
    return undefined;
  }

  return {
    kind: "host-state",
    sources,
    ...(activeSourceId ? { activeSourceId } : {})
  };
}

export function sanitizeHostCommandMessage(value: Record<string, unknown>): HostCommandMessage | undefined {
  if (!isRecord(value.command) || typeof value.command.type !== "string") {
    return undefined;
  }

  if (value.command.type === "switch-source") {
    const sourceId = sanitizeString(value.command.sourceId, 256);
    return sourceId
      ? { kind: "host-command", command: { type: "switch-source", sourceId } }
      : undefined;
  }

  if (value.command.type === "update-stream-settings") {
    const frameRate = sanitizeFrameRate(value.command.frameRate);
    const audioEnabled = typeof value.command.audioEnabled === "boolean"
      ? value.command.audioEnabled
      : undefined;
    if (typeof audioEnabled !== "boolean" && !frameRate) {
      return undefined;
    }

    return {
      kind: "host-command",
      command: {
        type: "update-stream-settings",
        ...(typeof audioEnabled === "boolean" ? { audioEnabled } : {}),
        ...(frameRate ? { frameRate } : {})
      }
    };
  }

  return undefined;
}

export function sanitizeClipboardSyncMessage(value: Record<string, unknown>): ClipboardSyncMessage | undefined {
  const text = sanitizeString(value.text, maxClipboardTextLength, false);
  const html = sanitizeString(value.html, maxClipboardTextLength, false);
  const imageDataUrl = sanitizeClipboardImageDataUrl(value.imageDataUrl);
  if (typeof text !== "string" && typeof html !== "string" && typeof imageDataUrl !== "string") {
    return undefined;
  }

  return {
    kind: "clipboard-sync",
    ...(typeof text === "string" ? { text } : {}),
    ...(typeof html === "string" ? { html } : {}),
    ...(typeof imageDataUrl === "string" ? { imageDataUrl } : {})
  };
}

export function sanitizeFileTransferStartMessage(value: Record<string, unknown>): FileTransferStartMessage | undefined {
  const transferId = sanitizeString(value.transferId, maxFileTransferIdLength);
  const name = sanitizeString(value.name, maxFileNameLength, false);
  const mimeType = sanitizeMimeType(value.mimeType) ?? "application/octet-stream";
  const size = value.size;
  if (
    !transferId
    || typeof name !== "string"
    || typeof size !== "number"
    || !Number.isInteger(size)
    || size < 0
    || size > maxFileTransferBytes
  ) {
    return undefined;
  }

  return {
    kind: "file-transfer-start",
    transferId,
    name,
    mimeType,
    size: size as number
  };
}

export function sanitizeFileTransferChunkMessage(value: Record<string, unknown>): FileTransferChunkMessage | undefined {
  const transferId = sanitizeString(value.transferId, maxFileTransferIdLength);
  const data = sanitizeBase64(value.data, maxFileTransferChunkBase64Length, maxFileTransferChunkBytes);
  const index = value.index;
  if (!transferId || typeof data !== "string" || typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return undefined;
  }

  return {
    kind: "file-transfer-chunk",
    transferId,
    index: index as number,
    data
  };
}

export function sanitizeFileTransferCompleteMessage(value: Record<string, unknown>): FileTransferCompleteMessage | undefined {
  const transferId = sanitizeString(value.transferId, maxFileTransferIdLength);
  const checksum = sanitizeChecksum(value.checksum);
  return transferId && checksum
    ? { kind: "file-transfer-complete", transferId, checksum }
    : undefined;
}

export function sanitizeFileTransferAbortMessage(value: Record<string, unknown>): FileTransferAbortMessage | undefined {
  const transferId = sanitizeString(value.transferId, maxFileTransferIdLength);
  const reason = sanitizeString(value.reason, fileTransferReasonMaxLength, false);
  return transferId
    ? {
        kind: "file-transfer-abort",
        transferId,
        ...(typeof reason === "string" ? { reason } : {})
      }
    : undefined;
}

function sanitizePointerCoordinates(value: Record<string, unknown>): {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
} | undefined {
  if (
    !isFiniteNumber(value.x)
    || !isFiniteNumber(value.y)
    || !isFiniteNumber(value.screenWidth)
    || !isFiniteNumber(value.screenHeight)
    || value.screenWidth <= 0
    || value.screenHeight <= 0
  ) {
    return undefined;
  }

  const screenWidth = Math.round(clamp(value.screenWidth, 1, 100_000));
  const screenHeight = Math.round(clamp(value.screenHeight, 1, 100_000));
  return {
    x: Math.round(clamp(value.x, 0, screenWidth)),
    y: Math.round(clamp(value.y, 0, screenHeight)),
    screenWidth,
    screenHeight
  };
}

function sanitizeFrameRate(value: unknown): FrameRate | undefined {
  return value === 15 || value === 30 || value === 60 ? value : undefined;
}

function sanitizeString(value: unknown, maxLength: number, trim = true): string | undefined {
  if (typeof value !== "string" || value.length > maxLength) {
    return undefined;
  }

  const normalized = trim ? value.trim() : value;
  return normalized.length <= maxLength ? normalized : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeMimeType(value: unknown): string | undefined {
  const mimeType = sanitizeString(value, 128, false);
  if (!mimeType) {
    return undefined;
  }

  return mimeTypePattern.test(mimeType) ? mimeType : undefined;
}

function sanitizeChecksum(value: unknown): string | undefined {
  const checksum = sanitizeString(value, 8, false);
  if (!checksum) {
    return undefined;
  }

  return checksumPattern.test(checksum) ? checksum.toLowerCase() : undefined;
}

function sanitizeClipboardImageDataUrl(value: unknown): string | undefined {
  const imageDataUrl = sanitizeString(value, maxClipboardImageDataUrlLength, false);
  if (!imageDataUrl || !imageDataUrlPrefixPattern.test(imageDataUrl)) {
    return undefined;
  }

  const commaIndex = imageDataUrl.indexOf(",");
  if (commaIndex < 0) {
    return undefined;
  }

  const base64 = imageDataUrl.slice(commaIndex + 1);
  return sanitizeBase64(base64, maxClipboardImageDataUrlLength, maxClipboardImageDataUrlLength)
    ? imageDataUrl
    : undefined;
}

function sanitizeBase64(value: unknown, maxLength: number, maxDecodedBytes: number): string | undefined {
  const normalized = sanitizeString(value, maxLength, false);
  if (!normalized || normalized.length === 0 || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+=*$/.test(normalized)) {
    return undefined;
  }

  try {
    const bytes = base64ToBytes(normalized);
    if (bytes.byteLength > maxDecodedBytes) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return normalized;
}

function createFileTransferChecksum(): number {
  return 0x811c9dc5;
}

function updateFileTransferChecksum(checksum: number, bytes: Uint8Array): number {
  let next = checksum >>> 0;
  for (const byte of bytes) {
    next ^= byte;
    next = Math.imul(next, 0x01000193) >>> 0;
  }

  return next >>> 0;
}

function formatFileTransferChecksum(checksum: number): string {
  return (checksum >>> 0).toString(16).padStart(8, "0");
}

function readClipboardDataForSync(): ClipboardData {
  const data = window.remoteControl.readClipboardData();
  return normalizeClipboardData({
    kind: "clipboard-sync",
    html: data.html,
    imageDataUrl: data.imageDataUrl && data.imageDataUrl.length <= maxClipboardImageDataUrlLength
      ? data.imageDataUrl
      : undefined,
    text: data.text
  });
}

function normalizeClipboardData(data: ClipboardSyncMessage): ClipboardData {
  return {
    html: normalizeClipboardField(data.html),
    imageDataUrl: normalizeClipboardField(data.imageDataUrl),
    text: normalizeClipboardField(data.text)
  };
}

function normalizeClipboardField(value?: string): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

function hasClipboardData(data: ClipboardData): boolean {
  return Boolean(data.text || data.html || data.imageDataUrl);
}

function getClipboardSnapshot(data: ClipboardData): string {
  return JSON.stringify({
    html: data.html ?? "",
    imageDataUrl: data.imageDataUrl ?? "",
    text: data.text ?? ""
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createTransferId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

async function waitForChannelDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState !== "open") {
    throw new Error("Control channel closed during file transfer");
  }

  if (channel.bufferedAmount < 512 * 1024) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const previousThreshold = channel.bufferedAmountLowThreshold;
    const lowThreshold = 256 * 1024;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    channel.bufferedAmountLowThreshold = lowThreshold;

    const cleanup = (): void => {
      channel.removeEventListener("bufferedamountlow", handleDrain);
      channel.removeEventListener("close", handleClose);
      channel.removeEventListener("error", handleError);
      channel.bufferedAmountLowThreshold = previousThreshold;
      clearTimeout(timeout);
    };

    const settle = (error?: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const handleDrain = (): void => {
      if (channel.readyState !== "open") {
        settle(new Error("Control channel closed during file transfer"));
        return;
      }

      if (channel.bufferedAmount <= lowThreshold) {
        settle();
      }
    };

    const handleClose = (): void => {
      settle(new Error("Control channel closed during file transfer"));
    };

    const handleError = (): void => {
      settle(new Error("Control channel failed during file transfer"));
    };

    timeout = setTimeout(() => {
      settle(
        new Error(`Timed out waiting for data channel drain (${Math.round(channel.bufferedAmount / 1024)} KiB buffered)`)
      );
    }, 30_000);

    channel.addEventListener("bufferedamountlow", handleDrain);
    channel.addEventListener("close", handleClose);
    channel.addEventListener("error", handleError);
    handleDrain();
  });
}
