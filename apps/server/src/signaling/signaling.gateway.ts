import { Inject, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import type {
  ClientToServerEvents,
  IceCandidatePayload,
  JoinSessionPayload,
  SessionHeartbeatPayload,
  SessionShutdownRequest,
  ServerToClientEvents,
  ViewerApprovalRequestPayload,
  ViewerApprovalResponsePayload,
  WebRtcDescriptionPayload
} from "@remote-control/shared";
import type { Server, Socket } from "socket.io";

import { SessionCapacityError, SessionsService } from "./sessions.service.js";
import { SlidingWindowRateLimiter, readPositiveIntegerEnv } from "./rateLimit.js";
import { SettingsService } from "../settings/settings.service.js";
import { TurnService } from "../turn/turn.service.js";

type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type SignalingServer = Server<ClientToServerEvents, ServerToClientEvents>;
const viewerApprovalTimeoutMs = 30_000;

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
    credentials: true
  },
  maxHttpBufferSize: readPositiveIntegerEnv("REMOTE_CONTROL_SOCKET_MAX_PAYLOAD_BYTES", 1_000_000),
  transports: ["websocket"]
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private readonly server!: SignalingServer;
  private stalePeerCleanupTimer?: ReturnType<typeof setInterval>;
  private readonly clientAddressById = new Map<string, string>();
  private readonly connectionCountsByAddress = new Map<string, number>();
  private readonly maxConnectionsPerAddress = readPositiveIntegerEnv("REMOTE_CONTROL_MAX_CONNECTIONS_PER_ADDRESS", 16);
  private readonly joinAttemptLimiter = new SlidingWindowRateLimiter(
    readPositiveIntegerEnv("REMOTE_CONTROL_JOIN_ATTEMPTS_PER_WINDOW", 30),
    readPositiveIntegerEnv("REMOTE_CONTROL_JOIN_ATTEMPT_WINDOW_MS", 60_000)
  );
  private readonly passwordAttemptLimiter = new SlidingWindowRateLimiter(
    readPositiveIntegerEnv("REMOTE_CONTROL_PASSWORD_ATTEMPTS_PER_WINDOW", 8),
    readPositiveIntegerEnv("REMOTE_CONTROL_PASSWORD_ATTEMPT_WINDOW_MS", 300_000)
  );
  private readonly approvalRequestLimiter = new SlidingWindowRateLimiter(
    readPositiveIntegerEnv("REMOTE_CONTROL_APPROVAL_REQUESTS_PER_WINDOW", 6),
    readPositiveIntegerEnv("REMOTE_CONTROL_APPROVAL_REQUEST_WINDOW_MS", 60_000)
  );

  constructor(
    @Inject(SessionsService)
    private readonly sessions: SessionsService,
    @Inject(SettingsService)
    private readonly settings: SettingsService,
    @Inject(TurnService)
    private readonly turn: TurnService
  ) {}

  onModuleInit(): void {
    this.stalePeerCleanupTimer = setInterval(() => {
      this.cleanupExpiredPeers();
    }, 30_000);
    this.stalePeerCleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.stalePeerCleanupTimer) {
      clearInterval(this.stalePeerCleanupTimer);
      this.stalePeerCleanupTimer = undefined;
    }
  }

  handleConnection(client: ClientSocket): void {
    const address = getClientAddress(client);
    const nextCount = (this.connectionCountsByAddress.get(address) ?? 0) + 1;
    if (nextCount > this.maxConnectionsPerAddress) {
      client.emit("error", { message: "Too many signaling connections from this address" });
      client.disconnect(true);
      return;
    }

    this.clientAddressById.set(client.id, address);
    this.connectionCountsByAddress.set(address, nextCount);
  }

  handleDisconnect(client: ClientSocket): void {
    this.releaseClientAddress(client);
    const removedPeer = this.sessions.removePeer(client.id);
    if (!removedPeer) {
      return;
    }

    this.server.to(this.roomName(removedPeer.sessionId)).emit("session:left", {
      clientId: client.id
    });
  }

  @SubscribeMessage("session:join")
  async joinSession(
    @ConnectedSocket() client: ClientSocket,
    @MessageBody() payload: JoinSessionPayload
  ): Promise<{ clientId: string } | { error: string; passwordRequired?: boolean } | undefined> {
    const joinPayload = sanitizeJoinSessionPayload(payload);
    if (!joinPayload) {
      client.emit("error", { message: "sessionId and role are required" });
      return undefined;
    }

    this.cleanupExpiredPeers();
    const clientAddress = this.getClientAddressForRateLimit(client);
    if (!this.joinAttemptLimiter.consume(clientAddress)) {
      const message = "Too many join attempts, try again later";
      client.emit("error", { message });
      return { error: message };
    }

    if (joinPayload.role === "viewer") {
      const settings = await this.settings.getHostSettings();
      const passwordAttemptKey = `${clientAddress}:${joinPayload.sessionId}`;
      if (!this.passwordAttemptLimiter.isAllowed(passwordAttemptKey)) {
        const message = "Too many password attempts, try again later";
        client.emit("error", { message });
        return {
          error: message,
          passwordRequired: true
        };
      }

      const passwordAccepted = await this.settings.verifyHostPassword(joinPayload.password);
      if (!passwordAccepted) {
        this.passwordAttemptLimiter.record(passwordAttemptKey);
        const message = joinPayload.password ? "Invalid server password" : "Server password required";
        client.emit("error", { message });
        return {
          error: message,
          passwordRequired: true
        };
      }
      this.passwordAttemptLimiter.reset(passwordAttemptKey);

      if (settings.requireViewerApproval ?? true) {
        const approvalKey = `${clientAddress}:${joinPayload.sessionId}`;
        if (!this.approvalRequestLimiter.consume(approvalKey)) {
          const message = "Too many approval requests, try again later";
          client.emit("error", { message });
          return { error: message };
        }

        const approved = await this.requestViewerApproval(client, joinPayload);
        if (!approved) {
          const message = "Connection rejected by host";
          client.emit("error", { message });
          return { error: message };
        }
      }
    }

    const previousSession = this.sessions.removePeer(client.id);
    if (previousSession) {
      await client.leave(this.roomName(previousSession.sessionId));
    }

    let existingPeers: ReturnType<SessionsService["addPeer"]>;
    try {
      existingPeers = this.sessions.addPeer(joinPayload.sessionId, {
        clientId: client.id,
        role: joinPayload.role,
        displayName: joinPayload.displayName
      });
    } catch (error) {
      const message = error instanceof SessionCapacityError
        ? error.message
        : "Could not join session";
      client.emit("error", { message });
      return { error: message };
    }

    await client.join(this.roomName(joinPayload.sessionId));

    client.emit("turn:config", this.turn.getIceConfig());

    for (const peer of existingPeers) {
      client.emit("session:joined", peer);
    }

    client.to(this.roomName(joinPayload.sessionId)).emit("session:joined", {
      clientId: client.id,
      role: joinPayload.role,
      displayName: joinPayload.displayName
    });

    return { clientId: client.id };
  }

  @SubscribeMessage("session:heartbeat")
  handleHeartbeat(@ConnectedSocket() client: ClientSocket, @MessageBody() payload: SessionHeartbeatPayload): void {
    const sessionId = sanitizeSessionId(payload?.sessionId);
    if (!sessionId || !this.sessions.touchPeer(sessionId, client.id)) {
      return;
    }
  }

  @SubscribeMessage("session:shutdown")
  announceShutdown(@ConnectedSocket() client: ClientSocket, @MessageBody() payload: SessionShutdownRequest): void {
    const shutdownPayload = sanitizeSessionShutdownRequest(payload);
    const membership = this.sessions.getPeer(client.id);
    if (!shutdownPayload || !membership || membership.sessionId !== shutdownPayload.sessionId) {
      client.emit("error", { message: "Client is not a member of this session" });
      return;
    }

    this.sessions.touchPeer(shutdownPayload.sessionId, client.id);
    if (membership.peer.role !== "host") {
      client.emit("error", { message: "Only the host can announce shutdown" });
      return;
    }

    client.to(this.roomName(shutdownPayload.sessionId)).emit("session:shutdown", {
      clientId: client.id,
      reason: shutdownPayload.reason ?? "Host is shutting down"
    });
  }

  @SubscribeMessage("signal:offer")
  relayOffer(@ConnectedSocket() client: ClientSocket, @MessageBody() payload: WebRtcDescriptionPayload): void {
    this.relayDescription(client, "signal:offer", payload);
  }

  @SubscribeMessage("signal:answer")
  relayAnswer(@ConnectedSocket() client: ClientSocket, @MessageBody() payload: WebRtcDescriptionPayload): void {
    this.relayDescription(client, "signal:answer", payload);
  }

  @SubscribeMessage("signal:ice-candidate")
  relayIceCandidate(@ConnectedSocket() client: ClientSocket, @MessageBody() payload: IceCandidatePayload): void {
    const candidatePayload = sanitizeIceCandidatePayload(payload);
    if (!candidatePayload || !this.sessions.hasPeer(candidatePayload.sessionId, client.id)) {
      client.emit("error", { message: "Client is not a member of this session" });
      return;
    }

    const eventPayload = {
      ...candidatePayload,
      fromClientId: client.id
    };

    if (candidatePayload.targetClientId) {
      this.server.to(candidatePayload.targetClientId).emit("signal:ice-candidate", eventPayload);
      return;
    }

    client.to(this.roomName(candidatePayload.sessionId)).emit("signal:ice-candidate", eventPayload);
  }

  private relayDescription(
    client: ClientSocket,
    eventName: "signal:offer" | "signal:answer",
    payload: WebRtcDescriptionPayload
  ): void {
    const descriptionPayload = sanitizeWebRtcDescriptionPayload(payload);
    if (!descriptionPayload || !this.sessions.hasPeer(descriptionPayload.sessionId, client.id)) {
      client.emit("error", { message: "Client is not a member of this session" });
      return;
    }

    const eventPayload = {
      ...descriptionPayload,
      fromClientId: client.id
    };

    if (descriptionPayload.targetClientId) {
      this.server.to(descriptionPayload.targetClientId).emit(eventName, eventPayload);
      return;
    }

    client.to(this.roomName(descriptionPayload.sessionId)).emit(eventName, eventPayload);
  }

  private async requestViewerApproval(client: ClientSocket, payload: JoinSessionPayload): Promise<boolean> {
    const hostPeer = this.sessions.getPeerByRole(payload.sessionId, "host");
    if (!hostPeer) {
      return false;
    }

    const hostSocket = this.server.sockets.sockets.get(hostPeer.clientId) as ClientSocket | undefined;
    if (!hostSocket) {
      return false;
    }

    const requestedAt = Date.now();
    const request: ViewerApprovalRequestPayload = {
      requestId: createApprovalRequestId(),
      sessionId: payload.sessionId,
      clientId: client.id,
      displayName: payload.displayName,
      requestedAt,
      expiresAt: requestedAt + viewerApprovalTimeoutMs
    };

    return await new Promise<boolean>((resolve) => {
      hostSocket.timeout(viewerApprovalTimeoutMs).emit(
        "session:approval-request",
        request,
        (error: Error | null, response?: ViewerApprovalResponsePayload) => {
          if (error) {
            resolve(false);
            return;
          }

          resolve(Boolean(response?.approved));
        }
      );
    });
  }

  private roomName(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private getClientAddressForRateLimit(client: ClientSocket): string {
    return this.clientAddressById.get(client.id) ?? getClientAddress(client);
  }

  private releaseClientAddress(client: ClientSocket): void {
    const address = this.clientAddressById.get(client.id);
    if (!address) {
      return;
    }

    this.clientAddressById.delete(client.id);
    const nextCount = (this.connectionCountsByAddress.get(address) ?? 1) - 1;
    if (nextCount <= 0) {
      this.connectionCountsByAddress.delete(address);
      return;
    }

    this.connectionCountsByAddress.set(address, nextCount);
  }

  private cleanupExpiredPeers(): void {
    for (const removedPeer of this.sessions.removeExpiredPeers()) {
      this.server.to(this.roomName(removedPeer.sessionId)).emit("session:left", {
        clientId: removedPeer.peer.clientId
      });
    }
  }
}

