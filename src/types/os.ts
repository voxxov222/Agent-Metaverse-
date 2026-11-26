export type EnvironmentTheme =
  | 'command-center'
  | 'tech-office'
  | 'outdoor-world'
  | 'neural-chamber'
  | 'holo-ops'
  | 'aether-district'
  | 'orbital-station'
  | 'alpine-observatory'
  | 'cyber-metropolis'
  | 'bioluminescent-canyon'
  | 'vcaos-nexus';

export type SkyboxPresetId =
  | 'theme-auto'
  | 'aether-twilight'
  | 'orbital-deep-space'
  | 'aurora-horizon'
  | 'golden-canyon'
  | 'cyber-neon-rain'
  | 'obsidian-studio';

export interface SkyboxConfig {
  enabled: boolean;
  preset: SkyboxPresetId;
  zenithColor: string;
  horizonColor: string;
  nadirColor: string;
  sunColor: string;
  sunElevation: number;
  sunAzimuth: number;
  sunSize: number;
  starDensity: number;
  auroraIntensity: number;
  cloudCoverage: number;
  nebulaHue: number;
  envIntensity: number;
  exposure: number;
}

export type WeatherMode = 'clear' | 'rain' | 'ion-storm';

export type CameraMode = 'orbit' | 'walk' | 'core-focus' | 'agent-focus' | 'rig-focus';

export type AutonomyLevel = 'ASSISTED' | 'SUPERVISED' | 'AUTONOMOUS';

export type AgentStatus = 'idle' | 'reasoning' | 'executing' | 'collaborating' | 'awaiting-approval' | 'error';

export type WorkspacePanel =
  | null
  | 'neural-link'
  | 'agents'
  | 'projects'
  | 'terminal'
  | 'telemetry'
  | 'integrations'
  | 'memory'
  | 'security'
  | 'prototype'
  | 'world'
  | 'jarvis'
  | 'live-voice'
  | 'vcaos';

export type NeuralRegionId =
  | 'reasoning-cortex'
  | 'memory-lattice'
  | 'planning-engine'
  | 'tool-bus'
  | 'security-gate';

export interface NeuralRegion {
  id: NeuralRegionId;
  name: string;
  role: string;
  color: string;
  load: number; // 0..100 measured or derived from active ops
  lastOperation: string;
  activeCount: number;
}

export interface AgentAppearance {
  chassisColor: string;
  accentColor: string;
  visorColor: string;
  wardrobeStyle: 'tactical-coat' | 'architect-robe' | 'chassis-shell' | 'executive-suit';
  expression: 'focused' | 'analytical' | 'alert' | 'calm';
  heightScale: number; // 0.85 .. 1.2
  shoulderWidth: number; // 0.85 .. 1.25
}

export interface AgentVoiceProfile {
  pitch: number; // 0.6 .. 1.5
  rate: number; // 0.75 .. 1.35
  style: string;
  preferredVoiceName?: string;
}

export interface AgentPermissions {
  terminalRead: boolean;
  terminalWrite: boolean;
  webBrowse: boolean;
  sendEmail: boolean;
  sendSms: boolean;
  makeCalls: boolean;
  codeDeploy: boolean;
  financialSpendLimitUsd: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  expertise: string[];
  personality: string;
  systemPrompt: string;
  model: 'gemini-4-hydrogen';
  autonomy: AutonomyLevel;
  status: AgentStatus;
  currentObjective: string;
  currentStage: string;
  position: [number, number, number];
  appearance: AgentAppearance;
  voice: AgentVoiceProfile;
  permissions: AgentPermissions;
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    tokensUsed: number;
    avgLatencyMs: number;
    activeTool?: string;
  };
  updatedAt: number;
}

export type TaskStatus = 'queued' | 'in-progress' | 'blocked' | 'awaiting-approval' | 'completed' | 'failed';

export interface ProjectTask {
  id: string;
  title: string;
  description: string;
  assignedAgentId: string;
  dependsOn: string[];
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
  output?: string;
  startedAt?: number;
  completedAt?: number;
  estimatedMinutes: number;
}

export interface ProjectRecord {
  id: string;
  title: string;
  objective: string;
  status: 'planning' | 'active' | 'awaiting-approval' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  tasks: ProjectTask[];
  milestones: { id: string; title: string; completed: boolean }[];
  finalReport?: string;
  teamAgentIds: string[];
}

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  agentId: string;
  agentName: string;
  stage: string;
  tool: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  tokens?: number;
  latencyMs?: number;
}

