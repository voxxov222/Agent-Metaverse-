import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCognitiveFocusState,
  generateMethaneWireframe,
  generateStarkGearWireframe,
  parseJarvisIntent,
  parseReminderDelayMs,
} from './jarvisOperationsLogic';

test('parseJarvisIntent classifies English & Hinglish commands accurately', () => {
  assert.deepEqual(parseJarvisIntent('Run stark diagnostics'), { kind: 'diagnostics' });
  assert.deepEqual(parseJarvisIntent('Scan subnet network topology'), { kind: 'network-scan' });

  const gear = parseJarvisIntent('Show stark gear hologram and explode hologram');
  assert.equal(gear.kind, 'hologram');
  if (gear.kind === 'hologram') {
    assert.equal(gear.model, 'stark-gear');
    assert.equal(gear.explode, 0.75);
  }

  const hinged = parseJarvisIntent('pehle check security audit, phir review repo');
  assert.equal(hinged.kind, 'domain-query');
  if (hinged.kind === 'domain-query') {
    assert.equal(hinged.domain, 'security');
    assert.deepEqual(hinged.chainedSteps, ['check security audit', 'review repo']);
  }
});

test('parseReminderDelayMs parses relative s/m/h and HH:MM clock times', () => {
  assert.equal(parseReminderDelayMs('deploy build in 45s'), 45_000);
  assert.equal(parseReminderDelayMs('check telemetry in 3m'), 180_000);
  const now = new Date('2026-11-25T10:00:00').getTime();
  assert.equal(parseReminderDelayMs('briefing at 10:30', now), 30 * 60_000);
});

test('generateMethaneWireframe and generateStarkGearWireframe produce connected 3D graphs', () => {
  const ch4 = generateMethaneWireframe();
  assert.equal(ch4.vertices.length, 5);
  assert.equal(ch4.connections.length, 4);

  const gear = generateStarkGearWireframe(12);
  assert.ok(gear.vertices.length > 50);
  assert.ok(gear.connections.length > 70);
});

test('computeCognitiveFocusState measures CPM and focus degradation on extended idle', () => {
  const now = 1_000_000;
  const active = computeCognitiveFocusState([now - 5000, now - 3000, now - 1000], now - 2000, now);
  assert.equal(active.typingCpm, 3);
  assert.equal(active.statusLabel, 'NOMINAL');

  const idle = computeCognitiveFocusState([], now - 240_000, now);
  assert.ok(idle.focusScore < active.focusScore);
});
