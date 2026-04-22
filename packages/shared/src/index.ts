export type PeerRole = "host" | "viewer";

export type SessionId = string;

export type ClientId = string;

export type JoinSessionPayload = {
  sessionId: SessionId;
  role: PeerRole;
  displayName?: string;
};

export type PeerJoinedPayload = {
  clientId: ClientId;
  role: PeerRole;
  displayName?: string;
};

export type PeerLeftPayload = {
  clientId: ClientId;
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

export const REMOTE_CONTROL_DISCOVERY_PORT = 38761;
export const REMOTE_CONTROL_DISCOVERY_REQUEST = "remote-control.discovery.request";
export const REMOTE_CONTROL_DISCOVERY_RESPONSE = "remote-control.discovery.response";

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

export type ControlPointerEvent =
  | {
      type: "move";
      x: number;
      y: number;
      screenWidth: number;
      screenHeight: number;
    }
  | {
      type: "click";
      button: "left" | "middle" | "right";
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
  id: string;
  name: string;
};

export type HostStateMessage = {
  kind: "host-state";
  activeSourceId?: string;
  sources: HostSource[];
};

export type HostCommandMessage = {
  kind: "host-command";
  command: {
    type: "switch-source";
    sourceId: string;
  };
};

export type DataChannelMessage = ControlMessage | HostStateMessage | HostCommandMessage;

export type ServerToClientEvents = {
  "session:joined": (payload: PeerJoinedPayload) => void;
  "session:left": (payload: PeerLeftPayload) => void;
  "signal:offer": (payload: WebRtcDescriptionPayload & { fromClientId: ClientId }) => void;
  "signal:answer": (payload: WebRtcDescriptionPayload & { fromClientId: ClientId }) => void;
  "signal:ice-candidate": (payload: IceCandidatePayload & { fromClientId: ClientId }) => void;
  "turn:config": (payload: TurnConfigPayload) => void;
  error: (payload: { message: string }) => void;
};

export type ClientToServerEvents = {
  "session:join": (payload: JoinSessionPayload, ack?: (response: { clientId: ClientId }) => void) => void;
  "signal:offer": (payload: WebRtcDescriptionPayload) => void;
  "signal:answer": (payload: WebRtcDescriptionPayload) => void;
  "signal:ice-candidate": (payload: IceCandidatePayload) => void;
};
