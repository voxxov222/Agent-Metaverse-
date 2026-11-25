import { useState, type FormEvent } from 'react';
import {
  Activity,
  BellPlus,
  Box,
  Cpu,
  Flame,
  Mic,
  MicOff,
  Network,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  JarvisDomainId,
  JarvisHologramConfig,
  JarvisHologramModelId,
  JarvisOrbState,
  JarvisReminder,
} from '../../types/os';
import type { JarvisDomainLogEntry, NetworkTopologySnapshot } from '../../server/jarvisCommandEngine';
import type { HostWorkstationMetrics } from '../../server/workstationMetrics';
import { JARVIS_DOMAINS, JARVIS_ORB_COLORS, type JarvisBiometricsState } from '../../utils/jarvisOperationsLogic';
import { startVoiceRecognition, type VoiceListenerHandle } from '../../utils/voiceEngine';

interface JarvisCommandDeckProps {
  orbState: JarvisOrbState;
  orbLabel: string;
  hologram: JarvisHologramConfig;
  reminders: JarvisReminder[];
  networkTopology: NetworkTopologySnapshot | null;
  latestDiagnostics: {
    metrics: HostWorkstationMetrics;
    summary: string;
    activeAgents: number;
    runningTasks: number;
  } | null;
  domainLog: JarvisDomainLogEntry[];
  biometrics: JarvisBiometricsState;
  isOffline: boolean;
  onDispatch: (prompt: string, domain: JarvisDomainId) => Promise<void>;
  onUpdateHologram: (patch: {
    model?: JarvisHologramModelId;
    explodeFactor?: number;
    heatmap?: boolean;
    scanSubnet?: boolean;
  }) => Promise<void>;
  onCreateReminder: (title: string, when: string) => Promise<void>;
  onDeleteReminder: (id: string) => Promise<void>;
  onSetOrbState: (state: JarvisOrbState, label?: string) => void;
  onFocusCoreIn3D: () => void;
}

type DeckTab = 'swarm' | 'hologram' | 'biometrics';

