import { Injectable } from "@nestjs/common";

import type { ClientId, PeerRole, SessionId } from "@remote-control/shared";

type SessionPeer = {
  clientId: ClientId;
  role: PeerRole;
  displayName?: string;
};

@Injectable()
export class SessionsService {
  private readonly sessions = new Map<SessionId, Map<ClientId, SessionPeer>>();

  addPeer(sessionId: SessionId, peer: SessionPeer): SessionPeer[] {
    const peers = this.getOrCreateSession(sessionId);
    peers.set(peer.clientId, peer);
    return [...peers.values()].filter((existingPeer) => existingPeer.clientId !== peer.clientId);
  }

  removePeer(clientId: ClientId): { sessionId: SessionId; peer: SessionPeer } | undefined {
    for (const [sessionId, peers] of this.sessions.entries()) {
      const peer = peers.get(clientId);
      if (!peer) {
        continue;
      }

      peers.delete(clientId);
      if (peers.size === 0) {
        this.sessions.delete(sessionId);
      }

      return { sessionId, peer };
    }

    return undefined;
  }

  hasPeer(sessionId: SessionId, clientId: ClientId): boolean {
    return this.sessions.get(sessionId)?.has(clientId) ?? false;
  }

  getPeer(clientId: ClientId): { sessionId: SessionId; peer: SessionPeer } | undefined {
    for (const [sessionId, peers] of this.sessions.entries()) {
      const peer = peers.get(clientId);
      if (peer) {
        return { sessionId, peer };
      }
    }

    return undefined;
  }

  getStats(): { connectedClients: number; activeSessions: number } {
    let connectedClients = 0;
    for (const peers of this.sessions.values()) {
      connectedClients += peers.size;
    }
    return { connectedClients, activeSessions: this.sessions.size };
  }

  private getOrCreateSession(sessionId: SessionId): Map<ClientId, SessionPeer> {
    let peers = this.sessions.get(sessionId);
    if (!peers) {
      peers = new Map<ClientId, SessionPeer>();
      this.sessions.set(sessionId, peers);
    }

    return peers;
  }
}
