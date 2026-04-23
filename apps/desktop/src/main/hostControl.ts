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

  if (message.kind === "pointer") {
    await applyPointerEvent(nut, message.event);
    return;
  }

  await applyKeyboardEvent(nut, message.event);
}

async function applyPointerEvent(nut: NutModule, event: ControlPointerEvent): Promise<void> {
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

async function applyKeyboardEvent(nut: NutModule, event: ControlKeyboardEvent): Promise<void> {
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

async function movePointer(nut: NutModule, x: number, y: number): Promise<void> {
  const point = new nut.Point(Math.round(x), Math.round(y));
  if ("setPosition" in nut.mouse && typeof (nut.mouse as { setPosition?: unknown }).setPosition === "function") {
    await (nut.mouse as { setPosition: (p: unknown) => Promise<void> }).setPosition(point);
  } else {
    await nut.mouse.move(nut.straightTo(point));
  }
}

function mapMouseButton(nut: NutModule, button: "left" | "middle" | "right"): unknown {
  const key = button.toUpperCase();
  return nut.Button[key] ?? nut.Button.LEFT;
}

function mapKeyboardKey(nut: NutModule, key: string, code: string): unknown {
  const normalized = code.replace(/^Key/, "").replace(/^Digit/, "");
  return nut.Key[normalized] ?? nut.Key[key.toUpperCase()] ?? nut.Key[key];
}

function loadNut(): Promise<NutModule> {
  nutPromise ??= loadFirstAvailableNutModule().catch((error: unknown) => {
    nutPromise = undefined;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`No nut.js-compatible package is available: ${reason}`);
  });

  return nutPromise;
}

async function loadFirstAvailableNutModule(): Promise<NutModule> {
  const errors: string[] = [];

  for (const moduleName of nutModuleCandidates) {
    try {
      return await dynamicImport(moduleName);
    } catch (error) {
      errors.push(`${moduleName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join("; "));
}
