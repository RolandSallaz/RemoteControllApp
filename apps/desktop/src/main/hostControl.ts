import type { ControlKeyboardEvent, ControlMessage, ControlPointerEvent } from "@remote-control/shared";

type NutModule = {
  mouse: {
    move: (path: unknown) => Promise<void>;
    click: (button: unknown) => Promise<void>;
    scrollDown?: (amount: number) => Promise<void>;
    scrollUp?: (amount: number) => Promise<void>;
    scrollLeft?: (amount: number) => Promise<void>;
    scrollRight?: (amount: number) => Promise<void>;
  };
  keyboard: {
    pressKey: (key: unknown) => Promise<void>;
    releaseKey: (key: unknown) => Promise<void>;
    type: (text: string) => Promise<void>;
  };
  Button: Record<string, unknown>;
  Key: Record<string, unknown>;
  Point: new (x: number, y: number) => unknown;
  straightTo: (point: unknown) => unknown;
};

const dynamicImport = new Function("specifier", "return import(specifier)") as (
  specifier: string
) => Promise<NutModule>;
const nutModuleCandidates = ["@nut-tree/nut-js", "@nut-tree-fork/nut-js"] as const;

let nutPromise: Promise<NutModule> | undefined;

export async function applyHostControl(message: ControlMessage): Promise<void> {
  const nut = await loadNut();
  await applyHostControlWithNut(nut, message);
}

export async function applyHostControlWithNut(nut: NutModule, message: ControlMessage): Promise<void> {
  if (message.kind === "pointer") {
    await applyPointerEvent(nut, message.event);
    return;
  }

  await applyKeyboardEvent(nut, message.event);
}

export async function applyPointerEvent(nut: NutModule, event: ControlPointerEvent): Promise<void> {
  if (event.type === "move") {
    await movePointer(nut, event.x, event.y);
    return;
  }

  if (event.type === "click") {
    await movePointer(nut, event.x, event.y);
    await nut.mouse.click(mapMouseButton(nut, event.button));
    return;
  }

  const verticalAmount = Math.round(Math.abs(event.deltaY));
  const horizontalAmount = Math.round(Math.abs(event.deltaX));

  if (event.deltaY > 0 && nut.mouse.scrollDown) {
    await nut.mouse.scrollDown(verticalAmount);
  } else if (event.deltaY < 0 && nut.mouse.scrollUp) {
    await nut.mouse.scrollUp(verticalAmount);
  }

  if (event.deltaX > 0 && nut.mouse.scrollRight) {
    await nut.mouse.scrollRight(horizontalAmount);
  } else if (event.deltaX < 0 && nut.mouse.scrollLeft) {
    await nut.mouse.scrollLeft(horizontalAmount);
  }
}

export async function applyKeyboardEvent(nut: NutModule, event: ControlKeyboardEvent): Promise<void> {
  if (event.type === "typeText") {
    await nut.keyboard.type(event.text);
    return;
  }

  const key = mapKeyboardKey(nut, event.key, event.code);
  if (!key) {
    return;
  }

  if (event.type === "keyDown") {
    await nut.keyboard.pressKey(key);
    return;
  }

  await nut.keyboard.releaseKey(key);
}

export async function movePointer(nut: NutModule, x: number, y: number): Promise<void> {
  const point = new nut.Point(Math.round(x), Math.round(y));
  if ("setPosition" in nut.mouse && typeof (nut.mouse as { setPosition?: unknown }).setPosition === "function") {
    await (nut.mouse as { setPosition: (p: unknown) => Promise<void> }).setPosition(point);
  } else {
    await nut.mouse.move(nut.straightTo(point));
  }
}

export function mapMouseButton(nut: NutModule, button: "left" | "middle" | "right"): unknown {
  const key = button.toUpperCase();
  return nut.Button[key] ?? nut.Button.LEFT;
}

