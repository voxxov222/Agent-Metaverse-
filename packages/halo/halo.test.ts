import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCommandRisk,
  createHaloCommand,
  fuzzySearchCommands,
  parseCommandString,
  validateHaloCommand,
} from './commandBus';
import { parseVoiceDirective } from './voiceGrammar';
import { compileWorkflowToDag } from './workflowCompiler';
import { loadPersistedLayout, mergeSharedCursor, persistLayout } from './store';
import { KernelCommandBus, verifyAuditChain } from '../../src/server/kernelBus';
import { OsStateStore } from '../../src/server/stateStore';
import { WorldPresenceStore } from '../../src/server/worldPresence';

test('HALO command validation, risk classification, and CLI parsing', () => {
  const valid = createHaloCommand({ actor: 'Operator', target: 'agent-aegis', verb: 'agent.pause' });
  assert.equal(validateHaloCommand(valid).valid, true);
  assert.equal(classifyCommandRisk('agent.pause').requiresApproval, false);
  assert.equal(classifyCommandRisk('net.egress').requiresApproval, true);
  assert.equal(classifyCommandRisk('system.killswitch').riskLevel, 'critical');

  assert.equal(validateHaloCommand({ id: '', actor: 'a', target: 'b', verb: 'x' }).valid, false);
  assert.equal(validateHaloCommand({ id: '1', actor: 'a', target: 'b', verb: 'bad verb!' }).valid, false);

  const parsed = parseCommandString('agent.spawn name=Astra role=Security budgetUsd=80', 'Ops');
  assert.ok(parsed);
  assert.equal(parsed.verb, 'agent.spawn');
  assert.equal(parsed.args.name, 'Astra');
  assert.equal(parsed.args.budgetUsd, 80);

  const matches = fuzzySearchCommands('kill', [
    { id: '1', label: 'Open Agent Ring', category: 'module', commandText: 'hud.module agent-ring' },
    { id: '2', label: 'Trigger Global Kill Switch', category: 'syscall', commandText: 'system.killswitch' },
  ]);
  assert.equal(matches[0].id, '2');
});

test('KernelCommandBus enforces risky approval gates, kill switch, and tamper-evident SHA-256 chain', async () => {
  const store = new OsStateStore();
  const world = new WorldPresenceStore();
  const bus = new KernelCommandBus(store, world);

  // 1. Spawn agent directly (medium risk, auto-executes)
  const spawnRes = await bus.dispatchCommand(
    createHaloCommand({
      actor: 'Operator-01',
      target: 'agents',
      verb: 'agent.spawn',
      args: { name: 'Orion-09', role: 'Verifier' },
    }),
  );
  assert.equal(spawnRes.status, 'executed');
  assert.ok(store.agents.some((a) => a.name === 'Orion-09'));

  // 2. Risky net.egress syscall queues for human approval
  const riskyRes = await bus.dispatchCommand(
    createHaloCommand({
      actor: 'Orion-09',
      target: 'external-api',
      verb: 'net.egress',
      args: { endpoint: 'https://api.github.com' },
    }),
  );
  assert.equal(riskyRes.status, 'pending-approval');
  assert.ok(riskyRes.approvalId);

  // 3. Approve once executes queued syscall
  const decided = await bus.decideApproval(riskyRes.approvalId!, 'approve-once', 'Operator-01');
  assert.ok(decided);
  assert.equal(decided.approval.status, 'approved');
  assert.equal(decided.result?.status, 'executed');

  // 4. Verify SHA-256 audit chain integrity & tamper detection
  assert.equal(verifyAuditChain(bus.auditChain).valid, true);
  const tampered = bus.auditChain.map((e, idx) =>
    idx === 1 ? { ...e, argsSummary: 'TAMPERED_PAYLOAD' } : e,
  );
  const checkTamper = verifyAuditChain(tampered);
  assert.equal(checkTamper.valid, false);
  assert.equal(checkTamper.brokenAtSeq, 2);

  // 5. Global Kill Switch blocks non-HUD mutations until system.resume
  const killRes = await bus.dispatchCommand(
    createHaloCommand({ actor: 'Operator-01', target: 'kernel', verb: 'system.killswitch' }),
  );
  assert.equal(killRes.status, 'executed');
  assert.equal(bus.killSwitchActive, true);

  const blocked = await bus.dispatchCommand(
    createHaloCommand({ actor: 'Operator-01', target: 'agents', verb: 'agent.spawn', args: { name: 'Blocked' } }),
  );
  assert.equal(blocked.status, 'denied');

  const resumed = await bus.dispatchCommand(
    createHaloCommand({ actor: 'Operator-01', target: 'kernel', verb: 'system.resume' }),
  );
  assert.equal(resumed.status, 'executed');
  assert.equal(bus.killSwitchActive, false);
});

