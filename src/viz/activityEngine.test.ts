import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeHopDistances,
  evaluateEnvelope,
  generateLayeredGraph,
  normalizeActivityInput,
  parseActivityString,
  resolveActivitySpec,
  selectDeterministicCluster,
} from './graphModel';

test('generateLayeredGraph is reproducible with the same seed and preserves layer structure', () => {
  const g1 = generateLayeredGraph({ nodeCount: 140, seed: 1337 });
  const g2 = generateLayeredGraph({ nodeCount: 140, seed: 1337 });
  const g3 = generateLayeredGraph({ nodeCount: 140, seed: 9999 });

  assert.equal(g1.nodes.length, 140);
  assert.deepEqual(g1.nodes[0].position, g2.nodes[0].position);
  assert.notDeepEqual(g1.nodes[0].position, g3.nodes[0].position);

  const layers = new Set(g1.nodes.map((n) => n.layer));
  assert.equal(layers.size, 5);
  assert.ok(g1.edges.length >= 140, 'layered graph should have dense forward connectivity');
});

test('parseActivityString handles simple, case-insensitive, and compound strings', () => {
  const simple = parseActivityString('THINKING');
  assert.equal(simple.type, 'thinking');
  assert.ok(simple.intensity > 0.5);

  const weighted = parseActivityString('thinking:0.8');
  assert.equal(weighted.type, 'thinking');
  assert.equal(weighted.intensity, 0.8);

  const targeted = parseActivityString('error@layer2');
  assert.equal(targeted.type, 'error');
  assert.equal(targeted.layer, 2);

  const combined = parseActivityString('query:1.15@layer0');
  assert.equal(combined.type, 'query');
  assert.equal(combined.intensity, 1.15);
  assert.equal(combined.layer, 0);
});

test('unknown activity strings hash deterministically to a stable node subset and hue', () => {
  const graph = generateLayeredGraph({ nodeCount: 120, seed: 42 });
  const a = resolveActivitySpec(parseActivityString('custom-anomaly-xyz'), graph);
  const b = resolveActivitySpec(parseActivityString('custom-anomaly-xyz'), graph);
  const c = resolveActivitySpec(parseActivityString('different-signal-abc'), graph);

  assert.equal(a.color, b.color);
  assert.deepEqual(a.nodeIds, b.nodeIds);
  assert.ok(a.nodeIds.length >= 4);
  assert.notEqual(a.color, c.color);
});

test('custom activityMap overrides default spec cleanly', () => {
  const graph = generateLayeredGraph({ nodeCount: 80, seed: 7 });
  const spec = resolveActivitySpec(parseActivityString('deploy'), graph, {
    deploy: (_ev, g) => ({
      color: '#00ffaa',
      edgeOpacity: 0.92,
      nodeIds: g.nodes.filter((n) => n.layer === 4).map((n) => n.id),
    }),
  });
  assert.equal(spec.color, '#00ffaa');
  assert.equal(spec.edgeOpacity, 0.92);
  assert.ok(spec.nodeIds.every((id) => graph.nodes[id].layer === 4));
});

test('computeHopDistances propagates forward along directed edges with increasing hop depth', () => {
  const graph = generateLayeredGraph({ nodeCount: 60, seed: 101 });
  const inputLayerNodes = graph.nodes.filter((n) => n.layer === 0).map((n) => n.id);
  const hops = computeHopDistances(inputLayerNodes, graph, 'forward');

  for (const id of inputLayerNodes) {
    assert.equal(hops.get(id), 0);
  }
  const outputLayerNodes = graph.nodes.filter((n) => n.layer === 4).map((n) => n.id);
  const reachedOutput = outputLayerNodes.some((id) => {
    const d = hops.get(id);
    return d !== undefined && d >= 2;
  });
  assert.ok(reachedOutput, 'excitation from input layer should reach output layer over hops');
});

test('evaluateEnvelope smoothly attacks and decays back to zero', () => {
  assert.equal(evaluateEnvelope(-10, 400, 2000), 0);
  const midAttack = evaluateEnvelope(200, 400, 2000);
  const peak = evaluateEnvelope(400, 400, 2000);
  const tail = evaluateEnvelope(1500, 400, 2000);
  const end = evaluateEnvelope(2000, 400, 2000);

  assert.ok(midAttack > 0 && midAttack < peak);
  assert.ok(peak > 0.95);
  assert.ok(tail > 0 && tail < peak);
  assert.equal(end, 0);
});

test('normalizeActivityInput handles batch strings and explicit ActivityEvent arrays', () => {
  const out = normalizeActivityInput([
    'query:0.9',
    { type: 'tool', intensity: 0.65, layer: 2, nodeIds: [1, 2, 3] },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'query');
  assert.equal(out[0].intensity, 0.9);
  assert.equal(out[1].type, 'tool');
  assert.equal(out[1].layer, 2);
  assert.deepEqual(out[1].nodeIds, [1, 2, 3]);
});

test('selectDeterministicCluster stays consistent across repeated calls', () => {
  const graph = generateLayeredGraph({ nodeCount: 90, seed: 55 });
  const c1 = selectDeterministicCluster('retrieval', graph, 10);
  const c2 = selectDeterministicCluster('retrieval', graph, 10);
  assert.deepEqual(c1, c2);
  assert.equal(c1.length, 10);
});
