import { useState } from "react";

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  async function syncFullscreenState(): Promise<void> {
    try {
      const state = await window.remoteControl.getFullscreenState();
      setIsFullscreen(state.isFullScreen);
    } catch {
      // ignore state sync errors
    }
  }

  async function toggleFullscreen(): Promise<void> {
    const result = await window.remoteControl.toggleFullscreen();
    if (result.ok) {
      setIsFullscreen(Boolean(result.isFullScreen));
    }
  }

  async function enterFullscreen(): Promise<void> {
    try {
      const state = await window.remoteControl.getFullscreenState();
      if (state.isFullScreen) {
        setIsFullscreen(true);
        return;
      }

      const result = await window.remoteControl.toggleFullscreen();
      if (result.ok) {
        setIsFullscreen(Boolean(result.isFullScreen));
      }
    } catch {
      // Fullscreen is a convenience; keep the session connected if it fails.
    }
  }

  async function leaveFullscreen(): Promise<void> {
    try {
      const state = await window.remoteControl.getFullscreenState();
      if (!state.isFullScreen) {
        setIsFullscreen(false);
        return;
      }

      const result = await window.remoteControl.toggleFullscreen();
      if (result.ok) {
        setIsFullscreen(Boolean(result.isFullScreen));
      }
    } catch {
      // ignore state sync errors
    }
  }

  return {
    enterFullscreen,
    isFullscreen,
    leaveFullscreen,
    syncFullscreenState,
    toggleFullscreen
  };
}
