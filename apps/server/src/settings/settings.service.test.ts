import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SettingsService } from "./settings.service.js";

test("SettingsService stores host passwords as scrypt hashes and verifies them", async () => {
  const previousPath = process.env.REMOTE_CONTROL_SETTINGS_PATH;
  const directory = await mkdtemp(join(tmpdir(), "remote-control-settings-"));
  const settingsPath = join(directory, "settings.json");

  try {
    process.env.REMOTE_CONTROL_SETTINGS_PATH = settingsPath;
    const service = new SettingsService();

    const settings = await service.updateHostSettings({
      accessPassword: "  secret  ",
      requireViewerApproval: false
    });
    const raw = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;

    assert.equal(settings.accessPassword, undefined);
    assert.equal(raw.accessPassword, undefined);
    assert.equal(typeof settings.accessPasswordHash, "string");
    assert.match(settings.accessPasswordHash ?? "", /^scrypt:v1\$/);
    assert.equal(await service.verifyHostPassword("secret"), true);
    assert.equal(await service.verifyHostPassword("wrong"), false);
  } finally {
    if (previousPath === undefined) {
      delete process.env.REMOTE_CONTROL_SETTINGS_PATH;
    } else {
      process.env.REMOTE_CONTROL_SETTINGS_PATH = previousPath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("SettingsService supports legacy plaintext password comparison without exposing it on updates", async () => {
  const previousPath = process.env.REMOTE_CONTROL_SETTINGS_PATH;
  const directory = await mkdtemp(join(tmpdir(), "remote-control-settings-"));
  const settingsPath = join(directory, "settings.json");

  try {
    process.env.REMOTE_CONTROL_SETTINGS_PATH = settingsPath;
    await writeFile(settingsPath, JSON.stringify({ accessPassword: "legacy" }), "utf8");

    const service = new SettingsService();
    assert.equal(await service.verifyHostPassword("legacy"), true);
    assert.equal(await service.verifyHostPassword("wrong"), false);

    const updated = await service.updateHostSettings({ requireViewerApproval: true });
    assert.equal(updated.accessPassword, undefined);
  } finally {
    if (previousPath === undefined) {
      delete process.env.REMOTE_CONTROL_SETTINGS_PATH;
    } else {
      process.env.REMOTE_CONTROL_SETTINGS_PATH = previousPath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
