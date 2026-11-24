# NeuralNetworkViz

A production-grade, framework-agnostic Three.js (`r160+`, ES modules, TypeScript) 3D neural network visualization component with an extensible activity propagation engine, instanced node & edge shaders, synaptic light packets, post-processing bloom (with automatic software-WebGL fallback), and a thin React wrapper (`<NeuralNetworkView />`).

## Installation

Peer dependencies required in your project:

```bash
npm install three @types/three
# Optional (only when using <NeuralNetworkView />)
npm install react react-dom
```

Import from `src/viz`:

```ts
import { NeuralNetworkViz, NeuralNetworkView } from './viz';
```

## Vanilla Usage

```ts
import { NeuralNetworkViz } from './viz';

const container = document.getElementById('viz-root')!;
const viz = new NeuralNetworkViz(container, {
  nodeCount: 140,
  seed: 1337,
  bloomStrength: 0.85,
  propagationFalloff: 0.72,
  hopDelayMs: 75,
});

// Trigger built-in or compound activity strings
viz.updateActivity('query');
viz.updateActivity('thinking:0.85');
viz.updateActivity('error@layer2');
viz.updateActivity(['tool', 'memory:0.7']);

// Inspect graph & state
console.log(viz.getState());
console.log(viz.getNeighbors(0, 2));

// Clean up on unmount
viz.dispose();
```

## React Usage (`<NeuralNetworkView />`)

```tsx
import { useRef } from 'react';
import { NeuralNetworkView, type NeuralNetworkVizHandle } from './viz';

export function BrainMonitor() {
  const vizRef = useRef<NeuralNetworkVizHandle>(null);

  return (
    <div style={{ width: '100%', height: 420 }}>
      <NeuralNetworkView
        ref={vizRef}
        options={{ nodeCount: 140, bloomStrength: 0.9 }}
        source={{ type: 'ws', url: 'wss://example.com/ws' }}
        onNodeClick={({ node, connectedEdgeIds }) => {
          console.log('Clicked node', node?.id, 'edges:', connectedEdgeIds.length);
        }}
      />
      <button onClick={() => vizRef.current?.updateActivity('thinking:0.9')}>
        Trigger Thinking
      </button>
    </div>
  );
}
```

## Activity String Grammar

| Input | Effect |
| --- | --- |
| `idle` | Cool teal ambient state, edge opacity `0.15`, slow breathing pulses |
| `thinking` / `processing` | Violet/magenta wave across hidden layers |
| `query` / `input` | Cyan flash from input layer (`layer 0`) propagating forward |
| `response` / `output` | Sky-blue brightness wave propagating backward from output layer |
| `tool` / `retrieval` / `memory` | Distinct emerald/blue/pink hues targeting a stable deterministic node cluster |
| `success` | Green wave easing back toward idle |
| `warning` | Amber alert pulse |
| `error` | Crimson flash with subtle camera shake (suppressed under `prefers-reduced-motion`) |
| `thinking:0.8` | Sets intensity to `0.8` |
| `error@layer2` | Targets layer `2` specifically |
| `<any-unknown-string>` | Deterministically hashed (FNV-1a) to a consistent hue and connected node cluster |

## Custom Activities

```ts
viz.registerActivity('deploy', (event, graph) => ({
  color: '#34d399',
  edgeOpacity: 0.85,
  pulseSpeed: 2.2,
  propagationDirection: 'forward',
  nodeIds: graph.nodes.filter((n) => n.layer >= 2).map((n) => n.id),
}));
```

## `VizOptions` Reference

| Option | Default | Description |
| --- | --- | --- |
| `nodeCount` | `140` | Total nodes generated when `layers` is omitted |
| `layers` | `[18,36,38,30,18]` (scaled) | Explicit node counts per layer |
| `seed` | `1337` | Seeded RNG for reproducible topology |
| `bloomStrength` | `0.85` | `UnrealBloomPass` intensity |
| `enableBloom` | `true` | Enables `UnrealBloomPass` (auto-skipped on software WebGL) |
| `propagationFalloff` | `0.72` | Per-hop excitation decay multiplier (`0.4`–`0.92`) |
| `hopDelayMs` | `75` | Per-hop travel delay in milliseconds |
| `idleDecayMs` | `3600` | Quiet period before emitting idle state |
| `autoRotate` | `true` | Slow damped OrbitControls auto-rotation |
| `backgroundColor` | `'#05060f'` | Scene background & exponential fog hex |
| `maxDpr` | `2` | Upper DPR cap |
| `rateLimitMs` | `16` | Coalescing flush interval for high-rate bursts |
| `activityMap` | `{}` | Initial custom activity handler registry |

## Wiring Real AI Streams (`connect`)

`viz.connect(source)` accepts:
- A live `WebSocket` instance or `{ type: 'ws', url }` (with automatic exponential-backoff reconnect)
- A live `EventSource` instance or `{ type: 'sse', url, eventName? }` (SSE with reconnect)
- Any `AsyncIterable<string | ActivityEvent>` (e.g. an LLM token/tool-call generator)
- Any `EventTarget` emitting `'activity'` or `'neural:activity'` `CustomEvent`s
