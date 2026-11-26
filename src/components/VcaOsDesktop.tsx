import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudSun,
  Columns,
  Command,
  Cpu,
  Gamepad2,
  Hand,
  LayoutGrid,
  Lock,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Search,
  Send,
  SlidersHorizontal,
  User,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  AgentProfile,
  AutonomyLevel,
  CameraMode,
  EnvironmentTheme,
  NeuralRegion,
  ProjectRecord,
  SystemTelemetry,
  WeatherMode,
} from '../types/os';
import type { HostWorkstationMetrics } from '../server/workstationMetrics';
import {
  clampSplitRatio,
  computeTiledRects,
  createDefaultVfsNodes,
  DEFAULT_TILING_CONFIG,
  evaluateHyprctlCommand,
  getModeViewportInsets,
  parseTilingConf,
  serializeTilingConf,
  VCA_OS_MODES,
  type TilingConfig,
  type VcaOsAppId,
  type VcaOsMode,
  type VcaOsStateSnapshot,
  type VcaOsWindow,
  type VfsNode,
} from '../utils/vcaOsEngine';
import { ENVIRONMENT_THEME_OPTIONS } from '../utils/worldEnhancements';
import { PapirusAppIcon, YukiLogoSvg } from './VcaOsIcons';

interface VcaOsDesktopProps {
  open: boolean;
  onClose: () => void;
  agents: AgentProfile[];
  projects: ProjectRecord[];
  regions: NeuralRegion[];
  telemetry: SystemTelemetry | null;
  theme: EnvironmentTheme;
  weather: WeatherMode;
  cameraMode: CameraMode;
  handCamOpen: boolean;
  isOffline: boolean;
  onChangeTheme: (theme: EnvironmentTheme) => void;
  onChangeWeather: (weather: WeatherMode) => void;
  onChangeCameraMode: (mode: CameraMode) => void;
  onToggleHandCam: () => void;
  onFocusAgentIn3D: (agentId: string) => void;
  onUpdateAgent: (id: string, patch: Partial<AgentProfile>) => Promise<void>;
  onChatWithAgent: (agentId: string, prompt: string) => Promise<{ reply: string }>;
  onCreateProject: (title: string, objective: string) => Promise<void>;
  onApproveTask: (projectId: string, taskId: string) => Promise<void>;
}

type StartMenuCategory = 'all' | 'agents' | 'development' | 'system' | 'places';
type YukiWallpaperTheme = 'yuki-aurora' | 'midnight-nebula' | 'obsidian-peaks';

interface AppCatalogItem {
  appId: VcaOsAppId;
  name: string;
  shortName: string;
  category: 'agents' | 'development' | 'system';
  accent: string;
  summary: string;
}

const APP_CATALOG: AppCatalogItem[] = [
  { appId: 'agents', name: 'Visual Agents Studio', shortName: 'Visual Agents', category: 'agents', accent: '#38bdf8', summary: 'Live autonomous agents, chat & 3D focus' },
  { appId: 'terminal', name: 'VCAOS Terminal (hyprctl)', shortName: 'Terminal', category: 'development', accent: '#34d399', summary: 'Hyprland IPC + sandbox Linux shell' },
  { appId: 'explorer', name: 'Files & tiling.conf', shortName: 'Files', category: 'system', accent: '#60a5fa', summary: 'Live compositor config & host workspace FS' },
  { appId: 'projects', name: 'Project Orchestrator', shortName: 'Projects', category: 'agents', accent: '#f59e0b', summary: 'Task graphs, approvals & mission dispatch' },
  { appId: 'monitor', name: 'btop Kernel Monitor', shortName: 'btop Monitor', category: 'system', accent: '#ec4899', summary: 'Host CPU/RAM metrics, neural regions & PIDs' },
  { appId: 'world3d', name: '3D Biome & Hand Bridge', shortName: '3D Nexus', category: 'development', accent: '#818cf8', summary: 'VCAOS Matrix 3D deck & ZIM-Cam bridge' },
];

const INITIAL_WINDOWS: VcaOsWindow[] = [
  {
    id: 'win-agents',
    appId: 'agents',
    title: 'Visual Agents Studio',
    workspace: 1,
    x: 124,
    y: 24,
    w: 632,
    h: 460,
    minimized: false,
    maximized: false,
    floating: false,
    zIndex: 2,
  },
  {
    id: 'win-terminal',
    appId: 'terminal',
    title: 'VCAOS Shell // hyprctl',
    workspace: 1,
    x: 774,
    y: 52,
    w: 530,
    h: 400,
    minimized: false,
    maximized: false,
    floating: false,
    zIndex: 3,
  },
  {
    id: 'win-explorer',
    appId: 'explorer',
    title: 'Config/vcaos/tiling.conf',
    workspace: 2,
    x: 140,
    y: 44,
    w: 660,
    h: 460,
    minimized: false,
    maximized: false,
    floating: false,
    zIndex: 1,
  },
];

function AppIcon({ appId, className = 'w-4 h-4' }: { appId: VcaOsAppId; className?: string }) {
  return <PapirusAppIcon appId={appId} className={className} />;
}

