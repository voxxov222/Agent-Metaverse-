export const GEMINI_LIVE_MODEL = 'gemini-3.8-live';

export const GEMINI_LIVE_VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir'] as const;
export type GeminiLiveVoiceName = (typeof GEMINI_LIVE_VOICES)[number];

export type LivePersonaKind = 'central' | 'jarvis' | 'agent';

export type LiveConnectionState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error';

export interface LiveTranscriptTurn {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  interrupted?: boolean;
  final?: boolean;
}

export type LiveServerPayload =
  | { type: 'ready'; model: string; voice: GeminiLiveVoiceName; persona: string }
  | { type: 'audio'; data: string; mimeType?: string }
  | { type: 'input_transcript'; text: string }
  | { type: 'output_transcript'; text: string }
  | { type: 'interrupted' }
  | { type: 'turn_complete' }
  | { type: 'error'; error: string }
  | { type: 'closed'; reason?: string };

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Linearly resamples mono Float32 samples from inputSampleRate to targetSampleRate (default 16000 Hz).
 */
export function downsampleFloat32(
  samples: Float32Array,
  inputSampleRate: number,
  targetSampleRate = 16000,
): Float32Array {
  if (!samples.length || inputSampleRate <= 0 || targetSampleRate <= 0) {
    return new Float32Array(0);
  }
  if (Math.round(inputSampleRate) === Math.round(targetSampleRate)) {
    return samples;
  }
  const ratio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const result = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(idx0 + 1, samples.length - 1);
    const frac = srcIdx - idx0;
    result[i] = samples[idx0] * (1 - frac) + samples[idx1] * frac;
  }
  return result;
}

/**
 * Encodes Float32 [-1, 1] mono audio samples into little-endian 16-bit PCM bytes.
 */
export function float32ToInt16Pcm(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return pcm;
}

export function float32ToPcm16Base64(
  samples: Float32Array,
  inputSampleRate = 16000,
  targetSampleRate = 16000,
): string {
  const resampled = downsampleFloat32(samples, inputSampleRate, targetSampleRate);
  const pcm16 = float32ToInt16Pcm(resampled);
  return bytesToBase64(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength));
}

/**
 * Decodes base64 little-endian 16-bit PCM bytes into Float32 [-1, 1] audio samples for Web Audio playback.
 */
export function pcm16Base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const bytes = base64ToBytes(base64);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  const float32 = new Float32Array(new ArrayBuffer(sampleCount * 4));
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export function computeRmsLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.min(1, Math.sqrt(sumSq / samples.length) * 3.2);
}

export interface GeminiLiveSessionCallbacks {
  onStateChange: (state: LiveConnectionState, detail?: string) => void;
  onInputTranscript: (text: string) => void;
  onOutputTranscript: (text: string) => void;
  onInterrupted: () => void;
  onTurnComplete: () => void;
  onInputLevel: (level: number) => void;
  onOutputLevel: (level: number) => void;
  onError: (message: string) => void;
}

export interface GeminiLiveStartOptions {
  voice: GeminiLiveVoiceName;
  persona: LivePersonaKind;
  agentId?: string | null;
  enableMic?: boolean;
}

export class GeminiLiveBrowserClient {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private micMuted = false;
  private closed = false;
  private hadError = false;
  private callbacks: GeminiLiveSessionCallbacks;

  constructor(callbacks: GeminiLiveSessionCallbacks) {
    this.callbacks = callbacks;
  }

  setMicMuted(muted: boolean) {
    this.micMuted = muted;
    if (muted) {
      this.callbacks.onInputLevel(0);
    }
  }

