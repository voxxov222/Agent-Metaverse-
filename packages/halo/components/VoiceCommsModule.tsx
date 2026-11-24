import { useState } from 'react';
import { Mic, MicOff, Send, Volume2 } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { useHaloSelector } from '../store';
import { parseVoiceDirective } from '../voiceGrammar';

interface TranscriptMessage {
  id: string;
  speaker: string;
  target: string;
  text: string;
  timestamp: number;
}

export function VoiceCommsModule() {
  const agents = useHaloSelector((s) => s.agents);
  const [targetId, setTargetId] = useState('fleet');
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [messages, setMessages] = useState<TranscriptMessage[]>([
    {
      id: 'v-seed',
      speaker: 'HALO Voice Router',
      target: 'Operator',
      text: 'Try voice directives: "halo spawn agent Orion role Analyst", "halo open mission control", "halo weather rain", or "tell kestrel run audit".',
      timestamp: Date.now(),
    },
  ]);

  function speakReply(text: string, agentId?: string) {
    if (!ttsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const utter = new SpeechSynthesisUtterance(text.slice(0, 220));
      const ag = agents.find((a) => a.id === agentId);
      if (ag) {
        utter.pitch = ag.voice.pitch;
        utter.rate = ag.voice.rate;
      }
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore unavailable TTS engines
    }
  }

  async function submitDirective(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    setInput('');

    setMessages((prev) => [
      { id: `u-${Date.now()}`, speaker: 'Operator-01', target: targetId, text, timestamp: Date.now() },
      ...prev,
    ]);

    const parsed = parseVoiceDirective(text, 'Operator-01');
    if (parsed.command) {
      const res = await dispatchHaloCommand(parsed.command);
      setMessages((prev) => [
        {
          id: `k-${Date.now()}`,
          speaker: `HALO (${parsed.intent})`,
          target: 'Operator-01',
          text: res.message,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      speakReply(res.message);
      return;
    }

    const chosenAgent = parsed.targetedAgentQuery
      ? agents.find(
          (a) =>
            a.name.toLowerCase().includes(parsed.targetedAgentQuery!.toLowerCase()) ||
            a.id.toLowerCase() === parsed.targetedAgentQuery!.toLowerCase(),
        ) ?? agents[0]
      : targetId === 'fleet'
        ? agents[0]
        : agents.find((a) => a.id === targetId) ?? agents[0];

    if (chosenAgent) {
      const res = await dispatchHaloCommand(
        createHaloCommand({
          actor: 'Operator-01',
          target: chosenAgent.id,
          verb: 'agent.chat',
          args: { message: parsed.freeformMessage || text },
        }),
      );
      setMessages((prev) => [
        {
          id: `a-${Date.now()}`,
          speaker: chosenAgent.name,
          target: 'Operator-01',
          text: res.message,
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      speakReply(res.message, chosenAgent.id);
    }
  }

  function startPushToTalk() {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRec) {
      setMessages((prev) => [
        {
          id: `err-${Date.now()}`,
          speaker: 'Voice Adapter',
          target: 'Operator-01',
          text: 'Browser Web Speech STT unavailable in this environment; enter voice commands in the text box below.',
          timestamp: Date.now(),
        },
        ...prev,
      ]);
      return;
    }

    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    setListening(true);
    rec.onresult = (ev: any) => {
      const transcript = ev.results?.[0]?.[0]?.transcript || '';
      setListening(false);
      void submitDirective(transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.start();
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-black/35 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">Target Channel:</span>
          <select
            aria-label="Voice target channel"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
          >
            <option value="fleet">All Fleet (Wake-Word / Broadcast)</option>
            {agents.map((ag) => (
              <option key={ag.id} value={ag.id}>
                {ag.name} ({ag.role})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTtsEnabled((v) => !v)}
            className={`px-2.5 py-1 rounded border text-xs flex items-center gap-1 cursor-pointer ${
              ttsEnabled ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200' : 'border-slate-700 text-slate-400'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>{ttsEnabled ? 'TTS On' : 'TTS Muted'}</span>
          </button>
          <button
            type="button"
            onClick={startPushToTalk}
            className={`px-3 py-1 rounded text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
              listening ? 'bg-rose-500 text-white' : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
            }`}
          >
            {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            <span>{listening ? 'Listening...' : 'Push-to-Talk'}</span>
          </button>
        </div>
      </div>

      {/* Live Speaker-Attributed Transcript */}
      <div className="flex-1 min-h-48 overflow-y-auto rounded-xl border border-slate-800 bg-black/40 p-3 space-y-2">
        {messages.map((m) => (
          <div key={m.id} className="rounded-lg border border-slate-800/90 bg-slate-950/90 p-2.5 text-xs">
            <div className="flex items-center justify-between text-[11px] text-cyan-300 mb-1">
              <span className="font-semibold">
                {m.speaker} → {m.target}
              </span>
              <span className="font-mono text-slate-500">
                {new Date(m.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-slate-200 whitespace-pre-wrap">{m.text}</p>
          </div>
        ))}
      </div>

      {/* Voice / Wake-Word Directive Box */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitDirective(input);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Speak or type directive (e.g. "halo weather ion-storm" or "tell Aegis status")'
          className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100"
        />
        <button
          type="submit"
          className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
}
