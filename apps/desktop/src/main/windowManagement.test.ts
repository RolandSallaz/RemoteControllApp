import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildHostSettingsWindowOptions,
  buildMainWindowOptions,
  buildWindowWebPreferences,
  getWindowLoadTarget
} from "./windowManagement.js";

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

test("buildWindowWebPreferences returns isolated preload configuration", () => {
  const preferences = buildWindowWebPreferences("C:/app/main");

  assert.deepEqual({
    ...preferences,
    preload: normalizePathSeparators(preferences.preload)
  }, {
    preload: "C:/app/preload/index.mjs",
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  });
});

test("buildMainWindowOptions adapts layout to app mode", () => {
  const hostOptions = buildMainWindowOptions("host", "C:/app/main", "RemoteControl");
  const viewerOptions = buildMainWindowOptions("viewer", "C:/app/main", "RemoteControl");

  assert.equal(hostOptions.width, 340);
  assert.equal(hostOptions.resizable, false);
  assert.equal(viewerOptions.width, 1280);
  assert.equal(viewerOptions.resizable, true);
});

test("buildHostSettingsWindowOptions produces a modal child window", () => {
  const parent = { id: 1 } as never;
  const options = buildHostSettingsWindowOptions("C:/app/main", parent);

  assert.equal(options.width, 380);
  assert.equal(options.modal, true);
  assert.equal(options.parent, parent);
});

test("getWindowLoadTarget resolves dev and production targets", () => {
  assert.deepEqual(
    getWindowLoadTarget("C:/app/main", true, "http://localhost:5173"),
    { kind: "url", value: "http://localhost:5173" }
  );
  assert.deepEqual(
    getWindowLoadTarget("C:/app/main", true, "http://localhost:5173", "host-settings"),
    { kind: "url", value: "http://localhost:5173?page=host-settings" }
  );
  const productionTarget = getWindowLoadTarget("C:/app/main", false, undefined, "host-settings");
  assert.equal(productionTarget.kind, "file");
  assert.deepEqual({
    ...productionTarget,
    value: normalizePathSeparators(productionTarget.value)
  }, {
    kind: "file",
    value: "C:/app/renderer/index.html",
    query: { page: "host-settings" }
  });
});
