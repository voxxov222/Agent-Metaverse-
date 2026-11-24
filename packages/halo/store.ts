import { useEffect, useRef, useState } from 'react';
import type {
  HaloLayoutConfig,
  HaloLayoutPresetId,
  HaloModuleId,
  HaloNormalizedState,
  HaloPluginModuleManifest,
  SharedCursorState,
} from './types';

const LAYOUT_STORAGE_KEY = 'vcalabs_halo_layout_v1';

export const LAYOUT_PRESET_MODULES: Record<HaloLayoutPresetId, HaloModuleId[]> = {
  'dev-mode': ['agent-ring', 'mission-control', 'process-monitor', 'telemetry-insight'],
  'ops-mode': ['agent-ring', 'security-approvals', 'process-monitor', 'voice-comms'],
  'build-mode': ['environment-deck', 'multiverse', 'automation-studio', 'agent-ring'],
  cinematic: ['agent-ring', 'memory-atlas'],
};

export function loadPersistedLayout(storage?: Pick<Storage, 'getItem'>): HaloLayoutConfig {
  const fallback: HaloLayoutConfig = {
    preset: 'ops-mode',
    formFactor: 'flat',
    themeId: 'cyan-ops',
    audioEnabled: true,
    hapticsEnabled: true,
    pinnedModules: LAYOUT_PRESET_MODULES['ops-mode'],
    hotkeys: {
      palette: 'Ctrl/Cmd+K',
      wrist: 'Tab',
      killswitch: 'Ctrl+Shift+X',
    },
  };
  try {
    const raw =
      storage?.getItem(LAYOUT_STORAGE_KEY) ??
      (typeof window !== 'undefined' ? window.localStorage.getItem(LAYOUT_STORAGE_KEY) : null);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<HaloLayoutConfig>;
    return {
      ...fallback,
      ...parsed,
      pinnedModules: Array.isArray(parsed.pinnedModules)
        ? parsed.pinnedModules
        : fallback.pinnedModules,
      hotkeys: { ...fallback.hotkeys, ...(parsed.hotkeys ?? {}) },
    };
  } catch {
    return fallback;
  }
}

export function persistLayout(layout: HaloLayoutConfig, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const data = JSON.stringify(layout);
    if (storage) storage.setItem(LAYOUT_STORAGE_KEY, data);
    else if (typeof window !== 'undefined') window.localStorage.setItem(LAYOUT_STORAGE_KEY, data);
  } catch {
    // Ignore storage quota restrictions
  }
}

/**
 * LWW-Element-Set CRDT merge for shared multi-user HUD cursors & selections.
 */
export function mergeSharedCursor(
  existing: Record<string, SharedCursorState>,
  incoming: SharedCursorState,
): Record<string, SharedCursorState> {
  const prev = existing[incoming.actorId];
  if (
    prev &&
    (prev.lamport > incoming.lamport ||
      (prev.lamport === incoming.lamport && prev.updatedAt > incoming.updatedAt))
  ) {
    return existing;
  }
  return {
    ...existing,
    [incoming.actorId]: incoming,
  };
}

function createInitialState(): HaloNormalizedState {
  const layout = loadPersistedLayout();
  return {
    isOpen: false,
    paletteOpen: false,
    wristOpen: false,
    activeModule: 'agent-ring',
    formFactor: layout.formFactor,
    layout,
    killSwitchActive: false,
    selectedAgentIds: [],
    selectedTaskId: null,
    recordingMacro: false,
    macroCommands: [],
    undoStack: [],
    agents: [],
    projects: [],
    activityLogs: [],
    memories: [],
    pinnedMemoryIds: [],
    redactedMemoryIds: [],
    plugins: [],
    integrations: [],
    commDrafts: [],
    financialRequests: [],
    regions: [],
    telemetry: null,
    telemetryHistory: [],
    worldPlayers: [],
    worldObjects: [],
    worldChat: [],
    zones: [],
    snapshots: [],
    forks: [],
    activeForkId: 'world-main',
    approvals: [],
    approvalGrants: [],
    auditChain: [],
    auditChainValid: true,
    injectionAlerts: [],
    schedulerJobs: [],
    traces: [],
    workflows: [],
    sharedCursors: {},
    panels3D: [
      { id: 'panel-agent', moduleId: 'agent-ring', title: 'Agent Command Ring', position: [-3.4, 2.3, -2.5], rotationY: 0.45, minimized: false, pinned: true },
      { id: 'panel-mission', moduleId: 'mission-control', title: 'Mission Control DAG', position: [0, 2.5, -3.7], rotationY: 0, minimized: false, pinned: true },
      { id: 'panel-security', moduleId: 'security-approvals', title: 'Security & Kill Switch', position: [3.4, 2.3, -2.5], rotationY: -0.45, minimized: false, pinned: true },
      { id: 'panel-telemetry', moduleId: 'telemetry-insight', title: 'Telemetry & Trace', position: [4.6, 2.1, 0.6], rotationY: -1.15, minimized: false, pinned: false },
      { id: 'panel-env', moduleId: 'environment-deck', title: 'Environment & Zones', position: [-4.6, 2.1, 0.6], rotationY: 1.15, minimized: false, pinned: false },
    ],
    lastCommandResult: null,
    glitchPulseAt: 0,
  };
}

class HaloStore {
  private state: HaloNormalizedState = createInitialState();
  private listeners = new Set<() => void>();
  private customModules: HaloPluginModuleManifest[] = [];

  public getState(): HaloNormalizedState {
    return this.state;
  }

  public setState(updater: Partial<HaloNormalizedState> | ((prev: HaloNormalizedState) => HaloNormalizedState)): void {
    this.state = typeof updater === 'function' ? updater(this.state) : { ...this.state, ...updater };
    for (const l of this.listeners) {
      l();
    }
  }

  public updateLayout(patch: Partial<HaloLayoutConfig>): void {
    const nextLayout: HaloLayoutConfig = {
      ...this.state.layout,
      ...patch,
      pinnedModules:
        patch.preset && !patch.pinnedModules
          ? LAYOUT_PRESET_MODULES[patch.preset]
          : patch.pinnedModules ?? this.state.layout.pinnedModules,
    };
    persistLayout(nextLayout);
    this.setState({
      layout: nextLayout,
      formFactor: nextLayout.formFactor,
      glitchPulseAt: Date.now(),
    });
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public registerPluginModule(manifest: HaloPluginModuleManifest): void {
    this.customModules = [...this.customModules.filter((m) => m.id !== manifest.id), manifest];
    for (const l of this.listeners) l();
  }

  public getPluginModules(): HaloPluginModuleManifest[] {
    return this.customModules;
  }
}

export const haloStore = new HaloStore();

export function useHaloSelector<T>(selector: (state: HaloNormalizedState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const [slice, setSlice] = useState<T>(() => selectorRef.current(haloStore.getState()));
  const sliceRef = useRef(slice);
  sliceRef.current = slice;

  useEffect(() => {
    return haloStore.subscribe(() => {
      const next = selectorRef.current(haloStore.getState());
      if (!Object.is(next, sliceRef.current)) {
        sliceRef.current = next;
        setSlice(next);
      }
    });
  }, []);

  return slice;
}
