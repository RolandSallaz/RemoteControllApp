import assert from "node:assert/strict";
import { test } from "node:test";

import { SessionCapacityError, SessionsService } from "./sessions.service.js";

test("SessionsService allows one host and one viewer per session", () => {
  const sessions = new SessionsService();

  assert.deepEqual(sessions.addPeer("LAN", { clientId: "host-1", role: "host", displayName: "Host" }), []);
  assert.throws(
    () => sessions.addPeer("LAN", { clientId: "host-2", role: "host" }),
    SessionCapacityError
  );

  assert.deepEqual(
    sessions.addPeer("LAN", { clientId: "viewer-1", role: "viewer", displayName: "Viewer" }),
    [{ clientId: "host-1", role: "host", displayName: "Host" }]
  );
  assert.throws(
    () => sessions.addPeer("LAN", { clientId: "viewer-2", role: "viewer" }),
    SessionCapacityError
  );
});

test("SessionsService removes expired peers", () => {
  const sessions = new SessionsService();
  sessions.addPeer("LAN", { clientId: "host-1", role: "host" });

  const removed = sessions.removeExpiredPeers(Date.now() + 121_000);

  assert.equal(removed.length, 1);
  assert.equal(removed[0]?.sessionId, "LAN");
  assert.equal(removed[0]?.peer.clientId, "host-1");
  assert.deepEqual(sessions.getStats(), { connectedClients: 0, activeSessions: 0 });
});

test("SessionsService can query and remove peers by role and client id", () => {
  const sessions = new SessionsService();
  sessions.addPeer("LAN", { clientId: "host-1", role: "host", displayName: "Host" });
  sessions.addPeer("LAN", { clientId: "viewer-1", role: "viewer", displayName: "Viewer" });

  assert.equal(sessions.hasPeer("LAN", "host-1"), true);
  assert.equal(sessions.hasPeer("LAN", "missing"), false);
  assert.deepEqual(sessions.getPeer("viewer-1"), {
    sessionId: "LAN",
    peer: { clientId: "viewer-1", role: "viewer", displayName: "Viewer" }
  });
  assert.deepEqual(sessions.getPeerByRole("LAN", "host"), {
    clientId: "host-1",
    role: "host",
    displayName: "Host"
  });
  assert.deepEqual(sessions.removePeer("viewer-1"), {
    sessionId: "LAN",
    peer: { clientId: "viewer-1", role: "viewer", displayName: "Viewer" }
  });
  assert.equal(sessions.getPeer("viewer-1"), undefined);
});
