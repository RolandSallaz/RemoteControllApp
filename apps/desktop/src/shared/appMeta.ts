export type DesktopAppMode = "combined" | "host" | "viewer";

export function normalizeAppMode(value: string): DesktopAppMode {
  if (value === "host" || value === "viewer") {
    return value;
  }

  return "combined";
}

export function getProductName(mode: DesktopAppMode): string {
  if (mode === "host") {
    return "RemoteControl Server";
  }

  if (mode === "viewer") {
    return "RemoteControl Client";
  }

  return "RemoteControl";
}
