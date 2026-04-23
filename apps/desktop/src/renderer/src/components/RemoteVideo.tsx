import React, { useEffect, useRef, type PointerEvent, type ReactElement, type RefObject } from "react";
import type { ControlMessage } from "@remote-control/shared";

import { isInputCaptureExitShortcut, isKeyboardShortcut } from "../hotkeys";

export function RemoteVideo({
  videoRef,
  controlEnabled,
  disconnectShortcut,
  inputCaptureEnabled,
  receiveAudio,
  switchMonitorShortcut,
  onControl,
  onDisconnectShortcut,
  onInputCaptureChange,
  onSwitchMonitorShortcut,
  onToggleFullscreen
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  controlEnabled: boolean;
  disconnectShortcut: string;
  inputCaptureEnabled: boolean;
  receiveAudio: boolean;
  switchMonitorShortcut: string;
  onControl: (message: ControlMessage) => void;
  onDisconnectShortcut: () => void;
  onInputCaptureChange: (enabled: boolean) => void;
  onSwitchMonitorShortcut: () => void;
  onToggleFullscreen: () => void;
}): ReactElement {
  const virtualPointerRef = useRef({
    x: 0,
    y: 0,
    screenWidth: 0,
    screenHeight: 0
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.muted = !receiveAudio;
    video.volume = receiveAudio ? 1 : 0;
  }, [receiveAudio, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!controlEnabled || !inputCaptureEnabled || !video) {
      return;
    }

    const screenWidth = video.videoWidth || Math.round(video.getBoundingClientRect().width);
    const screenHeight = video.videoHeight || Math.round(video.getBoundingClientRect().height);
    virtualPointerRef.current = {
      x: Math.round(screenWidth / 2),
      y: Math.round(screenHeight / 2),
      screenWidth,
      screenHeight
    };

    video.focus();
    try {
      video.requestPointerLock();
    } catch {
      // Pointer lock can require a user gesture in some environments.
    }

    const keyboard = navigator as Navigator & {
      keyboard?: {
        lock?: () => Promise<void>;
        unlock?: () => void;
      };
    };
    void keyboard.keyboard?.lock?.();

    const handlePointerMove = (event: MouseEvent): void => {
      if (document.pointerLockElement !== video) {
        return;
      }

      const current = virtualPointerRef.current;
      const next = {
        x: clamp(current.x + event.movementX, 0, current.screenWidth),
        y: clamp(current.y + event.movementY, 0, current.screenHeight),
        screenWidth: current.screenWidth,
        screenHeight: current.screenHeight
      };
      virtualPointerRef.current = next;
      onControl({ kind: "pointer", event: { type: "move", ...next } });
    };

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      onControl({ kind: "pointer", event: { type: "scroll", deltaX: event.deltaX, deltaY: event.deltaY } });
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (isInputCaptureExitShortcut(event)) {
        onInputCaptureChange(false);
        return;
      }
      if (isKeyboardShortcut(event, disconnectShortcut)) {
        onDisconnectShortcut();
        return;
      }
      if (isKeyboardShortcut(event, switchMonitorShortcut)) {
        onSwitchMonitorShortcut();
        return;
      }

      if (!event.repeat) {
        onControl({ kind: "keyboard", event: { type: "keyDown", code: event.code, key: event.key } });
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (isInputCaptureExitShortcut(event)) {
        return;
      }

      onControl({ kind: "keyboard", event: { type: "keyUp", code: event.code, key: event.key } });
    };

    const handlePointerLockChange = (): void => {
      if (document.pointerLockElement !== video) {
        onInputCaptureChange(false);
      }
    };

    document.addEventListener("mousemove", handlePointerMove);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      keyboard.keyboard?.unlock?.();
      if (document.pointerLockElement === video) {
        document.exitPointerLock();
      }
    };
  }, [
    controlEnabled,
    disconnectShortcut,
    inputCaptureEnabled,
    onControl,
    onDisconnectShortcut,
    onInputCaptureChange,
    onSwitchMonitorShortcut,
    switchMonitorShortcut,
    videoRef
  ]);

  function pointerPosition(event: PointerEvent<HTMLVideoElement>): {
    x: number;
    y: number;
    screenWidth: number;
    screenHeight: number;
  } {
    const video = event.currentTarget;
    const rect = video.getBoundingClientRect();
    const screenWidth = video.videoWidth || Math.round(rect.width);
    const screenHeight = video.videoHeight || Math.round(rect.height);

    return {
      x: Math.round(((event.clientX - rect.left) / rect.width) * screenWidth),
      y: Math.round(((event.clientY - rect.top) / rect.height) * screenHeight),
      screenWidth,
      screenHeight
    };
  }

  return (
    <video
      ref={videoRef}
      className={`desktop-video interactive${controlEnabled ? "" : " control-disabled"}${inputCaptureEnabled ? " input-captured" : ""}`}
      autoPlay
      playsInline
      muted={!receiveAudio}
      tabIndex={controlEnabled ? 0 : -1}
      onDoubleClick={() => onToggleFullscreen()}
      onContextMenu={(event) => event.preventDefault()}
      onPointerMove={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        onControl({ kind: "pointer", event: { type: "move", ...pointerPosition(event) } });
      }}
      onPointerDown={(event) => {
        if (!controlEnabled) return;
        event.currentTarget.focus();
        if (inputCaptureEnabled && document.pointerLockElement !== event.currentTarget) {
          try {
            event.currentTarget.requestPointerLock();
          } catch {
            // Pointer lock can require a user gesture in some environments.
          }
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        const pointer = inputCaptureEnabled ? virtualPointerRef.current : pointerPosition(event);
        onControl({
          kind: "pointer",
          event: { type: "click", button: mapPointerButton(event.button), ...pointer }
        });
      }}
      onWheel={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        onControl({ kind: "pointer", event: { type: "scroll", deltaX: event.deltaX, deltaY: event.deltaY } });
      }}
      onKeyDown={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        if (isKeyboardShortcut(event.nativeEvent, disconnectShortcut)) {
          event.preventDefault();
          onDisconnectShortcut();
          return;
        }
        if (isKeyboardShortcut(event.nativeEvent, switchMonitorShortcut)) {
          event.preventDefault();
          onSwitchMonitorShortcut();
          return;
        }
        if (event.repeat) return;
        onControl({ kind: "keyboard", event: { type: "keyDown", code: event.code, key: event.key } });
      }}
      onKeyUp={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        onControl({ kind: "keyboard", event: { type: "keyUp", code: event.code, key: event.key } });
      }}
    />
  );
}

function mapPointerButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
