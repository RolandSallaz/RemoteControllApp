export type PeerRole = "host" | "viewer";

export type SessionId = string;

export type ClientId = string;

export type JoinSessionPayload = {
  sessionId: SessionId;
  role: PeerRole;
  displayName?: string;
  password?: string;
};

export type JoinSessionResponse =
  | {
      clientId: ClientId;
    }
  | {
      error: string;
      passwordRequired?: boolean;
    };

export type ViewerApprovalRequestPayload = {
  requestId: string;
  sessionId: SessionId;
  clientId: ClientId;
  displayName?: string;
  requestedAt: number;
  expiresAt: number;
};

export type ViewerApprovalResponsePayload = {
  approved: boolean;
  reason?: string;
};

export type ViewerShortcutSettings = {
  disconnectShortcut: string;
  switchMonitorShortcut: string;
};

export type PeerJoinedPayload = {
  clientId: ClientId;
  role: PeerRole;
  displayName?: string;
};

export type PeerLeftPayload = {
  clientId: ClientId;
};

export type SessionHeartbeatPayload = {
  sessionId: SessionId;
};

export type SessionShutdownRequest = {
  sessionId: SessionId;
  reason?: string;
};

export type SessionShutdownPayload = {
  clientId: ClientId;
  reason: string;
};

export type SignalTargetPayload = {
  sessionId: SessionId;
  targetClientId?: ClientId;
};

export type RtcSessionDescription = {
  type: "answer" | "offer" | "pranswer" | "rollback";
  sdp?: string;
};

export type RtcIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type WebRtcDescriptionPayload = SignalTargetPayload & {
  description: RtcSessionDescription;
};

export type IceCandidatePayload = SignalTargetPayload & {
  candidate: RtcIceCandidate;
};

export type TurnCredentials = {
  urls: string[];
  username?: string;
  credential?: string;
};

export type TurnConfigPayload = {
  iceServers: TurnCredentials[];
};

export type HostSettings = {
  /**
   * Deprecated legacy plaintext field. New writes store accessPasswordHash.
   */
  accessPassword?: string;
  accessPasswordHash?: string;
  accessPasswordSet?: boolean;
  launchOnStartup?: boolean;
  requireViewerApproval?: boolean;
  saveDirectory?: string;
};

export type UpdateHostSettingsPayload = Partial<HostSettings>;

export const REMOTE_CONTROL_DISCOVERY_PORT = 38761;
export const REMOTE_CONTROL_DISCOVERY_REQUEST = "remote-control.discovery.request";
export const REMOTE_CONTROL_DISCOVERY_RESPONSE = "remote-control.discovery.response";

export type DiscoveryNetworkInterface = {
  address: string;
  family: string | number;
  internal: boolean;
  netmask?: string | null;
};

export type DiscoveryNetworkInterfaces = Record<string, DiscoveryNetworkInterface[] | undefined>;

export type DiscoveryRequest = {
  type: typeof REMOTE_CONTROL_DISCOVERY_REQUEST;
  version: 1;
};

export type DiscoveredServer = {
  id: string;
  name: string;
  address: string;
  port: number;
  url: string;
  lastSeen: number;
};

export type DiscoveryResponse = {
  type: typeof REMOTE_CONTROL_DISCOVERY_RESPONSE;
  version: 1;
  id: string;
  name: string;
  port: number;
  url?: string;
};

export function getDiscoveryBroadcastAddresses(interfaces: DiscoveryNetworkInterfaces): string[] {
  const addresses = new Set<string>(["127.0.0.1", "255.255.255.255"]);

  for (const networkInterface of Object.values(interfaces)) {
    for (const entry of networkInterface ?? []) {
      if (!isDiscoveryIpv4Interface(entry)) {
        continue;
      }

      addresses.add(toDiscoveryBroadcastAddress(entry.address, entry.netmask));
    }
  }

  return [...addresses];
}

export function toDiscoveryBroadcastAddress(address: string, netmask: string): string {
  const addressParts = parseIpv4Address(address);
  const maskParts = parseIpv4Address(netmask);

  if (!addressParts || !maskParts) {
    return "255.255.255.255";
  }

  return addressParts.map((part, index) => (part | (~maskParts[index] & 255)) & 255).join(".");
}

