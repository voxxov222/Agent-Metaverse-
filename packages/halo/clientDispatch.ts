import { haloAudio } from './audio';
import { createHaloCommand } from './commandBus';
import { haloStore } from './store';
import type {
  AuditChainEntry,
  CommandResult,
  HaloCommand,
  HaloFormFactor,
  HaloModuleId,
  HaloThemeId,
} from './types';
import type {
  AgentProfile,
  EnvironmentTheme,
  MemoryItem,
  ProjectRecord,
  WeatherMode,
  WorldObject,
} from '../../src/types/os';

export interface KernelSyncBridge {
  setAgents?: (agents: AgentProfile[]) => void;
  setProjects?: (projects: ProjectRecord[]) => void;
  setMemories?: (memories: MemoryItem[]) => void;
  setWorldObjects?: (objects: WorldObject[]) => void;
  setTheme?: (theme: EnvironmentTheme) => void;
  setWeather?: (weather: WeatherMode) => void;
  setTimeOfDayHours?: (hours: number) => void;
  createProjectFromObjective?: (objective: string) => Promise<void>;
}

let activeBridge: KernelSyncBridge = {};

export function registerKernelSyncBridge(bridge: KernelSyncBridge): void {
  activeBridge = bridge;
}

export function applyKernelPayloadToStore(payload: {
  kernel?: Record<string, unknown>;
  agents?: AgentProfile[];
  projects?: ProjectRecord[];
  memories?: MemoryItem[];
  worldObjects?: WorldObject[];
}): void {
  const k = payload.kernel ?? {};
  haloStore.setState((prev) => ({
    ...prev,
    killSwitchActive:
      typeof k.killSwitchActive === 'boolean' ? k.killSwitchActive : prev.killSwitchActive,
    approvals: Array.isArray(k.approvals) ? (k.approvals as any) : prev.approvals,
    approvalGrants: Array.isArray(k.approvalGrants)
      ? (k.approvalGrants as any)
      : prev.approvalGrants,
    auditChain: Array.isArray(k.auditChain) ? (k.auditChain as AuditChainEntry[]) : prev.auditChain,
    auditChainValid:
      typeof k.auditChainValid === 'boolean' ? k.auditChainValid : prev.auditChainValid,
    injectionAlerts: Array.isArray(k.injectionAlerts)
      ? (k.injectionAlerts as any)
      : prev.injectionAlerts,
    zones: Array.isArray(k.zones) ? (k.zones as any) : prev.zones,
    snapshots: Array.isArray(k.snapshots) ? (k.snapshots as any) : prev.snapshots,
    forks: Array.isArray(k.forks) ? (k.forks as any) : prev.forks,
    activeForkId: typeof k.activeForkId === 'string' ? k.activeForkId : prev.activeForkId,
    schedulerJobs: Array.isArray(k.schedulerJobs) ? (k.schedulerJobs as any) : prev.schedulerJobs,
    traces: Array.isArray(k.traces) ? (k.traces as any) : prev.traces,
    workflows: Array.isArray(k.workflows) ? (k.workflows as any) : prev.workflows,
    pinnedMemoryIds: Array.isArray(k.pinnedMemoryIds)
      ? (k.pinnedMemoryIds as string[])
      : prev.pinnedMemoryIds,
    redactedMemoryIds: Array.isArray(k.redactedMemoryIds)
      ? (k.redactedMemoryIds as string[])
      : prev.redactedMemoryIds,
    agents: payload.agents ?? prev.agents,
    projects: payload.projects ?? prev.projects,
    memories: payload.memories ?? prev.memories,
    worldObjects: payload.worldObjects ?? prev.worldObjects,
  }));

  if (payload.agents) activeBridge.setAgents?.(payload.agents);
  if (payload.projects) activeBridge.setProjects?.(payload.projects);
  if (payload.memories) activeBridge.setMemories?.(payload.memories);
  if (payload.worldObjects) activeBridge.setWorldObjects?.(payload.worldObjects);
}

