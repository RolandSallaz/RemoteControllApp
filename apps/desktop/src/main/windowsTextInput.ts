import koffi from "koffi";

const inputKeyboard = 1;
const keyUp = 0x0002;
const unicode = 0x0004;

const keyboardInput = {
  wVk: "uint16_t",
  wScan: "uint16_t",
  dwFlags: "uint32_t",
  time: "uint32_t",
  dwExtraInfo: "uintptr_t"
};

function loadSendInput() {
  const input = koffi.struct({
    type: "uint32_t",
    data: koffi.union({
      ki: koffi.struct(keyboardInput),
      // The Windows INPUT union must also fit MOUSEINPUT.
      mi: koffi.struct({
        dx: "int32_t",
        dy: "int32_t",
        mouseData: "uint32_t",
        dwFlags: "uint32_t",
        time: "uint32_t",
        dwExtraInfo: "uintptr_t"
      })
    })
  });
  const sendInput = koffi.load("user32.dll").func("__stdcall", "SendInput", "uint32_t", [
    "uint32_t", koffi.pointer(input), "int"
  ]);
  return { sendInput, inputSize: koffi.sizeof(input) };
}

let windowsInput: ReturnType<typeof loadSendInput> | undefined;

type KeyboardInput = {
  wVk: number;
  wScan: number;
  dwFlags: number;
  time: number;
  dwExtraInfo: number;
};

function sendKeyboardInput(keys: KeyboardInput[]): void {
  windowsInput ??= loadSendInput();
  const inputs = keys.map((ki) => ({ type: inputKeyboard, data: { ki } }));
  const sent = windowsInput.sendInput(inputs.length, inputs, windowsInput.inputSize);
  if (sent !== inputs.length) {
    throw new Error("Windows rejected keyboard input");
  }
}

export function sendWindowsLetter(virtualKey: number, release: boolean): void {
  sendKeyboardInput([{ wVk: virtualKey, wScan: 0, dwFlags: release ? keyUp : 0, time: 0, dwExtraInfo: 0 }]);
}

export function typeWindowsText(text: string): void {
  if (!text.length) return;

  const keys: KeyboardInput[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const key = { wVk: 0, wScan: text.charCodeAt(index), time: 0, dwExtraInfo: 0 };
    keys.push({ ...key, dwFlags: unicode }, { ...key, dwFlags: unicode | keyUp });
  }

  sendKeyboardInput(keys);
}