test('HALO layout persistence and CRDT multi-user cursor merge', () => {
  const memStorage = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memStorage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStorage.set(k, v);
    },
  };

  const initial = loadPersistedLayout(mockStorage);
  assert.equal(initial.formFactor, 'flat');

  persistLayout({ ...initial, formFactor: 'dome', themeId: 'violet-neural' }, mockStorage);
  const reloaded = loadPersistedLayout(mockStorage);
  assert.equal(reloaded.formFactor, 'dome');
  assert.equal(reloaded.themeId, 'violet-neural');

  let cursors = mergeSharedCursor(
    {},
    {
      actorId: 'u1',
      callsign: 'Alice',
      color: '#22d3ee',
      x: 0.3,
      y: 0.4,
      activeModule: 'agent-ring',
      selectedTargetId: 'agent-aegis',
      lamport: 5,
      updatedAt: 1000,
    },
  );
  // Stale lamport update is ignored (CRDT LWW safety)
  cursors = mergeSharedCursor(cursors, {
    actorId: 'u1',
    callsign: 'Alice',
    color: '#22d3ee',
    x: 0.9,
    y: 0.9,
    activeModule: 'multiverse',
    selectedTargetId: null,
    lamport: 4,
    updatedAt: 2000,
  });
  assert.equal(cursors.u1.x, 0.3);
  assert.equal(cursors.u1.activeModule, 'agent-ring');
});

test('Voice grammar parser routes wake-word syscalls and targeted talk', () => {
  const spawn = parseVoiceDirective('halo spawn agent Lyra role SecurityAuditor', 'Ops');
  assert.equal(spawn.wakeWordDetected, true);
  assert.equal(spawn.command?.verb, 'agent.spawn');
  assert.equal(spawn.command?.args.name, 'Lyra');

  const mode = parseVoiceDirective('hey halo switch to dome');
  assert.equal(mode.command?.verb, 'hud.formfactor');
  assert.equal(mode.command?.args.formFactor, 'dome');

  const talk = parseVoiceDirective('tell Kestrel check sandbox tests');
  assert.equal(talk.intent, 'targeted-talk');
  assert.equal(talk.targetedAgentQuery, 'Kestrel');
  assert.equal(talk.freeformMessage, 'check sandbox tests');

  const ks = parseVoiceDirective('halo emergency stop');
  assert.equal(ks.command?.verb, 'system.killswitch');
});

test('Automation Studio workflow compiler generates topological DAG and rejects cycles', () => {
  const store = new OsStateStore();
  const validWf = {
    id: 'wf-test',
    name: 'Test Pipeline',
    version: 1,
    schedule: 'manual',
    nodes: [
      { id: 'a', kind: 'trigger' as const, label: 'Start', config: {}, x: 0, y: 0 },
      { id: 'b', kind: 'agent' as const, label: 'Analyze', agentId: 'agent-vega', config: {}, x: 100, y: 0 },
      { id: 'c', kind: 'approval' as const, label: 'Sign Off', config: {}, x: 200, y: 0 },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ],
    compiledTasks: [],
    updatedAt: Date.now(),
  };

  const ok = compileWorkflowToDag(validWf, store.agents);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.tasks.length, 3);
  assert.equal(ok.tasks[2].requiresApproval, true);
  assert.deepEqual(ok.tasks[2].dependsOn, ['wf-wf-test-b']);

  const cyclicWf = {
    ...validWf,
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'a' },
    ],
  };
  const bad = compileWorkflowToDag(cyclicWf, store.agents);
  assert.ok(bad.errors.length > 0);
});
