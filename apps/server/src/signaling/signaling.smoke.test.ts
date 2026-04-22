import "reflect-metadata";

import assert from "node:assert/strict";
import { test } from "node:test";

import { NestFactory } from "@nestjs/core";
import type {
  ClientToServerEvents,
  JoinSessionResponse,
  ServerToClientEvents,
  ViewerApprovalRequestPayload
} from "@remote-control/shared";
import { io, type Socket } from "socket.io-client";

import { AppModule } from "../app.module.js";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

test("signaling smoke: host joins, viewer is approved, connects and disconnects cleanly", async () => {
  await withEnv({
    CORS_ORIGIN: "http://127.0.0.1",
    DISCOVERY_ENABLED: "false"
  }, async () => {
    const app = await NestFactory.create(AppModule, {
      logger: false,
      cors: {
        origin: "http://127.0.0.1",
        credentials: true
      }
    });

    app.enableCors({
      origin: "http://127.0.0.1",
      credentials: true
    });

    const server = await app.listen(0, "127.0.0.1");
    const address = server.address();
    assert.ok(address && typeof address === "object" && "port" in address);

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const host = createClient(baseUrl);
    const viewer = createClient(baseUrl);

    try {
      await Promise.all([waitForSocketConnect(host), waitForSocketConnect(viewer)]);

      const hostTurn = waitForEvent<{ iceServers: Array<{ urls: string[] }> }>(host, "turn:config");
      const hostJoin = emitWithAck(host, "session:join", {
        sessionId: "LAN",
        role: "host",
        displayName: "Host"
      });

      const approvalRequest = waitForApprovalRequest(host);
      const hostPeerJoined = waitForEvent<{ clientId: string; role: string; displayName?: string }>(host, "session:joined");
      const viewerTurn = waitForEvent<{ iceServers: Array<{ urls: string[] }> }>(viewer, "turn:config");
      const viewerJoin = emitWithAck(viewer, "session:join", {
        sessionId: "LAN",
        role: "viewer",
        displayName: "Viewer"
      });

      const [hostJoinResult, hostTurnPayload, approval, viewerJoinResult, viewerTurnPayload, joinedPayload] = await Promise.all([
        hostJoin,
        hostTurn,
        approvalRequest,
        viewerJoin,
        viewerTurn,
        hostPeerJoined
      ]);

      assert.equal(typeof hostJoinResult.clientId, "string");
      assert.notEqual(hostJoinResult.clientId.length, 0);
      assert.equal(hostTurnPayload.iceServers.length > 0, true);
      assert.equal(approval.sessionId, "LAN");
      assert.equal(approval.displayName, "Viewer");
      assert.equal(typeof viewerJoinResult.clientId, "string");
      assert.notEqual(viewerJoinResult.clientId.length, 0);
      assert.equal(viewerTurnPayload.iceServers.length > 0, true);
      assert.deepEqual(joinedPayload, {
        clientId: viewerJoinResult.clientId,
        role: "viewer",
        displayName: "Viewer"
      });

      const hostPeerLeft = waitForEvent<{ clientId: string }>(host, "session:left");
      viewer.disconnect();
      assert.deepEqual(await hostPeerLeft, { clientId: viewerJoinResult.clientId });
    } finally {
      host.disconnect();
      viewer.disconnect();
      await app.close();
    }
  });
});

function createClient(baseUrl: string): TestSocket {
  return io<ServerToClientEvents, ClientToServerEvents>(baseUrl, {
    transports: ["websocket"],
    forceNew: true,
    reconnection: false
  });
}

function waitForSocketConnect(socket: TestSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out connecting socket ${socket.id ?? "<pending>"}`));
    }, 10_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
    };

    const handleConnect = (): void => {
      cleanup();
      resolve();
    };

    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleError);
  });
}

function emitWithAck(socket: TestSocket, event: "session:join", payload: Parameters<ClientToServerEvents["session:join"]>[0]): Promise<JoinSessionResponse> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (response) => resolve(response));
  });
}

function waitForEvent<T>(socket: TestSocket, event: keyof ServerToClientEvents): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${String(event)}`));
    }, 10_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off(event, handleEvent as never);
    };

    const handleEvent = (payload: T): void => {
      cleanup();
      resolve(payload);
    };

    socket.on(event, handleEvent as never);
  });
}

function waitForApprovalRequest(socket: TestSocket): Promise<ViewerApprovalRequestPayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for session:approval-request"));
    }, 10_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off("session:approval-request", handleApproval);
    };

    const handleApproval = (
      payload: ViewerApprovalRequestPayload,
      ack: (response: { approved: boolean }) => void
    ): void => {
      cleanup();
      ack({ approved: true });
      resolve(payload);
    };

    socket.on("session:approval-request", handleApproval);
  });
}

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