  async connect(options: GeminiLiveStartOptions): Promise<void> {
    this.closed = false;
    this.hadError = false;
    this.callbacks.onStateChange('connecting', 'Bridging to gemini-3.8-live...');

    // Pre-create / resume 24kHz playback context inside user gesture
    const OutputAudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.outputCtx = new OutputAudioCtx({ sampleRate: 24000 });
    if (this.outputCtx.state === 'suspended') {
      await this.outputCtx.resume();
    }
    this.nextStartTime = 0;

    // Optional mic capture at 16kHz
    if (options.enableMic !== false && navigator.mediaDevices?.getUserMedia) {
      try {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.inputCtx = new OutputAudioCtx({ sampleRate: 16000 });
        if (this.inputCtx.state === 'suspended') {
          await this.inputCtx.resume();
        }
        this.sourceNode = this.inputCtx.createMediaStreamSource(this.mediaStream);
        this.processorNode = this.inputCtx.createScriptProcessor(4096, 1, 1);
        const actualRate = this.inputCtx.sampleRate || 16000;

        this.processorNode.onaudioprocess = (event) => {
          if (this.closed || this.micMuted || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
          }
          const channelData = event.inputBuffer.getChannelData(0);
          this.callbacks.onInputLevel(computeRmsLevel(channelData));
          const audioBase64 = float32ToPcm16Base64(channelData, actualRate, 16000);
          this.ws.send(JSON.stringify({ type: 'audio', data: audioBase64 }));
        };

        // Route processor through muted gain node so mic never feeds back to speakers
        const zeroGain = this.inputCtx.createGain();
        zeroGain.gain.value = 0;
        this.sourceNode.connect(this.processorNode);
        this.processorNode.connect(zeroGain);
        zeroGain.connect(this.inputCtx.destination);
      } catch (micErr) {
        const msg =
          micErr instanceof Error
            ? `Microphone access unavailable (${micErr.message}). Text-to-voice two-way mode remains ready.`
            : 'Microphone access unavailable. Text-to-voice two-way mode remains ready.';
        this.callbacks.onError(msg);
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/live`);
    this.ws = ws;

    ws.onopen = () => {
      if (this.closed) {
        ws.close();
        return;
      }
      ws.send(
        JSON.stringify({
          type: 'start',
          voice: options.voice,
          persona: options.persona,
          agentId: options.agentId ?? undefined,
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as LiveServerPayload;
        if (msg.type === 'ready') {
          this.hadError = false;
          this.callbacks.onStateChange('listening', `${msg.model} · ${msg.voice}`);
        } else if (msg.type === 'audio' && msg.data) {
          this.callbacks.onStateChange('speaking');
          this.enqueuePcm24k(msg.data);
        } else if (msg.type === 'input_transcript' && msg.text) {
          this.callbacks.onInputTranscript(msg.text);
        } else if (msg.type === 'output_transcript' && msg.text) {
          this.callbacks.onOutputTranscript(msg.text);
        } else if (msg.type === 'interrupted') {
          this.clearPlaybackQueue();
          this.callbacks.onInterrupted();
          this.callbacks.onStateChange('listening', 'Interrupted · Listening');
        } else if (msg.type === 'turn_complete') {
          this.callbacks.onTurnComplete();
          if (this.activeSources.size === 0) {
            this.callbacks.onOutputLevel(0);
            this.callbacks.onStateChange('listening');
          }
        } else if (msg.type === 'error') {
          this.hadError = true;
          this.callbacks.onError(msg.error);
          this.callbacks.onStateChange('error', 'Live session error');
        } else if (msg.type === 'closed') {
          if (!this.closed && !this.hadError) {
            this.disconnect(msg.reason);
          } else if (!this.closed) {
            this.closed = true;
            this.cleanupResources();
          }
        }
      } catch {
        // Ignore non-JSON frames
      }
    };

    ws.onerror = () => {
      if (!this.closed) {
        this.hadError = true;
        this.callbacks.onError('Live Voice WebSocket connection error.');
        this.callbacks.onStateChange('error', 'Connection error');
      }
    };

    ws.onclose = () => {
      if (!this.closed) {
        this.cleanupResources();
        if (!this.hadError) {
          this.callbacks.onStateChange('idle', 'Session ended');
        }
      }
    };
  }

  sendTextTurn(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.ws.send(JSON.stringify({ type: 'text', text: trimmed }));
    return true;
  }

  private enqueuePcm24k(base64Pcm: string) {
    if (!this.outputCtx) return;
    const samples = pcm16Base64ToFloat32(base64Pcm);
    if (!samples.length) return;

    this.callbacks.onOutputLevel(computeRmsLevel(samples));

    const buffer = this.outputCtx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples, 0);

    const source = this.outputCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputCtx.destination);

    const now = this.outputCtx.currentTime;
    const startAt = Math.max(now + 0.01, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      if (this.activeSources.size === 0 && !this.closed) {
        this.callbacks.onOutputLevel(0);
        this.callbacks.onStateChange('listening');
      }
    };
  }

  private clearPlaybackQueue() {
    for (const src of this.activeSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Already stopped
      }
    }
    this.activeSources.clear();
    this.nextStartTime = 0;
    this.callbacks.onOutputLevel(0);
  }

  private cleanupResources() {
    this.clearPlaybackQueue();
    if (this.processorNode) {
      try {
        this.processorNode.onaudioprocess = null;
        this.processorNode.disconnect();
      } catch {
        // Ignore
      }
      this.processorNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Ignore
      }
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }
    if (this.inputCtx) {
      void this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      void this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }
  }

  disconnect(reason?: string) {
    this.closed = true;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'stop' }));
        }
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    this.cleanupResources();
    this.callbacks.onInputLevel(0);
    this.callbacks.onOutputLevel(0);
    this.callbacks.onStateChange('idle', reason || 'Standby');
  }
}
