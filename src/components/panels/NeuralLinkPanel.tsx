import { useRef, useState } from 'react';
import { Mic, MicOff, Send, Volume2, VolumeX, Cpu, Network, Maximize2, Minimize2 } from 'lucide-react';
import type { NeuralRegion, NeuralRegionId } from '../../types/os';
import { NeuralNetworkView, type NeuralNetworkVizHandle, type VizAggregateState } from '../../viz';
import {
  isSpeechRecognitionSupported,
  speakWithProfile,
  startVoiceRecognition,
  stopSpeaking,
  type VoiceListenerHandle,
} from '../../utils/voiceEngine';

interface NeuralLinkPanelProps {
  regions: NeuralRegion[];
  selectedRegionId: NeuralRegionId;
  onSelectRegion: (id: NeuralRegionId) => void;
  geminiConfigured: boolean;
  isOffline: boolean;
  neuralEventBus: EventTarget;
  onSendCommand: (prompt: string) => Promise<{ reply: string; tokens?: number; latencyMs?: number }>;
  onCreateProjectFromVoice: (objective: string) => Promise<void>;
}

interface ChatBubble {
  id: string;
  sender: 'operator' | 'core' | 'error';
  text: string;
  meta?: string;
}

const QUICK_DIRECTIVES = [
  'Inspect active system capacity and summarize open risks',
  'Recommend open-source vector search tools with licensing notes',
  'Audit current agent permission boundaries and spend caps',
];

const VIZ_TRIGGERS = [
  'query',
  'thinking:0.8',
  'tool',
  'memory',
  'response',
  'success',
  'warning',
  'error@layer2',
] as const;

