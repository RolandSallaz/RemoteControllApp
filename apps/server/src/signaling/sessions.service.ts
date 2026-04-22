import { Injectable } from "@nestjs/common";

import type { ClientId, PeerRole, SessionId } from "@remote-control/shared";

type SessionPeer = {
  clientId: ClientId;
  role: PeerRole;
  displayName?: string;
};

type StoredSessionPeer = SessionPeer & {
  lastSeenAt: number;
};

export type RemovedSessionPeer = {
  sessionId: SessionId;
  peer: SessionPeer;
};

export class SessionCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCapacityError";
  }
}

@Injectable()
export class SessionsService {
  private readonly sessions = new Map<SessionId, Map<ClientId, StoredSessionPeer>>();
  private readonly maxSessions = readPositiveInteger("REMOTE_CONTROL_MAX_SESSIONS", 256);
  private readonly maxPeersPerSession = readPositiveInteger("REMOTE_CONTROL_MAX_PEERS_PER_SESSION", 2);
  private readonly maxTotalPeers = readPositiveInteger("REMOTE_CONTROL_MAX_TOTAL_PEERS", 512);
  private readonly peerTtlMs = readPositiveInteger("REMOTE_CONTROL_PEER_TTL_MS", 120_000);

  addPeer(sessionId: SessionId, peer: SessionPeer): SessionPeer[] {
    this.assertCapacity(sessionId, peer);

    const peers = this.getOrCreateSession(sessionId);
    peers.set(peer.clientId, {
      ...peer,
      lastSeenAt: Date.now()
    });

    return [...peers.values()]
      .filter((existingPeer) => existingPeer.clientId !== peer.clientId)
      .map(toSessionPeer);
  }

  removePeer(clientId: ClientId): RemovedSessionPeer | undefined {
    for (const [sessionId, peers] of this.sessions.entries()) {
      const peer = peers.get(clientId);
      if (!peer) {
        continue;
      }

      peers.delete(clientId);
      if (peers.size === 0) {
        this.sessions.delete(sessionId);
      }

      return { sessionId, peer: toSessionPeer(peer) };
    }

    return undefined;
  }

  hasPeer(sessionId: SessionId, clientId: ClientId): boolean {
    return this.touchPeer(sessionId, clientId);
  }

  getPeer(clientId: ClientId): RemovedSessionPeer | undefined {
    for (const [sessionId, peers] of this.sessions.entries()) {
      const peer = peers.get(clientId);
      if (peer) {
        return { sessionId, peer: toSessionPeer(peer) };
      }
    }

    return undefined;
  }

  getPeerByRole(sessionId: SessionId, role: PeerRole): SessionPeer | undefined {
    for (const peer of this.sessions.get(sessionId)?.values() ?? []) {
      if (peer.role === role) {
        return toSessionPeer(peer);
      }
    }

    return undefined;
  }

  touchPeer(sessionId: SessionId, clientId: ClientId): boolean {
    const peer = this.sessions.get(sessionId)?.get(clientId);
    if (!peer) {
      return false;
    }

    peer.lastSeenAt = Date.now();
    return true;
  }

  removeExpiredPeers(now = Date.now()): RemovedSessionPeer[] {
    const removedPeers: RemovedSessionPeer[] = [];

    for (const [sessionId, peers] of this.sessions.entries()) {
      for (const [clientId, peer] of peers.entries()) {
        if (now - peer.lastSeenAt <= this.peerTtlMs) {
          continue;
        }

        peers.delete(clientId);
        removedPeers.push({
          sessionId,
          peer: toSessionPeer(peer)
        });
      }

      if (peers.size === 0) {
        this.sessions.delete(sessionId);
      }
    }

    return removedPeers;
  }

  getStats(): { connectedClients: number; activeSessions: number } {
    let connectedClients = 0;
    for (const peers of this.sessions.values()) {
      connectedClients += peers.size;
    }
    return { connectedClients, activeSessions: this.sessions.size };
  }

  private getOrCreateSession(sessionId: SessionId): Map<ClientId, StoredSessionPeer> {
    let peers = this.sessions.get(sessionId);
    if (!peers) {
      peers = new Map<ClientId, StoredSessionPeer>();
      this.sessions.set(sessionId, peers);
    }

    return peers;
  }

  private assertCapacity(sessionId: SessionId, peer: SessionPeer): void {
    const peers = this.sessions.get(sessionId);
    const replacingExistingPeer = peers?.has(peer.clientId) ?? false;

    if (!peers && this.sessions.size >= this.maxSessions) {
      throw new SessionCapacityError(`Session limit reached (${this.maxSessions})`);
    }

    const sameRolePeer = [...(peers?.values() ?? [])].find((existingPeer) => existingPeer.role === peer.role);
    if (sameRolePeer && sameRolePeer.clientId !== peer.clientId) {
      throw new SessionCapacityError(`A ${peer.role} is already connected to session ${sessionId}`);
    }

    if (!replacingExistingPeer && peers && peers.size >= this.maxPeersPerSession) {
      throw new SessionCapacityError(`Peer limit reached for session ${sessionId} (${this.maxPeersPerSession})`);
    }

    if (!replacingExistingPeer && this.getTotalPeerCount() >= this.maxTotalPeers) {
      throw new SessionCapacityError(`Total peer limit reached (${this.maxTotalPeers})`);
    }
  }

  private getTotalPeerCount(): number {
    let total = 0;
    for (const peers of this.sessions.values()) {
      total += peers.size;
    }

    return total;
  }
}

function toSessionPeer(peer: StoredSessionPeer): SessionPeer {
  return {
    clientId: peer.clientId,
    role: peer.role,
    displayName: peer.displayName
  };
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  return fallback;
}
