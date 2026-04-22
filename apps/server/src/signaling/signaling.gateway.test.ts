import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { PeerJoinedPayload, ViewerApprovalResponsePayload } from "@remote-control/shared";

import type { SettingsService } from "../settings/settings.service.js";
import type { TurnService } from "../turn/turn.service.js";
import type { SessionsService } from "./sessions.service.js";
import { SessionCapacityError } from "./sessions.service.js";
import { SignalingGateway } from "./signaling.gateway.js";

type FakeClient = ReturnType<typeof createFakeClient>;
type FakeSessions = ReturnType<typeof createFakeSessions>;
type FakeServer = ReturnType<typeof createFakeServer>;

test("SignalingGateway does not expose TURN credentials before session join", () => {
  const { gateway, client } = createGatewayHarness();

  gateway.handleConnection(client as never);

  assert.equal(client.emitted.some((event) => event.event === "turn:config"), false);
  assert.equal(client.disconnected, false);
});

test("SignalingGateway limits active connections by forwarded address and releases slots on disconnect", () => {
  withEnv({ REMOTE_CONTROL_MAX_CONNECTIONS_PER_ADDRESS: "1" }, () => {
    const { gateway, client, sessions, server } = createGatewayHarness({
      clientAddress: "10.0.0.5",
      forwardedFor: "203.0.113.9, 10.0.0.5"
    });
    const secondClient = createFakeClient("client-2", "10.0.0.5", "203.0.113.9");

    gateway.handleConnection(client as never);
    gateway.handleConnection(secondClient as never);

    assert.equal(secondClient.disconnected, true);
    assert.deepEqual(secondClient.emitted[0], {
      event: "error",
      payload: { message: "Too many signaling connections from this address" }
    });

    sessions.removePeerResult = {
      sessionId: "LAN",
      peer: { clientId: "client-1", role: "host" }
    };
    gateway.handleDisconnect(client as never);

    const thirdClient = createFakeClient("client-3", "10.0.0.8", "203.0.113.9");
    gateway.handleConnection(thirdClient as never);
    assert.equal(thirdClient.disconnected, false);
    assert.deepEqual(server.roomEmits[0], {
      room: "session:LAN",
      event: "session:left",
      payload: { clientId: "client-1" }
    });
  });
});

test("joinSession rejects invalid payloads and rate-limited attempts", async () => {
  const { gateway, client } = createGatewayHarness();

  await assert.equal(await gateway.joinSession(client as never, {} as never), undefined);
  assert.deepEqual(client.emitted[0], {
    event: "error",
    payload: { message: "sessionId and role are required" }
  });

  await withEnv({ REMOTE_CONTROL_JOIN_ATTEMPTS_PER_WINDOW: "1" }, async () => {
    const limited = createGatewayHarness();
    limited.gateway.handleConnection(limited.client as never);

    const firstJoin = await limited.gateway.joinSession(limited.client as never, {
      sessionId: "LAN",
      role: "host"
    });
    const secondJoin = await limited.gateway.joinSession(limited.client as never, {
      sessionId: "LAN",
      role: "host"
    });

    assert.deepEqual(firstJoin, { clientId: "client-1" });
    assert.deepEqual(secondJoin, { error: "Too many join attempts, try again later" });
  });
});

test("joinSession handles host join, previous sessions, existing peers and capacity errors", async () => {
  const existingPeers: PeerJoinedPayload[] = [{ clientId: "viewer-9", role: "viewer", displayName: "Viewer 9" }];
  const { gateway, client, sessions } = createGatewayHarness({
    existingPeers
  });
  gateway.handleConnection(client as never);

  sessions.removePeerResult = {
    sessionId: "OLD",
    peer: { clientId: "client-1", role: "host" }
  };

  const result = await gateway.joinSession(client as never, {
    sessionId: "LAN",
    role: "host",
    displayName: "Host"
  });

  assert.deepEqual(result, { clientId: "client-1" });
  assert.deepEqual(client.leftRooms, ["session:OLD"]);
  assert.deepEqual(client.joinedRooms, ["session:LAN"]);
  assert.deepEqual(client.emitted.slice(-2), [
    {
      event: "turn:config",
      payload: { iceServers: [{ urls: ["turn:secret.example"] }] }
    },
    {
      event: "session:joined",
      payload: { clientId: "viewer-9", role: "viewer", displayName: "Viewer 9" }
    }
  ]);

  const capacity = createGatewayHarness({
    addPeerError: new SessionCapacityError("Peer limit reached")
  });
  capacity.gateway.handleConnection(capacity.client as never);

  const failed = await capacity.gateway.joinSession(capacity.client as never, {
    sessionId: "LAN",
    role: "host"
  });

  assert.deepEqual(failed, { error: "Peer limit reached" });
});

