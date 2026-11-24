import React, { useEffect, useEffectEvent, useRef, type PointerEvent, type ReactElement, type RefObject } from "react";
import type { ControlMessage } from "@remote-control/shared";

import { isInputCaptureExitShortcut, isKeyboardShortcut } from "../hotkeys";

export function RemoteVideo({
  activeSourceId,
  videoRef,
  controlEnabled,
  disconnectShortcut,
  inputCaptureEnabled,
  receiveAudio,
  switchMonitorShortcut,
  onControl,
  onDisconnectShortcut,
  onInputCaptureChange,
  onSwitchMonitorShortcut
}: {
  activeSourceId?: string;
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
}): ReactElement {
  const activeSourceIdRef = useRef<string | undefined>(activeSourceId);
  const pressedKeysRef = useRef(new Map<string, { code: string; key: string }>());
  const pressedButtonsRef = useRef(new Set<"left" | "middle" | "right">());
  const virtualPointerRef = useRef({
    x: 0,
    y: 0,
    screenWidth: 0,
    screenHeight: 0
  });

  const sendCapturedControl = useEffectEvent(onControl);
  const exitInputCapture = useEffectEvent(() => onInputCaptureChange(false));

  useEffect(() => {
    activeSourceIdRef.current = activeSourceId;
  }, [activeSourceId]);

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
    if (!inputCaptureEnabled || !video) {
      return;
    }

    const resetVirtualPointer = (): void => {
      const screenWidth = video.videoWidth || Math.round(video.getBoundingClientRect().width);
      const screenHeight = video.videoHeight || Math.round(video.getBoundingClientRect().height);
      virtualPointerRef.current = {
        x: Math.round(screenWidth / 2),
        y: Math.round(screenHeight / 2),
        screenWidth,
        screenHeight
      };
    };

    resetVirtualPointer();
    video.addEventListener("loadedmetadata", resetVirtualPointer);
    return () => video.removeEventListener("loadedmetadata", resetVirtualPointer);
  }, [activeSourceId, inputCaptureEnabled, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!controlEnabled || !inputCaptureEnabled || !video) {
      return;
    }

    video.focus();
    const keyboard = (navigator as Navigator & {
      keyboard?: {
        lock?: () => Promise<void>;
        unlock?: () => void;
      };
    }).keyboard;
    let hadPointerLock = document.pointerLockElement === video;
    let requestingPointerLock = false;

    const requestKeyboardLock = async (): Promise<void> => {
      await keyboard?.lock?.();
    };

    const requestLocks = (): void => {
      void requestKeyboardLock().catch(() => undefined);
      if (document.pointerLockElement === video || requestingPointerLock) {
        return;
      }

      requestingPointerLock = true;
      void (async () => {
        try {
          await video.requestPointerLock({ unadjustedMovement: true });
        } catch {
          await video.requestPointerLock();
        }
      })().catch(() => undefined).finally(() => {
        requestingPointerLock = false;
      });
    };
    requestLocks();

    const releasePressedKeys = (): void => {
      for (const pressedKey of pressedKeysRef.current.values()) {
        sendCapturedControl({ kind: "keyboard", event: { type: "keyUp", ...pressedKey } });
      }
      pressedKeysRef.current.clear();
    };

    const releasePressedButtons = (): void => {
      for (const button of pressedButtonsRef.current) {
        sendCapturedControl({
          kind: "pointer",
          event: {
            type: "mouseUp",
            button,
            ...withSourceId(virtualPointerRef.current, activeSourceIdRef.current)
          }
        });
      }
      pressedButtonsRef.current.clear();
    };

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
      sendCapturedControl({ kind: "pointer", event: { type: "move", ...withSourceId(next, activeSourceIdRef.current) } });
    };

    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      sendCapturedControl({ kind: "pointer", event: { type: "scroll", deltaX: event.deltaX, deltaY: event.deltaY } });
    };

    const handleMouseDown = (event: MouseEvent): void => {
      if (document.pointerLockElement !== video) {
        video.focus();
        requestLocks();
        return;
      }
      event.preventDefault();
      const button = mapPointerButton(event.button);
      pressedButtonsRef.current.add(button);
      sendCapturedControl({
        kind: "pointer",
        event: {
          type: "mouseDown",
          button,
          ...withSourceId(virtualPointerRef.current, activeSourceIdRef.current)
        }
      });
    };

    const handleMouseUp = (event: MouseEvent): void => {
      if (document.pointerLockElement !== video) {
        return;
      }
      event.preventDefault();
      const button = mapPointerButton(event.button);
      pressedButtonsRef.current.delete(button);
      sendCapturedControl({
        kind: "pointer",
        event: {
          type: "mouseUp",
          button,
          ...withSourceId(virtualPointerRef.current, activeSourceIdRef.current)
        }
      });
    };

    const handleContextMenu = (event: Event): void => {
      event.preventDefault();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (isInputCaptureExitShortcut(event)) {
        releasePressedKeys();
        exitInputCapture();
        return;
      }

      if (!event.repeat) {
        const pressedKey = { code: event.code, key: event.key };
        pressedKeysRef.current.set(getKeyIdentity(event), pressedKey);
        sendCapturedControl({ kind: "keyboard", event: { type: "keyDown", ...pressedKey } });
      }
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      const identity = getKeyIdentity(event);
      const pressedKey = pressedKeysRef.current.get(identity);
      if (pressedKey) {
        pressedKeysRef.current.delete(identity);
        sendCapturedControl({ kind: "keyboard", event: { type: "keyUp", ...pressedKey } });
      }
    };

    const handlePointerLockChange = (): void => {
      if (document.pointerLockElement === video) {
        hadPointerLock = true;
      } else if (hadPointerLock) {
        releasePressedKeys();
        releasePressedButtons();
        exitInputCapture();
      }
    };

    document.addEventListener("mousemove", handlePointerMove);
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("pointerlockchange", handlePointerLockChange);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", releasePressedKeys);

    return () => {
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("mouseup", handleMouseUp, true);
      document.removeEventListener("contextmenu", handleContextMenu, true);
      document.removeEventListener("pointerlockchange", handlePointerLockChange);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", releasePressedKeys);
      releasePressedKeys();
      releasePressedButtons();
      keyboard?.unlock?.();
      if (document.pointerLockElement === video) {
        document.exitPointerLock();
      }
    };
  }, [controlEnabled, inputCaptureEnabled, videoRef]);

  function pointerPosition(event: PointerEvent<HTMLVideoElement>): PointerCoordinates {
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
      onContextMenu={(event) => event.preventDefault()}
      onPointerMove={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        onControl({ kind: "pointer", event: { type: "move", ...withSourceId(pointerPosition(event), activeSourceId) } });
      }}
      onPointerDown={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const button = mapPointerButton(event.button);
        pressedButtonsRef.current.add(button);
        onControl({
          kind: "pointer",
          event: { type: "mouseDown", button, ...withSourceId(pointerPosition(event), activeSourceId) }
        });
      }}
      onPointerUp={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        const button = mapPointerButton(event.button);
        if (!pressedButtonsRef.current.delete(button)) return;
        onControl({
          kind: "pointer",
          event: { type: "mouseUp", button, ...withSourceId(pointerPosition(event), activeSourceId) }
        });
      }}
      onPointerCancel={(event) => {
        if (!controlEnabled || inputCaptureEnabled) return;
        const button = mapPointerButton(event.button);
        if (!pressedButtonsRef.current.delete(button)) return;
        onControl({
          kind: "pointer",
          event: { type: "mouseUp", button, ...withSourceId(pointerPosition(event), activeSourceId) }
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

type PointerCoordinates = {
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
};

function withSourceId(pointer: PointerCoordinates, sourceId?: string): PointerCoordinates & { sourceId?: string } {
  return sourceId ? { ...pointer, sourceId } : pointer;
}

function getKeyIdentity(event: KeyboardEvent): string {
  return event.code || event.key;
}

function mapPointerButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
