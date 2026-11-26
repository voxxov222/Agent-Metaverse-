import type { AgentStatus, NeuralRegionId } from '../types/os';

export interface SpatialCueSpec {
  id: string;
  kind: 'neural-pulse' | 'agent-update';
  frequencyHz: number;
  harmonicRatio: number;
  filterHz: number;
  gain: number;
  attackSec: number;
  durationSec: number;
  waveform: OscillatorType;
}

const CORE_ORIGIN: [number, number, number] = [0, 3.4, 0];

const REGION_WORLD_OFFSETS: Record<NeuralRegionId, [number, number, number]> = {
  'reasoning-cortex': [0, 0.96, 0],
  'memory-lattice': [-1.24, 0.08, 0.42],
  'planning-engine': [1.24, 0.08, 0.42],
  'tool-bus': [-0.84, -0.82, -0.6],
  'security-gate': [0.84, -0.82, -0.6],
};

export function computeRegionWorldPosition(regionId: NeuralRegionId): [number, number, number] {
  const offset = REGION_WORLD_OFFSETS[regionId] ?? [0, 0, 0];
  return [
    Number((CORE_ORIGIN[0] + offset[0]).toFixed(3)),
    Number((CORE_ORIGIN[1] + offset[1]).toFixed(3)),
    Number((CORE_ORIGIN[2] + offset[2]).toFixed(3)),
  ];
}

export function resolveSpatialCueForPulse(regionId: NeuralRegionId): SpatialCueSpec {
  switch (regionId) {
    case 'reasoning-cortex':
      return {
        id: `pulse:${regionId}`,
        kind: 'neural-pulse',
        frequencyHz: 440,
        harmonicRatio: 1.5,
        filterHz: 1180,
        gain: 0.065,
        attackSec: 0.022,
        durationSec: 0.42,
        waveform: 'sine',
      };
    case 'memory-lattice':
      return {
        id: `pulse:${regionId}`,
        kind: 'neural-pulse',
        frequencyHz: 392,
        harmonicRatio: 1.25,
        filterHz: 980,
        gain: 0.06,
        attackSec: 0.028,
        durationSec: 0.46,
        waveform: 'triangle',
      };
    case 'planning-engine':
      return {
        id: `pulse:${regionId}`,
        kind: 'neural-pulse',
        frequencyHz: 523.25,
        harmonicRatio: 1.5,
        filterHz: 1320,
        gain: 0.058,
        attackSec: 0.02,
        durationSec: 0.38,
        waveform: 'sine',
      };
    case 'tool-bus':
      return {
        id: `pulse:${regionId}`,
        kind: 'neural-pulse',
        frequencyHz: 329.63,
        harmonicRatio: 1.5,
        filterHz: 880,
        gain: 0.06,
        attackSec: 0.018,
        durationSec: 0.34,
        waveform: 'triangle',
      };
    case 'security-gate':
    default:
      return {
        id: `pulse:${regionId}`,
        kind: 'neural-pulse',
        frequencyHz: 293.66,
        harmonicRatio: 1.333,
        filterHz: 820,
        gain: 0.064,
        attackSec: 0.022,
        durationSec: 0.44,
        waveform: 'sine',
      };
  }
}

export function resolveSpatialCueForAgentUpdate(
  status: AgentStatus,
  agentIndex = 0,
): SpatialCueSpec {
  // Subtle pentatonic pitch offset per agent slot so swarm updates feel spacious rather than repetitive
  const pentatonicSemitones = [0, 2, 4, 7, 9, 12];
  const semis = pentatonicSemitones[Math.abs(agentIndex) % pentatonicSemitones.length] ?? 0;
  const pitchMul = Math.pow(2, semis / 12);

  switch (status) {
    case 'reasoning':
      return {
        id: `agent:${status}`,
        kind: 'agent-update',
        frequencyHz: Number((349.23 * pitchMul).toFixed(2)),
        harmonicRatio: 1.5,
        filterHz: 1050,
        gain: 0.055,
        attackSec: 0.024,
        durationSec: 0.36,
        waveform: 'sine',
      };
    case 'executing':
      return {
        id: `agent:${status}`,
        kind: 'agent-update',
        frequencyHz: Number((440 * pitchMul).toFixed(2)),
        harmonicRatio: 1.25,
        filterHz: 1220,
        gain: 0.052,
        attackSec: 0.015,
        durationSec: 0.3,
        waveform: 'triangle',
      };
    case 'error':
      return {
        id: `agent:${status}`,
        kind: 'agent-update',
        frequencyHz: 196,
        harmonicRatio: 1.414,
        filterHz: 620,
        gain: 0.07,
        attackSec: 0.02,
        durationSec: 0.48,
        waveform: 'triangle',
      };
    case 'idle':
    default:
      return {
        id: `agent:${status}`,
        kind: 'agent-update',
        frequencyHz: Number((261.63 * pitchMul).toFixed(2)),
        harmonicRatio: 1.5,
        filterHz: 760,
        gain: 0.042,
        attackSec: 0.03,
        durationSec: 0.34,
        waveform: 'sine',
      };
  }
}

