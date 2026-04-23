import React, { type CSSProperties, type ReactElement } from "react";

import type { EmbeddedBackendStatus } from "../env";
import { hotkeyFromKeyboardEvent } from "../hotkeys";

export function ServerStatusBadge({ status }: { status: EmbeddedBackendStatus["status"] }): ReactElement {
  const map: Record<EmbeddedBackendStatus["status"], { label: string; cls: string }> = {
    running: { label: "Running", cls: "badge-running" },
    starting: { label: "Starting", cls: "badge-starting" },
    stopped: { label: "Stopped", cls: "badge-stopped" },
    error: { label: "Error", cls: "badge-error" },
    disabled: { label: "Disabled", cls: "badge-stopped" }
  };
  const { label, cls } = map[status];
  return <span className={`server-badge ${cls}`}>{label}</span>;
}

export function VideoEmpty({
  icon,
  title,
  sub
}: {
  icon: string;
  title: string;
  sub: string;
}): ReactElement {
  return (
    <div className="video-empty">
      <div className="video-empty-icon">{icon}</div>
      <div className="video-empty-title">{title}</div>
      <div className="video-empty-sub">{sub}</div>
    </div>
  );
}

export function HotkeyField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (shortcut: string) => void;
}): ReactElement {
  return (
    <div className="field hotkey-field">
      <label>{label}</label>
      <div className="hotkey-input-row">
        <input
          readOnly
          value={value}
          placeholder="Click and press shortcut"
          onKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === "Backspace" || event.key === "Delete") {
              onChange("");
              return;
            }

            const shortcut = hotkeyFromKeyboardEvent(event.nativeEvent);
            if (shortcut) {
              onChange(shortcut);
            }
          }}
        />
        <button type="button" className="btn-icon" onClick={() => onChange("")} aria-label={`Clear ${label}`}>
          X
        </button>
      </div>
    </div>
  );
}

export function SettingsToggle({
  checked,
  onChange,
  label,
  sub
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  sub?: string;
}): ReactElement {
  return (
    <label className="settings-toggle-row">
      <div className="settings-toggle-text">
        <span className="settings-toggle-label">{label}</span>
        {sub && <span className="settings-toggle-sub">{sub}</span>}
      </div>
      <div className="settings-switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="settings-switch-track" aria-hidden="true" />
      </div>
    </label>
  );
}

export function HotkeysPanel({
  disconnectShortcut,
  switchMonitorShortcut,
  onClose,
  style,
  variant = "dialog"
}: {
  disconnectShortcut: string;
  switchMonitorShortcut: string;
  onClose?: () => void;
  style?: CSSProperties;
  variant?: "dialog" | "popover";
}): ReactElement {
  const rows: [string, string][] = [
    [disconnectShortcut, "Disconnect"],
    [switchMonitorShortcut, "Switch monitor"],
    ["Ctrl+Alt+Shift+Esc", "Exit input capture"],
    ["F11", "Toggle fullscreen"],
    ["?", "Show / hide shortcuts"]
  ];

  return (
    <div
      className={`hotkeys-panel${variant === "popover" ? " hotkeys-panel-popover" : ""}`}
      role={variant === "popover" ? "tooltip" : "dialog"}
      aria-label="Keyboard shortcuts"
      style={style}
    >
      <div className="hotkeys-header">
        <span className="section-label" style={{ margin: 0 }}>Keyboard Shortcuts</span>
        {onClose && (
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">X</button>
        )}
      </div>
      <div className="hotkeys-body">
        {rows.map(([keys, label]) => (
          <div key={label} className="hotkeys-row">
            <kbd className="hotkeys-kbd">{keys}</kbd>
            <span className="hotkeys-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
