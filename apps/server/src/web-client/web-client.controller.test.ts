import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  getWebClientContentType,
  resolveWebClientRoot
} from "./web-client.controller.js";

test("resolveWebClientRoot prefers a configured built web client", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-control-web-"));

  try {
    writeFileSync(join(root, "index.html"), "<div id=\"root\"></div>");

    assert.equal(resolveWebClientRoot({
      currentDir: "C:/missing/dist",
      envRoot: root,
      exists: (path) => path === join(root, "index.html"),
      processCwd: "C:/missing"
    }), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveWebClientRoot finds the desktop renderer output from server dist", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-control-workspace-"));
  const rendererRoot = join(root, "apps", "desktop", "out", "renderer");
  mkdirSync(rendererRoot, { recursive: true });
  writeFileSync(join(rendererRoot, "index.html"), "<div id=\"root\"></div>");

  try {
    assert.equal(resolveWebClientRoot({
      currentDir: join(root, "apps", "server", "dist"),
      envRoot: undefined,
      processCwd: root
    }), rendererRoot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getWebClientContentType maps common renderer assets", () => {
  assert.equal(getWebClientContentType("index.html"), "text/html; charset=utf-8");
  assert.equal(getWebClientContentType("assets/index.js"), "text/javascript; charset=utf-8");
  assert.equal(getWebClientContentType("assets/index.css"), "text/css; charset=utf-8");
});
