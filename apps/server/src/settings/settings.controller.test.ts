import assert from "node:assert/strict";
import { test } from "node:test";

import type { SettingsService } from "./settings.service.js";
import { SettingsController } from "./settings.controller.js";

test("SettingsController rejects host settings access without the internal token", async () => {
  const previousToken = process.env.REMOTE_CONTROL_SETTINGS_TOKEN;
  process.env.REMOTE_CONTROL_SETTINGS_TOKEN = "internal-token";

  try {
    const controller = new SettingsController({
      getHostSettings: async () => ({ requireViewerApproval: true }),
      updateHostSettings: async () => ({ requireViewerApproval: false })
    } as unknown as SettingsService);

    await assert.rejects(() => controller.getHostSettings(undefined), /trusted host app/);
    await assert.rejects(() => controller.updateHostSettings("wrong-token", {}), /trusted host app/);
    assert.deepEqual(await controller.getHostSettings("internal-token"), {
      accessPasswordSet: false,
      launchOnStartup: undefined,
      requireViewerApproval: true,
      saveDirectory: undefined
    });
  } finally {
    if (previousToken === undefined) {
      delete process.env.REMOTE_CONTROL_SETTINGS_TOKEN;
    } else {
      process.env.REMOTE_CONTROL_SETTINGS_TOKEN = previousToken;
    }
  }
});

test("SettingsController sanitizes password fields and defaults approval on reads and writes", async () => {
  const previousToken = process.env.REMOTE_CONTROL_SETTINGS_TOKEN;
  process.env.REMOTE_CONTROL_SETTINGS_TOKEN = "internal-token";

  try {
    const controller = new SettingsController({
      getHostSettings: async () => ({
        accessPassword: "legacy-secret",
        accessPasswordHash: "scrypt:v1$salt$key",
        launchOnStartup: true,
        saveDirectory: "C:\\RemoteControl"
      }),
      updateHostSettings: async () => ({
        accessPasswordHash: "scrypt:v1$salt$key",
        requireViewerApproval: false,
        saveDirectory: "D:\\Incoming"
      })
    } as unknown as SettingsService);

    assert.deepEqual(await controller.getHostSettings("internal-token"), {
      accessPasswordSet: true,
      launchOnStartup: true,
      requireViewerApproval: true,
      saveDirectory: "C:\\RemoteControl"
    });

    assert.deepEqual(await controller.updateHostSettings("internal-token", { requireViewerApproval: false }), {
      accessPasswordSet: true,
      launchOnStartup: undefined,
      requireViewerApproval: false,
      saveDirectory: "D:\\Incoming"
    });
  } finally {
    if (previousToken === undefined) {
      delete process.env.REMOTE_CONTROL_SETTINGS_TOKEN;
    } else {
      process.env.REMOTE_CONTROL_SETTINGS_TOKEN = previousToken;
    }
  }
});
