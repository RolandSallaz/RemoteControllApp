import type {
  ClientToServerEvents,
  ClipboardSyncMessage,
  ControlMessage,
  DataChannelMessage,
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
  TurnCredentials
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

type IncomingFileTransfer = {
  name: string;
  size: number;
  mimeType: string;
  chunks: Uint8Array[];
  receivedBytes: number;
};

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
  onStats?: (stats: ConnectionStats | undefined) => void;
  onFileReceived?: (file: { name: string; path?: string }) => void;
  onLocalStream: (stream: MediaStream | undefined) => void;
  onRemoteStream: (stream: MediaStream | undefined) => void;
};

export class RemoteControlClient {
  private socket?: ClientSocket;
  private peerConnection?: RTCPeerConnection;
  private localStream?: MediaStream;
  private controlChannel?: RTCDataChannel;
  private videoTransceiver?: RTCRtpTransceiver;
  private audioTransceiver?: RTCRtpTransceiver;
  private peerClientId?: string;
  private currentCaptureSourceId?: string;
  private currentAudioEnabled = true;
  private currentFrameRate: FrameRate;
  private iceServers: TurnCredentials[] = [{ urls: ["stun:stun.l.google.com:19302"] }];
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private statsTimer?: ReturnType<typeof setInterval>;
  private clipboardTimer?: ReturnType<typeof setInterval>;
  private clipboardSnapshot = "";
  private remoteClipboardText?: string;
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
  }

  async connect(): Promise<void> {
    if (this.options.role === "host") {
      await this.startDesktopCapture();
    }

    this.options.onStatus("Connecting to signaling server");
    this.socket = io(this.options.serverUrl, {
      transports: ["websocket"],
      reconnectionAttempts: 10
    });

    this.registerSocketHandlers(this.socket);
  }

  disconnect(): void {
    this.stopReconnectTimer();
    this.stopStatsPolling();
    this.stopClipboardSync();
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
    this.peerClientId = undefined;
    this.pendingCandidates.length = 0;
    this.previousStatsSample = undefined;
    this.options.onPeer(undefined);
    this.options.onHostSources?.([], undefined);
    this.options.onStats?.(undefined);
    this.options.onLocalStream(undefined);
    this.options.onRemoteStream(undefined);
    this.options.onStatus("Disconnected");
  }

  sendControlMessage(message: ControlMessage): void {
    if (this.options.role !== "viewer") {
      return;
    }

    if (this.controlChannel?.readyState !== "open") {
      this.options.onStatus("Control channel is not ready yet");
      return;
    }

    this.controlChannel.send(JSON.stringify(message));
  }

  sendHostCommand(sourceId: string): void {
    if (this.options.role !== "viewer") {
      return;
    }

    if (this.controlChannel?.readyState !== "open") {
      this.options.onStatus("Control channel is not ready yet");
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
      this.options.onStatus("Control channel is not ready yet");
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
    if (this.controlChannel?.readyState !== "open") {
      throw new Error("Control channel is not ready yet");
    }

    const transferId = createTransferId();
    const startMessage: FileTransferStartMessage = {
      kind: "file-transfer-start",
      transferId,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size
    };

    this.controlChannel.send(JSON.stringify(startMessage));

    const chunkSize = 48 * 1024;
    let offset = 0;
    let index = 0;

    while (offset < file.size) {
      const chunk = file.slice(offset, offset + chunkSize);
      const bytes = new Uint8Array(await chunk.arrayBuffer());
      const chunkMessage: FileTransferChunkMessage = {
        kind: "file-transfer-chunk",
        transferId,
        index,
        data: bytesToBase64(bytes)
      };

      this.controlChannel.send(JSON.stringify(chunkMessage));
      offset += chunk.size;
      index += 1;
      onProgress?.(Math.min(100, Math.round((offset / file.size) * 100)));
      await waitForChannelDrain(this.controlChannel);
    }

    const completeMessage: FileTransferCompleteMessage = {
      kind: "file-transfer-complete",
      transferId
    };

    this.controlChannel.send(JSON.stringify(completeMessage));
  }

  private registerSocketHandlers(socket: ClientSocket): void {
    socket.on("connect", () => {
      this.options.onStatus(`Connected as ${this.options.role}`);
      this.joinSession();
    });

    socket.on("disconnect", () => {
      this.options.onStatus("Signaling disconnected");
      this.scheduleReconnect();
    });

    socket.on("connect_error", (error) => {
      this.options.onStatus(`Signaling error: ${error.message}`);
    });

    socket.on("error", (payload) => {
      this.options.onStatus(payload.message);
    });

    socket.on("turn:config", (payload) => {
      this.iceServers = payload.iceServers;
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
        this.options.onRemoteStream(undefined);
        this.options.onStats?.(undefined);
        this.options.onStatus("Peer left the session");
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

    this.socket.emit(
      "session:join",
      {
        sessionId: this.options.sessionId,
        role: this.options.role,
        displayName: this.options.displayName,
        password
      },
      (response) => {
        void this.handleJoinResponse(response);
      }
    );
  }

  private async handleJoinResponse(response: JoinSessionResponse): Promise<void> {
    if ("clientId" in response) {
      this.options.onStatus(`Joined session ${this.options.sessionId} as ${response.clientId}`);
      return;
    }

    if (response.passwordRequired && this.options.onPasswordRequired) {
      const password = await this.options.onPasswordRequired(response.error);
      if (typeof password === "string") {
        this.joinSession(password);
        return;
      }
    }

    this.options.onStatus(response.error);
    this.disconnect();
  }

  private async startDesktopCapture(): Promise<void> {
    if (!this.currentCaptureSourceId) {
      throw new Error("Host mode requires a selected desktop source");
    }

    this.options.onStatus("Starting desktop capture");

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
      this.options.onRemoteStream(event.streams[0]);
    };

    peerConnection.onconnectionstatechange = () => {
      this.options.onStatus(`WebRTC state: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === "connected" && this.options.role === "host") {
        void this.applyVideoEncoderParams();
      }

       if (peerConnection.connectionState === "connected") {
        this.stopReconnectTimer();
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
      this.options.onStatus("Control channel ready");
      this.startClipboardSync();
      this.options.onControlReady?.();
      if (this.options.role === "host") {
        void this.publishHostState();
      }
    };

    channel.onclose = () => {
      this.stopClipboardSync();
      this.options.onStatus("Control channel closed");
    };

    channel.onmessage = (event) => {
      const parsed = parseDataChannelMessage(event.data);
      if (!parsed) {
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

      if (hasChanged) {
        await this.startDesktopCapture();
        await this.applyVideoEncoderParams();
        this.options.onStatus(`Stream updated: ${this.currentFrameRate} FPS, audio ${this.currentAudioEnabled ? "on" : "off"}`);
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
    this.options.onStatus("Capture source updated");
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
    this.videoTransceiver = undefined;
    this.audioTransceiver = undefined;
    this.pendingCandidates.length = 0;
    this.previousStatsSample = undefined;
  }

  private scheduleReconnect(): void {
    if (!this.peerClientId || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.recoverConnection();
    }, 1500);
  }

  private stopReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private async recoverConnection(): Promise<void> {
    if (!this.peerClientId) {
      return;
    }

    this.resetPeerConnection();

    if (this.options.role === "host") {
      if (!this.localStream) {
        await this.startDesktopCapture();
      } else {
        const peerConnection = this.ensurePeerConnection();
        for (const track of this.localStream.getTracks()) {
          peerConnection.addTrack(track, this.localStream);
        }
      }

      if (this.socket?.connected) {
        await this.createOffer(this.peerClientId);
      }
    }
  }

  private startClipboardSync(): void {
    this.stopClipboardSync();
    this.clipboardSnapshot = window.remoteControl.readClipboardText();

    this.clipboardTimer = setInterval(() => {
      if (this.controlChannel?.readyState !== "open") {
        return;
      }

      const currentText = window.remoteControl.readClipboardText();
      if (currentText === this.clipboardSnapshot || currentText === this.remoteClipboardText) {
        this.clipboardSnapshot = currentText;
        return;
      }

      const message: ClipboardSyncMessage = {
        kind: "clipboard-sync",
        text: currentText
      };

      this.clipboardSnapshot = currentText;
      this.controlChannel.send(JSON.stringify(message));
    }, 800);
  }

  private stopClipboardSync(): void {
    if (this.clipboardTimer) {
      clearInterval(this.clipboardTimer);
      this.clipboardTimer = undefined;
    }
  }

  private async applyRemoteClipboard(message: ClipboardSyncMessage): Promise<void> {
    this.remoteClipboardText = message.text;
    if (window.remoteControl.readClipboardText() !== message.text) {
      window.remoteControl.writeClipboardText(message.text);
    }
    this.clipboardSnapshot = message.text;
  }

  private beginIncomingFileTransfer(message: FileTransferStartMessage): void {
    this.incomingTransfers.set(message.transferId, {
      name: message.name,
      size: message.size,
      mimeType: message.mimeType,
      chunks: [],
      receivedBytes: 0
    });
    this.options.onStatus(`Receiving file: ${message.name}`);
  }

  private appendIncomingFileChunk(message: FileTransferChunkMessage): void {
    const transfer = this.incomingTransfers.get(message.transferId);
    if (!transfer) {
      return;
    }

    const chunk = base64ToBytes(message.data);
    transfer.chunks[message.index] = chunk;
    transfer.receivedBytes += chunk.byteLength;
  }

  private async completeIncomingFileTransfer(message: FileTransferCompleteMessage): Promise<void> {
    const transfer = this.incomingTransfers.get(message.transferId);
    if (!transfer) {
      return;
    }

    this.incomingTransfers.delete(message.transferId);
    const bytes = concatBytes(transfer.chunks);
    const result = await window.remoteControl.saveIncomingFile(transfer.name, bytes);

    if (!result.ok) {
      this.options.onStatus(result.error ?? `Failed to save ${transfer.name}`);
      return;
    }

    this.options.onFileReceived?.({
      name: transfer.name,
      path: result.path
    });
    this.options.onStatus(`Saved file to ${result.path}`);
  }

  private startStatsPolling(): void {
    this.stopStatsPolling();
    this.statsTimer = setInterval(() => {
      void this.collectStats();
    }, 1000);
    void this.collectStats();
  }

  private stopStatsPolling(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = undefined;
    }
  }

  private async collectStats(): Promise<void> {
    if (!this.peerConnection || this.peerConnection.connectionState !== "connected") {
      return;
    }

    const report = await this.peerConnection.getStats();
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
    }

    const previous = this.previousStatsSample;
    this.previousStatsSample = { timestamp, videoBytes, audioBytes, packetsLost, packetsReceived };

    if (!previous) {
      return;
    }

    const elapsedSeconds = Math.max((timestamp - previous.timestamp) / 1000, 0.001);
    const videoBitrateKbps = Math.max(0, ((videoBytes - previous.videoBytes) * 8) / elapsedSeconds / 1000);
    const audioBitrateKbps = Math.max(0, ((audioBytes - previous.audioBytes) * 8) / elapsedSeconds / 1000);
    const totalPackets = packetsReceived + packetsLost;

    this.options.onStats?.({
      latencyMs,
      videoBitrateKbps: Math.round(videoBitrateKbps),
      audioBitrateKbps: Math.round(audioBitrateKbps),
      packetsLost,
      packetLossPercent: totalPackets > 0 ? Math.round((packetsLost / totalPackets) * 1000) / 10 : 0
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

    const isGame = this.options.captureMode === "game";
    const frameRate = this.currentFrameRate;

    for (const encoding of params.encodings) {
      encoding.maxBitrate = isGame ? 15_000_000 : 8_000_000;
      encoding.maxFramerate = frameRate;
    }

    try {
      await sender.setParameters(params);
    } catch {
      // not supported in all contexts
    }
  }

  private async createOffer(targetClientId: string): Promise<void> {
    if (!this.socket) {
      return;
    }

    const peerConnection = this.ensurePeerConnection();
    const offer = await peerConnection.createOffer({
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

function parseDataChannelMessage(value: unknown): DataChannelMessage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    return JSON.parse(value) as DataChannelMessage;
  } catch {
    return undefined;
  }
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

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

function createTransferId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function waitForChannelDrain(channel: RTCDataChannel): Promise<void> {
  if (channel.bufferedAmount < 512 * 1024) {
    return;
  }

  await new Promise<void>((resolve) => {
    const previousThreshold = channel.bufferedAmountLowThreshold;
    channel.bufferedAmountLowThreshold = 256 * 1024;

    const cleanup = (): void => {
      channel.onbufferedamountlow = null;
      channel.bufferedAmountLowThreshold = previousThreshold;
      resolve();
    };

    channel.onbufferedamountlow = cleanup;
    setTimeout(cleanup, 200);
  });
}
