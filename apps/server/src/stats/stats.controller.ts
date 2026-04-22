import { Controller, Get } from "@nestjs/common";

import { SessionsService } from "../signaling/sessions.service.js";

@Controller()
export class StatsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get("stats")
  getStats(): { connectedClients: number; activeSessions: number } {
    return this.sessions.getStats();
  }
}
