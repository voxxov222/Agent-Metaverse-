import { Room, RoomEvent, Track } from 'livekit-client';
import type { AgentVoiceProfile } from '../types/os';
import { JARVIS_VOICE_CONFIG, sanitizeJarvisVoiceText } from './jarvisVoice';

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function speakWithProfile(
  text: string,
  profile?: AgentVoiceProfile,
  callbacks?: { onStart?: () => void; onEnd?: () => void },
): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    callbacks?.onEnd?.();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 420));
    utterance.pitch = profile?.pitch ?? 1.0;
    utterance.rate = profile?.rate ?? 1.02;

    const voices = window.speechSynthesis.getVoices();
    if (profile?.preferredVoiceName) {
      const matched = voices.find((v) =>
        v.name.toLowerCase().includes(profile.preferredVoiceName!.toLowerCase()),
      );
      if (matched) utterance.voice = matched;
    }
    if (!utterance.voice && voices.length > 0) {
      const english = voices.find((v) => v.lang.startsWith('en'));
      if (english) utterance.voice = english;
    }

    utterance.onstart = () => callbacks?.onStart?.();
    utterance.onend = () => callbacks?.onEnd?.();
    utterance.onerror = () => callbacks?.onEnd?.();

    window.speechSynthesis.speak(utterance);
  } catch {
    callbacks?.onEnd?.();
  }
}

export function speakAsJarvis(
  rawText: string,
  callbacks?: { onStart?: () => void; onEnd?: () => void },
): string {
  const spoken = sanitizeJarvisVoiceText(rawText, 3);
  if (!spoken) {
    callbacks?.onEnd?.();
    return '';
  }
  speakWithProfile(
    spoken,
    {
      pitch: 0.94,
      rate: 1.02,
      style: `${JARVIS_VOICE_CONFIG.voice} // ${JARVIS_VOICE_CONFIG.model}`,
      preferredVoiceName: 'Daniel',
    },
    callbacks,
  );
  return spoken;
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}

export interface VoiceListenerHandle {
  stop: () => void;
}

export function startVoiceRecognition(
  onTranscript: (text: string, isFinal: boolean) => void,
  onError: (err: string) => void,
  onEnd: () => void,
): VoiceListenerHandle | null {
  if (!isSpeechRecognitionSupported()) {
    onError('Speech recognition is not supported in this browser.');
    return null;
  }

  const w = window as unknown as Record<string, new () => {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
    onerror: ((ev: { error: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
  }>;

  const RecognitionCtor = w.SpeechRecognition || w.webkitSpeechRecognition;
  const recognition = new RecognitionCtor();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    let latest = '';
    let isFinal = false;
    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      latest += res[0].transcript;
      if (res.isFinal) isFinal = true;
    }
    onTranscript(latest.trim(), isFinal);
  };

  recognition.onerror = (event) => {
    onError(event.error || 'Voice capture failed');
  };

  recognition.onend = () => {
    onEnd();
  };

  try {
    recognition.start();
    return {
      stop: () => {
        try {
          recognition.stop();
        } catch {
          // ignore
        }
      },
    };
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Unable to start voice recognition');
    return null;
  }
}

export interface LiveKitVoiceClientCallbacks {
  onStatusChange: (status: 'connecting' | 'connected' | 'disconnected' | 'error', detail?: string) => void;
  onAgentSpeakingChange: (speaking: boolean) => void;
  onTranscript?: (text: string, speaker: string) => void;
}

export class LiveKitJarvisVoiceSession {
  private room: Room | null = null;
  private attachedAudioEls: HTMLMediaElement[] = [];

  public async connect(
    wsUrl: string,
    token: string,
    callbacks: LiveKitVoiceClientCallbacks,
  ): Promise<void> {
    this.disconnect();
    callbacks.onStatusChange('connecting', `Connecting to ${JARVIS_VOICE_CONFIG.agentName}...`);

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.room = room;

    room.on(RoomEvent.Connected, () => {
      callbacks.onStatusChange('connected', `${JARVIS_VOICE_CONFIG.agentName} (${JARVIS_VOICE_CONFIG.voice})`);
    });

    room.on(RoomEvent.Disconnected, () => {
      callbacks.onAgentSpeakingChange(false);
      callbacks.onStatusChange('disconnected', 'Disconnected');
    });

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        el.autoplay = true;
        document.body.appendChild(el);
        this.attachedAudioEls.push(el);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const agentSpeaking = speakers.some(
        (s) => s.identity !== room.localParticipant.identity,
      );
      callbacks.onAgentSpeakingChange(agentSpeaking);
    });

    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      const text = segments.map((s) => s.text).join(' ').trim();
      if (text) {
        callbacks.onTranscript?.(text, participant?.identity || JARVIS_VOICE_CONFIG.agentName);
      }
    });

    await room.connect(wsUrl, token);
    try {
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    } catch {
      // Allow listen-only connection when browser/headless environment has no microphone device
    }
  }

  public disconnect(): void {
    for (const el of this.attachedAudioEls) {
      el.remove();
    }
    this.attachedAudioEls = [];
    if (this.room) {
      void this.room.disconnect();
      this.room = null;
    }
  }
}
