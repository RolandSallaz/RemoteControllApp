import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Injectable } from "@nestjs/common";
import type { HostSettings, UpdateHostSettingsPayload } from "@remote-control/shared";

@Injectable()
export class SettingsService {
  private readonly settingsPath = resolve(process.env.REMOTE_CONTROL_SETTINGS_PATH ?? "settings.json");

  async getHostSettings(): Promise<HostSettings> {
    return await this.readSettings();
  }

  async updateHostSettings(payload: UpdateHostSettingsPayload): Promise<HostSettings> {
    const current = await this.readSettings();
    const next: HostSettings = {
      ...current,
      ...payload
    };

    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(next, null, 2), "utf8");

    return next;
  }

  private async readSettings(): Promise<HostSettings> {
    try {
      if (!existsSync(this.settingsPath)) {
        return {};
      }

      const raw = await readFile(this.settingsPath, "utf8");
      return JSON.parse(raw) as HostSettings;
    } catch {
      return {};
    }
  }
}
