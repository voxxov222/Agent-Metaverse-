import { useEffect, useRef, useState } from 'react';
import { Activity, Bot, Plus, Send, Volume2, Sliders, Shield } from 'lucide-react';
import type { AgentProfile, AutonomyLevel } from '../../types/os';
import { NeuralNetworkView, type NeuralNetworkVizHandle } from '../../viz';
import { speakWithProfile } from '../../utils/voiceEngine';
import {
  appendAgentSparklineSample,
  computeAgentThroughputMetrics,
  type AgentSparklineHistoryMap,
} from '../../utils/agentSparklines';
import { AgentMetricsSparklineOverlay } from './AgentMetricsSparklineOverlay';

interface AgentStudioPanelProps {
  agents: AgentProfile[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onFocusAgentIn3D: (id: string) => void;
  onUpdateAgent: (id: string, patch: Partial<AgentProfile>) => Promise<void>;
  onCreateAgent: (payload: Partial<AgentProfile>) => Promise<void>;
  onChatWithAgent: (id: string, message: string) => Promise<{ reply: string; tokens?: number; latencyMs?: number }>;
  isOffline: boolean;
}

export function AgentStudioPanel({
  agents,
  selectedAgentId,
  onSelectAgent,
  onFocusAgentIn3D,
  onUpdateAgent,
  onCreateAgent,
  onChatWithAgent,
  isOffline,
}: AgentStudioPanelProps) {
  const activeAgent = agents.find((a) => a.id === selectedAgentId) ?? agents[0];
  const agentBrainRef = useRef<NeuralNetworkVizHandle | null>(null);
  const [tab, setTab] = useState<'interact' | 'customize' | 'permissions' | 'create'>('interact');
  const [chatMsg, setChatMsg] = useState('');
  const [chatLog, setChatLog] = useState<Array<{ from: string; text: string }>>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [showMetricsOverlay, setShowMetricsOverlay] = useState(true);
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const [sparkHistory, setSparkHistory] = useState<AgentSparklineHistoryMap>({});
  const prevMetricSampleRef = useRef<Record<string, { tokensUsed: number; timestamp: number }>>({});

  // Track rolling tokens/sec & latency samples from AgentProfile.metrics
  useEffect(() => {
    const now = Date.now();
    setSparkHistory((prev) => {
      let next = prev;
      for (const agent of agents) {
        const prevSample = prevMetricSampleRef.current[agent.id] ?? null;
        const derived = computeAgentThroughputMetrics(agent, prevSample, now);
        next = appendAgentSparklineSample(
          next,
          agent,
          {
            timestamp: now,
            tokensPerSec: derived.tokensPerSec,
            latencyMs: derived.latencyMs,
          },
          20,
        );
        prevMetricSampleRef.current[agent.id] = {
          tokensUsed: agent.metrics.tokensUsed,
          timestamp: now,
        };
      }
      return next;
    });
  }, [agents]);

  // Sync live agent status into the agent's holographic NeuralNetworkViz brain
  useEffect(() => {
    if (!activeAgent || !agentBrainRef.current) return;
    const statusMap: Record<AgentProfile['status'], string> = {
      idle: 'idle',
      reasoning: 'thinking:0.88',
      executing: 'tool:0.92',
      collaborating: 'query:0.85',
      'awaiting-approval': 'warning:0.8',
      error: 'error@layer2',
    };
    agentBrainRef.current.updateActivity(statusMap[activeAgent.status] ?? 'idle');
  }, [activeAgent?.id, activeAgent?.status]);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newExpertise, setNewExpertise] = useState('research, automation, typescript');
  const [newPersonality, setNewPersonality] = useState('Analytical, proactive, and safety-conscious');
  const [newAutonomy, setNewAutonomy] = useState<AutonomyLevel>('SUPERVISED');
  const [newAccent, setNewAccent] = useState('#22D3EE');

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!activeAgent || !chatMsg.trim() || chatBusy) return;
    const text = chatMsg.trim();
    setChatMsg('');
    setChatLog((prev) => [...prev, { from: 'Operator', text }]);

    if (isOffline) {
      setChatLog((prev) => [
        ...prev,
        { from: 'System', text: 'Offline mode: direct AI inference paused until reconnection.' },
      ]);
      return;
    }

    setChatBusy(true);
    agentBrainRef.current?.updateActivity(['query:0.9', 'thinking:0.85']);
    try {
      const res = await onChatWithAgent(activeAgent.id, text);
      agentBrainRef.current?.updateActivity(['response:0.9', 'success:0.8']);
      setChatLog((prev) => [...prev, { from: activeAgent.name, text: res.reply }]);
    } catch (err) {
      agentBrainRef.current?.updateActivity('error@layer2');
      setChatLog((prev) => [
        ...prev,
        { from: 'Error', text: err instanceof Error ? err.message : 'Agent request failed.' },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newRole.trim()) return;
    await onCreateAgent({
      name: newName.trim(),
      role: newRole.trim(),
      expertise: newExpertise.split(',').map((s) => s.trim()).filter(Boolean),
      personality: newPersonality.trim(),
      autonomy: newAutonomy,
      appearance: {
        chassisColor: '#1E293B',
        accentColor: newAccent,
        visorColor: newAccent,
        wardrobeStyle: 'tactical-coat',
        expression: 'focused',
        heightScale: 1.0,
        shoulderWidth: 1.0,
      },
    });
    setNewName('');
    setNewRole('');
    setTab('interact');
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Roster Selector */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 vca-scroll">
        {agents.map((a) => {
          const active = a.id === activeAgent?.id;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onSelectAgent(a.id);
                onFocusAgentIn3D(a.id);
              }}
              className={`px-3 py-2 rounded-lg border text-left shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-slate-800 border-cyan-400/70 text-slate-100'
                  : 'bg-[#0F1524] border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2 text-xs font-semibold">
                <span
                  className="inline-block w-2 h-2 rounded-sm"
                  style={{ backgroundColor: a.appearance.accentColor }}
                />
                <span>{a.name}</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {a.role} · {a.status}
              </div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setTab('create')}
          className="px-3 py-2 rounded-lg border border-dashed border-slate-700 text-xs text-cyan-300 hover:border-cyan-400 shrink-0 flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Agent</span>
        </button>
      </div>

      {/* Sub-Tabs & Metrics Sparkline Overlay Toggle */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
          {(['interact', 'customize', 'permissions', 'create'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 px-2 text-xs font-medium rounded-md capitalize transition-colors cursor-pointer ${
                tab === t ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t === 'interact' ? 'Operate' : t === 'customize' ? '3D & Voice' : t === 'permissions' ? 'Autonomy' : 'Create'}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Toggle Metrics Sparkline Overlay"
          aria-pressed={showMetricsOverlay}
          onClick={() => {
            setShowMetricsOverlay((prev) => !prev);
            setOverlayExpanded(false);
          }}
          className={`px-2.5 py-2 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors ${
            showMetricsOverlay
              ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200'
              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Sparklines</span>
        </button>
      </div>

      {/* Main Studio Body (relative container for expandable Metrics Sparkline Visual Overlay) */}
      <div className="relative flex-1 min-h-0 flex flex-col gap-3">
        {showMetricsOverlay && (
          <AgentMetricsSparklineOverlay
            agents={agents}
            selectedAgentId={activeAgent?.id ?? null}
            history={sparkHistory}
            expanded={overlayExpanded}
            onToggleExpand={() => setOverlayExpanded((prev) => !prev)}
            onClose={() => {
              setShowMetricsOverlay(false);
              setOverlayExpanded(false);
            }}
            onSelectAgent={(id) => {
              onSelectAgent(id);
              onFocusAgentIn3D(id);
            }}
          />
        )}

      {/* Tab Content */}
      {tab === 'interact' && activeAgent && (
        <div className="flex-1 min-h-0 flex flex-col gap-2.5">
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-2.5 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-slate-100">{activeAgent.name}</span>
              <span className="font-mono text-cyan-300">{activeAgent.autonomy}</span>
            </div>
            <p className="text-slate-300 truncate">{activeAgent.personality}</p>
            <div className="text-slate-400 font-mono tabular-nums">
              Completed: {activeAgent.metrics.tasksCompleted} · Tokens: {activeAgent.metrics.tokensUsed} · Latency: {activeAgent.metrics.avgLatencyMs}ms
            </div>
            <div className="pt-0.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  speakWithProfile(
                    `${activeAgent.name}, ${activeAgent.role}, standing by. Current objective: ${activeAgent.currentObjective}`,
                    activeAgent.voice,
                  )
                }
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Test Voice Synthesis</span>
              </button>
              <button
                type="button"
                onClick={() => onFocusAgentIn3D(activeAgent.id)}
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                Focus in 3D
              </button>
            </div>
          </div>

          {/* Agent Cognitive Neural Mesh */}
          <div className={`${showMetricsOverlay ? 'h-20' : 'h-28'} rounded-lg border border-slate-800 overflow-hidden bg-[#05060f] shrink-0 relative`}>
            <NeuralNetworkView
              ref={agentBrainRef}
              options={{ nodeCount: 72, seed: activeAgent.name.length * 97 + 13, enableBloom: false }}
            />
            <div className="pointer-events-none absolute top-1.5 left-2.5 text-[10px] font-mono text-cyan-300/90">
              {activeAgent.name} Cortex · {activeAgent.status}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-2 pr-1">
            {chatLog.length === 0 ? (
              <div className="text-xs text-slate-400 border border-slate-800/80 rounded-lg p-3">
                Direct channel open with {activeAgent.name}. Assign a task or request an analysis.
              </div>
            ) : (
              chatLog.map((c, i) => (
                <div key={i} className="rounded-lg bg-slate-900 border border-slate-800 p-2.5 text-xs">
                  <div className="text-slate-400 font-medium mb-1">{c.from}</div>
                  <div className="text-slate-200 whitespace-pre-wrap">{c.text}</div>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSendChat} className="flex gap-2">
            <label htmlFor="agent-chat-input" className="sr-only">
              Message {activeAgent.name}
            </label>
            <input
              id="agent-chat-input"
              type="text"
              value={chatMsg}
              onChange={(e) => setChatMsg(e.target.value)}
              placeholder={`Message ${activeAgent.name}...`}
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={chatBusy || !chatMsg.trim()}
              className="px-3.5 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs hover:bg-cyan-400 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{chatBusy ? 'Running' : 'Send'}</span>
            </button>
          </form>
        </div>
      )}

      {tab === 'customize' && activeAgent && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-4 pr-1 text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <span>Live 3D Character & Voice Customization</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="wardrobe-select" className="block text-slate-400 mb-1">
                Wardrobe Silhouette
              </label>
              <select
                id="wardrobe-select"
                value={activeAgent.appearance.wardrobeStyle}
                onChange={(e) =>
                  void onUpdateAgent(activeAgent.id, {
                    appearance: {
                      ...activeAgent.appearance,
                      wardrobeStyle: e.target.value as AgentProfile['appearance']['wardrobeStyle'],
                    },
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
              >
                <option value="tactical-coat">Tactical Coat</option>
                <option value="architect-robe">Architect Robe</option>
                <option value="chassis-shell">Armored Chassis</option>
                <option value="executive-suit">Executive Suit</option>
              </select>
            </div>

            <div>
              <label htmlFor="expression-select" className="block text-slate-400 mb-1">
                Expression State
              </label>
              <select
                id="expression-select"
                value={activeAgent.appearance.expression}
                onChange={(e) =>
                  void onUpdateAgent(activeAgent.id, {
                    appearance: {
                      ...activeAgent.appearance,
                      expression: e.target.value as AgentProfile['appearance']['expression'],
                    },
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
              >
                <option value="focused">Focused</option>
                <option value="analytical">Analytical</option>
                <option value="alert">Alert</option>
                <option value="calm">Calm</option>
              </select>
            </div>

            <div>
              <label htmlFor="chassis-color" className="block text-slate-400 mb-1">
                Chassis / Wardrobe Color
              </label>
              <input
                id="chassis-color"
                type="color"
                value={activeAgent.appearance.chassisColor}
                onChange={(e) =>
                  void onUpdateAgent(activeAgent.id, {
                    appearance: { ...activeAgent.appearance, chassisColor: e.target.value },
                  })
                }
                className="w-full h-9 bg-slate-950 border border-slate-700 rounded p-1 cursor-pointer"
              />
            </div>

            <div>
              <label htmlFor="accent-color" className="block text-slate-400 mb-1">
                Trim & Visor Glow Color
              </label>
              <input
                id="accent-color"
                type="color"
                value={activeAgent.appearance.accentColor}
                onChange={(e) =>
                  void onUpdateAgent(activeAgent.id, {
                    appearance: {
                      ...activeAgent.appearance,
                      accentColor: e.target.value,
                      visorColor: e.target.value,
                    },
                  })
                }
                className="w-full h-9 bg-slate-950 border border-slate-700 rounded p-1 cursor-pointer"
              />
            </div>
          </div>

          <div className="space-y-3 border-t border-slate-800 pt-3">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <label htmlFor="height-scale">Height Proportion</label>
                <span className="font-mono tabular-nums">{activeAgent.appearance.heightScale.toFixed(2)}x</span>
              </div>
              <input
                id="height-scale"
                type="range"
                min="0.85"
                max="1.2"
                step="0.02"
                value={activeAgent.appearance.heightScale}
                onChange={(e) =>
                  void onUpdateAgent(activeAgent.id, {
                    appearance: { ...activeAgent.appearance, heightScale: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <label htmlFor="shoulder-scale">Shoulder Proportion</label>
                <span className="font-mono tabular-nums">{activeAgent.appearance.shoulderWidth.toFixed(2)}x</span>
              </div>
              <input
                id="shoulder-scale"
                type="range"
                min="0.85"
                max="1.25"
                step="0.02"
                value={activeAgent.appearance.shoulderWidth}
                onChange={(e) =>
                  void onUpdateAgent(activeAgent.id, {
                    appearance: { ...activeAgent.appearance, shoulderWidth: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <label htmlFor="voice-pitch">Voice Pitch</label>
                <span className="font-mono tabular-nums">{activeAgent.voice.pitch.toFixed(2)}</span>
              </div>
              <input
                id="voice-pitch"
                type="range"
                min="0.65"
                max="1.45"
                step="0.05"
                value={activeAgent.voice.pitch}
                onChange={(e) =>
                  void onUpdateAgent(activeAgent.id, {
                    voice: { ...activeAgent.voice, pitch: Number(e.target.value) },
                  })
                }
                className="w-full accent-cyan-400"
              />
            </div>

            <div>
              <label htmlFor="agent-personality" className="block text-slate-400 mb-1">
                Personality & Behavioral Instructions
              </label>
              <textarea
                id="agent-personality"
                rows={3}
                value={activeAgent.systemPrompt}
                onChange={(e) => void onUpdateAgent(activeAgent.id, { systemPrompt: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-slate-100"
              />
            </div>
          </div>
        </div>
      )}

      {tab === 'permissions' && activeAgent && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1 text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Shield className="w-4 h-4 text-amber-400" />
            <span>Autonomy Level & Capability Permissions</span>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {(['ASSISTED', 'SUPERVISED', 'AUTONOMOUS'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => void onUpdateAgent(activeAgent.id, { autonomy: lvl })}
                className={`py-2 px-2 rounded border font-mono text-[11px] cursor-pointer ${
                  activeAgent.autonomy === lvl
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          <div className="space-y-2 border-t border-slate-800 pt-3">
            {(
              [
                ['terminalRead', 'Terminal & Workspace Read'],
                ['terminalWrite', 'Terminal & Code Write (Sandboxed)'],
                ['webBrowse', 'Headless Web Intelligence'],
                ['sendEmail', 'Email Draft / Dispatch'],
                ['sendSms', 'SMS Messaging'],
                ['makeCalls', 'Telephony Voice Calls'],
                ['codeDeploy', 'Release Deployment (Approval Gated)'],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between p-2 rounded bg-slate-900/70 border border-slate-800 cursor-pointer"
              >
                <span className="text-slate-200">{label}</span>
                <input
                  type="checkbox"
                  checked={activeAgent.permissions[key]}
                  onChange={(e) =>
                    void onUpdateAgent(activeAgent.id, {
                      permissions: { ...activeAgent.permissions, [key]: e.target.checked },
                    })
                  }
                  className="accent-cyan-400 w-4 h-4"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === 'create' && (
        <form onSubmit={handleCreateSubmit} className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1 text-xs">
          <div className="flex items-center gap-2 text-slate-200 font-medium">
            <Bot className="w-4 h-4 text-cyan-400" />
            <span>Provision Custom 3D Autonomous Agent</span>
          </div>
          <div>
            <label htmlFor="new-agent-name" className="block text-slate-400 mb-1">
              Agent Designation
            </label>
            <input
              id="new-agent-name"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Orion-06"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="new-agent-role" className="block text-slate-400 mb-1">
              Specialized Role
            </label>
            <input
              id="new-agent-role"
              required
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              placeholder="e.g. Data Visualization Specialist"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="new-agent-skills" className="block text-slate-400 mb-1">
              Expertise Tags (comma-separated)
            </label>
            <input
              id="new-agent-skills"
              value={newExpertise}
              onChange={(e) => setNewExpertise(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="new-agent-autonomy" className="block text-slate-400 mb-1">
                Autonomy Level
              </label>
              <select
                id="new-agent-autonomy"
                value={newAutonomy}
                onChange={(e) => setNewAutonomy(e.target.value as AutonomyLevel)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-2 text-slate-100"
              >
                <option value="ASSISTED">ASSISTED</option>
                <option value="SUPERVISED">SUPERVISED</option>
                <option value="AUTONOMOUS">AUTONOMOUS</option>
              </select>
            </div>
            <div>
              <label htmlFor="new-agent-accent" className="block text-slate-400 mb-1">
                3D Accent Color
              </label>
              <input
                id="new-agent-accent"
                type="color"
                value={newAccent}
                onChange={(e) => setNewAccent(e.target.value)}
                className="w-full h-9 bg-slate-950 border border-slate-700 rounded p-1"
              />
            </div>
          </div>
          <div>
            <label htmlFor="new-agent-personality" className="block text-slate-400 mb-1">
              Personality Profile
            </label>
            <textarea
              id="new-agent-personality"
              rows={2}
              value={newPersonality}
              onChange={(e) => setNewPersonality(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100"
            />
          </div>
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 transition-colors cursor-pointer"
          >
            Deploy Agent to 3D Floor
          </button>
        </form>
      )}
      </div>
    </div>
  );
}
