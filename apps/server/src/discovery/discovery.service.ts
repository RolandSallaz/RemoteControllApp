import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  getDiscoveryBroadcastAddresses,
  REMOTE_CONTROL_DISCOVERY_PORT,
  REMOTE_CONTROL_DISCOVERY_REQUEST,
  REMOTE_CONTROL_DISCOVERY_RESPONSE,
  type DiscoveryRequest,
  type DiscoveryResponse
} from "@remote-control/shared";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { hostname, networkInterfaces } from "node:os";

@Injectable()
export class DiscoveryService implements OnModuleInit, OnModuleDestroy {
  private socket?: Socket;
  private announcementTimer?: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    if (process.env.DISCOVERY_ENABLED === "false") {
      return;
    }

    this.socket = createSocket({ type: "udp4", reuseAddr: true });

    this.socket.on("message", (message, remote) => {
      this.handleMessage(message, remote);
    });

    this.socket.on("error", (error) => {
      console.error(`RemoteControl discovery error: ${error.message}`);
      this.socket?.close();
      this.socket = undefined;
    });

    this.socket.bind(REMOTE_CONTROL_DISCOVERY_PORT, "0.0.0.0", () => {
      this.socket?.setBroadcast(true);
      console.log(`RemoteControl discovery listening on udp://0.0.0.0:${REMOTE_CONTROL_DISCOVERY_PORT}`);
      this.announcePresence();
      this.startAnnouncements();
    });
  }

  onModuleDestroy(): void {
    if (this.announcementTimer) {
      clearInterval(this.announcementTimer);
      this.announcementTimer = undefined;
    }

    this.socket?.close();
    this.socket = undefined;
  }

  private handleMessage(message: Buffer, remote: RemoteInfo): void {
    const request = parseDiscoveryRequest(message);
    if (!request) {
      return;
    }

    const payload = Buffer.from(JSON.stringify(this.getDiscoveryResponse()));
    this.socket?.send(payload, remote.port, remote.address);
  }

  getDiscoveryResponse(): DiscoveryResponse {
    return {
      type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
      version: 1,
      id: process.env.REMOTE_CONTROL_SERVER_ID ?? `${hostname()}:${this.getHttpPort()}`,
      name: process.env.REMOTE_CONTROL_SERVER_NAME ?? `RemoteControl Server (${hostname()})`,
      port: this.getHttpPort(),
      url: process.env.REMOTE_CONTROL_PUBLIC_URL
    };
  }

  private announcePresence(): void {
    const payload = Buffer.from(JSON.stringify(this.getDiscoveryResponse()));

    for (const address of getDiscoveryBroadcastAddresses(networkInterfaces())) {
      this.socket?.send(payload, REMOTE_CONTROL_DISCOVERY_PORT, address);
    }
  }

  private startAnnouncements(): void {
    const intervalMs = this.getAnnouncementIntervalMs();
    if (intervalMs <= 0) {
      return;
    }

    this.announcementTimer = setInterval(() => {
      this.announcePresence();
    }, intervalMs);
    this.announcementTimer.unref?.();
  }

  private getAnnouncementIntervalMs(): number {
    const intervalMs = Number(process.env.DISCOVERY_ANNOUNCE_INTERVAL_MS ?? 1000);
    return Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
  }

  private getHttpPort(): number {
    return Number(process.env.PORT ?? 47315);
  }
}

function parseDiscoveryRequest(message: Buffer): DiscoveryRequest | undefined {
  try {
    const parsed = JSON.parse(message.toString("utf8")) as Partial<DiscoveryRequest>;
    if (parsed.type === REMOTE_CONTROL_DISCOVERY_REQUEST && parsed.version === 1) {
      return parsed as DiscoveryRequest;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
