import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRegionWorldPosition,
  resolveSpatialCueForAgentUpdate,
  resolveSpatialCueForPulse,
  SpatialCueLimiter,
} from './spatialAudioEngine';

test('computeRegionWorldPosition resolves neural cortex offsets around core origin [0, 3.4, 0]', () => {
  const reasoning = computeRegionWorldPosition('reasoning-cortex');
  assert.deepEqual(reasoning, [0, 4.36, 0]);

  const security = computeRegionWorldPosition('security-gate');
  assert.deepEqual(security, [0.84, 2.58, -0.6]);
});

test('resolveSpatialCueForPulse returns subtle non-intrusive acoustic cues per region', () => {
  const regions = [
    'reasoning-cortex',
    'memory-lattice',
    'planning-engine',
    'tool-bus',
    'security-gate',
  ] as const;

  const freqs = new Set<number>();
  for (const r of regions) {
    const cue = resolveSpatialCueForPulse(r);
    assert.equal(cue.kind, 'neural-pulse');
    assert.ok(cue.gain > 0 && cue.gain <= 0.1, `Expected subtle gain for ${r}, got ${cue.gain}`);
    assert.ok(cue.filterHz >= 700 && cue.filterHz <= 1500);
    assert.ok(cue.durationSec >= 0.25 && cue.durationSec <= 0.6);
    freqs.add(cue.frequencyHz);
  }
  assert.equal(freqs.size, regions.length);
});

test('resolveSpatialCueForAgentUpdate adapts pitch by status and agent index', () => {
  const r0 = resolveSpatialCueForAgentUpdate('reasoning', 0);
  const r1 = resolveSpatialCueForAgentUpdate('reasoning', 1);
  const err = resolveSpatialCueForAgentUpdate('error', 0);

  assert.ok(r1.frequencyHz > r0.frequencyHz);
  assert.ok(err.frequencyHz < r0.frequencyHz);
  assert.ok(err.gain <= 0.1);
});

test('SpatialCueLimiter enforces source cooldown, global spacing, and polyphony cap', () => {
  const limiter = new SpatialCueLimiter(650, 150, 3);

  assert.equal(limiter.tryAcquire('agent:a', 300, 1000), true);
  // Blocked by global cooldown (150ms)
  assert.equal(limiter.tryAcquire('agent:b', 300, 1050), false);
  // Allowed after global cooldown
  assert.equal(limiter.tryAcquire('agent:b', 300, 1160), true);
  // Blocked by per-source cooldown (650ms)
  assert.equal(limiter.tryAcquire('agent:a', 300, 1320), false);
  // Allowed third distinct source
  assert.equal(limiter.tryAcquire('agent:c', 400, 1320), true);
  // Blocked by max polyphony = 3 while all three remain active (agent:a ends at 1300, wait: 1320 > 1300!)
  // Re-test explicit overlapping window:
  limiter.reset();
  assert.equal(limiter.tryAcquire('s1', 1000, 2000), true);
  assert.equal(limiter.tryAcquire('s2', 1000, 2200), true);
  assert.equal(limiter.tryAcquire('s3', 1000, 2400), true);
  assert.equal(limiter.tryAcquire('s4', 1000, 2600), false);
  // Once s1 expires after 3000ms, s4 succeeds
  assert.equal(limiter.tryAcquire('s4', 400, 3050), true);
});
