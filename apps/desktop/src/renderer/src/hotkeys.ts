export function isInputCaptureExitShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && event.altKey && event.shiftKey && event.code === "Escape";
}

export function isKeyboardShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const current = hotkeyFromKeyboardEvent(event);
  return Boolean(current && normalizeHotkey(current) === normalizeHotkey(shortcut));
}

export function hotkeyFromKeyboardEvent(event: KeyboardEvent): string | undefined {
  const key = hotkeyKeyLabel(event);
  if (!key) {
    return undefined;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select") ||
    target.isContentEditable
  );
}

function hotkeyKeyLabel(event: KeyboardEvent): string | undefined {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
    return undefined;
  }

  if (event.code.startsWith("Key")) {
    return event.code.slice(3).toUpperCase();
  }

  if (event.code.startsWith("Digit")) {
    return event.code.slice(5);
  }

  if (/^F\d{1,2}$/.test(event.code)) {
    return event.code;
  }

  const map: Record<string, string> = {
    Backquote: "`",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Comma: ",",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Equal: "=",
    Escape: "Esc",
    Home: "Home",
    Insert: "Insert",
    Minus: "-",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Period: ".",
    Quote: "'",
    Semicolon: ";",
    Slash: "/",
    Space: "Space",
    Tab: "Tab"
  };

  return map[event.code] ?? event.key;
}

function normalizeHotkey(shortcut: string): string {
  return shortcut.replace(/\s+/g, "").replace(/\bEsc\b/gi, "Escape").toLowerCase();
}