function isDiscoveryIpv4Interface(entry: DiscoveryNetworkInterface): entry is DiscoveryNetworkInterface & { netmask: string } {
  return isIpv4Family(entry.family) && !entry.internal && Boolean(entry.netmask) && Boolean(parseIpv4Address(entry.address));
}

function isIpv4Family(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function parseIpv4Address(value: string): number[] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return undefined;
  }

  const parsed = parts.map((part) => Number(part));
  return parsed.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parsed : undefined;
}

export type ControlPointerEvent =
  | {
      type: "move";
      sourceId?: string;
      x: number;
      y: number;
      screenWidth: number;
      screenHeight: number;
    }
  | {
      type: "click";
      button: "left" | "middle" | "right";
      sourceId?: string;
      x: number;
      y: number;
      screenWidth: number;
      screenHeight: number;
    }
  | {
      type: "scroll";
      deltaX: number;
      deltaY: number;
    };

export type ControlKeyboardEvent =
  | {
      type: "keyDown" | "keyUp";
      code: string;
      key: string;
    }
  | {
      type: "typeText";
      text: string;
    };

export type ControlMessage =
  | {
      kind: "pointer";
      event: ControlPointerEvent;
    }
  | {
      kind: "keyboard";
      event: ControlKeyboardEvent;
    };

export type HostSource = {
  displayId?: string;
  id: string;
  name: string;
};

export type StreamFrameRate = 15 | 30 | 60;

export type HostStateMessage = {
  kind: "host-state";
  activeSourceId?: string;
  sources: HostSource[];
};

export type HostCommandMessage = {
  kind: "host-command";
  command:
    | {
        type: "switch-source";
        sourceId: string;
      }
    | {
        type: "update-stream-settings";
        audioEnabled?: boolean;
        frameRate?: StreamFrameRate;
      };
};

export type ClipboardSyncMessage = {
  kind: "clipboard-sync";
  text?: string;
  html?: string;
  imageDataUrl?: string;
};

export type FileTransferStartMessage = {
  kind: "file-transfer-start";
  transferId: string;
  name: string;
  mimeType: string;
  size: number;
};

export type FileTransferChunkMessage = {
  kind: "file-transfer-chunk";
  transferId: string;
  index: number;
  data: string;
};

export type FileTransferCompleteMessage = {
  kind: "file-transfer-complete";
  transferId: string;
  checksum: string;
};

export type FileTransferAbortMessage = {
  kind: "file-transfer-abort";
  transferId: string;
  reason?: string;
};

export type DataChannelMessage =
  | ControlMessage
  | HostStateMessage
  | HostCommandMessage
  | ClipboardSyncMessage
  | FileTransferStartMessage
  | FileTransferChunkMessage
  | FileTransferCompleteMessage
  | FileTransferAbortMessage;

export type ServerToClientEvents = {
  "session:approval-request": (
    payload: ViewerApprovalRequestPayload,
    ack: (response: ViewerApprovalResponsePayload) => void
  ) => void;
  "session:joined": (payload: PeerJoinedPayload) => void;
  "session:left": (payload: PeerLeftPayload) => void;
  "session:shutdown": (payload: SessionShutdownPayload) => void;
  "signal:offer": (payload: WebRtcDescriptionPayload & { fromClientId: ClientId }) => void;
  "signal:answer": (payload: WebRtcDescriptionPayload & { fromClientId: ClientId }) => void;
  "signal:ice-candidate": (payload: IceCandidatePayload & { fromClientId: ClientId }) => void;
  "turn:config": (payload: TurnConfigPayload) => void;
  error: (payload: { message: string }) => void;
};

export type ClientToServerEvents = {
  "session:join": (payload: JoinSessionPayload, ack?: (response: JoinSessionResponse) => void) => void;
  "session:heartbeat": (payload: SessionHeartbeatPayload) => void;
  "session:shutdown": (payload: SessionShutdownRequest) => void;
  "signal:offer": (payload: WebRtcDescriptionPayload) => void;
  "signal:answer": (payload: WebRtcDescriptionPayload) => void;
  "signal:ice-candidate": (payload: IceCandidatePayload) => void;
};
