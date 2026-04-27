import assert from "node:assert/strict";
import { test } from "node:test";

import {
  REMOTE_CONTROL_DISCOVERY_RESPONSE,
  type DiscoveryResponse
} from "@remote-control/shared";

import { DiscoveryController } from "./discovery.controller.js";

test("DiscoveryController exposes the HTTP discovery response", () => {
  const response: DiscoveryResponse = {
    type: REMOTE_CONTROL_DISCOVERY_RESPONSE,
    version: 1,
    id: "host-1",
    name: "Office Host",
    port: 47315
  };
  const controller = new DiscoveryController({
    getDiscoveryResponse: () => response
  } as never);

  assert.deepEqual(controller.getDiscovery(), response);
});
