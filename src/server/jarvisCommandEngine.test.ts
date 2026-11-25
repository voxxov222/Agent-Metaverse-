import test from 'node:test';
import assert from 'node:assert/strict';
import { OsStateStore } from './stateStore';
import { JarvisOperationsEngine } from './jarvisCommandEngine';
import type { ServerWsEvent } from '../types/os';

test('JarvisOperationsEngine runs diagnostics, network scan, and hologram state transitions cleanly', async () => {
  const store = new OsStateStore();
  const engine = new JarvisOperationsEngine(store);
  const events: ServerWsEvent[] = [];
  const broadcast = (ev: ServerWsEvent) => events.push(ev);

  try {
    const diagEntry = await engine.dispatchCommand('Run stark diagnostics check', 'core', broadcast);
    assert.equal(diagEntry.operationKind, 'diagnostics');
    assert.ok(diagEntry.reply.includes('CPU'));
    assert.ok(engine.latestDiagnostics !== null);

    const netEntry = await engine.dispatchCommand('scan subnet topology', 'core', broadcast);
    assert.equal(netEntry.operationKind, 'network-scan');
    assert.equal(engine.hologram.model, 'network-topology');
    assert.ok(engine.networkTopology.nodes.length >= 2);
    assert.ok(events.some((e) => e.type === 'jarvis:hologram' && e.hologram.model === 'network-topology'));

    const gearEntry = await engine.dispatchCommand('show stark gear hologram explode heatmap', 'engineering', broadcast);
    assert.equal(gearEntry.operationKind, 'hologram');
    assert.equal(engine.hologram.model, 'stark-gear');
    assert.equal(engine.hologram.explodeFactor, 0.75);
    assert.equal(engine.hologram.heatmap, true);
  } finally {
    engine.dispose();
  }
});

test('JarvisOperationsEngine schedules and fires reminder alerts via WebSocket events', async () => {
  const store = new OsStateStore();
  const engine = new JarvisOperationsEngine(store);
  const events: ServerWsEvent[] = [];
  const broadcast = (ev: ServerWsEvent) => events.push(ev);

  try {
    const rem = engine.scheduleReminder('Verify Arc Reactor containment', 500, broadcast);
    assert.equal(rem.fired, false);
    assert.equal(engine.reminders.length, 1);

    await new Promise((r) => setTimeout(r, 620));
    assert.equal(rem.fired, true);
    assert.ok(events.some((e) => e.type === 'jarvis:toast' && e.toast.title.includes('Reminder Due')));

    const deleted = engine.deleteReminder(rem.id);
    assert.equal(deleted, true);
    assert.equal(engine.reminders.length, 0);
  } finally {
    engine.dispose();
  }
});
