import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { Injectable } from "@nestjs/common";
import type { HostSettings, UpdateHostSettingsPayload } from "@remote-control/shared";

const scrypt = promisify(scryptCallback);
const passwordHashPrefix = "scrypt:v1";
const passwordSaltBytes = 16;
const passwordKeyBytes = 32;

@Injectable()
export class SettingsService {
  private readonly settingsPath = resolve(process.env.REMOTE_CONTROL_SETTINGS_PATH ?? "settings.json");

  async getHostSettings(): Promise<HostSettings> {
    return await this.readSettings();
  }

  async updateHostSettings(payload: UpdateHostSettingsPayload): Promise<HostSettings> {
    const current = await this.readSettings();
    const sanitizedPayload = await sanitizeHostSettingsPayload(payload);
    const next: HostSettings = {
      ...current,
      ...sanitizedPayload
    };
    delete next.accessPassword;

    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(next, null, 2), "utf8");

    return next;
  }

  async verifyHostPassword(password?: string): Promise<boolean> {
    const settings = await this.readSettings();
    const accessPasswordHash = settings.accessPasswordHash;
    if (accessPasswordHash) {
      return typeof password === "string" && await verifyAccessPassword(password, accessPasswordHash);
    }

    const legacyPassword = settings.accessPassword?.trim();
    if (!legacyPassword) {
      return true;
    }

    return typeof password === "string" && safeEqual(password, legacyPassword);
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

async function sanitizeHostSettingsPayload(payload: UpdateHostSettingsPayload): Promise<UpdateHostSettingsPayload> {
  const sanitized: UpdateHostSettingsPayload = {};
  if (!payload || typeof payload !== "object") {
    return sanitized;
  }

  if (typeof payload.launchOnStartup === "boolean") {
    sanitized.launchOnStartup = payload.launchOnStartup;
  }
  if (typeof payload.requireViewerApproval === "boolean") {
    sanitized.requireViewerApproval = payload.requireViewerApproval;
  }
  if (typeof payload.saveDirectory === "string") {
    sanitized.saveDirectory = payload.saveDirectory.trim();
  }
  if (Object.hasOwn(payload, "accessPassword") && typeof payload.accessPassword === "string") {
    const normalizedPassword = payload.accessPassword.trim();
    sanitized.accessPasswordHash = normalizedPassword
      ? await hashAccessPassword(normalizedPassword)
      : undefined;
  }

  return sanitized;
}

async function hashAccessPassword(password: string): Promise<string> {
  const salt = randomBytes(passwordSaltBytes);
  const derivedKey = await scrypt(password, salt, passwordKeyBytes) as Buffer;
  return [
    passwordHashPrefix,
    Buffer.from(salt).toString("base64"),
    derivedKey.toString("base64")
  ].join("$");
}

async function verifyAccessPassword(password: string, storedHash: string): Promise<boolean> {
  const [prefix, saltBase64, keyBase64] = storedHash.split("$");
  if (prefix !== passwordHashPrefix || !saltBase64 || !keyBase64) {
    return false;
  }

  const expectedKey = Buffer.from(keyBase64, "base64");
  const salt = Buffer.from(saltBase64, "base64");
  const actualKey = await scrypt(password, salt, expectedKey.byteLength) as Buffer;
  return safeEqualBuffers(actualKey, expectedKey);
}

function safeEqual(a: string, b: string): boolean {
  return safeEqualBuffers(Buffer.from(a), Buffer.from(b));
}

function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  return timingSafeEqual(a, b);
}
