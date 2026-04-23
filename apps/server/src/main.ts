import "reflect-metadata";

import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

export const defaultPort = 47315;
export const portSearchLimit = 50;

type CorsOrigin = string[] | true;

type NestAppLike = {
  enableCors: (options: { credentials: true; origin: CorsOrigin }) => void;
  listen: (port: number) => Promise<void>;
};

type PortProbeServerLike = {
  once(event: "error", listener: () => void): void;
  once(event: "listening", listener: () => void): void;
  close: (callback: () => void) => void;
  listen: (port: number, host: string) => void;
};

export function getRequestedPort(rawPort = process.env.PORT, fallbackPort = defaultPort): number {
  const port = Number(rawPort ?? fallbackPort);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallbackPort;
}

export function getCorsOrigin(rawCorsOrigin = process.env.CORS_ORIGIN): CorsOrigin {
  if (!rawCorsOrigin) {
    return true;
  }

  const origins = rawCorsOrigin
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : true;
}

export async function findAvailablePort(
  startPort: number,
  isPortAvailableFn: (port: number) => Promise<boolean> = isPortAvailable,
  searchLimit = portSearchLimit
): Promise<number> {
  for (let port = startPort; port < startPort + searchLimit && port <= 65535; port += 1) {
    if (await isPortAvailableFn(port)) {
      return port;
    }
  }

  throw new Error(
    `No available server port found from ${startPort} to ${Math.min(startPort + searchLimit - 1, 65535)}`
  );
}

export function isPortAvailable(
  port: number,
  createNetServer: () => PortProbeServerLike = createServer
): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createNetServer();

    server.once("error", () => {
      resolvePort(false);
    });

    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });

    server.listen(port, "0.0.0.0");
  });
}

export async function bootstrapServer(options: {
  corsOrigin?: CorsOrigin;
  createApp: (corsOptions: { credentials: true; origin: CorsOrigin }) => Promise<NestAppLike>;
  findAvailablePortFn?: (port: number) => Promise<number>;
  log?: (message: string) => void;
  requestedPort?: number;
  setPortEnv?: (port: number) => void;
}): Promise<number> {
  const port = await (options.findAvailablePortFn ?? findAvailablePort)(options.requestedPort ?? getRequestedPort());
  const corsOptions = {
    origin: options.corsOrigin ?? getCorsOrigin(),
    credentials: true as const
  };

  (options.setPortEnv ?? ((nextPort) => {
    process.env.PORT = String(nextPort);
  }))(port);

  const app = await options.createApp(corsOptions);
  app.enableCors(corsOptions);
  await app.listen(port);
  (options.log ?? ((message) => console.log(message)))(`RemoteControl signaling server listening on http://localhost:${port}`);

  return port;
}

export async function runServerMain(): Promise<number> {
  return await bootstrapServer({
    createApp: async (corsOptions) => await NestFactory.create(AppModule, {
      cors: corsOptions
    })
  });
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void runServerMain();
}