export interface MemoryItem {
  id: string;
  scope: 'central' | string; // 'central' or agentId
  category: 'verified-fact' | 'user-instruction' | 'agent-assumption' | 'external-research' | 'workflow-outcome';
  title: string;
  content: string;
  tags: string[];
  confidence: number; // 0..1
  createdAt: number;
  updatedAt: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  sourceRepo: string;
  permissions: string[];
  dependencies: string[];
  installed: boolean;
  enabled: boolean;
  healthStatus: 'healthy' | 'needs-config' | 'disabled';
  securityReviewed: boolean;
  updatedAt: number;
}

export interface IntegrationProvider {
  id: string;
  name: string;
  category: 'email' | 'telephony' | 'messaging' | 'browser' | 'vcs' | 'cloud';
  status: 'connected' | 'not-configured' | 'revoked';
  endpointLabel: string;
  notes: string;
  lastCheckedAt: number;
}

export interface OutboundCommDraft {
  id: string;
  channel: 'email' | 'sms' | 'voice-call';
  agentId: string;
  agentName: string;
  recipient: string;
  subject?: string;
  body: string;
  status: 'pending-approval' | 'dispatched' | 'rejected' | 'blocked-unconfigured';
  statusNote: string;
  createdAt: number;
}

export interface FinancialRequest {
  id: string;
  vendor: string;
  service: string;
  amountUsd: number;
  billingCycle: 'one-time' | 'monthly' | 'usage';
  requestedByAgentId: string;
  requestedByAgentName: string;
  rationale: string;
  status: 'pending-approval' | 'approved' | 'rejected';
  createdAt: number;
}

export interface SystemTelemetry {
  timestamp: number;
  sourceLabel: string;
  uptimeSeconds: number;
  hostCpuLoad1m: number;
  hostMemUsedMb: number;
  hostMemTotalMb: number;
  processRssMb: number;
  activeWsClients: number;
  activeAgents: number;
  idleAgents: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalAiCalls: number;
  totalTokensMeasured: number;
  avgAiLatencyMs: number;
  estimatedApiCostUsd: number;
  aiErrorCount: number;
  monthlyBudgetUsd: number;
  monthlyCommittedUsd: number;
  geminiConfigured: boolean;
}

export interface TelemetryHistoryPoint {
  timestamp: number;
  cpuLoad: number;
  memPct: number;
  tokensDelta: number;
  latencyMs: number;
}

export interface OfflineQueuedAction {
  id: string;
  type: 'create-agent' | 'update-agent' | 'create-memory' | 'queue-command' | 'update-budget';
  payload: unknown;
  createdAt: number;
}

export interface WorldPlayer {
  id: string;
  callsign: string;
  avatarColor: string;
  position: [number, number, number];
  yaw: number;
  emote: 'idle' | 'wave' | 'work' | 'focus';
  lastSeenAt: number;
}

export type WorldPropKind =
  | 'workstation-desk'
  | 'quantum-workstation'
  | 'mainframe-rack'
  | 'holo-terrain-table'
  | 'holo-hud-terminal'
  | 'arch-portal'
  | 'holo-kiosk'
  | 'relay-beacon'
  | 'data-monolith'
  | 'lounge-pod'
  | 'media-screen'
  | 'holo-billboard'
  | 'kinetic-sculpture'
  | 'quantum-crate';

export type PhysicsGravityPreset = 'earth' | 'lunar' | 'zero-g';

export type WorldObjectMotion = 'static' | 'hover' | 'orbit' | 'patrol' | 'spin';

export type ScreenMediaType = 'procedural' | 'image' | 'gif' | 'video';

export type ScreenProceduralPreset =
  | 'maya-os'
  | 'jarvis-core'
  | 'virtual-os'
  | 'matrix'
  | 'waveform'
  | 'radar'
  | 'neural-pulse';

export type JarvisOrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type JarvisHologramModelId = 'neural-lattice' | 'methane' | 'stark-gear' | 'network-topology';

export type JarvisDomainId =
  | 'core'
  | 'security'
  | 'engineering'
  | 'development'
  | 'finance'
  | 'science'
  | 'business'
  | 'medical';