test("viewer join enforces password and approval flows", async () => {
  const missingPassword = createGatewayHarness({
    hostSettings: { requireViewerApproval: false },
    verifyPasswordResult: false
  });
  missingPassword.gateway.handleConnection(missingPassword.client as never);

  const missingPasswordResult = await missingPassword.gateway.joinSession(missingPassword.client as never, {
    sessionId: "LAN",
    role: "viewer"
  });

  assert.deepEqual(missingPasswordResult, {
    error: "Server password required",
    passwordRequired: true
  });

  await withEnv({ REMOTE_CONTROL_PASSWORD_ATTEMPTS_PER_WINDOW: "1" }, async () => {
    const limitedPassword = createGatewayHarness({
      hostSettings: { requireViewerApproval: false },
      verifyPasswordResult: false
    });
    limitedPassword.gateway.handleConnection(limitedPassword.client as never);

    await limitedPassword.gateway.joinSession(limitedPassword.client as never, {
      sessionId: "LAN",
      role: "viewer",
      password: "wrong"
    });
    const blocked = await limitedPassword.gateway.joinSession(limitedPassword.client as never, {
      sessionId: "LAN",
      role: "viewer",
      password: "wrong"
    });

    assert.deepEqual(blocked, {
      error: "Too many password attempts, try again later",
      passwordRequired: true
    });
  });

  const rejected = createGatewayHarness({
    hostSettings: { requireViewerApproval: true },
    verifyPasswordResult: true,
    hostApprovalResponse: { approved: false }
  });
  rejected.gateway.handleConnection(rejected.client as never);
  rejected.server.sockets.sockets.set("host-1", rejected.hostSocket as never);

  const rejectedResult = await rejected.gateway.joinSession(rejected.client as never, {
    sessionId: "LAN",
    role: "viewer",
    displayName: "Viewer",
    password: "secret"
  });

  assert.deepEqual(rejectedResult, { error: "Connection rejected by host" });

  const approved = createGatewayHarness({
    hostSettings: { requireViewerApproval: true },
    verifyPasswordResult: true,
    hostApprovalResponse: { approved: true }
  });
  approved.gateway.handleConnection(approved.client as never);
  approved.server.sockets.sockets.set("host-1", approved.hostSocket as never);

  const approvedResult = await approved.gateway.joinSession(approved.client as never, {
    sessionId: "LAN",
    role: "viewer",
    displayName: "Viewer"
  });

  assert.deepEqual(approvedResult, { clientId: "client-1" });
  assert.equal(approved.hostSocket.timeoutValue, 30_000);
  assert.equal(approved.hostSocket.timeoutEmitCalls[0]?.event, "session:approval-request");
});

