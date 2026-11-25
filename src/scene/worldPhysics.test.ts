import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorldObject } from '../types/os';
import {
  computeSupportTopY,
  getPropColliderDimensions,
  WorldPhysicsEngine,
} from './worldPhysics';

function makeProp(overrides: Partial<WorldObject> & { id: string }): WorldObject {
  const now = Date.now();
  return {
    kind: 'quantum-crate',
    label: overrides.id,
    position: [0, 0, 0],
    rotationY: 0,
    color: '#22d3ee',
    ownerCallsign: 'Tester',
    motion: 'static',
    scale: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('Cannon.js physics drops an elevated prop under gravity onto the ground plane', () => {
  const engine = new WorldPhysicsEngine('earth');
  const cube = makeProp({ id: 'crate-drop', position: [5, 3.5, 5] });
  engine.syncObjects([cube]);

  let lastPose = engine.step(1 / 60).poses[0];
  for (let i = 0; i < 180; i++) {
    lastPose = engine.step(1 / 60).poses[0];
  }

  assert.ok(lastPose.position[1] < 0.05, `Expected cube to land on ground, got y=${lastPose.position[1]}`);
});

test('Cannon.js physics supports realistic stacking of a crate atop a workstation desk and collapses when desk moves', () => {
  const engine = new WorldPhysicsEngine('earth');
  const desk = makeProp({
    id: 'desk-base',
    kind: 'workstation-desk',
    position: [6, 0, 6],
  });
  const [, deskH] = getPropColliderDimensions('workstation-desk', 1);

  const upperCrate = makeProp({
    id: 'crate-top',
    kind: 'quantum-crate',
    position: [6, deskH + 1.5, 6],
  });

  engine.syncObjects([desk, upperCrate]);

  // Step 3 seconds so upper crate falls and settles squarely atop the desk
  let stepResult = engine.step(1 / 60);
  for (let i = 0; i < 180; i++) {
    stepResult = engine.step(1 / 60);
  }

  const deskPose = stepResult.poses.find((p) => p.id === 'desk-base')!;
  const cratePose = stepResult.poses.find((p) => p.id === 'crate-top')!;

  assert.ok(deskPose.position[1] < 0.05, 'Desk rests on ground');
  assert.ok(
    Math.abs(cratePose.position[1] - deskH) < 0.12,
    `Expected upper crate stacked at desk top ~${deskH}m, got ${cratePose.position[1]}m`,
  );

  // Move the supporting desk away -> stacked crate must fall down to ground under gravity
  engine.beginDrag('desk-base');
  engine.setDragTarget('desk-base', 12, 0.2, 6, 0);
  engine.endDrag('desk-base');

  for (let i = 0; i < 180; i++) {
    stepResult = engine.step(1 / 60);
  }
  const fallenCrate = stepResult.poses.find((p) => p.id === 'crate-top')!;
  assert.ok(
    fallenCrate.position[1] < 0.08,
    `Expected crate to fall to ground after support removed, got y=${fallenCrate.position[1]}`,
  );
});

test('computeSupportTopY computes stacked height footprint accurately', () => {
  const desk = makeProp({ id: 'd1', kind: 'workstation-desk', position: [4, 0, 4] });
  const crate = makeProp({ id: 'c1', kind: 'quantum-crate', position: [4, 0.82, 4] });
  const top = computeSupportTopY(4.1, 4.1, null, [desk, crate]);
  assert.ok(top > 1.7 && top < 1.85, `Expected combined stack height ~1.78m, got ${top}`);
  assert.equal(computeSupportTopY(-10, -10, null, [desk, crate]), 0);
});

test('new 3D computer rigs and architectural structures expose accurate colliders and preserve settled poses across syncObjects', () => {
  const engine = new WorldPhysicsEngine('earth');
  const rigDims = getPropColliderDimensions('quantum-workstation', 1);
  const holoDims = getPropColliderDimensions('holo-terrain-table', 1);
  const archDims = getPropColliderDimensions('arch-portal', 1);
  assert.ok(rigDims[0] > 2 && holoDims[2] > 2 && archDims[1] > 3);

  const crateA = makeProp({ id: 'cA', kind: 'quantum-crate', position: [-3, 1.5, 4] });
  engine.syncObjects([crateA]);
  for (let i = 0; i < 180; i++) engine.step(0.05);

  const landedY = engine.step(1 / 60).poses[0].position[1];
  assert.ok(landedY < 0.05, `crateA should rest on floor, got y=${landedY}`);

  // Adding a second prop while crateA still lists spawn height in client state must not teleport crateA back up
  const crateB = makeProp({ id: 'cB', kind: 'quantum-crate', position: [-3, 2.8, 4] });
  engine.syncObjects([crateA, crateB]);
  const crateAAfter = engine.step(1 / 60).poses.find((p) => p.id === 'cA')!;
  assert.ok(crateAAfter.position[1] < 0.08, `crateA should stay grounded, got y=${crateAAfter.position[1]}`);
});