export function NeuralLinkPanel({
  regions,
  selectedRegionId,
  onSelectRegion,
  geminiConfigured,
  isOffline,
  neuralEventBus,
  onSendCommand,
  onCreateProjectFromVoice,
}: NeuralLinkPanelProps) {
  const vizRef = useRef<NeuralNetworkVizHandle | null>(null);
  const [vizExpanded, setVizExpanded] = useState(false);
  const [vizState, setVizState] = useState<VizAggregateState | null>(null);
  const [selectedNodeSummary, setSelectedNodeSummary] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [listener, setListener] = useState<VoiceListenerHandle | null>(null);
  const [messages, setMessages] = useState<ChatBubble[]>([
    {
      id: 'init-1',
      sender: 'core',
      text: 'Central Intelligence online. Issue operational directives, ask for system analysis, or inspect the live NeuralNetworkViz mesh above.',
      meta: geminiConfigured ? 'Gemini 4 Hydrogen Ready' : 'Gemini API Key Missing in Secrets',
    },
  ]);

  const activeRegion = regions.find((r) => r.id === selectedRegionId) ?? regions[0];

  async function handleSubmit(textToSend?: string) {
    const prompt = (textToSend ?? input).trim();
    if (!prompt || busy) return;
    setInput('');
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, sender: 'operator', text: prompt }]);
    vizRef.current?.updateActivity(['query:0.95', 'thinking:0.8']);

    if (isOffline) {
      vizRef.current?.updateActivity('warning');
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          sender: 'error',
          text: 'Offline mode active: live Central Intelligence calls require network reconnection. Use Projects or Memory tabs to queue local work.',
        },
      ]);
      return;
    }

    setBusy(true);
    try {
      const lower = prompt.toLowerCase();
      if (lower.startsWith('create a team') || lower.startsWith('launch project')) {
        await onCreateProjectFromVoice(prompt);
      }
      const res = await onSendCommand(prompt);
      vizRef.current?.updateActivity(['response:0.9', 'success:0.85']);
      setMessages((prev) => [
        ...prev,
        {
          id: `c-${Date.now()}`,
          sender: 'core',
          text: res.reply,
          meta: res.latencyMs !== undefined ? `${res.tokens ?? 0} tokens · ${res.latencyMs}ms` : undefined,
        },
      ]);
      if (autoSpeak) {
        speakWithProfile(res.reply, { pitch: 0.95, rate: 1.02, style: 'Central Core' });
      }
    } catch (err) {
      vizRef.current?.updateActivity('error@layer2');
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'error',
          text: err instanceof Error ? err.message : 'Unable to reach Central Intelligence.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function toggleVoiceCapture() {
    if (voiceActive && listener) {
      listener.stop();
      setVoiceActive(false);
      setListener(null);
      return;
    }
    const handle = startVoiceRecognition(
      (transcript, isFinal) => {
        setInput(transcript);
        if (isFinal && transcript) {
          setVoiceActive(false);
          setListener(null);
          void handleSubmit(transcript);
        }
      },
      (err) => {
        setVoiceActive(false);
        setMessages((prev) => [...prev, { id: `v-err-${Date.now()}`, sender: 'error', text: `Voice input: ${err}` }]);
      },
      () => {
        setVoiceActive(false);
        setListener(null);
      },
    );
    if (handle) {
      setListener(handle);
      setVoiceActive(true);
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Live NeuralNetworkViz Live Feedback Canvas */}
      <div className="border border-slate-800 bg-[#05060f] rounded-lg overflow-hidden shrink-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/90 bg-[#090d1a]">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-200">
            <Network className="w-3.5 h-3.5 text-cyan-400" />
            <span>Live Neural Mesh (140 Nodes)</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 tabular-nums">
            <span data-testid="viz-dominant-activity" className="text-cyan-300">
              {vizState?.dominantActivity ?? 'idle'}
            </span>
            <span>·</span>
            <span>{vizState?.activeEventCount ?? 0} waves</span>
            <button
              type="button"
              onClick={() => setVizExpanded((v) => !v)}
              aria-label={vizExpanded ? 'Collapse neural mesh' : 'Expand neural mesh'}
              className="p-1 rounded hover:bg-slate-800 text-slate-300 cursor-pointer"
            >
              {vizExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className={vizExpanded ? 'h-72 w-full' : 'h-40 w-full'}>
          <NeuralNetworkView
            ref={vizRef}
            source={neuralEventBus}
            options={{ nodeCount: 140, seed: 1337, bloomStrength: 0.85 }}
            onStateChange={(st) => setVizState(st)}
            onNodeClick={({ node, connectedEdgeIds }) => {
              if (node) {
                setSelectedNodeSummary(`Node #${node.id} (L${node.layer}) · ${connectedEdgeIds.length} synapses`);
                vizRef.current?.focusNode(node.id);
              } else {
                setSelectedNodeSummary(null);
              }
            }}
          />
        </div>

        <div className="px-2.5 py-2 border-t border-slate-800/80 bg-[#080c17] flex flex-wrap items-center gap-1">
          {VIZ_TRIGGERS.map((cmd) => (
            <button
              key={cmd}
              type="button"
              onClick={() => vizRef.current?.updateActivity(cmd)}
              className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300 hover:border-cyan-400/60 hover:text-cyan-200 cursor-pointer"
            >
              {cmd}
            </button>
          ))}
          <button
            type="button"
            onClick={() => vizRef.current?.reset()}
            className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer ml-auto"
          >
            reset
          </button>
        </div>

        {(selectedNodeSummary || (vizState && vizState.perLayerActivation.length > 0)) && (
          <div className="px-3 py-1.5 border-t border-slate-800/70 bg-[#070a13] flex items-center justify-between gap-2 text-[10px] font-mono text-slate-400">
            <span className="truncate">{selectedNodeSummary ?? 'Click any node to inspect synaptic paths'}</span>
            {vizState && (
              <div className="flex items-center gap-1 shrink-0">
                {vizState.perLayerActivation.map((act, idx) => (
                  <span key={idx} className="px-1 py-0.5 rounded bg-slate-900 text-cyan-300 tabular-nums">
                    L{idx}:{(act * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Neural Region Inspector */}
      {!vizExpanded && (
        <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 shrink-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              <span>Neural Cortex Regions</span>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {activeRegion ? `${activeRegion.load}% load` : ''}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {regions.map((reg) => {
              const selected = reg.id === activeRegion?.id;
              return (
                <button
                  key={reg.id}
                  type="button"
                  onClick={() => {
                    onSelectRegion(reg.id);
                    const layerTarget =
                      reg.id === 'reasoning-cortex'
                        ? 'thinking:0.85@layer2'
                        : reg.id === 'memory-lattice'
                          ? 'memory:0.85'
                          : reg.id === 'planning-engine'
                            ? 'query:0.9@layer1'
                            : reg.id === 'tool-bus'
                              ? 'tool:0.9'
                              : 'warning@layer3';
                    vizRef.current?.updateActivity(layerTarget);
                  }}
                  className={`px-2 py-1 text-[11px] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selected
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50'
                      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {reg.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Directives */}
      <div className="flex flex-wrap gap-1.5 shrink-0">
        {QUICK_DIRECTIVES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => void handleSubmit(q)}
            className="text-left text-[11px] px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-200 transition-colors cursor-pointer"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Conversation Transcript */}
      <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-2.5 pr-1">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg p-3 text-sm leading-relaxed border ${
              m.sender === 'operator'
                ? 'bg-slate-900/90 border-slate-700 text-slate-100 ml-8'
                : m.sender === 'error'
                  ? 'bg-red-950/40 border-red-800/60 text-red-200 mr-4'
                  : 'bg-[#0F172A] border-slate-800 text-slate-200 mr-4'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>{m.sender === 'operator' ? 'Operator' : m.sender === 'error' ? 'System Notice' : 'Central Intelligence'}</span>
              {m.meta && <span className="font-mono tabular-nums">{m.meta}</span>}
            </div>
            <p className="whitespace-pre-wrap text-xs">{m.text}</p>
          </div>
        ))}
      </div>

      {/* Input & Voice Controls */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="border-t border-slate-800 pt-2.5 flex flex-col gap-2 shrink-0"
      >
        <div className="flex items-center justify-between text-xs text-slate-400">
          <label htmlFor="neural-link-input">Directive Input</label>
          <button
            type="button"
            onClick={() => {
              const next = !autoSpeak;
              setAutoSpeak(next);
              if (!next) stopSpeaking();
            }}
            className="flex items-center gap-1.5 text-slate-300 hover:text-cyan-300 cursor-pointer"
          >
            {autoSpeak ? <Volume2 className="w-3.5 h-3.5 text-cyan-400" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>{autoSpeak ? 'Voice Reply On' : 'Voice Reply Off'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="neural-link-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Command Central Intelligence or ask for system status..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
          />
          {isSpeechRecognitionSupported() && (
            <button
              type="button"
              onClick={toggleVoiceCapture}
              aria-label={voiceActive ? 'Stop voice capture' : 'Start voice command'}
              className={`p-2.5 rounded-lg border transition-colors cursor-pointer ${
                voiceActive
                  ? 'bg-red-500/20 border-red-400 text-red-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-cyan-400'
              }`}
            >
              {voiceActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-sm hover:bg-cyan-400 disabled:opacity-40 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>{busy ? 'Thinking...' : 'Execute'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
