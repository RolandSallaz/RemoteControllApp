import assert from "node:assert/strict";
import { test } from "node:test";

import {
  discoverServers,
  getBroadcastAddresses,
  getSubnetProbeAddresses,
  getUnicastProbeAddresses,
  parseDiscoveryResponse,
  toBroadcastAddress
} from "./discoveryClient.js";
import {
  REMOTE_CONTROL_DISCOVERY_PORT,
  REMOTE_CONTROL_DISCOVERY_REQUEST,
  REMOTE_CONTROL_DISCOVERY_RESPONSE
} from "@remote-control/shared";

test("parseDiscoveryResponse accepts valid responses and rejects malformed payloads", () => {
  assert.deepEqual(parseDiscoveryResponse(Buffer.from(JSON.stringify({
    type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
    version: 1,
    id: "server-1",
    name: "Office PC",
    port: 47315
  }))), {
    type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
    version: 1,
    id: "server-1",
    name: "Office PC",
    port: 47315
  });

  assert.equal(parseDiscoveryResponse(Buffer.from("{")), undefined);
  assert.equal(parseDiscoveryResponse(Buffer.from(JSON.stringify({
    type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
    version: 2,
    name: "Office PC",
    port: 47315
  }))), undefined);
});

test("getBroadcastAddresses derives IPv4 broadcast targets", () => {
  assert.equal(toBroadcastAddress("192.168.1.42", "255.255.255.0"), "192.168.1.255");

  const addresses = getBroadcastAddresses({
    ethernet: [
      { address: "192.168.1.42", family: "IPv4", internal: false, netmask: "255.255.255.0" },
      { address: "10.0.0.12", family: "IPv4", internal: false, netmask: "255.255.0.0" },
      { address: "127.0.0.1", family: "IPv4", internal: true, netmask: "255.0.0.0" }
    ],
    loopback: [
      { address: "::1", family: "IPv6", internal: true, netmask: "ffff:ffff:ffff:ffff::" }
    ]
  } as ReturnType<typeof import("node:os").networkInterfaces>);

  assert.deepEqual(addresses.sort(), [
    "10.0.255.255",
    "127.0.0.1",
    "192.168.1.255",
    "255.255.255.255"
  ]);
});

test("discoverServers broadcasts discovery requests and collects sorted unique servers", async () => {
  const sent: Array<{ payload: unknown; port: number; address: string }> = [];
  let broadcastEnabled = false;
  let closed = false;
  let messageListener: ((message: Buffer, remote: { address: string }) => void) | undefined;
  let finishDiscovery: (() => void) | undefined;

  const promise = discoverServers(250, {
    createSocket: () => ({
      bind: (port, callback) => {
        assert.equal(port, REMOTE_CONTROL_DISCOVERY_PORT);
        callback();
      },
      close: () => {
        closed = true;
      },
      on: (event, listener) => {
        if (event === "message") {
          messageListener = listener as (message: Buffer, remote: { address: string }) => void;
        }
      },
      send: (payload, port, address) => {
        sent.push({
          payload: JSON.parse(payload.toString("utf8")),
          port,
          address
        });
      },
      setBroadcast: (enabled) => {
        broadcastEnabled = enabled;
      }
    }),
    getBroadcastAddresses: () => ["192.168.1.255", "127.0.0.1"],
    getProbeAddresses: () => [],
    now: () => 123456,
    scheduleTimeout: (callback, delayMs) => {
      assert.equal(delayMs, 250);
      finishDiscovery = callback;
    }
  });

  assert.equal(broadcastEnabled, true);
  assert.deepEqual(sent, [
    {
      payload: {
        type: REMOTE_CONTROL_DISCOVERY_REQUEST,
        version: 1
      },
      port: REMOTE_CONTROL_DISCOVERY_PORT,
      address: "192.168.1.255"
    },
    {
      payload: {
        type: REMOTE_CONTROL_DISCOVERY_REQUEST,
        version: 1
      },
      port: REMOTE_CONTROL_DISCOVERY_PORT,
      address: "127.0.0.1"
    }
  ]);

  messageListener?.(Buffer.from(JSON.stringify({
    type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
    version: 1,
    id: "server-b",
    name: "Zulu",
    port: 47315
  })), { address: "192.0.2.20" });
  messageListener?.(Buffer.from(JSON.stringify({
    type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
    version: 1,
    id: "server-a",
    name: "Alpha",
    port: 47315,
    url: "https://alpha.example"
  })), { address: "192.0.2.10" });
  messageListener?.(Buffer.from(JSON.stringify({
    type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
    version: 1,
    id: "server-a2",
    name: "Alpha Updated",
    port: 47315
  })), { address: "192.0.2.10" });
  messageListener?.(Buffer.from("not json"), { address: "192.0.2.30" });

  finishDiscovery?.();

  assert.deepEqual(await promise, [
    {
      id: "server-a2",
      name: "Alpha Updated",
      address: "192.0.2.10",
      port: 47315,
      url: "http://192.0.2.10:47315",
      lastSeen: 123456
    },
    {
      id: "server-b",
      name: "Zulu",
      address: "192.0.2.20",
      port: 47315,
      url: "http://192.0.2.20:47315",
      lastSeen: 123456
    }
  ]);
  assert.equal(closed, true);
});

