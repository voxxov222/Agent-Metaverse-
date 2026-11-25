import fs from 'fs';
import path from 'path';
import type {
  IntegrationProvider,
  RoadmapItem,
  ScreenMediaType,
  ScreenProceduralPreset,
  SkyboxConfig,
  WorldChatMessage,
  WorldObject,
  WorldObjectMotion,
  WorldPlayer,
  WorldPropKind,
} from '../types/os';
import {
  ALLOWED_MEDIA_TYPES,
  ALLOWED_MOTIONS,
  ALLOWED_PROP_KINDS,
  ALLOWED_SCREEN_PRESETS,
  DEFAULT_SKYBOX_CONFIG,
  sanitizeMediaUrl,
  sanitizeSkyboxConfig,
} from '../utils/worldEnhancements';

const WORKSPACE_ROOT = path.resolve(process.cwd(), '.vcalabs-workspace');
const WORLD_STATE_FILE = path.join(WORKSPACE_ROOT, '.aether-world.json');
export const MEDIA_STORAGE_DIR = path.join(WORKSPACE_ROOT, '.media');

function clampCoord(v: number, min = -42, max = 42): number {
  if (!Number.isFinite(v)) return 0;
  return Number(Math.max(min, Math.min(max, v)).toFixed(2));
}

function clampHeight(v: number, min = 0, max = 24): number {
  if (!Number.isFinite(v)) return 0;
  return Number(Math.max(min, Math.min(max, v)).toFixed(2));
}

