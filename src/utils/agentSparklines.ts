import type { AgentProfile } from '../types/os';

export interface AgentSparklinePoint {
  timestamp: number;
  tokensPerSec: number;
  latencyMs: number;
}

export type AgentSparklineHistoryMap = Record<string, AgentSparklinePoint[]>;

export interface DerivedAgentRateMetrics {
  tokensPerSec: number;
  latencyMs: number;
  tokensUsed: number;
  tasksCompleted: number;
}

export function computeAgentThroughputMetrics(
  agent: AgentProfile,
  prevSample?: { tokensUsed: number; timestamp: number } | null,
  nowMs = Date.now(),
): DerivedAgentRateMetrics {
  const { tokensUsed, avgLatencyMs, tasksCompleted, tasksFailed } = agent.metrics;
  const cleanTokens = Math.max(0, Number.isFinite(tokensUsed) ? tokensUsed : 0);
  const cleanLatency = Math.max(0, Number.isFinite(avgLatencyMs) ? Math.round(avgLatencyMs) : 0);
  const completed = Math.max(0, Number.isFinite(tasksCompleted) ? tasksCompleted : 0);
  const failed = Math.max(0, Number.isFinite(tasksFailed) ? tasksFailed : 0);

  let tokensPerSec = 0;

  if (prevSample && cleanTokens > prevSample.tokensUsed) {
    const deltaTokens = cleanTokens - prevSample.tokensUsed;
    const elapsedSec = Math.max(0.25, (nowMs - prevSample.timestamp) / 1000);
    const computeWindowSec = cleanLatency > 0 ? Math.min(elapsedSec, Math.max(0.25, cleanLatency / 1000)) : elapsedSec;
    tokensPerSec = Number((deltaTokens / computeWindowSec).toFixed(1));
  } else if (cleanTokens > 0 && cleanLatency > 0) {
    const turns = Math.max(1, completed + failed);
    const avgTurnTokens = cleanTokens / turns;
    tokensPerSec = Number((avgTurnTokens / (cleanLatency / 1000)).toFixed(1));
  }

  return {
    tokensPerSec,
    latencyMs: cleanLatency,
    tokensUsed: cleanTokens,
    tasksCompleted: completed,
  };
}

export function appendAgentSparklineSample(
  history: AgentSparklineHistoryMap,
  agent: AgentProfile,
  point: AgentSparklinePoint,
  maxSamples = 20,
): AgentSparklineHistoryMap {
  const existing = history[agent.id] ?? [];

  // Seed a subtle 2-point baseline on first observation so SVG sparklines always draw cleanly
  if (existing.length === 0) {
    return {
      ...history,
      [agent.id]: [
        {
          timestamp: point.timestamp - 1000,
          tokensPerSec: point.tokensPerSec,
          latencyMs: point.latencyMs,
        },
        point,
      ],
    };
  }

  const last = existing[existing.length - 1];
  if (
    last &&
    last.tokensPerSec === point.tokensPerSec &&
    last.latencyMs === point.latencyMs &&
    point.timestamp - last.timestamp < 2500
  ) {
    return history;
  }

  const nextList = [...existing, point].slice(-Math.max(2, maxSamples));
  return {
    ...history,
    [agent.id]: nextList,
  };
}

export function buildSparklinePolylinePoints(
  values: number[],
  width = 108,
  height = 28,
  padding = 3,
): string {
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const midY = padding + innerH / 2;

  if (!values || values.length === 0) {
    return `${padding},${midY.toFixed(1)} ${(width - padding).toFixed(1)},${midY.toFixed(1)}`;
  }

  if (values.length === 1) {
    return `${padding},${midY.toFixed(1)} ${(width - padding).toFixed(1)},${midY.toFixed(1)}`;
  }

  const clean = values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
  const minVal = Math.min(...clean);
  const maxVal = Math.max(...clean);
  const span = maxVal - minVal;

  return clean
    .map((val, idx) => {
      const x = padding + (idx / (clean.length - 1)) * innerW;
      const y =
        span <= 0.0001
          ? val === 0
            ? height - padding
            : midY
          : padding + (1 - (val - minVal) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function filterAgentsForMetricsOverlay(
  agents: AgentProfile[],
  mode: 'live' | 'active',
): AgentProfile[] {
  if (mode === 'live') {
    return agents.filter((a) => a.status !== 'idle');
  }
  return agents.filter(
    (a) =>
      a.status !== 'idle' ||
      a.metrics.tokensUsed > 0 ||
      a.metrics.tasksCompleted > 0 ||
      a.metrics.avgLatencyMs > 0,
  );
}
