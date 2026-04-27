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

const defaultServerPort = 47315;
const defaultHttpProbeTimeoutMs = 700;
const defaultHttpProbeConcurrency = 64;
const defaultMaxProbeHostsPerSubnet = 512;

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
  fetchDiscovery?: FetchDiscoveryResponse;
  getBroadcastAddresses?: () => string[];
  getProbeAddresses?: () => string[];
  httpProbeTimeoutMs?: number;
  now?: () => number;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => void;
};

type DiscoverySocketOptions = "udp4" | { type: "udp4"; reuseAddr: boolean };
type FetchDiscoveryResponse = (url: string, timeoutMs: number) => Promise<DiscoveryResponse | undefined>;

export async function discoverServers(
  timeoutMs = 1400,
  {
    createSocket: createDiscoverySocket = createDefaultDiscoverySocket,
    fetchDiscovery = fetchDiscoveryResponse,
    getBroadcastAddresses: resolveBroadcastAddresses = getBroadcastAddresses,
    getProbeAddresses: resolveProbeAddresses = getUnicastProbeAddresses,
    httpProbeTimeoutMs = defaultHttpProbeTimeoutMs,
    now = Date.now,
    scheduleTimeout = setTimeout
  }: DiscoverServersOptions = {}
): Promise<DiscoveredServer[]> {
  const udpDiscovery = discoverServersByUdp(timeoutMs, {
    createDiscoverySocket,
    resolveBroadcastAddresses,
    now,
    scheduleTimeout
  });
  const httpDiscovery = discoverServersByHttp({
    fetchDiscovery,
    httpProbeTimeoutMs,
    now,
    resolveProbeAddresses
  });

  const [udpServers, httpServers] = await Promise.all([udpDiscovery, httpDiscovery]);
  return mergeDiscoveredServers([...udpServers, ...httpServers]);
}

async function discoverServersByUdp(
  timeoutMs: number,
  {
    createDiscoverySocket,
    resolveBroadcastAddresses,
    now,
    scheduleTimeout
  }: {
    createDiscoverySocket: (options: DiscoverySocketOptions) => DiscoverySocketLike;
    resolveBroadcastAddresses: () => string[];
    now: () => number;
    scheduleTimeout: (callback: () => void, timeoutMs: number) => void;
  }
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

async function discoverServersByHttp({
  fetchDiscovery,
  httpProbeTimeoutMs,
  now,
  resolveProbeAddresses
}: {
  fetchDiscovery: FetchDiscoveryResponse;
  httpProbeTimeoutMs: number;
  now: () => number;
  resolveProbeAddresses: () => string[];
}): Promise<DiscoveredServer[]> {
  const addresses = resolveProbeAddresses();
  if (addresses.length === 0) {
    return [];
  }

  const servers: DiscoveredServer[] = [];

  await runWithConcurrency(addresses, defaultHttpProbeConcurrency, async (address) => {
    const response = await fetchDiscovery(`http://${address}:${defaultServerPort}/discovery`, httpProbeTimeoutMs);
    if (!response) {
      return;
    }

    servers.push(createDiscoveredServer(response, address, now()));
  });

  return servers;
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
      const server = createDiscoveredServer(response, address, now());
      servers.set(`${address}:${response.port}`, server);
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

async function fetchDiscoveryResponse(url: string, timeoutMs: number): Promise<DiscoveryResponse | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return undefined;
    }

    const parsed = await response.json() as Partial<DiscoveryResponse>;
    return isDiscoveryResponse(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseDiscoveryResponse(message: Buffer): DiscoveryResponse | undefined {
  try {
    const parsed = JSON.parse(message.toString("utf8")) as Partial<DiscoveryResponse>;
    if (isDiscoveryResponse(parsed)) {
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

export function getUnicastProbeAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
  maxHostsPerSubnet = defaultMaxProbeHostsPerSubnet
): string[] {
  const addresses = new Set<string>();

  for (const networkInterface of Object.values(interfaces)) {
    for (const entry of networkInterface ?? []) {
      if (!isIpv4Family(entry.family) || entry.internal || !entry.netmask) {
        continue;
      }

      for (const address of getSubnetProbeAddresses(entry.address, entry.netmask, maxHostsPerSubnet)) {
        if (address !== entry.address) {
          addresses.add(address);
        }
      }
    }
  }

  return [...addresses];
}

export function getSubnetProbeAddresses(address: string, netmask: string, maxHosts: number): string[] {
  const addressInt = ipv4ToInt(address);
  const maskInt = ipv4ToInt(netmask);

  if (addressInt === undefined || maskInt === undefined || maxHosts <= 0) {
    return [];
  }

  const network = (addressInt & maskInt) >>> 0;
  const broadcast = (network | (~maskInt >>> 0)) >>> 0;
  const usableHosts = Math.max(0, broadcast - network - 1);
  const first = usableHosts > 0 ? network + 1 : network;
  const last = usableHosts > 0 ? broadcast - 1 : broadcast;
  const hostCount = last >= first ? last - first + 1 : 0;

  if (hostCount === 0 || hostCount > maxHosts) {
    return [];
  }

  const addresses: string[] = [];
  for (let current = first; current <= last; current += 1) {
    addresses.push(intToIpv4(current >>> 0));
  }

  return addresses;
}

export function toBroadcastAddress(address: string, netmask: string): string {
  return toDiscoveryBroadcastAddress(address, netmask);
}

function createDiscoveredServer(response: DiscoveryResponse, address: string, lastSeen: number): DiscoveredServer {
  return {
    id: response.id,
    name: response.name,
    address,
    port: response.port,
    url: response.url || `http://${address}:${response.port}`,
    lastSeen
  };
}

function isDiscoveryResponse(parsed: Partial<DiscoveryResponse>): parsed is DiscoveryResponse {
  return parsed.type === REMOTE_CONTROL_DISCOVERY_RESPONSE
    && parsed.version === 1
    && typeof parsed.id === "string"
    && typeof parsed.name === "string"
    && typeof parsed.port === "number"
    && Number.isInteger(parsed.port)
    && parsed.port > 0
    && parsed.port <= 65535
    && (parsed.url === undefined || typeof parsed.url === "string");
}

function mergeDiscoveredServers(servers: DiscoveredServer[]): DiscoveredServer[] {
  const merged = new Map<string, DiscoveredServer>();

  for (const server of servers) {
    merged.set(server.url, server);
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await task(item);
    }
  }));
}

function ipv4ToInt(value: string): number | undefined {
  const rawParts = value.split(".");
  if (rawParts.length !== 4 || rawParts.some((part) => !/^\d+$/.test(part))) {
    return undefined;
  }

  const parts = rawParts.map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return undefined;
  }

  return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4Family(family: string | number): boolean {
  return family === "IPv4" || family === 4;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join(".");
}
