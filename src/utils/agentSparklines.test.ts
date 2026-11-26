import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentProfile } from '../types/os';
import {
  appendAgentSparklineSample,
  buildSparklinePolylinePoints,
  computeAgentThroughputMetrics,
  filterAgentsForMetricsOverlay,
} from './agentSparklines';

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'agent-test',
    name: 'Aegis-01',
    role: 'Architect',
    expertise: ['systems'],
    personality: 'Concise',
    systemPrompt: 'Act as architect',
    model: 'gemini-4-hydrogen',
    autonomy: 'SUPERVISED',
    status: 'idle',
    currentObjective: 'Ready',
    currentStage: 'Standby',
    position: [0, 0, 0],
    appearance: {
      chassisColor: '#1E293B',
      accentColor: '#22D3EE',
      visorColor: '#38BDF8',
      wardrobeStyle: 'tactical-coat',
      expression: 'focused',
      heightScale: 1,
      shoulderWidth: 1,
    },
    voice: { pitch: 1, rate: 1, style: 'Calm' },
    permissions: {
      terminalRead: true,
      terminalWrite: false,
      webBrowse: true,
      sendEmail: false,
      sendSms: false,
      makeCalls: false,
      codeDeploy: false,
      financialSpendLimitUsd: 0,
    },
    metrics: {
      tasksCompleted: 2,
      tasksFailed: 0,
      tokensUsed: 900,
      avgLatencyMs: 1500,
    },
    updatedAt: 1000,
    ...overrides,
  };
}

test('computeAgentThroughputMetrics derives tokens/sec and latency from AgentProfile.metrics', () => {
  const agent = makeAgent({
    metrics: { tasksCompleted: 2, tasksFailed: 0, tokensUsed: 900, avgLatencyMs: 1500 },
  });
  const res = computeAgentThroughputMetrics(agent, null, 2000);
  // 900 tokens / 2 turns = 450 tokens/turn; 450 / 1.5s = 300 tok/s
  assert.equal(res.tokensPerSec, 300);
  assert.equal(res.latencyMs, 1500);

  // Delta calculation when tokensUsed increases
  const nextAgent = makeAgent({
    metrics: { tasksCompleted: 3, tasksFailed: 0, tokensUsed: 1200, avgLatencyMs: 1000 },
  });
  const deltaRes = computeAgentThroughputMetrics(
    nextAgent,
    { tokensUsed: 900, timestamp: 2000 },
    4000,
  );
  // +300 tokens over min(2s, 1s) = 300 tok/s
  assert.equal(deltaRes.tokensPerSec, 300);
  assert.equal(deltaRes.latencyMs, 1000);
});

test('computeAgentThroughputMetrics handles zero tokens and zero latency safely', () => {
  const idleZero = makeAgent({
    metrics: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0, avgLatencyMs: 0 },
  });
  const res = computeAgentThroughputMetrics(idleZero);
  assert.equal(res.tokensPerSec, 0);
  assert.equal(res.latencyMs, 0);
});

test('appendAgentSparklineSample initializes baseline and enforces maxSamples cap', () => {
  const agent = makeAgent();
  let map = appendAgentSparklineSample({}, agent, { timestamp: 1000, tokensPerSec: 120, latencyMs: 600 }, 4);
  assert.equal(map[agent.id].length, 2);

  for (let i = 1; i <= 5; i++) {
    map = appendAgentSparklineSample(
      map,
      agent,
      { timestamp: 1000 + i * 3000, tokensPerSec: 120 + i * 10, latencyMs: 600 + i * 25 },
      4,
    );
  }
  assert.equal(map[agent.id].length, 4);
  assert.equal(map[agent.id][3].tokensPerSec, 170);
});

test('buildSparklinePolylinePoints normalizes values and avoids NaN on flat or empty series', () => {
  const pts = buildSparklinePolylinePoints([10, 20, 30], 106, 26, 3);
  assert.equal(pts, '3.0,23.0 53.0,13.0 103.0,3.0');

  const flatZero = buildSparklinePolylinePoints([0, 0, 0], 106, 26, 3);
  assert.ok(!flatZero.includes('NaN'));
  assert.equal(flatZero, '3.0,23.0 53.0,23.0 103.0,23.0');
});

test('filterAgentsForMetricsOverlay separates live mid-turn agents from active roster', () => {
  const idleWithWork = makeAgent({ id: 'a1', status: 'idle', metrics: { tasksCompleted: 4, tasksFailed: 0, tokensUsed: 0, avgLatencyMs: 0 } });
  const running = makeAgent({ id: 'a2', status: 'executing' });
  const untouched = makeAgent({ id: 'a3', status: 'idle', metrics: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0, avgLatencyMs: 0 } });

  assert.deepEqual(
    filterAgentsForMetricsOverlay([idleWithWork, running, untouched], 'live').map((a) => a.id),
    ['a2'],
  );
  assert.deepEqual(
    filterAgentsForMetricsOverlay([idleWithWork, running, untouched], 'active').map((a) => a.id),
    ['a1', 'a2'],
  );
});
