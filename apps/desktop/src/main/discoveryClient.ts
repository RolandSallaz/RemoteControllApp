import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";

import {
  REMOTE_CONTROL_DISCOVERY_PORT,
  REMOTE_CONTROL_DISCOVERY_REQUEST,
  REMOTE_CONTROL_DISCOVERY_RESPONSE,
  type DiscoveredServer,
  type DiscoveryRequest,
  type DiscoveryResponse
} from "@remote-control/shared";

export async function discoverServers(timeoutMs = 1400): Promise<DiscoveredServer[]> {
  const socket = createSocket("udp4");
  const servers = new Map<string, DiscoveredServer>();

  const request: DiscoveryRequest = {
    type: REMOTE_CONTROL_DISCOVERY_REQUEST,
    version: 1
  };
  const payload = Buffer.from(JSON.stringify(request));

  return await new Promise((resolve) => {
    const finish = (): void => {
      socket.close();
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
        lastSeen: Date.now()
      });
    });

    socket.bind(0, () => {
      socket.setBroadcast(true);
      for (const address of getBroadcastAddresses()) {
        socket.send(payload, REMOTE_CONTROL_DISCOVERY_PORT, address);
      }

      setTimeout(finish, timeoutMs);
    });
  });
}

function parseDiscoveryResponse(message: Buffer): DiscoveryResponse | undefined {
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

function getBroadcastAddresses(): string[] {
  const addresses = new Set<string>(["127.0.0.1", "255.255.255.255"]);

  for (const networkInterface of Object.values(networkInterfaces())) {
    for (const entry of networkInterface ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !entry.netmask) {
        continue;
      }

      addresses.add(toBroadcastAddress(entry.address, entry.netmask));
    }
  }

  return [...addresses];
}

function toBroadcastAddress(address: string, netmask: string): string {
  const addressParts = address.split(".").map(Number);
  const maskParts = netmask.split(".").map(Number);
  return addressParts.map((part, index) => (part | (~maskParts[index] & 255)) & 255).join(".");
}
