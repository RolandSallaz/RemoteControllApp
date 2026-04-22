import { Body, Controller, Get, Patch } from "@nestjs/common";
import type { HostSettings, UpdateHostSettingsPayload } from "@remote-control/shared";

import { SettingsService } from "./settings.service.js";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("host")
  async getHostSettings(): Promise<HostSettings> {
    return sanitizeHostSettings(await this.settings.getHostSettings());
  }

  @Patch("host")
  async updateHostSettings(@Body() payload: UpdateHostSettingsPayload): Promise<HostSettings> {
    return sanitizeHostSettings(await this.settings.updateHostSettings(payload));
  }
}

function sanitizeHostSettings(settings: HostSettings): HostSettings {
  const { accessPassword: _accessPassword, ...safeSettings } = settings;
  return safeSettings;
}
