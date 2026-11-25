import type { JarvisDomainId, JarvisHologramModelId, JarvisOrbState } from '../types/os';

export interface JarvisDomainSpec {
  id: JarvisDomainId;
  label: string;
  modelTag: string;
  description: string;
  neuralRegion: 'reasoning-cortex' | 'memory-lattice' | 'planning-engine' | 'tool-bus' | 'security-gate';
}

export const JARVIS_DOMAINS: JarvisDomainSpec[] = [
  {
    id: 'core',
    label: 'JARVIS Core',
    modelTag: 'Main Brain',
    description: 'Central Command orchestrator for multi-step English & Hinglish directives.',
    neuralRegion: 'reasoning-cortex',
  },
  {
    id: 'security',
    label: 'Security',
    modelTag: 'ShieldGemma / Audit',
    description: 'Sentry firewall, vault posture, prompt-injection & subnet threat analysis.',
    neuralRegion: 'security-gate',
  },
  {
    id: 'engineering',
    label: 'Engineering',
    modelTag: 'CAD & Kinematics',
    description: '3D structural geometry, mechanical assemblies, and physical simulation.',
    neuralRegion: 'planning-engine',
  },
  {
    id: 'development',
    label: 'Development',
    modelTag: 'Polyglot Dev',
    description: 'Sandbox code execution, build health, repository & workspace tooling.',
    neuralRegion: 'tool-bus',
  },
  {
    id: 'finance',
    label: 'Finance',
    modelTag: 'Market & Cap',
    description: 'Cloud spend limits, ROI analysis, and approval governance.',
    neuralRegion: 'planning-engine',
  },
  {
    id: 'science',
    label: 'Science',
    modelTag: 'Molecular & Physics',
    description: 'Molecular orbital simulations, chemistry models, and empirical computation.',
    neuralRegion: 'memory-lattice',
  },
  {
    id: 'business',
    label: 'Business',
    modelTag: 'Strategy Ops',
    description: 'Executive planning, communications triage, and milestone tracking.',
    neuralRegion: 'planning-engine',
  },
  {
    id: 'medical',
    label: 'Biometrics',
    modelTag: 'Vital Sentinel',
    description: 'Operator cognitive focus tracking, ergonomics, and alert pacing.',
    neuralRegion: 'memory-lattice',
  },
];

export const JARVIS_ORB_COLORS: Record<
  JarvisOrbState,
  { label: string; inner: string; outer: string; badgeClass: string; tooltip: string }
> = {
  idle: {
    label: 'IDLE // READY',
    inner: '#00d2ff',
    outer: '#0ea5e9',
    badgeClass: 'text-cyan-300 border-cyan-400/60 bg-cyan-500/15',
    tooltip: 'JARVIS — Idle & Ready',
  },
  listening: {
    label: 'LISTENING',
    inner: '#10b981',
    outer: '#34d399',
    badgeClass: 'text-emerald-300 border-emerald-400/60 bg-emerald-500/15',
    tooltip: 'JARVIS — Listening to operator voice',
  },
  thinking: {
    label: 'PROCESSING',
    inner: '#a855f7',
    outer: '#c084fc',
    badgeClass: 'text-purple-300 border-purple-400/60 bg-purple-500/15',
    tooltip: 'JARVIS — Processing directive',
  },
  speaking: {
    label: 'TRANSMITTING',
    inner: '#38bdf8',
    outer: '#fde047',
    badgeClass: 'text-amber-200 border-amber-400/60 bg-amber-500/15',
    tooltip: 'JARVIS — Vocalizing briefing',
  },
  error: {
    label: 'ALERT',
    inner: '#f43f5e',
    outer: '#fb7185',
    badgeClass: 'text-rose-300 border-rose-400/60 bg-rose-500/15',
    tooltip: 'JARVIS — System warning detected',
  },
};

export type ParsedJarvisIntent =
  | { kind: 'diagnostics' }
  | { kind: 'network-scan' }
  | { kind: 'hologram'; model: JarvisHologramModelId; explode?: number; heatmap?: boolean }
  | { kind: 'reminder'; title: string; delayMs: number }
  | { kind: 'sandbox-exec'; command: string }
  | { kind: 'domain-query'; domain: JarvisDomainId; prompt: string; chainedSteps?: string[] };

/**
 * Port of darshitp091/Jarvis bilingual English + Hinglish intent router & multi-step splitter.
 */