export class SpatialCueLimiter {
  private lastSourceAt = new Map<string, number>();
  private lastGlobalAt = -Infinity;
  private activeUntilMs: number[] = [];

  constructor(
    private readonly sourceCooldownMs = 650,
    private readonly globalCooldownMs = 150,
    private readonly maxPolyphony = 6,
  ) {}

  public tryAcquire(sourceKey: string, durationMs: number, nowMs: number): boolean {
    if (nowMs - this.lastGlobalAt < this.globalCooldownMs) {
      return false;
    }
    const prevSource = this.lastSourceAt.get(sourceKey);
    if (prevSource !== undefined && nowMs - prevSource < this.sourceCooldownMs) {
      return false;
    }

    this.activeUntilMs = this.activeUntilMs.filter((t) => t > nowMs);
    if (this.activeUntilMs.length >= this.maxPolyphony) {
      return false;
    }

    this.lastGlobalAt = nowMs;
    this.lastSourceAt.set(sourceKey, nowMs);
    this.activeUntilMs.push(nowMs + Math.max(80, durationMs));
    return true;
  }

  public reset(): void {
    this.lastSourceAt.clear();
    this.lastGlobalAt = -Infinity;
    this.activeUntilMs = [];
  }
}

export class SpatialAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private ambientHarmOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private enabled = true;
  private volume = 0.45;
  private unlocked = false;
  private disposed = false;
  private limiter = new SpatialCueLimiter(650, 150, 6);
  private lastListenerUpdateMs = 0;

  constructor(initialEnabled = true, initialVolume = 0.45) {
    this.enabled = initialEnabled;
    this.volume = Math.max(0, Math.min(1, initialVolume));
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public isUnlocked(): boolean {
    return this.unlocked && this.ctx?.state === 'running';
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(enabled ? this.volume : 0, now, 0.06);
    }
    if (this.ambientGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setTargetAtTime(enabled ? 0.018 : 0, now, 0.14);
    }
  }

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.masterGain && this.ctx && this.enabled) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed || typeof window === 'undefined') return null;
    if (this.ctx) return this.ctx;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      const ctx = new AudioCtx();
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-18, ctx.currentTime);
      compressor.knee.setValueAtTime(12, ctx.currentTime);
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, ctx.currentTime);
      compressor.release.setValueAtTime(0.22, ctx.currentTime);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this.enabled ? this.volume : 0, ctx.currentTime);

      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Ultra-soft filtered ambient pad (~55 Hz & 110 Hz) so the spatial chamber breathes quietly
      const ambientFilter = ctx.createBiquadFilter();
      ambientFilter.type = 'lowpass';
      ambientFilter.frequency.setValueAtTime(190, ctx.currentTime);

      const ambientGain = ctx.createGain();
      ambientGain.gain.setValueAtTime(this.enabled ? 0.018 : 0, ctx.currentTime);

      const oscLow = ctx.createOscillator();
      oscLow.type = 'sine';
      oscLow.frequency.setValueAtTime(55, ctx.currentTime);

      const oscFifth = ctx.createOscillator();
      oscFifth.type = 'triangle';
      oscFifth.frequency.setValueAtTime(82.41, ctx.currentTime);

      const fifthSubGain = ctx.createGain();
      fifthSubGain.gain.setValueAtTime(0.35, ctx.currentTime);

      oscLow.connect(ambientFilter);
      oscFifth.connect(fifthSubGain);
      fifthSubGain.connect(ambientFilter);
      ambientFilter.connect(ambientGain);
      ambientGain.connect(masterGain);

      oscLow.start();
      oscFifth.start();

      this.ctx = ctx;
      this.compressor = compressor;
      this.masterGain = masterGain;
      this.ambientOsc = oscLow;
      this.ambientHarmOsc = oscFifth;
      this.ambientGain = ambientGain;
      return ctx;
    } catch {
      return null;
    }
  }

  public async unlock(): Promise<boolean> {
    if (this.disposed) return false;
    const ctx = this.ensureContext();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      this.unlocked = ctx.state === 'running';
      return this.unlocked;
    } catch {
      return false;
    }
  }

  public updateListener(
    posX: number,
    posY: number,
    posZ: number,
    fwdX: number,
    fwdY: number,
    fwdZ: number,
    upX: number,
    upY: number,
    upZ: number,
    nowMs: number,
  ): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    if (nowMs - this.lastListenerUpdateMs < 40) return;
    this.lastListenerUpdateMs = nowMs;

    const listener = this.ctx.listener;
    const t = this.ctx.currentTime;
    try {
      if ('positionX' in listener && listener.positionX) {
        listener.positionX.setValueAtTime(posX, t);
        listener.positionY.setValueAtTime(posY, t);
        listener.positionZ.setValueAtTime(posZ, t);
        listener.forwardX.setValueAtTime(fwdX, t);
        listener.forwardY.setValueAtTime(fwdY, t);
        listener.forwardZ.setValueAtTime(fwdZ, t);
        listener.upX.setValueAtTime(upX, t);
        listener.upY.setValueAtTime(upY, t);
        listener.upZ.setValueAtTime(upZ, t);
      } else if (typeof (listener as AudioListener & { setPosition?: (...args: number[]) => void }).setPosition === 'function') {
        (listener as AudioListener & { setPosition: (x: number, y: number, z: number) => void }).setPosition(posX, posY, posZ);
        (listener as AudioListener & { setOrientation: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void }).setOrientation(
          fwdX,
          fwdY,
          fwdZ,
          upX,
          upY,
          upZ,
        );
      }
    } catch {
      // Ignore Web Audio listener quirks on headless/legacy browsers
    }
  }

  public playSpatialCue(
    cue: SpatialCueSpec,
    worldPosition: [number, number, number],
    sourceKey: string,
  ): boolean {
    if (this.disposed || !this.enabled) return false;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.compressor) return false;

    const nowMs = performance.now();
    if (!this.limiter.tryAcquire(sourceKey, cue.durationSec * 1000, nowMs)) {
      return false;
    }

    try {
      const t0 = ctx.currentTime;
      const tAttack = t0 + cue.attackSec;
      const tEnd = t0 + cue.durationSec;

      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 3.2;
      panner.maxDistance = 42;
      panner.rolloffFactor = 0.85;
      if ('positionX' in panner && panner.positionX) {
        panner.positionX.setValueAtTime(worldPosition[0], t0);
        panner.positionY.setValueAtTime(worldPosition[1], t0);
        panner.positionZ.setValueAtTime(worldPosition[2], t0);
      } else if (typeof (panner as PannerNode & { setPosition?: (x: number, y: number, z: number) => void }).setPosition === 'function') {
        (panner as PannerNode & { setPosition: (x: number, y: number, z: number) => void }).setPosition(
          worldPosition[0],
          worldPosition[1],
          worldPosition[2],
        );
      }

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(1.4, t0);
      filter.frequency.setValueAtTime(cue.filterHz, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(240, cue.filterHz * 0.48), tEnd);

      const envGain = ctx.createGain();
      envGain.gain.setValueAtTime(0.0001, t0);
      envGain.gain.linearRampToValueAtTime(cue.gain, tAttack);
      envGain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      const carrier = ctx.createOscillator();
      carrier.type = cue.waveform;
      carrier.frequency.setValueAtTime(cue.frequencyHz, t0);
      carrier.frequency.exponentialRampToValueAtTime(
        cue.kind === 'neural-pulse' ? cue.frequencyHz * 1.03 : cue.frequencyHz * 0.99,
        tEnd,
      );

      const harmonic = ctx.createOscillator();
      harmonic.type = 'sine';
      harmonic.frequency.setValueAtTime(cue.frequencyHz * cue.harmonicRatio, t0);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.28, t0);

      carrier.connect(filter);
      harmonic.connect(harmonicGain);
      harmonicGain.connect(filter);
      filter.connect(envGain);
      envGain.connect(panner);
      panner.connect(this.compressor);

      carrier.start(t0);
      harmonic.start(t0);
      carrier.stop(tEnd + 0.03);
      harmonic.stop(tEnd + 0.03);

      carrier.onended = () => {
        try {
          carrier.disconnect();
          harmonic.disconnect();
          harmonicGain.disconnect();
          filter.disconnect();
          envGain.disconnect();
          panner.disconnect();
        } catch {
          // Ignore teardown errors
        }
      };

      return true;
    } catch {
      return false;
    }
  }

  public playPulse(regionId: NeuralRegionId, fromAgentPos?: [number, number, number]): boolean {
    const cue = resolveSpatialCueForPulse(regionId);
    const pos = fromAgentPos ?? computeRegionWorldPosition(regionId);
    return this.playSpatialCue(cue, pos, `pulse:${regionId}`);
  }

  public playAgentUpdate(
    agentId: string,
    status: AgentStatus,
    worldPos: [number, number, number],
    agentIndex = 0,
  ): boolean {
    const cue = resolveSpatialCueForAgentUpdate(status, agentIndex);
    return this.playSpatialCue(cue, [worldPos[0], worldPos[1] + 1.35, worldPos[2]], `agent:${agentId}`);
  }

  public dispose(): void {
    this.disposed = true;
    this.limiter.reset();
    try {
      this.ambientOsc?.stop();
      this.ambientHarmOsc?.stop();
      this.ambientOsc?.disconnect();
      this.ambientHarmOsc?.disconnect();
      this.ambientGain?.disconnect();
      this.compressor?.disconnect();
      this.masterGain?.disconnect();
      if (this.ctx && this.ctx.state !== 'closed') {
        void this.ctx.close();
      }
    } catch {
      // Ignore cleanup errors
    } finally {
      this.ctx = null;
      this.masterGain = null;
      this.compressor = null;
      this.ambientOsc = null;
      this.ambientHarmOsc = null;
      this.ambientGain = null;
    }
  }
}
