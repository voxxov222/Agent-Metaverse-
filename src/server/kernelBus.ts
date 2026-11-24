import crypto from 'crypto';
import type { OsStateStore } from './stateStore';
import type { WorldPresenceStore } from './worldPresence';
import { runAgentTurn } from './aiGateway';
import {
  buildUndoCommand,
  classifyCommandRisk,
  validateHaloCommand,
} from '../../packages/halo/commandBus';
import { compileWorkflowToDag } from '../../packages/halo/workflowCompiler';
import type {
  ApprovalRequest,
  ApprovalGrant,
  AuditChainEntry,
  CommandResult,
  HaloCommand,
  PromptInjectionAlert,
  SchedulerJob,
  TraceStep,
  WorkflowDefinition,
  WorldFork,
  WorldSnapshot,
  WorldZone,
} from '../../packages/halo/types';
import type { AgentProfile, ProjectRecord } from '../types/os';

function computeEntryHash(entry: Omit<AuditChainEntry, 'hash'>): string {
  const payload = JSON.stringify({
    seq: entry.seq,
    id: entry.id,
    timestamp: entry.timestamp,
    actor: entry.actor,
    target: entry.target,
    verb: entry.verb,
    argsSummary: entry.argsSummary,
    status: entry.status,
    prevHash: entry.prevHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function verifyAuditChain(entries: AuditChainEntry[]): {
  valid: boolean;
  brokenAtSeq?: number;
} {
  let expectedPrev = 'GENESIS';
  for (const e of entries) {
    if (e.prevHash !== expectedPrev) {
      return { valid: false, brokenAtSeq: e.seq };
    }
    const recomputed = computeEntryHash({
      seq: e.seq,
      id: e.id,
      timestamp: e.timestamp,
      actor: e.actor,
      target: e.target,
      verb: e.verb,
      argsSummary: e.argsSummary,
      status: e.status,
      prevHash: e.prevHash,
    });
    if (recomputed !== e.hash) {
      return { valid: false, brokenAtSeq: e.seq };
    }
    expectedPrev = e.hash;
  }
  return { valid: true };
}

export class KernelCommandBus {
  public killSwitchActive = false;
  public approvals: ApprovalRequest[] = [];
  public approvalGrants: ApprovalGrant[] = [];
  public auditChain: AuditChainEntry[] = [];
  public injectionAlerts: PromptInjectionAlert[] = [];
  public zones: WorldZone[] = [];
  public snapshots: WorldSnapshot[] = [];
  public forks: WorldFork[] = [];
  public activeForkId = 'world-main';
  public schedulerJobs: SchedulerJob[] = [];
  public traces: TraceStep[] = [];
  public workflows: WorkflowDefinition[] = [];
  public pinnedMemoryIds: string[] = ['mem-1'];
  public redactedMemoryIds: string[] = [];

  private store: OsStateStore;
  private worldStore: WorldPresenceStore;

  constructor(store: OsStateStore, worldStore: WorldPresenceStore) {
    this.store = store;
    this.worldStore = worldStore;
    this.seedKernelArtifacts();
  }

  private seedKernelArtifacts(): void {
    const now = Date.now();
    this.zones = [
      {
        id: 'zone-core-vault',
        name: 'Core Security Perimeter',
        center: [0, 0, 0],
        radius: 3.4,
        color: '#f59e0b',
        rule: 'read-only-fs',
        createdBy: 'Sentinel-05',
        createdAt: now - 3600_000,
      },
      {
        id: 'zone-dev-bay',
        name: 'Sandbox Engineering Bay',
        center: [-5.6, 0, 3.6],
        radius: 2.6,
        color: '#22d3ee',
        rule: 'sandbox-boost',
        createdBy: 'Kestrel-03',
        createdAt: now - 2400_000,
      },
    ];

    this.forks = [
      {
        id: 'world-main',
        name: 'Prime Reality (Main)',
        parentId: null,
        status: 'active',
        theme: 'command-center',
        weather: 'clear',
        timeOfDayHours: 14,
        fogDensity: 0.024,
        gravityScale: 1.0,
        physicsTimeScale: 1.0,
        objects: this.worldStore.objects,
        zones: this.zones,
        createdBy: 'Kernel',
        createdAt: now - 7200_000,
      },
    ];

    this.snapshots = [
      {
        id: 'snap-baseline',
        name: 'M1 Baseline District State',
        theme: 'command-center',
        weather: 'clear',
        timeOfDayHours: 14,
        objectCount: this.worldStore.objects.length,
        objects: JSON.parse(JSON.stringify(this.worldStore.objects)),
        zones: JSON.parse(JSON.stringify(this.zones)),
        createdBy: 'Kernel',
        createdAt: now - 1800_000,
      },
    ];

    this.schedulerJobs = [
      {
        id: 'job-telemetry',
        name: 'Host & AI Telemetry Poll',
        triggerType: 'cron',
        scheduleExpr: '*/3s',
        status: 'running',
        priority: 'high',
        targetAgentId: 'agent-aegis',
        cpuPct: 4.2,
        memMb: 92,
        netKbps: 18,
        lastRunAt: now,
        runCount: 42,
      },
      {
        id: 'job-sec-audit',
        name: 'Vault & Prompt-Injection Scan',
        triggerType: 'cron',
        scheduleExpr: '*/5m',
        status: 'queued',
        priority: 'critical',
        targetAgentId: 'agent-sentinel',
        cpuPct: 1.1,
        memMb: 48,
        netKbps: 6,
        lastRunAt: now - 180_000,
        runCount: 11,
      },
    ];

    this.traces = [
      {
        id: 'trace-seed-1',
        timestamp: now - 600_000,
        agentId: 'agent-kestrel',
        agentName: 'Kestrel-03',
        stage: 'Sandbox Audit',
        prompt: 'Verify path confinement and unit test baseline inside sandbox workspace.',
        output: 'Confirmed all 16 unit assertions pass and path traversal is blocked by trailing path.sep checks.',
        model: 'gemini-4-hydrogen',
        tokens: 412,
        latencyMs: 640,
        memoryIdsUsed: ['mem-1', 'mem-3'],
      },
    ];

    this.workflows = [
      {
        id: 'wf-security-sweep',
        name: 'Autonomous Repo & Security Sweep',
        version: 1,
        schedule: 'manual',
        nodes: [
          { id: 'n1', kind: 'trigger', label: 'Manual / Cron Trigger', config: {}, x: 40, y: 80 },
          { id: 'n2', kind: 'agent', label: 'Scan Sandbox & Dependencies', agentId: 'agent-sentinel', config: {}, x: 240, y: 80 },
          { id: 'n3', kind: 'approval', label: 'Operator Release Gate', agentId: 'agent-aegis', config: { requiresApproval: true }, x: 450, y: 80 },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
        compiledTasks: [],
        updatedAt: now - 1200_000,
      },
    ];
    this.workflows[0].compiledTasks = compileWorkflowToDag(this.workflows[0], this.store.agents).tasks;

    this.appendAudit({
      id: 'audit-boot',
      actor: 'Kernel',
      target: 'halo-bus',
      verb: 'kernel.boot',
      argsSummary: 'Initialized HALO typed syscall bus and SHA-256 audit chain',
      status: 'executed',
    });
  }

  public appendAudit(params: {
    id: string;
    actor: string;
    target: string;
    verb: string;
    argsSummary: string;
    status: AuditChainEntry['status'];
  }): AuditChainEntry {
    const prevHash =
      this.auditChain.length > 0 ? this.auditChain[this.auditChain.length - 1].hash : 'GENESIS';
    const seq = this.auditChain.length + 1;
    const base: Omit<AuditChainEntry, 'hash'> = {
      seq,
      id: params.id,
      timestamp: Date.now(),
      actor: params.actor,
      target: params.target,
      verb: params.verb,
      argsSummary: params.argsSummary,
      status: params.status,
      prevHash,
    };
    const entry: AuditChainEntry = {
      ...base,
      hash: computeEntryHash(base),
    };
    this.auditChain.push(entry);
    if (this.auditChain.length > 250) {
      this.auditChain.shift();
    }
    return entry;
  }

  public recordInjectionAlert(source: string, excerpt: string, pattern: string): void {
    this.injectionAlerts.unshift({
      id: `inj-${Date.now()}`,
      source,
      excerpt: excerpt.slice(0, 180),
      detectedPattern: pattern,
      severity: 'high',
      timestamp: Date.now(),
    });
    if (this.injectionAlerts.length > 50) this.injectionAlerts.length = 50;
  }

  public hasActiveGrant(verb: string, target: string): boolean {
    const now = Date.now();
    this.approvalGrants = this.approvalGrants.filter((g) => g.expiresAt > now);
    return this.approvalGrants.some(
      (g) => (g.verb === verb || g.verb === '*') && (g.target === target || g.target === '*'),
    );
  }

  private categorizeRisk(verb: string): ApprovalRequest['category'] {
    if (verb === 'net.egress') return 'network-egress';
    if (verb === 'finance.approve') return 'spending';
    if (verb === 'code.exec') return 'code-execution';
    if (verb === 'wallet.sign') return 'wallet-signing';
    if (verb === 'agent.kill') return 'agent-termination';
    return 'deletion';
  }

  public async dispatchCommand(
    cmd: HaloCommand,
    options?: { bypassApproval?: boolean },
  ): Promise<CommandResult> {
    const check = validateHaloCommand(cmd);
    if (!check.valid) {
      return {
        commandId: cmd.id,
        ok: false,
        status: 'error',
        message: check.reason || 'Invalid command.',
      };
    }

    // Kill switch blocks all mutations except system.resume and read-only HUD navigation
    if (
      this.killSwitchActive &&
      cmd.verb !== 'system.resume' &&
      cmd.verb !== 'system.killswitch' &&
      !cmd.verb.startsWith('hud.')
    ) {
      const audit = this.appendAudit({
        id: cmd.id,
        actor: cmd.actor,
        target: cmd.target,
        verb: cmd.verb,
        argsSummary: 'Blocked by active Global Kill Switch',
        status: 'denied',
      });
      return {
        commandId: cmd.id,
        ok: false,
        status: 'denied',
        auditHash: audit.hash,
        message: 'Blocked: Global KILL SWITCH is active. Resume system first.',
      };
    }

    const risk = classifyCommandRisk(cmd.verb);
    const needsApproval =
      !options?.bypassApproval &&
      (cmd.requiresApproval || risk.requiresApproval) &&
      !this.hasActiveGrant(cmd.verb, cmd.target);

    if (needsApproval) {
      const req: ApprovalRequest = {
        id: `apr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        command: cmd,
        category: this.categorizeRisk(cmd.verb),
        summary: `${cmd.actor} requested ${cmd.verb} on ${cmd.target}`,
        diffPreview: JSON.stringify(cmd.args, null, 2),
        status: 'pending',
        createdAt: Date.now(),
      };
      this.approvals.unshift(req);
      const audit = this.appendAudit({
        id: cmd.id,
        actor: cmd.actor,
        target: cmd.target,
        verb: cmd.verb,
        argsSummary: JSON.stringify(cmd.args).slice(0, 140),
        status: 'queued-approval',
      });
      this.store.pulseRegion('security-gate', `Queued approval: ${cmd.verb}`);
      this.store.addActivity({
        agentId: 'agent-sentinel',
        agentName: 'Sentinel-05',
        stage: 'Approval Center',
        tool: 'HALO Kernel Bus',
        message: `Syscall ${cmd.verb} (${cmd.target}) queued for human approval.`,
        severity: 'warning',
      });
      return {
        commandId: cmd.id,
        ok: true,
        status: 'pending-approval',
        approvalId: req.id,
        auditHash: audit.hash,
        message: `Syscall queued in Security & Approval Center (${req.id}).`,
      };
    }

    return this.executeSyscall(cmd);
  }

  public async decideApproval(
    approvalId: string,
    decision: 'approve-once' | 'always-allow' | 'deny',
    decidedBy: string,
    expiryMinutes = 60,
  ): Promise<{ approval: ApprovalRequest; result?: CommandResult } | null> {
    const req = this.approvals.find((a) => a.id === approvalId);
    if (!req) return null;
    req.decidedBy = decidedBy;
    req.decidedAt = Date.now();

    if (decision === 'deny') {
      req.status = 'denied';
      this.appendAudit({
        id: `dec-${req.id}`,
        actor: decidedBy,
        target: req.command.target,
        verb: `${req.command.verb}:denied`,
        argsSummary: req.summary,
        status: 'denied',
      });
      return { approval: req };
    }

    req.status = 'approved';
    req.decisionScope = decision === 'always-allow' ? 'always-1h' : 'once';
    if (decision === 'always-allow') {
      this.approvalGrants.push({
        id: `grant-${Date.now()}`,
        verb: req.command.verb,
        target: req.command.target,
        grantedBy: decidedBy,
        expiresAt: Date.now() + Math.max(5, expiryMinutes) * 60_000,
      });
    }

    const result = await this.executeSyscall(req.command);
    return { approval: req, result };
  }

  private findAgent(query: string): AgentProfile | undefined {
    const q = query.trim().toLowerCase();
    return this.store.agents.find(
      (a) => a.id.toLowerCase() === q || a.name.toLowerCase() === q || a.name.toLowerCase().startsWith(q),
    );
  }

  private async executeSyscall(cmd: HaloCommand): Promise<CommandResult> {
    const args = cmd.args ?? {};
    let message = `Executed ${cmd.verb} on ${cmd.target}`;
    let data: Record<string, unknown> = {};
    let undoCommand: HaloCommand | undefined;

    switch (cmd.verb) {
      case 'system.killswitch': {
        this.killSwitchActive = true;
        for (const ag of this.store.agents) {
          ag.status = 'awaiting-approval';
          ag.currentStage = 'FROZEN (KILL SWITCH)';
          ag.permissions.codeDeploy = false;
          ag.permissions.terminalWrite = false;
          ag.permissions.sendEmail = false;
          ag.permissions.sendSms = false;
          ag.permissions.makeCalls = false;
          ag.updatedAt = Date.now();
          this.store.emit({ type: 'agent:updated', agent: ag });
        }
        for (const job of this.schedulerJobs) {
          if (job.status === 'running') job.status = 'throttled';
        }
        this.store.pulseRegion('security-gate', 'GLOBAL KILL SWITCH ENGAGED');
        this.store.addActivity({
          agentId: 'agent-sentinel',
          agentName: cmd.actor,
          stage: 'KILL SWITCH',
          tool: 'HALO Emergency Halt',
          message: 'Global KILL SWITCH engaged: all agents frozen and risky capabilities revoked.',
          severity: 'error',
        });
        message = 'Global KILL SWITCH engaged: all agents frozen and active capabilities revoked.';
        break;
      }

      case 'system.resume': {
        this.killSwitchActive = false;
        for (const ag of this.store.agents) {
          if (ag.status === 'awaiting-approval') {
            ag.status = 'idle';
            ag.currentStage = 'Standby';
            ag.updatedAt = Date.now();
            this.store.emit({ type: 'agent:updated', agent: ag });
          }
        }
        this.store.pulseRegion('security-gate', 'System resumed by operator');
        this.store.addActivity({
          agentId: 'agent-sentinel',
          agentName: cmd.actor,
          stage: 'Resume',
          tool: 'HALO Kernel Bus',
          message: 'Operator cleared Global Kill Switch; agents returned to Standby.',
          severity: 'success',
        });
        message = 'System resumed; agents returned to Standby.';
        break;
      }

      case 'agent.spawn': {
        const name = String(args.name || `Unit-${this.store.agents.length + 1}`).trim();
        const role = String(args.role || 'Autonomous Specialist').trim();
        const idx = this.store.agents.length;
        const angle = (idx * 1.15) % (Math.PI * 2);
        const radius = 5.8;
        const created: AgentProfile = {
          id: `agent-${Date.now().toString(36)}`,
          name,
          role,
          expertise: Array.isArray(args.expertise) ? (args.expertise as string[]) : ['general', 'automation'],
          personality: String(args.personality || 'Analytical and mission-driven'),
          systemPrompt: String(args.systemPrompt || `Act as ${role}.`),
          model: 'gemini-4-hydrogen',
          autonomy: args.autonomy === 'AUTONOMOUS' || args.autonomy === 'ASSISTED' ? args.autonomy : 'SUPERVISED',
          status: 'idle',
          currentObjective: 'Spawned via HALO Command Bus',
          currentStage: 'Standby',
          position: [
            Number((Math.cos(angle) * radius).toFixed(2)),
            0,
            Number((Math.sin(angle) * radius).toFixed(2)),
          ],
          appearance: {
            chassisColor: '#1E293B',
            accentColor: String(args.accentColor || '#22D3EE'),
            visorColor: String(args.accentColor || '#22D3EE'),
            wardrobeStyle: 'tactical-coat',
            expression: 'focused',
            heightScale: 1.0,
            shoulderWidth: 1.0,
          },
          voice: { pitch: 1.0, rate: 1.0, style: 'Balanced' },
          permissions: {
            terminalRead: true,
            terminalWrite: false,
            webBrowse: true,
            sendEmail: false,
            sendSms: false,
            makeCalls: false,
            codeDeploy: false,
            financialSpendLimitUsd: Number(args.budgetUsd ?? 25),
          },
          metrics: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0, avgLatencyMs: 0 },
          updatedAt: Date.now(),
        };
        this.store.agents.push(created);
        this.store.emit({ type: 'agent:updated', agent: created });
        this.store.addActivity({
          agentId: created.id,
          agentName: created.name,
          stage: 'Agent Spawned',
          tool: 'HALO Kernel Bus',
          message: `Spawned ${created.name} (${created.role}) via HALO syscall.`,
          severity: 'success',
        });
        data = { agent: created };
        message = `Spawned agent ${created.name}.`;
        break;
      }

      case 'agent.clone': {
        const src = this.findAgent(cmd.target);
        if (!src) {
          return { commandId: cmd.id, ok: false, status: 'error', message: `Agent ${cmd.target} not found.` };
        }
        const clone: AgentProfile = {
          ...JSON.parse(JSON.stringify(src)),
          id: `agent-clone-${Date.now().toString(36)}`,
          name: `${src.name}-B`,
          position: [src.position[0] + 1.4, 0, src.position[2] + 1.1],
          updatedAt: Date.now(),
        };
        this.store.agents.push(clone);
        this.store.emit({ type: 'agent:updated', agent: clone });
        data = { agent: clone };
        message = `Cloned ${src.name} as ${clone.name}.`;
        break;
      }

      case 'agent.pause':
      case 'agent.resume': {
        const ag = this.findAgent(cmd.target);
        if (!ag) {
          return { commandId: cmd.id, ok: false, status: 'error', message: `Agent ${cmd.target} not found.` };
        }
        ag.status = cmd.verb === 'agent.pause' ? 'awaiting-approval' : 'idle';
        ag.currentStage = cmd.verb === 'agent.pause' ? 'Paused by Operator' : 'Standby';
        ag.updatedAt = Date.now();
        this.store.emit({ type: 'agent:updated', agent: ag });
        undoCommand = buildUndoCommand(cmd);
        data = { agent: ag };
        message = `${ag.name} ${cmd.verb === 'agent.pause' ? 'paused' : 'resumed'}.`;
        break;
      }

      case 'agent.kill': {
        const ag = this.findAgent(cmd.target);
        if (!ag) {
          return { commandId: cmd.id, ok: false, status: 'error', message: `Agent ${cmd.target} not found.` };
        }
        this.store.agents = this.store.agents.filter((a) => a.id !== ag.id);
        this.store.addActivity({
          agentId: ag.id,
          agentName: ag.name,
          stage: 'Terminated',
          tool: 'HALO Kernel Bus',
          message: `Agent ${ag.name} terminated after operator approval.`,
          severity: 'warning',
        });
        message = `Terminated agent ${ag.name}.`;
        break;
      }

      case 'agent.update':
      case 'agent.permission.grant':
      case 'agent.permission.revoke': {
        const ag = this.findAgent(cmd.target);
        if (!ag) {
          return { commandId: cmd.id, ok: false, status: 'error', message: `Agent ${cmd.target} not found.` };
        }
        if (typeof args.budgetUsd === 'number') {
          ag.permissions.financialSpendLimitUsd = Math.max(0, args.budgetUsd);
        }
        if (typeof args.skill === 'string' && args.skill.trim()) {
          if (!ag.expertise.includes(args.skill.trim())) {
            ag.expertise = [...ag.expertise, args.skill.trim()];
          }
        }
        if (typeof args.permissionKey === 'string') {
          const key = args.permissionKey as keyof AgentProfile['permissions'];
          if (typeof ag.permissions[key] === 'boolean') {
            (ag.permissions[key] as boolean) = cmd.verb === 'agent.permission.grant';
          }
        }
        if (typeof args.autonomy === 'string') {
          ag.autonomy = args.autonomy as AgentProfile['autonomy'];
        }
        ag.updatedAt = Date.now();
        this.store.emit({ type: 'agent:updated', agent: ag });
        data = { agent: ag };
        message = `Updated ${ag.name} configuration.`;
        break;
      }

      case 'task.create': {
        const title = String(args.title || 'HALO Mission Task').trim();
        const assignedAgentId = String(args.agentId || this.store.agents[0]?.id || 'agent-aegis');
        let project = this.store.projects[0];
        if (!project) {
          project = {
            id: `proj-${Date.now()}`,
            title: 'HALO Mission Queue',
            objective: 'Operator-directed task graph',
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            tasks: [],
            milestones: [],
            teamAgentIds: [assignedAgentId],
          };
          this.store.projects.unshift(project);
        }
        const task = {
          id: `t-halo-${Date.now().toString(36)}`,
          title,
          description: String(args.description || 'Dispatched from HALO Mission Control'),
          assignedAgentId,
          dependsOn: Array.isArray(args.dependsOn) ? (args.dependsOn as string[]) : [],
          status: args.requiresApproval ? ('awaiting-approval' as const) : ('queued' as const),
          priority: (args.priority as 'low' | 'medium' | 'high' | 'critical') || 'high',
          requiresApproval: Boolean(args.requiresApproval),
          estimatedMinutes: Number(args.estimatedMinutes ?? 3),
        };
        project.tasks.push(task);
        if (!project.teamAgentIds.includes(assignedAgentId)) {
          project.teamAgentIds.push(assignedAgentId);
        }
        project.updatedAt = Date.now();
        this.store.emit({ type: 'project:updated', project });
        data = { project, task };
        message = `Created task "${task.title}" assigned to ${assignedAgentId}.`;
        break;
      }

      case 'task.assign':
      case 'task.retry':
      case 'task.cancel':
      case 'task.dependency.add': {
        const taskId = cmd.target;
        let updatedProject: ProjectRecord | undefined;
        for (const p of this.store.projects) {
          const t = p.tasks.find((item) => item.id === taskId);
          if (!t) continue;
          if (cmd.verb === 'task.assign' && typeof args.agentId === 'string') {
            t.assignedAgentId = args.agentId;
            if (!p.teamAgentIds.includes(args.agentId)) p.teamAgentIds.push(args.agentId);
          } else if (cmd.verb === 'task.retry') {
            t.status = 'queued';
          } else if (cmd.verb === 'task.cancel') {
            t.status = 'failed';
            t.output = 'Cancelled from HALO Mission Control.';
          } else if (cmd.verb === 'task.dependency.add' && typeof args.dependsOnId === 'string') {
            if (args.dependsOnId !== t.id && !t.dependsOn.includes(args.dependsOnId)) {
              t.dependsOn.push(args.dependsOnId);
            }
          }
          p.updatedAt = Date.now();
          updatedProject = p;
          this.store.emit({ type: 'project:updated', project: p });
          break;
        }
        if (!updatedProject) {
          return { commandId: cmd.id, ok: false, status: 'error', message: `Task ${taskId} not found.` };
        }
        data = { project: updatedProject };
        message = `Updated task ${taskId} (${cmd.verb}).`;
        break;
      }

      case 'task.split': {
        const taskId = cmd.target;
        for (const p of this.store.projects) {
          const idx = p.tasks.findIndex((item) => item.id === taskId);
          if (idx === -1) continue;
          const orig = p.tasks[idx];
          const subA = {
            ...orig,
            id: `${orig.id}-a`,
            title: `${orig.title} (Phase A)`,
            status: 'queued' as const,
          };
          const subB = {
            ...orig,
            id: `${orig.id}-b`,
            title: `${orig.title} (Phase B)`,
            dependsOn: [subA.id],
            status: 'queued' as const,
          };
          p.tasks.splice(idx, 1, subA, subB);
          this.store.emit({ type: 'project:updated', project: p });
          data = { project: p };
          message = `Split task "${orig.title}" into 2 dependent phases.`;
          break;
        }
        break;
      }

      case 'world.object.place': {
        const placed = this.worldStore.placeObject({
          kind: (args.kind as any) || 'holo-kiosk',
          label: String(args.label || 'HALO Prop'),
          position: Array.isArray(args.position) ? (args.position as [number, number, number]) : [2, 0, 3],
          color: typeof args.color === 'string' ? args.color : '#22d3ee',
          ownerCallsign: cmd.actor,
        });
        this.store.emit({ type: 'world:objects', objects: this.worldStore.objects });
        undoCommand = buildUndoCommand(cmd, { placedId: placed.id });
        data = { object: placed, objects: this.worldStore.objects };
        message = `Placed "${placed.label}" in world.`;
        break;
      }

      case 'world.object.delete': {
        this.worldStore.removeObject(cmd.target);
        this.store.emit({ type: 'world:objects', objects: this.worldStore.objects });
        data = { objects: this.worldStore.objects };
        message = `Removed world object ${cmd.target}.`;
        break;
      }

      case 'world.zone.create': {
        const zone: WorldZone = {
          id: `zone-${Date.now().toString(36)}`,
          name: String(args.name || 'Custom Zone'),
          center: Array.isArray(args.center) ? (args.center as [number, number, number]) : [0, 0, 5],
          radius: Math.max(1.2, Math.min(14, Number(args.radius ?? 3.2))),
          color: String(args.color || '#22d3ee'),
          rule: (args.rule as WorldZone['rule']) || 'read-only-fs',
          createdBy: cmd.actor,
          createdAt: Date.now(),
        };
        this.zones.push(zone);
        data = { zone, zones: this.zones };
        message = `Created 3D zone "${zone.name}" with rule [${zone.rule}].`;
        break;
      }

      case 'world.zone.delete': {
        this.zones = this.zones.filter((z) => z.id !== cmd.target);
        data = { zones: this.zones };
        message = `Deleted zone ${cmd.target}.`;
        break;
      }

      case 'world.snapshot.save': {
        const snap: WorldSnapshot = {
          id: `snap-${Date.now().toString(36)}`,
          name: String(args.name || `Snapshot ${this.snapshots.length + 1}`),
          theme: (args.theme as any) || 'command-center',
          weather: (args.weather as any) || 'clear',
          timeOfDayHours: Number(args.timeOfDayHours ?? 14),
          objectCount: this.worldStore.objects.length,
          objects: JSON.parse(JSON.stringify(this.worldStore.objects)),
          zones: JSON.parse(JSON.stringify(this.zones)),
          createdBy: cmd.actor,
          createdAt: Date.now(),
        };
        this.snapshots.unshift(snap);
        data = { snapshot: snap, snapshots: this.snapshots };
        message = `Saved world snapshot "${snap.name}" (${snap.objectCount} objects).`;
        break;
      }

      case 'world.snapshot.restore': {
        const snap = this.snapshots.find((s) => s.id === cmd.target);
        if (!snap) {
          return { commandId: cmd.id, ok: false, status: 'error', message: 'Snapshot not found.' };
        }
        this.worldStore.objects = JSON.parse(JSON.stringify(snap.objects));
        this.zones = JSON.parse(JSON.stringify(snap.zones));
        this.store.emit({ type: 'world:objects', objects: this.worldStore.objects });
        data = { snapshot: snap, objects: this.worldStore.objects, zones: this.zones };
        message = `Restored world state from "${snap.name}".`;
        break;
      }

      case 'world.fork.create': {
        const fork: WorldFork = {
          id: `fork-${Date.now().toString(36)}`,
          name: String(args.name || `Sandbox Fork ${this.forks.length}`),
          parentId: this.activeForkId,
          status: 'active',
          theme: (args.theme as any) || 'holo-ops',
          weather: (args.weather as any) || 'clear',
          timeOfDayHours: Number(args.timeOfDayHours ?? 16),
          fogDensity: Number(args.fogDensity ?? 0.02),
          gravityScale: Number(args.gravityScale ?? 1),
          physicsTimeScale: Number(args.physicsTimeScale ?? 1),
          objects: JSON.parse(JSON.stringify(this.worldStore.objects)),
          zones: JSON.parse(JSON.stringify(this.zones)),
          createdBy: cmd.actor,
          createdAt: Date.now(),
        };
        this.forks.push(fork);
        this.activeForkId = fork.id;
        data = { fork, forks: this.forks, activeForkId: this.activeForkId };
        message = `Forked sandbox world "${fork.name}".`;
        break;
      }

      case 'world.fork.switch': {
        const fork = this.forks.find((f) => f.id === cmd.target && f.status === 'active');
        if (!fork) {
          return { commandId: cmd.id, ok: false, status: 'error', message: 'Fork not found or inactive.' };
        }
        this.activeForkId = fork.id;
        this.worldStore.objects = JSON.parse(JSON.stringify(fork.objects));
        this.zones = JSON.parse(JSON.stringify(fork.zones));
        this.store.emit({ type: 'world:objects', objects: this.worldStore.objects });
        data = { fork, activeForkId: this.activeForkId, objects: this.worldStore.objects, zones: this.zones };
        message = `Switched active universe to "${fork.name}".`;
        break;
      }

      case 'world.fork.merge': {
        const fork = this.forks.find((f) => f.id === cmd.target);
        const main = this.forks.find((f) => f.id === 'world-main');
        if (!fork || !main || fork.id === 'world-main') {
          return { commandId: cmd.id, ok: false, status: 'error', message: 'Cannot merge selected world.' };
        }
        main.objects = JSON.parse(JSON.stringify(fork.objects));
        main.zones = JSON.parse(JSON.stringify(fork.zones));
        fork.status = 'merged';
        this.activeForkId = 'world-main';
        this.worldStore.objects = JSON.parse(JSON.stringify(main.objects));
        this.zones = JSON.parse(JSON.stringify(main.zones));
        this.store.emit({ type: 'world:objects', objects: this.worldStore.objects });
        data = { forks: this.forks, activeForkId: this.activeForkId, objects: this.worldStore.objects };
        message = `Merged fork "${fork.name}" into Prime Reality.`;
        break;
      }

      case 'world.fork.discard': {
        const fork = this.forks.find((f) => f.id === cmd.target);
        if (!fork || fork.id === 'world-main') {
          return { commandId: cmd.id, ok: false, status: 'error', message: 'Cannot discard Prime Reality.' };
        }
        fork.status = 'discarded';
        this.activeForkId = 'world-main';
        data = { forks: this.forks, activeForkId: this.activeForkId };
        message = `Discarded fork "${fork.name}".`;
        break;
      }

      case 'memory.edit': {
        const mem = this.store.memories.find((m) => m.id === cmd.target);
        if (!mem) {
          return { commandId: cmd.id, ok: false, status: 'error', message: 'Memory record not found.' };
        }
        if (typeof args.title === 'string') mem.title = args.title;
        if (typeof args.content === 'string') mem.content = args.content;
        mem.updatedAt = Date.now();
        data = { memory: mem };
        message = `Updated memory "${mem.title}".`;
        break;
      }

      case 'memory.pin': {
        if (this.pinnedMemoryIds.includes(cmd.target)) {
          this.pinnedMemoryIds = this.pinnedMemoryIds.filter((id) => id !== cmd.target);
        } else {
          this.pinnedMemoryIds.push(cmd.target);
        }
        data = { pinnedMemoryIds: this.pinnedMemoryIds };
        message = `Toggled pin for memory ${cmd.target}.`;
        break;
      }

      case 'memory.redact': {
        if (!this.redactedMemoryIds.includes(cmd.target)) {
          this.redactedMemoryIds.push(cmd.target);
        }
        const mem = this.store.memories.find((m) => m.id === cmd.target);
        if (mem) {
          mem.content = '[REDACTED BY OPERATOR POLICY]';
          mem.updatedAt = Date.now();
        }
        data = { redactedMemoryIds: this.redactedMemoryIds };
        message = `Redacted memory ${cmd.target}.`;
        break;
      }

      case 'memory.delete': {
        this.store.memories = this.store.memories.filter((m) => m.id !== cmd.target);
        data = { memories: this.store.memories };
        message = `Deleted memory ${cmd.target}.`;
        break;
      }

      case 'process.throttle':
      case 'process.kill':
      case 'scheduler.run': {
        const job = this.schedulerJobs.find((j) => j.id === cmd.target);
        if (job) {
          if (cmd.verb === 'process.throttle') job.status = 'throttled';
          else if (cmd.verb === 'process.kill') job.status = 'blocked';
          else {
            job.status = 'running';
            job.lastRunAt = Date.now();
            job.runCount += 1;
          }
        }
        data = { schedulerJobs: this.schedulerJobs };
        message = `${cmd.verb} applied to ${cmd.target}.`;
        break;
      }

      case 'workflow.save':
      case 'workflow.run': {
        const wf = args.workflow as WorkflowDefinition | undefined;
        if (wf) {
          const compiled = compileWorkflowToDag(wf, this.store.agents);
          if (compiled.errors.length > 0) {
            return { commandId: cmd.id, ok: false, status: 'error', message: compiled.errors.join(' ') };
          }
          wf.compiledTasks = compiled.tasks;
          wf.updatedAt = Date.now();
          const idx = this.workflows.findIndex((w) => w.id === wf.id);
          if (idx >= 0) this.workflows[idx] = wf;
          else this.workflows.unshift(wf);

          if (cmd.verb === 'workflow.run') {
            const proj: ProjectRecord = {
              id: `proj-wf-${Date.now()}`,
              title: `Workflow: ${wf.name}`,
              objective: `Compiled workflow v${wf.version}`,
              status: 'active',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              tasks: compiled.tasks,
              milestones: [{ id: 'm1', title: 'Workflow Compiled & Dispatched', completed: true }],
              teamAgentIds: Array.from(new Set(compiled.tasks.map((t) => t.assignedAgentId))),
            };
            this.store.projects.unshift(proj);
            this.store.emit({ type: 'project:updated', project: proj });
            data = { workflow: wf, project: proj, workflows: this.workflows };
            message = `Compiled and launched workflow "${wf.name}" (${compiled.tasks.length} tasks).`;
            break;
          }
          data = { workflow: wf, workflows: this.workflows };
          message = `Saved workflow "${wf.name}" v${wf.version}.`;
        }
        break;
      }

      case 'net.egress':
      case 'code.exec':
      case 'wallet.sign':
      case 'finance.approve': {
        this.store.pulseRegion('tool-bus', `Approved syscall ${cmd.verb}`);
        this.store.addActivity({
          agentId: 'agent-sentinel',
          agentName: cmd.actor,
          stage: 'Approved Syscall',
          tool: cmd.verb,
          message: `Executed approved ${cmd.verb} on ${cmd.target}.`,
          severity: 'success',
        });
        message = `Approved and executed ${cmd.verb} on ${cmd.target}.`;
        break;
      }

      case 'agent.chat': {
        const ag = this.findAgent(cmd.target) ?? this.store.agents[0];
        const prompt = String(args.message || '').trim();
        if (ag && prompt) {
          try {
            const res = await runAgentTurn({
              agentName: ag.name,
              agentRole: ag.role,
              personality: ag.personality,
              systemPrompt: ag.systemPrompt,
              memoriesText: '',
              userMessage: prompt,
            });
            this.traces.unshift({
              id: `trace-${Date.now()}`,
              timestamp: Date.now(),
              agentId: ag.id,
              agentName: ag.name,
              stage: 'HALO What-If / Voice',
              prompt,
              output: res.reply,
              model: ag.model,
              tokens: res.tokens,
              latencyMs: res.latencyMs,
              memoryIdsUsed: this.pinnedMemoryIds.slice(0, 2),
            });
            data = { reply: res.reply, tokens: res.tokens, latencyMs: res.latencyMs, traces: this.traces };
            message = res.reply;
          } catch (err) {
            return {
              commandId: cmd.id,
              ok: false,
              status: 'error',
              message: err instanceof Error ? err.message : 'Agent turn failed.',
            };
          }
        }
        break;
      }

      case 'memory.create': {
        const title = String(args.title || 'HALO Memory Note').trim();
        const content = String(args.content || '').trim();
        if (!content) {
          return { commandId: cmd.id, ok: false, status: 'error', message: 'Memory content is required.' };
        }
        const created = {
          id: `mem-${Date.now().toString(36)}`,
          scope: String(args.scope || 'central'),
          category: (args.category as any) || 'verified-fact',
          title,
          content,
          tags: Array.isArray(args.tags) ? (args.tags as string[]) : ['halo'],
          confidence: Number(args.confidence ?? 0.92),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.store.memories.unshift(created);
        this.store.pulseRegion('memory-lattice', `Stored: ${created.title}`);
        data = { memory: created, memories: this.store.memories };
        message = `Created memory "${created.title}".`;
        break;
      }

      case 'world.theme':
      case 'world.weather':
      case 'world.time':
      case 'world.physics':
      case 'world.teleport': {
        const activeFork = this.forks.find((f) => f.id === this.activeForkId);
        if (activeFork) {
          if (typeof args.theme === 'string') activeFork.theme = args.theme as any;
          if (typeof args.weather === 'string') activeFork.weather = args.weather as any;
          if (typeof args.timeOfDayHours === 'number') activeFork.timeOfDayHours = args.timeOfDayHours;
          if (typeof args.fogDensity === 'number') activeFork.fogDensity = args.fogDensity;
          if (typeof args.gravityScale === 'number') activeFork.gravityScale = args.gravityScale;
          if (typeof args.physicsTimeScale === 'number') activeFork.physicsTimeScale = args.physicsTimeScale;
        }
        data = { ...args, activeForkId: this.activeForkId };
        message = `Updated world state (${cmd.verb}).`;
        break;
      }

      default:
        message = `Syscall ${cmd.verb} acknowledged for ${cmd.target}.`;
        break;
    }

    const audit = this.appendAudit({
      id: cmd.id,
      actor: cmd.actor,
      target: cmd.target,
      verb: cmd.verb,
      argsSummary: JSON.stringify(args).slice(0, 140),
      status: 'executed',
    });

    this.store.pulseRegion('reasoning-cortex', `${cmd.verb} -> ${cmd.target}`);
    return {
      commandId: cmd.id,
      ok: true,
      status: 'executed',
      message,
      auditHash: audit.hash,
      undoCommand,
      data,
    };
  }

  public getSnapshot() {
    const verification = verifyAuditChain(this.auditChain);
    return {
      killSwitchActive: this.killSwitchActive,
      approvals: this.approvals,
      approvalGrants: this.approvalGrants,
      auditChain: this.auditChain,
      auditChainValid: verification.valid,
      injectionAlerts: this.injectionAlerts,
      zones: this.zones,
      snapshots: this.snapshots,
      forks: this.forks,
      activeForkId: this.activeForkId,
      schedulerJobs: this.schedulerJobs,
      traces: this.traces,
      workflows: this.workflows,
      pinnedMemoryIds: this.pinnedMemoryIds,
      redactedMemoryIds: this.redactedMemoryIds,
    };
  }
}