export function parseJarvisIntent(rawPrompt: string, defaultDomain: JarvisDomainId = 'core'): ParsedJarvisIntent {
  const prompt = rawPrompt.trim();
  const lower = prompt.toLowerCase();

  // Check explicit diagnostics / vitals / stark sweep
  if (
    /\b(stark diagnostics|diagnostics|system vitals|vitals check|cpu ram|health sweep|system check|arc reactor)\b/.test(
      lower,
    ) ||
    /(system|laptop|server).*(check|status|kaisa)/.test(lower)
  ) {
    return { kind: 'diagnostics' };
  }

  // Check subnet / network topology scan (network_mapper.py)
  if (/\b(network map|scan subnet|network topology|scan network|ip topology|ping subnet)\b/.test(lower)) {
    return { kind: 'network-scan' };
  }

  // Check hologram projection controls (hologram.py + engineering.py)
  if (/\b(hologram|methane|gear assembly|stark gear|wireframe|explode hologram|heatmap)\b/.test(lower)) {
    let model: JarvisHologramModelId = 'neural-lattice';
    if (/\bmethane\b/.test(lower)) model = 'methane';
    else if (/\bgear\b/.test(lower)) model = 'stark-gear';
    else if (/\b(network|subnet|topology)\b/.test(lower)) model = 'network-topology';
    const explode = /\b(explode|expand|separate)\b/.test(lower)
      ? 0.75
      : /\b(collapse|assemble|reset)\b/.test(lower)
        ? 0
        : undefined;
    const heatmap = /\bheatmap\b/.test(lower) ? !/\b(off|disable)\b/.test(lower) : undefined;
    return { kind: 'hologram', model, explode, heatmap };
  }

  // Check reminder / scheduler command (services/timeparse.py)
  const remMatch = prompt.match(/^(?:remind(?:er)?(?:\s+me)?(?:\s+to)?|schedule(?:\s+alert)?)\s+(.+)$/i);
  if (remMatch) {
    const delayMs = parseReminderDelayMs(remMatch[1]);
    if (delayMs > 0) {
      const cleanedTitle = remMatch[1]
        .replace(/\b(?:in|after)\s+\d+\s*(?:s|sec|secs|seconds|m|min|mins|minutes|h|hr|hours)\b/i, '')
        .replace(/\bat\s+\d{1,2}:\d{2}\b/i, '')
        .replace(/^to\s+/i, '')
        .trim();
      return {
        kind: 'reminder',
        title: cleanedTitle || 'JARVIS Scheduled Briefing',
        delayMs,
      };
    }
  }

  // Sandbox command passthrough
  if (/^(\/exec\s+|run shell\s+|cmd:\s*)/i.test(prompt)) {
    return {
      kind: 'sandbox-exec',
      command: prompt.replace(/^(\/exec\s+|run shell\s+|cmd:\s*)/i, '').trim(),
    };
  }

  // Hinglish / English multi-step chaining ("pehle X, phir Y" or "then")
  const chained = prompt
    .split(/\s*(?:,\s*phir\s+|\s+phir\s+|\s+and then\s+|\s+then\s+)\s*/i)
    .map((s) => s.replace(/^pehle\s+/i, '').trim())
    .filter(Boolean);

  // Domain classification
  let domain: JarvisDomainId = defaultDomain;
  if (/\b(security|firewall|audit|vulnerability|threat|intrusion)\b/.test(lower)) domain = 'security';
  else if (/\b(gear|torque|cad|structural|mechanical|engineering)\b/.test(lower)) domain = 'engineering';
  else if (/\b(code|typescript|bug|repo|compile|build|git)\b/.test(lower)) domain = 'development';
  else if (/\b(budget|finance|spend|cost|market|revenue)\b/.test(lower)) domain = 'finance';
  else if (/\b(molecule|quantum|physics|chemistry|experiment)\b/.test(lower)) domain = 'science';
  else if (/\b(roadmap|strategy|client|business|pitch)\b/.test(lower)) domain = 'business';
  else if (/\b(biometric|focus|posture|fatigue|blink|health)\b/.test(lower)) domain = 'medical';

  return {
    kind: 'domain-query',
    domain,
    prompt,
    chainedSteps: chained.length > 1 ? chained : undefined,
  };
}

/**
 * Natural relative & clock reminder parser (adapted from jarvis/services/timeparse.py).
 */
export function parseReminderDelayMs(text: string, nowMs = Date.now()): number {
  const relMatch = text.match(/\b(?:in|after)\s+(\d+)\s*(s|sec|secs|seconds|m|min|mins|minutes|h|hr|hours)\b/i);
  if (relMatch) {
    const num = Number(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    if (!Number.isFinite(num) || num <= 0) return 0;
    if (unit.startsWith('s')) return Math.min(86_400_000, num * 1000);
    if (unit.startsWith('m')) return Math.min(86_400_000, num * 60_000);
    return Math.min(86_400_000, num * 3_600_000);
  }

  const atMatch = text.match(/\bat\s+(\d{1,2}):(\d{2})\b/i);
  if (atMatch) {
    const h = Number(atMatch[1]);
    const m = Number(atMatch[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const target = new Date(nowMs);
      target.setHours(h, m, 0, 0);
      if (target.getTime() <= nowMs) target.setDate(target.getDate() + 1);
      return target.getTime() - nowMs;
    }
  }
  return 0;
}

/**
 * Generates tetrahedral CH4 Methane vertices & connections (from jarvis/ui/hologram.py).
 * Scaled cleanly into Central Core local units (~[-1.25, +1.25]).
 */
export function generateMethaneWireframe(): {
  vertices: Array<[number, number, number]>;
  connections: Array<[number, number]>;
} {
  const s = 0.011;
  const vertices: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, 100 * s, 0],
    [94 * s, -33 * s, 0],
    [-47 * s, -33 * s, 81 * s],
    [-47 * s, -33 * s, -81 * s],
  ];
  const connections: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
  ];
  return { vertices, connections };
}

