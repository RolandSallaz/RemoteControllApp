import "reflect-metadata";

import { createServer } from "node:net";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

const defaultPort = 47315;
const portSearchLimit = 50;

async function bootstrap(): Promise<void> {
  const port = await findAvailablePort(getRequestedPort());
  process.env.PORT = String(port);

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",") ?? true,
      credentials: true
    }
  });

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? true,
    credentials: true
  });

  await app.listen(port);
  console.log(`RemoteControl signaling server listening on http://localhost:${port}`);
}

void bootstrap();

function getRequestedPort(): number {
  const port = Number(process.env.PORT ?? defaultPort);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : defaultPort;
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + portSearchLimit && port <= 65535; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available server port found from ${startPort} to ${Math.min(startPort + portSearchLimit - 1, 65535)}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const server = createServer();

    server.once("error", () => {
      resolvePort(false);
    });

    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });

    server.listen(port, "0.0.0.0");
  });
}
