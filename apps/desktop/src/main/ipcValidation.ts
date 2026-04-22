import type { ControlMessage } from "@remote-control/shared";

export type ViewerSettingsPatch = {
  captureLocalInput?: boolean;
  connectInFullscreen?: boolean;
  disconnectShortcut?: string;
  frameRate?: 15 | 30 | 60;
  receiveAudio?: boolean;
  switchMonitorShortcut?: string;
};

export type HostPresencePayload = {
  connected: boolean;
  viewerName?: string;
};

export type IncomingFileTransferStartPayload = {
  transferId: string;
  name: string;
  size: number;
};

export type IncomingFileTransferAppendPayload = {
  transferId: string;
  index: number;
  bytes: Uint8Array;
};

export const maxIncomingFileTransferBytes = 256 * 1024 * 1024;
export const maxIncomingFileChunkBytes = 64 * 1024;

const maxFileNameLength = 260;
const maxKeyboardTextLength = 4096;
const maxPasswordLength = 256;
const maxPathLength = 2048;
const maxShortcutLength = 64;
const maxTransferIdLength = 80;

export function sanitizeControlMessage(value: unknown): ControlMessage | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }

  if (value.kind === "pointer") {
    return sanitizePointerMessage(value);
  }

  if (value.kind === "keyboard") {
    return sanitizeKeyboardMessage(value);
  }

  return undefined;
}

export function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function sanitizeHostAccessPasswordInput(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > maxPasswordLength) {
    return undefined;
  }

  return value;
}

export function sanitizeHostPresencePayload(value: unknown): HostPresencePayload | undefined {
  if (!isRecord(value) || typeof value.connected !== "boolean") {
    return undefined;
  }

  const viewerName = sanitizeString(value.viewerName, 80);
  return {
    connected: value.connected,
    ...(viewerName ? { viewerName } : {})
  };
}

export function sanitizeViewerSettingsPayload(value: unknown): ViewerSettingsPatch {
  if (!isRecord(value)) {
    return {};
  }

  const sanitized: ViewerSettingsPatch = {};
  if (typeof value.captureLocalInput === "boolean") {
    sanitized.captureLocalInput = value.captureLocalInput;
  }
  if (typeof value.connectInFullscreen === "boolean") {
    sanitized.connectInFullscreen = value.connectInFullscreen;
  }
  if (typeof value.disconnectShortcut === "string") {
    const shortcut = sanitizeString(value.disconnectShortcut, maxShortcutLength);
    if (shortcut) {
      sanitized.disconnectShortcut = shortcut;
    }
  }
  if (value.frameRate === 15 || value.frameRate === 30 || value.frameRate === 60) {
    sanitized.frameRate = value.frameRate;
  }
  if (typeof value.receiveAudio === "boolean") {
    sanitized.receiveAudio = value.receiveAudio;
  }
  if (typeof value.switchMonitorShortcut === "string") {
    const shortcut = sanitizeString(value.switchMonitorShortcut, maxShortcutLength);
    if (shortcut) {
      sanitized.switchMonitorShortcut = shortcut;
    }
  }

  return sanitized;
}

export function sanitizeServerUrl(value: unknown): string | undefined {
  const normalized = sanitizeString(value, maxPathLength);
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function sanitizeOptionalFilePath(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return sanitizeString(value, maxPathLength, false);
}

export function sanitizeTransferId(value: unknown): string | undefined {
  const normalized = sanitizeString(value, maxTransferIdLength);
  if (!normalized) {
    return undefined;
  }

  return /^[A-Za-z0-9._-]{1,80}$/.test(normalized) ? normalized : undefined;
}

export function sanitizeStartIncomingTransferPayload(value: unknown): IncomingFileTransferStartPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const transferId = sanitizeTransferId(value.transferId);
  const name = sanitizeString(value.name, maxFileNameLength, false);
  const size = value.size;
  if (
    !transferId
    || typeof name !== "string"
    || typeof size !== "number"
    || !Number.isInteger(size)
    || size < 0
    || size > maxIncomingFileTransferBytes
  ) {
    return undefined;
  }

  return { transferId, name, size };
}

export function sanitizeAppendIncomingTransferPayload(value: unknown): IncomingFileTransferAppendPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const transferId = sanitizeTransferId(value.transferId);
  const bytes = value.bytes;
  const index = value.index;
  if (
    !transferId
    || !(bytes instanceof Uint8Array)
    || bytes.byteLength > maxIncomingFileChunkBytes
    || typeof index !== "number"
    || !Number.isInteger(index)
    || index < 0
  ) {
    return undefined;
  }

  return { transferId, index, bytes };
}

function sanitizePointerMessage(value: Record<string, unknown>): ControlMessage | undefined {
  if (!isRecord(value.event) || typeof value.event.type !== "string") {
    return undefined;
  }

  if (value.event.type === "move") {
    const pointer = sanitizePointerCoordinates(value.event);
    return pointer ? { kind: "pointer", event: { type: "move", ...pointer } } : undefined;
  }

  if (value.event.type === "click") {
    const pointer = sanitizePointerCoordinates(value.event);
    const button = value.event.button;
    if (!pointer || (button !== "left" && button !== "middle" && button !== "right")) {
      return undefined;
    }

    return { kind: "pointer", event: { type: "click", button, ...pointer } };
  }

  if (value.event.type === "scroll" && isFiniteNumber(value.event.deltaX) && isFiniteNumber(value.event.deltaY)) {
    return {
      kind: "pointer",
      event: {
        type: "scroll",
        deltaX: clamp(value.event.deltaX, -5000, 5000),
        deltaY: clamp(value.event.deltaY, -5000, 5000)
      }
    };
  }

  return undefined;
}

function sanitizeKeyboardMessage(value: Record<string, unknown>): ControlMessage | undefined {
  if (!isRecord(value.event) || typeof value.event.type !== "string") {
    return undefined;
  }

  if (value.event.type === "typeText") {
    const text = sanitizeString(value.event.text, maxKeyboardTextLength, false);
    return typeof text === "string" ? { kind: "keyboard", event: { type: "typeText", text } } : undefined;
  }

  if (value.event.type !== "keyDown" && value.event.type !== "keyUp") {
    return undefined;
  }

  const code = sanitizeString(value.event.code, 64);
  const key = sanitizeString(value.event.key, 64, false);
  if (!code || typeof key !== "string") {
    return undefined;
  }

  return {
    kind: "keyboard",
    event: {
      type: value.event.type,
      code,
      key
    }
  };
}

function sanitizePointerCoordinates(value: Record<string, unknown>): {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
} | undefined {
  if (
    !isFiniteNumber(value.x)
    || !isFiniteNumber(value.y)
    || !isFiniteNumber(value.screenWidth)
    || !isFiniteNumber(value.screenHeight)
    || value.screenWidth <= 0
    || value.screenHeight <= 0
  ) {
    return undefined;
  }

  const screenWidth = Math.round(clamp(value.screenWidth, 1, 100_000));
  const screenHeight = Math.round(clamp(value.screenHeight, 1, 100_000));
  return {
    x: Math.round(clamp(value.x, 0, screenWidth)),
    y: Math.round(clamp(value.y, 0, screenHeight)),
    screenWidth,
    screenHeight
  };
}

function sanitizeString(value: unknown, maxLength: number, trim = true): string | undefined {
  if (typeof value !== "string" || value.length > maxLength) {
    return undefined;
  }

  const normalized = trim ? value.trim() : value;
  return normalized.length <= maxLength ? normalized : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