export async function dispatchHaloCommand(
  cmd: HaloCommand,
  options?: { skipMacroRecord?: boolean },
): Promise<CommandResult> {
  const st = haloStore.getState();
  haloAudio.configure(st.layout.audioEnabled, st.layout.hapticsEnabled);

  // Client-native HUD routing commands
  if (cmd.verb === 'hud.formfactor') {
    const ff = (cmd.args.formFactor as HaloFormFactor) || 'flat';
    haloStore.updateLayout({ formFactor: ff });
    haloStore.setState({ isOpen: ff === 'flat' || ff === 'shared' || ff === 'dome' || ff === 'table' });
    haloAudio.play('tick');
    return { commandId: cmd.id, ok: true, status: 'executed', message: `Switched HUD to ${ff}.` };
  }
  if (cmd.verb === 'hud.module') {
    const mod = (cmd.args.moduleId as HaloModuleId) || 'agent-ring';
    haloStore.setState({ isOpen: true, activeModule: mod, glitchPulseAt: Date.now() });
    haloAudio.play('tick');
    return { commandId: cmd.id, ok: true, status: 'executed', message: `Focused ${mod}.` };
  }
  if (cmd.verb === 'hud.theme') {
    const themeId = (cmd.args.themeId as HaloThemeId) || 'cyan-ops';
    haloStore.updateLayout({ themeId });
    haloAudio.play('tick');
    return { commandId: cmd.id, ok: true, status: 'executed', message: `Theme set to ${themeId}.` };
  }
  if (cmd.verb === 'project.plan' && typeof cmd.args.objective === 'string' && activeBridge.createProjectFromObjective) {
    await activeBridge.createProjectFromObjective(cmd.args.objective);
    haloAudio.play('confirm');
    return { commandId: cmd.id, ok: true, status: 'executed', message: `Planned project "${cmd.args.objective}".` };
  }

  // Sync immediate environment controls alongside kernel audit
  if (cmd.verb === 'world.theme' && typeof cmd.args.theme === 'string') {
    activeBridge.setTheme?.(cmd.args.theme as EnvironmentTheme);
  } else if (cmd.verb === 'world.weather' && typeof cmd.args.weather === 'string') {
    activeBridge.setWeather?.(cmd.args.weather as WeatherMode);
  } else if (cmd.verb === 'world.time' && typeof cmd.args.timeOfDayHours === 'number') {
    activeBridge.setTimeOfDayHours?.(cmd.args.timeOfDayHours);
  }

  if (st.recordingMacro && !options?.skipMacroRecord) {
    haloStore.setState((prev) => ({
      ...prev,
      macroCommands: [...prev.macroCommands, cmd].slice(-20),
    }));
  }

  try {
    const res = await fetch('/api/kernel/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    });
    const data = await res.json();
    const result: CommandResult = data.result ?? {
      commandId: cmd.id,
      ok: res.ok,
      status: res.ok ? 'executed' : 'error',
      message: data.error || 'Syscall completed.',
    };

    applyKernelPayloadToStore(data);

    // Sync restored snapshot or switched fork theme/weather/time
    const snap = result.data?.snapshot as { theme?: EnvironmentTheme; weather?: WeatherMode; timeOfDayHours?: number } | undefined;
    const fork = result.data?.fork as { theme?: EnvironmentTheme; weather?: WeatherMode; timeOfDayHours?: number } | undefined;
    const envPatch = snap ?? fork;
    if (envPatch) {
      if (envPatch.theme) activeBridge.setTheme?.(envPatch.theme);
      if (envPatch.weather) activeBridge.setWeather?.(envPatch.weather);
      if (typeof envPatch.timeOfDayHours === 'number') {
        activeBridge.setTimeOfDayHours?.(envPatch.timeOfDayHours);
      }
    }

    haloStore.setState((prev) => ({
      ...prev,
      lastCommandResult: result,
      glitchPulseAt: Date.now(),
      undoStack: result.undoCommand ? [result.undoCommand, ...prev.undoStack].slice(0, 25) : prev.undoStack,
    }));

    if (cmd.verb === 'system.killswitch') {
      haloAudio.play('killswitch');
    } else if (!result.ok || result.status === 'pending-approval' || result.status === 'denied') {
      haloAudio.play('alert');
    } else {
      haloAudio.play('confirm');
    }
    return result;
  } catch (err) {
    const result: CommandResult = {
      commandId: cmd.id,
      ok: false,
      status: 'error',
      message: err instanceof Error ? err.message : 'Network error calling kernel bus.',
    };
    haloStore.setState({ lastCommandResult: result });
    haloAudio.play('alert');
    return result;
  }
}

export async function decideKernelApproval(
  approvalId: string,
  decision: 'approve-once' | 'always-allow' | 'deny',
  decidedBy = 'Operator-01',
): Promise<void> {
  const res = await fetch(`/api/kernel/approvals/${approvalId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, decidedBy }),
  });
  const data = await res.json();
  applyKernelPayloadToStore(data);
  haloStore.setState({
    lastCommandResult: data.result ?? {
      commandId: approvalId,
      ok: res.ok,
      status: decision === 'deny' ? 'denied' : 'executed',
      message: `Approval ${approvalId}: ${decision}`,
    },
    glitchPulseAt: Date.now(),
  });
  haloAudio.play(decision === 'deny' ? 'alert' : 'confirm');
}

export async function verifyKernelAuditChain(): Promise<{
  valid: boolean;
  brokenAtSeq?: number;
  entriesCount: number;
}> {
  const res = await fetch('/api/kernel/audit/verify');
  const data = await res.json();
  haloStore.setState((prev) => ({
    ...prev,
    auditChain: Array.isArray(data.auditChain) ? data.auditChain : prev.auditChain,
    auditChainValid: Boolean(data.valid),
  }));
  haloAudio.play(data.valid ? 'confirm' : 'alert');
  return {
    valid: Boolean(data.valid),
    brokenAtSeq: data.brokenAtSeq,
    entriesCount: Number(data.entriesCount ?? 0),
  };
}

export async function replayTraceStep(agentId: string, prompt: string): Promise<CommandResult> {
  const res = await fetch('/api/kernel/trace-replay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, prompt }),
  });
  const data = await res.json();
  applyKernelPayloadToStore(data);
  const result: CommandResult = data.result ?? {
    commandId: 'trace-replay',
    ok: res.ok,
    status: res.ok ? 'executed' : 'error',
    message: data.error || 'Trace replay failed.',
  };
  haloStore.setState({ lastCommandResult: result, glitchPulseAt: Date.now() });
  return result;
}

export async function undoLastHaloAction(): Promise<void> {
  const stack = haloStore.getState().undoStack;
  if (stack.length === 0) return;
  const [nextCmd, ...rest] = stack;
  haloStore.setState({ undoStack: rest });
  await dispatchHaloCommand(nextCmd, { skipMacroRecord: true });
}

export async function replayMacroSequence(): Promise<void> {
  const cmds = haloStore.getState().macroCommands;
  for (const cmd of cmds) {
    const fresh = createHaloCommand({
      actor: cmd.actor,
      target: cmd.target,
      verb: cmd.verb,
      args: cmd.args,
      requiresApproval: cmd.requiresApproval,
    });
    await dispatchHaloCommand(fresh, { skipMacroRecord: true });
  }
}
