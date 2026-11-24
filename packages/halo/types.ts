import type {
  ActivityLogEntry,
  AgentProfile,
  EnvironmentTheme,
  FinancialRequest,
  IntegrationProvider,
  MemoryItem,
  NeuralRegion,
  OutboundCommDraft,
  PluginManifest,
  ProjectRecord,
  ProjectTask,
  SystemTelemetry,
  TelemetryHistoryPoint,
  WeatherMode,
  WorldChatMessage,
  WorldObject,
  WorldPlayer,
} from '../../src/types/os';

export type HaloFormFactor = 'flat' | 'wrist' | 'dome' | 'table' | 'shared';

export type HaloThemeId =
  | 'cyan-ops'
  | 'amber-terminal'
  | 'violet-neural'
  | 'stealth-red'
  | 'high-contrast'
  | 'custom';

export interface HaloThemePalette {
  id: HaloThemeId;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  danger: string;
  bgSurface: string;
  bgPanel: string;
  border: string;
  textPrimary: string;
  textMuted: string;
  scanlineOpacity: number;
}

export type HaloModuleId =
  | 'agent-ring'
  | 'mission-control'
  | 'voice-comms'
  | 'environment-deck'
  | 'process-monitor'
  | 'memory-atlas'
  | 'security-approvals'
  | 'telemetry-insight'
  | 'automation-studio'
  | 'multiverse';

export type HaloLayoutPresetId = 'dev-mode' | 'ops-mode' | 'build-mode' | 'cinematic';

export type CommandRiskLevel = 'low' | 'medium' | 'risky' | 'critical';

export type CommandVerb =
  | 'agent.spawn'
  | 'agent.clone'
  | 'agent.pause'
  | 'agent.resume'
  | 'agent.kill'
  | 'agent.update'
  | 'agent.chat'
  | 'agent.permission.grant'
  | 'agent.permission.revoke'
  | 'task.assign'
  | 'task.create'
  | 'task.split'
  | 'task.merge'
  | 'task.retry'
  | 'task.cancel'
  | 'task.dependency.add'
  | 'project.plan'
  | 'project.approve'
  | 'world.theme'
  | 'world.weather'
  | 'world.time'
  | 'world.physics'
  | 'world.teleport'
  | 'world.object.place'
  | 'world.object.move'
  | 'world.object.delete'
  | 'world.zone.create'
  | 'world.zone.delete'
  | 'world.snapshot.save'
  | 'world.snapshot.restore'
  | 'world.fork.create'
  | 'world.fork.switch'
  | 'world.fork.merge'
  | 'world.fork.discard'
  | 'memory.create'
  | 'memory.edit'
  | 'memory.pin'
  | 'memory.redact'
  | 'memory.delete'
  | 'process.throttle'
  | 'process.kill'
  | 'scheduler.run'
  | 'workflow.save'
  | 'workflow.run'
  | 'finance.approve'
  | 'net.egress'
  | 'code.exec'
  | 'wallet.sign'
  | 'system.killswitch'
  | 'system.resume'
  | 'hud.formfactor'
  | 'hud.module'
  | 'hud.theme';

export interface HaloCommand {
  id: string;
  actor: string;
  target: string;
  verb: CommandVerb | string;
  args: Record<string, unknown>;
  requiresApproval: boolean;
  riskLevel?: CommandRiskLevel;
  timestamp: number;
  undoable?: boolean;
}

export interface CommandResult {
  commandId: string;
  ok: boolean;
  status: 'executed' | 'pending-approval' | 'denied' | 'error';
  message: string;
  approvalId?: string;
  auditHash?: string;
  undoCommand?: HaloCommand;
  data?: Record<string, unknown>;
}

export interface AuditChainEntry {
  seq: number;
  id: string;
  timestamp: number;
  actor: string;
  target: string;
  verb: string;
  argsSummary: string;
  status: 'executed' | 'queued-approval' | 'approved' | 'denied' | 'error';
  prevHash: string;
  hash: string;
}

export interface ApprovalRequest {
  id: string;
  command: HaloCommand;
  category: 'network-egress' | 'deletion' | 'spending' | 'code-execution' | 'wallet-signing' | 'agent-termination';
  summary: string;
  diffPreview: string;
  status: 'pending' | 'approved' | 'denied';
  decisionScope?: 'once' | 'always-1h' | 'always-24h';
  decidedBy?: string;
  decidedAt?: number;
  createdAt: number;
}

export interface ApprovalGrant {
  id: string;
  verb: string;
  target: string;
  grantedBy: string;
  expiresAt: number;
}

export interface PromptInjectionAlert {
  id: string;
  source: string;
  excerpt: string;
  detectedPattern: string;
  severity: 'medium' | 'high';
  timestamp: number;
}

