import { createHaloCommand } from './commandBus';
import type { HaloCommand, HaloFormFactor, HaloModuleId } from './types';

export interface VoiceParseResult {
  matched: boolean;
  wakeWordDetected: boolean;
  intent: string;
  command?: HaloCommand;
  targetedAgentQuery?: string;
  freeformMessage?: string;
}

const MODULE_ALIASES: Array<[RegExp, HaloModuleId]> = [
  [/agent|ring|roster/i, 'agent-ring'],
  [/mission|task|dag|project/i, 'mission-control'],
  [/voice|talk|comms|chat/i, 'voice-comms'],
  [/env|world|weather|zone|build/i, 'environment-deck'],
  [/process|cpu|scheduler|job/i, 'process-monitor'],
  [/memory|atlas|semantic/i, 'memory-atlas'],
  [/security|approval|audit|vault/i, 'security-approvals'],
  [/telemetry|trace|cost|insight/i, 'telemetry-insight'],
  [/automation|workflow|studio/i, 'automation-studio'],
  [/multiverse|fork|universe/i, 'multiverse'],
];

/**
 * Deterministic voice command grammar parser with wake-word support ("halo ...")
 * and targeted agent talk fallback ("tell kestrel ...", "to fleet ...").
 */
export function parseVoiceDirective(rawTranscript: string, actor = 'Operator-01'): VoiceParseResult {
  const raw = rawTranscript.trim();
  if (!raw) {
    return { matched: false, wakeWordDetected: false, intent: 'empty' };
  }

  const wakeMatch = raw.match(/^(?:hey\s+)?halo[,:\s]+(.*)$/i);
  const wakeWordDetected = Boolean(wakeMatch);
  const body = (wakeMatch ? wakeMatch[1] : raw).trim();
  const bodyLower = body.toLowerCase();

  // 1. Emergency Kill Switch
  if (/(?:kill\s*switch|emergency\s*stop|freeze\s*all|halt\s*all)/i.test(bodyLower)) {
    return {
      matched: true,
      wakeWordDetected,
      intent: 'killswitch',
      command: createHaloCommand({ actor, target: 'kernel', verb: 'system.killswitch' }),
    };
  }

  if (/(?:resume\s*system|clear\s*kill\s*switch|unlock\s*agents)/i.test(bodyLower)) {
    return {
      matched: true,
      wakeWordDetected,
      intent: 'resume-system',
      command: createHaloCommand({ actor, target: 'kernel', verb: 'system.resume' }),
    };
  }

  // 2. Spawn agent: "spawn agent Orion role Analyst"
  const spawnMatch = body.match(/^spawn\s+(?:agent\s+)?([a-z0-9_-]+)(?:\s+(?:as|role)\s+(.+))?$/i);
  if (spawnMatch) {
    return {
      matched: true,
      wakeWordDetected,
      intent: 'spawn-agent',
      command: createHaloCommand({
        actor,
        target: 'agents',
        verb: 'agent.spawn',
        args: {
          name: spawnMatch[1],
          role: spawnMatch[2]?.trim() || 'Autonomous Specialist',
        },
      }),
    };
  }

  // 3. Pause / Resume / Kill named agent
  const agentCtrlMatch = body.match(/^(pause|resume|kill|terminate)\s+(?:agent\s+)?([a-z0-9_-]+)$/i);
  if (agentCtrlMatch) {
    const action = agentCtrlMatch[1].toLowerCase();
    const targetName = agentCtrlMatch[2];
    const verb =
      action === 'pause' ? 'agent.pause' : action === 'resume' ? 'agent.resume' : 'agent.kill';
    return {
      matched: true,
      wakeWordDetected,
      intent: verb,
      targetedAgentQuery: targetName,
      command: createHaloCommand({
        actor,
        target: targetName,
        verb,
        args: { query: targetName },
      }),
    };
  }

  // 4. Weather / Time of day
  const weatherMatch = body.match(/^(?:set\s+)?weather\s+(clear|rain|ion[\s-]*storm)$/i);
  if (weatherMatch) {
    const w = weatherMatch[1].toLowerCase().includes('ion')
      ? 'ion-storm'
      : weatherMatch[1].toLowerCase();
    return {
      matched: true,
      wakeWordDetected,
      intent: 'world.weather',
      command: createHaloCommand({
        actor,
        target: 'world',
        verb: 'world.weather',
        args: { weather: w },
      }),
    };
  }

  // 5. Switch Form Factor: "mode dome", "open wrist hud", "holo table"
  const modeMatch = body.match(/(?:mode|switch\s+to|show)\s+(flat|wrist|dome|table|shared)/i);
  if (modeMatch) {
    const ff = modeMatch[1].toLowerCase() as HaloFormFactor;
    return {
      matched: true,
      wakeWordDetected,
      intent: 'hud.formfactor',
      command: createHaloCommand({
        actor,
        target: 'hud',
        verb: 'hud.formfactor',
        args: { formFactor: ff },
      }),
    };
  }

  // 6. Open HALO Module: "open mission control", "show memory atlas"
  const openMatch = body.match(/^(?:open|show|focus|go\s+to)\s+(.+)$/i);
  if (openMatch) {
    const phrase = openMatch[1];
    for (const [re, mod] of MODULE_ALIASES) {
      if (re.test(phrase)) {
        return {
          matched: true,
          wakeWordDetected,
          intent: 'hud.module',
          command: createHaloCommand({
            actor,
            target: 'hud',
            verb: 'hud.module',
            args: { moduleId: mod },
          }),
        };
      }
    }
  }

  // 7. Targeted talk: "tell kestrel run tests" or "to fleet: report status"
  const talkMatch = body.match(/^(?:tell|ask|to)\s+([a-z0-9_-]+)[:,\s]+(.+)$/i);
  if (talkMatch) {
    return {
      matched: true,
      wakeWordDetected,
      intent: 'targeted-talk',
      targetedAgentQuery: talkMatch[1],
      freeformMessage: talkMatch[2].trim(),
    };
  }

  return {
    matched: false,
    wakeWordDetected,
    intent: 'freeform',
    freeformMessage: body,
  };
}