test("viewer join handles missing host or approval rate limits", async () => {
  const noHost = createGatewayHarness({
    hostSettings: { requireViewerApproval: true },
    verifyPasswordResult: true,
    hostPeer: undefined
  });
  noHost.gateway.handleConnection(noHost.client as never);
  const noHostResult = await noHost.gateway.joinSession(noHost.client as never, {
    sessionId: "LAN",
    role: "viewer"
  });
  assert.deepEqual(noHostResult, { error: "Connection rejected by host" });

  await withEnv({ REMOTE_CONTROL_APPROVAL_REQUESTS_PER_WINDOW: "1" }, async () => {
    const limitedApproval = createGatewayHarness({
      hostSettings: { requireViewerApproval: true },
      verifyPasswordResult: true,
      hostApprovalResponse: { approved: false }
    });
    limitedApproval.gateway.handleConnection(limitedApproval.client as never);
    limitedApproval.server.sockets.sockets.set("host-1", limitedApproval.hostSocket as never);

    await limitedApproval.gateway.joinSession(limitedApproval.client as never, {
      sessionId: "LAN",
      role: "viewer"
    });

    const secondClient = createFakeClient("client-2", "10.0.0.5");
    limitedApproval.gateway.handleConnection(secondClient as never);
    const blocked = await limitedApproval.gateway.joinSession(secondClient as never, {
      sessionId: "LAN",
      role: "viewer"
    });

    assert.deepEqual(blocked, { error: "Too many approval requests, try again later" });
  });
});

test("viewer join reuses a recent approval without prompting the host again", async () => {
  const approved = createGatewayHarness({
    hostSettings: { requireViewerApproval: true },
    verifyPasswordResult: true,
    hostApprovalResponse: { approved: true }
  });
  approved.gateway.handleConnection(approved.client as never);
  approved.server.sockets.sockets.set("host-1", approved.hostSocket as never);

  const firstJoin = await approved.gateway.joinSession(approved.client as never, {
    sessionId: "LAN",
    role: "viewer",
    displayName: "Viewer"
  });
  const approvalCallsAfterFirstJoin = approved.hostSocket.timeoutEmitCalls.length;

  const secondJoin = await approved.gateway.joinSession(approved.client as never, {
    sessionId: "LAN",
    role: "viewer",
    displayName: "Viewer"
  });

  assert.deepEqual(firstJoin, { clientId: "client-1" });
  assert.deepEqual(secondJoin, { clientId: "client-1" });
  assert.equal(approvalCallsAfterFirstJoin, 1);
  assert.equal(approved.hostSocket.timeoutEmitCalls.length, 1);
});

test("heartbeat and shutdown validate membership and role", () => {
  const { gateway, client, sessions, server } = createGatewayHarness();

  gateway.handleHeartbeat(client as never, { sessionId: "LAN" });
  assert.deepEqual(sessions.touched, [["LAN", "client-1"]]);

  sessions.touchPeerResult = false;
  gateway.handleHeartbeat(client as never, { sessionId: "LAN" });
  assert.equal(client.emitted.length, 0);

  gateway.announceShutdown(client as never, { sessionId: "LAN" });
  assert.deepEqual(client.emitted[0], {
    event: "error",
    payload: { message: "Client is not a member of this session" }
  });

  sessions.getPeerResult = {
    sessionId: "LAN",
    peer: { clientId: "client-1", role: "viewer" }
  };
  gateway.announceShutdown(client as never, { sessionId: "LAN", reason: "bye" });
  assert.deepEqual(client.emitted[1], {
    event: "error",
    payload: { message: "Only the host can announce shutdown" }
  });

  sessions.getPeerResult = {
    sessionId: "LAN",
    peer: { clientId: "client-1", role: "host" }
  };
  gateway.announceShutdown(client as never, { sessionId: "LAN", reason: "  restarting  " });
  assert.deepEqual(client.broadcastEmits.at(-1), {
    room: "session:LAN",
    event: "session:shutdown",
    payload: {
      clientId: "client-1",
      reason: "restarting"
    }
  });
});

