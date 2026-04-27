import { Module } from "@nestjs/common";

import { DiscoveryController } from "./discovery/discovery.controller.js";
import { DiscoveryService } from "./discovery/discovery.service.js";
import { SettingsController } from "./settings/settings.controller.js";
import { SettingsService } from "./settings/settings.service.js";
import { SignalingGateway } from "./signaling/signaling.gateway.js";
import { SessionsService } from "./signaling/sessions.service.js";
import { StatsController } from "./stats/stats.controller.js";
import { TurnService } from "./turn/turn.service.js";
import { WebClientController } from "./web-client/web-client.controller.js";

@Module({
  controllers: [DiscoveryController, SettingsController, StatsController, WebClientController],
  providers: [DiscoveryService, SettingsService, SignalingGateway, SessionsService, TurnService]
})
export class AppModule {}