test("discoverServers falls back to direct request responses when the discovery port is unavailable", async () => {
  const bindPorts: number[] = [];
  const sent: Array<{ port: number; address: string }> = [];
  let finishDiscovery: (() => void) | undefined;

  const promise = discoverServers(250, {
    createSocket: () => {
      let errorListener: ((error: Error) => void) | undefined;

      return {
        bind: (port, callback) => {
          bindPorts.push(port);

          if (port === REMOTE_CONTROL_DISCOVERY_PORT) {
            errorListener?.(new Error("port in use"));
            return;
          }

          callback();
        },
        close: () => undefined,
        on: (event, listener) => {
          if (event === "error") {
            errorListener = listener as (error: Error) => void;
          }
        },
        send: (_payload, port, address) => {
          sent.push({ port, address });
        },
        setBroadcast: () => undefined
      };
    },
    getBroadcastAddresses: () => ["192.168.1.255"],
    getProbeAddresses: () => [],
    scheduleTimeout: (callback) => {
      finishDiscovery = callback;
    }
  });

  await Promise.resolve();
  finishDiscovery?.();

  assert.deepEqual(await promise, []);
  assert.deepEqual(bindPorts, [REMOTE_CONTROL_DISCOVERY_PORT, 0]);
  assert.deepEqual(sent, [{
    port: REMOTE_CONTROL_DISCOVERY_PORT,
    address: "192.168.1.255"
  }]);
});

test("getUnicastProbeAddresses derives bounded host probes for small VPN subnets", () => {
  assert.deepEqual(getSubnetProbeAddresses("10.8.0.2", "255.255.255.252", 16), [
    "10.8.0.1",
    "10.8.0.2"
  ]);

  const addresses = getUnicastProbeAddresses({
    vpn: [
      { address: "10.8.0.2", family: "IPv4", internal: false, netmask: "255.255.255.252" },
      { address: "10.9.0.2", family: "IPv4", internal: false, netmask: "255.255.0.0" },
      { address: "127.0.0.1", family: "IPv4", internal: true, netmask: "255.0.0.0" }
    ]
  } as ReturnType<typeof import("node:os").networkInterfaces>, 16);

  assert.deepEqual(addresses, ["10.8.0.1"]);
});

test("discoverServers probes VPN peers over HTTP when broadcast discovery is unavailable", async () => {
  const fetchedUrls: string[] = [];

  const servers = await discoverServers(250, {
    createSocket: () => ({
      bind: (_port, callback) => {
        callback();
      },
      close: () => undefined,
      on: () => undefined,
      send: () => undefined,
      setBroadcast: () => undefined
    }),
    fetchDiscovery: async (url) => {
      fetchedUrls.push(url);
      if (url !== "http://10.8.0.9:47315/discovery") {
        return undefined;
      }

      return {
        type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
        version: 1,
        id: "vpn-host",
        name: "VPN Host",
        port: 47315
      };
    },
    getBroadcastAddresses: () => [],
    getProbeAddresses: () => ["10.8.0.8", "10.8.0.9"],
    now: () => 123456,
    scheduleTimeout: (callback) => {
      callback();
    }
  });

  assert.deepEqual(fetchedUrls.sort(), [
    "http://10.8.0.8:47315/discovery",
    "http://10.8.0.9:47315/discovery"
  ]);
  assert.deepEqual(servers, [{
    id: "vpn-host",
    name: "VPN Host",
    address: "10.8.0.9",
    port: 47315,
    url: "http://10.8.0.9:47315",
    lastSeen: 123456
  }]);
});