test("relayOffer relayAnswer and relayIceCandidate validate membership and route payloads", () => {
  const { gateway, client, sessions, server } = createGatewayHarness();

  gateway.relayOffer(client as never, { sessionId: "LAN" } as never);
  gateway.relayIceCandidate(client as never, { sessionId: "LAN" } as never);
  assert.equal(client.emitted.length, 2);
  assert.deepEqual(client.emitted[0], {
    event: "error",
    payload: { message: "Client is not a member of this session" }
  });

  sessions.hasPeerResult = true;
  gateway.relayOffer(client as never, {
    sessionId: "LAN",
    description: { type: "offer", sdp: "offer-sdp" }
  });
  gateway.relayAnswer(client as never, {
    sessionId: "LAN",
    targetClientId: "viewer-2",
    description: { type: "answer", sdp: "answer-sdp" }
  });
  gateway.relayIceCandidate(client as never, {
    sessionId: "LAN",
    targetClientId: "viewer-2",
    candidate: {
      candidate: "candidate:1",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "user"
    }
  });

  assert.deepEqual(client.broadcastEmits[0], {
    room: "session:LAN",
    event: "signal:offer",
    payload: {
      sessionId: "LAN",
      description: { type: "offer", sdp: "offer-sdp" },
      fromClientId: "client-1"
    }
  });
  assert.deepEqual(server.directEmits[0], {
    room: "viewer-2",
    event: "signal:answer",
    payload: {
      sessionId: "LAN",
      targetClientId: "viewer-2",
      description: { type: "answer", sdp: "answer-sdp" },
      fromClientId: "client-1"
    }
  });
  assert.deepEqual(server.directEmits[1], {
    room: "viewer-2",
    event: "signal:ice-candidate",
    payload: {
      sessionId: "LAN",
      targetClientId: "viewer-2",
      candidate: {
        candidate: "candidate:1",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "user"
      },
      fromClientId: "client-1"
    }
  });
});

test("relayOffer preserves SDP formatting without trimming", () => {
  const { gateway, client, sessions, server } = createGatewayHarness();
  sessions.hasPeerResult = true;

  const sdp = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=max-message-size:262144\r\n";
  gateway.relayOffer(client as never, {
    sessionId: "LAN",
    description: { type: "offer", sdp }
  });

  assert.deepEqual(client.broadcastEmits[0], {
    room: "session:LAN",
    event: "signal:offer",
    payload: {
      sessionId: "LAN",
      description: { type: "offer", sdp },
      fromClientId: "client-1"
    }
  });
  assert.equal(server.directEmits.length, 0);
});

test("module lifecycle and cleanupExpiredPeers clear timers and emit session:left for stale peers", () => {
  const { gateway, sessions, server } = createGatewayHarness();
  gateway.onModuleInit();
  assert.ok((gateway as any).stalePeerCleanupTimer);

  sessions.removeExpiredPeersResult = [
    {
      sessionId: "LAN",
      peer: { clientId: "stale-1", role: "viewer" }
    }
  ];

  (gateway as any).cleanupExpiredPeers();
  assert.deepEqual(server.roomEmits[0], {
    room: "session:LAN",
    event: "session:left",
    payload: { clientId: "stale-1" }
  });

  gateway.onModuleDestroy();
  assert.equal((gateway as any).stalePeerCleanupTimer, undefined);
});

function createGatewayHarness(options?: {
  addPeerError?: Error;
  clientAddress?: string;
  existingPeers?: PeerJoinedPayload[];
  forwardedFor?: string;
  hostApprovalResponse?: ViewerApprovalResponsePayload;
  hostPeer?: { clientId: string; role: "host"; displayName?: string } | undefined;
  hostSettings?: { requireViewerApproval?: boolean };
  verifyPasswordResult?: boolean;
}) {
  const sessions = createFakeSessions(options);
  const server = createFakeServer();
  const settings: SettingsService = {
    getHostSettings: async () => options?.hostSettings ?? { requireViewerApproval: false },
    verifyHostPassword: async () => options?.verifyPasswordResult ?? true
  } as unknown as SettingsService;
  const turn: TurnService = {
    getIceConfig: () => ({ iceServers: [{ urls: ["turn:secret.example"] }] })
  } as unknown as TurnService;

  const gateway = new SignalingGateway(
    sessions as unknown as SessionsService,
    settings,
    turn
  );
  (gateway as any).server = server;

  const client = createFakeClient("client-1", options?.clientAddress ?? "10.0.0.5", options?.forwardedFor);
  const hostSocket = createFakeTimeoutSocket(options?.hostApprovalResponse ?? { approved: true });

  if (options?.hostPeer !== undefined) {
    sessions.getPeerByRoleResult = options.hostPeer;
  }

  return { gateway, client, hostSocket, server, sessions };
}