export interface JarvisHologramConfig {
  model: JarvisHologramModelId;
  title: string;
  explodeFactor: number; // 0..1
  heatmap: boolean;
  customVertices?: Array<[number, number, number]>;
  customConnections?: Array<[number, number]>;
}

export interface JarvisReminder {
  id: string;
  title: string;
  dueAt: number;
  createdAt: number;
  fired: boolean;
}

export interface JarvisToast {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  createdAt: number;
}

export interface WorldObject {
  id: string;
  kind: WorldPropKind;
  label: string;
  position: [number, number, number];
  rotationY: number;
  color: string;
  ownerCallsign: string;
  motion?: WorldObjectMotion;
  scale?: number;
  mediaUrl?: string;
  mediaType?: ScreenMediaType;
  screenPreset?: ScreenProceduralPreset;
  createdAt: number;
  updatedAt: number;
}

export interface WorldChatMessage {
  id: string;
  senderId: string;
  callsign: string;
  text: string;
  position: [number, number, number];
  radius: number;
  timestamp: number;
}

export type RoadmapItemStatus =
  | 'completed'
  | 'in-development'
  | 'awaiting-credentials'
  | 'requires-backend-infra'
  | 'security-testing';

export interface RoadmapItem {
  id: string;
  milestone: string;
  title: string;
  status: RoadmapItemStatus;
  detail: string;
}

export type ServerWsEvent =
  | { type: 'telemetry:update'; telemetry: SystemTelemetry; regions: NeuralRegion[] }
  | { type: 'neural:pulse'; regionId: NeuralRegionId; fromAgentId?: string; toAgentId?: string; intensity: number; label: string }
  | { type: 'agent:updated'; agent: AgentProfile }
  | { type: 'project:updated'; project: ProjectRecord }
  | { type: 'activity:logged'; entry: ActivityLogEntry }
  | { type: 'comm:updated'; draft: OutboundCommDraft }
  | { type: 'finance:updated'; item: FinancialRequest }
  | { type: 'world:welcome'; selfId: string; players: WorldPlayer[]; objects: WorldObject[]; chat: WorldChatMessage[]; skybox?: SkyboxConfig }
  | { type: 'world:players'; players: WorldPlayer[] }
  | { type: 'world:objects'; objects: WorldObject[] }
  | { type: 'world:skybox'; skybox: SkyboxConfig }
  | { type: 'world:chat'; message: WorldChatMessage }
  | { type: 'jarvis:orb'; state: JarvisOrbState; label?: string }
  | { type: 'jarvis:hologram'; hologram: JarvisHologramConfig }
  | { type: 'jarvis:toast'; toast: JarvisToast }
  | { type: 'jarvis:reminder'; reminder: JarvisReminder }
  | { type: 'halo:state'; snapshot: Record<string, unknown> }
  | {
      type: 'halo:cursor';
      cursor: {
        actorId: string;
        callsign: string;
        color: string;
        x: number;
        y: number;
        activeModule: string;
        selectedTargetId: string | null;
        lamport: number;
        updatedAt: number;
      };
    };

export type ClientWsEvent =
  | { type: 'world:join'; callsign: string; avatarColor?: string; position?: [number, number, number] }
  | { type: 'world:move'; position: [number, number, number]; yaw: number }
  | { type: 'world:emote'; emote: WorldPlayer['emote'] }
  | { type: 'world:chat'; text: string; radius?: number }
  | {
      type: 'world:place-object';
      object: {
        id?: string;
        kind: WorldPropKind;
        label: string;
        position: [number, number, number];
        rotationY?: number;
        color?: string;
        ownerCallsign?: string;
        motion?: WorldObjectMotion;
        scale?: number;
        mediaUrl?: string;
        mediaType?: ScreenMediaType;
        screenPreset?: ScreenProceduralPreset;
      };
    }
  | { type: 'world:move-object'; id: string; position: [number, number, number]; rotationY?: number }
  | {
      type: 'world:update-object';
      id: string;
      patch: Partial<Pick<WorldObject, 'label' | 'color' | 'motion' | 'scale' | 'mediaUrl' | 'mediaType' | 'screenPreset' | 'rotationY' | 'position'>>;
    }
  | { type: 'world:remove-object'; id: string }
  | { type: 'world:skybox'; skybox: SkyboxConfig }
  | {
      type: 'halo:cursor';
      callsign: string;
      color: string;
      x: number;
      y: number;
      activeModule: string;
      selectedTargetId: string | null;
      lamport: number;
    };
