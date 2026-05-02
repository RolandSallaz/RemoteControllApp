import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyHostControlWithNut,
  applyKeyboardEvent,
  applyPointerEvent,
  loadFirstAvailableNutModule,
  mapKeyboardKey,
  mapMouseButton,
  movePointer
} from "./hostControl.js";

function createNutDouble() {
  const calls: string[] = [];

  class Point {
    constructor(public x: number, public y: number) {}
  }

  return {
    calls,
    nut: {
      mouse: {
        move: async (path: unknown) => {
          calls.push(`move:${JSON.stringify(path)}`);
        },
        click: async (button: unknown) => {
          calls.push(`click:${String(button)}`);
        },
        scrollDown: async (amount: number) => {
          calls.push(`scrollDown:${amount}`);
        },
        scrollUp: async (amount: number) => {
          calls.push(`scrollUp:${amount}`);
        },
        scrollLeft: async (amount: number) => {
          calls.push(`scrollLeft:${amount}`);
        },
        scrollRight: async (amount: number) => {
          calls.push(`scrollRight:${amount}`);
        }
      },
      keyboard: {
        pressKey: async (key: unknown) => {
          calls.push(`press:${String(key)}`);
        },
        releaseKey: async (key: unknown) => {
          calls.push(`release:${String(key)}`);
        },
        type: async (text: string) => {
          calls.push(`type:${text}`);
        }
      },
      Button: {
        LEFT: "LEFT",
        RIGHT: "RIGHT"
      },
      Key: {
        A: "A",
        Enter: "Enter",
        LeftAlt: "LeftAlt",
        LeftControl: "LeftControl",
        LeftShift: "LeftShift",
        LeftWin: "LeftWin",
        Num1: "Num1",
        Return: "Return",
        RightAlt: "RightAlt",
        RightControl: "RightControl",
        RightShift: "RightShift",
        RightWin: "RightWin"
      },
      Point,
      straightTo: (point: unknown) => ({ point })
    }
  };
}

test("movePointer prefers setPosition when the nut implementation provides it", async () => {
  const positioned: Array<{ x: number; y: number }> = [];
  const { nut } = createNutDouble();
  const mouse = {
    ...nut.mouse,
    setPosition: async (point: { x: number; y: number }) => {
      positioned.push({ x: point.x, y: point.y });
    }
  };

  await movePointer({ ...nut, mouse }, 12.4, 19.6);

  assert.deepEqual(positioned, [{ x: 12, y: 20 }]);
});

test("pointer control maps clicks and scroll deltas", async () => {
  const { nut, calls } = createNutDouble();

  await applyPointerEvent(nut, {
    type: "click",
    button: "right",
    x: 10,
    y: 20
  });
  await applyPointerEvent(nut, {
    type: "scroll",
    deltaX: -2.4,
    deltaY: 3.6,
    x: 10,
    y: 20
  });

  assert.deepEqual(calls, [
    "move:{\"point\":{\"x\":10,\"y\":20}}",
    "click:RIGHT",
    "scrollDown:4",
    "scrollLeft:2"
  ]);
  assert.equal(mapMouseButton(nut, "middle"), "LEFT");
});

test("keyboard control types text and maps keys from code and key name", async () => {
  const { nut, calls } = createNutDouble();

  await applyKeyboardEvent(nut, {
    type: "typeText",
    text: "hello"
  });
  await applyKeyboardEvent(nut, {
    type: "keyDown",
    key: "a",
    code: "KeyA"
  });
  await applyHostControlWithNut(nut, {
    kind: "keyboard",
    event: {
      type: "keyUp",
      key: "Enter",
      code: "Enter"
    }
  });

  assert.deepEqual(calls, [
    "type:hello",
    "press:A",
    "release:Return"
  ]);
  assert.equal(mapKeyboardKey(nut, "a", "KeyA"), "A");
});

test("keyboard control maps browser modifier and system key codes", () => {
  const { nut } = createNutDouble();

  assert.equal(mapKeyboardKey(nut, "Control", "ControlLeft"), "LeftControl");
  assert.equal(mapKeyboardKey(nut, "Control", "ControlRight"), "RightControl");
  assert.equal(mapKeyboardKey(nut, "Alt", "AltLeft"), "LeftAlt");
  assert.equal(mapKeyboardKey(nut, "Alt", "AltRight"), "RightAlt");
  assert.equal(mapKeyboardKey(nut, "Shift", "ShiftLeft"), "LeftShift");
  assert.equal(mapKeyboardKey(nut, "Shift", "ShiftRight"), "RightShift");
  assert.equal(mapKeyboardKey(nut, "Meta", "MetaLeft"), "LeftWin");
  assert.equal(mapKeyboardKey(nut, "Meta", "MetaRight"), "RightWin");
  assert.equal(mapKeyboardKey(nut, "1", "Digit1"), "Num1");
});

test("loadFirstAvailableNutModule falls back across candidates and surfaces all errors", async () => {
  const attempted: string[] = [];

  const loaded = await loadFirstAvailableNutModule(async (specifier) => {
    attempted.push(specifier);
    if (specifier === "fallback") {
      return createNutDouble().nut;
    }

    throw new Error(`missing ${specifier}`);
  }, ["primary", "fallback"]);

  assert.deepEqual(attempted, ["primary", "fallback"]);
  assert.equal(typeof loaded.keyboard.type, "function");

  await assert.rejects(
    () => loadFirstAvailableNutModule(async (specifier) => {
      throw new Error(`missing ${specifier}`);
    }, ["first", "second"]),
    /first: missing first; second: missing second/
  );
});
