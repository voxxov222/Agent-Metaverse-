import type { AgentVoiceProfile } from '../types/os';

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function speakWithProfile(text: string, profile?: AgentVoiceProfile): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 420));
    utterance.pitch = profile?.pitch ?? 1.0;
    utterance.rate = profile?.rate ?? 1.02;

    const voices = window.speechSynthesis.getVoices();
    if (profile?.preferredVoiceName) {
      const matched = voices.find((v) => v.name.includes(profile.preferredVoiceName!));
      if (matched) utterance.voice = matched;
    } else if (voices.length > 0) {
      const english = voices.find((v) => v.lang.startsWith('en'));
      if (english) utterance.voice = english;
    }

    window.speechSynthesis.speak(utterance);
  } catch {
    // Browser blocked autoplay speech; silent fallback
  }
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
