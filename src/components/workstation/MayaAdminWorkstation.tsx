import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Cpu,
  FolderKanban,
  Globe2,
  Lock,
  Mic,
  MicOff,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Unlock,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { GodsEyeGlobeView } from './GodsEyeGlobeView';
import type {
  ActivityLogEntry,
  AgentProfile,
  AutonomyLevel,
  FinancialRequest,
  MemoryItem,
  NeuralRegion,
  NeuralRegionId,
  OutboundCommDraft,
  ProjectRecord,
  SystemTelemetry,
} from '../../types/os';
import type { HostWorkstationMetrics } from '../../server/workstationMetrics';
import {
  createMayaParticles,
  getMetricColorTier,
  loadLocalWorkstationPrefs,
  parseWorkstationCommand,
  saveLocalWorkstationPrefs,
  stepMayaParticles,
  type LocalWorkstationPrefs,
  type MayaParticle,
} from '../../utils/mayaWorkstationLogic';
import {
  isSpeechRecognitionSupported,
  speakWithProfile,
  startVoiceRecognition,
  stopSpeaking,
  type VoiceListenerHandle,
} from '../../utils/voiceEngine';
import { createHaloCommand, dispatchHaloCommand } from '../../../packages/halo';

interface MayaAdminWorkstationProps {
  open: boolean;
  onClose: () => void;
  agents: AgentProfile[];
  projects: ProjectRecord[];
  regions: NeuralRegion[];
  telemetry: SystemTelemetry | null;
  activityLogs: ActivityLogEntry[];
  memories: MemoryItem[];
  commDrafts: OutboundCommDraft[];
  financialRequests: FinancialRequest[];
  vaultClaimed: boolean;
  sessionRole: string | null;
  isOffline: boolean;
  reducedMotion: boolean;
  onUnlockVault: (passcode: string, role: 'Admin' | 'Operator' | 'Viewer') => Promise<void>;
  onSendCentralCommand: (prompt: string) => Promise<{ reply: string; tokens?: number; latencyMs?: number }>;
  onChatWithAgent: (agentId: string, prompt: string) => Promise<{ reply: string }>;
  onUpdateAgent: (id: string, patch: Partial<AgentProfile>) => Promise<void>;
  onCreateProject: (objective: string) => Promise<void>;
  onApproveTask: (projectId: string, taskId: string) => Promise<void>;
  onDecideComm: (id: string, decision: 'approve' | 'reject') => Promise<void>;
  onDecideFinance: (id: string, decision: 'approve' | 'reject') => Promise<void>;
  onFocusAgentIn3D: (agentId: string) => void;
  onFocusRegionIn3D: (regionId: NeuralRegionId) => void;
  onFocusAdminRigIn3D: () => void;
}

type DeckTab = 'hud' | 'gods-eye' | 'terminal' | 'agents' | 'projects' | 'systems';

interface ConsoleEntry {
  id: string;
  source: 'admin' | 'maya' | 'agent' | 'shell' | 'error';
  title: string;
  body: string;
  meta?: string;
}

const STATUS_MESSAGES = [
  '● MAYA ONLINE',
  '● SYSTEM READY',
  '● MONITORING ACTIVE',
  '● AI OPERATIONAL',
];

