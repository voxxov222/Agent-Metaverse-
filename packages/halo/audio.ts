export type HaloToneKind = 'tick' | 'hum' | 'confirm' | 'alert' | 'killswitch';

class HaloSpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private audioEnabled = true;
  private hapticsEnabled = true;

  public configure(audioEnabled: boolean, hapticsEnabled: boolean): void {
    this.audioEnabled = audioEnabled;
    this.hapticsEnabled = hapticsEnabled;
  }

  private ensureCtx(): AudioContext | null {
    if (!this.audioEnabled || typeof window === 'undefined') return null;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) {
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public play(kind: HaloToneKind, panX = 0, distanceFalloff = 1): void {
    if (this.hapticsEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      if (kind === 'killswitch') navigator.vibrate([45, 30, 80]);
      else if (kind === 'alert') navigator.vibrate([30, 20, 30]);
      else if (kind === 'confirm') navigator.vibrate(18);
      else if (kind === 'tick') navigator.vibrate(8);
    }

    const ctx = this.ensureCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;

      const vol = Math.max(0.01, Math.min(0.18, 0.08 * distanceFalloff));
      if (panner) {
        panner.pan.setValueAtTime(Math.max(-1, Math.min(1, panX)), now);
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(ctx.destination);
      } else {
        osc.connect(gain);
        gain.connect(ctx.destination);
      }

      if (kind === 'tick') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(980, now);
        osc.frequency.exponentialRampToValueAtTime(1320, now + 0.045);
        gain.gain.setValueAtTime(vol * 0.65, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
        osc.start(now);
        osc.stop(now + 0.06);
      } else if (kind === 'confirm') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.setValueAtTime(780, now + 0.06);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.start(now);
        osc.stop(now + 0.17);
      } else if (kind === 'alert') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.linearRampToValueAtTime(310, now + 0.18);
        gain.gain.setValueAtTime(vol * 0.9, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.21);
      } else if (kind === 'killswitch') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.32);
        gain.gain.setValueAtTime(vol * 1.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.36);
      } else {
        // ambient hum
        osc.type = 'sine';
        osc.frequency.setValueAtTime(135, now);
        gain.gain.setValueAtTime(vol * 0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch {
      // AudioContext blocked prior to user gesture
    }
  }
}

export const haloAudio = new HaloSpatialAudioEngine();
