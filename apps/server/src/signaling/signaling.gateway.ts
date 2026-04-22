import { Inject } from "@nestjs/common";
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
  ServerToClientEvents,
  WebRtcDescriptionPayload
} from "@remote-control/shared";
import type { Server, Socket } from "socket.io";

import { SessionsService } from "./sessions.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { TurnService } from "../turn/turn.service.js";

type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type SignalingServer = Server<ClientToServerEvents, ServerToClientEvents>;

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
    credentials: true
  },
  transports: ["websocket"]
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: SignalingServer;

  constructor(
    @Inject(SessionsService)
    private readonly sessions: SessionsService,
    @Inject(SettingsService)
    private readonly settings: SettingsService,
    @Inject(TurnService)
    private readonly turn: TurnService
  ) {}

  handleConnection(client: ClientSocket): void {
    client.emit("turn:config", this.turn.getIceConfig());
  }

  handleDisconnect(client: ClientSocket): void {
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
    if (!payload.sessionId || !payload.role) {
      client.emit("error", { message: "sessionId and role are required" });
      return undefined;
    }

    if (payload.role === "viewer") {
      const settings = await this.settings.getHostSettings();
      const accessPassword = settings.accessPassword?.trim();
      if (accessPassword && payload.password !== accessPassword) {
        const message = payload.password ? "Invalid server password" : "Server password required";
        client.emit("error", { message });
        return {
          error: message,
          passwordRequired: true
        };
      }
    }

    const previousSession = this.sessions.removePeer(client.id);
    if (previousSession) {
      await client.leave(this.roomName(previousSession.sessionId));
    }

    const existingPeers = this.sessions.addPeer(payload.sessionId, {
      clientId: client.id,
      role: payload.role,
      displayName: payload.displayName
    });

    await client.join(this.roomName(payload.sessionId));

    client.emit("turn:config", this.turn.getIceConfig());

    for (const peer of existingPeers) {
      client.emit("session:joined", peer);
    }

    client.to(this.roomName(payload.sessionId)).emit("session:joined", {
      clientId: client.id,
      role: payload.role,
      displayName: payload.displayName
    });

    return { clientId: client.id };
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
    if (!this.sessions.hasPeer(payload.sessionId, client.id)) {
      client.emit("error", { message: "Client is not a member of this session" });
      return;
    }

    const eventPayload = {
      ...payload,
      fromClientId: client.id
    };

    if (payload.targetClientId) {
      this.server.to(payload.targetClientId).emit("signal:ice-candidate", eventPayload);
      return;
    }

    client.to(this.roomName(payload.sessionId)).emit("signal:ice-candidate", eventPayload);
  }

  private relayDescription(
    client: ClientSocket,
    eventName: "signal:offer" | "signal:answer",
    payload: WebRtcDescriptionPayload
  ): void {
    if (!this.sessions.hasPeer(payload.sessionId, client.id)) {
      client.emit("error", { message: "Client is not a member of this session" });
      return;
    }

    const eventPayload = {
      ...payload,
      fromClientId: client.id
    };

    if (payload.targetClientId) {
      this.server.to(payload.targetClientId).emit(eventName, eventPayload);
      return;
    }

    client.to(this.roomName(payload.sessionId)).emit(eventName, eventPayload);
  }

  private roomName(sessionId: string): string {
    return `session:${sessionId}`;
  }
}
