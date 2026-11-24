import type {
  AgentPermissions,
  AgentProfile,
  AutonomyLevel,
  MemoryItem,
  OfflineQueuedAction,
  ProjectTask,
  TaskStatus,
} from '../types/os';

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
}

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

/**
 * Validates external URLs for headless/server web intelligence against SSRF.
 */
export function validateExternalUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: 'URL is required' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only http and https protocols are permitted' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    PRIVATE_IP_PATTERNS.some((rx) => rx.test(hostname))
  ) {
    return { valid: false, reason: 'Private, loopback, and link-local hosts are blocked' };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

/**
 * Strips potentially dangerous HTML/script payloads and flags untrusted prompt injection markers.
 */
export function sanitizeUntrustedWebText(htmlOrText: string, maxChars = 6000): {
  cleanText: string;
  injectionWarning: boolean;
} {
  const withoutScripts = htmlOrText
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();

  const injectionPattern =
    /(ignore previous instructions|override system|reveal api key|bypass approval|exfiltrate|disregard security)/i;
  const injectionWarning = injectionPattern.test(withoutScripts);

  return {
    cleanText: withoutScripts.slice(0, maxChars),
    injectionWarning,
  };
}

/**
 * Selects the best agent for a task description using expertise matching and current workload.
 */
export function selectBestAgentForTask(
  taskText: string,
  agents: AgentProfile[],
): AgentProfile | null {
  if (agents.length === 0) return null;
  const lower = taskText.toLowerCase();

  let bestAgent = agents[0];
  let bestScore = -Infinity;

  for (const agent of agents) {
    let score = 0;
    for (const skill of agent.expertise) {
      const tokens = skill.toLowerCase().split(/\s+/);
      for (const tok of tokens) {
        if (tok.length > 2 && lower.includes(tok)) {
          score += 12;
        }
      }
    }
    if (lower.includes(agent.role.toLowerCase())) score += 15;
    if (agent.status === 'idle') score += 5;
    if (agent.status === 'error') score -= 20;
    if (agent.autonomy === 'AUTONOMOUS') score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return bestAgent;
}

/**
 * Checks whether an agent is allowed to execute an action autonomously or needs user approval.
 */
export function evaluateActionPolicy(
  autonomy: AutonomyLevel,
  permissions: AgentPermissions,
  actionType: 'read' | 'terminal-write' | 'web-browse' | 'external-comm' | 'spend' | 'deploy',
  spendAmountUsd = 0,
): { permitted: boolean; requiresApproval: boolean; reason: string } {
  if (actionType === 'spend') {
    if (spendAmountUsd <= 0) {
      return { permitted: false, requiresApproval: true, reason: 'Spend amount must be positive' };
    }
    if (spendAmountUsd > permissions.financialSpendLimitUsd || autonomy !== 'AUTONOMOUS') {
      return {
        permitted: true,
        requiresApproval: true,
        reason: 'Financial commitments require explicit operator approval',
      };
    }
  }

  if (actionType === 'external-comm') {
    if (!permissions.sendEmail && !permissions.sendSms && !permissions.makeCalls) {
      return { permitted: false, requiresApproval: false, reason: 'Agent lacks communication permissions' };
    }
    return {
      permitted: true,
      requiresApproval: autonomy !== 'AUTONOMOUS',
      reason:
        autonomy === 'AUTONOMOUS'
          ? 'Preauthorized communication policy active'
          : 'Communication requires operator confirmation',
    };
  }

  if (actionType === 'deploy') {
    if (!permissions.codeDeploy) {
      return { permitted: false, requiresApproval: false, reason: 'Deployment permission disabled for agent' };
    }
    return {
      permitted: true,
      requiresApproval: true,
      reason: 'Production deployments always require explicit operator sign-off',
    };
  }

  if (actionType === 'terminal-write') {
    if (!permissions.terminalWrite) {
      return { permitted: false, requiresApproval: false, reason: 'Terminal write permission disabled' };
    }
    return {
      permitted: true,
      requiresApproval: autonomy === 'ASSISTED',
      reason: autonomy === 'ASSISTED' ? 'Assisted mode requires confirmation' : 'Permitted inside sandbox',
    };
  }

  if (actionType === 'web-browse') {
    if (!permissions.webBrowse) {
      return { permitted: false, requiresApproval: false, reason: 'Web browsing permission disabled' };
    }
    return {
      permitted: true,
      requiresApproval: autonomy === 'ASSISTED',
      reason: autonomy === 'ASSISTED' ? 'Assisted mode requires confirmation' : 'Sandboxed web browse permitted',
    };
  }

  return { permitted: true, requiresApproval: false, reason: 'Read operation permitted' };
}

/**
 * Computes ready tasks in a project DAG whose dependencies are all completed.
 */
export function getRunnableTasks(tasks: ProjectTask[]): ProjectTask[] {
  const statusMap = new Map<string, TaskStatus>();
  for (const t of tasks) {
    statusMap.set(t.id, t.status);
  }

  return tasks.filter((task) => {
    if (task.status !== 'queued') return false;
    return task.dependsOn.every((depId) => statusMap.get(depId) === 'completed');
  });
}

/**
 * Estimates Gemini API cost (labeled clearly as estimated) from measured token count.
 */
export function estimateTokenCostUsd(totalTokens: number): number {
  if (totalTokens <= 0) return 0;
  // Blended estimate: $0.15 per 1M tokens
  return Number(((totalTokens / 1_000_000) * 0.15).toFixed(5));
}

/**
 * Deduplicates and reconciles offline-queued actions against already-applied IDs.
 */
export function reconcileOfflineQueue(
  queue: OfflineQueuedAction[],
  appliedIds: Set<string>,
): { pending: OfflineQueuedAction[]; skippedCount: number } {
  const seen = new Set<string>(appliedIds);
  const pending: OfflineQueuedAction[] = [];
  let skippedCount = 0;

  for (const item of queue) {
    if (seen.has(item.id)) {
      skippedCount += 1;
      continue;
    }
    seen.add(item.id);
    pending.push(item);
  }

  return { pending, skippedCount };
}

/**
 * Searches memories by keyword relevance across title, content, and tags.
 */
export function searchMemories(memories: MemoryItem[], query: string, scopeFilter?: string): MemoryItem[] {
  const q = query.trim().toLowerCase();
  const scoped = scopeFilter && scopeFilter !== 'all'
    ? memories.filter((m) => m.scope === scopeFilter)
    : memories;

  if (!q) {
    return [...scoped].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  return scoped
    .map((m) => {
      let score = 0;
      if (m.title.toLowerCase().includes(q)) score += 3;
      if (m.content.toLowerCase().includes(q)) score += 2;
      if (m.tags.some((t) => t.toLowerCase().includes(q))) score += 2;
      return { item: m, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .map((entry) => entry.item);
}
