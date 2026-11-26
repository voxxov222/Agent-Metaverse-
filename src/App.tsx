import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X, Wifi, WifiOff, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Move, Crosshair } from 'lucide-react';
import { CommandViewport3D, type PulseSignal } from './components/CommandViewport3D';
import { NeuralLinkPanel } from './components/panels/NeuralLinkPanel';
import { AgentStudioPanel } from './components/panels/AgentStudioPanel';
import { ProjectOrchestratorPanel } from './components/panels/ProjectOrchestratorPanel';
import { TerminalStudioPanel } from './components/panels/TerminalStudioPanel';
import { TelemetryAnalyticsPanel } from './components/panels/TelemetryAnalyticsPanel';
import { IntegrationsGovernancePanel } from './components/panels/IntegrationsGovernancePanel';
import { MemorySecurityPrototypePanel } from './components/panels/MemorySecurityPrototypePanel';
import { WorldRoadmapPanel } from './components/panels/WorldRoadmapPanel';
import { JarvisCommandDeck } from './components/panels/JarvisCommandDeck';
import { JarvisOrbHud } from './components/JarvisOrbHud';
import { MayaAdminWorkstation } from './components/workstation/MayaAdminWorkstation';
import { ZimHandCamOverlay } from './components/ZimHandCamOverlay';
import type { ZimTrackingFrame } from './utils/zimHandTracker';
import type { PrototypeKind } from './scene/environments';
import {
  applyKernelPayloadToStore,
  attachHaloKeyboardAdapter,
  CommandPaletteModal,
  createHaloCommand,
  dispatchHaloCommand,
  HaloShell,
  haloStore,
  mergeSharedCursor,
  registerKernelSyncBridge,
  resolveHaloPalette,
  startGamepadAdapter,
  useHaloSelector,
  WristHud,
} from '../packages/halo';
import {
  enqueueOfflineAction,
  listOfflineQueue,
  loadSnapshot,
  removeOfflineAction,
  saveSnapshot,
} from './utils/offlineStore';
import { reconcileOfflineQueue } from './utils/orchestratorLogic';
import { DEFAULT_SKYBOX_CONFIG, ENVIRONMENT_THEME_OPTIONS } from './utils/worldEnhancements';
import { computeCognitiveFocusState } from './utils/jarvisOperationsLogic';
import type { JarvisDomainLogEntry, JarvisStateSnapshot, NetworkTopologySnapshot } from './server/jarvisCommandEngine';
import type { HostWorkstationMetrics } from './server/workstationMetrics';
import type {
  ActivityLogEntry,
  AgentProfile,
  CameraMode,
  ClientWsEvent,
  EnvironmentTheme,
  FinancialRequest,
  IntegrationProvider,
  JarvisDomainId,
  JarvisHologramConfig,
  JarvisHologramModelId,
  JarvisOrbState,
  JarvisReminder,
  JarvisToast,
  MemoryItem,
  NeuralRegion,
  NeuralRegionId,
  OfflineQueuedAction,
  OutboundCommDraft,
  PhysicsGravityPreset,
  PluginManifest,
  ProjectRecord,
  RoadmapItem,
  ServerWsEvent,
  SkyboxConfig,
  SystemTelemetry,
  TelemetryHistoryPoint,
  WeatherMode,
  WorldChatMessage,
  WorldObject,
  WorldPlayer,
  WorkspacePanel,
} from './types/os';

