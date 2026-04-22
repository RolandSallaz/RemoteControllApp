import assert from "node:assert/strict";
import { test } from "node:test";

import { TurnService } from "./turn.service.js";

test("TurnService returns STUN fallback when no env is configured", () => {
  const previousStun = process.env.STUN_URLS;
  const previousTurn = process.env.TURN_URLS;

  try {
    delete process.env.STUN_URLS;
    delete process.env.TURN_URLS;

    const service = new TurnService();
    assert.deepEqual(service.getIceConfig(), {
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }]
    });
  } finally {
    restoreEnv("STUN_URLS", previousStun);
    restoreEnv("TURN_URLS", previousTurn);
  }
});

test("TurnService trims configured STUN/TURN lists and includes TURN credentials", () => {
  const previousStun = process.env.STUN_URLS;
  const previousTurn = process.env.TURN_URLS;
  const previousUsername = process.env.TURN_USERNAME;
  const previousCredential = process.env.TURN_CREDENTIAL;

  try {
    process.env.STUN_URLS = " stun:one.example , stun:two.example ";
    process.env.TURN_URLS = " turn:one.example ,, turn:two.example ";
    process.env.TURN_USERNAME = "user";
    process.env.TURN_CREDENTIAL = "secret";

    const service = new TurnService();
    assert.deepEqual(service.getIceConfig(), {
      iceServers: [
        { urls: ["stun:one.example", "stun:two.example"] },
        {
          urls: ["turn:one.example", "turn:two.example"],
          username: "user",
          credential: "secret"
        }
      ]
    });
  } finally {
    restoreEnv("STUN_URLS", previousStun);
    restoreEnv("TURN_URLS", previousTurn);
    restoreEnv("TURN_USERNAME", previousUsername);
    restoreEnv("TURN_CREDENTIAL", previousCredential);
  }
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