function defaultStarterObjects(): WorldObject[] {
  const now = Date.now();
  return [
    {
      id: 'prop-beacon-east',
      kind: 'relay-beacon',
      label: 'Aether East Relay',
      position: [8.5, 0, -4.2],
      rotationY: 0.4,
      color: '#22d3ee',
      ownerCallsign: 'Architect-Root',
      motion: 'hover',
      scale: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-kiosk-west',
      kind: 'holo-kiosk',
      label: 'District Directory Terminal',
      position: [-8.2, 0, 3.8],
      rotationY: -0.65,
      color: '#38bdf8',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      mediaType: 'procedural',
      screenPreset: 'radar',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-desk-south',
      kind: 'workstation-desk',
      label: 'Co-Op Engineering Pod',
      position: [4.2, 0, 7.6],
      rotationY: Math.PI,
      color: '#a855f7',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      mediaType: 'procedural',
      screenPreset: 'matrix',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-holo-wall-north',
      kind: 'media-screen',
      label: 'Orbital Telemetry Display',
      position: [-5.8, 0, -6.5],
      rotationY: 0.45,
      color: '#22d3ee',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      mediaType: 'procedural',
      screenPreset: 'waveform',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-crate-stack-1',
      kind: 'quantum-crate',
      label: 'Quantum Storage Node A',
      position: [4.2, 1.4, 7.6],
      rotationY: 0.25,
      color: '#38bdf8',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-rig-west',
      kind: 'quantum-workstation',
      label: 'Operator Triple-Screen Rig',
      position: [-4.8, 0, 5.2],
      rotationY: 0.55,
      color: '#22d3ee',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      mediaType: 'procedural',
      screenPreset: 'virtual-os',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-holotable-east',
      kind: 'holo-terrain-table',
      label: 'Tactical Holo-Terrain Matrix',
      position: [5.2, 0, 3.6],
      rotationY: -0.35,
      color: '#38bdf8',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-mainframe-nw',
      kind: 'mainframe-rack',
      label: 'Aether Blade Supercomputer',
      position: [-8.4, 0, -3.2],
      rotationY: 0.9,
      color: '#a855f7',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-hud-ne',
      kind: 'holo-hud-terminal',
      label: 'Planetary Lock Holo-HUD',
      position: [7.8, 0, -1.2],
      rotationY: -0.95,
      color: '#22d3ee',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      mediaType: 'procedural',
      screenPreset: 'virtual-os',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'prop-arch-north',
      kind: 'arch-portal',
      label: 'North Sector Command Arch',
      position: [0, 0, -10.5],
      rotationY: 0,
      color: '#38bdf8',
      ownerCallsign: 'Architect-Root',
      motion: 'static',
      scale: 1,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export class WorldPresenceStore {
  public players = new Map<string, WorldPlayer>();
  public objects: WorldObject[] = [];
  public chat: WorldChatMessage[] = [];
  public skybox: SkyboxConfig = { ...DEFAULT_SKYBOX_CONFIG };

  constructor() {
    this.loadState();
  }

  private loadState(): void {
    try {
      if (!fs.existsSync(WORKSPACE_ROOT)) {
        fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
      }
      if (!fs.existsSync(MEDIA_STORAGE_DIR)) {
        fs.mkdirSync(MEDIA_STORAGE_DIR, { recursive: true });
      }
      if (fs.existsSync(WORLD_STATE_FILE)) {
        const raw = fs.readFileSync(WORLD_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw) as { objects?: WorldObject[]; skybox?: SkyboxConfig };
        if (parsed.skybox) {
          this.skybox = sanitizeSkyboxConfig(parsed.skybox);
        }
        if (Array.isArray(parsed.objects) && parsed.objects.length > 0) {
          this.objects = parsed.objects;
          return;
        }
      }
    } catch {
      // fall through to starter seed
    }
    this.objects = defaultStarterObjects();
    this.persistState();
  }

  private persistState(): void {
    try {
      if (!fs.existsSync(WORKSPACE_ROOT)) {
        fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
      }
      fs.writeFileSync(
        WORLD_STATE_FILE,
        JSON.stringify({ objects: this.objects, skybox: this.skybox }, null, 2),
        'utf8',
      );
    } catch {
      // Ignore transient FS errors
    }
  }

  public setSkybox(next: Partial<SkyboxConfig>): SkyboxConfig {
    this.skybox = sanitizeSkyboxConfig({ ...this.skybox, ...next });
    this.persistState();
    return this.skybox;
  }

  public joinPlayer(
    playerId: string,
    callsign?: string,
    avatarColor?: string,
    position?: [number, number, number],
  ): WorldPlayer {
    const cleanName = (callsign || `Operator-${playerId.slice(-4)}`).trim().slice(0, 24) || 'Operator';
    const cleanColor =
      typeof avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(avatarColor) ? avatarColor : '#38bdf8';
    const existing = this.players.get(playerId);
    const angle = (this.players.size * 1.4) % (Math.PI * 2);
    const defaultPos: [number, number, number] = [
      Number((Math.cos(angle) * 9.5).toFixed(2)),
      0,
      Number((Math.sin(angle) * 9.5).toFixed(2)),
    ];
    const player: WorldPlayer = {
      id: playerId,
      callsign: cleanName,
      avatarColor: cleanColor,
      position: position
        ? [clampCoord(position[0]), 0, clampCoord(position[2])]
        : existing?.position ?? defaultPos,
      yaw: existing?.yaw ?? 0,
      emote: existing?.emote ?? 'idle',
      lastSeenAt: Date.now(),
    };
    this.players.set(playerId, player);
    return player;
  }

  public movePlayer(
    playerId: string,
    position: [number, number, number],
    yaw: number,
  ): WorldPlayer | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.position = [clampCoord(position[0]), 0, clampCoord(position[2])];
    player.yaw = Number.isFinite(yaw) ? yaw : 0;
    player.lastSeenAt = Date.now();
    return player;
  }

  public setEmote(playerId: string, emote: WorldPlayer['emote']): WorldPlayer | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    if (emote === 'idle' || emote === 'wave' || emote === 'work' || emote === 'focus') {
      player.emote = emote;
      player.lastSeenAt = Date.now();
    }
    return player;
  }

  public removePlayer(playerId: string): boolean {
    return this.players.delete(playerId);
  }

  public getPlayerList(): WorldPlayer[] {
    return Array.from(this.players.values());
  }

  public addChatMessage(playerId: string, text: string, radius = 18): WorldChatMessage | null {
    const cleanText = text.trim().slice(0, 320);
    if (!cleanText) return null;
    const player = this.players.get(playerId);
    const msg: WorldChatMessage = {
      id: `wchat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderId: playerId,
      callsign: player?.callsign ?? 'Operator',
      text: cleanText,
      position: player?.position ?? [0, 0, 10],
      radius: Math.max(4, Math.min(60, radius)),
      timestamp: Date.now(),
    };
    this.chat.push(msg);
    if (this.chat.length > 60) {
      this.chat.shift();
    }
    return msg;
  }

  public placeObject(input: {
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
  }): WorldObject {
    const kind: WorldPropKind = ALLOWED_PROP_KINDS.has(input.kind) ? input.kind : 'holo-kiosk';
    const motion: WorldObjectMotion = input.motion && ALLOWED_MOTIONS.has(input.motion) ? input.motion : 'static';
    const mediaType: ScreenMediaType =
      input.mediaType && ALLOWED_MEDIA_TYPES.has(input.mediaType) ? input.mediaType : 'procedural';
    const screenPreset: ScreenProceduralPreset =
      input.screenPreset && ALLOWED_SCREEN_PRESETS.has(input.screenPreset) ? input.screenPreset : 'waveform';
    const scale =
      typeof input.scale === 'number' && Number.isFinite(input.scale)
        ? Number(Math.max(0.4, Math.min(3.0, input.scale)).toFixed(2))
        : 1;
    const now = Date.now();
    const obj: WorldObject = {
      id: input.id && typeof input.id === 'string' ? input.id.slice(0, 48) : `prop-${now}-${Math.random().toString(36).slice(2, 5)}`,
      kind,
      label: (input.label || kind).trim().slice(0, 40),
      position: [clampCoord(input.position[0]), clampHeight(input.position[1] ?? 0), clampCoord(input.position[2])],
      rotationY: Number.isFinite(input.rotationY) ? Number(input.rotationY) : 0,
      color: typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : '#22d3ee',
      ownerCallsign: (input.ownerCallsign || 'Operator').trim().slice(0, 24),
      motion,
      scale,
      mediaUrl: sanitizeMediaUrl(input.mediaUrl),
      mediaType,
      screenPreset,
      createdAt: now,
      updatedAt: now,
    };
    const existingIdx = this.objects.findIndex((o) => o.id === obj.id);
    if (existingIdx >= 0) {
      this.objects[existingIdx] = obj;
    } else {
      this.objects.push(obj);
    }
    this.persistState();
    return obj;
  }

  public moveObject(id: string, position: [number, number, number], rotationY?: number): WorldObject | null {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj) return null;
    obj.position = [clampCoord(position[0]), clampHeight(position[1] ?? 0), clampCoord(position[2])];
    if (typeof rotationY === 'number' && Number.isFinite(rotationY)) {
      obj.rotationY = Number(rotationY.toFixed(3));
    }
    obj.updatedAt = Date.now();
    this.persistState();
    return obj;
  }

  public updateObject(
    id: string,
    patch: Partial<
      Pick<
        WorldObject,
        'label' | 'color' | 'motion' | 'scale' | 'mediaUrl' | 'mediaType' | 'screenPreset' | 'rotationY' | 'position'
      >
    >,
  ): WorldObject | null {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj) return null;
    if (typeof patch.label === 'string' && patch.label.trim()) {
      obj.label = patch.label.trim().slice(0, 40);
    }
    if (typeof patch.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(patch.color)) {
      obj.color = patch.color;
    }
    if (patch.motion && ALLOWED_MOTIONS.has(patch.motion)) {
      obj.motion = patch.motion;
    }
    if (typeof patch.scale === 'number' && Number.isFinite(patch.scale)) {
      obj.scale = Number(Math.max(0.4, Math.min(3.0, patch.scale)).toFixed(2));
    }
    if (patch.mediaType && ALLOWED_MEDIA_TYPES.has(patch.mediaType)) {
      obj.mediaType = patch.mediaType;
    }
    if (patch.screenPreset && ALLOWED_SCREEN_PRESETS.has(patch.screenPreset)) {
      obj.screenPreset = patch.screenPreset;
    }
    if ('mediaUrl' in patch) {
      obj.mediaUrl = sanitizeMediaUrl(patch.mediaUrl);
    }
    if (typeof patch.rotationY === 'number' && Number.isFinite(patch.rotationY)) {
      obj.rotationY = Number(patch.rotationY.toFixed(3));
    }
    if (Array.isArray(patch.position) && patch.position.length >= 3) {
      obj.position = [
        clampCoord(patch.position[0]),
        clampHeight(patch.position[1] ?? 0),
        clampCoord(patch.position[2]),
      ];
    }
    obj.updatedAt = Date.now();
    this.persistState();
    return obj;
  }

  public removeObject(id: string): boolean {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx === -1) return false;
    this.objects.splice(idx, 1);
    this.persistState();
    return true;
  }
}

export function buildImplementationRoadmap(
  integrations: IntegrationProvider[],
  vaultClaimed: boolean,
  geminiConfigured: boolean,
): RoadmapItem[] {
  const emailConnected = integrations.some((i) => i.id === 'int-email' && i.status === 'connected');
  const telConnected = integrations.some((i) => i.id === 'int-telephony' && i.status === 'connected');

  return [
    // Completed Functionality
    {
      id: 'rm-m1-world',
      milestone: 'M1',
      title: 'Hyper-Realistic 3D Environments, Skybox Creator & Camera Controls',
      status: 'completed',
      detail: '10 switchable 3D themes (including Orbital Station, Alpine Observatory, Cyber Metropolis, Bio-Lum Canyon), live GLSL Skybox Creator with PMREM reflections, and orbit/walk/touch controls.',
    },
    {
      id: 'rm-m1-multiplayer',
      milestone: 'M1',
      title: 'WebSocket Multiplayer Presence, Avatars & Proximity Chat',
      status: 'completed',
      detail: 'Real-time /ws player roster sync, grounded 3D human avatars with callsigns & emotes, plus distance-aware spatial chat.',
    },
    {
      id: 'rm-m1-build',
      milestone: 'M1',
      title: 'Touch-Hold Object Dragging, Animated Screens & Media Upload',
      status: 'completed',
      detail: 'Direct touch-hold/pointer drag & snap placement in 3D, animated kinetic modes, procedural screen shaders, and Image/GIF/Video screen uploads.',
    },
    {
      id: 'rm-neural-viz',
      milestone: 'M1',
      title: 'NeuralNetworkViz Engine & Live Kernel Bus Wiring',
      status: 'completed',
      detail: 'Instanced 3D graph shaders, synaptic pulses, compound activity parsing, BFS hop propagation, raycast inspection, and live /ws binding.',
    },
    {
      id: 'rm-os-core',
      milestone: 'Core',
      title: 'Sandboxed Terminal, AES-256-GCM Vault & Offline Sync',
      status: 'completed',
      detail: 'Isolated command shell, workspace file editor, IndexedDB offline action queue, and encrypted credential storage.',
    },

    // Currently Being Developed
    {
      id: 'rm-m2-autonomy',
      milestone: 'M2',
      title: 'Autonomous Agent Perception & Spatial Navigation',
      status: 'in-development',
      detail: 'Scheduled next after M1 sign-off: agent pathing between world workstations, shared blackboard goals, and proactive background ticks.',
    },
    {
      id: 'rm-m3-studio',
      milestone: 'M3',
      title: 'In-World Multi-User Collaborative Code & Workflow Canvas',
      status: 'in-development',
      detail: 'Live shared cursor collaboration inside the sandbox IDE and node-based task graph builder.',
    },

    // Awaiting External API Credentials
    {
      id: 'rm-cred-gemini',
      milestone: 'Creds',
      title: 'Gemini AI Reasoning Gateway (GEMINI_API_KEY)',
      status: geminiConfigured ? 'completed' : 'awaiting-credentials',
      detail: geminiConfigured
        ? 'GEMINI_API_KEY detected in runtime environment; Central Intelligence and Agent chat are live.'
        : 'Set GEMINI_API_KEY in AI Studio Secrets to enable live Central Intelligence, project planning, and AI coding.',
    },
    {
      id: 'rm-cred-email',
      milestone: 'Creds',
      title: 'Outbound Email Dispatch Provider (EMAIL_WEBHOOK_URL)',
      status: emailConnected ? 'completed' : 'awaiting-credentials',
      detail: emailConnected
        ? 'Email dispatch endpoint configured and active.'
        : 'Approval-gated draft queue works now; real delivery awaits EMAIL_WEBHOOK_URL or Vault token.',
    },
    {
      id: 'rm-cred-telephony',
      milestone: 'Creds',
      title: 'SMS & Voice Telephony Provider (TELEPHONY_WEBHOOK_URL)',
      status: telConnected ? 'completed' : 'awaiting-credentials',
      detail: telConnected
        ? 'Telephony endpoint configured and active.'
        : 'Approval-gated SMS/call drafts queue cleanly; real carrier dispatch awaits Twilio/webhook credentials.',
    },

    // Requiring Backend Infrastructure
    {
      id: 'rm-infra-cluster',
      milestone: 'M4',
      title: 'Distributed State Store (PostgreSQL + Redis Pub/Sub)',
      status: 'requires-backend-infra',
      detail: 'Current world & OS state uses local workspace storage + single-node memory; multi-instance horizontal scaling requires Cloud SQL / Redis.',
    },
    {
      id: 'rm-infra-webrtc',
      milestone: 'M5',
      title: 'WebRTC SFU Spatial Voice & Screen-Share Channels',
      status: 'requires-backend-infra',
      detail: 'Real-time spatial audio streams between operators require a dedicated TURN/SFU media server.',
    },
    {
      id: 'rm-infra-billing',
      milestone: 'M6',
      title: 'Automated Cloud Procurement & Virtual Card Rails',
      status: 'requires-backend-infra',
      detail: 'Budget approval ledger is operational; live automated vendor checkout requires Stripe Issuing / cloud billing APIs.',
    },

    // Outstanding Security & Testing Requirements
    {
      id: 'rm-sec-rbac',
      milestone: 'Sec',
      title: 'Multi-Tenant OAuth2 / OIDC Identity & Per-Room ACLs',
      status: vaultClaimed ? 'security-testing' : 'security-testing',
      detail: `Passcode vault lock is ${vaultClaimed ? 'claimed' : 'unclaimed'}; production multi-tenant deployment requires OIDC SSO, JWT rotation, and per-object ACLs.`,
    },
    {
      id: 'rm-test-soak',
      milestone: 'QA',
      title: 'Multi-Client WebSocket Soak & Fuzz Test Suite',
      status: 'security-testing',
      detail: 'Unit tests cover orchestrator logic and NeuralNetworkViz activity engine; high-concurrency multi-client WS load tests remain.',
    },
  ];
}