export function mapKeyboardKey(nut: NutModule, key: string, code: string): unknown {
  for (const candidate of getKeyboardKeyCandidates(key, code)) {
    const mapped = nut.Key[candidate];
    if (mapped !== undefined) {
      return mapped;
    }
  }

  return undefined;
}

function getKeyboardKeyCandidates(key: string, code: string): string[] {
  if (code.startsWith("Key")) {
    return [code.slice(3).toUpperCase()];
  }

  if (code.startsWith("Digit")) {
    return [`Num${code.slice(5)}`, code.slice(5)];
  }

  if (/^F\d{1,2}$/.test(code)) {
    return [code];
  }

  const mappedCode = keyboardCodeMap[code];
  const candidates = Array.isArray(mappedCode) ? mappedCode : mappedCode ? [mappedCode] : [];
  const normalizedKey = key.length === 1 ? key.toUpperCase() : key;
  const upperKey = key.toUpperCase();

  return [
    ...candidates,
    normalizedKey,
    upperKey
  ];
}

const keyboardCodeMap: Record<string, string | string[]> = {
  AltLeft: "LeftAlt",
  AltRight: "RightAlt",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  AudioVolumeDown: "AudioVolDown",
  AudioVolumeMute: "AudioMute",
  AudioVolumeUp: "AudioVolUp",
  Backquote: "Grave",
  Backslash: "Backslash",
  Backspace: "Backspace",
  BracketLeft: "LeftBracket",
  BracketRight: "RightBracket",
  CapsLock: "CapsLock",
  Comma: "Comma",
  ContextMenu: "Menu",
  ControlLeft: "LeftControl",
  ControlRight: "RightControl",
  Delete: "Delete",
  End: "End",
  Enter: ["Return", "Enter"],
  Equal: "Equal",
  Escape: "Escape",
  Fn: "Fn",
  Home: "Home",
  Insert: "Insert",
  MediaPlayPause: "AudioPlay",
  MediaTrackNext: "AudioNext",
  MediaTrackPrevious: "AudioPrev",
  MetaLeft: ["LeftWin", "LeftMeta", "LeftSuper", "LeftCmd"],
  MetaRight: ["RightWin", "RightMeta", "RightSuper", "RightCmd"],
  Minus: "Minus",
  NumLock: "NumLock",
  Numpad0: "NumPad0",
  Numpad1: "NumPad1",
  Numpad2: "NumPad2",
  Numpad3: "NumPad3",
  Numpad4: "NumPad4",
  Numpad5: "NumPad5",
  Numpad6: "NumPad6",
  Numpad7: "NumPad7",
  Numpad8: "NumPad8",
  Numpad9: "NumPad9",
  NumpadAdd: "Add",
  NumpadDecimal: "Decimal",
  NumpadDivide: "Divide",
  NumpadEnter: "Enter",
  NumpadEqual: "NumPadEqual",
  NumpadMultiply: "Multiply",
  NumpadSubtract: "Subtract",
  PageDown: "PageDown",
  PageUp: "PageUp",
  Pause: "Pause",
  Period: "Period",
  PrintScreen: "Print",
  Quote: "Quote",
  ScrollLock: "ScrollLock",
  Semicolon: "Semicolon",
  ShiftLeft: "LeftShift",
  ShiftRight: "RightShift",
  Slash: "Slash",
  Space: "Space",
  Tab: "Tab"
};

function loadNut(): Promise<NutModule> {
  nutPromise ??= loadFirstAvailableNutModule().catch((error: unknown) => {
    nutPromise = undefined;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`No nut.js-compatible package is available: ${reason}`);
  });

  return nutPromise;
}

export async function loadFirstAvailableNutModule(
  importer: (specifier: string) => Promise<NutModule> = dynamicImport,
  moduleCandidates: readonly string[] = nutModuleCandidates
): Promise<NutModule> {
  const errors: string[] = [];

  for (const moduleName of moduleCandidates) {
    try {
      return await importer(moduleName);
    } catch (error) {
      errors.push(`${moduleName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join("; "));
}