export function MayaAdminWorkstation({
  open,
  onClose,
  agents,
  projects,
  regions,
  telemetry,
  activityLogs,
  commDrafts,
  financialRequests,
  vaultClaimed,
  sessionRole,
  isOffline,
  reducedMotion,
  onUnlockVault,
  onSendCentralCommand,
  onChatWithAgent,
  onUpdateAgent,
  onCreateProject,
  onApproveTask,
  onDecideComm,
  onDecideFinance,
  onFocusAgentIn3D,
  onFocusRegionIn3D,
  onFocusAdminRigIn3D,
}: MayaAdminWorkstationProps) {
  const [prefs, setPrefs] = useState<LocalWorkstationPrefs>(() => loadLocalWorkstationPrefs());
  const [deckTab, setDeckTab] = useState<DeckTab>('hud');
  const [hostMetrics, setHostMetrics] = useState<HostWorkstationMetrics | null>(null);
  const [nowClock, setNowClock] = useState(() => new Date());
  const [statusIdx, setStatusIdx] = useState(0);

  // Audio / Mic / AI Amplitude reactivity
  const [micActive, setMicActive] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [orbAmplitude, setOrbAmplitude] = useState(0.08);
  const voiceListenerRef = useRef<VoiceListenerHandle | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Command & Terminal State
  const [commandInput, setCommandInput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>(() => agents[0]?.id ?? '');
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [projectInput, setProjectInput] = useState('');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [lockError, setLockError] = useState('');
  const [consoleFeed, setConsoleFeed] = useState<ConsoleEntry[]>([
    {
      id: 'boot-maya',
      source: 'maya',
      title: 'MAYA ADMIN WORKSTATION ONLINE',
      body: 'Bound locally to Admin Main Computer. Issue directives, run /exec <cmd>, @<agent> <task>, /project <goal>, or /focus <region>.',
      meta: 'LOCAL HOST SCOPE',
    },
  ]);

  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<MayaParticle[]>([]);
  const ampRef = useRef(0.08);
  const micRef = useRef(0);
  ampRef.current = orbAmplitude;
  micRef.current = micLevel;

  useEffect(() => {
    saveLocalWorkstationPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!selectedAgentId && agents[0]?.id) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  // Escape key closes Admin Workstation window
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Live 1s Clock & 3s AI Status rotation
  useEffect(() => {
    if (!open) return;
    const clockTimer = window.setInterval(() => setNowClock(new Date()), 1000);
    const statusTimer = window.setInterval(
      () => setStatusIdx((prev) => (prev + 1) % STATUS_MESSAGES.length),
      3000,
    );
    return () => {
      window.clearInterval(clockTimer);
      window.clearInterval(statusTimer);
    };
  }, [open]);

  // Real Host Hardware Metrics Polling (/api/workstation/metrics)
  useEffect(() => {
    if (!open || isOffline) return;
    let alive = true;
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/workstation/metrics');
        if (!res.ok) return;
        const data = (await res.json()) as { metrics?: HostWorkstationMetrics };
        if (alive && data.metrics) {
          setHostMetrics(data.metrics);
        }
      } catch {
        // Ignore transient offline error
      }
    };
    void fetchMetrics();
    const timer = window.setInterval(fetchMetrics, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open, isOffline]);

  // Real Microphone RMS Audio Capture (Web Audio API)
  useEffect(() => {
    if (!open || !micActive) {
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      setMicLevel(0);
      return;
    }

    let cancelled = false;
    let rafId = 0;

    async function startMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const sample = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(dataArray);
          let sumSq = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const norm = (dataArray[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          const boosted = Math.min(1, rms * 3.8);
          setMicLevel(boosted);
          setOrbAmplitude((prev) => Math.max(boosted, prev * 0.92));
          rafId = requestAnimationFrame(sample);
        };
        sample();
      } catch {
        setMicActive(false);
        setConsoleFeed((prev) => [
          {
            id: `mic-err-${Date.now()}`,
            source: 'error',
            title: 'Microphone Unavailable',
            body: 'Browser microphone permission denied or no audio device detected. Typing commands remains active.',
          },
          ...prev,
        ]);
      }
    }

    void startMic();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, [open, micActive]);

  // Ambient Orb amplitude decay driven by active agents / AI busy state
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      const activeCount = agents.filter((a) => a.status !== 'idle').length;
      const baseline = commandBusy ? 0.65 : activeCount > 0 ? 0.28 : 0.08;
      setOrbAmplitude((prev) => prev * 0.86 + baseline * 0.14);
    }, 80);
    return () => window.clearInterval(timer);
  }, [open, agents, commandBusy]);

  // Particle Engine Canvas (ported from effects/particle_engine.py)
  useEffect(() => {
    if (!open || !prefs.particlesEnabled) return;
    const canvas = particleCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, Math.floor(rect.width));
      canvas.height = Math.max(240, Math.floor(rect.height));
      if (particlesRef.current.length === 0) {
        particlesRef.current = createMayaParticles(110, canvas.width, canvas.height);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    let timerId = 0;
    const renderParticles = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      stepMayaParticles(particlesRef.current, w, h, reducedMotion ? 0.25 : 1);

      const list = particlesRef.current;
      let links = 0;
      const maxLinks = 90;
      for (let i = 0; i < list.length && links < maxLinks; i++) {
        const p1 = list[i];
        for (let j = i + 1; j < list.length && links < maxLinks; j++) {
          const p2 = list[j];
          const dx = p1.x - p2.x;
          const dy = p1.y - p2.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 150 * 150) {
            const dist = Math.sqrt(distSq);
            const alpha = (1 - dist / 150) * 0.16;
            ctx.strokeStyle = `rgba(0, 150, 255, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
            links++;
          }
        }
      }

      // Subtle HUD scanlines
      ctx.strokeStyle = 'rgba(0, 200, 255, 0.035)';
      ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Particles with radial glow
      for (const p of list) {
        const alpha = Math.max(0.1, (p.life / p.maxLife) * 0.8);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      timerId = window.setTimeout(renderParticles, reducedMotion ? 90 : 38);
    };
    renderParticles();

    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener('resize', resize);
    };
  }, [open, prefs.particlesEnabled, reducedMotion]);

  // 3-Layer Mic Visualizer Canvas (ported from ui/mic_visualizer.py)
  useEffect(() => {
    if (!open) return;
    const canvas = waveCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(240, Math.floor(rect.width));
      canvas.height = Math.max(70, Math.floor(rect.height));
    };
    resize();
    window.addEventListener('resize', resize);

    let phase = 0;
    let smoothLevel = 0.06;
    let timerId = 0;

    const drawLayer = (
      w: number,
      h: number,
      yOffset: number,
      ampMult: number,
      phaseOffset: number,
      freq: number,
      fillGrad: CanvasGradient,
      strokeColor?: string,
    ) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      const steps = 44;
      for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        const x = ratio * w;
        const edgeTaper = Math.sin(ratio * Math.PI);
        const baseWobble = Math.sin(ratio * Math.PI * freq + phase + phaseOffset) * 4 * edgeTaper;
        const audioWobble =
          Math.abs(Math.sin(ratio * Math.PI * freq * 1.5 + phase * 1.5 + phaseOffset)) *
          smoothLevel *
          h *
          0.62 *
          edgeTaper *
          ampMult;
        const y = Math.min(h, yOffset - baseWobble - audioWobble);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = fillGrad;
      ctx.fill();
      if (strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };

    const tickWave = () => {
      const w = canvas.width;
      const h = canvas.height;
      const target = Math.max(micRef.current, ampRef.current * 0.72);
      smoothLevel += (target - smoothLevel) * 0.28;
      phase += reducedMotion ? 0.05 : 0.16;

      ctx.clearRect(0, 0, w, h);

      const g1 = ctx.createLinearGradient(0, 0, 0, h);
      g1.addColorStop(0, 'rgba(10, 50, 150, 0.42)');
      g1.addColorStop(1, 'rgba(0, 10, 50, 0.08)');
      drawLayer(w, h, h - 8, 0.6, 0, 2, g1);

      const g2 = ctx.createLinearGradient(0, 0, 0, h);
      g2.addColorStop(0, 'rgba(0, 150, 220, 0.56)');
      g2.addColorStop(1, 'rgba(0, 50, 100, 0.12)');
      drawLayer(w, h, h - 4, 0.85, 1.5, 3, g2);

      const loudness = Math.min(1, smoothLevel * 2);
      const topR = Math.round(70 + 185 * loudness);
      const g3 = ctx.createLinearGradient(0, 0, 0, h);
      g3.addColorStop(0, `rgba(${topR}, 255, 255, 0.85)`);
      g3.addColorStop(0.5, 'rgba(0, 200, 255, 0.65)');
      g3.addColorStop(1, 'rgba(0, 100, 150, 0.18)');
      drawLayer(w, h, h, 1.18, 3.14, 2.5, g3, `rgba(${Math.min(255, topR + 40)}, 255, 255, 0.95)`);

      timerId = window.setTimeout(tickWave, reducedMotion ? 80 : 34);
    };
    tickWave();

    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener('resize', resize);
    };
  }, [open, reducedMotion]);

  const cpuVal = hostMetrics?.cpuPct ?? Math.min(100, Math.round((telemetry?.hostCpuLoad1m ?? 0.3) * 25));
  const ramVal =
    hostMetrics?.ramPct ??
    (telemetry && telemetry.hostMemTotalMb > 0
      ? Math.round((telemetry.hostMemUsedMb / telemetry.hostMemTotalMb) * 100)
      : 42);
  const tempVal = hostMetrics?.tempC ?? 44;
  const gpuVal =
    hostMetrics?.gpuPct ??
    Math.min(
      100,
      Math.round(
        (regions.reduce((s, r) => s + r.load, 0) / Math.max(1, regions.length)) * 0.75 +
          (telemetry?.activeAgents ?? 0) * 6,
      ),
    );
  const diskVal = hostMetrics?.diskPct ?? 38;

  const performanceTier = useMemo(() => {
    if (cpuVal < 60 && ramVal < 82) return { label: 'PERFORMANCE: OPTIMAL', color: 'text-[#ffaa00]' };
    if (cpuVal < 85 && ramVal < 92) return { label: 'PERFORMANCE: ELEVATED', color: 'text-amber-300' };
    return { label: 'PERFORMANCE: HIGH LOAD', color: 'text-rose-400' };
  }, [cpuVal, ramVal]);

  const pendingApprovals = useMemo(
    () =>
      commDrafts.filter((d) => d.status === 'pending-approval').length +
      financialRequests.filter((f) => f.status === 'pending-approval').length +
      projects.flatMap((p) => p.tasks).filter((t) => t.status === 'awaiting-approval').length,
    [commDrafts, financialRequests, projects],
  );

  function pushFeed(entry: Omit<ConsoleEntry, 'id'>) {
    setConsoleFeed((prev) => [{ ...entry, id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 5)}` }, ...prev].slice(0, 40));
  }

  async function handleRunCommand(raw?: string) {
    const text = (raw ?? commandInput).trim();
    if (!text || commandBusy) return;
    setCommandInput('');
    setOrbAmplitude(0.92);
    pushFeed({ source: 'admin', title: 'ADMIN DIRECTIVE', body: text });

    const parsed = parseWorkstationCommand(text, agents);
    setCommandBusy(true);
    try {
      if (parsed.kind === 'terminal') {
        if (isOffline) throw new Error('Offline mode: sandbox terminal unreachable.');
        const res = await fetch('/api/terminal/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: parsed.command }),
        });
        const data = (await res.json()) as { exitCode: number; stdout: string; stderr: string; durationMs: number };
        pushFeed({
          source: data.exitCode === 0 ? 'shell' : 'error',
          title: `$ ${parsed.command}`,
          body: [data.stdout, data.stderr].filter(Boolean).join('\n') || '(no output)',
          meta: `exit ${data.exitCode} · ${data.durationMs}ms`,
        });
      } else if (parsed.kind === 'agent') {
        const res = await onChatWithAgent(parsed.agent.id, parsed.prompt);
        pushFeed({
          source: 'agent',
          title: `${parsed.agent.name} (${parsed.agent.role})`,
          body: res.reply,
        });
        if (prefs.autoSpeak) {
          speakWithProfile(res.reply, parsed.agent.voice);
        }
      } else if (parsed.kind === 'project') {
        await onCreateProject(parsed.objective);
        pushFeed({
          source: 'maya',
          title: 'AUTONOMOUS PROJECT LAUNCHED',
          body: `Decomposed and queued project objective: "${parsed.objective}"`,
        });
      } else if (parsed.kind === 'focus-region') {
        onFocusRegionIn3D(parsed.regionId);
        pushFeed({
          source: 'maya',
          title: '3D CORE CAMERA SYNCED',
          body: `Focused Central Computer neural region: ${parsed.regionId}`,
        });
      } else if (parsed.kind === 'halo') {
        const result = await dispatchHaloCommand(
          createHaloCommand({
            target: 'central',
            verb: 'agent.pause',
            args: { raw: parsed.commandText },
          }),
        );
        pushFeed({
          source: result.ok ? 'maya' : 'error',
          title: 'HALO KERNEL BUS',
          body: result.message || 'Dispatched command to kernel bus.',
        });
      } else {
        const res = await onSendCentralCommand(parsed.prompt);
        pushFeed({
          source: 'maya',
          title: `${prefs.aiCoreName} // CENTRAL INTELLIGENCE`,
          body: res.reply,
          meta: res.latencyMs !== undefined ? `${res.tokens ?? 0} tokens · ${res.latencyMs}ms` : undefined,
        });
        if (prefs.autoSpeak) {
          speakWithProfile(res.reply, { pitch: 0.96, rate: 1.02, style: 'Central Core' });
        }
      }
    } catch (err) {
      pushFeed({
        source: 'error',
        title: 'COMMAND ERROR',
        body: err instanceof Error ? err.message : 'Execution failed',
      });
    } finally {
      setCommandBusy(false);
    }
  }

  async function handleRunSandboxShell(e: React.FormEvent) {
    e.preventDefault();
    const cmd = terminalInput.trim();
    if (!cmd || terminalBusy) return;
    setTerminalInput('');
    setTerminalBusy(true);
    setOrbAmplitude(0.7);
    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = (await res.json()) as { exitCode: number; stdout: string; stderr: string; durationMs: number };
      pushFeed({
        source: data.exitCode === 0 ? 'shell' : 'error',
        title: `$ ${cmd}`,
        body: [data.stdout, data.stderr].filter(Boolean).join('\n') || '(no output)',
        meta: `exit ${data.exitCode} · ${data.durationMs}ms`,
      });
    } catch (err) {
      pushFeed({
        source: 'error',
        title: `$ ${cmd}`,
        body: err instanceof Error ? err.message : 'Shell error',
      });
    } finally {
      setTerminalBusy(false);
    }
  }

  function toggleVoiceDictation() {
    if (voiceListening) {
      voiceListenerRef.current?.stop();
      setVoiceListening(false);
      return;
    }
    if (!isSpeechRecognitionSupported()) {
      pushFeed({
        source: 'error',
        title: 'Speech Recognition Unavailable',
        body: 'Web Speech API is not supported in this browser; enable Mic Level for audio reactivity or type directives below.',
      });
      return;
    }
    setVoiceListening(true);
    voiceListenerRef.current = startVoiceRecognition(
      (transcript, isFinal) => {
        setCommandInput(transcript);
        setOrbAmplitude(0.85);
        if (isFinal && transcript.trim()) {
          void handleRunCommand(transcript);
        }
      },
      (err) => {
        setVoiceListening(false);
        pushFeed({ source: 'error', title: 'Voice Capture Error', body: err });
      },
      () => setVoiceListening(false),
    );
  }

  async function handleUnlockAdminGate(e: React.FormEvent) {
    e.preventDefault();
    setLockError('');
    try {
      await onUnlockVault(passcodeInput, 'Admin');
      setPasscodeInput('');
      setPrefs((p) => ({ ...p, adminLocked: false }));
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Invalid Admin passcode');
    }
  }

  if (!open) return null;

  const isLockedOut = prefs.adminLocked && vaultClaimed && sessionRole !== 'Admin';
  const latestFeed = consoleFeed[0];
  const orbScale = 1 + orbAmplitude * 0.22;
  const orbHueShift = Math.round(-orbAmplitude * 32);

  return (
    <div
      role="dialog"
      aria-label="MAYA Admin Main Computer Workstation"
      className="fixed inset-3 md:inset-6 z-40 rounded-lg bg-[#05050a]/96 text-slate-100 flex flex-col overflow-hidden shadow-[0_0_55px_rgba(0,200,255,0.28)] border-2 border-[#00c8ff]/80"
    >
      {/* Sweeping Maya Aura & Radial Vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, rgba(0, 130, 200, 0.16) 0%, rgba(0, 40, 90, 0.22) 45%, rgba(0, 0, 0, 0.85) 100%)',
        }}
      />

      {/* Particle Network Overlay Canvas */}
      {prefs.particlesEnabled && (
        <canvas
          ref={particleCanvasRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 w-full h-full z-0"
        />
      )}

      {/* Multi-Layer Glowing Corner Accents (matching main_window.py) */}
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-[#00ffc8] z-20" />
      <span aria-hidden="true" className="pointer-events-none absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-[#00ffc8] z-20" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-[#00ffc8] z-20" />
      <span aria-hidden="true" className="pointer-events-none absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-[#00ffc8] z-20" />

      {/* Top Admin Workstation Bar */}
      <div className="relative z-10 flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[#0096ff]/40 bg-[#060914]/90 font-mono text-xs">
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          <span className="px-2 py-0.5 rounded border border-[#00c8ff] bg-[#003264]/45 text-[#00c8ff] font-bold tracking-wider whitespace-nowrap">
            ADMIN MAIN PC
          </span>
          <span className="text-slate-300 truncate hidden 2xl:inline">
            {prefs.ownerLabel}
          </span>
          <span className="px-1.5 py-0.5 rounded border border-emerald-400/50 bg-emerald-500/10 text-emerald-300 text-[10px] whitespace-nowrap">
            HOST ONLY
          </span>
        </div>

        {/* Integrated Command Center Mode Tabs (single-row at 1440px) */}
        <div className="flex items-center gap-1 bg-slate-950/90 p-0.5 rounded border border-slate-800 shrink-0">
          {(
            [
              ['hud', 'MAYA', Sparkles],
              ['gods-eye', "God's Eye", Globe2],
              ['agents', `Agents (${agents.length})`, Bot],
              ['terminal', 'Shell', Terminal],
              ['projects', `Projects (${projects.length})`, FolderKanban],
              ['systems', `Systems (${pendingApprovals})`, ShieldCheck],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDeckTab(id)}
              className={`px-2 py-1 rounded text-[11px] flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                deckTab === id
                  ? 'bg-[#00c8ff]/20 text-[#00ffff] border border-[#00c8ff]/60'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Workstation Hardware & Lock Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setMicActive((v) => !v)}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 cursor-pointer ${
              micActive
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-cyan-400'
            }`}
          >
            {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            <span>{micActive ? 'Mic Live' : 'Mic Off'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const nextSpeak = !prefs.autoSpeak;
              if (!nextSpeak) stopSpeaking();
              setPrefs((p) => ({ ...p, autoSpeak: nextSpeak }));
            }}
            aria-label="Toggle voice output"
            className={`p-1.5 rounded border cursor-pointer ${
              prefs.autoSpeak
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {prefs.autoSpeak ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => {
              onFocusAdminRigIn3D();
              onClose();
            }}
            className="px-2 py-1 rounded border border-slate-700 bg-slate-950 text-cyan-300 hover:border-cyan-400 text-[11px] cursor-pointer hidden lg:inline-flex items-center gap-1"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>View 3D Rig</span>
          </button>

          <button
            type="button"
            onClick={() => setPrefs((p) => ({ ...p, adminLocked: !p.adminLocked }))}
            aria-label={prefs.adminLocked ? 'Unlock workstation' : 'Lock workstation to Admin'}
            className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 cursor-pointer ${
              prefs.adminLocked
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            {prefs.adminLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>{prefs.adminLocked ? 'Locked' : 'Admin Lock'}</span>
          </button>

          <button
            type="button"
            aria-label="Close Maya Admin Workstation"
            onClick={onClose}
            className="p-1.5 rounded border border-slate-700 bg-slate-950 text-slate-300 hover:text-white hover:border-rose-400 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Admin Passcode Lock Overlay when Admin Lock is active and Vault requires Admin session */}
      {isLockedOut ? (
        <div className="relative z-10 flex-1 flex items-center justify-center p-6 font-mono">
          <form
            onSubmit={handleUnlockAdminGate}
            className="w-full max-w-md rounded-xl border-2 border-[#00c8ff] bg-[#0a0f22]/95 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center gap-2 text-[#00c8ff] font-bold text-base">
              <Lock className="w-5 h-5" />
              <span>ADMIN MAIN WORKSTATION LOCKED</span>
            </div>
            <p className="text-xs text-slate-300">
              This workstation is restricted to your personal Admin computer ({prefs.ownerLabel}). Enter your Admin Vault passcode to resume control of Maya Core and Command Center agents.
            </p>
            <input
              type="password"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              placeholder="Admin Vault Passcode"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-sm text-white"
            />
            {lockError && <div className="text-xs text-rose-400">{lockError}</div>}
            <button
              type="submit"
              className="w-full py-2 rounded bg-[#00c8ff] text-slate-950 font-bold hover:bg-cyan-300 cursor-pointer"
            >
              Authenticate Admin Session
            </button>
          </form>
        </div>
      ) : (
        /* Main 3-Column Maya UI Architecture */
        <div className="relative z-10 flex-1 min-h-0 flex flex-col lg:flex-row gap-4 p-4 md:p-6 overflow-y-auto lg:overflow-hidden">
          {/* LEFT PANEL: SYSTEM METRICS (ui/left_panel.py) */}
          <section
            aria-label="System Metrics"
            className="w-full lg:w-[270px] shrink-0 rounded border-2 border-[#0096ff]/50 bg-gradient-to-r from-[#0a0a1e]/90 via-[#141432]/95 to-[#0a0a1e]/90 p-3 flex flex-col justify-between gap-3 font-mono"
          >
            <div className="space-y-3">
              <div className="text-center font-bold text-sm tracking-wider text-[#00c8ff] py-2 bg-[#003264]/35 border border-[#00c8ff] rounded">
                SYSTEM METRICS
              </div>

              {(
                [
                  {
                    label: 'CPU',
                    value: cpuVal,
                    unit: '%',
                    sub: hostMetrics ? `${hostMetrics.cpuCores} cores · ${hostMetrics.hostname}` : 'Host load',
                  },
                  {
                    label: 'RAM',
                    value: ramVal,
                    unit: '%',
                    sub: hostMetrics ? `${hostMetrics.ramUsedGb} / ${hostMetrics.ramTotalGb} GB` : 'Memory pool',
                  },
                  {
                    label: 'TEMP',
                    value: tempVal,
                    unit: '°C',
                    sub: hostMetrics?.tempSource === 'sensor' ? 'Thermal sensor' : 'Compute thermal est.',
                  },
                  {
                    label: 'GPU',
                    value: gpuVal,
                    unit: '%',
                    sub: hostMetrics?.gpuSource === 'sysfs' ? 'Hardware GPU' : 'Neural + WebGL load',
                  },
                  {
                    label: 'DISK',
                    value: diskVal,
                    unit: '%',
                    sub: hostMetrics ? `${hostMetrics.diskUsedGb} / ${hostMetrics.diskTotalGb} GB` : 'Workspace FS',
                  },
                ] as const
              ).map((metric) => {
                const style = getMetricColorTier(metric.value);
                const barWidth = Math.max(2, Math.min(100, metric.value));
                return (
                  <div key={metric.label} className="space-y-1">
                    <div className="flex items-baseline justify-between text-[11px] text-[#96c8ff]">
                      <span>{metric.label}</span>
                      <span className="text-[10px] text-slate-400 truncate max-w-[140px]">{metric.sub}</span>
                    </div>
                    <div className={`text-2xl font-bold leading-none tabular-nums ${style.textClass}`}>
                      {Math.round(metric.value)}
                      {metric.unit}
                    </div>
                    <div className="h-2 w-full bg-[#141428] border border-white/15 rounded-xs overflow-hidden">
                      <div
                        className={`h-full bg-gradient-to-r ${style.barClass} transition-all duration-300`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between">
              <span>RSS: {hostMetrics?.processRssMb ?? telemetry?.processRssMb ?? '--'} MB</span>
              <span>UP: {hostMetrics?.uptimeSeconds ?? telemetry?.uptimeSeconds ?? '--'}s</span>
            </div>
          </section>

          {/* CENTER STAGE: MAYA ORB / INTEGRATED DECK + COMMAND BAR + 3-LAYER WAVE VISUALIZER */}
          <section className="flex-1 min-w-0 min-h-0 flex flex-col justify-between gap-3">
            {deckTab === 'hud' ? (
              <div className="flex-1 min-h-[260px] flex flex-col items-center justify-center relative px-2">
                {/* Interactive MAYA Orb (orb.gif + radial screen mask + reactive hue/scale) */}
                <button
                  type="button"
                  onClick={() => {
                    setOrbAmplitude(0.95);
                    onFocusRegionIn3D('reasoning-cortex');
                  }}
                  title="Click Orb to pulse Central Neural Core"
                  className="relative flex items-center justify-center w-64 h-64 sm:w-80 sm:h-80 cursor-pointer select-none focus:outline-none"
                  style={{
                    transform: `scale(${orbScale.toFixed(3)})`,
                    transition: 'transform 120ms ease-out',
                  }}
                >
                  <div
                    className="absolute inset-4 rounded-full pointer-events-none"
                    style={{
                      background:
                        'radial-gradient(circle, rgba(56,189,248,0.28) 0%, rgba(99,102,241,0.16) 45%, rgba(5,5,10,0) 74%)',
                      filter: `hue-rotate(${orbHueShift}deg)`,
                    }}
                  />
                  <img
                    src="/assets/maya/orb.gif"
                    alt={`${prefs.aiCoreName} Reactive AI Core Orb`}
                    className="w-full h-full object-contain rounded-full mix-blend-screen pointer-events-none"
                    style={{
                      WebkitMaskImage:
                        'radial-gradient(circle, rgba(0,0,0,1) 30%, rgba(0,0,0,0.45) 48%, rgba(0,0,0,0) 64%)',
                      maskImage:
                        'radial-gradient(circle, rgba(0,0,0,1) 30%, rgba(0,0,0,0.45) 48%, rgba(0,0,0,0) 64%)',
                      filter: `hue-rotate(${orbHueShift}deg) brightness(${(1 + orbAmplitude * 0.28).toFixed(2)})`,
                    }}
                  />
                  <span
                    className="absolute inset-0 flex items-center justify-center font-mono font-bold tracking-[0.18em] text-2xl sm:text-3xl text-white pointer-events-none"
                    style={{
                      textShadow:
                        '0 0 14px rgba(0, 220, 255, 0.95), 0 0 28px rgba(59, 130, 246, 0.85)',
                    }}
                  >
                    {prefs.aiCoreName}
                  </span>
                </button>

                {/* Live Central Core Response Banner */}
                {latestFeed && (
                  <div className="w-full max-w-2xl rounded-lg border border-[#00c8ff]/35 bg-[#070d1c]/90 px-3.5 py-2 font-mono text-xs">
                    <div className="flex items-center justify-between text-[10px] text-[#00c8ff] mb-0.5">
                      <span>{latestFeed.title}</span>
                      {latestFeed.meta && <span className="text-slate-400">{latestFeed.meta}</span>}
                    </div>
                    <div className="text-slate-200 line-clamp-3 whitespace-pre-wrap">{latestFeed.body}</div>
                  </div>
                )}
              </div>
            ) : deckTab === 'gods-eye' ? (
              <div className="flex-1 min-h-0 flex flex-col gap-2">
                <GodsEyeGlobeView
                  agents={agents}
                  reducedMotion={reducedMotion}
                  onDispatchRecon={(prompt) => {
                    void handleRunCommand(prompt);
                  }}
                />
                {latestFeed && latestFeed.id !== 'boot-maya' && (
                  <div className="rounded border border-[#00c8ff]/40 bg-[#070d1c]/92 px-3 py-1.5 font-mono text-[11px] shrink-0">
                    <div className="flex items-center justify-between text-[10px] text-[#00c8ff]">
                      <span>{latestFeed.title}</span>
                      {latestFeed.meta && <span className="text-slate-400">{latestFeed.meta}</span>}
                    </div>
                    <div className="text-slate-200 line-clamp-2 whitespace-pre-wrap">{latestFeed.body}</div>
                  </div>
                )}
              </div>
            ) : (
              /* Integrated Command Center Deck inside Admin's Maya Computer */
              <div className="flex-1 min-h-0 rounded-lg border border-[#00c8ff]/45 bg-[#070c1a]/92 p-3 flex flex-col gap-2.5 overflow-hidden font-mono text-xs">
                {deckTab === 'agents' && (
                  <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-y-auto pr-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[#00c8ff] font-bold">COMMAND CENTER AGENTS DISPATCH</span>
                      <span className="text-[11px] text-slate-400">
                        Tip: type @{agents[0]?.name.split(' ')[0].toLowerCase() ?? 'agent'} &lt;directive&gt; below
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {agents.map((agent) => (
                        <div
                          key={agent.id}
                          className={`rounded-lg border p-2.5 space-y-2 ${
                            selectedAgentId === agent.id
                              ? 'border-[#00c8ff] bg-[#0b182e]'
                              : 'border-slate-800 bg-slate-950/75'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-bold text-slate-100 truncate">{agent.name}</div>
                              <div className="text-[10px] text-cyan-300 truncate">{agent.role}</div>
                            </div>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                agent.status === 'idle'
                                  ? 'border-slate-700 text-slate-300'
                                  : 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                              }`}
                            >
                              {agent.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            Obj: {agent.currentObjective}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <select
                              aria-label={`Autonomy for ${agent.name}`}
                              value={agent.autonomy}
                              onChange={(e) =>
                                void onUpdateAgent(agent.id, { autonomy: e.target.value as AutonomyLevel })
                              }
                              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200"
                            >
                              <option value="ASSISTED">ASSISTED</option>
                              <option value="SUPERVISED">SUPERVISED</option>
                              <option value="AUTONOMOUS">AUTONOMOUS</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAgentId(agent.id);
                                setCommandInput(`@${agent.name.split(' ')[0]} `);
                              }}
                              className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/30 text-[10px] cursor-pointer"
                            >
                              Direct @Agent
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onFocusAgentIn3D(agent.id);
                                onClose();
                              }}
                              className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white text-[10px] cursor-pointer"
                            >
                              3D Focus
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {deckTab === 'terminal' && (
                  <div className="flex-1 min-h-0 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[#00c8ff] font-bold">SANDBOX WORKSTATION SHELL (.vcalabs-workspace)</span>
                      <div className="flex items-center gap-1">
                        {['ls -la', 'node -v', 'cat package.json'].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => void handleRunCommand(`/exec ${q}`)}
                            className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-cyan-300 hover:border-cyan-400 cursor-pointer"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto bg-black/70 border border-slate-800 rounded p-2.5 space-y-2">
                      {consoleFeed.map((item) => (
                        <div key={item.id} className="border-b border-slate-800/70 pb-1.5 last:border-b-0">
                          <div className="flex items-center justify-between text-[10px]">
                            <span
                              className={
                                item.source === 'error'
                                  ? 'text-rose-400 font-bold'
                                  : item.source === 'shell'
                                    ? 'text-emerald-300 font-bold'
                                    : 'text-[#00c8ff] font-bold'
                              }
                            >
                              {item.title}
                            </span>
                            {item.meta && <span className="text-slate-500">{item.meta}</span>}
                          </div>
                          <pre className="text-[11px] text-slate-200 whitespace-pre-wrap break-words mt-0.5 font-mono">
                            {item.body}
                          </pre>
                        </div>
                      ))}
                    </div>
                    <form onSubmit={handleRunSandboxShell} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={terminalInput}
                        onChange={(e) => setTerminalInput(e.target.value)}
                        placeholder="Run sandbox shell command (e.g. node src/telemetry-check.mjs)"
                        className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
                      />
                      <button
                        type="submit"
                        disabled={terminalBusy || !terminalInput.trim()}
                        className="px-3 py-1.5 rounded bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 disabled:opacity-40 cursor-pointer"
                      >
                        {terminalBusy ? 'Running...' : 'Exec'}
                      </button>
                    </form>
                  </div>
                )}

                {deckTab === 'projects' && (
                  <div className="flex-1 min-h-0 flex flex-col gap-2.5 overflow-y-auto pr-1">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!projectInput.trim()) return;
                        void onCreateProject(projectInput.trim());
                        setProjectInput('');
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        type="text"
                        value={projectInput}
                        onChange={(e) => setProjectInput(e.target.value)}
                        placeholder="Launch new autonomous team project objective..."
                        className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1.5 rounded bg-[#00c8ff] text-slate-950 font-bold hover:bg-cyan-300 cursor-pointer"
                      >
                        Launch Team
                      </button>
                    </form>
                    {projects.map((proj) => (
                      <div key={proj.id} className="rounded-lg border border-slate-800 bg-slate-950/75 p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-cyan-200">{proj.title}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                            {proj.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">{proj.objective}</div>
                        <div className="space-y-1 pt-1">
                          {proj.tasks.map((task) => (
                            <div
                              key={task.id}
                              className="flex items-center justify-between gap-2 text-[11px] bg-slate-900/80 px-2 py-1 rounded"
                            >
                              <span className="truncate text-slate-200">{task.title}</span>
                              {task.status === 'awaiting-approval' ? (
                                <button
                                  type="button"
                                  onClick={() => void onApproveTask(proj.id, task.id)}
                                  className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 font-bold cursor-pointer shrink-0"
                                >
                                  Approve
                                </button>
                              ) : (
                                <span className="text-[10px] text-cyan-300 shrink-0">{task.status}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {deckTab === 'systems' && (
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                    {/* Neural Core Regions */}
                    <div>
                      <div className="text-[#00c8ff] font-bold mb-1.5">CENTRAL COMPUTER NEURAL REGIONS</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {regions.map((reg) => (
                          <button
                            key={reg.id}
                            type="button"
                            onClick={() => onFocusRegionIn3D(reg.id)}
                            className="text-left p-2 rounded border border-slate-800 bg-slate-950/80 hover:border-[#00c8ff] cursor-pointer"
                          >
                            <div className="flex items-center justify-between font-bold text-slate-100">
                              <span className="truncate">{reg.name}</span>
                              <span className="text-[#00c8ff]">{Math.round(reg.load)}%</span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">{reg.lastOperation}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Outbound & Spend Governance */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="rounded border border-slate-800 bg-slate-950/80 p-2 space-y-1.5">
                        <div className="font-bold text-amber-300">
                          COMMS APPROVALS ({commDrafts.filter((d) => d.status === 'pending-approval').length})
                        </div>
                        {commDrafts
                          .filter((d) => d.status === 'pending-approval')
                          .slice(0, 3)
                          .map((d) => (
                            <div key={d.id} className="flex items-center justify-between gap-2 text-[11px] bg-slate-900 p-1.5 rounded">
                              <span className="truncate">
                                [{d.channel}] {d.recipient}
                              </span>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => void onDecideComm(d.id, 'approve')}
                                  className="px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-bold cursor-pointer"
                                >
                                  OK
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void onDecideComm(d.id, 'reject')}
                                  className="px-1.5 py-0.5 rounded bg-rose-500/80 text-white cursor-pointer"
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          ))}
                        {commDrafts.filter((d) => d.status === 'pending-approval').length === 0 && (
                          <div className="text-[11px] text-slate-500">No outbound drafts awaiting sign-off.</div>
                        )}
                      </div>

                      <div className="rounded border border-slate-800 bg-slate-950/80 p-2 space-y-1.5">
                        <div className="font-bold text-emerald-300">
                          CLOUD SPEND REQUESTS ({financialRequests.filter((f) => f.status === 'pending-approval').length})
                        </div>
                        {financialRequests
                          .filter((f) => f.status === 'pending-approval')
                          .slice(0, 3)
                          .map((f) => (
                            <div key={f.id} className="flex items-center justify-between gap-2 text-[11px] bg-slate-900 p-1.5 rounded">
                              <span className="truncate">
                                {f.vendor} · ${f.amountUsd}
                              </span>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => void onDecideFinance(f.id, 'approve')}
                                  className="px-1.5 py-0.5 rounded bg-emerald-500 text-slate-950 font-bold cursor-pointer"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void onDecideFinance(f.id, 'reject')}
                                  className="px-1.5 py-0.5 rounded bg-rose-500/80 text-white cursor-pointer"
                                >
                                  Deny
                                </button>
                              </div>
                            </div>
                          ))}
                        {financialRequests.filter((f) => f.status === 'pending-approval').length === 0 && (
                          <div className="text-[11px] text-slate-500">No cloud spend requests pending.</div>
                        )}
                      </div>
                    </div>

                    {/* Local Workstation Identity */}
                    <div className="rounded border border-slate-800 bg-slate-950/80 p-2.5 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5">
                        <span className="text-slate-400">Orb Name:</span>
                        <input
                          type="text"
                          value={prefs.aiCoreName}
                          onChange={(e) => setPrefs((p) => ({ ...p, aiCoreName: e.target.value.toUpperCase() }))}
                          className="w-28 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-cyan-200"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={prefs.particlesEnabled}
                          onChange={(e) => setPrefs((p) => ({ ...p, particlesEnabled: e.target.checked }))}
                          className="accent-cyan-400"
                        />
                        <span className="text-slate-300">Neural Particle Mesh</span>
                      </label>
                      <span className="text-[10px] text-slate-500 ml-auto">
                        Recent Log: {activityLogs[0]?.message ?? 'Ready'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Unified Central Intelligence & Agent Command Input Bar */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleRunCommand();
              }}
              className="flex items-center gap-2 font-mono text-xs"
            >
              <button
                type="button"
                onClick={toggleVoiceDictation}
                aria-label="Dictate command to Maya"
                className={`p-2 rounded border cursor-pointer ${
                  voiceListening
                    ? 'bg-rose-500/20 border-rose-400 text-rose-200'
                    : 'bg-[#070d1c] border-[#0096ff]/50 text-[#00c8ff] hover:border-[#00ffff]'
                }`}
              >
                <Mic className="w-4 h-4" />
              </button>
              <input
                type="text"
                aria-label="Maya Central Command Input"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder="Ask MAYA / Central Core, @agent <task>, /exec <shell>, or /project <goal>..."
                className="flex-1 bg-[#070d1c]/95 border border-[#0096ff]/60 rounded px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#00ffff]"
              />
              <button
                type="submit"
                disabled={commandBusy || !commandInput.trim()}
                className="px-3.5 py-2 rounded bg-[#00c8ff] text-slate-950 font-bold hover:bg-cyan-300 disabled:opacity-45 flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{commandBusy ? 'Thinking...' : 'Execute'}</span>
              </button>
            </form>

            {/* Bottom 3-Layer Mic & Speaker Waveform Visualizer (ui/mic_visualizer.py) */}
            <div className="h-[88px] w-full relative overflow-hidden rounded border border-[#0096ff]/30 bg-[#050814]/80">
              <canvas ref={waveCanvasRef} className="w-full h-full block" />
              <div className="pointer-events-none absolute top-1.5 left-2.5 flex items-center gap-1.5 text-[10px] font-mono text-[#67e8f9]/85">
                <Activity className="w-3 h-3" />
                <span>
                  AUDIO BUS · {micActive ? `MIC LIVE (${Math.round(micLevel * 100)}%)` : 'AI SIGNAL SYNC'}
                </span>
              </div>
            </div>
          </section>

          {/* RIGHT PANEL: AI STATUS (ui/right_panel.py) + ATTRIBUTION (signature_widget.py) */}
          <section
            aria-label="AI Status"
            className="w-full lg:w-[252px] shrink-0 rounded border-2 border-[#0096ff]/50 bg-gradient-to-r from-[#0a0a1e]/90 via-[#141432]/95 to-[#0a0a1e]/90 p-3.5 flex flex-col justify-between gap-3 font-mono"
          >
            <div className="space-y-3.5">
              <div className="text-center font-bold text-sm tracking-wider text-[#00ff88] py-2 bg-[#006432]/30 border border-[#00ff88] rounded">
                AI STATUS
              </div>

              <div className="text-center font-bold text-2xl text-[#00ffff] py-2.5 bg-[#003264]/35 border-2 border-[#00ffff] rounded-lg tabular-nums tracking-wider">
                {nowClock.toTimeString().slice(0, 8)}
              </div>

              <div className="text-center text-xs text-[#88ccff]">
                {nowClock.toLocaleDateString('en-US', {
                  month: 'long',
                  day: '2-digit',
                  year: 'numeric',
                })}
              </div>

              <div className="text-center font-bold text-sm text-[#00ff64] py-2 bg-[#003200]/55 border border-[#00ff00] rounded">
                {STATUS_MESSAGES[statusIdx]}
              </div>

              <div className={`text-center text-[11px] font-semibold ${performanceTier.color}`}>
                {performanceTier.label}
              </div>

              <div className="text-center text-[11px] text-[#0088ff] py-2.5 px-2 bg-[#001e3c]/45 border border-dashed border-[#0088ff] rounded">
                MODEL: GEMINI-4 HYDROGEN // VCA CORE
              </div>

              <div className="space-y-1.5 text-center text-[11px] text-[#88ffcc]">
                <div>AGENTS ONLINE: {agents.length}</div>
                <div>ACTIVE TASKS: {telemetry?.runningTasks ?? 0}</div>
                <div>NEURAL NODES: 240 SYNCED</div>
                <div className="text-slate-400 text-[10px]">
                  SCOPE: ADMIN WORKSTATION ONLY
                </div>
              </div>
            </div>

            {/* Signature Badge matching effects/signature_widget.py */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[11px] whitespace-nowrap">
              <span className="text-slate-500">vca-maya-1.0</span>
              <span className="font-bold text-slate-200 border-b border-slate-500 pb-0.5">
                HunterIsLive · Admin
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