/**
 * Generates 3D involute mechanical gear assembly (ported from jarvis/domains/engineering.py).
 */
export function generateStarkGearWireframe(teethCount = 12): {
  vertices: Array<[number, number, number]>;
  connections: Array<[number, number]>;
} {
  const s = 0.0135;
  const vertices: Array<[number, number, number]> = [
    [0, 0, -30 * s],
    [0, 0, 30 * s],
  ];
  const connections: Array<[number, number]> = [[0, 1]];

  const hubRadius = 25 * s;
  const hubPoints = 8;
  for (let i = 0; i < hubPoints; i++) {
    const angle = (2 * Math.PI * i) / hubPoints;
    const x = hubRadius * Math.cos(angle);
    const y = hubRadius * Math.sin(angle);
    vertices.push([x, y, -10 * s], [x, y, 10 * s]);
    const idx = 2 + 2 * i;
    connections.push([idx, idx + 1], [0, idx], [1, idx + 1]);
    const nextIdx = 2 + 2 * ((i + 1) % hubPoints);
    connections.push([idx, nextIdx], [idx + 1, nextIdx + 1]);
  }

  const outerRadius = 82 * s;
  const innerRadius = 60 * s;
  const toothStart = vertices.length;
  const steps = teethCount * 2;
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    vertices.push([x, y, -10 * s], [x, y, 10 * s]);
    const cur = toothStart + 2 * i;
    const next = toothStart + 2 * ((i + 1) % steps);
    connections.push([cur, cur + 1], [cur, next], [cur + 1, next + 1]);
    if (i % 3 === 0) {
      const hubMatch = 2 + 2 * ((i / 3) % hubPoints);
      connections.push([cur, hubMatch]);
    }
  }

  return { vertices, connections };
}

/**
 * Generates multi-ring quantum lattice hologram for default Central Core standby.
 */
export function generateNeuralLatticeWireframe(): {
  vertices: Array<[number, number, number]>;
  connections: Array<[number, number]>;
} {
  const vertices: Array<[number, number, number]> = [[0, 0, 0]];
  const connections: Array<[number, number]> = [];
  const ringCount = 8;
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2;
    vertices.push([Math.cos(a) * 1.15, Math.sin(a * 2) * 0.25, Math.sin(a) * 1.15]);
  }
  for (let i = 0; i < ringCount; i++) {
    const idx = 1 + i;
    const next = 1 + ((i + 1) % ringCount);
    connections.push([0, idx], [idx, next]);
  }
  return { vertices, connections };
}

export interface JarvisBiometricsState {
  focusScore: number;
  typingCpm: number;
  postureNominal: boolean;
  statusLabel: 'NOMINAL' | 'ELEVATED' | 'FATIGUE RISK';
}

/**
 * Real measured keystroke cadence & cognitive focus calculator (no fabricated sensors).
 */
export function computeCognitiveFocusState(
  recentKeyTimestampsMs: number[],
  lastPointerActiveMs: number,
  nowMs = Date.now(),
): JarvisBiometricsState {
  const oneMinAgo = nowMs - 60_000;
  const recentKeys = recentKeyTimestampsMs.filter((t) => t >= oneMinAgo && t <= nowMs);
  const typingCpm = recentKeys.length;
  const idleSec = Math.max(0, (nowMs - Math.max(lastPointerActiveMs, recentKeys[recentKeys.length - 1] ?? 0)) / 1000);

  let focusScore = 96;
  if (idleSec > 180) focusScore -= 32;
  else if (idleSec > 60) focusScore -= 14;
  if (typingCpm > 180) focusScore -= 8;
  else if (typingCpm > 20) focusScore = Math.min(100, focusScore + 3);

  focusScore = Math.max(40, Math.min(100, Math.round(focusScore)));
  const statusLabel = focusScore >= 80 ? 'NOMINAL' : focusScore >= 60 ? 'ELEVATED' : 'FATIGUE RISK';
  return {
    focusScore,
    typingCpm,
    postureNominal: focusScore >= 65,
    statusLabel,
  };
}
