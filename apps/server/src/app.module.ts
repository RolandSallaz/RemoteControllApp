import { Module } from "@nestjs/common";

import { DiscoveryService } from "./discovery/discovery.service.js";
import { SettingsController } from "./settings/settings.controller.js";
import { SettingsService } from "./settings/settings.service.js";
import { SignalingGateway } from "./signaling/signaling.gateway.js";
import { SessionsService } from "./signaling/sessions.service.js";
import { StatsController } from "./stats/stats.controller.js";
import { TurnService } from "./turn/turn.service.js";

@Module({
  controllers: [SettingsController, StatsController],
  providers: [DiscoveryService, SettingsService, SignalingGateway, SessionsService, TurnService]
})
export class AppModule {}
