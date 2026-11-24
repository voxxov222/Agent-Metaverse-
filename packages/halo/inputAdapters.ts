export interface HotkeyHandlers {
  onTogglePalette: () => void;
  onToggleWrist: () => void;
  onTriggerKillSwitch: () => void;
  onEscape: () => void;
}

export function attachHaloKeyboardAdapter(handlers: HotkeyHandlers): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const inField =
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

    // Ctrl/Cmd + K -> Command Palette (works even inside inputs)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      handlers.onTogglePalette();
      return;
    }

    // Ctrl + Shift + X -> Emergency Kill Switch (always works)
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      handlers.onTriggerKillSwitch();
      return;
    }

    if (inField) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      handlers.onToggleWrist();
    } else if (e.key === 'Escape') {
      handlers.onEscape();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

export interface InputCapabilities {
  webXrSupported: boolean;
  handTrackingLikely: boolean;
  gamepadSupported: boolean;
  webcamGestureSupported: boolean;
}

export async function probeInputCapabilities(): Promise<InputCapabilities> {
  let webXrSupported = false;
  if (typeof navigator !== 'undefined' && 'xr' in navigator && navigator.xr) {
    try {
      webXrSupported = await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      webXrSupported = false;
    }
  }
  const gamepadSupported =
    typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  const webcamGestureSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');

  return {
    webXrSupported,
    handTrackingLikely: webXrSupported,
    gamepadSupported,
    webcamGestureSupported,
  };
}

/**
 * Polls connected gamepads on demand (button 0 = select/confirm, button 3 = wrist HUD, button 8+9 = killswitch).
 */
export function startGamepadAdapter(callbacks: {
  onWristToggle: () => void;
  onPaletteToggle: () => void;
}): () => void {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return () => {};
  }
  let prevWrist = false;
  let prevPalette = false;
  const timer = window.setInterval(() => {
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad) continue;
      const wristBtn = Boolean(pad.buttons[3]?.pressed);
      const palBtn = Boolean(pad.buttons[9]?.pressed);
      if (wristBtn && !prevWrist) callbacks.onWristToggle();
      if (palBtn && !prevPalette) callbacks.onPaletteToggle();
      prevWrist = wristBtn;
      prevPalette = palBtn;
    }
  }, 150);
  return () => clearInterval(timer);
}
