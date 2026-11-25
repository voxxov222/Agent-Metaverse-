import os from 'os';
import type {
  JarvisDomainId,
  JarvisHologramConfig,
  JarvisHologramModelId,
  JarvisOrbState,
  JarvisReminder,
  JarvisToast,
  ServerWsEvent,
} from '../types/os';
import type { OsStateStore } from './stateStore';
import { collectHostWorkstationMetrics, type HostWorkstationMetrics } from './workstationMetrics';
import { executeSandboxCommand } from './terminalSandbox';
import {
  generateMethaneWireframe,
  generateNeuralLatticeWireframe,
  generateStarkGearWireframe,
  JARVIS_DOMAINS,
  parseJarvisIntent,
  parseReminderDelayMs,
} from '../utils/jarvisOperationsLogic';

export interface JarvisDomainLogEntry {
  id: string;
  domain: JarvisDomainId;
  prompt: string;
  reply: string;
  operationKind: 'diagnostics' | 'network-scan' | 'hologram' | 'reminder' | 'sandbox-exec' | 'domain-query';
  timestamp: number;
  chainedSteps?: string[];
  latencyMs?: number;
}

export interface NetworkTopologyNode {
  id: string;
  label: string;
  kind: 'gateway' | 'interface' | 'agent' | 'relay';
  ip: string;
  status: string;
}

export interface NetworkTopologySnapshot {
  scannedAt: number;
  hostname: string;
  nodes: NetworkTopologyNode[];
  vertices: Array<[number, number, number]>;
  connections: Array<[number, number]>;
}

export interface JarvisStateSnapshot {
  orbState: JarvisOrbState;
  orbLabel: string;
  hologram: JarvisHologramConfig;
  reminders: JarvisReminder[];
  toasts: JarvisToast[];
  networkTopology: NetworkTopologySnapshot;
  latestDiagnostics: {
    metrics: HostWorkstationMetrics;
    summary: string;
    activeAgents: number;
    runningTasks: number;
  } | null;
  domainLog: JarvisDomainLogEntry[];
}

export type JarvisBroadcastFn = (event: ServerWsEvent) => void;
export type JarvisAiRunner = (
  prompt: string,
  domain: JarvisDomainId,
  sysContext: string,
) => Promise<{ reply: string; tokens: number; latencyMs: number }>;

export class JarvisOperationsEngine {
  public orbState: JarvisOrbState = 'idle';
  public orbLabel = 'IDLE // READY';
  public hologram: JarvisHologramConfig = {
    model: 'neural-lattice',
    title: 'Central Neural Lattice',
    explodeFactor: 0,
    heatmap: false,
  };
  public reminders: JarvisReminder[] = [];
  public toasts: JarvisToast[] = [];
  public domainLog: JarvisDomainLogEntry[] = [];
  public networkTopology: NetworkTopologySnapshot;
  public latestDiagnostics: JarvisStateSnapshot['latestDiagnostics'] = null;

