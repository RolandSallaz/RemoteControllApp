import assert from "node:assert/strict";
import { test } from "node:test";

import { getProductName, normalizeAppMode } from "./appMeta.js";

test("normalizeAppMode accepts explicit modes and falls back to combined", () => {
  assert.equal(normalizeAppMode("host"), "host");
  assert.equal(normalizeAppMode("viewer"), "viewer");
  assert.equal(normalizeAppMode("combined"), "combined");
  assert.equal(normalizeAppMode("unexpected"), "combined");
});

test("getProductName maps each app mode", () => {
  assert.equal(getProductName("host"), "RemoteControl Server");
  assert.equal(getProductName("viewer"), "RemoteControl Client");
  assert.equal(getProductName("combined"), "RemoteControl");
});