function createFakeSessions(options?: {
  addPeerError?: Error;
  existingPeers?: PeerJoinedPayload[];
}) {
  return {
    addPeerCalls: [] as Array<{ sessionId: string; peer: { clientId: string; role: string; displayName?: string } }>,
    addPeerError: options?.addPeerError,
    getPeerByRoleResult: { clientId: "host-1", role: "host" as const, displayName: "Host" },
    getPeerResult: undefined as undefined | { sessionId: string; peer: { clientId: string; role: "host" | "viewer" } },
    hasPeerResult: false,
    removeExpiredPeersResult: [] as Array<{ sessionId: string; peer: { clientId: string; role: "host" | "viewer" } }>,
    removePeerResult: undefined as undefined | { sessionId: string; peer: { clientId: string; role: "host" | "viewer" } },
    touched: [] as Array<[string, string]>,
    touchPeerResult: true,
    addPeer(sessionId: string, peer: { clientId: string; role: string; displayName?: string }) {
      this.addPeerCalls.push({ sessionId, peer });
      if (this.addPeerError) {
        throw this.addPeerError;
      }
      return options?.existingPeers ?? [];
    },
    getPeer(clientId: string) {
      return this.getPeerResult?.peer.clientId === clientId ? this.getPeerResult : undefined;
    },
    getPeerByRole(_sessionId: string, _role: string) {
      return this.getPeerByRoleResult;
    },
    hasPeer(_sessionId: string, _clientId: string) {
      return this.hasPeerResult;
    },
    removeExpiredPeers() {
      return this.removeExpiredPeersResult;
    },
    removePeer(_clientId: string) {
      return this.removePeerResult;
    },
    touchPeer(sessionId: string, clientId: string) {
      this.touched.push([sessionId, clientId]);
      return this.touchPeerResult;
    }
  };
}

function createFakeServer() {
  return {
    broadcastEmits: [] as Array<{ room: string; event: string; payload: unknown }>,
    directEmits: [] as Array<{ room: string; event: string; payload: unknown }>,
    roomEmits: [] as Array<{ room: string; event: string; payload: unknown }>,
    sockets: {
      sockets: new Map<string, unknown>()
    },
    to(room: string) {
      return {
        emit: (event: string, payload: unknown) => {
          const target = room.startsWith("session:") ? this.roomEmits : this.directEmits;
          target.push({ room, event, payload });
        }
      };
    }
  };
}

function createFakeClient(id: string, address: string, forwardedFor?: string) {
  return {
    disconnected: false,
    emitted: [] as Array<{ event: string; payload: unknown }>,
    handshake: {
      address,
      headers: {
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {})
      } as Record<string, string | string[] | undefined>
    },
    id,
    joinedRooms: [] as string[],
    leftRooms: [] as string[],
    broadcastEmits: [] as Array<{ room: string; event: string; payload: unknown }>,
    disconnect() {
      this.disconnected = true;
    },
    emit(event: string, payload: unknown) {
      this.emitted.push({ event, payload });
    },
    async join(room: string) {
      this.joinedRooms.push(room);
    },
    async leave(room: string) {
      this.leftRooms.push(room);
    },
    to(room: string) {
      return {
        emit: (event: string, payload: unknown) => {
          this.broadcastEmits.push({ room, event, payload });
        }
      };
    }
  };
}

function createFakeTimeoutSocket(response: ViewerApprovalResponsePayload) {
  return {
    timeoutValue: 0,
    timeoutEmitCalls: [] as Array<{ event: string; payload: unknown }>,
    timeout(ms: number) {
      this.timeoutValue = ms;
      return {
        emit: (
          event: string,
          payload: unknown,
          ack: (error: Error | null, response?: ViewerApprovalResponsePayload) => void
        ) => {
          this.timeoutEmitCalls.push({ event, payload });
          ack(null, response);
        }
      };
    }
  };
}

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
