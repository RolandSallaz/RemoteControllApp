import { Body, Controller, Get, Headers, Patch, UnauthorizedException } from "@nestjs/common";
import type { HostSettings, UpdateHostSettingsPayload } from "@remote-control/shared";

import { SettingsService } from "./settings.service.js";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("host")
  async getHostSettings(@Headers("x-remote-control-settings-token") token?: string): Promise<HostSettings> {
    assertSettingsAccess(token);
    return sanitizeHostSettings(await this.settings.getHostSettings());
  }

  @Patch("host")
  async updateHostSettings(
    @Headers("x-remote-control-settings-token") token: string | undefined,
    @Body() payload: UpdateHostSettingsPayload
  ): Promise<HostSettings> {
    assertSettingsAccess(token);
    return sanitizeHostSettings(await this.settings.updateHostSettings(payload));
  }
}

function sanitizeHostSettings(settings: HostSettings): HostSettings {
  return {
    accessPasswordSet: Boolean(settings.accessPasswordHash || settings.accessPassword),
    launchOnStartup: settings.launchOnStartup,
    requireViewerApproval: settings.requireViewerApproval ?? true,
    saveDirectory: settings.saveDirectory
  };
}

function assertSettingsAccess(token?: string): void {
  const expectedToken = process.env.REMOTE_CONTROL_SETTINGS_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    throw new UnauthorizedException("Host settings are available only through the trusted host app");
  }
}