function sanitizeShutdownReason(reason?: string): string {
  const normalized = reason?.trim();
  return normalized ? normalized.slice(0, 160) : "Host is shutting down";
}

function createApprovalRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeJoinSessionPayload(payload: unknown): JoinSessionPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const sessionId = sanitizeSessionId(payload.sessionId);
  const role = payload.role;
  if (!sessionId || (role !== "host" && role !== "viewer")) {
    return undefined;
  }

  const displayName = sanitizeOptionalString(payload.displayName, 80);
  const password = sanitizeOptionalString(payload.password, 256);
  return {
    sessionId,
    role,
    ...(displayName ? { displayName } : {}),
    ...(typeof password === "string" ? { password } : {})
  };
}

function sanitizeSessionShutdownRequest(payload: unknown): SessionShutdownRequest | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const sessionId = sanitizeSessionId(payload.sessionId);
  if (!sessionId) {
    return undefined;
  }

  return {
    sessionId,
    reason: sanitizeShutdownReason(typeof payload.reason === "string" ? payload.reason : undefined)
  };
}

function sanitizeWebRtcDescriptionPayload(payload: unknown): WebRtcDescriptionPayload | undefined {
  if (!isRecord(payload) || !isRecord(payload.description)) {
    return undefined;
  }

  const sessionId = sanitizeSessionId(payload.sessionId);
  const targetClientId = sanitizeOptionalString(payload.targetClientId, 128);
  const descriptionType = payload.description.type;
  const sdp = sanitizeOptionalString(payload.description.sdp, 1_000_000);
  if (!sessionId || !isRtcDescriptionType(descriptionType)) {
    return undefined;
  }

  return {
    sessionId,
    ...(targetClientId ? { targetClientId } : {}),
    description: {
      type: descriptionType,
      ...(typeof sdp === "string" ? { sdp } : {})
    }
  };
}

