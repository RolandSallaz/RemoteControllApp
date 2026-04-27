import { Controller, Get } from "@nestjs/common";
import type { DiscoveryResponse } from "@remote-control/shared";

import { DiscoveryService } from "./discovery.service.js";

@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get("discovery")
  getDiscovery(): DiscoveryResponse {
    return this.discovery.getDiscoveryResponse();
  }
}
