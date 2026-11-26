import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZimDamp,
  ZimHandStateTracker,
  buildSyntheticHandLandmarks,
  computeCamMotionGrid,
  getAngleDeg2D,
  getDistance2D,
} from './zimHandTracker';

test('ZimDamp smoothly converges toward target and supports immediate snap', () => {
  const d = new ZimDamp(0, 0.5);
  const s1 = d.convert(1.0, 1);
  assert.ok(s1 > 0.4 && s1 < 0.6, `Expected ~0.5 on first step, got ${s1}`);
  const s2 = d.convert(1.0, 1);
  assert.ok(s2 > s1 && s2 < 1.0);
  d.immediate(0.25);
  assert.equal(d.value, 0.25);
});

test('ZimHandStateTracker detects pinch down, bridges transient gapTime dropouts, and emits tap vs up', () => {
  const tracker = new ZimHandStateTracker({
    hand: 'right',
    flip: false,
    damp: 0.05,
    sensitivity: 1.0,
    pinchThreshold: 0.06,
    tapTimeMs: 300,
    gapTimeMs: 500,
  });

  // Open hand (index & thumb far apart)
  const openLandmarks = buildSyntheticHandLandmarks({ x: 0.5, y: 0.4 }, { x: 0.36, y: 0.52 }, 'right');
  const f1 = tracker.update([{ handedness: 'right', landmarks: openLandmarks }], 1000);
  assert.equal(f1.hands.right.visible, true);
  assert.equal(f1.hands.right.pinching, false);
  assert.equal(f1.hands.right.phase, 'none');

  // Pinch down
  const pinchLandmarks = buildSyntheticHandLandmarks({ x: 0.5, y: 0.45 }, { x: 0.51, y: 0.46 }, 'right');
  const f2 = tracker.update([{ handedness: 'right', landmarks: pinchLandmarks }], 1050);
  assert.equal(f2.hands.right.pinching, true);
  assert.equal(f2.hands.right.phase, 'down');

  // Quick release within tapTimeMs -> fires 'tap' immediately
  const f3 = tracker.update([{ handedness: 'right', landmarks: openLandmarks }], 1180);
  assert.equal(f3.hands.right.pinching, false);
  assert.equal(f3.hands.right.phase, 'tap');

  // Sustained drag + transient 200ms camera dropout (< gapTimeMs) keeps pinch alive
  const f4 = tracker.update([{ handedness: 'right', landmarks: pinchLandmarks }], 2000);
  assert.equal(f4.hands.right.phase, 'down');
  const f5 = tracker.update([{ handedness: 'right', landmarks: pinchLandmarks }], 2450);
  assert.equal(f5.hands.right.phase, 'move');
  const fDropout = tracker.update([], 2650);
  assert.equal(fDropout.hands.right.pinching, true, 'gapTimeMs should bridge short tracking loss');
  assert.equal(fDropout.hands.right.phase, 'move');

  // After gapTimeMs expires -> emits 'up'
  const fEnd = tracker.update([], 3050);
  assert.equal(fEnd.hands.right.pinching, false);
  assert.equal(fEnd.hands.right.phase, 'up');
});

test('Two-hand distance, angle deltas, and toggleReplace cursor toggling work accurately', () => {
  const tracker = new ZimHandStateTracker({
    hand: 'both',
    flip: false,
    damp: 0.02,
    sensitivity: 1.0,
    pinchThreshold: 0.06,
    toggleReplace: true,
    replaceCursor: true,
  });

  const left1 = buildSyntheticHandLandmarks({ x: 0.3, y: 0.5 }, { x: 0.305, y: 0.505 }, 'left');
  const right1 = buildSyntheticHandLandmarks({ x: 0.7, y: 0.5 }, { x: 0.705, y: 0.505 }, 'right');
  const frame1 = tracker.update(
    [
      { handedness: 'left', landmarks: left1 },
      { handedness: 'right', landmarks: right1 },
    ],
    1000,
  );
  assert.equal(frame1.bothPinching, true);
  assert.ok(Math.abs((frame1.twoHandDistance ?? 0) - 0.4) < 0.04);
  assert.ok(Math.abs(frame1.twoHandAngleDeg ?? 999) < 8);

  // Spread hands apart and tilt 45 degrees -> positive zoom delta & angle delta
  const left2 = buildSyntheticHandLandmarks({ x: 0.2, y: 0.4 }, { x: 0.205, y: 0.405 }, 'left');
  const right2 = buildSyntheticHandLandmarks({ x: 0.8, y: 0.6 }, { x: 0.805, y: 0.605 }, 'right');
  const frame2 = tracker.update(
    [
      { handedness: 'left', landmarks: left2 },
      { handedness: 'right', landmarks: right2 },
    ],
    1050,
  );
  assert.ok(frame2.twoHandZoomDelta > 0.1);
  assert.ok(frame2.twoHandAngleDeltaDeg > 10);

  // Touch both pinched hands together -> toggles replaceCursor off
  const leftTouch = buildSyntheticHandLandmarks({ x: 0.49, y: 0.5 }, { x: 0.495, y: 0.505 }, 'left');
  const rightTouch = buildSyntheticHandLandmarks({ x: 0.51, y: 0.5 }, { x: 0.515, y: 0.505 }, 'right');
  const frameToggle = tracker.update(
    [
      { handedness: 'left', landmarks: leftTouch },
      { handedness: 'right', landmarks: rightTouch },
    ],
    2000,
  );
  assert.equal(frameToggle.replaceToggled, true);
  assert.equal(frameToggle.replaceCursor, false);
});

test('computeCamMotionGrid detects localized motion centroid and energy without ML', () => {
  const w = 24;
  const h = 18;
  const prev = new Uint8Array(w * h).fill(20);
  const curr = new Uint8Array(w * h).fill(20);

  // Paint strong motion in bottom-right quadrant
  for (let y = 12; y < 17; y++) {
    for (let x = 16; x < 22; x++) {
      curr[y * w + x] = 220;
    }
  }

  const res = computeCamMotionGrid(prev, curr, w, h, 6, 6, 20);
  assert.ok(res.energy > 0.05);
  assert.ok(res.centroid !== null);
  assert.ok((res.centroid?.x ?? 0) > 0.65);
  assert.ok((res.centroid?.y ?? 0) > 0.65);
  assert.equal(Math.round(getDistance2D({ x: 0, y: 0 }, { x: 3, y: 4 })), 5);
  assert.equal(Math.round(getAngleDeg2D({ x: 0, y: 0 }, { x: 0, y: 1 })), 90);
});
