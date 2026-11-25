import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMayaParticles,
  getMetricColorTier,
  parseWorkstationCommand,
  stepMayaParticles,
} from './mayaWorkstationLogic';
import type { AgentProfile } from '../types/os';

const SAMPLE_AGENTS: AgentProfile[] = [
  {
    id: 'agent-architect',
    name: 'Atlas Architect',
    role: 'Systems Architect',
    expertise: ['architecture'],
    personality: 'methodical',
    systemPrompt: 'Design systems',
    model: 'gemini-4-hydrogen',
    autonomy: 'SUPERVISED',
    status: 'idle',
    currentObjective: 'Standby',
    currentStage: 'Ready',
    position: [0, 0, 0],
    appearance: {
      chassisColor: '#1e293b',
      accentColor: '#38bdf8',
      visorColor: '#22d3ee',
      wardrobeStyle: 'architect-robe',
      expression: 'focused',
      heightScale: 1,
      shoulderWidth: 1,
    },
    voice: { pitch: 1, rate: 1, style: 'calm' },
    permissions: {
      terminalRead: true,
      terminalWrite: true,
      webBrowse: true,
      sendEmail: false,
      sendSms: false,
      makeCalls: false,
      codeDeploy: false,
      financialSpendLimitUsd: 0,
    },
    metrics: { tasksCompleted: 1, tasksFailed: 0, tokensUsed: 100, avgLatencyMs: 250 },
    updatedAt: 0,
  },
];

test('getMetricColorTier classifies thresholds matching Maya LeftPanel', () => {
  assert.equal(getMetricColorTier(13).tier, 'optimal');
  assert.equal(getMetricColorTier(49.9).tier, 'optimal');
  assert.equal(getMetricColorTier(66).tier, 'elevated');
  assert.equal(getMetricColorTier(85).tier, 'critical');
});

test('parseWorkstationCommand routes terminal, agent, project, halo, and central prompts', () => {
  assert.deepEqual(parseWorkstationCommand('/exec ls -la', SAMPLE_AGENTS), {
    kind: 'terminal',
    command: 'ls -la',
  });
  assert.deepEqual(parseWorkstationCommand('$ node -v', SAMPLE_AGENTS), {
    kind: 'terminal',
    command: 'node -v',
  });
  const agentRoute = parseWorkstationCommand('@atlas check service status', SAMPLE_AGENTS);
  assert.equal(agentRoute.kind, 'agent');
  if (agentRoute.kind === 'agent') {
    assert.equal(agentRoute.agent.id, 'agent-architect');
    assert.equal(agentRoute.prompt, 'check service status');
  }
  assert.deepEqual(parseWorkstationCommand('/project build billing sync', SAMPLE_AGENTS), {
    kind: 'project',
    objective: 'build billing sync',
  });
  assert.deepEqual(parseWorkstationCommand('/focus security', SAMPLE_AGENTS), {
    kind: 'focus-region',
    regionId: 'security-gate',
  });
  assert.deepEqual(parseWorkstationCommand('Summarize system telemetry', SAMPLE_AGENTS), {
    kind: 'central',
    prompt: 'Summarize system telemetry',
  });
});

test('stepMayaParticles keeps coordinates wrapped inside viewport bounds', () => {
  const particles = createMayaParticles(25, 800, 600);
  assert.equal(particles.length, 25);
  particles[0].x = -2;
  particles[0].vx = -1;
  stepMayaParticles(particles, 800, 600, 1);
  assert.ok(particles[0].x >= 0 && particles[0].x <= 800);
});
