import type {
  ClientToServerEvents,
  ControlMessage,
  DataChannelMessage,
  HostSource,
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
  onLocalStream: (stream: MediaStream | undefined) => void;
  onRemoteStream: (stream: MediaStream | undefined) => void;
};

export class RemoteControlClient {
  private socket?: ClientSocket;
  private peerConnection?: RTCPeerConnection;
  private localStream?: MediaStream;
  private controlChannel?: RTCDataChannel;
  private videoTransceiver?: RTCRtpTransceiver;
  private peerClientId?: string;
  private currentCaptureSourceId?: string;
  private iceServers: TurnCredentials[] = [{ urls: ["stun:stun.l.google.com:19302"] }];
  private readonly pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(private readonly options: RemoteControlClientOptions) {
    this.currentCaptureSourceId = options.captureSourceId;
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
    this.controlChannel?.close();
    this.peerConnection?.close();
    this.socket?.disconnect();
    this.localStream?.getTracks().forEach((track) => track.stop());

    this.controlChannel = undefined;
    this.peerConnection = undefined;
    this.socket = undefined;
    this.localStream = undefined;
    this.peerClientId = undefined;
    this.pendingCandidates.length = 0;
    this.options.onPeer(undefined);
    this.options.onHostSources?.([], undefined);
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

  private registerSocketHandlers(socket: ClientSocket): void {
    socket.on("connect", () => {
      this.options.onStatus(`Connected as ${this.options.role}`);
      socket.emit(
        "session:join",
        {
          sessionId: this.options.sessionId,
          role: this.options.role,
          displayName: this.options.displayName
        },
        (response) => {
          this.options.onStatus(`Joined session ${this.options.sessionId} as ${response.clientId}`);
        }
      );
    });

    socket.on("disconnect", () => {
      this.options.onStatus("Signaling disconnected");
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
        this.options.onPeer(undefined);
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

  private async startDesktopCapture(): Promise<void> {
    if (!this.currentCaptureSourceId) {
      throw new Error("Host mode requires a selected desktop source");
    }

    this.options.onStatus("Starting desktop capture");

    const frameRate = this.options.frameRate ?? 30;
    const constraints = {
      audio: false,
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
      if (this.options.role === "host") {
        void this.publishHostState();
      }
    };

    channel.onclose = () => {
      this.options.onStatus("Control channel closed");
    };

    channel.onmessage = (event) => {
      if (this.options.role !== "host") {
        const parsed = parseDataChannelMessage(event.data);
        if (parsed?.kind === "host-state") {
          this.options.onHostSources?.(parsed.sources, parsed.activeSourceId);
        }
        return;
      }

      const parsed = parseDataChannelMessage(event.data);
      if (!parsed) {
        return;
      }

      if (parsed.kind === "host-command") {
        void this.handleHostCommand(parsed);
        return;
      }

      if (parsed.kind === "host-state") {
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
    const frameRate = this.options.frameRate ?? 30;

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
