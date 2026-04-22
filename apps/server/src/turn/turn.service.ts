import { Injectable } from "@nestjs/common";

import type { TurnConfigPayload, TurnCredentials } from "@remote-control/shared";

@Injectable()
export class TurnService {
  getIceConfig(): TurnConfigPayload {
    const iceServers: TurnCredentials[] = [
      {
        urls: this.parseList(process.env.STUN_URLS, ["stun:stun.l.google.com:19302"])
      }
    ];

    const turnUrls = this.parseList(process.env.TURN_URLS);
    if (turnUrls.length > 0) {
      iceServers.push({
        urls: turnUrls,
        username: process.env.TURN_USERNAME,
        credential: process.env.TURN_CREDENTIAL
      });
    }

    return { iceServers };
  }

  private parseList(value: string | undefined, fallback: string[] = []): string[] {
    if (!value) {
      return fallback;
    }

    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
