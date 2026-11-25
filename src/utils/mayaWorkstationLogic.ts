import type { AgentProfile, NeuralRegionId } from '../types/os';

export type MetricColorTier = 'optimal' | 'elevated' | 'critical';

export function getMetricColorTier(value: number): {
  tier: MetricColorTier;
  hex: string;
  textClass: string;
  barClass: string;
} {
  if (value < 50) {
    return {
      tier: 'optimal',
      hex: '#00ff64',
      textClass: 'text-[#00ff64]',
      barClass: 'from-emerald-600 via-emerald-400 to-[#00ff64]',
    };
  }
  if (value < 80) {
    return {
      tier: 'elevated',
      hex: '#ffc800',
      textClass: 'text-[#ffc800]',
      barClass: 'from-amber-600 via-amber-400 to-[#ffc800]',
    };
  }
  return {
    tier: 'critical',
    hex: '#ff3232',
    textClass: 'text-[#ff3232]',
    barClass: 'from-rose-700 via-rose-500 to-[#ff3232]',
  };
}

export interface MayaParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
}

const MAYA_PARTICLE_COLORS = [
  'rgba(255, 100, 200, 0.8)',
  'rgba(100, 200, 255, 0.8)',
  'rgba(200, 100, 255, 0.8)',
  'rgba(255, 255, 255, 0.8)',
  'rgba(100, 255, 200, 0.8)',
  'rgba(0, 255, 255, 0.8)',
];

export function createMayaParticles(count: number, width: number, height: number): MayaParticle[] {
  const safeW = Math.max(100, width);
  const safeH = Math.max(100, height);
  const out: MayaParticle[] = [];
  for (let i = 0; i < count; i++) {
    const life = 0.5 + Math.random() * 0.5;
    out.push({
      x: Math.random() * safeW,
      y: Math.random() * safeH,
      vx: (Math.random() * 2 - 1) * 0.9,
      vy: (Math.random() * 2 - 1) * 0.9,
      size: 1 + Math.random() * 2,
      life,
      maxLife: life,
      color: MAYA_PARTICLE_COLORS[i % MAYA_PARTICLE_COLORS.length],
    });
  }
  return out;
}

export function stepMayaParticles(
  particles: MayaParticle[],
  width: number,
  height: number,
  speedScale = 1,
): void {
  const safeW = Math.max(100, width);
  const safeH = Math.max(100, height);
  for (const p of particles) {
    p.x += p.vx * speedScale;
    p.y += p.vy * speedScale;
    p.life -= 0.008 * speedScale;

    if (p.x < 0) p.x = safeW;
    else if (p.x > safeW) p.x = 0;

    if (p.y < 0) p.y = safeH;
    else if (p.y > safeH) p.y = 0;

    if (p.life <= 0) {
      p.life = p.maxLife;
      p.x = Math.random() * safeW;
      p.y = Math.random() * safeH;
    }
  }
}

export type ParsedWorkstationCommand =
  | { kind: 'terminal'; command: string }
  | { kind: 'agent'; agent: AgentProfile; prompt: string }
  | { kind: 'project'; objective: string }
  | { kind: 'halo'; commandText: string }
  | { kind: 'focus-region'; regionId: NeuralRegionId }
  | { kind: 'central'; prompt: string };

const REGION_ALIASES: Record<string, NeuralRegionId> = {
  reasoning: 'reasoning-cortex',
  cortex: 'reasoning-cortex',
  memory: 'memory-lattice',
  planning: 'planning-engine',
  tool: 'tool-bus',
  tools: 'tool-bus',
  security: 'security-gate',
};

export function parseWorkstationCommand(
  rawInput: string,
  agents: AgentProfile[],
): ParsedWorkstationCommand {
  const trimmed = rawInput.trim();
  if (trimmed.startsWith('/exec ') || trimmed.startsWith('$ ')) {
    const command = trimmed.startsWith('/exec ') ? trimmed.slice(6).trim() : trimmed.slice(2).trim();
    return { kind: 'terminal', command };
  }

  if (trimmed.startsWith('/project ')) {
    return { kind: 'project', objective: trimmed.slice(9).trim() };
  }

  if (trimmed.startsWith('/halo ')) {
    return { kind: 'halo', commandText: trimmed.slice(6).trim() };
  }

  if (trimmed.startsWith('/focus ')) {
    const token = trimmed.slice(7).trim().toLowerCase();
    const mapped = REGION_ALIASES[token] ?? 'reasoning-cortex';
    return { kind: 'focus-region', regionId: mapped };
  }

  if (trimmed.startsWith('@')) {
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx > 1) {
      const targetName = trimmed.slice(1, spaceIdx).toLowerCase();
      const body = trimmed.slice(spaceIdx + 1).trim();
      const matched = agents.find(
        (a) =>
          a.id.toLowerCase() === targetName ||
          a.name.toLowerCase().includes(targetName) ||
          a.name.toLowerCase().replace(/\s+/g, '') === targetName,
      );
      if (matched && body) {
        return { kind: 'agent', agent: matched, prompt: body };
      }
    }
  }

  return { kind: 'central', prompt: trimmed };
}

export interface LocalWorkstationPrefs {
  aiCoreName: string;
  adminLocked: boolean;
  autoSpeak: boolean;
  particlesEnabled: boolean;
  ownerLabel: string;
  pinnedPropId: string;
}

export const DEFAULT_LOCAL_WORKSTATION_PREFS: LocalWorkstationPrefs = {
  aiCoreName: 'MAYA',
  adminLocked: false,
  autoSpeak: false,
  particlesEnabled: true,
  ownerLabel: 'vcaslabs@gmail.com',
  pinnedPropId: 'prop-rig-west',
};

const STORAGE_KEY = 'vca_admin_maya_workstation_v1';

export function loadLocalWorkstationPrefs(): LocalWorkstationPrefs {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_LOCAL_WORKSTATION_PREFS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LOCAL_WORKSTATION_PREFS };
    const parsed = JSON.parse(raw) as Partial<LocalWorkstationPrefs>;
    return {
      aiCoreName:
        typeof parsed.aiCoreName === 'string' && parsed.aiCoreName.trim()
          ? parsed.aiCoreName.trim().slice(0, 18)
          : DEFAULT_LOCAL_WORKSTATION_PREFS.aiCoreName,
      adminLocked: Boolean(parsed.adminLocked),
      autoSpeak: Boolean(parsed.autoSpeak),
      particlesEnabled: parsed.particlesEnabled !== false,
      ownerLabel:
        typeof parsed.ownerLabel === 'string' && parsed.ownerLabel.trim()
          ? parsed.ownerLabel.trim().slice(0, 48)
          : DEFAULT_LOCAL_WORKSTATION_PREFS.ownerLabel,
      pinnedPropId:
        typeof parsed.pinnedPropId === 'string' && parsed.pinnedPropId.trim()
          ? parsed.pinnedPropId.trim()
          : DEFAULT_LOCAL_WORKSTATION_PREFS.pinnedPropId,
    };
  } catch {
    return { ...DEFAULT_LOCAL_WORKSTATION_PREFS };
  }
}

export function saveLocalWorkstationPrefs(prefs: LocalWorkstationPrefs): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota errors
  }
}
