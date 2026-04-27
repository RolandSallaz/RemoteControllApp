import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";

import {
  getDiscoveryBroadcastAddresses,
  REMOTE_CONTROL_DISCOVERY_PORT,
  REMOTE_CONTROL_DISCOVERY_REQUEST,
  REMOTE_CONTROL_DISCOVERY_RESPONSE,
  toDiscoveryBroadcastAddress,
  type DiscoveredServer,
  type DiscoveryRequest,
  type DiscoveryResponse
} from "@remote-control/shared";

type DiscoverySocketLike = {
  bind: (port: number, callback: () => void) => void;
  close: () => void;
  on: {
    (event: "message", listener: (message: Buffer, remote: { address: string }) => void): void;
    (event: "error", listener: (error: Error) => void): void;
  };
  send: (payload: Buffer, port: number, address: string) => void;
  setBroadcast: (enabled: boolean) => void;
};

type DiscoverServersOptions = {
  createSocket?: (options: DiscoverySocketOptions) => DiscoverySocketLike;
  getBroadcastAddresses?: () => string[];
  now?: () => number;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => void;
};

type DiscoverySocketOptions = "udp4" | { type: "udp4"; reuseAddr: boolean };

export async function discoverServers(
  timeoutMs = 1400,
  {
    createSocket: createDiscoverySocket = createDefaultDiscoverySocket,
    getBroadcastAddresses: resolveBroadcastAddresses = getBroadcastAddresses,
    now = Date.now,
    scheduleTimeout = setTimeout
  }: DiscoverServersOptions = {}
): Promise<DiscoveredServer[]> {
  try {
    return await runDiscoveryScan(timeoutMs, {
      bindPort: REMOTE_CONTROL_DISCOVERY_PORT,
      createDiscoverySocket,
      resolveBroadcastAddresses,
      now,
      scheduleTimeout,
      socketOptions: { type: "udp4", reuseAddr: true }
    });
  } catch {
    return await runDiscoveryScan(timeoutMs, {
      bindPort: 0,
      createDiscoverySocket,
      resolveBroadcastAddresses,
      now,
      scheduleTimeout,
      socketOptions: "udp4"
    });
  }
}

function runDiscoveryScan(
  timeoutMs: number,
  {
    bindPort,
    createDiscoverySocket,
    resolveBroadcastAddresses,
    now,
    scheduleTimeout,
    socketOptions
  }: {
    bindPort: number;
    createDiscoverySocket: (options: DiscoverySocketOptions) => DiscoverySocketLike;
    resolveBroadcastAddresses: () => string[];
    now: () => number;
    scheduleTimeout: (callback: () => void, timeoutMs: number) => void;
    socketOptions: DiscoverySocketOptions;
  }
): Promise<DiscoveredServer[]> {
  const socket = createDiscoverySocket(socketOptions);
  const servers = new Map<string, DiscoveredServer>();

  const request: DiscoveryRequest = {
    type: REMOTE_CONTROL_DISCOVERY_REQUEST,
    version: 1
  };
  const payload = Buffer.from(JSON.stringify(request));

  return new Promise((resolve, reject) => {
    let bound = false;
    let finished = false;

    const finish = (): void => {
      if (finished) {
        return;
      }

      finished = true;
      try {
        socket.close();
      } catch {
        // Socket may already be closed after a bind error.
      }
      resolve([...servers.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };

    socket.on("message", (message, remote) => {
      const response = parseDiscoveryResponse(message);
      if (!response) {
        return;
      }

      const address = remote.address;
      const url = response.url || `http://${address}:${response.port}`;
      servers.set(`${address}:${response.port}`, {
        id: response.id,
        name: response.name,
        address,
        port: response.port,
        url,
        lastSeen: now()
      });
    });

    socket.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      try {
        socket.close();
      } catch {
        // Socket may already be closed after a bind error.
      }

      if (!bound) {
        reject(error);
        return;
      }

      resolve([...servers.values()].sort((a, b) => a.name.localeCompare(b.name)));
    });

    socket.bind(bindPort, () => {
      bound = true;
      socket.setBroadcast(true);
      for (const address of resolveBroadcastAddresses()) {
        socket.send(payload, REMOTE_CONTROL_DISCOVERY_PORT, address);
      }

      scheduleTimeout(finish, timeoutMs);
    });
  });
}

function createDefaultDiscoverySocket(options: DiscoverySocketOptions): DiscoverySocketLike {
  return typeof options === "string" ? createSocket(options) : createSocket(options);
}

export function parseDiscoveryResponse(message: Buffer): DiscoveryResponse | undefined {
  try {
    const parsed = JSON.parse(message.toString("utf8")) as Partial<DiscoveryResponse>;
    if (parsed.type === REMOTE_CONTROL_DISCOVERY_RESPONSE && parsed.version === 1 && parsed.port && parsed.name) {
      return parsed as DiscoveryResponse;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function getBroadcastAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string[] {
  return getDiscoveryBroadcastAddresses(interfaces);
}

export function toBroadcastAddress(address: string, netmask: string): string {
  return toDiscoveryBroadcastAddress(address, netmask);
}
