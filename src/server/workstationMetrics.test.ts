import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectHostWorkstationMetrics,
  computeCpuPercentFromSnapshots,
  computeDiskStats,
} from './workstationMetrics';

test('computeCpuPercentFromSnapshots computes bounded CPU percentage from deltas', () => {
  const prev = { idle: 1000, total: 2000 };
  const curr = { idle: 1200, total: 2400 };
  // delta total = 400, delta idle = 200 => 50%
  assert.equal(computeCpuPercentFromSnapshots(prev, curr, 1, 4), 50);

  const clamped = computeCpuPercentFromSnapshots({ idle: 100, total: 100 }, { idle: 100, total: 200 }, 8, 2);
  assert.equal(clamped, 100);
});

test('computeDiskStats returns bounded percentage and non-negative GB', () => {
  const disk = computeDiskStats(process.cwd());
  assert.ok(disk.diskPct >= 0 && disk.diskPct <= 100);
  assert.ok(disk.diskTotalGb >= 0);
  assert.ok(disk.diskUsedGb >= 0);
});

test('collectHostWorkstationMetrics returns complete telemetry payload', () => {
  const m = collectHostWorkstationMetrics(2, 40);
  assert.ok(m.cpuPct >= 0 && m.cpuPct <= 100);
  assert.ok(m.ramPct >= 0 && m.ramPct <= 100);
  assert.ok(m.tempC > 0 && m.tempC < 150);
  assert.ok(m.gpuPct >= 0 && m.gpuPct <= 100);
  assert.ok(m.cpuCores >= 1);
  assert.ok(m.hostname.length > 0);
});