export function VcaOsDesktop({
  open,
  onClose,
  agents,
  projects,
  regions,
  telemetry,
  theme,
  weather,
  cameraMode,
  handCamOpen,
  isOffline,
  onChangeTheme,
  onChangeWeather,
  onChangeCameraMode,
  onToggleHandCam,
  onFocusAgentIn3D,
  onUpdateAgent,
  onChatWithAgent,
  onCreateProject,
  onApproveTask,
}: VcaOsDesktopProps) {
  // Shared-state desktop model (YukiOS pattern: single live state morphed across 6 shells)
  const [mode, setMode] = useState<VcaOsMode>('native');
  const [activeWorkspace, setActiveWorkspace] = useState<number>(1);
  const [tilingConfig, setTilingConfig] = useState<TilingConfig>(DEFAULT_TILING_CONFIG);
  const [windows, setWindows] = useState<VcaOsWindow[]>(INITIAL_WINDOWS);
  const [focusedWindowId, setFocusedWindowId] = useState<string | null>('win-agents');
  const [topZ, setTopZ] = useState<number>(10);

  // Desktop Shell Chrome Popovers & YukiOS Visual State
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [controlCenterOpen, setControlCenterOpen] = useState(false);
  const [launcherQuery, setLauncherQuery] = useState('');
  const [startCat, setStartCat] = useState<StartMenuCategory>('all');
  const [wallpaperTheme, setWallpaperTheme] = useState<YukiWallpaperTheme>('yuki-aurora');
  const [selectedDesktopIcon, setSelectedDesktopIcon] = useState<string | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [workspaceOverviewOpen, setWorkspaceOverviewOpen] = useState(false);

  // VFS + Sandbox Host Workspace State
  const [vfsNodes, setVfsNodes] = useState<VfsNode[]>(() => createDefaultVfsNodes(DEFAULT_TILING_CONFIG));
  const [sandboxFiles, setSandboxFiles] = useState<Array<{ path: string; size: number }>>([]);
  const [explorerMount, setExplorerMount] = useState<'vfs' | 'sandbox'>('vfs');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('Config/vcaos/tiling.conf');
  const [editorBuffer, setEditorBuffer] = useState<string>(() => serializeTilingConf(DEFAULT_TILING_CONFIG));
  const [fileSaveNote, setFileSaveNote] = useState<string>('');

  // Terminal & Agent Chat Local Buffers
  const [termLines, setTermLines] = useState<Array<{ kind: 'cmd' | 'out' | 'err'; text: string }>>([
    { kind: 'out', text: 'VCAOS Kernel // YukiOS Multi-Environment Platform (Connected to Host Sandbox)' },
    { kind: 'out', text: 'Type "hyprctl help", "vcaos agents", "vcaos scene vcaos-nexus", or any Linux shell command.' },
  ]);
  const [termInput, setTermInput] = useState('');
  const [termBusy, setTermBusy] = useState(false);

  const [selectedStudioAgentId, setSelectedStudioAgentId] = useState<string>('');
  const [agentPromptById, setAgentPromptById] = useState<Record<string, string>>({});
  const [agentLogById, setAgentLogById] = useState<Record<string, Array<{ role: 'op' | 'agent'; text: string }>>>({});
  const [agentBusyId, setAgentBusyId] = useState<string | null>(null);

  // Project Composer State
  const [newProjTitle, setNewProjTitle] = useState('');
  const [newProjObj, setNewProjObj] = useState('');
  const [projBusy, setProjBusy] = useState(false);

  // Host Metrics for btop Monitor
  const [hostMetrics, setHostMetrics] = useState<HostWorkstationMetrics | null>(null);

  // Measured Container Dimensions for BSP / Master-Stack Tiling
  const desktopRef = useRef<HTMLDivElement | null>(null);
  const [bounds, setBounds] = useState({ width: 1280, height: 760 });

  // Window Drag & Resize State
  const dragRef = useRef<{
    winId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const resizeRef = useRef<{
    winId: string;
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);

  // Live Clock & Date (YukiOS stacked taskbar tray with tabular-nums)
  const [nowDate, setNowDate] = useState(() => new Date());
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      setNowDate(new Date());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const clockText = useMemo(
    () =>
      nowDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
    [nowDate],
  );
  const dateText = useMemo(
    () =>
      nowDate.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      }),
    [nowDate],
  );

  // Measure Desktop Canvas Size
  useEffect(() => {
    if (!open || !desktopRef.current) return;
    const el = desktopRef.current;
    const measure = () => {
      setBounds({
        width: Math.max(480, el.clientWidth),
        height: Math.max(360, el.clientHeight),
      });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [open]);

  // Sync VCAOS Backend State + Host Sandbox Files on Open
  useEffect(() => {
    if (!open || isOffline) return;
    let cancelled = false;
    void (async () => {
      try {
        const [osRes, filesRes, metricsRes] = await Promise.all([
          fetch('/api/vcaos/state'),
          fetch('/api/workspace/files'),
          fetch('/api/workstation/metrics'),
        ]);
        if (cancelled) return;
        if (osRes.ok) {
          const snap = (await osRes.json()) as VcaOsStateSnapshot;
          setMode(snap.mode);
          setActiveWorkspace(snap.activeWorkspace);
          setTilingConfig(snap.tilingConfig);
          setVfsNodes(snap.vfsNodes);
          const confNode = snap.vfsNodes.find((n) => n.path === 'Config/vcaos/tiling.conf');
          if (confNode && selectedFilePath === 'Config/vcaos/tiling.conf') {
            setEditorBuffer(confNode.content);
          }
        }
        if (filesRes.ok) {
          const fData = await filesRes.json();
          if (Array.isArray(fData.files)) {
            setSandboxFiles(fData.files);
          }
        }
        if (metricsRes.ok) {
          const mData = await metricsRes.json();
          if (mData.metrics) setHostMetrics(mData.metrics);
        }
      } catch {
        // Offline / local fallback already loaded
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isOffline]);

  // Poll btop Host Metrics when Monitor Window is visible
  const monitorOpen = useMemo(
    () => open && windows.some((w) => w.appId === 'monitor' && !w.minimized && w.workspace === activeWorkspace),
    [open, windows, activeWorkspace],
  );
  useEffect(() => {
    if (!monitorOpen || isOffline) return;
    const timer = window.setInterval(() => {
      void fetch('/api/workstation/metrics')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.metrics) setHostMetrics(d.metrics);
        })
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [monitorOpen, isOffline]);

  // Default selected studio agent
  useEffect(() => {
    if (!selectedStudioAgentId && agents.length > 0) {
      setSelectedStudioAgentId(agents[0].id);
    }
  }, [agents, selectedStudioAgentId]);

  const persistBackendState = useCallback(
    async (patch: { mode?: VcaOsMode; activeWorkspace?: number; tilingConfig?: TilingConfig }) => {
      if (isOffline) return;
      try {
        const res = await fetch('/api/vcaos/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const snap = (await res.json()) as VcaOsStateSnapshot;
          setVfsNodes(snap.vfsNodes);
        }
      } catch {
        // Ignore network errors cleanly
      }
    },
    [isOffline],
  );

  const switchMode = useCallback(
    (nextMode: VcaOsMode) => {
      setMode(nextMode);
      setLauncherOpen(false);
      setControlCenterOpen(false);
      void persistBackendState({ mode: nextMode });
    },
    [persistBackendState],
  );

  const switchWorkspace = useCallback(
    (ws: number) => {
      const clamped = Math.max(1, Math.min(9, ws));
      setActiveWorkspace(clamped);
      setLauncherOpen(false);
      void persistBackendState({ activeWorkspace: clamped });
    },
    [persistBackendState],
  );

  const updateTilingConfig = useCallback(
    (nextCfg: TilingConfig) => {
      setTilingConfig(nextCfg);
      const serialized = serializeTilingConf(nextCfg);
      setVfsNodes((prev) =>
        prev.map((n) => (n.path === 'Config/vcaos/tiling.conf' ? { ...n, content: serialized, updatedAt: Date.now() } : n)),
      );
      if (selectedFilePath === 'Config/vcaos/tiling.conf') {
        setEditorBuffer(serialized);
      }
      void persistBackendState({ tilingConfig: nextCfg });
    },
    [persistBackendState, selectedFilePath],
  );

  // Alt+1..9 Workspace Shortcuts while VCAOS is open
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        switchWorkspace(Number(e.key));
      } else if (e.key === 'Escape') {
        if (launcherOpen) setLauncherOpen(false);
        else if (controlCenterOpen) setControlCenterOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, launcherOpen, controlCenterOpen, switchWorkspace]);

  // Global pointer listeners for dragging & resizing floating windows
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        setWindows((prev) =>
          prev.map((w) =>
            w.id === d.winId
              ? {
                  ...w,
                  x: Math.max(8, Math.min(bounds.width - 140, d.origX + dx)),
                  y: Math.max(8, Math.min(bounds.height - 90, d.origY + dy)),
                }
              : w,
          ),
        );
      }
      const r = resizeRef.current;
      if (r) {
        const dx = e.clientX - r.startX;
        const dy = e.clientY - r.startY;
        setWindows((prev) =>
          prev.map((w) =>
            w.id === r.winId
              ? {
                  ...w,
                  w: Math.max(340, Math.min(bounds.width - w.x - 12, r.origW + dx)),
                  h: Math.max(240, Math.min(bounds.height - w.y - 54, r.origH + dy)),
                }
              : w,
          ),
        );
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [bounds.width, bounds.height]);

  const focusWindow = (winId: string) => {
    const nextZ = topZ + 1;
    setTopZ(nextZ);
    setFocusedWindowId(winId);
    setWindows((prev) =>
      prev.map((w) => (w.id === winId ? { ...w, minimized: false, zIndex: nextZ } : w)),
    );
  };

  const launchApp = (appId: VcaOsAppId, agent?: AgentProfile) => {
    setLauncherOpen(false);
    setControlCenterOpen(false);
    if (mode === 'deck') {
      // Opening an app in Deck temporarily drops into Hyprland or Native or opens floating overlay on Deck
      setMode('tiling');
    }
    const existing = windows.find((w) =>
      appId === 'agent-inspector' && agent
        ? w.appId === 'agent-inspector' && w.agentId === agent.id
        : w.appId === appId,
    );
    if (existing) {
      setActiveWorkspace(existing.workspace);
      focusWindow(existing.id);
      return;
    }

    const catalogItem = APP_CATALOG.find((c) => c.appId === appId);
    const nextZ = topZ + 1;
    setTopZ(nextZ);
    const offset = (windows.length % 5) * 28;
    const created: VcaOsWindow = {
      id: appId === 'agent-inspector' && agent ? `win-agent-${agent.id}` : `win-${appId}-${Date.now().toString(36)}`,
      appId,
      title: appId === 'agent-inspector' && agent ? `${agent.name} // ${agent.role}` : catalogItem?.name ?? 'VCAOS Window',
      workspace: activeWorkspace,
      x: 70 + offset,
      y: 62 + offset,
      w: appId === 'monitor' || appId === 'explorer' ? 620 : 540,
      h: 430,
      minimized: false,
      maximized: false,
      floating: false,
      zIndex: nextZ,
      agentId: agent?.id,
    };
    setWindows((prev) => [...prev, created]);
    setFocusedWindowId(created.id);
  };

  const closeWindow = (winId: string) => {
    setWindows((prev) => {
      const next = prev.filter((w) => w.id !== winId);
      if (focusedWindowId === winId) {
        const sameWs = next.filter((w) => w.workspace === activeWorkspace && !w.minimized);
        setFocusedWindowId(sameWs[sameWs.length - 1]?.id ?? null);
      }
      return next;
    });
  };

  const toggleMinimize = (winId: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === winId ? { ...w, minimized: !w.minimized } : w)),
    );
  };

  const toggleMaximize = (winId: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === winId ? { ...w, maximized: !w.maximized } : w)),
    );
  };

  const toggleFloating = (winId: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === winId ? { ...w, floating: !w.floating } : w)),
    );
  };

  const swapFocusedWindow = () => {
    setWindows((prev) => {
      const wsTiled = prev.filter(
        (w) => w.workspace === activeWorkspace && !w.minimized && !w.floating,
      );
      if (wsTiled.length < 2) return prev;
      const idxA = prev.findIndex((w) => w.id === (focusedWindowId ?? wsTiled[0].id));
      const aIndex = idxA >= 0 ? idxA : prev.indexOf(wsTiled[0]);
      const nextWin = wsTiled[(wsTiled.findIndex((w) => w.id === prev[aIndex].id) + 1) % wsTiled.length];
      const bIndex = prev.indexOf(nextWin);
      if (aIndex === -1 || bIndex === -1 || aIndex === bIndex) return prev;
      const copy = [...prev];
      const tmp = copy[aIndex];
      copy[aIndex] = copy[bIndex];
      copy[bIndex] = tmp;
      return copy;
    });
  };

  // Compute BSP / Master-Stack Tiling Rectangles for active workspace
  const insets = getModeViewportInsets(mode);
  const activeWsWindows = useMemo(
    () => windows.filter((w) => w.workspace === activeWorkspace),
    [windows, activeWorkspace],
  );
  const tiledWindowIds = useMemo(
    () =>
      mode === 'tiling'
        ? activeWsWindows.filter((w) => !w.minimized && !w.floating && !w.maximized).map((w) => w.id)
        : [],
    [mode, activeWsWindows],
  );
  const tiledRects = useMemo(
    () => computeTiledRects(tiledWindowIds, bounds, tilingConfig, insets),
    [tiledWindowIds, bounds, tilingConfig, insets],
  );

  // Open VFS or Sandbox file into editor
  const selectFile = async (mount: 'vfs' | 'sandbox', filePath: string) => {
    setExplorerMount(mount);
    setSelectedFilePath(filePath);
    setFileSaveNote('');
    if (mount === 'vfs') {
      const node = vfsNodes.find((n) => n.path === filePath);
      setEditorBuffer(node?.content ?? '');
      return;
    }
    if (!isOffline) {
      try {
        const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`);
        if (res.ok) {
          const d = await res.json();
          setEditorBuffer(String(d.content ?? ''));
        }
      } catch {
        setEditorBuffer('// Unable to read sandbox file.');
      }
    }
  };

  const handleSaveEditorFile = async () => {
    if (!selectedFilePath) return;
    if (explorerMount === 'vfs') {
      if (selectedFilePath === 'Config/vcaos/tiling.conf') {
        const parsed = parseTilingConf(editorBuffer, tilingConfig);
        setTilingConfig(parsed);
      }
      setVfsNodes((prev) =>
        prev.map((n) => (n.path === selectedFilePath ? { ...n, content: editorBuffer, updatedAt: Date.now() } : n)),
      );
      if (!isOffline) {
        const res = await fetch('/api/vcaos/vfs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: selectedFilePath, content: editorBuffer }),
        });
        if (res.ok) {
          const snap = (await res.json()) as VcaOsStateSnapshot;
          setTilingConfig(snap.tilingConfig);
          setVfsNodes(snap.vfsNodes);
        }
      }
      setFileSaveNote(
        selectedFilePath === 'Config/vcaos/tiling.conf'
          ? 'Saved & live-reloaded compositor layout'
          : 'Saved to VCAOS VFS',
      );
      return;
    }

    if (!isOffline) {
      const res = await fetch('/api/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFilePath, content: editorBuffer }),
      });
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.files)) setSandboxFiles(d.files);
        setFileSaveNote('Saved to Host Workspace Sandbox');
      }
    }
  };

  // Terminal Execution (hyprctl + vcaos + real host sandbox shell)
  const handleRunTerminal = async (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = termInput.trim();
    if (!cmd || termBusy) return;
    setTermInput('');
    setTermLines((prev) => [...prev, { kind: 'cmd', text: `operator@vcaos:~$ ${cmd}` }]);

    if (cmd === 'clear') {
      setTermLines([]);
      return;
    }

    const hypr = evaluateHyprctlCommand(cmd, {
      mode,
      activeWorkspace,
      tilingConfig,
      windows,
      focusedWindowId,
    });
    if (hypr.handled) {
      setTermLines((prev) => [...prev, { kind: 'out', text: hypr.output }]);
      if (hypr.patch?.mode) switchMode(hypr.patch.mode);
      if (hypr.patch?.activeWorkspace) switchWorkspace(hypr.patch.activeWorkspace);
      if (hypr.patch?.tilingConfig) updateTilingConfig(hypr.patch.tilingConfig);
      if (hypr.patch?.toggleFloatingFocused && focusedWindowId) toggleFloating(focusedWindowId);
      if (hypr.patch?.swapNext) swapFocusedWindow();
      return;
    }

    if (cmd.startsWith('vcaos')) {
      const args = cmd.split(/\s+/).slice(1);
      if (args[0] === 'agents') {
        const summary = agents
          .map((a) => `${a.id.padEnd(15)} ${a.name.padEnd(13)} ${a.status.padEnd(12)} ${a.autonomy}`)
          .join('\n');
        setTermLines((prev) => [...prev, { kind: 'out', text: summary || 'No agents loaded.' }]);
        return;
      }
      if (args[0] === 'scene' && args[1]) {
        const found = ENVIRONMENT_THEME_OPTIONS.find((t) => t.id === args[1]);
        if (found) {
          onChangeTheme(found.id);
          setTermLines((prev) => [...prev, { kind: 'out', text: `3D scene biome switched to "${found.label}".` }]);
        } else {
          setTermLines((prev) => [...prev, { kind: 'err', text: `Unknown 3D scene "${args[1]}".` }]);
        }
        return;
      }
      if (args[0] === 'focus' && args[1]) {
        const match = agents.find(
          (a) => a.id === args[1] || a.name.toLowerCase().includes(args[1].toLowerCase()),
        );
        if (match) {
          onFocusAgentIn3D(match.id);
          setTermLines((prev) => [...prev, { kind: 'out', text: `Camera locked onto ${match.name} in 3D space.` }]);
        } else {
          setTermLines((prev) => [...prev, { kind: 'err', text: `Agent "${args[1]}" not found.` }]);
        }
        return;
      }
      setTermLines((prev) => [
        ...prev,
        {
          kind: 'out',
          text: 'vcaos CLI:\n  vcaos agents\n  vcaos focus <agent-name>\n  vcaos scene <vcaos-nexus|command-center|cyber-metropolis|...>',
        },
      ]);
      return;
    }

    if (isOffline) {
      setTermLines((prev) => [...prev, { kind: 'err', text: 'Offline mode: backend sandbox shell paused.' }]);
      return;
    }

    setTermBusy(true);
    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      const out = [data.stdout, data.stderr].filter(Boolean).join('\n') || `(exit ${data.exitCode})`;
      setTermLines((prev) => [
        ...prev,
        { kind: data.exitCode === 0 ? 'out' : 'err', text: out },
      ]);
    } catch {
      setTermLines((prev) => [...prev, { kind: 'err', text: 'Backend terminal unreachable.' }]);
    } finally {
      setTermBusy(false);
    }
  };

  const handleAgentSend = async (agent: AgentProfile) => {
    const prompt = (agentPromptById[agent.id] ?? '').trim();
    if (!prompt || agentBusyId) return;
    setAgentPromptById((prev) => ({ ...prev, [agent.id]: '' }));
    setAgentLogById((prev) => ({
      ...prev,
      [agent.id]: [...(prev[agent.id] ?? []), { role: 'op', text: prompt }],
    }));
    setAgentBusyId(agent.id);
    try {
      const res = await onChatWithAgent(agent.id, prompt);
      setAgentLogById((prev) => ({
        ...prev,
        [agent.id]: [...(prev[agent.id] ?? []), { role: 'agent', text: res.reply }],
      }));
    } catch {
      setAgentLogById((prev) => ({
        ...prev,
        [agent.id]: [...(prev[agent.id] ?? []), { role: 'agent', text: 'Unable to reach agent runtime.' }],
      }));
    } finally {
      setAgentBusyId(null);
    }
  };

  if (!open) return null;

  const focusedAgent =
    agents.find((a) => a.id === selectedStudioAgentId) ?? agents[0] ?? null;

  const filteredApps = APP_CATALOG.filter((app) => {
    const queryMatch = `${app.name} ${app.summary}`.toLowerCase().includes(launcherQuery.trim().toLowerCase());
    if (!queryMatch) return false;
    if (launcherQuery.trim()) return true;
    if (startCat === 'all' || startCat === 'places') return true;
    return app.category === startCat;
  });

  // YukiOS authentic wallpaper themes (fast GPU/SwiftShader-friendly SVG & CSS surfaces)
  const wallpaperBg =
    wallpaperTheme === 'midnight-nebula'
      ? 'bg-[radial-gradient(ellipse_at_68%_22%,#3b1d7a_0%,#111632_48%,#070914_100%)]'
      : wallpaperTheme === 'obsidian-peaks'
      ? 'bg-[radial-gradient(ellipse_at_top,#132a3e_0%,#090d18_54%,#04060d_100%)]'
      : 'bg-[radial-gradient(ellipse_at_62%_18%,#4810dc_0%,#161438_36%,#080c18_78%,#04060d_100%)]';

  const weatherTempLabel = weather === 'ion-storm' ? '8°C' : weather === 'rain' ? '11°C' : '18°C';

  const desktopIcons: Array<{
    id: string;
    label: string;
    iconAppId: VcaOsAppId | 'document';
    onOpen: () => void;
  }> = [
    { id: 'desk-agents', label: 'Visual Agents', iconAppId: 'agents', onOpen: () => launchApp('agents') },
    { id: 'desk-terminal', label: 'Terminal', iconAppId: 'terminal', onOpen: () => launchApp('terminal') },
    { id: 'desk-files', label: 'Files', iconAppId: 'explorer', onOpen: () => launchApp('explorer') },
    { id: 'desk-projects', label: 'Projects', iconAppId: 'projects', onOpen: () => launchApp('projects') },
    { id: 'desk-monitor', label: 'btop Monitor', iconAppId: 'monitor', onOpen: () => launchApp('monitor') },
    { id: 'desk-world3d', label: '3D Nexus', iconAppId: 'world3d', onOpen: () => launchApp('world3d') },
    {
      id: 'desk-readme',
      label: 'VCAOS.md',
      iconAppId: 'document',
      onOpen: () => {
        void selectFile('vfs', 'Documents/VCAOS.md');
        launchApp('explorer');
      },
    },
  ];

  const showDesktopToggle = () => {
    const anyVisible = activeWsWindows.some((w) => !w.minimized);
    setWindows((prev) =>
      prev.map((w) => (w.workspace === activeWorkspace ? { ...w, minimized: anyVisible } : w)),
    );
  };

  const renderWindowContent = (win: VcaOsWindow) => {
    if (win.appId === 'agents') {
      return (
        <div className="h-full grid grid-cols-1 md:grid-cols-[210px_1fr] divide-y md:divide-y-0 md:divide-x divide-slate-800">
          {/* Agent Roster */}
          <div className="p-2.5 space-y-1.5 overflow-y-auto bg-[#060a14]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1">
              Connected Agents ({agents.length})
            </div>
            {agents.map((a) => {
              const selected = focusedAgent?.id === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedStudioAgentId(a.id)}
                  onDoubleClick={() => launchApp('agent-inspector', a)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                    selected
                      ? 'bg-cyan-500/15 border-cyan-400/60 text-slate-100'
                      : 'bg-slate-950/70 border-slate-800/90 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{a.name}</span>
                    <span className="text-[10px] font-mono text-cyan-300">{a.status}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">{a.role}</div>
                </button>
              );
            })}
          </div>

          {/* Selected Agent Control & Inline Chat */}
          {focusedAgent ? (
            <div className="flex flex-col min-h-0 p-3 gap-2.5 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                <div>
                  <h4 className="font-display text-sm font-semibold text-slate-100">
                    {focusedAgent.name} — {focusedAgent.role}
                  </h4>
                  <p className="text-[11px] text-slate-400 truncate max-w-md">
                    {focusedAgent.currentObjective}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={`Autonomy for ${focusedAgent.name}`}
                    value={focusedAgent.autonomy}
                    onChange={(e) =>
                      void onUpdateAgent(focusedAgent.id, { autonomy: e.target.value as AutonomyLevel })
                    }
                    className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100"
                  >
                    <option value="ASSISTED">ASSISTED</option>
                    <option value="SUPERVISED">SUPERVISED</option>
                    <option value="AUTONOMOUS">AUTONOMOUS</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => launchApp('agent-inspector', focusedAgent)}
                    className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-[11px] text-slate-200 hover:border-cyan-400 cursor-pointer"
                  >
                    Pop Window
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onFocusAgentIn3D(focusedAgent.id);
                      onClose();
                    }}
                    className="px-2 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-[11px] text-cyan-200 hover:bg-cyan-500/30 cursor-pointer"
                  >
                    Focus 3D
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] font-mono tabular-nums">
                <div className="p-2 rounded bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Tasks Done</div>
                  <div className="text-sm font-semibold text-emerald-300">{focusedAgent.metrics.tasksCompleted}</div>
                </div>
                <div className="p-2 rounded bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Tokens</div>
                  <div className="text-sm font-semibold text-cyan-300">{focusedAgent.metrics.tokensUsed}</div>
                </div>
                <div className="p-2 rounded bg-slate-950 border border-slate-800">
                  <div className="text-slate-400">Avg Latency</div>
                  <div className="text-sm font-semibold text-slate-100">{focusedAgent.metrics.avgLatencyMs}ms</div>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto bg-[#050811] border border-slate-800 rounded-lg p-2.5 space-y-2 text-xs">
                {(agentLogById[focusedAgent.id] ?? []).length === 0 ? (
                  <p className="text-slate-500">
                    Dispatch a direct prompt to {focusedAgent.name} from VCAOS. Double-click any agent row to spawn an independent runtime window.
                  </p>
                ) : (
                  (agentLogById[focusedAgent.id] ?? []).map((entry, idx) => (
                    <div
                      key={idx}
                      className={`px-2.5 py-1.5 rounded ${
                        entry.role === 'op'
                          ? 'bg-cyan-500/15 border border-cyan-500/30 text-cyan-100 ml-6'
                          : 'bg-slate-900 border border-slate-800 text-slate-200 mr-6'
                      }`}
                    >
                      <span className="text-[10px] font-mono uppercase text-slate-400 mr-2">
                        {entry.role === 'op' ? 'Operator' : focusedAgent.name}
                      </span>
                      <span>{entry.text}</span>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAgentSend(focusedAgent);
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={agentPromptById[focusedAgent.id] ?? ''}
                  onChange={(e) =>
                    setAgentPromptById((prev) => ({ ...prev, [focusedAgent.id]: e.target.value }))
                  }
                  placeholder={`Command ${focusedAgent.name}...`}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                />
                <button
                  type="submit"
                  disabled={agentBusyId === focusedAgent.id}
                  className="px-3 py-1.5 rounded-md bg-cyan-400 text-slate-950 font-semibold text-xs hover:bg-cyan-300 disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send</span>
                </button>
              </form>
            </div>
          ) : (
            <div className="p-4 text-xs text-slate-400">Awaiting agent registry sync...</div>
          )}
        </div>
      );
    }

    if (win.appId === 'agent-inspector') {
      const target = agents.find((a) => a.id === win.agentId) ?? agents[0];
      if (!target) return <div className="p-4 text-xs text-slate-400">Agent offline.</div>;
      return (
        <div className="h-full flex flex-col p-3 gap-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div>
              <div className="text-sm font-semibold text-slate-100">{target.name}</div>
              <div className="text-[11px] text-cyan-300 font-mono">
                {target.role} · Stage: {target.currentStage}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onFocusAgentIn3D(target.id);
                onClose();
              }}
              className="px-2.5 py-1 rounded bg-cyan-500/20 border border-cyan-400/50 text-[11px] text-cyan-200 cursor-pointer"
            >
              Locate in 3D
            </button>
          </div>
          <p className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded p-2">
            {target.currentObjective}
          </p>
          <div className="flex-1 min-h-0 overflow-y-auto bg-[#050811] border border-slate-800 rounded p-2 space-y-1.5 text-xs">
            {(agentLogById[target.id] ?? []).map((m, idx) => (
              <div key={idx} className="text-slate-200">
                <strong className="text-cyan-300 mr-1.5">
                  {m.role === 'op' ? 'You:' : `${target.name}:`}
                </strong>
                {m.text}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAgentSend(target);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={agentPromptById[target.id] ?? ''}
              onChange={(e) =>
                setAgentPromptById((prev) => ({ ...prev, [target.id]: e.target.value }))
              }
              placeholder={`Message ${target.name}...`}
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
            />
            <button
              type="submit"
              className="px-3 py-1.5 rounded bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
            >
              Run
            </button>
          </form>
        </div>
      );
    }

    if (win.appId === 'terminal') {
      return (
        <div className="h-full flex flex-col bg-[#04070f] font-mono text-xs">
          <div className="px-3 py-1.5 bg-slate-950/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <span className="text-emerald-300">TTY0 // VCAOS + SANDBOX SHELL</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setTermInput('hyprctl help');
                }}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                hyprctl help
              </button>
              <button
                type="button"
                onClick={() => {
                  setTermInput('vcaos agents');
                }}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                vcaos agents
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5 whitespace-pre-wrap break-words">
            {termLines.map((line, i) => (
              <div
                key={i}
                className={
                  line.kind === 'cmd'
                    ? 'text-cyan-300 font-semibold'
                    : line.kind === 'err'
                    ? 'text-rose-400'
                    : 'text-slate-200'
                }
              >
                {line.text}
              </div>
            ))}
          </div>
          <form onSubmit={handleRunTerminal} className="p-2 border-t border-slate-800 flex items-center gap-2">
            <span className="text-emerald-400 font-bold">$</span>
            <input
              type="text"
              aria-label="VCAOS terminal command"
              value={termInput}
              onChange={(e) => setTermInput(e.target.value)}
              placeholder="hyprctl dispatch mode macos | ls -la | node -v"
              className="flex-1 bg-transparent text-slate-100 focus:outline-none"
            />
            <button
              type="submit"
              disabled={termBusy}
              className="px-2.5 py-1 rounded bg-emerald-400 text-slate-950 font-semibold hover:bg-emerald-300 cursor-pointer"
            >
              {termBusy ? '...' : 'Exec'}
            </button>
          </form>
        </div>
      );
    }

    if (win.appId === 'explorer') {
      return (
        <div className="h-full grid grid-cols-1 md:grid-cols-[210px_1fr] divide-y md:divide-y-0 md:divide-x divide-slate-800">
          <div className="p-2.5 space-y-2 overflow-y-auto bg-[#060a14]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              VCAOS System VFS
            </div>
            {vfsNodes.map((n) => (
              <button
                key={n.path}
                type="button"
                onClick={() => void selectFile('vfs', n.path)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono truncate cursor-pointer ${
                  explorerMount === 'vfs' && selectedFilePath === n.path
                    ? 'bg-indigo-500/20 border border-indigo-400/60 text-indigo-100'
                    : 'text-slate-300 hover:bg-slate-900'
                }`}
              >
                {n.path}
              </button>
            ))}

            <div className="pt-2 border-t border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Host Sandbox ({sandboxFiles.length})
            </div>
            {sandboxFiles.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => void selectFile('sandbox', f.path)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono truncate cursor-pointer ${
                  explorerMount === 'sandbox' && selectedFilePath === f.path
                    ? 'bg-cyan-500/20 border border-cyan-400/60 text-cyan-100'
                    : 'text-slate-400 hover:bg-slate-900'
                }`}
              >
                {f.path}
              </button>
            ))}
          </div>

          <div className="flex flex-col min-h-0 p-2.5 gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <div className="font-mono text-xs text-slate-200 truncate">
                {explorerMount === 'vfs' ? 'vcaos://' : 'sandbox://'}{selectedFilePath}
              </div>
              <div className="flex items-center gap-2">
                {fileSaveNote && <span className="text-[11px] text-emerald-300">{fileSaveNote}</span>}
                <button
                  type="button"
                  onClick={() => void handleSaveEditorFile()}
                  className="px-2.5 py-1 rounded bg-cyan-400 text-slate-950 font-semibold text-xs hover:bg-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save & Reload</span>
                </button>
              </div>
            </div>
            <textarea
              aria-label="VCAOS file editor"
              value={editorBuffer}
              onChange={(e) => setEditorBuffer(e.target.value)}
              className="flex-1 min-h-0 w-full bg-[#04070f] border border-slate-800 rounded p-2.5 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-400 resize-none"
            />
          </div>
        </div>
      );
    }

    if (win.appId === 'projects') {
      return (
        <div className="h-full flex flex-col p-3 gap-3 overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newProjTitle.trim() || !newProjObj.trim() || projBusy) return;
              setProjBusy(true);
              void onCreateProject(newProjTitle.trim(), newProjObj.trim()).finally(() => {
                setNewProjTitle('');
                setNewProjObj('');
                setProjBusy(false);
              });
            }}
            className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2"
          >
            <div className="text-xs font-semibold text-slate-200">Launch Multi-Agent Mission</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={newProjTitle}
                onChange={(e) => setNewProjTitle(e.target.value)}
                placeholder="Mission title"
                className="bg-[#060a14] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
              />
              <input
                type="text"
                value={newProjObj}
                onChange={(e) => setNewProjObj(e.target.value)}
                placeholder="Objective brief"
                className="bg-[#060a14] border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
              />
            </div>
            <button
              type="submit"
              disabled={projBusy}
              className="px-3 py-1.5 rounded bg-amber-400 text-slate-950 font-semibold text-xs hover:bg-amber-300 flex items-center gap-1 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{projBusy ? 'Dispatching...' : 'Deploy Swarm'}</span>
            </button>
          </form>

          <div className="space-y-2">
            {projects.map((p) => (
              <div key={p.id} className="p-2.5 rounded-lg bg-[#060a14] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-xs text-slate-100">{p.title}</div>
                  <span className="text-[11px] font-mono text-cyan-300">{p.status}</span>
                </div>
                <p className="text-[11px] text-slate-400">{p.objective}</p>
                <div className="space-y-1">
                  {p.tasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-950 border border-slate-800/80 text-[11px]"
                    >
                      <span className="text-slate-200 truncate">{t.title}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-slate-400">{t.status}</span>
                        {t.requiresApproval && t.status === 'awaiting-approval' && (
                          <button
                            type="button"
                            onClick={() => void onApproveTask(p.id, t.id)}
                            className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-200 cursor-pointer"
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (win.appId === 'monitor') {
      const cpuPct = hostMetrics?.cpuPct ?? Math.round((telemetry?.hostCpuLoad1m ?? 0.4) * 22);
      const memPct = hostMetrics?.ramPct ?? (telemetry ? Math.round((telemetry.hostMemUsedMb / Math.max(1, telemetry.hostMemTotalMb)) * 100) : 48);
      return (
        <div className="h-full flex flex-col p-3 gap-3 overflow-y-auto font-mono text-xs tabular-nums">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">HOST CPU</div>
              <div className="text-base font-bold text-cyan-300">{cpuPct.toFixed(1)}%</div>
            </div>
            <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">MEMORY</div>
              <div className="text-base font-bold text-emerald-300">{memPct}%</div>
            </div>
            <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">AI CALLS</div>
              <div className="text-base font-bold text-slate-100">{telemetry?.totalAiCalls ?? 0}</div>
            </div>
            <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">VCAOS PIDS</div>
              <div className="text-base font-bold text-indigo-300">{windows.length}</div>
            </div>
          </div>

          <div className="p-2.5 rounded bg-[#060a14] border border-slate-800 space-y-2">
            <div className="text-[11px] font-semibold text-slate-300">NEURAL CORTEX REGIONS</div>
            {regions.map((r) => (
              <div key={r.id} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-200">{r.name}</span>
                  <span className="text-cyan-300">{Math.round(r.load)}%</span>
                </div>
                <div className="h-1.5 rounded bg-slate-900 overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 transition-all"
                    style={{ width: `${Math.min(100, Math.max(4, r.load))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="p-2.5 rounded bg-[#060a14] border border-slate-800">
            <div className="text-[11px] font-semibold text-slate-300 mb-2">ACTIVE DESKTOP WINDOWS (SHARED STATE)</div>
            <div className="space-y-1 text-[11px]">
              {windows.map((w) => (
                <div key={w.id} className="flex items-center justify-between py-1 border-b border-slate-900">
                  <span className="text-slate-200 truncate">{w.title}</span>
                  <span className="text-slate-400">
                    WS {w.workspace} · {w.floating ? 'float' : 'tiled'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // world3d bridge
    return (
      <div className="h-full flex flex-col p-3 gap-3 overflow-y-auto">
        <div className="p-3 rounded-lg bg-indigo-950/35 border border-indigo-400/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-indigo-200">VCAOS Matrix (YukiOS) 3D Environment</div>
            <div className="text-[11px] text-slate-300">
              Activate floating 3D BSP tiling displays & workspace beacons inside the spatial deck.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onChangeTheme('vcaos-nexus');
              onClose();
            }}
            className="px-3 py-1.5 rounded bg-cyan-400 text-slate-950 font-semibold text-xs hover:bg-cyan-300 cursor-pointer"
          >
            Enter VCAOS 3D Scene
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
            <label htmlFor="vcaos-3d-theme" className="block text-[11px] font-semibold text-slate-300">
              Active 3D Environment Biome
            </label>
            <select
              id="vcaos-3d-theme"
              value={theme}
              onChange={(e) => onChangeTheme(e.target.value as EnvironmentTheme)}
              className="w-full bg-[#060a14] border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100"
            >
              {ENVIRONMENT_THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
            <div className="text-[11px] font-semibold text-slate-300">Camera & Spatial Hand Control</div>
            <div className="flex flex-wrap gap-1.5">
              {(['orbit', 'walk', 'core-focus'] as const).map((cm) => (
                <button
                  key={cm}
                  type="button"
                  onClick={() => onChangeCameraMode(cm)}
                  className={`px-2 py-1 rounded text-[11px] border cursor-pointer ${
                    cameraMode === cm
                      ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                      : 'bg-[#060a14] border-slate-800 text-slate-300'
                  }`}
                >
                  {cm}
                </button>
              ))}
              <button
                type="button"
                onClick={onToggleHandCam}
                className={`px-2 py-1 rounded text-[11px] border flex items-center gap-1 cursor-pointer ${
                  handCamOpen
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                    : 'bg-[#060a14] border-slate-800 text-slate-300'
                }`}
              >
                <Hand className="w-3 h-3" />
                <span>Hand Cam</span>
              </button>
            </div>
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-300">
            Weather Simulation: <strong className="text-cyan-300">{weather}</strong>
          </div>
          <div className="flex gap-1.5">
            {(['clear', 'rain', 'ion-storm'] as const).map((wMode) => (
              <button
                key={wMode}
                type="button"
                onClick={() => onChangeWeather(wMode)}
                className={`px-2 py-1 rounded text-[11px] border cursor-pointer ${
                  weather === wMode
                    ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                    : 'bg-[#060a14] border-slate-800 text-slate-300'
                }`}
              >
                {wMode}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section
      aria-label="VCAOS Multi-Environment Desktop"
      data-testid="vcaos-desktop"
      data-vcaos-mode={mode}
      data-vcaos-workspace={activeWorkspace}
      className={`fixed top-[53px] inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden select-none border-t border-white/10 ${wallpaperBg}`}
    >
      {/* Desktop Canvas Container */}
      <div
        ref={desktopRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            setSelectedDesktopIcon(null);
            setWorkspaceOverviewOpen(false);
          }
        }}
        className="relative flex-1 min-h-0 overflow-hidden"
      >
        {/* Crisp Atmospheric YukiOS Mountain & Aurora Vector Backdrop */}
        <svg
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          className="pointer-events-none absolute inset-0 w-full h-full opacity-80"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="yuki-aurora-ribbon" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7c4dff" stopOpacity="0.34" />
              <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#4810dc" stopOpacity="0.06" />
            </linearGradient>
            <linearGradient id="yuki-peak-far" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1d1844" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#090c18" stopOpacity="0.92" />
            </linearGradient>
            <linearGradient id="yuki-peak-near" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#12142b" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#060811" stopOpacity="0.98" />
            </linearGradient>
          </defs>
          <path
            d="M-60 330 C 260 120, 620 420, 960 210 C 1180 80, 1340 220, 1520 140 L 1520 430 L -60 430 Z"
            fill="url(#yuki-aurora-ribbon)"
          />
          <polygon
            points="0,900 0,610 210,490 430,585 690,415 960,575 1210,455 1440,565 1440,900"
            fill="url(#yuki-peak-far)"
          />
          <polygon
            points="0,900 0,700 290,580 560,685 830,520 1120,670 1440,570 1440,900"
            fill="url(#yuki-peak-near)"
          />
        </svg>

        {/* === TOP SHELL CHROME PER DESKTOP ENVIRONMENT === */}

        {/* 1. Hyprland BSP Top Waybar */}
        {mode === 'tiling' && (
          <div className="relative z-20 h-[38px] px-3 bg-[#080c18]/94 border-b border-white/10 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-cyan-300 tracking-tight whitespace-nowrap shrink-0">
                VCAOS // HYPRLAND
              </span>
              <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded border border-slate-800">
                {[1, 2, 3, 4, 5, 6].map((ws) => {
                  const hasWins = windows.some((w) => w.workspace === ws && !w.minimized);
                  return (
                    <button
                      key={ws}
                      type="button"
                      aria-label={`Workspace ${ws}`}
                      onClick={() => switchWorkspace(ws)}
                      className={`w-6 h-6 rounded text-[11px] font-mono tabular-nums cursor-pointer ${
                        activeWorkspace === ws
                          ? 'bg-cyan-400 text-slate-950 font-bold'
                          : hasWins
                          ? 'bg-slate-800 text-cyan-200'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {ws}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() =>
                  updateTilingConfig({
                    ...tilingConfig,
                    layout: tilingConfig.layout === 'bsp' ? 'master-stack' : 'bsp',
                  })
                }
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 hover:border-cyan-400 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Columns className="w-3 h-3 text-cyan-300" />
                <span>{tilingConfig.layout === 'bsp' ? 'BSP' : 'Master-Stack'}</span>
              </button>
              <button
                type="button"
                onClick={swapFocusedWindow}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 hover:border-cyan-400 cursor-pointer whitespace-nowrap shrink-0"
              >
                Swap
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLauncherOpen((p) => !p)}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 hover:border-cyan-400 flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3 h-3 text-emerald-300" />
                <span>Apps</span>
              </button>
              <div className="hidden lg:flex items-center gap-1 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                {VCA_OS_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => switchMode(m.id)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer whitespace-nowrap shrink-0 ${
                      mode === m.id ? 'bg-cyan-400 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.shortLabel}
                  </button>
                ))}
              </div>
              <span className="font-mono text-[11px] text-slate-300 tabular-nums whitespace-nowrap">{clockText}</span>
              <button
                type="button"
                aria-label="Exit VCAOS to 3D Deck"
                onClick={onClose}
                className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                3D Deck
              </button>
            </div>
          </div>
        )}

        {/* 2. macOS Global Menu Bar (#mac-menu-bar) */}
        {mode === 'macos' && (
          <div className="relative z-20 h-[32px] px-3 bg-[#0b0f1b]/95 border-b border-white/10 flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setLauncherOpen((p) => !p)}
                className="font-display font-bold text-slate-100 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Command className="w-3.5 h-3.5 text-indigo-300" />
                <span>VCAOS</span>
              </button>
              <button type="button" onClick={() => launchApp('explorer')} className="text-slate-300 hover:text-white cursor-pointer whitespace-nowrap">
                File
              </button>
              <button type="button" onClick={() => launchApp('agents')} className="text-slate-300 hover:text-white cursor-pointer whitespace-nowrap">
                Agents
              </button>
              <button type="button" onClick={() => launchApp('terminal')} className="text-slate-300 hover:text-white cursor-pointer whitespace-nowrap">
                Shell
              </button>
              <button type="button" onClick={() => launchApp('world3d')} className="text-slate-300 hover:text-white cursor-pointer whitespace-nowrap">
                3D World
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-1">
                {VCA_OS_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => switchMode(m.id)}
                    className={`px-2 py-0.5 rounded text-[11px] cursor-pointer whitespace-nowrap shrink-0 ${
                      mode === m.id ? 'bg-indigo-500 text-white font-semibold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {m.shortLabel}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setControlCenterOpen((p) => !p)}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
              >
                Control
              </button>
              <span className="font-mono text-[11px] text-slate-300 tabular-nums whitespace-nowrap">{clockText}</span>
              <button
                type="button"
                onClick={onClose}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                3D Deck
              </button>
            </div>
          </div>
        )}

        {/* 3. VCA Deck Console Header */}
        {mode === 'deck' && (
          <div className="relative z-20 h-[44px] px-4 bg-[#070b15]/95 border-b border-white/10 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <Gamepad2 className="w-4 h-4 text-purple-300" />
              <span className="font-display font-bold text-slate-100 whitespace-nowrap">VCA DECK // CONSOLE OS</span>
            </div>
            <div className="flex items-center gap-1.5">
              {VCA_OS_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => switchMode(m.id)}
                  className={`px-2.5 py-1 rounded text-[11px] cursor-pointer whitespace-nowrap shrink-0 ${
                    mode === m.id ? 'bg-purple-500 text-white font-semibold' : 'bg-slate-900 text-slate-300 hover:text-white'
                  }`}
                >
                  {m.shortLabel}
                </button>
              ))}
              <button
                type="button"
                onClick={onClose}
                className="ml-2 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 cursor-pointer whitespace-nowrap shrink-0"
              >
                3D Deck
              </button>
            </div>
          </div>
        )}

        {/* === DESKTOP ICON GRID (YukiOS left column with 82x88px Papirus icon slots) === */}
        {(mode === 'native' || mode === 'win11' || mode === 'chromeos' || mode === 'macos') && (
          <div
            aria-label="Desktop Shortcuts"
            className={`absolute ${
              mode === 'macos' ? 'top-10' : 'top-3'
            } left-3 bottom-14 z-10 flex flex-col flex-wrap content-start gap-1.5 pointer-events-none`}
          >
            {desktopIcons.map((item) => {
              const selected = selectedDesktopIcon === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Desktop icon: ${item.label}`}
                  onClick={() => setSelectedDesktopIcon(item.id)}
                  onDoubleClick={() => item.onOpen()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') item.onOpen();
                  }}
                  className={`pointer-events-auto w-[84px] h-[88px] px-1 py-1.5 rounded-lg border flex flex-col items-center justify-start gap-1 transition-colors cursor-pointer ${
                    selected
                      ? 'bg-[#0078d7]/30 border-[#60a5fa]/70 text-white'
                      : 'bg-transparent border-transparent hover:bg-white/10 hover:border-white/20 text-slate-100'
                  }`}
                >
                  <PapirusAppIcon appId={item.iconAppId} className="w-11 h-11 drop-shadow-[0_3px_6px_rgba(0,0,0,0.65)] shrink-0" />
                  <span
                    className="text-[11px] leading-[1.2] font-medium text-center line-clamp-2 w-full break-words"
                    style={{ textShadow: '0 1px 3px rgba(0, 0, 0, 0.95)' }}
                  >
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* === VCA DECK FULL CONSOLE TILE VIEW === */}
        {mode === 'deck' ? (
          <div className="relative z-10 h-[calc(100%-44px)] overflow-y-auto p-6 space-y-6">
            <div>
              <h3 className="font-display text-lg font-bold text-slate-100">VCAOS System Applications</h3>
              <p className="text-xs text-slate-400">Launch any workspace window or switch desktop shell without closing active tasks.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {APP_CATALOG.map((app) => (
                <button
                  key={app.appId}
                  type="button"
                  onClick={() => launchApp(app.appId)}
                  className="text-left p-5 rounded-xl bg-[#0d1221]/95 border border-white/12 hover:border-cyan-400/70 transition-colors cursor-pointer space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <PapirusAppIcon appId={app.appId} className="w-10 h-10" />
                    <span className="text-[11px] font-mono text-slate-400">Launch</span>
                  </div>
                  <div className="font-display text-base font-semibold text-slate-100">{app.name}</div>
                  <div className="text-xs text-slate-400">{app.summary}</div>
                </button>
              ))}
            </div>

            <div>
              <h3 className="font-display text-base font-semibold text-slate-100 mb-3">Autonomous Agent Rigs</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => launchApp('agent-inspector', a)}
                    className="text-left p-4 rounded-xl bg-[#0d1221]/95 border border-white/12 hover:border-emerald-400/60 transition-colors cursor-pointer space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm text-slate-100">{a.name}</span>
                      <span className="text-[11px] font-mono text-emerald-300">{a.status}</span>
                    </div>
                    <div className="text-xs text-slate-400">{a.role}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* === DESKTOP WINDOW LAYER (SHARED WINDOWS ACROSS MODES) === */
          <div className="absolute inset-0 z-10 pointer-events-none">
            {activeWsWindows
              .filter((w) => !w.minimized)
              .map((win) => {
                const isFocused = focusedWindowId === win.id;
                const tiled = mode === 'tiling' && !win.floating && !win.maximized ? tiledRects[win.id] : undefined;
                const styleRect = win.maximized
                  ? {
                      left: insets.left + 4,
                      top: insets.top + 4,
                      width: bounds.width - insets.left - insets.right - 8,
                      height: bounds.height - insets.top - insets.bottom - 8,
                    }
                  : tiled
                  ? {
                      left: tiled.x,
                      top: tiled.y,
                      width: tiled.w,
                      height: tiled.h,
                    }
                  : {
                      left: win.x,
                      top: Math.max(insets.top + 6, win.y),
                      width: win.w,
                      height: win.h,
                    };

                const borderCol =
                  mode === 'tiling'
                    ? isFocused
                      ? tilingConfig.activeBorderColor
                      : tilingConfig.inactiveBorderColor
                    : isFocused
                    ? 'rgba(124, 77, 255, 0.72)'
                    : 'rgba(255, 255, 255, 0.14)';

                return (
                  <div
                    key={win.id}
                    role="dialog"
                    aria-label={win.title}
                    onPointerDown={() => focusWindow(win.id)}
                    style={{
                      left: styleRect.left,
                      top: styleRect.top,
                      width: styleRect.width,
                      height: styleRect.height,
                      zIndex: win.zIndex,
                      borderColor: borderCol,
                      borderWidth: mode === 'tiling' ? tilingConfig.borderWidth : 1,
                      boxShadow: isFocused
                        ? '0 22px 54px rgba(0, 0, 0, 0.72)'
                        : '0 10px 28px rgba(0, 0, 0, 0.5)',
                      transition: tiled
                        ? 'left 180ms cubic-bezier(0.16, 1, 0.3, 1), top 180ms cubic-bezier(0.16, 1, 0.3, 1), width 180ms cubic-bezier(0.16, 1, 0.3, 1), height 180ms cubic-bezier(0.16, 1, 0.3, 1)'
                        : undefined,
                    }}
                    className="pointer-events-auto absolute rounded-[10px] bg-[#0e1320]/96 flex flex-col overflow-hidden"
                  >
                    {/* Window Titlebar (macOS traffic-lights vs YukiOS/Plasma chrome) */}
                    <div
                      onPointerDown={(e) => {
                        if (mode === 'tiling' && !win.floating) return;
                        if ((e.target as HTMLElement).closest('button')) return;
                        dragRef.current = {
                          winId: win.id,
                          startX: e.clientX,
                          startY: e.clientY,
                          origX: win.x,
                          origY: win.y,
                        };
                      }}
                      className={`h-[34px] px-2.5 bg-[#151a29] border-b border-white/10 flex items-center justify-between gap-2 shrink-0 ${
                        mode === 'tiling' && !win.floating ? '' : 'cursor-grab active:cursor-grabbing'
                      }`}
                    >
                      {mode === 'macos' ? (
                        <>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label={`Close ${win.title}`}
                              onClick={() => closeWindow(win.id)}
                              className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-110 cursor-pointer"
                            />
                            <button
                              type="button"
                              aria-label={`Minimize ${win.title}`}
                              onClick={() => toggleMinimize(win.id)}
                              className="w-3 h-3 rounded-full bg-[#febc2e] hover:brightness-110 cursor-pointer"
                            />
                            <button
                              type="button"
                              aria-label={`Maximize ${win.title}`}
                              onClick={() => toggleMaximize(win.id)}
                              className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-110 cursor-pointer"
                            />
                          </div>
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200 truncate">
                            <AppIcon appId={win.appId} className="w-4 h-4 shrink-0" />
                            <span className="truncate">{win.title}</span>
                          </div>
                          <div className="w-10" />
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 text-xs font-semibold text-slate-100 truncate">
                            <AppIcon appId={win.appId} className="w-4 h-4 shrink-0" />
                            <span className="truncate">{win.title}</span>
                            {mode === 'tiling' && (
                              <span className="text-[10px] font-mono text-slate-400">
                                [{win.floating ? 'float' : tilingConfig.layout}]
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            {mode === 'tiling' && (
                              <button
                                type="button"
                                aria-label={`Toggle float on ${win.title}`}
                                onClick={() => toggleFloating(win.id)}
                                className="px-1.5 py-0.5 mr-1 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                              >
                                {win.floating ? 'Tile' : 'Float'}
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Minimize ${win.title}`}
                              onClick={() => toggleMinimize(win.id)}
                              className="w-7 h-6 rounded flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Maximize ${win.title}`}
                              onClick={() => toggleMaximize(win.id)}
                              className="w-7 h-6 rounded flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
                            >
                              {win.maximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                            </button>
                            <button
                              type="button"
                              aria-label={`Close ${win.title}`}
                              onClick={() => closeWindow(win.id)}
                              className="w-7 h-6 rounded flex items-center justify-center text-slate-300 hover:text-white hover:bg-rose-500/80 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* App Viewport Body */}
                    <div className="flex-1 min-h-0 overflow-hidden">{renderWindowContent(win)}</div>

                    {/* Floating Resize Grip */}
                    {!win.maximized && (!tiled || win.floating) && (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          resizeRef.current = {
                            winId: win.id,
                            startX: e.clientX,
                            startY: e.clientY,
                            origW: win.w,
                            origH: win.h,
                          };
                        }}
                        className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
                        title="Resize window"
                      />
                    )}
                  </div>
                );
              })}

            {activeWsWindows.filter((w) => !w.minimized).length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <div className="px-4 py-2 rounded-lg bg-[#0d1220]/85 border border-white/10 text-sm font-display text-slate-200">
                  Workspace {activeWorkspace} — Desktop Clear
                </div>
                <button
                  type="button"
                  onClick={() => setLauncherOpen(true)}
                  className="pointer-events-auto px-3.5 py-1.5 rounded-lg bg-[#6d3bff] text-white font-semibold text-xs hover:bg-[#7c4dff] cursor-pointer"
                >
                  Open Start Menu
                </button>
              </div>
            )}
          </div>
        )}

        {/* === WORKSPACE OVERVIEW POPUP (from YukiOS Workspace Overview button) === */}
        {workspaceOverviewOpen && mode !== 'deck' && (
          <div
            role="dialog"
            aria-label="Workspace Overview"
            className="absolute bottom-14 left-14 z-40 w-[420px] max-w-[calc(100vw-2rem)] rounded-xl bg-[#111524]/98 border border-white/15 shadow-2xl p-3.5 space-y-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-xs font-semibold text-slate-100">Workspaces Overview (Alt + 1..6)</span>
              <button
                type="button"
                aria-label="Close workspace overview"
                onClick={() => setWorkspaceOverviewOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6].map((ws) => {
                const wsWins = windows.filter((w) => w.workspace === ws);
                const active = ws === activeWorkspace;
                return (
                  <button
                    key={ws}
                    type="button"
                    onClick={() => {
                      switchWorkspace(ws);
                      setWorkspaceOverviewOpen(false);
                    }}
                    className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#4810dc]/30 border-[#7c4dff] text-white'
                        : 'bg-[#090c16] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold">
                      <span>{ws === 1 ? 'Main' : `WS ${ws}`}</span>
                      <span className="font-mono text-[10px] text-cyan-300 tabular-nums">{wsWins.length}</span>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400 truncate">
                      {wsWins[0]?.title ?? 'Empty workspace'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* === YUKIOS SPLIT START MENU (#start-menu) === */}
        {launcherOpen && mode !== 'deck' && (
          <div
            role="dialog"
            aria-label="YukiOS Start Menu"
            className="absolute bottom-[54px] left-3 w-[640px] max-w-[calc(100vw-1.5rem)] h-[475px] max-h-[calc(100%-68px)] z-40 rounded-xl bg-[#101423]/98 border border-[#4982ee]/30 shadow-[0_20px_60px_rgba(0,0,0,0.78)] flex overflow-hidden text-slate-100"
          >
            {/* Left .start-sidebar */}
            <aside className="w-[176px] shrink-0 border-r border-[#7c4dff]/25 bg-gradient-to-b from-[#4810dc]/15 via-[#101423] to-[#0b0e19] flex flex-col">
              {/* .start-user */}
              <div className="p-3.5 flex items-center gap-2.5 border-b border-[#7c4dff]/20">
                <div className="w-8 h-8 rounded-full bg-[#4810dc]/35 border border-[#7c4dff]/60 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-indigo-200" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">Operator-01</div>
                  <div className="text-[10px] text-slate-400 truncate">VCAOS Session</div>
                </div>
              </div>

              {/* .start-cat-list */}
              <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
                {(
                  [
                    { id: 'all', label: 'All Apps' },
                    { id: 'agents', label: 'Visual Agents' },
                    { id: 'development', label: 'Development' },
                    { id: 'system', label: 'System & Files' },
                    { id: 'places', label: 'Places & 3D' },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setStartCat(cat.id);
                      setLauncherQuery('');
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                      startCat === cat.id
                        ? 'bg-[#4810dc]/30 text-white border border-[#7c4dff]/40'
                        : 'text-slate-300 hover:bg-white/5 hover:text-white border border-transparent'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}

                <div className="pt-2 mt-2 border-t border-white/10 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Shell Mode
                </div>
                <div className="grid grid-cols-2 gap-1 px-1">
                  {VCA_OS_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => switchMode(m.id)}
                      className={`px-2 py-1 rounded text-[10px] font-medium truncate cursor-pointer ${
                        mode === m.id
                          ? 'bg-[#6d3bff] text-white'
                          : 'bg-white/5 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {m.shortLabel}
                    </button>
                  ))}
                </div>
              </div>

              {/* .start-footer-actions */}
              <div className="p-2 border-t border-[#7c4dff]/20 flex items-center justify-between gap-1">
                <button
                  type="button"
                  title="Display & Compositor Settings"
                  aria-label="Open Display Settings"
                  onClick={() => {
                    setLauncherOpen(false);
                    setControlCenterOpen(true);
                  }}
                  className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-[#4810dc]/25 cursor-pointer"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title="Show Desktop"
                  aria-label="Lock / Minimize Windows"
                  onClick={() => {
                    setLauncherOpen(false);
                    showDesktopToggle();
                  }}
                  className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-[#4810dc]/25 cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  title="Return to 3D World"
                  aria-label="Return to 3D World"
                  onClick={onClose}
                  className="flex-1 px-2.5 py-1.5 rounded-md bg-rose-500/15 border border-rose-400/30 text-rose-200 hover:bg-rose-500/25 text-[11px] font-medium flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>3D Exit</span>
                </button>
              </div>
            </aside>

            {/* Right .start-content */}
            <div className="flex-1 min-w-0 flex flex-col p-3.5 gap-3 bg-[#0e1220]">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    aria-label="Search YukiOS applications"
                    value={launcherQuery}
                    onChange={(e) => setLauncherQuery(e.target.value)}
                    placeholder="Search apps, agents, or commands..."
                    className="w-full bg-[#070a14] border border-white/15 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#7c4dff]"
                  />
                </div>
                <button
                  type="button"
                  aria-label="Close app launcher"
                  onClick={() => setLauncherOpen(false)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
                {startCat !== 'places' ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {filteredApps.map((app) => (
                        <button
                          key={app.appId}
                          type="button"
                          onClick={() => launchApp(app.appId)}
                          className="p-2.5 rounded-lg bg-[#14192a] border border-white/8 hover:border-[#7c4dff]/60 hover:bg-[#1a2035] flex flex-col items-center text-center gap-2 transition-colors cursor-pointer"
                        >
                          <PapirusAppIcon appId={app.appId} className="w-9 h-9" />
                          <div className="text-[11px] font-medium text-slate-100 leading-tight line-clamp-2">
                            {app.shortName}
                          </div>
                        </button>
                      ))}
                    </div>

                    {(startCat === 'all' || startCat === 'agents') && agents.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-white/10">
                        <div className="text-[11px] font-semibold text-slate-400">
                          Agent Runtime Rigs ({agents.length})
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {agents
                            .filter((a) =>
                              `${a.name} ${a.role}`.toLowerCase().includes(launcherQuery.trim().toLowerCase()),
                            )
                            .map((ag) => (
                              <button
                                key={ag.id}
                                type="button"
                                onClick={() => launchApp('agent-inspector', ag)}
                                className="px-2.5 py-2 rounded-lg bg-[#131727] border border-white/10 hover:border-cyan-400/50 flex items-center gap-2 text-left cursor-pointer"
                              >
                                <PapirusAppIcon appId="agent-inspector" className="w-6 h-6 shrink-0" />
                                <div className="min-w-0">
                                  <div className="text-xs font-medium text-slate-100 truncate">{ag.name}</div>
                                  <div className="text-[10px] text-slate-400 truncate">{ag.role}</div>
                                </div>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">System Places & VFS</div>
                    {vfsNodes.map((n) => (
                      <button
                        key={n.path}
                        type="button"
                        onClick={() => {
                          void selectFile('vfs', n.path);
                          launchApp('explorer');
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-[#14192a] border border-white/10 hover:border-[#7c4dff]/60 flex items-center gap-2.5 text-left cursor-pointer"
                      >
                        <PapirusAppIcon appId="document" className="w-6 h-6 shrink-0" />
                        <span className="text-xs font-mono text-slate-200 truncate">{n.path}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        onChangeTheme('vcaos-nexus');
                        onClose();
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-[#4810dc]/25 border border-[#7c4dff]/50 hover:bg-[#4810dc]/35 flex items-center gap-2.5 text-left cursor-pointer"
                    >
                      <PapirusAppIcon appId="world3d" className="w-6 h-6 shrink-0" />
                      <span className="text-xs font-semibold text-white">Enter VCAOS 3D Spatial Deck</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === DISPLAY, WALLPAPER, DE MODE & COMPOSITOR SETTINGS POPOVER === */}
        {controlCenterOpen && (
          <div
            role="dialog"
            aria-label="VCAOS Control Center"
            className="absolute bottom-[54px] right-3 z-40 w-[340px] max-w-[calc(100vw-1.5rem)] rounded-xl bg-[#101423]/98 border border-white/15 shadow-2xl p-4 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-display font-semibold text-slate-100">Display & Desktop Shell</span>
              <button
                type="button"
                aria-label="Close control center"
                onClick={() => setControlCenterOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400">Desktop Environment (Shared Windows)</div>
              <div className="grid grid-cols-3 gap-1.5">
                {VCA_OS_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => switchMode(m.id)}
                    className={`px-2 py-1.5 rounded-md text-[11px] font-medium border cursor-pointer truncate ${
                      mode === m.id
                        ? 'bg-[#6d3bff] border-[#7c4dff] text-white'
                        : 'bg-[#080c18] border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {m.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-slate-400">YukiOS Wallpaper</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'yuki-aurora', label: 'Aurora' },
                    { id: 'midnight-nebula', label: 'Nebula' },
                    { id: 'obsidian-peaks', label: 'Peaks' },
                  ] as const
                ).map((wp) => (
                  <button
                    key={wp.id}
                    type="button"
                    onClick={() => setWallpaperTheme(wp.id)}
                    className={`px-2 py-1.5 rounded-md text-[11px] border cursor-pointer ${
                      wallpaperTheme === wp.id
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-semibold'
                        : 'bg-[#080c18] border-white/10 text-slate-300'
                    }`}
                  >
                    {wp.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-white/10">
              <div className="flex justify-between text-[11px] text-slate-300">
                <span>Hyprland Inner Gap</span>
                <span className="font-mono tabular-nums">{tilingConfig.gapsInner}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="28"
                value={tilingConfig.gapsInner}
                onChange={(e) =>
                  updateTilingConfig({ ...tilingConfig, gapsInner: Number(e.target.value) })
                }
                className="w-full accent-[#7c4dff]"
              />
              <div className="flex justify-between text-[11px] text-slate-300">
                <span>BSP Split Ratio</span>
                <span className="font-mono tabular-nums">{tilingConfig.splitRatio}</span>
              </div>
              <input
                type="range"
                min="0.3"
                max="0.7"
                step="0.02"
                value={tilingConfig.splitRatio}
                onChange={(e) =>
                  updateTilingConfig({ ...tilingConfig, splitRatio: clampSplitRatio(Number(e.target.value)) })
                }
                className="w-full accent-[#7c4dff]"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                onChangeTheme('vcaos-nexus');
                onClose();
              }}
              className="w-full py-2 rounded-lg bg-[#6d3bff] text-white font-semibold hover:bg-[#7c4dff] cursor-pointer"
            >
              Enter VCAOS 3D Scene
            </button>
          </div>
        )}

        {/* === BOTTOM TASKBAR / DOCK / SHELF PER MODE === */}

        {/* macOS Dock */}
        {mode === 'macos' && (
          <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-2xl bg-[#0f1423]/95 border border-white/15 shadow-2xl flex items-center gap-2">
            <button
              type="button"
              aria-label="Open Launchpad"
              onClick={() => setLauncherOpen((p) => !p)}
              className="w-11 h-11 rounded-xl bg-slate-900 border border-white/10 hover:border-[#7c4dff] flex items-center justify-center transition-transform hover:-translate-y-1 cursor-pointer"
            >
              <YukiLogoSvg className="w-7 h-7" />
            </button>
            <div className="w-px h-7 bg-white/15 mx-0.5" />
            {APP_CATALOG.map((app) => {
              const running = windows.some((w) => w.appId === app.appId);
              return (
                <button
                  key={app.appId}
                  type="button"
                  aria-label={`Dock: ${app.name}`}
                  onClick={() => launchApp(app.appId)}
                  className="relative w-11 h-11 rounded-xl bg-slate-950 border border-white/10 hover:border-cyan-400 flex items-center justify-center transition-transform hover:-translate-y-1 cursor-pointer"
                >
                  <PapirusAppIcon appId={app.appId} className="w-7 h-7" />
                  {running && <span className="absolute -bottom-1 w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Authentic YukiOS Bottom Taskbar (#taskbar) for Native / Win11 / ChromeOS */}
        {(mode === 'native' || mode === 'win11' || mode === 'chromeos') && (
          <div
            data-testid="vcaos-taskbar"
            className="absolute bottom-0 inset-x-0 z-30 h-[48px] pl-2 pr-0 bg-[#0b0e18]/94 border-t border-white/12 flex items-center justify-between gap-2 text-xs shadow-[0_-4px_24px_rgba(0,0,0,0.55)]"
          >
            {/* Left Zone: Start Orb + Workspace Switcher + Open Taskbar Windows */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
              <button
                type="button"
                id="vcaos-start-btn"
                aria-label="Open YukiOS Start Menu"
                onClick={() => {
                  setLauncherOpen((p) => !p);
                  setControlCenterOpen(false);
                }}
                className={`h-9 px-2 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                  launcherOpen ? 'bg-[#4810dc]/35 ring-1 ring-[#7c4dff]/60' : 'hover:bg-white/10'
                }`}
              >
                <YukiLogoSvg className="w-7 h-7" />
                {mode === 'chromeos' && <span className="text-slate-100 font-semibold pr-1">Shelf</span>}
                {mode === 'win11' && <span className="text-slate-100 font-semibold pr-1">Start</span>}
              </button>

              {/* YukiOS Workspace Switcher (Workspace Overview + Main + +) */}
              {mode === 'native' && (
                <div className="hidden md:flex items-center gap-1 pr-2 mr-1 border-r border-white/12 shrink-0">
                  <button
                    type="button"
                    onClick={() => setWorkspaceOverviewOpen((p) => !p)}
                    className={`h-7 px-2 rounded-[5px] border text-[11px] font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                      workspaceOverviewOpen
                        ? 'bg-[#4810dc]/30 border-[#7c4dff]/60 text-white'
                        : 'bg-white/6 border-white/12 text-slate-200 hover:bg-white/12'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5 text-indigo-300" />
                    <span>Workspace Overview</span>
                  </button>
                  {[1, 2, 3].map((ws) => (
                    <button
                      key={ws}
                      type="button"
                      aria-label={`Workspace ${ws}`}
                      onClick={() => switchWorkspace(ws)}
                      className={`h-7 px-2.5 rounded-[5px] border text-[11px] font-medium cursor-pointer whitespace-nowrap tabular-nums ${
                        activeWorkspace === ws
                          ? 'bg-[#4810dc]/35 border-[#7c4dff]/70 text-white'
                          : 'bg-white/5 border-white/12 text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      {ws === 1 ? 'Main' : `WS ${ws}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="Next workspace"
                    onClick={() => switchWorkspace((activeWorkspace % 6) + 1)}
                    className="h-7 w-7 rounded-[5px] border border-white/10 text-slate-300 hover:bg-white/10 flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Running Taskbar Window Items */}
              <div className="flex items-center gap-1 min-w-0 overflow-x-auto">
                {mode === 'win11'
                  ? APP_CATALOG.map((app) => {
                      const active = windows.some((w) => w.appId === app.appId && focusedWindowId === w.id && !w.minimized);
                      return (
                        <button
                          key={app.appId}
                          type="button"
                          aria-label={app.name}
                          onClick={() => launchApp(app.appId)}
                          className={`relative h-9 w-10 rounded-md flex items-center justify-center cursor-pointer shrink-0 ${
                            active ? 'bg-white/14' : 'hover:bg-white/8'
                          }`}
                        >
                          <PapirusAppIcon appId={app.appId} className="w-5 h-5" />
                          {active && <span className="absolute bottom-0.5 w-4 h-[3px] rounded-full bg-blue-400" />}
                        </button>
                      );
                    })
                  : windows.map((w) => {
                      const isActive = focusedWindowId === w.id && !w.minimized && w.workspace === activeWorkspace;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          onClick={() => {
                            setActiveWorkspace(w.workspace);
                            focusWindow(w.id);
                          }}
                          className={`relative h-9 px-2.5 rounded-md max-w-[168px] flex items-center gap-2 transition-colors cursor-pointer shrink-0 ${
                            isActive
                              ? 'bg-[#22242d] text-white'
                              : 'bg-transparent hover:bg-white/8 text-slate-300'
                          }`}
                        >
                          <PapirusAppIcon appId={w.appId} className="w-4 h-4 shrink-0" />
                          <span className="text-[11px] font-medium truncate">{w.title}</span>
                          <span
                            className={`absolute bottom-0 left-2 right-2 h-[2.5px] rounded-full ${
                              isActive ? 'bg-[#7c4dff]' : 'bg-white/25'
                            }`}
                          />
                        </button>
                      );
                    })}
              </div>
            </div>

            {/* Right Zone: YukiOS #system-tray (Network, Audio, Display/DE, Weather, Clock+Date, Show Desktop) */}
            <div className="flex items-center gap-1 h-full shrink-0 text-slate-200">
              <button
                type="button"
                aria-label="Network status"
                onClick={() => launchApp('monitor')}
                title={isOffline ? 'Offline' : 'Connected to Host Kernel'}
                className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                {isOffline ? <WifiOff className="w-4 h-4 text-rose-400" /> : <Wifi className="w-4 h-4" />}
              </button>

              <button
                type="button"
                aria-label="Audio mixer"
                onClick={() => setAudioMuted((m) => !m)}
                title={audioMuted ? 'Unmute Audio' : 'Mute Audio'}
                className="p-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                {audioMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                aria-label="Display & Shell Switcher"
                onClick={() => {
                  setControlCenterOpen((p) => !p);
                  setLauncherOpen(false);
                }}
                className={`px-2 py-1 rounded-md border flex items-center gap-1.5 text-[11px] cursor-pointer whitespace-nowrap ${
                  controlCenterOpen
                    ? 'bg-[#4810dc]/35 border-[#7c4dff] text-white'
                    : 'bg-white/5 border-white/12 text-slate-200 hover:bg-white/10'
                }`}
              >
                <Monitor className="w-3.5 h-3.5 text-cyan-300" />
                <span className="hidden sm:inline">{VCA_OS_MODES.find((m) => m.id === mode)?.shortLabel ?? 'YukiOS'}</span>
              </button>

              <button
                type="button"
                aria-label="Refresh host telemetry"
                onClick={() => {
                  if (!isOffline) {
                    void fetch('/api/workstation/metrics')
                      .then((r) => (r.ok ? r.json() : null))
                      .then((d) => {
                        if (d?.metrics) setHostMetrics(d.metrics);
                      });
                  }
                }}
                title="Sync workstation metrics"
                className="hidden lg:flex p-1.5 rounded-md hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>

              <div className="hidden sm:flex items-center gap-1 px-1.5 text-[11px] text-slate-200 tabular-nums whitespace-nowrap">
                <CloudSun className="w-3.5 h-3.5 text-amber-300" />
                <span>{weatherTempLabel}</span>
              </div>

              <div className="hidden md:flex items-center gap-1 px-1.5 text-[11px] font-mono text-slate-300 tabular-nums whitespace-nowrap">
                <Cpu className="w-3.5 h-3.5 text-cyan-300" />
                <span>{agents.length} AG</span>
              </div>

              {/* Stacked Clock & Date (#time-container) */}
              <div className="px-2 flex flex-col items-end justify-center leading-tight tabular-nums whitespace-nowrap">
                <span className="text-[11px] font-semibold text-slate-100">{clockText}</span>
                <span className="text-[10px] text-slate-400">{dateText}</span>
              </div>

              <button
                type="button"
                aria-label="Exit VCAOS to 3D Deck"
                onClick={onClose}
                className="px-2 py-1 mr-1 rounded-md bg-white/8 border border-white/12 text-[11px] font-medium text-slate-200 hover:bg-white/15 cursor-pointer whitespace-nowrap"
              >
                3D Deck
              </button>

              {/* Show Desktop Slice */}
              <button
                type="button"
                aria-label="Show Desktop"
                title="Show Desktop"
                onClick={showDesktopToggle}
                className="w-2.5 h-full border-l border-white/15 hover:bg-white/20 cursor-pointer shrink-0"
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