  private reminderTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly store: OsStateStore) {
    this.networkTopology = this.buildNetworkTopology();
  }

  public getSnapshot(): JarvisStateSnapshot {
    return {
      orbState: this.orbState,
      orbLabel: this.orbLabel,
      hologram: this.hologram,
      reminders: this.reminders,
      toasts: this.toasts.slice(0, 12),
      networkTopology: this.networkTopology,
      latestDiagnostics: this.latestDiagnostics,
      domainLog: this.domainLog.slice(0, 30),
    };
  }

  public setOrbState(state: JarvisOrbState, label?: string, broadcast?: JarvisBroadcastFn): void {
    this.orbState = state;
    this.orbLabel = label || state.toUpperCase();
    broadcast?.({ type: 'jarvis:orb', state: this.orbState, label: this.orbLabel });
  }

  public pushToast(
    title: string,
    message: string,
    severity: JarvisToast['severity'] = 'info',
    broadcast?: JarvisBroadcastFn,
  ): JarvisToast {
    const toast: JarvisToast = {
      id: `jtoast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.slice(0, 48),
      message: message.slice(0, 220),
      severity,
      createdAt: Date.now(),
    };
    this.toasts.unshift(toast);
    if (this.toasts.length > 24) this.toasts.length = 24;
    broadcast?.({ type: 'jarvis:toast', toast });
    return toast;
  }

  public buildNetworkTopology(): NetworkTopologySnapshot {
    const ifaces = os.networkInterfaces();
    const nodes: NetworkTopologyNode[] = [
      {
        id: 'gw-central',
        label: `Core (${os.hostname()})`,
        kind: 'gateway',
        ip: '127.0.0.1:3000',
        status: 'ONLINE',
      },
    ];

    for (const [name, list] of Object.entries(ifaces)) {
      if (!list) continue;
      for (const item of list) {
        if (item.family === 'IPv4' && !item.internal) {
          nodes.push({
            id: `if-${name}-${item.address}`,
            label: `NIC ${name}`,
            kind: 'interface',
            ip: item.address,
            status: 'ACTIVE',
          });
        }
      }
    }

    for (const agent of this.store.agents) {
      nodes.push({
        id: agent.id,
        label: agent.name,
        kind: 'agent',
        ip: `mesh://${agent.id}`,
        status: agent.status.toUpperCase(),
      });
    }

    // Build 3D radial ring vertices around [0, 0, 0] for Hologram Projector
    const vertices: Array<[number, number, number]> = [[0, 0.25, 0]];
    const connections: Array<[number, number]> = [];
    const ringNodes = nodes.slice(1);
    const total = Math.max(1, ringNodes.length);

    ringNodes.forEach((n, idx) => {
      const ang = (idx / total) * Math.PI * 2;
      const rad = n.kind === 'interface' ? 1.25 : 0.92;
      const y = n.kind === 'interface' ? -0.25 : 0.08 + ((idx % 3) - 1) * 0.22;
      vertices.push([Number((Math.cos(ang) * rad).toFixed(3)), Number(y.toFixed(3)), Number((Math.sin(ang) * rad).toFixed(3))]);
      const vIdx = idx + 1;
      connections.push([0, vIdx]);
      if (vIdx > 1) {
        connections.push([vIdx - 1, vIdx]);
      }
    });
    if (ringNodes.length > 2) {
      connections.push([1, ringNodes.length]);
    }

    return {
      scannedAt: Date.now(),
      hostname: os.hostname(),
      nodes,
      vertices,
      connections,
    };
  }

  public scanNetworkTopology(broadcast?: JarvisBroadcastFn): NetworkTopologySnapshot {
    this.networkTopology = this.buildNetworkTopology();
    this.store.pulseRegion('tool-bus', `JARVIS subnet sweep (${this.networkTopology.nodes.length} nodes)`);
    this.setHologram(
      {
        model: 'network-topology',
        title: `Subnet Topology (${this.networkTopology.nodes.length} nodes)`,
        customVertices: this.networkTopology.vertices,
        customConnections: this.networkTopology.connections,
      },
      broadcast,
    );
    this.pushToast(
      'Subnet Topology Mapped',
      `Detected ${this.networkTopology.nodes.length} active nodes across host interfaces & agent mesh.`,
      'success',
      broadcast,
    );
    return this.networkTopology;
  }

  public runStarkDiagnostics(broadcast?: JarvisBroadcastFn) {
    const activeAgents = this.store.agents.filter((a) => a.status !== 'idle').length;
    const avgLoad =
      this.store.regions.length > 0
        ? this.store.regions.reduce((s, r) => s + r.load, 0) / this.store.regions.length
        : 0;
    const metrics = collectHostWorkstationMetrics(activeAgents, avgLoad);
    const runningTasks = this.store.projects.flatMap((p) => p.tasks).filter((t) => t.status === 'in-progress').length;

    const summary = `Stark Diagnostics Complete — Host ${metrics.hostname} (${metrics.platform}/${metrics.arch}): CPU ${metrics.cpuPct}% across ${metrics.cpuCores} cores, RAM ${metrics.ramUsedGb}/${metrics.ramTotalGb} GB (${metrics.ramPct}%), Thermal ${metrics.tempC}°C (${metrics.tempSource}), Disk ${metrics.diskPct}% used, ${activeAgents}/${this.store.agents.length} agents active, ${runningTasks} tasks running.`;

    this.latestDiagnostics = { metrics, summary, activeAgents, runningTasks };
    this.store.pulseRegion('security-gate', 'Stark Systems Diagnostics Sweep');
    this.store.addActivity({
      agentId: 'central',
      agentName: 'JARVIS Core',
      stage: 'Diagnostics',
      tool: 'Stark Telemetry',
      message: summary,
      severity: metrics.cpuPct > 85 || metrics.ramPct > 90 ? 'warning' : 'success',
    });
    this.pushToast('Stark Diagnostics Nominal', `CPU ${metrics.cpuPct}% · RAM ${metrics.ramPct}% · ${metrics.tempC}°C`, 'info', broadcast);
    return this.latestDiagnostics;
  }

  public setHologram(
    patch: Partial<{
      model: JarvisHologramModelId;
      title: string;
      explodeFactor: number;
      heatmap: boolean;
      customVertices: Array<[number, number, number]>;
      customConnections: Array<[number, number]>;
    }>,
    broadcast?: JarvisBroadcastFn,
  ): JarvisHologramConfig {
    const model: JarvisHologramModelId = patch.model ?? this.hologram.model;
    let vertices = patch.customVertices;
    let connections = patch.customConnections;
    let defaultTitle = this.hologram.title;

    if (!vertices || !connections || patch.model) {
      if (model === 'methane') {
        const m = generateMethaneWireframe();
        vertices = m.vertices;
        connections = m.connections;
        defaultTitle = 'Methane CH4 Molecular Hologram';
      } else if (model === 'stark-gear') {
        const g = generateStarkGearWireframe(12);
        vertices = g.vertices;
        connections = g.connections;
        defaultTitle = 'Stark Mark-VII Involute Gear CAD';
      } else if (model === 'network-topology') {
        vertices = this.networkTopology.vertices;
        connections = this.networkTopology.connections;
        defaultTitle = `Subnet Topology (${this.networkTopology.nodes.length} nodes)`;
      } else {
        const n = generateNeuralLatticeWireframe();
        vertices = n.vertices;
        connections = n.connections;
        defaultTitle = 'Central Neural Lattice';
      }
    }

    const explodeRaw = patch.explodeFactor ?? this.hologram.explodeFactor;
    const explodeFactor = Number(Math.max(0, Math.min(1, Number.isFinite(explodeRaw) ? explodeRaw : 0)).toFixed(2));
    const heatmap = typeof patch.heatmap === 'boolean' ? patch.heatmap : this.hologram.heatmap;

    this.hologram = {
      model,
      title: patch.title || defaultTitle,
      explodeFactor,
      heatmap,
      customVertices: vertices,
      customConnections: connections,
    };
    this.store.pulseRegion('planning-engine', `Hologram: ${this.hologram.title}`);
    broadcast?.({ type: 'jarvis:hologram', hologram: this.hologram });
    return this.hologram;
  }

  public scheduleReminder(
    title: string,
    whenTextOrDelayMs: string | number,
    broadcast?: JarvisBroadcastFn,
  ): JarvisReminder {
    const delayMs =
      typeof whenTextOrDelayMs === 'number'
        ? Math.max(500, Math.min(86_400_000, whenTextOrDelayMs))
        : Math.max(1000, parseReminderDelayMs(whenTextOrDelayMs) || 15_000);

    const now = Date.now();
    const reminder: JarvisReminder = {
      id: `jrem-${now}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim().slice(0, 80) || 'JARVIS Scheduled Alert',
      dueAt: now + delayMs,
      createdAt: now,
      fired: false,
    };
    this.reminders.unshift(reminder);
    if (this.reminders.length > 30) this.reminders.length = 30;

    const timer = setTimeout(() => {
      this.reminderTimers.delete(reminder.id);
      reminder.fired = true;
      this.store.pulseRegion('memory-lattice', `Reminder: ${reminder.title}`);
      this.store.addActivity({
        agentId: 'central',
        agentName: 'JARVIS Scheduler',
        stage: 'Reminder Fired',
        tool: 'Temporal Queue',
        message: reminder.title,
        severity: 'info',
      });
      broadcast?.({ type: 'jarvis:reminder', reminder });
      this.pushToast('JARVIS Reminder Due', reminder.title, 'warning', broadcast);
    }, delayMs);
    timer.unref?.();
    this.reminderTimers.set(reminder.id, timer);

    broadcast?.({ type: 'jarvis:reminder', reminder });
    this.pushToast(
      'Reminder Scheduled',
      `"${reminder.title}" set for ${Math.round(delayMs / 1000)}s from now.`,
      'info',
      broadcast,
    );
    return reminder;
  }

  public deleteReminder(id: string): boolean {
    const timer = this.reminderTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.reminderTimers.delete(id);
    }
    const idx = this.reminders.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.reminders.splice(idx, 1);
    return true;
  }

  public async dispatchCommand(
    rawPrompt: string,
    requestedDomain: JarvisDomainId = 'core',
    broadcast?: JarvisBroadcastFn,
    runAi?: JarvisAiRunner,
  ): Promise<JarvisDomainLogEntry> {
    const started = Date.now();
    const cleanPrompt = rawPrompt.trim();
    const intent = parseJarvisIntent(cleanPrompt, requestedDomain);
    this.setOrbState('thinking', 'PROCESSING', broadcast);

    let reply = '';
    let domain: JarvisDomainId = requestedDomain;
    let operationKind: JarvisDomainLogEntry['operationKind'] = 'domain-query';
    let chainedSteps: string[] | undefined;

    try {
      if (intent.kind === 'diagnostics') {
        operationKind = 'diagnostics';
        domain = 'medical';
        const diag = this.runStarkDiagnostics(broadcast);
        reply = diag.summary;
      } else if (intent.kind === 'network-scan') {
        operationKind = 'network-scan';
        domain = 'security';
        const topo = this.scanNetworkTopology(broadcast);
        reply = `Mapped ${topo.nodes.length} live nodes across ${topo.hostname} network interfaces and Command Center agent mesh. Projected 3D subnet topology into Central Core.`;
      } else if (intent.kind === 'hologram') {
        operationKind = 'hologram';
        domain = intent.model === 'methane' ? 'science' : 'engineering';
        const holo = this.setHologram(
          {
            model: intent.model,
            explodeFactor: intent.explode,
            heatmap: intent.heatmap,
          },
          broadcast,
        );
        reply = `Central Hologram Projector updated -> ${holo.title} (Explode: ${Math.round(holo.explodeFactor * 100)}%, Thermal Heatmap: ${holo.heatmap ? 'ON' : 'OFF'}).`;
      } else if (intent.kind === 'reminder') {
        operationKind = 'reminder';
        domain = 'business';
        const rem = this.scheduleReminder(intent.title, intent.delayMs, broadcast);
        reply = `Reminder armed: "${rem.title}" will trigger in ${Math.round(intent.delayMs / 1000)}s.`;
      } else if (intent.kind === 'sandbox-exec') {
        operationKind = 'sandbox-exec';
        domain = 'development';
        const execRes = await executeSandboxCommand(intent.command);
        this.store.pulseRegion('tool-bus', `JARVIS exec: ${intent.command.slice(0, 24)}`);
        const out = [execRes.stdout, execRes.stderr].filter(Boolean).join('\n').trim() || '(no output)';
        reply = `$ ${intent.command} [exit ${execRes.exitCode}, ${execRes.durationMs}ms]\n${out}`;
      } else {
        domain = intent.domain;
        chainedSteps = intent.chainedSteps;
        const spec = JARVIS_DOMAINS.find((d) => d.id === domain) ?? JARVIS_DOMAINS[0];
        this.store.pulseRegion(spec.neuralRegion, `JARVIS ${spec.label}: ${cleanPrompt.slice(0, 32)}`);

        if (runAi) {
          const sysContext = JSON.stringify({
            jarvisDomain: spec.id,
            domainSpec: spec.description,
            chainedSteps,
            agents: this.store.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status })),
            hologram: { model: this.hologram.model, title: this.hologram.title },
            hostMetrics: this.latestDiagnostics?.metrics ?? null,
          });
          const aiRes = await runAi(cleanPrompt, domain, sysContext);
          reply = aiRes.reply;
        } else {
          reply = `[JARVIS ${spec.label} // Local Fallback] Acknowledged directive: "${cleanPrompt}".`;
        }
      }

      const entry: JarvisDomainLogEntry = {
        id: `jlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        domain,
        prompt: cleanPrompt,
        reply,
        operationKind,
        timestamp: Date.now(),
        chainedSteps,
        latencyMs: Date.now() - started,
      };
      this.domainLog.unshift(entry);
      if (this.domainLog.length > 50) this.domainLog.length = 50;

      this.setOrbState('speaking', 'TRANSMITTING', broadcast);
      const resetTimer = setTimeout(() => {
        if (this.orbState === 'speaking') {
          this.setOrbState('idle', 'IDLE // READY', broadcast);
        }
      }, 2400);
      resetTimer.unref?.();

      return entry;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'JARVIS operation failed.';
      this.setOrbState('error', 'ALERT', broadcast);
      this.pushToast('JARVIS Gateway Alert', msg, 'error', broadcast);
      const errEntry: JarvisDomainLogEntry = {
        id: `jlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        domain,
        prompt: cleanPrompt,
        reply: `Operation interrupted: ${msg}`,
        operationKind,
        timestamp: Date.now(),
        latencyMs: Date.now() - started,
      };
      this.domainLog.unshift(errEntry);
      return errEntry;
    }
  }

  public dispose(): void {
    for (const timer of this.reminderTimers.values()) {
      clearTimeout(timer);
    }
    this.reminderTimers.clear();
  }
}
