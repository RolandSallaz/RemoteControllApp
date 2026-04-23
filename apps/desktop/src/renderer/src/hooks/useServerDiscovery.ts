import { useState } from "react";
import type { DiscoveredServer } from "@remote-control/shared";

export function useServerDiscovery({
  defaultServerUrl,
  isConnected,
  serverUrl,
  setServerUrl,
  setStatus
}: {
  defaultServerUrl: string;
  isConnected: boolean;
  serverUrl: string;
  setServerUrl: (url: string) => void;
  setStatus: (status: string) => void;
}) {
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([]);
  const [serverLatencies, setServerLatencies] = useState<Map<string, number>>(new Map());
  const [isDiscovering, setIsDiscovering] = useState(false);

  async function scanServers(): Promise<void> {
    setIsDiscovering(true);
    try {
      const servers = await window.remoteControl.discoverServers();
      setDiscoveredServers(servers);

      if (!isConnected && servers[0] && serverUrl === defaultServerUrl) {
        setServerUrl(servers[0].url);
      }

      setStatus(servers.length > 0 ? `Found ${servers.length} server${servers.length === 1 ? "" : "s"} on LAN` : "No LAN servers found");

      const latencies = new Map<string, number>();
      await Promise.all(servers.map(async (server) => {
        try {
          const start = performance.now();
          await fetch(`${server.url}/stats`, { signal: AbortSignal.timeout(2000) });
          latencies.set(server.url, Math.round(performance.now() - start));
        } catch {
          // unreachable or timed out - no latency shown
        }
      }));
      setServerLatencies(latencies);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDiscovering(false);
    }
  }

  return {
    discoveredServers,
    isDiscovering,
    scanServers,
    serverLatencies
  };
}