function sanitizeIceCandidatePayload(payload: unknown): IceCandidatePayload | undefined {
  if (!isRecord(payload) || !isRecord(payload.candidate)) {
    return undefined;
  }

  const sessionId = sanitizeSessionId(payload.sessionId);
  const targetClientId = sanitizeOptionalString(payload.targetClientId, 128);
  const candidate = sanitizeOptionalString(payload.candidate.candidate, 4096);
  if (!sessionId || typeof candidate !== "string") {
    return undefined;
  }

  const sdpMid = sanitizeNullableString(payload.candidate.sdpMid, 64);
  const sdpMLineIndex = sanitizeNullableInteger(payload.candidate.sdpMLineIndex, 0, 255);
  const usernameFragment = sanitizeNullableString(payload.candidate.usernameFragment, 256);

  return {
    sessionId,
    ...(targetClientId ? { targetClientId } : {}),
    candidate: {
      candidate,
      ...(sdpMid !== undefined ? { sdpMid } : {}),
      ...(sdpMLineIndex !== undefined ? { sdpMLineIndex } : {}),
      ...(usernameFragment !== undefined ? { usernameFragment } : {})
    }
  };
}

function sanitizeSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function sanitizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : undefined;
}

function sanitizeNullableString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) {
    return null;
  }

  return sanitizeOptionalString(value, maxLength);
}

function sanitizeNullableInteger(value: unknown, min: number, max: number): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }

  return undefined;
}

function isRtcDescriptionType(value: unknown): value is "answer" | "offer" | "pranswer" | "rollback" {
  return value === "answer" || value === "offer" || value === "pranswer" || value === "rollback";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getClientAddress(client: ClientSocket): string {
  const forwardedFor = client.handshake.headers["x-forwarded-for"];
  const forwardedAddress = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (forwardedAddress) {
    return forwardedAddress.split(",")[0]?.trim() || client.handshake.address || "unknown";
  }

  return client.handshake.address || "unknown";
}