export default function App() {
  // Core OS State
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationProvider[]>([]);
  const [commDrafts, setCommDrafts] = useState<OutboundCommDraft[]>([]);
  const [financialRequests, setFinancialRequests] = useState<FinancialRequest[]>([]);
  const [regions, setRegions] = useState<NeuralRegion[]>([]);
  const [telemetry, setTelemetry] = useState<SystemTelemetry | null>(null);
  const [telemetryHistory, setTelemetryHistory] = useState<TelemetryHistoryPoint[]>([]);
  const [geminiConfigured, setGeminiConfigured] = useState(true);

  // Vault & Multi-tenant Auth (token kept strictly in React memory)
  const [vaultClaimed, setVaultClaimed] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<Array<{ id: string; label: string; provider: string; maskedPreview: string }>>([]);

  // 3D Environment & HUD State
  const [theme, setTheme] = useState<EnvironmentTheme>('command-center');
  const [weather, setWeather] = useState<WeatherMode>('clear');
  const [timeOfDayHours, setTimeOfDayHours] = useState(14);
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<NeuralRegionId>('reasoning-cortex');
  const [activePanel, setActivePanel] = useState<WorkspacePanel>(null);
  const [workstationOpen, setWorkstationOpen] = useState(false);
  const [handCamOpen, setHandCamOpen] = useState(false);
  const handDriverRef = useRef<((frame: ZimTrackingFrame) => void) | null>(null);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [latestPulse, setLatestPulse] = useState<PulseSignal | null>(null);

  // 3D Prototype Pedestal State
  const [prototypeKind, setPrototypeKind] = useState<PrototypeKind>('orbital-relay');
  const [prototypeColor, setPrototypeColor] = useState('#38BDF8');
  const [prototypeMetalness, setPrototypeMetalness] = useState(0.85);

  // Offline-first & Sync State
  const [browserOffline, setBrowserOffline] = useState(!navigator.onLine);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedAction[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  // M1 Multiplayer World & Roadmap State
  const [selfPlayerId, setSelfPlayerId] = useState<string | null>(null);
  const [callsign, setCallsign] = useState('Operator-01');
  const [avatarColor, setAvatarColor] = useState('#38bdf8');
  const [worldPlayers, setWorldPlayers] = useState<WorldPlayer[]>([]);
  const [worldObjects, setWorldObjects] = useState<WorldObject[]>([]);
  const [worldChat, setWorldChat] = useState<WorldChatMessage[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [touchMoveVector, setTouchMoveVector] = useState<{ x: number; z: number }>({ x: 0, z: 0 });
  const [skybox, setSkybox] = useState<SkyboxConfig>(DEFAULT_SKYBOX_CONFIG);
  const [selectedWorldObjectId, setSelectedWorldObjectId] = useState<string | null>(null);
  const [objectDragMode, setObjectDragMode] = useState(false);
  const [tapPlaceActive, setTapPlaceActive] = useState(false);
  const [gridSnap, setGridSnap] = useState(true);
  const [holdingObjectId, setHoldingObjectId] = useState<string | null>(null);
  const [gravityPreset, setGravityPreset] = useState<PhysicsGravityPreset>('earth');
  const [physicsCommand, setPhysicsCommand] = useState<{
    kind: 'drop' | 'nudge' | 'wake';
    objectId?: string;
    nonce: number;
  } | null>(null);

  // JARVIS Central Command State
  const [jarvisOrbState, setJarvisOrbState] = useState<JarvisOrbState>('idle');
  const [jarvisOrbLabel, setJarvisOrbLabel] = useState('IDLE // READY');
  const [jarvisHologram, setJarvisHologram] = useState<JarvisHologramConfig>({
    model: 'neural-lattice',
    title: 'Central Neural Lattice',
    explodeFactor: 0,
    heatmap: false,
  });
  const [jarvisReminders, setJarvisReminders] = useState<JarvisReminder[]>([]);
  const [jarvisToasts, setJarvisToasts] = useState<JarvisToast[]>([]);
  const [jarvisTopology, setJarvisTopology] = useState<NetworkTopologySnapshot | null>(null);
  const [jarvisDiagnostics, setJarvisDiagnostics] = useState<{
    metrics: HostWorkstationMetrics;
    summary: string;
    activeAgents: number;
    runningTasks: number;
  } | null>(null);
  const [jarvisLog, setJarvisLog] = useState<JarvisDomainLogEntry[]>([]);
  const keyTimestampsRef = useRef<number[]>([]);
  const lastPointerActiveRef = useRef<number>(Date.now());
  const [biometricsTick, setBiometricsTick] = useState(0);

  const jarvisBiometrics = useMemo(
    () => computeCognitiveFocusState(keyTimestampsRef.current, lastPointerActiveRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [biometricsTick],
  );

  const isOffline = browserOffline || simulatedOffline;
  const appliedOfflineIdsRef = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const neuralEventBus = useMemo(() => new EventTarget(), []);

  // HALO Selector Slices for 3D Dome / Table sync & Quick Dock
  const haloIsOpen = useHaloSelector((s) => s.isOpen);
  const haloWristOpen = useHaloSelector((s) => s.wristOpen);
  const haloFormFactor = useHaloSelector((s) => s.formFactor);
  const haloLayout = useHaloSelector((s) => s.layout);
  const haloPanels3D = useHaloSelector((s) => s.panels3D);
  const haloZones = useHaloSelector((s) => s.zones);
  const haloActiveModule = useHaloSelector((s) => s.activeModule);
  const haloKillSwitch = useHaloSelector((s) => s.killSwitchActive);
  const haloGlitchPulseAt = useHaloSelector((s) => s.glitchPulseAt);
  const haloApprovals = useHaloSelector((s) => s.approvals);
  const haloPalette = useMemo(
    () => resolveHaloPalette(haloLayout.themeId, haloLayout.customPalette),
    [haloLayout.themeId, haloLayout.customPalette],
  );
  const pendingApprovalsCount = useMemo(
    () => haloApprovals.filter((a) => a.status === 'pending').length,
    [haloApprovals],
  );
  const runningTasksCount = useMemo(
    () => projects.flatMap((p) => p.tasks).filter((t) => t.status === 'in-progress').length,
    [projects],
  );

  const sendWs = useCallback((payload: ClientWsEvent) => {
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(payload));
    }
  }, []);

  const refreshOfflineQueue = useCallback(async () => {
    const q = await listOfflineQueue();
    setOfflineQueue(q);
  }, []);

  // Bootstrap from server, fallback to IndexedDB snapshot if offline
  useEffect(() => {
    let active = true;
    async function init() {
      await refreshOfflineQueue();
      try {
        const res = await fetch('/api/bootstrap');
        if (!res.ok) throw new Error('Bootstrap failed');
        const data = await res.json();
        if (!active) return;
        setAgents(data.agents);
        setProjects(data.projects);
        setActivityLogs(data.activityLogs);
        setMemories(data.memories);
        setPlugins(data.plugins);
        setIntegrations(data.integrations);
        setCommDrafts(data.commDrafts);
        setFinancialRequests(data.financialRequests);
        setRegions(data.regions);
        setTelemetry(data.telemetry);
        setTelemetryHistory(data.telemetryHistory);
        setVaultClaimed(Boolean(data.vaultClaimed));
        setSecrets(data.secrets ?? []);
        setGeminiConfigured(Boolean(data.geminiConfigured));
        setSelectedAgentId(data.agents[0]?.id ?? null);
        if (Array.isArray(data.worldPlayers)) setWorldPlayers(data.worldPlayers);
        if (Array.isArray(data.worldObjects)) setWorldObjects(data.worldObjects);
        if (Array.isArray(data.worldChat)) setWorldChat(data.worldChat);
        if (Array.isArray(data.roadmap)) setRoadmap(data.roadmap);
        if (data.worldSkybox) setSkybox(data.worldSkybox);

        // Hydrate JARVIS Command Engine state
        try {
          const jRes = await fetch('/api/jarvis/state');
          if (jRes.ok && active) {
            const jData = (await jRes.json()) as JarvisStateSnapshot;
            setJarvisOrbState(jData.orbState);
            setJarvisOrbLabel(jData.orbLabel);
            setJarvisHologram(jData.hologram);
            setJarvisReminders(jData.reminders);
            setJarvisTopology(jData.networkTopology);
            setJarvisDiagnostics(jData.latestDiagnostics);
            setJarvisLog(jData.domainLog);
          }
        } catch {
          // ignore if offline
        }

        applyKernelPayloadToStore({
          kernel: data.kernel,
          agents: data.agents,
          projects: data.projects,
          memories: data.memories,
          worldObjects: data.worldObjects,
        });
        haloStore.setState({
          telemetry: data.telemetry,
          telemetryHistory: data.telemetryHistory ?? [],
          regions: data.regions ?? [],
          activityLogs: data.activityLogs ?? [],
        });

        await saveSnapshot('vcalabs_bootstrap', {
          agents: data.agents,
          projects: data.projects,
          memories: data.memories,
          telemetryHistory: data.telemetryHistory,
        });
      } catch {
        const cached = await loadSnapshot<{
          agents: AgentProfile[];
          projects: ProjectRecord[];
          memories: MemoryItem[];
          telemetryHistory: TelemetryHistoryPoint[];
        }>('vcalabs_bootstrap');
        if (cached && active) {
          setAgents(cached.agents ?? []);
          setProjects(cached.projects ?? []);
          setMemories(cached.memories ?? []);
          setTelemetryHistory(cached.telemetryHistory ?? []);
        }
      }
    }
    void init();
    return () => {
      active = false;
    };
  }, [refreshOfflineQueue]);

  // Persist snapshots whenever key OS data updates
  useEffect(() => {
    if (agents.length > 0) {
      void saveSnapshot('vcalabs_bootstrap', { agents, projects, memories, telemetryHistory });
    }
  }, [agents, projects, memories, telemetryHistory]);

  // Network online/offline listeners
  useEffect(() => {
    const onOnline = () => setBrowserOffline(false);
    const onOffline = () => setBrowserOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Keyboard shortcut H to toggle bottom control dock, plus HALO Ctrl+K / Tab / Ctrl+Shift+X / Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
      }
    };
    const trackKeystroke = () => {
      const now = Date.now();
      keyTimestampsRef.current.push(now);
      if (keyTimestampsRef.current.length > 320) {
        keyTimestampsRef.current = keyTimestampsRef.current.slice(-240);
      }
      lastPointerActiveRef.current = now;
      setBiometricsTick((t) => t + 1);
    };
    const trackPointer = () => {
      lastPointerActiveRef.current = Date.now();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', trackKeystroke);
    window.addEventListener('pointerdown', trackPointer);
    const bioTimer = window.setInterval(() => setBiometricsTick((t) => t + 1), 15000);
    const detachHaloKeys = attachHaloKeyboardAdapter({
      onTogglePalette: () => haloStore.setState((prev) => ({ ...prev, paletteOpen: !prev.paletteOpen })),
      onToggleWrist: () => haloStore.setState((prev) => ({ ...prev, wristOpen: !prev.wristOpen })),
      onTriggerKillSwitch: () =>
        void dispatchHaloCommand(createHaloCommand({ target: 'kernel', verb: 'system.killswitch' })),
      onEscape: () => {
        setActivePanel(null);
        haloStore.setState({ paletteOpen: false, isOpen: false });
      },
    });
    const stopGamepad = startGamepadAdapter({
      onWristToggle: () => haloStore.setState((prev) => ({ ...prev, wristOpen: !prev.wristOpen })),
      onPaletteToggle: () => haloStore.setState((prev) => ({ ...prev, paletteOpen: !prev.paletteOpen })),
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', trackKeystroke);
      window.removeEventListener('pointerdown', trackPointer);
      clearInterval(bioTimer);
      detachHaloKeys();
      stopGamepad();
    };
  }, []);

  // Bridge React state setters & project planner to HALO client dispatcher
  useEffect(() => {
    registerKernelSyncBridge({
      setAgents,
      setProjects,
      setMemories,
      setWorldObjects,
      setTheme,
      setWeather,
      setTimeOfDayHours,
      createProjectFromObjective: handleCreateProject,
    });
  });

  // Keep HALO normalized store synced with core OS React slices
  useEffect(() => {
    haloStore.setState({ agents, projects, memories, worldObjects, regions, activityLogs, telemetry, telemetryHistory });
  }, [agents, projects, memories, worldObjects, regions, activityLogs, telemetry, telemetryHistory]);

  // Real-time WebSocket stream
  useEffect(() => {
    if (isOffline) {
      setWsConnected(false);
      return;
    }
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let closedByCleanup = false;

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
        socket?.send(JSON.stringify({ type: 'world:join', callsign, avatarColor } satisfies ClientWsEvent));
      };
      socket.onclose = () => {
        setWsConnected(false);
        if (wsRef.current === socket) wsRef.current = null;
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
      socket.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as ServerWsEvent;
          if (event.type === 'telemetry:update') {
            setTelemetry(event.telemetry);
            setRegions(event.regions);
            setGeminiConfigured(event.telemetry.geminiConfigured);
            setTelemetryHistory((prev) => {
              const next = [
                ...prev,
                {
                  timestamp: event.telemetry.timestamp,
                  cpuLoad: event.telemetry.hostCpuLoad1m,
                  memPct:
                    event.telemetry.hostMemTotalMb > 0
                      ? Math.round((event.telemetry.hostMemUsedMb / event.telemetry.hostMemTotalMb) * 100)
                      : 0,
                  tokensDelta: 0,
                  latencyMs: event.telemetry.avgAiLatencyMs,
                },
              ];
              return next.slice(-60);
            });
          } else if (event.type === 'neural:pulse') {
            setLatestPulse({
              id: Date.now() + Math.random(),
              regionId: event.regionId,
              fromAgentId: event.fromAgentId,
            });
            neuralEventBus.dispatchEvent(new CustomEvent('neural:activity', { detail: ev.data }));
          } else if (event.type === 'agent:updated') {
            setAgents((prev) => {
              const idx = prev.findIndex((a) => a.id === event.agent.id);
              if (idx === -1) return [...prev, event.agent];
              const copy = [...prev];
              copy[idx] = event.agent;
              return copy;
            });
            const act =
              event.agent.status === 'reasoning'
                ? 'thinking:0.8'
                : event.agent.status === 'executing'
                  ? 'tool:0.85'
                  : event.agent.status === 'error'
                    ? 'error@layer2'
                    : 'success:0.4';
            neuralEventBus.dispatchEvent(new CustomEvent('neural:activity', { detail: act }));
          } else if (event.type === 'project:updated') {
            setProjects((prev) => {
              const idx = prev.findIndex((p) => p.id === event.project.id);
              if (idx === -1) return [event.project, ...prev];
              const copy = [...prev];
              copy[idx] = event.project;
              return copy;
            });
            neuralEventBus.dispatchEvent(new CustomEvent('neural:activity', { detail: 'query:0.75' }));
          } else if (event.type === 'activity:logged') {
            setActivityLogs((prev) => [event.entry, ...prev].slice(0, 150));
            neuralEventBus.dispatchEvent(new CustomEvent('neural:activity', { detail: ev.data }));
          } else if (event.type === 'comm:updated') {
            setCommDrafts((prev) => {
              const idx = prev.findIndex((d) => d.id === event.draft.id);
              if (idx === -1) return [event.draft, ...prev];
              const copy = [...prev];
              copy[idx] = event.draft;
              return copy;
            });
          } else if (event.type === 'finance:updated') {
            setFinancialRequests((prev) => {
              const idx = prev.findIndex((f) => f.id === event.item.id);
              if (idx === -1) return [event.item, ...prev];
              const copy = [...prev];
              copy[idx] = event.item;
              return copy;
            });
          } else if (event.type === 'world:welcome') {
            setSelfPlayerId(event.selfId);
            setWorldPlayers(event.players);
            setWorldObjects(event.objects);
            setWorldChat(event.chat);
            if (event.skybox) setSkybox(event.skybox);
          } else if (event.type === 'world:players') {
            setWorldPlayers(event.players);
          } else if (event.type === 'world:objects') {
            setWorldObjects(event.objects);
          } else if (event.type === 'world:skybox') {
            setSkybox(event.skybox);
          } else if (event.type === 'world:chat') {
            setWorldChat((prev) => [...prev, event.message].slice(-60));
          } else if (event.type === 'halo:state') {
            applyKernelPayloadToStore({ kernel: event.snapshot });
          } else if (event.type === 'halo:cursor') {
            haloStore.setState((prev) => ({
              ...prev,
              sharedCursors: mergeSharedCursor(prev.sharedCursors, {
                ...event.cursor,
                activeModule: event.cursor.activeModule as any,
              }),
            }));
          } else if (event.type === 'jarvis:orb') {
            setJarvisOrbState(event.state);
            setJarvisOrbLabel(event.label || event.state.toUpperCase());
          } else if (event.type === 'jarvis:hologram') {
            setJarvisHologram(event.hologram);
          } else if (event.type === 'jarvis:toast') {
            setJarvisToasts((prev) => [event.toast, ...prev.filter((t) => t.id !== event.toast.id)].slice(0, 6));
          } else if (event.type === 'jarvis:reminder') {
            setJarvisReminders((prev) => {
              const idx = prev.findIndex((r) => r.id === event.reminder.id);
              if (idx === -1) return [event.reminder, ...prev];
              const copy = [...prev];
              copy[idx] = event.reminder;
              return copy;
            });
          }
        } catch {
          // ignore malformed WS frames
        }
      };
    }

    connect();
    return () => {
      closedByCleanup = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [isOffline, neuralEventBus]);

  // Reconcile offline queue automatically upon reconnection
  const syncOfflineQueue = useCallback(async () => {
    if (isOffline) return;
    const queue = await listOfflineQueue();
    const { pending } = reconcileOfflineQueue(queue, appliedOfflineIdsRef.current);
    for (const action of pending) {
      try {
        if (action.type === 'create-memory') {
          await fetch('/api/memories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
          });
        } else if (action.type === 'create-agent') {
          await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
          });
        } else if (action.type === 'update-agent') {
          const { id, patch } = action.payload as { id: string; patch: Partial<AgentProfile> };
          await fetch(`/api/agents/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          });
        }
        appliedOfflineIdsRef.current.add(action.id);
        await removeOfflineAction(action.id);
      } catch {
        break;
      }
    }
    await refreshOfflineQueue();
  }, [isOffline, refreshOfflineQueue]);

  useEffect(() => {
    if (!isOffline && offlineQueue.length > 0) {
      void syncOfflineQueue();
    }
  }, [isOffline, offlineQueue.length, syncOfflineQueue]);

  // Action Handlers
  async function handleSendCentralCommand(prompt: string) {
    const res = await fetch('/api/central/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Command failed');
    return data;
  }

  async function handleCreateProject(objective: string) {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Project creation failed');
    setProjects((prev) => [data.project, ...prev.filter((p) => p.id !== data.project.id)]);
  }

  async function handleApproveProjectTask(projectId: string, taskId: string) {
    const res = await fetch(`/api/projects/${projectId}/approve-task/${taskId}`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.project) {
      setProjects((prev) => prev.map((p) => (p.id === projectId ? data.project : p)));
    }
  }

  async function handleUpdateAgent(id: string, patch: Partial<AgentProfile>) {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    if (isOffline) {
      await enqueueOfflineAction({
        id: `upd-${id}-${Date.now()}`,
        type: 'update-agent',
        payload: { id, patch },
        createdAt: Date.now(),
      });
      await refreshOfflineQueue();
      return;
    }
    await fetch(`/api/agents/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async function handleCreateAgent(payload: Partial<AgentProfile>) {
    if (isOffline) {
      const localAgent: AgentProfile = {
        id: `agent-local-${Date.now()}`,
        name: payload.name || 'Offline-Agent',
        role: payload.role || 'Specialist',
        expertise: payload.expertise || ['general'],
        personality: payload.personality || 'Offline queued',
        systemPrompt: payload.systemPrompt || '',
        model: 'gemini-4-hydrogen',
        autonomy: payload.autonomy || 'SUPERVISED',
        status: 'idle',
        currentObjective: 'Queued offline',
        currentStage: 'Standby',
        position: [0, 0, -4.5],
        appearance: payload.appearance!,
        voice: { pitch: 1, rate: 1, style: 'Standard' },
        permissions: {
          terminalRead: true,
          terminalWrite: false,
          webBrowse: true,
          sendEmail: false,
          sendSms: false,
          makeCalls: false,
          codeDeploy: false,
          financialSpendLimitUsd: 25,
        },
        metrics: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0, avgLatencyMs: 0 },
        updatedAt: Date.now(),
      };
      setAgents((prev) => [...prev, localAgent]);
      await enqueueOfflineAction({
        id: localAgent.id,
        type: 'create-agent',
        payload: localAgent,
        createdAt: Date.now(),
      });
      await refreshOfflineQueue();
      return;
    }
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok && data.agent) {
      setAgents((prev) => [...prev, data.agent]);
      setSelectedAgentId(data.agent.id);
    }
  }

  async function handleChatWithAgent(id: string, message: string) {
    const res = await fetch(`/api/agents/${id}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Agent chat failed');
    return data;
  }

  async function handleTogglePlugin(id: string) {
    const res = await fetch(`/api/plugins/${id}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.plugins) setPlugins(data.plugins);
  }

  async function handleAddPlugin(payload: { name: string; description: string; sourceRepo: string }) {
    const res = await fetch('/api/plugins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok && data.plugins) setPlugins(data.plugins);
  }

  async function handleDraftComm(payload: {
    channel: 'email' | 'sms' | 'voice-call';
    agentId: string;
    recipient: string;
    subject?: string;
    body: string;
  }) {
    const res = await fetch('/api/comms/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok && data.draft) {
      setCommDrafts((prev) => [data.draft, ...prev]);
    }
  }

  async function handleDecideComm(id: string, decision: 'approve' | 'reject') {
    const res = await fetch(`/api/comms/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    if (data.draft) {
      setCommDrafts((prev) => prev.map((d) => (d.id === id ? data.draft : d)));
    }
    if (!res.ok) throw new Error(data.error || 'Dispatch blocked');
  }

  async function handleDecideFinance(id: string, decision: 'approve' | 'reject') {
    const res = await fetch(`/api/finance/${id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    if (res.ok && data.item) {
      setFinancialRequests((prev) => prev.map((f) => (f.id === id ? data.item : f)));
      if (telemetry) {
        setTelemetry({
          ...telemetry,
          monthlyBudgetUsd: data.monthlyBudgetUsd,
          monthlyCommittedUsd: data.monthlyCommittedUsd,
        });
      }
    }
  }

  async function handleUpdateBudget(monthlyBudgetUsd: number) {
    const res = await fetch('/api/finance/budget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBudgetUsd }),
    });
    const data = await res.json();
    if (res.ok && telemetry) {
      setTelemetry({ ...telemetry, monthlyBudgetUsd: data.monthlyBudgetUsd });
    }
  }

  async function handleAddMemory(item: {
    title: string;
    content: string;
    category: MemoryItem['category'];
    tags: string[];
  }) {
    if (isOffline) {
      const localMem: MemoryItem = {
        id: `mem-${Date.now()}`,
        scope: 'central',
        category: item.category,
        title: item.title,
        content: item.content,
        tags: item.tags,
        confidence: 0.95,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setMemories((prev) => [localMem, ...prev]);
      await enqueueOfflineAction({
        id: localMem.id,
        type: 'create-memory',
        payload: localMem,
        createdAt: Date.now(),
      });
      await refreshOfflineQueue();
      return;
    }
    const res = await fetch('/api/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const data = await res.json();
    if (res.ok && data.memory) setMemories((prev) => [data.memory, ...prev]);
  }

  async function handleDeleteMemory(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    if (!isOffline) {
      await fetch(`/api/memories/${id}`, { method: 'DELETE' });
    }
  }

  async function handleUnlockVault(passcode: string, role: 'Admin' | 'Operator' | 'Viewer') {
    const res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Authentication failed');
    setSessionToken(data.token);
    setSessionRole(data.role);
    setVaultClaimed(Boolean(data.vaultClaimed));
  }

  async function handleStoreSecret(id: string, label: string, provider: string, value: string) {
    const res = await fetch('/api/vault/secrets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({ id, label, provider, value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to store secret');
    setSecrets((prev) => [...prev.filter((s) => s.id !== data.secret.id), data.secret]);
    if (data.integrations) setIntegrations(data.integrations);
  }

  async function handleDeleteSecret(id: string) {
    const res = await fetch(`/api/vault/secrets/${id}`, {
      method: 'DELETE',
      headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
    });
    const data = await res.json();
    if (res.ok) {
      setSecrets(data.secrets ?? []);
      if (data.integrations) setIntegrations(data.integrations);
    }
  }

  function applyJarvisStateSnapshot(snapshot: JarvisStateSnapshot) {
    setJarvisOrbState(snapshot.orbState);
    setJarvisOrbLabel(snapshot.orbLabel);
    setJarvisHologram(snapshot.hologram);
    setJarvisReminders(snapshot.reminders);
    setJarvisTopology(snapshot.networkTopology);
    setJarvisDiagnostics(snapshot.latestDiagnostics);
    setJarvisLog(snapshot.domainLog);
  }

  async function handleJarvisDispatch(prompt: string, domain: JarvisDomainId) {
    const res = await fetch('/api/jarvis/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, domain }),
    });
    const data = await res.json();
    if (res.ok && data.state) {
      applyJarvisStateSnapshot(data.state);
    }
  }

  async function handleJarvisHologram(patch: {
    model?: JarvisHologramModelId;
    explodeFactor?: number;
    heatmap?: boolean;
    scanSubnet?: boolean;
  }) {
    const res = await fetch('/api/jarvis/hologram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (res.ok && data.state) {
      applyJarvisStateSnapshot(data.state);
    }
  }

  async function handleJarvisCreateReminder(title: string, when: string) {
    const res = await fetch('/api/jarvis/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, when }),
    });
    const data = await res.json();
    if (res.ok && data.state) {
      applyJarvisStateSnapshot(data.state);
    }
  }

  async function handleJarvisDeleteReminder(id: string) {
    const res = await fetch(`/api/jarvis/reminders/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.state) {
      applyJarvisStateSnapshot(data.state);
    }
  }

  const panelTitleMap: Record<Exclude<WorkspacePanel, null>, string> = {
    jarvis: 'J.A.R.V.I.S // Central Command Operations',
    'neural-link': 'Neural Link & Live Mesh Telemetry',
    agents: 'Autonomous Agent Society & 3D Studio',
    projects: 'Autonomous Project Orchestrator',
    terminal: 'Virtual Computer Terminal & Dev Studio',
    telemetry: 'Real-Time Telemetry & Activity Heatmaps',
    integrations: 'Web Intelligence, Comms & Finance',
    memory: 'Adaptive Memory Core',
    security: 'Security Governance, Vault & Offline Sync',
    prototype: '3D Holographic Prototype Studio',
    world: 'Aether World M1, Multiplayer & Roadmap',
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#080B12] text-[#E6EDF7]">
      {/* Dedicated Full-Bleed WebGL 3D Viewport */}
      <CommandViewport3D
        agents={agents}
        regions={regions}
        worldPlayers={worldPlayers}
        selfPlayerId={selfPlayerId}
        worldObjects={worldObjects}
        theme={theme}
        weather={weather}
        timeOfDayHours={timeOfDayHours}
        skybox={skybox}
        cameraMode={cameraMode}
        selectedAgentId={selectedAgentId}
        selectedWorldObjectId={selectedWorldObjectId}
        objectDragMode={objectDragMode}
        tapPlaceActive={tapPlaceActive}
        gridSnap={gridSnap}
        gravityPreset={gravityPreset}
        physicsCommand={physicsCommand}
        prototypeKind={prototypeKind}
        prototypeColor={prototypeColor}
        prototypeMetalness={prototypeMetalness}
        reducedMotion={reducedMotion}
        latestPulse={latestPulse}
        touchMoveVector={touchMoveVector}
        onSelectAgent={(id) => {
          setSelectedAgentId(id);
          setCameraMode('agent-focus');
          setActivePanel('agents');
        }}
        onSelectRegion={(regId) => {
          setSelectedRegionId(regId);
          setCameraMode('core-focus');
          setActivePanel('neural-link');
        }}
        onSelectWorldObject={(id) => {
          if (id === 'prop-rig-west' && selectedWorldObjectId === 'prop-rig-west') {
            setWorkstationOpen(true);
          }
          setSelectedWorldObjectId(id);
        }}
        onMoveWorldObject={(id, position, rotationY) => {
          setWorldObjects((prev) =>
            prev.map((obj) =>
              obj.id === id
                ? { ...obj, position, rotationY: rotationY ?? obj.rotationY }
                : obj,
            ),
          );
          sendWs({ type: 'world:move-object', id, position, rotationY });
        }}
        onTapPlaceGround={(pos) => {
          sendWs({
            type: 'world:place-object',
            object: {
              kind: 'media-screen',
              label: 'Quick Holo Screen',
              position: pos,
              rotationY: 0,
              color: '#22d3ee',
              ownerCallsign: callsign,
              motion: 'hover',
              mediaType: 'procedural',
              screenPreset: 'waveform',
            },
          });
          setTapPlaceActive(false);
        }}
        onHoldStateChange={setHoldingObjectId}
        onUserCameraOverride={() => {
          setCameraMode('orbit');
        }}
        onLocalMove={(position, yaw) => {
          sendWs({ type: 'world:move', position, yaw });
        }}
        haloFormFactor={haloFormFactor}
        haloPalette={haloPalette}
        haloPanels3D={haloPanels3D}
        haloZones={haloZones}
        haloActiveModule={haloActiveModule}
        haloKillSwitch={haloKillSwitch}
        haloGlitchPulseAt={haloGlitchPulseAt}
        pendingApprovalsCount={pendingApprovalsCount}
        runningTasksCount={runningTasksCount}
        jarvisHologram={jarvisHologram}
        onClickHaloPanel={(moduleId) => {
          haloStore.setState({ isOpen: true, activeModule: moduleId, glitchPulseAt: Date.now() });
        }}
        onRegisterHandDriver={(driver) => {
          handDriverRef.current = driver;
        }}
      />

      {/* Top Navigation Bar (Strict 3-Zone Contract, solid/rgba surface — no backdrop-blur over WebGL) */}
      <header className="fixed top-0 inset-x-0 z-20 flex items-center justify-between gap-8 px-6 py-3 bg-[#0A0F1A]/90 border-b border-slate-800/90">
        {/* Zone 1: Single text wordmark */}
        <button
          type="button"
          onClick={() => {
            setActivePanel(null);
            haloStore.setState({ isOpen: false });
            setCameraMode('orbit');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
        >
          VCALABS
        </button>

        {/* Zone 2: 6 concise single-line module links */}
        <nav aria-label="Operating System Modules" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          {(
            [
              ['jarvis', 'JARVIS'],
              ['neural-link', 'Neural Link'],
              ['agents', 'Agents'],
              ['projects', 'Projects'],
              ['terminal', 'Terminal'],
              ['integrations', 'Systems'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                haloStore.setState({ isOpen: false });
                setActivePanel((prev) => (prev === key ? null : key));
              }}
              className={`whitespace-nowrap shrink-0 transition-colors pb-0.5 cursor-pointer ${
                activePanel === key
                  ? 'text-cyan-300 border-b border-cyan-400'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 primary CTA */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setActivePanel(null);
              haloStore.setState((prev) => ({ ...prev, isOpen: !prev.isOpen, glitchPulseAt: Date.now() }));
            }}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              haloKillSwitch
                ? 'bg-rose-500 text-white hover:bg-rose-400'
                : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
            }`}
          >
            {haloKillSwitch ? 'HALO (HALTED)' : 'HALO HUD'}
          </button>
        </div>
      </header>

      {/* Mobile Compact Module Strip (visible only below md) */}
      <div className="fixed top-14 inset-x-0 z-20 flex md:hidden items-center gap-2 px-3 py-1.5 bg-[#0A0F1A]/92 border-b border-slate-800 overflow-x-auto">
        {(
          [
            ['jarvis', 'JARVIS'],
            ['neural-link', 'Neural Link'],
            ['agents', 'Agents'],
            ['projects', 'Projects'],
            ['terminal', 'Terminal'],
            ['integrations', 'Systems'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              haloStore.setState({ isOpen: false });
              setActivePanel((prev) => (prev === key ? null : key));
            }}
            className={`px-2.5 py-1 text-xs rounded whitespace-nowrap shrink-0 cursor-pointer ${
              activePanel === key ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sliding OS Workstation Drawer (Right Side, leaving central 3D Core visible) */}
      {activePanel && (
        <aside
          aria-label={panelTitleMap[activePanel]}
          className="fixed top-16 right-4 bottom-20 z-30 w-[min(520px,calc(100vw-2rem))] bg-[#0B101C]/96 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
              {panelTitleMap[activePanel]}
            </h2>
            <button
              type="button"
              aria-label="Close workstation panel"
              onClick={() => setActivePanel(null)}
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 p-4">
            {activePanel === 'jarvis' && (
              <JarvisCommandDeck
                orbState={jarvisOrbState}
                orbLabel={jarvisOrbLabel}
                hologram={jarvisHologram}
                reminders={jarvisReminders}
                networkTopology={jarvisTopology}
                latestDiagnostics={jarvisDiagnostics}
                domainLog={jarvisLog}
                biometrics={jarvisBiometrics}
                isOffline={isOffline}
                onDispatch={handleJarvisDispatch}
                onUpdateHologram={handleJarvisHologram}
                onCreateReminder={handleJarvisCreateReminder}
                onDeleteReminder={handleJarvisDeleteReminder}
                onSetOrbState={(st, lbl) => {
                  setJarvisOrbState(st);
                  if (lbl) setJarvisOrbLabel(lbl);
                }}
                onFocusCoreIn3D={() => setCameraMode('core-focus')}
              />
            )}

            {activePanel === 'neural-link' && (
              <NeuralLinkPanel
                regions={regions}
                selectedRegionId={selectedRegionId}
                onSelectRegion={setSelectedRegionId}
                geminiConfigured={geminiConfigured}
                isOffline={isOffline}
                neuralEventBus={neuralEventBus}
                onSendCommand={handleSendCentralCommand}
                onCreateProjectFromVoice={handleCreateProject}
              />
            )}

            {activePanel === 'agents' && (
              <AgentStudioPanel
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
                onFocusAgentIn3D={(id) => {
                  setSelectedAgentId(id);
                  setCameraMode('agent-focus');
                }}
                onUpdateAgent={handleUpdateAgent}
                onCreateAgent={handleCreateAgent}
                onChatWithAgent={handleChatWithAgent}
                isOffline={isOffline}
              />
            )}

            {activePanel === 'projects' && (
              <ProjectOrchestratorPanel
                projects={projects}
                agents={agents}
                isOffline={isOffline}
                onCreateProject={handleCreateProject}
                onApproveTask={handleApproveProjectTask}
              />
            )}

            {activePanel === 'terminal' && (
              <TerminalStudioPanel
                plugins={plugins}
                onTogglePlugin={handleTogglePlugin}
                onAddPlugin={handleAddPlugin}
                isOffline={isOffline}
              />
            )}

            {activePanel === 'telemetry' && (
              <TelemetryAnalyticsPanel
                telemetry={telemetry}
                history={telemetryHistory}
                agents={agents}
                logs={activityLogs}
              />
            )}

            {activePanel === 'integrations' && (
              <IntegrationsGovernancePanel
                integrations={integrations}
                commDrafts={commDrafts}
                financialRequests={financialRequests}
                agents={agents}
                monthlyBudgetUsd={telemetry?.monthlyBudgetUsd ?? 500}
                monthlyCommittedUsd={telemetry?.monthlyCommittedUsd ?? 48}
                isOffline={isOffline}
                onDraftComm={handleDraftComm}
                onDecideComm={handleDecideComm}
                onDecideFinance={handleDecideFinance}
                onUpdateBudget={handleUpdateBudget}
              />
            )}

            {(activePanel === 'memory' || activePanel === 'security' || activePanel === 'prototype') && (
              <MemorySecurityPrototypePanel
                key={activePanel}
                initialTab={activePanel}
                memories={memories}
                onAddMemory={handleAddMemory}
                onDeleteMemory={handleDeleteMemory}
                vaultClaimed={vaultClaimed}
                sessionRole={sessionRole}
                secrets={secrets}
                onUnlockVault={handleUnlockVault}
                onStoreSecret={handleStoreSecret}
                onDeleteSecret={handleDeleteSecret}
                offlineQueue={offlineQueue}
                isOffline={isOffline}
                onSyncOfflineQueue={syncOfflineQueue}
                prototypeKind={prototypeKind}
                prototypeColor={prototypeColor}
                prototypeMetalness={prototypeMetalness}
                onChangePrototype={(kind, col, met) => {
                  setPrototypeKind(kind);
                  setPrototypeColor(col);
                  setPrototypeMetalness(met);
                }}
              />
            )}

            {activePanel === 'world' && (
              <WorldRoadmapPanel
                selfPlayerId={selfPlayerId}
                callsign={callsign}
                avatarColor={avatarColor}
                players={worldPlayers}
                worldObjects={worldObjects}
                chatMessages={worldChat}
                roadmap={roadmap}
                theme={theme}
                skybox={skybox}
                selectedWorldObjectId={selectedWorldObjectId}
                objectDragMode={objectDragMode}
                tapPlaceActive={tapPlaceActive}
                gridSnap={gridSnap}
                gravityPreset={gravityPreset}
                onChangeTheme={setTheme}
                onChangeSkybox={(next) => {
                  setSkybox(next);
                  sendWs({ type: 'world:skybox', skybox: next });
                }}
                onChangeGravity={setGravityPreset}
                onPhysicsCommand={(cmd) => setPhysicsCommand({ ...cmd, nonce: Date.now() })}
                onSelectWorldObject={setSelectedWorldObjectId}
                onToggleObjectDragMode={() => {
                  setObjectDragMode((prev) => !prev);
                  setTapPlaceActive(false);
                }}
                onToggleTapPlace={() => {
                  setTapPlaceActive((prev) => !prev);
                  setObjectDragMode(false);
                }}
                onToggleGridSnap={() => setGridSnap((prev) => !prev)}
                onJoinUpdate={(nextName, nextColor) => {
                  setCallsign(nextName);
                  setAvatarColor(nextColor);
                  sendWs({ type: 'world:join', callsign: nextName, avatarColor: nextColor });
                }}
                onEmote={(emote) => sendWs({ type: 'world:emote', emote })}
                onSendChat={(text, radius) => sendWs({ type: 'world:chat', text, radius })}
                onPlaceObject={(obj) =>
                  sendWs({
                    type: 'world:place-object',
                    object: { ...obj, ownerCallsign: callsign },
                  })
                }
                onUpdateObject={(id, patch) => {
                  setWorldObjects((prev) =>
                    prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
                  );
                  sendWs({ type: 'world:update-object', id, patch });
                }}
                onRemoveObject={(id) => {
                  if (selectedWorldObjectId === id) setSelectedWorldObjectId(null);
                  sendWs({ type: 'world:remove-object', id });
                }}
              />
            )}
          </div>
        </aside>
      )}

      {/* Touch Walk D-Pad Overlay (shown when Walk mode is active) */}
      {cameraMode === 'walk' && (
        <div
          aria-label="Touch Walk D-Pad"
          className="fixed top-28 left-3 md:top-auto md:bottom-24 md:left-4 z-20 grid grid-cols-3 gap-1 w-28 p-1.5 rounded-xl bg-[#0B101C]/90 border border-slate-800 shadow-lg"
        >
          <div />
          <button
            type="button"
            aria-label="Walk Forward"
            onPointerDown={() => setTouchMoveVector({ x: 0, z: 1 })}
            onPointerUp={() => setTouchMoveVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchMoveVector({ x: 0, z: 0 })}
            className="p-2 rounded bg-slate-900 border border-slate-700 text-cyan-300 flex items-center justify-center active:bg-cyan-500/25 cursor-pointer"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <div />
          <button
            type="button"
            aria-label="Strafe Left"
            onPointerDown={() => setTouchMoveVector({ x: -1, z: 0 })}
            onPointerUp={() => setTouchMoveVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchMoveVector({ x: 0, z: 0 })}
            className="p-2 rounded bg-slate-900 border border-slate-700 text-cyan-300 flex items-center justify-center active:bg-cyan-500/25 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Walk Backward"
            onPointerDown={() => setTouchMoveVector({ x: 0, z: -1 })}
            onPointerUp={() => setTouchMoveVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchMoveVector({ x: 0, z: 0 })}
            className="p-2 rounded bg-slate-900 border border-slate-700 text-cyan-300 flex items-center justify-center active:bg-cyan-500/25 cursor-pointer"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Strafe Right"
            onPointerDown={() => setTouchMoveVector({ x: 1, z: 0 })}
            onPointerUp={() => setTouchMoveVector({ x: 0, z: 0 })}
            onPointerLeave={() => setTouchMoveVector({ x: 0, z: 0 })}
            className="p-2 rounded bg-slate-900 border border-slate-700 text-cyan-300 flex items-center justify-center active:bg-cyan-500/25 cursor-pointer"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3D Touch-Hold / Tap-to-Place Status Banner */}
      {(holdingObjectId || objectDragMode || tapPlaceActive || selectedWorldObjectId) && (
        <div
          aria-live="polite"
          className="fixed top-26 md:top-16 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0B101C]/94 border border-cyan-500/40 text-[11px] text-slate-200 shadow-lg"
        >
          {holdingObjectId ? (
            <span className="text-cyan-300 font-medium">
              Holding 3D object · Drag across deck · Q / E to rotate
            </span>
          ) : tapPlaceActive ? (
            <span className="text-emerald-300 font-medium flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5" />
              Tap ground anywhere to place Holo Screen
            </span>
          ) : objectDragMode ? (
            <span className="text-cyan-300 font-medium flex items-center gap-1.5">
              <Move className="w-3.5 h-3.5" />
              Drag 3D active · Grab any prop to reposition
            </span>
          ) : (
            <span className="text-slate-300">
              Selected:{' '}
              <strong className="text-cyan-300">
                {worldObjects.find((o) => o.id === selectedWorldObjectId)?.label ?? '3D Prop'}
              </strong>{' '}
              · Hold & drag to move
            </span>
          )}
          {selectedWorldObjectId === 'prop-rig-west' && (
            <button
              type="button"
              onClick={() => setWorkstationOpen(true)}
              className="px-2 py-0.5 rounded bg-[#00c8ff] text-slate-950 font-semibold hover:bg-cyan-300 cursor-pointer"
            >
              Open MAYA PC
            </button>
          )}
          {selectedWorldObjectId && (
            <button
              type="button"
              onClick={() => setActivePanel('world')}
              className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/30 cursor-pointer"
            >
              Inspect
            </button>
          )}
          {(objectDragMode || tapPlaceActive || selectedWorldObjectId) && (
            <button
              type="button"
              aria-label="Clear 3D selection or mode"
              onClick={() => {
                setObjectDragMode(false);
                setTapPlaceActive(false);
                setSelectedWorldObjectId(null);
              }}
              className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
            >
              Done
            </button>
          )}
        </div>
      )}

      {/* Collapsible Bottom Control Dock (hidden while full-screen Flat/Shared HALO HUD is open) */}
      {!(haloIsOpen && (haloFormFactor === 'flat' || haloFormFactor === 'shared')) && (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center max-w-[min(1410px,98vw)] w-full pointer-events-none">
        <button
          type="button"
          onClick={() => setDockCollapsed((prev) => !prev)}
          className="pointer-events-auto mb-1.5 px-3 py-1 rounded-md bg-[#0B101C]/92 border border-slate-800 text-[11px] font-medium text-slate-300 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{dockCollapsed ? 'Show Controls (H)' : 'Hide Controls (H)'}</span>
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto w-full bg-[#0B101C]/94 border border-slate-800 rounded-xl px-2.5 py-1.5 flex flex-wrap xl:flex-nowrap items-center justify-between gap-1.5 text-xs shadow-xl">
            {/* Environment Theme */}
            <div className="flex items-center gap-1.5 shrink-0">
              <label htmlFor="env-theme-select" className="text-slate-400 whitespace-nowrap">
                Scene
              </label>
              <select
                id="env-theme-select"
                aria-label="Environment"
                value={theme}
                onChange={(e) => setTheme(e.target.value as EnvironmentTheme)}
                className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-slate-100"
              >
                {ENVIRONMENT_THEME_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.tier === 'hyper' ? `${opt.label} (Hyper)` : opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Camera Mode */}
            <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-md border border-slate-800 shrink-0">
              {(
                [
                  ['orbit', 'Orbit'],
                  ['walk', 'Walk WASD'],
                  ['core-focus', 'Core'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCameraMode(m)}
                  className={`px-2 py-1 rounded text-[11px] whitespace-nowrap cursor-pointer ${
                    cameraMode === m ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Weather & Time */}
            <div className="flex items-center gap-1.5 shrink-0">
              <label htmlFor="weather-select" className="text-slate-400">
                Weather
              </label>
              <select
                id="weather-select"
                value={weather}
                onChange={(e) => setWeather(e.target.value as WeatherMode)}
                className="bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-slate-100"
              >
                <option value="clear">Clear</option>
                <option value="rain">Rain</option>
                <option value="ion-storm">Ion Storm</option>
              </select>
              <input
                type="range"
                aria-label="Time of day"
                min="6"
                max="22"
                step="1"
                value={timeOfDayHours}
                onChange={(e) => setTimeOfDayHours(Number(e.target.value))}
                className="w-14 accent-cyan-400"
              />
            </div>

            {/* Quick OS Modules & Offline / Motion Toggles */}
            <div className="flex flex-wrap xl:flex-nowrap items-center gap-1">
              <button
                type="button"
                onClick={() => setWorkstationOpen((prev) => !prev)}
                className={`px-2 py-1 rounded border text-[11px] whitespace-nowrap font-semibold cursor-pointer ${
                  workstationOpen
                    ? 'bg-[#00c8ff] border-[#00ffff] text-slate-950'
                    : 'bg-[#003264]/50 border-[#00c8ff]/60 text-[#00e5ff] hover:border-[#00ffff]'
                }`}
              >
                Admin PC
              </button>
              {(
                [
                  ['telemetry', 'Telemetry'],
                  ['world', `World (${worldPlayers.length})`],
                  ['memory', 'Memory'],
                  ['security', 'Security'],
                  ['prototype', '3D Studio'],
                ] as const
              ).map(([p, label]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setActivePanel((prev) => (prev === p ? null : p))}
                  className={`px-1.5 py-1 rounded border text-[11px] whitespace-nowrap cursor-pointer ${
                    activePanel === p
                      ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}

              <button
                type="button"
                aria-label="Toggle 3D object drag mode"
                onClick={() => {
                  setObjectDragMode((prev) => !prev);
                  setTapPlaceActive(false);
                }}
                className={`px-2 py-1 rounded border text-[11px] whitespace-nowrap cursor-pointer ${
                  objectDragMode
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                Drag 3D
              </button>

              <button
                type="button"
                aria-label="Toggle ZIM-Cam Hand Tracking"
                onClick={() => setHandCamOpen((prev) => !prev)}
                className={`px-2 py-1 rounded border text-[11px] whitespace-nowrap cursor-pointer ${
                  handCamOpen
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                Hand Cam
              </button>

              <button
                type="button"
                onClick={() => haloStore.setState((prev) => ({ ...prev, wristOpen: !prev.wristOpen }))}
                className={`px-2 py-1 rounded border text-[11px] whitespace-nowrap cursor-pointer ${
                  haloWristOpen
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                Wrist (Tab)
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = haloFormFactor === 'dome' ? 'flat' : 'dome';
                  haloStore.updateLayout({ formFactor: next });
                  if (!haloIsOpen) haloStore.setState({ isOpen: true });
                }}
                className={`px-2 py-1 rounded border text-[11px] whitespace-nowrap cursor-pointer ${
                  haloFormFactor === 'dome'
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                Dome 3D
              </button>

              <button
                type="button"
                aria-label="Toggle offline mode"
                onClick={() => setSimulatedOffline((prev) => !prev)}
                className={`px-2 py-1 rounded border text-[11px] flex items-center gap-1 whitespace-nowrap cursor-pointer ${
                  isOffline
                    ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                {isOffline ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3 text-emerald-400" />}
                <span>{isOffline ? 'Offline' : wsConnected ? 'Synced' : 'Connecting'}</span>
              </button>

              <button
                type="button"
                onClick={() => setReducedMotion((prev) => !prev)}
                className={`px-2 py-1 rounded border text-[11px] whitespace-nowrap cursor-pointer ${
                  reducedMotion
                    ? 'bg-slate-800 border-cyan-400/60 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                {reducedMotion ? 'Calm' : 'Motion'}
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Admin Main Computer Personal Maya Workstation (Local Host Only) */}
      <MayaAdminWorkstation
        open={workstationOpen}
        onClose={() => setWorkstationOpen(false)}
        agents={agents}
        projects={projects}
        regions={regions}
        telemetry={telemetry}
        activityLogs={activityLogs}
        memories={memories}
        commDrafts={commDrafts}
        financialRequests={financialRequests}
        vaultClaimed={vaultClaimed}
        sessionRole={sessionRole}
        isOffline={isOffline}
        reducedMotion={reducedMotion}
        onUnlockVault={handleUnlockVault}
        onSendCentralCommand={handleSendCentralCommand}
        onChatWithAgent={handleChatWithAgent}
        onUpdateAgent={handleUpdateAgent}
        onCreateProject={handleCreateProject}
        onApproveTask={handleApproveProjectTask}
        onDecideComm={handleDecideComm}
        onDecideFinance={handleDecideFinance}
        onFocusAgentIn3D={(agentId) => {
          setSelectedAgentId(agentId);
          setCameraMode('agent-focus');
        }}
        onFocusRegionIn3D={(regionId) => {
          setSelectedRegionId(regionId);
          setCameraMode('core-focus');
        }}
        onFocusAdminRigIn3D={() => {
          setSelectedWorldObjectId('prop-rig-west');
          setCameraMode('rig-focus');
        }}
      />

      {/* Floating 5-State JARVIS Orb & Stark HUD Notifications */}
      <JarvisOrbHud
        orbState={jarvisOrbState}
        orbLabel={jarvisOrbLabel}
        deckOpen={activePanel === 'jarvis'}
        hiddenByFullHud={haloIsOpen && (haloFormFactor === 'flat' || haloFormFactor === 'shared')}
        drawerOpen={Boolean(activePanel)}
        toasts={jarvisToasts}
        onToggleDeck={() => {
          haloStore.setState({ isOpen: false });
          setActivePanel((prev) => (prev === 'jarvis' ? null : 'jarvis'));
        }}
        onDismissToast={(id) => setJarvisToasts((prev) => prev.filter((t) => t.id !== id))}
      />

      {/* HALO Holographic Command HUD, Wrist HUD & Command Palette */}
      <HaloShell
        callsign={callsign}
        avatarColor={avatarColor}
        onBroadcastCursor={(cursor) => sendWs({ type: 'halo:cursor', ...cursor })}
      />
      <WristHud />
      <CommandPaletteModal />

      {/* ZIM-Cam Hand Tracking & CamMotion Spatial Controller */}
      <ZimHandCamOverlay
        open={handCamOpen}
        onClose={() => setHandCamOpen(false)}
        onFrame={(frame) => handDriverRef.current?.(frame)}
      />
    </div>
  );
}