export interface WorldZone {
  id: string;
  name: string;
  center: [number, number, number];
  radius: number;
  color: string;
  rule: 'read-only-fs' | 'no-code-exec' | 'approval-required' | 'sandbox-boost';
  createdBy: string;
  createdAt: number;
}

export interface WorldSnapshot {
  id: string;
  name: string;
  theme: EnvironmentTheme;
  weather: WeatherMode;
  timeOfDayHours: number;
  objectCount: number;
  objects: WorldObject[];
  zones: WorldZone[];
  createdBy: string;
  createdAt: number;
}

export interface WorldFork {
  id: string;
  name: string;
  parentId: string | null;
  status: 'active' | 'merged' | 'discarded';
  theme: EnvironmentTheme;
  weather: WeatherMode;
  timeOfDayHours: number;
  fogDensity: number;
  gravityScale: number;
  physicsTimeScale: number;
  objects: WorldObject[];
  zones: WorldZone[];
  createdBy: string;
  createdAt: number;
}

export interface SchedulerJob {
  id: string;
  name: string;
  triggerType: 'cron' | 'event' | 'manual';
  scheduleExpr: string;
  status: 'queued' | 'running' | 'blocked' | 'throttled' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'critical';
  targetAgentId: string;
  cpuPct: number;
  memMb: number;
  netKbps: number;
  lastRunAt?: number;
  runCount: number;
}

export interface TraceStep {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  stage: string;
  prompt: string;
  output: string;
  model: string;
  tokens: number;
  latencyMs: number;
  memoryIdsUsed: string[];
}

export interface WorkflowNode {
  id: string;
  kind: 'trigger' | 'agent' | 'tool' | 'condition' | 'loop' | 'approval';
  label: string;
  agentId?: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  schedule: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  compiledTasks: ProjectTask[];
  updatedAt: number;
}

export interface SharedCursorState {
  actorId: string;
  callsign: string;
  color: string;
  x: number; // 0..1 normalized viewport
  y: number;
  activeModule: HaloModuleId;
  selectedTargetId: string | null;
  lamport: number;
  updatedAt: number;
}

export interface HaloPanelState3D {
  id: string;
  moduleId: HaloModuleId;
  title: string;
  position: [number, number, number];
  rotationY: number;
  minimized: boolean;
  pinned: boolean;
}

export interface HaloLayoutConfig {
  preset: HaloLayoutPresetId;
  formFactor: HaloFormFactor;
  themeId: HaloThemeId;
  customPalette?: Partial<HaloThemePalette>;
  audioEnabled: boolean;
  hapticsEnabled: boolean;
  pinnedModules: HaloModuleId[];
  hotkeys: Record<string, string>;
}

export interface HaloPluginModuleManifest {
  id: string;
  title: string;
  description: string;
  requiredVerb: CommandVerb | string;
  renderSummary: () => string;
}

export interface HaloNormalizedState {
  isOpen: boolean;
  paletteOpen: boolean;
  wristOpen: boolean;
  activeModule: HaloModuleId;
  formFactor: HaloFormFactor;
  layout: HaloLayoutConfig;
  killSwitchActive: boolean;
  selectedAgentIds: string[];
  selectedTaskId: string | null;
  recordingMacro: boolean;
  macroCommands: HaloCommand[];
  undoStack: HaloCommand[];
  agents: AgentProfile[];
  projects: ProjectRecord[];
  activityLogs: ActivityLogEntry[];
  memories: MemoryItem[];
  pinnedMemoryIds: string[];
  redactedMemoryIds: string[];
  plugins: PluginManifest[];
  integrations: IntegrationProvider[];
  commDrafts: OutboundCommDraft[];
  financialRequests: FinancialRequest[];
  regions: NeuralRegion[];
  telemetry: SystemTelemetry | null;
  telemetryHistory: TelemetryHistoryPoint[];
  worldPlayers: WorldPlayer[];
  worldObjects: WorldObject[];
  worldChat: WorldChatMessage[];
  zones: WorldZone[];
  snapshots: WorldSnapshot[];
  forks: WorldFork[];
  activeForkId: string;
  approvals: ApprovalRequest[];
  approvalGrants: ApprovalGrant[];
  auditChain: AuditChainEntry[];
  auditChainValid: boolean;
  injectionAlerts: PromptInjectionAlert[];
  schedulerJobs: SchedulerJob[];
  traces: TraceStep[];
  workflows: WorkflowDefinition[];
  sharedCursors: Record<string, SharedCursorState>;
  panels3D: HaloPanelState3D[];
  lastCommandResult: CommandResult | null;
  glitchPulseAt: number;
}
