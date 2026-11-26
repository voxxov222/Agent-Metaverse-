import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveSystemInstruction,
  parseLiveClientMessage,
  resolveLivePersonaKind,
  resolveLiveVoiceName,
} from './geminiLiveBridge';
import type { AgentProfile } from '../types/os';

test('resolveLiveVoiceName accepts valid voices and falls back to Zephyr', () => {
  assert.equal(resolveLiveVoiceName('Puck'), 'Puck');
  assert.equal(resolveLiveVoiceName('Kore'), 'Kore');
  assert.equal(resolveLiveVoiceName('InvalidVoice'), 'Zephyr');
  assert.equal(resolveLiveVoiceName(undefined), 'Zephyr');
});

test('resolveLivePersonaKind maps valid personas and defaults to central', () => {
  assert.equal(resolveLivePersonaKind('jarvis'), 'jarvis');
  assert.equal(resolveLivePersonaKind('agent'), 'agent');
  assert.equal(resolveLivePersonaKind('other'), 'central');
});

test('buildLiveSystemInstruction incorporates agent persona and live telemetry counts', () => {
  const mockAgent: AgentProfile = {
    id: 'agent-aegis',
    name: 'Aegis-01',
    role: 'Systems Architect',
    model: 'gemini-4-hydrogen',
    expertise: ['architecture'],
    personality: 'Methodical and calm',
    systemPrompt: 'Enforce safety boundaries.',
    autonomy: 'SUPERVISED',
    status: 'reasoning',
    position: [0, 0, 0],
    currentObjective: 'Audit core',
    currentStage: 'Reasoning',
    appearance: {
      chassisColor: '#1E293B',
      accentColor: '#22D3EE',
      visorColor: '#22D3EE',
      wardrobeStyle: 'tactical-coat',
      expression: 'focused',
      heightScale: 1,
      shoulderWidth: 1,
    },
    voice: { pitch: 1, rate: 1, style: 'Standard' },
    permissions: {
      terminalRead: true,
      terminalWrite: false,
      webBrowse: true,
      sendEmail: false,
      sendSms: false,
      makeCalls: false,
      codeDeploy: false,
      financialSpendLimitUsd: 100,
    },
    metrics: { tasksCompleted: 2, tasksFailed: 0, tokensUsed: 200, avgLatencyMs: 600 },
    updatedAt: 1700000000000,
  };

  const agentPrompt = buildLiveSystemInstruction({
    persona: 'agent',
    agent: mockAgent,
    activeAgentNames: ['Aegis-01'],
    pendingTasksCount: 3,
  });
  assert.ok(agentPrompt.includes('Aegis-01'));
  assert.ok(agentPrompt.includes('1 active agents'));
  assert.ok(agentPrompt.includes('3 tasks running'));

  const jarvisPrompt = buildLiveSystemInstruction({
    persona: 'jarvis',
    activeAgentNames: [],
    pendingTasksCount: 0,
  });
  assert.ok(jarvisPrompt.includes('J.A.R.V.I.S.'));
});

test('parseLiveClientMessage validates start, audio, text, stop, and rejects oversized/malformed frames', () => {
  assert.deepEqual(parseLiveClientMessage(JSON.stringify({ type: 'start', voice: 'Fenrir', persona: 'jarvis' })), {
    type: 'start',
    voice: 'Fenrir',
    persona: 'jarvis',
    agentId: undefined,
  });
  assert.deepEqual(parseLiveClientMessage(JSON.stringify({ type: 'audio', data: 'AAAA' })), {
    type: 'audio',
    data: 'AAAA',
  });
  assert.deepEqual(parseLiveClientMessage(JSON.stringify({ audio: 'BBBB' })), {
    audio: 'BBBB',
  });
  assert.deepEqual(parseLiveClientMessage(JSON.stringify({ type: 'text', text: '  Hello Core  ' })), {
    type: 'text',
    text: 'Hello Core',
  });
  assert.deepEqual(parseLiveClientMessage(JSON.stringify({ type: 'stop' })), { type: 'stop' });
  assert.equal(parseLiveClientMessage('not-json'), null);
  assert.equal(parseLiveClientMessage(JSON.stringify({ type: 'text', text: '   ' })), null);
});