export function JarvisCommandDeck({
  orbState,
  orbLabel,
  hologram,
  reminders,
  networkTopology,
  latestDiagnostics,
  domainLog,
  biometrics,
  isOffline,
  onDispatch,
  onUpdateHologram,
  onCreateReminder,
  onDeleteReminder,
  onSetOrbState,
  onFocusCoreIn3D,
}: JarvisCommandDeckProps) {
  const [tab, setTab] = useState<DeckTab>('swarm');
  const [domain, setDomain] = useState<JarvisDomainId>('core');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [remTitle, setRemTitle] = useState('');
  const [remWhen, setRemWhen] = useState('in 15s');

  const orbMeta = JARVIS_ORB_COLORS[orbState] ?? JARVIS_ORB_COLORS.idle;

  async function handleSubmitPrompt(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await onDispatch(prompt.trim(), domain);
      setPrompt('');
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickOp(cmd: string, targetDomain: JarvisDomainId) {
    if (busy) return;
    setDomain(targetDomain);
    setBusy(true);
    try {
      await onDispatch(cmd, targetDomain);
    } finally {
      setBusy(false);
    }
  }

  const [voiceHandle, setVoiceHandle] = useState<VoiceListenerHandle | null>(null);

  function handleVoiceInput() {
    if (listening && voiceHandle) {
      voiceHandle.stop();
      setVoiceHandle(null);
      setListening(false);
      onSetOrbState('idle', 'IDLE // READY');
      return;
    }
    setListening(true);
    onSetOrbState('listening', 'LISTENING');
    const handle = startVoiceRecognition(
      (text, isFinal) => {
        setPrompt(text);
        if (isFinal && text.trim()) {
          setListening(false);
          setVoiceHandle(null);
          void handleQuickOp(text, domain);
        }
      },
      () => {
        setListening(false);
        setVoiceHandle(null);
        onSetOrbState('idle', 'IDLE // READY');
      },
      () => {
        setListening(false);
        setVoiceHandle(null);
        if (orbState === 'listening') {
          onSetOrbState('idle', 'IDLE // READY');
        }
      },
    );
    setVoiceHandle(handle);
  }

  async function handleAddReminder(e: FormEvent) {
    e.preventDefault();
    if (!remTitle.trim() || isOffline) return;
    await onCreateReminder(remTitle.trim(), remWhen.trim() || 'in 15s');
    setRemTitle('');
  }

  return (
    <div className="flex flex-col h-full gap-3 text-xs">
      {/* JARVIS Brand Header Banner */}
      <div className="rounded-lg bg-[#0a192f] border border-[#00d2ff]/40 p-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-9 h-9 rounded-full overflow-hidden border-2 shrink-0 bg-[#040c18]"
            style={{ borderColor: orbMeta.inner }}
          >
            <img src="/assets/jarvis/jarvis_logo.png" alt="JARVIS Logo" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <div className="font-bold tracking-wider text-[#00d2ff] text-[12px] truncate">
              J.A.R.V.I.S // CENTRAL COMMAND
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              Intent Router · 3D Holo Projector · Host Diagnostics
            </div>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded border text-[10px] font-mono shrink-0 ${orbMeta.badgeClass}`}>
          {orbLabel || orbMeta.label}
        </span>
      </div>

      {/* 3 Sub-Tabs */}
      <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
        {(
          [
            ['swarm', 'Swarm & Intent'],
            ['hologram', '3D Hologram Lab'],
            ['biometrics', 'Biometrics & Tasks'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`py-1.5 px-2 rounded text-[11px] font-medium transition-colors cursor-pointer ${
              tab === key
                ? 'bg-[#00d2ff]/20 text-[#00d2ff] border border-[#00d2ff]/50'
                : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* TAB 1: Swarm & Bilingual Intent Engine */}
      {tab === 'swarm' && (
        <div className="flex-1 min-h-0 flex flex-col gap-2.5">
          {/* 8 Specialist Domains */}
          <div className="grid grid-cols-4 gap-1">
            {JARVIS_DOMAINS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDomain(d.id)}
                title={d.description}
                className={`px-1.5 py-1.5 rounded border text-left transition-colors cursor-pointer ${
                  domain === d.id
                    ? 'bg-[#00d2ff]/20 border-[#00d2ff] text-[#64ffda]'
                    : 'bg-[#0a192f]/80 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="font-semibold text-[10px] truncate">{d.label}</div>
                <div className="text-[9px] text-slate-400 truncate">{d.modelTag}</div>
              </button>
            ))}
          </div>

          {/* Instant Operations Strip */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy || isOffline}
              onClick={() => void handleQuickOp('Run stark diagnostics check', 'medical')}
              className="px-2 py-1 rounded bg-[#0a192f] border border-cyan-500/40 text-cyan-200 hover:border-cyan-300 text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Cpu className="w-3 h-3 text-[#00d2ff]" />
              <span>Stark Diagnostics</span>
            </button>
            <button
              type="button"
              disabled={busy || isOffline}
              onClick={() => {
                onFocusCoreIn3D();
                void handleQuickOp('Scan subnet network topology', 'security');
              }}
              className="px-2 py-1 rounded bg-[#0a192f] border border-emerald-500/40 text-emerald-200 hover:border-emerald-300 text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Network className="w-3 h-3 text-[#64ffda]" />
              <span>Subnet 3D Map</span>
            </button>
            <button
              type="button"
              disabled={busy || isOffline}
              onClick={() => {
                onFocusCoreIn3D();
                void handleQuickOp('Project stark gear hologram explode', 'engineering');
              }}
              className="px-2 py-1 rounded bg-[#0a192f] border border-purple-500/40 text-purple-200 hover:border-purple-300 text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Box className="w-3 h-3 text-purple-300" />
              <span>Holo: Stark Gear</span>
            </button>
            <button
              type="button"
              disabled={busy || isOffline}
              onClick={() => void handleQuickOp('/exec ls -la', 'development')}
              className="px-2 py-1 rounded bg-[#0a192f] border border-slate-700 text-slate-200 hover:border-cyan-400 text-[10px] cursor-pointer disabled:opacity-50"
            >
              <span>Sandbox Check</span>
            </button>
          </div>

          {/* Bilingual Directive Prompt */}
          <form onSubmit={handleSubmitPrompt} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleVoiceInput}
              aria-label="Voice command microphone"
              className={`p-2 rounded-lg border cursor-pointer shrink-0 ${
                listening
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-slate-950 border-slate-700 text-cyan-300 hover:border-cyan-400'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Command JARVIS (English / Hinglish / "/exec" / "remind ...")'
              className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100 placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={busy || !prompt.trim() || isOffline}
              className="px-3 py-2 rounded-lg bg-[#00d2ff] text-slate-950 font-semibold hover:bg-cyan-300 disabled:opacity-45 flex items-center gap-1 cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{busy ? 'Running' : 'Execute'}</span>
            </button>
          </form>

          {/* Agent Lab Execution Feed */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {domainLog.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-[#0a192f]/60 p-4 text-center text-slate-400">
                <Sparkles className="w-5 h-5 text-[#00d2ff] mx-auto mb-1.5" />
                JARVIS standing by. Run Stark Diagnostics, map the subnet, project a 3D hologram, or dispatch a domain directive.
              </div>
            ) : (
              domainLog.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-slate-800 bg-[#0a192f]/80 p-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="px-1.5 py-0.5 rounded bg-[#00d2ff]/15 text-[#00d2ff] font-mono uppercase">
                      {entry.domain} · {entry.operationKind}
                    </span>
                    <span className="text-slate-500 font-mono">
                      {entry.latencyMs ?? 0}ms · {new Date(entry.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[11px] font-medium text-slate-200">&gt; {entry.prompt}</div>
                  {entry.chainedSteps && entry.chainedSteps.length > 1 && (
                    <div className="flex flex-wrap gap-1">
                      {entry.chainedSteps.map((step, idx) => (
                        <span
                          key={idx}
                          className="px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-400/30 text-[9px] text-purple-200"
                        >
                          Step {idx + 1}: {step}
                        </span>
                      ))}
                    </div>
                  )}
                  <pre className="text-[11px] text-[#64ffda] whitespace-pre-wrap font-mono leading-relaxed bg-slate-950/70 rounded p-2 border border-slate-800/80">
                    {entry.reply}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: 3D Hologram Lab */}
      {tab === 'hologram' && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          <div className="rounded-lg border border-[#00d2ff]/35 bg-[#0a192f]/85 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#00d2ff]">Central Core Wireframe Projector</span>
              <button
                type="button"
                onClick={onFocusCoreIn3D}
                className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 text-[10px] hover:bg-cyan-500/30 cursor-pointer"
              >
                Focus 3D Core
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ['neural-lattice', 'Central Lattice'],
                  ['stark-gear', 'Stark Mark-VII Gear'],
                  ['methane', 'CH4 Molecular'],
                  ['network-topology', 'Subnet Topology'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    onFocusCoreIn3D();
                    void onUpdateHologram({ model: id });
                  }}
                  className={`py-2 px-2.5 rounded border text-left transition-colors cursor-pointer ${
                    hologram.model === id
                      ? 'bg-[#00d2ff]/20 border-[#00d2ff] text-[#64ffda]'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-semibold text-[11px]">{label}</div>
                  <div className="text-[9px] text-slate-400 font-mono">{id}</div>
                </button>
              ))}
            </div>

            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-300">Explode Assembly Factor</span>
                <span className="font-mono text-[#64ffda]">{Math.round(hologram.explodeFactor * 100)}%</span>
              </div>
              <input
                type="range"
                aria-label="Hologram Explode Factor"
                min={0}
                max={100}
                value={Math.round(hologram.explodeFactor * 100)}
                onChange={(e) => {
                  const factor = Number(e.target.value) / 100;
                  void onUpdateHologram({ explodeFactor: factor });
                }}
                className="w-full accent-[#00d2ff]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => void onUpdateHologram({ heatmap: !hologram.heatmap })}
                className={`py-1.5 px-2.5 rounded border flex items-center justify-center gap-1.5 cursor-pointer font-medium ${
                  hologram.heatmap
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-amber-400/50'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Thermal Heatmap: {hologram.heatmap ? 'ON' : 'OFF'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onFocusCoreIn3D();
                  void onUpdateHologram({ scanSubnet: true });
                }}
                className="py-1.5 px-2.5 rounded border border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 flex items-center justify-center gap-1.5 cursor-pointer font-medium"
              >
                <Network className="w-3.5 h-3.5" />
                <span>Scan Subnet</span>
              </button>
            </div>
          </div>

          {/* Live Network Topology Nodes */}
          <div className="rounded-lg border border-slate-800 bg-[#0a192f]/75 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-slate-200">
                Mapped Subnet Nodes ({networkTopology?.nodes.length ?? 0})
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                Host: {networkTopology?.hostname ?? 'local'}
              </span>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
              {(networkTopology?.nodes ?? []).map((n) => (
                <div
                  key={n.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-[11px]"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-slate-200">{n.label}</span>
                    <span className="ml-2 font-mono text-[10px] text-slate-400">{n.ip}</span>
                  </div>
                  <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-[#64ffda] font-mono text-[9px]">
                    {n.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Biometrics, Stark Vitals & Reminders */}
      {tab === 'biometrics' && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {/* Operator Cognitive Biometrics (real browser cadence) */}
          <div className="rounded-lg border border-slate-800 bg-[#0a192f]/85 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#00d2ff] flex items-center gap-1.5">
                <Activity className="w-4 h-4" />
                <span>Operator Biometric Telemetry</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                  biometrics.statusLabel === 'NOMINAL'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {biometrics.statusLabel}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Cognitive Focus Index</span>
                <span className="font-mono text-[#64ffda]">{biometrics.focusScore}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-[#64ffda] transition-all"
                  style={{ width: `${biometrics.focusScore}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <div className="rounded bg-slate-950 border border-slate-800 p-2">
                <div className="text-[10px] text-slate-400">Keystroke Cadence</div>
                <div className="font-mono text-sm font-bold text-slate-100">{biometrics.typingCpm} CPM</div>
              </div>
              <div className="rounded bg-slate-950 border border-slate-800 p-2">
                <div className="text-[10px] text-slate-400">Attention Guard</div>
                <div className="font-mono text-sm font-bold text-emerald-300">
                  {biometrics.postureNominal ? 'ENGAGED' : 'BREAK ADVISED'}
                </div>
              </div>
            </div>
          </div>

          {/* Host Stark Diagnostics */}
          <div className="rounded-lg border border-slate-800 bg-[#0a192f]/85 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-[#00d2ff]" />
                <span>Host System Vitals</span>
              </span>
              <button
                type="button"
                onClick={() => void handleQuickOp('Run stark diagnostics check', 'medical')}
                className="px-2 py-1 rounded bg-[#00d2ff]/20 border border-[#00d2ff]/60 text-[#00d2ff] text-[10px] hover:bg-[#00d2ff]/30 cursor-pointer"
              >
                Run Stark Sweep
              </button>
            </div>
            {latestDiagnostics ? (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-slate-950 border border-slate-800 p-2">
                  <div className="text-[10px] text-slate-400">CPU Load ({latestDiagnostics.metrics.cpuCores} Cores)</div>
                  <div className="font-mono font-bold text-[#64ffda]">{latestDiagnostics.metrics.cpuPct}%</div>
                </div>
                <div className="rounded bg-slate-950 border border-slate-800 p-2">
                  <div className="text-[10px] text-slate-400">Memory Allocation</div>
                  <div className="font-mono font-bold text-slate-100">
                    {latestDiagnostics.metrics.ramUsedGb}/{latestDiagnostics.metrics.ramTotalGb} GB
                  </div>
                </div>
                <div className="rounded bg-slate-950 border border-slate-800 p-2">
                  <div className="text-[10px] text-slate-400">Core Temp</div>
                  <div className="font-mono font-bold text-amber-300">{latestDiagnostics.metrics.tempC}°C</div>
                </div>
                <div className="rounded bg-slate-950 border border-slate-800 p-2">
                  <div className="text-[10px] text-slate-400">Disk Used</div>
                  <div className="font-mono font-bold text-slate-100">{latestDiagnostics.metrics.diskPct}%</div>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400">
                Click &ldquo;Run Stark Sweep&rdquo; to inspect host CPU, RAM, thermal, and agent mesh status.
              </div>
            )}
          </div>

          {/* Natural-Time Reminders & Temporal Scheduler */}
          <form onSubmit={handleAddReminder} className="rounded-lg border border-slate-800 bg-[#0a192f]/85 p-3 space-y-2">
            <div className="font-semibold text-slate-200 flex items-center gap-1.5">
              <BellPlus className="w-4 h-4 text-[#64ffda]" />
              <span>Temporal Scheduler & HUD Reminders</span>
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={remTitle}
                onChange={(e) => setRemTitle(e.target.value)}
                placeholder="Reminder label (e.g. Inspect Core)"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
              />
              <input
                type="text"
                value={remWhen}
                onChange={(e) => setRemWhen(e.target.value)}
                placeholder="in 10s / at 14:30"
                className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-cyan-200 font-mono"
              />
              <button
                type="submit"
                disabled={!remTitle.trim() || isOffline}
                className="px-2.5 py-1.5 rounded bg-[#00d2ff] text-slate-950 font-semibold hover:bg-cyan-300 disabled:opacity-45 cursor-pointer"
              >
                Arm
              </button>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {reminders.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-[11px]"
                >
                  <div className="min-w-0">
                    <span className={r.fired ? 'text-amber-300 line-through' : 'text-slate-200'}>{r.title}</span>
                    <span className="ml-2 font-mono text-[10px] text-slate-400">
                      {r.fired ? 'FIRED' : new Date(r.dueAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete reminder"
                    onClick={() => void onDeleteReminder(r.id)}
                    className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
