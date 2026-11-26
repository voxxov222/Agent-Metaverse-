import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AudioWaveform,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  Send,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { AgentProfile, JarvisOrbState } from '../../types/os';
import {
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_VOICES,
  GeminiLiveBrowserClient,
  type GeminiLiveVoiceName,
  type LiveConnectionState,
  type LivePersonaKind,
  type LiveTranscriptTurn,
} from '../../utils/geminiLiveAudio';

interface LiveVoicePanelProps {
  agents: AgentProfile[];
  selectedAgentId: string | null;
  geminiConfigured: boolean;
  isOffline: boolean;
  onSyncOrbState: (state: JarvisOrbState, label?: string) => void;
  onLivePulse: (label: string) => void;
}

export function LiveVoicePanel({
  agents,
  selectedAgentId,
  geminiConfigured,
  isOffline,
  onSyncOrbState,
  onLivePulse,
}: LiveVoicePanelProps) {
  const [persona, setPersona] = useState<LivePersonaKind>('central');
  const [agentId, setAgentId] = useState<string>(selectedAgentId ?? agents[0]?.id ?? '');
  const [voice, setVoice] = useState<GeminiLiveVoiceName>('Zephyr');
  const [connState, setConnState] = useState<LiveConnectionState>('idle');
  const [statusDetail, setStatusDetail] = useState<string>('Ready for real-time two-way voice');
  const [muted, setMuted] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [textDraft, setTextDraft] = useState('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [turns, setTurns] = useState<LiveTranscriptTurn[]>([]);

  const clientRef = useRef<GeminiLiveBrowserClient | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!agentId && agents[0]?.id) {
      setAgentId(agents[0].id);
    }
  }, [agentId, agents]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  const isLive = connState === 'connecting' || connState === 'listening' || connState === 'speaking';

  function appendStreamingChunk(role: 'user' | 'model', chunk: string) {
    const clean = chunk;
    if (!clean) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !last.final) {
        const nextText = last.text + clean;
        return [...prev.slice(0, -1), { ...last, text: nextText }];
      }
      // Finalize any open turn from the opposite speaker when a new speaker starts
      const finalized = prev.map((t) => (t.final ? t : { ...t, final: true }));
      return [
        ...finalized,
        {
          id: `turn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role,
          text: clean.trimStart(),
          timestamp: Date.now(),
          final: false,
        },
      ];
    });
  }

  async function handleStartSession() {
    if (isOffline) {
      setErrorBanner('Offline mode is active. Reconnect to start a live Gemini 3.8 Live voice conversation.');
      return;
    }

    setErrorBanner(null);
    setMuted(false);

    const client = new GeminiLiveBrowserClient({
      onStateChange: (nextState, detail) => {
        setConnState(nextState);
        if (detail) setStatusDetail(detail);
        if (nextState === 'connecting') {
          onSyncOrbState('thinking', 'LIVE CONNECTING');
        } else if (nextState === 'listening') {
          onSyncOrbState('listening', `LIVE // ${voice.toUpperCase()}`);
        } else if (nextState === 'speaking') {
          onSyncOrbState('speaking', `GEMINI LIVE // ${voice.toUpperCase()}`);
          onLivePulse('Gemini Live voice response streaming');
        } else if (nextState === 'error') {
          onSyncOrbState('error', 'LIVE VOICE ALERT');
        } else {
          onSyncOrbState('idle', 'IDLE // READY');
        }
      },
      onInputTranscript: (text) => {
        appendStreamingChunk('user', text);
      },
      onOutputTranscript: (text) => {
        appendStreamingChunk('model', text);
      },
      onInterrupted: () => {
        setTurns((prev) =>
          prev.map((t, idx) =>
            idx === prev.length - 1 && t.role === 'model' && !t.final
              ? { ...t, interrupted: true, final: true }
              : { ...t, final: true },
          ),
        );
      },
      onTurnComplete: () => {
        setTurns((prev) => prev.map((t) => (t.final ? t : { ...t, final: true })));
      },
      onInputLevel: (lvl) => setInputLevel(lvl),
      onOutputLevel: (lvl) => setOutputLevel(lvl),
      onError: (message) => {
        setErrorBanner(message);
      },
    });

    clientRef.current = client;
    await client.connect({
      voice,
      persona,
      agentId: persona === 'agent' ? agentId : null,
      enableMic: true,
    });
  }

  function handleStopSession() {
    clientRef.current?.disconnect('Conversation ended by operator');
    clientRef.current = null;
    setConnState('idle');
    setInputLevel(0);
    setOutputLevel(0);
    onSyncOrbState('idle', 'IDLE // READY');
  }

  function handleToggleMute() {
    const next = !muted;
    setMuted(next);
    clientRef.current?.setMicMuted(next);
  }

  function handleSendTextTurn(e: FormEvent) {
    e.preventDefault();
    const text = textDraft.trim();
    if (!text || !isLive || !clientRef.current) return;
    const sent = clientRef.current.sendTextTurn(text);
    if (sent) {
      setTurns((prev) => [
        ...prev.map((t) => ({ ...t, final: true })),
        {
          id: `txt-${Date.now()}`,
          role: 'user',
          text,
          timestamp: Date.now(),
          final: true,
        },
      ]);
      setTextDraft('');
      onLivePulse(`Live text prompt: ${text.slice(0, 32)}`);
    }
  }

  const activePersonaLabel =
    persona === 'jarvis'
      ? 'J.A.R.V.I.S'
      : persona === 'agent'
        ? agents.find((a) => a.id === agentId)?.name ?? 'Agent'
        : 'Central Core';

  const statusBadgeClass =
    connState === 'speaking'
      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
      : connState === 'listening'
        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
        : connState === 'connecting'
          ? 'bg-amber-500/20 border-amber-400 text-amber-200'
          : connState === 'error'
            ? 'bg-rose-500/20 border-rose-400 text-rose-200'
            : 'bg-slate-900 border-slate-700 text-slate-300';

  return (
    <div className="flex flex-col h-full gap-3 text-xs">
      {/* Model & Status Banner */}
      <div className="rounded-lg bg-[#0F1524] border border-slate-800 p-3 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AudioWaveform className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold text-slate-100 text-xs truncate">
                Two-Way Live Voice Conversation
              </div>
              <div className="text-[10px] font-mono text-slate-400 truncate">
                {GEMINI_LIVE_MODEL} · 16kHz PCM In / 24kHz PCM Out
              </div>
            </div>
          </div>
          <span
            data-testid="live-voice-status"
            className={`px-2 py-0.5 rounded border text-[10px] font-mono uppercase shrink-0 ${statusBadgeClass}`}
          >
            {connState}
          </span>
        </div>

        {/* Persona & Voice Selectors */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div>
            <label htmlFor="live-persona-select" className="block text-[10px] text-slate-400 mb-1">
              Voice Persona
            </label>
            <select
              id="live-persona-select"
              value={persona}
              disabled={isLive}
              onChange={(e) => setPersona(e.target.value as LivePersonaKind)}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-100 disabled:opacity-60"
            >
              <option value="central">Central Core</option>
              <option value="jarvis">J.A.R.V.I.S Command</option>
              <option value="agent">Assigned Agent</option>
            </select>
          </div>

          <div>
            <label htmlFor="live-voice-select" className="block text-[10px] text-slate-400 mb-1">
              Gemini Live Voice
            </label>
            <select
              id="live-voice-select"
              value={voice}
              disabled={isLive}
              onChange={(e) => setVoice(e.target.value as GeminiLiveVoiceName)}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-100 disabled:opacity-60"
            >
              {GEMINI_LIVE_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {persona === 'agent' && agents.length > 0 && (
          <div>
            <label htmlFor="live-agent-select" className="block text-[10px] text-slate-400 mb-1">
              Target Agent
            </label>
            <select
              id="live-agent-select"
              value={agentId}
              disabled={isLive}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-100 disabled:opacity-60"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Primary Call Controls */}
        <div className="flex items-center gap-2 pt-1">
          {!isLive ? (
            <button
              type="button"
              onClick={() => void handleStartSession()}
              disabled={isOffline}
              className="flex-1 py-2 px-3 rounded-lg bg-cyan-400 text-slate-950 font-semibold hover:bg-cyan-300 disabled:opacity-45 flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <Phone className="w-4 h-4" />
              <span>Start Live Conversation</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleStopSession}
                className="flex-1 py-2 px-3 rounded-lg bg-rose-500 text-white font-semibold hover:bg-rose-400 flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
                <span>End Conversation</span>
              </button>
              <button
                type="button"
                aria-label={muted ? 'Unmute Microphone' : 'Mute Microphone'}
                aria-pressed={muted}
                onClick={handleToggleMute}
                className={`px-3 py-2 rounded-lg border font-medium flex items-center gap-1.5 cursor-pointer ${
                  muted
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                    : 'bg-slate-900 border-slate-700 text-slate-200 hover:border-cyan-400'
                }`}
              >
                {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-emerald-400" />}
                <span>{muted ? 'Muted' : 'Mic Live'}</span>
              </button>
            </>
          )}
        </div>

        {/* Real-Time Audio Level Meters */}
        <div className="grid grid-cols-2 gap-2 pt-0.5">
          <div className="rounded bg-slate-950 border border-slate-800 px-2 py-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
              <span className="flex items-center gap-1">
                <Mic className="w-3 h-3 text-emerald-400" />
                Mic Input
              </span>
              <span className="tabular-nums text-emerald-300">{Math.round(inputLevel * 100)}%</span>
            </div>
            <div className="h-1.5 rounded bg-slate-900 overflow-hidden">
              <div
                className="h-full bg-emerald-400 transition-[width] duration-75"
                style={{ width: `${Math.round(inputLevel * 100)}%` }}
              />
            </div>
          </div>

          <div className="rounded bg-slate-950 border border-slate-800 px-2 py-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
              <span className="flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-cyan-400" />
                Gemini Audio
              </span>
              <span className="tabular-nums text-cyan-300">{Math.round(outputLevel * 100)}%</span>
            </div>
            <div className="h-1.5 rounded bg-slate-900 overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-[width] duration-75"
                style={{ width: `${Math.round(outputLevel * 100)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
          <span className="truncate">{statusDetail}</span>
          <span className={geminiConfigured ? 'text-emerald-400' : 'text-amber-300'}>
            {geminiConfigured ? 'API Ready' : 'Key Missing in Secrets'}
          </span>
        </div>
      </div>

      {/* Error / Key Notice */}
      {errorBanner && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/60 bg-rose-950/50 px-3 py-2 text-xs text-rose-200 shrink-0"
        >
          {errorBanner}
        </div>
      )}

      {/* Live Two-Way Transcript */}
      <div className="flex items-center justify-between px-0.5 shrink-0">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
          <Radio className="w-3.5 h-3.5 text-cyan-400" />
          <span>Live Conversation Transcript ({activePersonaLabel})</span>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={() => setTurns([])}
            className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-2 pr-1">
        {turns.length === 0 ? (
          <div className="rounded-lg border border-slate-800 bg-[#0F1524]/70 p-4 text-center text-slate-400 space-y-1">
            <p className="text-slate-200 font-medium">Real-time bidirectional audio & transcript</p>
            <p className="text-[11px]">
              Press Start Live Conversation to speak naturally with {GEMINI_LIVE_MODEL}. Interrupt anytime mid-sentence for instant barge-in.
            </p>
          </div>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className={`rounded-lg border p-2.5 text-xs ${
                turn.role === 'user'
                  ? 'bg-slate-900 border-slate-700 text-slate-100 ml-8'
                  : 'bg-[#0F172A] border-cyan-500/30 text-slate-100 mr-6'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                <span className={turn.role === 'model' ? 'text-cyan-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                  {turn.role === 'user' ? 'Operator' : `${activePersonaLabel} (${voice})`}
                </span>
                <span>
                  {turn.interrupted ? 'interrupted · ' : ''}
                  {new Date(turn.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{turn.text}</p>
            </div>
          ))
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Text-in-Live Turn Input (supports hybrid text + voice two-way turns) */}
      <form onSubmit={handleSendTextTurn} className="border-t border-slate-800 pt-2.5 flex items-center gap-2 shrink-0">
        <label htmlFor="live-voice-text-input" className="sr-only">
          Send text message into live voice conversation
        </label>
        <input
          id="live-voice-text-input"
          type="text"
          value={textDraft}
          disabled={!isLive}
          onChange={(e) => setTextDraft(e.target.value)}
          placeholder={
            isLive
              ? `Speak or send a text turn to ${activePersonaLabel}...`
              : 'Start Live Conversation to speak or type in real time...'
          }
          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isLive || !textDraft.trim()}
          className="px-3.5 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs hover:bg-cyan-400 disabled:opacity-40 flex items-center gap-1 cursor-pointer shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
}
