import type { CommandRiskLevel, CommandVerb, HaloCommand, HaloModuleId } from './types';

const CRITICAL_VERBS = new Set<string>(['system.killswitch', 'wallet.sign']);
const RISKY_VERBS = new Set<string>([
  'agent.kill',
  'world.object.delete',
  'world.fork.discard',
  'memory.delete',
  'finance.approve',
  'net.egress',
  'code.exec',
  'process.kill',
  'agent.permission.grant',
]);
const MEDIUM_VERBS = new Set<string>([
  'agent.spawn',
  'agent.clone',
  'agent.pause',
  'task.assign',
  'project.plan',
  'world.fork.merge',
  'world.snapshot.restore',
]);

export function classifyCommandRisk(verb: string): {
  riskLevel: CommandRiskLevel;
  requiresApproval: boolean;
} {
  if (CRITICAL_VERBS.has(verb)) {
    return { riskLevel: 'critical', requiresApproval: verb !== 'system.killswitch' };
  }
  if (RISKY_VERBS.has(verb)) {
    return { riskLevel: 'risky', requiresApproval: true };
  }
  if (MEDIUM_VERBS.has(verb)) {
    return { riskLevel: 'medium', requiresApproval: false };
  }
  return { riskLevel: 'low', requiresApproval: false };
}

export function createHaloCommand(params: {
  actor?: string;
  target: string;
  verb: CommandVerb | string;
  args?: Record<string, unknown>;
  requiresApproval?: boolean;
}): HaloCommand {
  const { riskLevel, requiresApproval } = classifyCommandRisk(params.verb);
  return {
    id: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    actor: params.actor?.trim() || 'Operator-01',
    target: params.target.trim() || 'kernel',
    verb: params.verb,
    args: params.args ?? {},
    requiresApproval: params.requiresApproval ?? requiresApproval,
    riskLevel,
    timestamp: Date.now(),
    undoable:
      params.verb === 'agent.pause' ||
      params.verb === 'agent.resume' ||
      params.verb === 'world.object.place' ||
      params.verb === 'world.theme' ||
      params.verb === 'world.weather',
  };
}

export function validateHaloCommand(cmd: unknown): { valid: boolean; reason?: string } {
  if (!cmd || typeof cmd !== 'object') {
    return { valid: false, reason: 'Command must be an object.' };
  }
  const c = cmd as Partial<HaloCommand>;
  if (typeof c.id !== 'string' || !c.id.trim()) {
    return { valid: false, reason: 'Command id is required.' };
  }
  if (typeof c.actor !== 'string' || !c.actor.trim()) {
    return { valid: false, reason: 'Command actor is required.' };
  }
  if (typeof c.target !== 'string' || !c.target.trim()) {
    return { valid: false, reason: 'Command target is required.' };
  }
  if (typeof c.verb !== 'string' || !/^[a-z0-9_.]+$/i.test(c.verb)) {
    return { valid: false, reason: 'Command verb must be a valid dotted identifier.' };
  }
  if (c.args !== undefined && (typeof c.args !== 'object' || c.args === null || Array.isArray(c.args))) {
    return { valid: false, reason: 'Command args must be a plain record object.' };
  }
  return { valid: true };
}

export function buildUndoCommand(
  cmd: HaloCommand,
  previousValues?: Record<string, unknown>,
): HaloCommand | undefined {
  if (cmd.verb === 'agent.pause') {
    return createHaloCommand({ actor: cmd.actor, target: cmd.target, verb: 'agent.resume' });
  }
  if (cmd.verb === 'agent.resume') {
    return createHaloCommand({ actor: cmd.actor, target: cmd.target, verb: 'agent.pause' });
  }
  if (cmd.verb === 'world.object.place' && typeof previousValues?.placedId === 'string') {
    return createHaloCommand({
      actor: cmd.actor,
      target: previousValues.placedId,
      verb: 'world.object.delete',
      requiresApproval: false,
    });
  }
  if (cmd.verb === 'world.weather' && typeof previousValues?.weather === 'string') {
    return createHaloCommand({
      actor: cmd.actor,
      target: 'world',
      verb: 'world.weather',
      args: { weather: previousValues.weather },
    });
  }
  return undefined;
}

/**
 * Parses CLI-style HALO command strings, e.g.:
 * - "agent.pause target=agent-kestrel"
 * - "world.weather weather=rain"
 * - "system.killswitch"
 */
export function parseCommandString(raw: string, actor = 'Operator-01'): HaloCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const verb = parts[0];
  if (!/^[a-z0-9_.]+$/i.test(verb)) return null;

  let target = 'kernel';
  const args: Record<string, unknown> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq === -1) {
      if (target === 'kernel') target = parts[i];
      continue;
    }
    const k = parts[i].slice(0, eq);
    const v = parts[i].slice(eq + 1);
    if (k === 'target') {
      target = v;
    } else if (v === 'true') {
      args[k] = true;
    } else if (v === 'false') {
      args[k] = false;
    } else if (v !== '' && !Number.isNaN(Number(v))) {
      args[k] = Number(v);
    } else {
      args[k] = v;
    }
  }

  return createHaloCommand({ actor, target, verb, args });
}

export interface PaletteActionEntry {
  id: string;
  label: string;
  category: 'module' | 'agent' | 'syscall' | 'form-factor' | 'world' | 'macro';
  commandText: string;
  moduleId?: HaloModuleId;
  verb?: CommandVerb;
  target?: string;
  args?: Record<string, unknown>;
}

export function fuzzyScore(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  const c = candidate.toLowerCase();
  if (!q) return 1;
  if (c.includes(q)) return 100 - c.indexOf(q);

  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] === q[qi]) {
      qi++;
      streak++;
      score += 4 + streak * 2;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : 0;
}

export function fuzzySearchCommands(query: string, entries: PaletteActionEntry[]): PaletteActionEntry[] {
  if (!query.trim()) return entries.slice(0, 14);
  return entries
    .map((entry) => ({
      entry,
      score: Math.max(
        fuzzyScore(query, entry.label),
        fuzzyScore(query, entry.commandText),
        fuzzyScore(query, entry.category),
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entry)
    .slice(0, 14);
}
