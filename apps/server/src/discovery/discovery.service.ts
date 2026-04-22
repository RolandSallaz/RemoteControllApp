import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  REMOTE_CONTROL_DISCOVERY_PORT,
  REMOTE_CONTROL_DISCOVERY_REQUEST,
  REMOTE_CONTROL_DISCOVERY_RESPONSE,
  type DiscoveryRequest,
  type DiscoveryResponse
} from "@remote-control/shared";
import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { hostname } from "node:os";

@Injectable()
export class DiscoveryService implements OnModuleInit, OnModuleDestroy {
  private socket?: Socket;

  onModuleInit(): void {
    if (process.env.DISCOVERY_ENABLED === "false") {
      return;
    }

    this.socket = createSocket("udp4");

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
    });
  }

  onModuleDestroy(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  private handleMessage(message: Buffer, remote: RemoteInfo): void {
    const request = parseDiscoveryRequest(message);
    if (!request) {
      return;
    }

    const response: DiscoveryResponse = {
      type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
      version: 1,
      id: process.env.REMOTE_CONTROL_SERVER_ID ?? `${hostname()}:${this.getHttpPort()}`,
      name: process.env.REMOTE_CONTROL_SERVER_NAME ?? `RemoteControl Server (${hostname()})`,
      port: this.getHttpPort(),
      url: process.env.REMOTE_CONTROL_PUBLIC_URL
    };

    const payload = Buffer.from(JSON.stringify(response));
    this.socket?.send(payload, remote.port, remote.address);
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
