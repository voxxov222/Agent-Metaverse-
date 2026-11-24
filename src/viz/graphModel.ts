import type {
  ActivityEvent,
  ActivityHandler,
  ActivityTargetSpec,
  GraphEdge,
  GraphNode,
  GraphTopology,
  ParsedActivity,
} from './types';

/** Deterministic seeded PRNG (Mulberry32) */
export function createSeededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic FNV-1a 32-bit string hash */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function distributeNodesAcrossLayers(totalNodes: number, customLayers?: number[]): number[] {
  if (customLayers && customLayers.length >= 2) {
    return customLayers.map((c) => Math.max(1, Math.round(c)));
  }
  const n = Math.max(10, Math.round(totalNodes));
  const input = Math.max(3, Math.round(n * 0.14));
  const output = Math.max(3, Math.round(n * 0.13));
  const hiddenTotal = Math.max(4, n - input - output);
  const h1 = Math.max(2, Math.round(hiddenTotal * 0.35));
  const h2 = Math.max(2, Math.round(hiddenTotal * 0.37));
  const h3 = Math.max(1, hiddenTotal - h1 - h2);
  return [input, h1, h2, h3, output];
}

const LAYER_BASE_COLORS = ['#0ea5e9', '#38bdf8', '#6366f1', '#8b5cf6', '#14b8a6'];

/**
 * Generates a reproducible layered 3D neural network topology:
 * input -> hidden (2-3 layers) -> output with organic jitter.
 */
export function generateLayeredGraph(options?: {
  nodeCount?: number;
  layers?: number[];
  seed?: number;
}): GraphTopology {
  const seed = options?.seed ?? 1337;
  const rng = createSeededRng(seed);
  const layerCounts = distributeNodesAcrossLayers(options?.nodeCount ?? 140, options?.layers);
  const layerCount = layerCounts.length;

  const nodes: GraphNode[] = [];
  const layerNodeIds: number[][] = [];
  const xSpan = 10.5;

  let nextNodeId = 0;
  for (let l = 0; l < layerCount; l++) {
    const count = layerCounts[l];
    const idsInLayer: number[] = [];
    const layerX = layerCount === 1 ? 0 : (l / (layerCount - 1) - 0.5) * xSpan;
    const baseHex = LAYER_BASE_COLORS[l % LAYER_BASE_COLORS.length];

    // Golden-angle disc distribution in YZ plane + organic jitter
    const radiusScale = 2.0 + Math.sin((l / Math.max(1, layerCount - 1)) * Math.PI) * 1.85;
    for (let i = 0; i < count; i++) {
      const goldenAngle = i * 2.399963229728653;
      const radial = Math.sqrt((i + 0.5) / count) * radiusScale;
      const jitterX = (rng() - 0.5) * 0.65;
      const jitterY = (rng() - 0.5) * 0.45;
      const jitterZ = (rng() - 0.5) * 0.45;

      const x = Number((layerX + jitterX).toFixed(4));
      const y = Number((Math.cos(goldenAngle) * radial + jitterY).toFixed(4));
      const z = Number((Math.sin(goldenAngle) * radial + jitterZ).toFixed(4));

      const id = nextNodeId++;
      idsInLayer.push(id);
      nodes.push({
        id,
        layer: l,
        position: [x, y, z],
        neighbors: [],
        baseColor: baseHex,
        activation: 0.12,
        state: 'idle',
      });
    }
    layerNodeIds.push(idsInLayer);
  }

  const edges: GraphEdge[] = [];
  const edgePairSet = new Set<string>();
  let nextEdgeId = 0;

  const addEdge = (srcId: number, dstId: number, weight: number) => {
    if (srcId === dstId) return;
    const key = `${srcId}->${dstId}`;
    if (edgePairSet.has(key)) return;
    edgePairSet.add(key);
    edges.push({
      id: nextEdgeId++,
      source: srcId,
      target: dstId,
      weight: Number(weight.toFixed(3)),
      activity: 0.08,
    });
    if (!nodes[srcId].neighbors.includes(dstId)) nodes[srcId].neighbors.push(dstId);
    if (!nodes[dstId].neighbors.includes(srcId)) nodes[dstId].neighbors.push(srcId);
  };

  // Connect adjacent layers with spatial proximity preference + sparse skip connections
  for (let l = 0; l < layerCount - 1; l++) {
    const srcIds = layerNodeIds[l];
    const dstIds = layerNodeIds[l + 1];

    for (const sId of srcIds) {
      const sPos = nodes[sId].position;
      // Sort destination nodes by YZ distance + small RNG perturbation
      const ranked = dstIds
        .map((dId) => {
          const dPos = nodes[dId].position;
          const dy = sPos[1] - dPos[1];
          const dz = sPos[2] - dPos[2];
          return { dId, dist: Math.hypot(dy, dz) + rng() * 1.4 };
        })
        .sort((a, b) => a.dist - b.dist);

      const fanout = Math.min(dstIds.length, 2 + Math.floor(rng() * 2));
      for (let k = 0; k < fanout; k++) {
        addEdge(sId, ranked[k].dId, 0.45 + rng() * 0.55);
      }
    }

    // Ensure every node in dstIds has at least 1 incoming edge
    for (const dId of dstIds) {
      const hasIncoming = edges.some((e) => e.target === dId);
      if (!hasIncoming) {
        const sId = srcIds[Math.floor(rng() * srcIds.length)];
        addEdge(sId, dId, 0.55 + rng() * 0.35);
      }
    }

    // Sparse lateral / skip connections (~12%)
    if (l + 2 < layerCount) {
      const skipIds = layerNodeIds[l + 2];
      for (const sId of srcIds) {
        if (rng() < 0.14) {
          const tId = skipIds[Math.floor(rng() * skipIds.length)];
          addEdge(sId, tId, 0.35 + rng() * 0.4);
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * Parses activity strings such as:
 * - "thinking"
 * - "thinking:0.8"
 * - "error@layer2"
 * - "query:0.95@layer0"
 */
export function parseActivityString(raw: string): ParsedActivity {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { type: 'idle', intensity: 0.2 };
  }

  let working = trimmed;
  let layer: number | undefined;
  const atIdx = working.indexOf('@');
  if (atIdx !== -1) {
    const targetPart = working.slice(atIdx + 1).trim().toLowerCase();
    working = working.slice(0, atIdx).trim();
    const layerMatch = targetPart.match(/layer\s*([0-9]+)|^([0-9]+)$/);
    if (layerMatch) {
      const parsedLayer = Number(layerMatch[1] ?? layerMatch[2]);
      if (Number.isFinite(parsedLayer)) layer = parsedLayer;
    }
  }

  let intensity: number | undefined;
  const colonIdx = working.indexOf(':');
  if (colonIdx !== -1) {
    const numPart = Number(working.slice(colonIdx + 1).trim());
    working = working.slice(0, colonIdx).trim();
    if (Number.isFinite(numPart)) {
      intensity = Math.max(0.05, Math.min(1.5, numPart));
    }
  }

  const normalizedType = working.toLowerCase() || 'idle';
  return {
    type: normalizedType,
    intensity: intensity ?? defaultIntensityForType(normalizedType),
    layer,
  };
}

function defaultIntensityForType(type: string): number {
  switch (type) {
    case 'idle':
      return 0.18;
    case 'thinking':
    case 'processing':
      return 0.72;
    case 'query':
    case 'input':
    case 'response':
    case 'output':
      return 0.85;
    case 'tool':
    case 'retrieval':
    case 'memory':
      return 0.8;
    case 'success':
      return 0.9;
    case 'warning':
      return 0.85;
    case 'error':
      return 1.0;
    default:
      return 0.75;
  }
}

export function normalizeActivityInput(
  input: string | ActivityEvent | Array<string | ActivityEvent>,
): ParsedActivity[] {
  const list = Array.isArray(input) ? input : [input];
  return list.map((item) => {
    if (typeof item === 'string') {
      return parseActivityString(item);
    }
    const baseParsed = parseActivityString(item.type || 'idle');
    return {
      type: baseParsed.type,
      intensity: item.intensity ?? baseParsed.intensity,
      layer: item.layer ?? baseParsed.layer,
      nodeIds: item.nodeIds,
      duration: item.duration,
      meta: item.meta,
    };
  });
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const lig = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/**
 * Deterministic stable cluster selection for a keyword/activity string.
 */
export function selectDeterministicCluster(
  key: string,
  graph: GraphTopology,
  clusterSize = 12,
  preferredLayer?: number,
): number[] {
  if (graph.nodes.length === 0) return [];
  if (preferredLayer !== undefined) {
    const layerNodes = graph.nodes.filter((n) => n.layer === preferredLayer).map((n) => n.id);
    if (layerNodes.length > 0) return layerNodes;
  }
  const h = hashString(key);
  const count = Math.min(graph.nodes.length, Math.max(4, clusterSize));
  const startIdx = h % graph.nodes.length;
  const seedNode = graph.nodes[startIdx];
  const selected = new Set<number>([seedNode.id]);

  // Grow cluster via deterministic BFS over neighbors
  const queue = [seedNode.id];
  while (queue.length > 0 && selected.size < count) {
    const curr = queue.shift()!;
    const node = graph.nodes.find((n) => n.id === curr);
    if (!node) continue;
    for (const nb of node.neighbors) {
      if (!selected.has(nb)) {
        selected.add(nb);
        queue.push(nb);
        if (selected.size >= count) break;
      }
    }
  }
  let cursor = (startIdx + 7) % graph.nodes.length;
  while (selected.size < count) {
    selected.add(graph.nodes[cursor].id);
    cursor = (cursor + 3) % graph.nodes.length;
  }
  return Array.from(selected);
}

export function resolveActivitySpec(
  parsed: ParsedActivity,
  graph: GraphTopology,
  customMap?: Record<string, ActivityHandler>,
): ActivityTargetSpec {
  const maxLayer = graph.nodes.reduce((m, n) => Math.max(m, n.layer), 0);
  const layerIds = (layerIdx: number) =>
    graph.nodes.filter((n) => n.layer === Math.max(0, Math.min(maxLayer, layerIdx))).map((n) => n.id);

  let spec: ActivityTargetSpec;
  const type = parsed.type;

  if (type === 'idle') {
    spec = {
      color: '#14b8a6',
      edgeOpacity: 0.15,
      pulseSpeed: 0.45,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 2200,
      attackMs: 550,
      propagationDirection: 'radial',
      nodeIds: parsed.nodeIds ?? graph.nodes.slice(0, Math.min(18, graph.nodes.length)).map((n) => n.id),
      priority: 1,
    };
  } else if (type === 'thinking' || type === 'processing') {
    const midLayer = Math.floor(maxLayer / 2);
    spec = {
      color: '#a855f7',
      edgeOpacity: 0.54,
      pulseSpeed: 1.45,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 3800,
      attackMs: 420,
      propagationDirection: 'radial',
      nodeIds:
        parsed.nodeIds ??
        (parsed.layer !== undefined ? layerIds(parsed.layer) : layerIds(midLayer)),
      priority: 3,
    };
  } else if (type === 'query' || type === 'input') {
    spec = {
      color: '#22d3ee',
      edgeOpacity: 0.68,
      pulseSpeed: 1.85,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 3400,
      attackMs: 320,
      propagationDirection: 'forward',
      nodeIds: parsed.nodeIds ?? layerIds(parsed.layer ?? 0),
      priority: 4,
    };
  } else if (type === 'response' || type === 'output') {
    spec = {
      color: '#38bdf8',
      edgeOpacity: 0.72,
      pulseSpeed: 1.95,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 3400,
      attackMs: 340,
      propagationDirection: 'backward',
      nodeIds: parsed.nodeIds ?? layerIds(parsed.layer ?? maxLayer),
      priority: 4,
    };
  } else if (type === 'tool' || type === 'retrieval' || type === 'memory') {
    const hueColor = type === 'tool' ? '#10b981' : type === 'retrieval' ? '#60a5fa' : '#f472b6';
    spec = {
      color: hueColor,
      edgeOpacity: 0.66,
      pulseSpeed: 1.65,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 3600,
      attackMs: 380,
      propagationDirection: 'cluster',
      nodeIds:
        parsed.nodeIds ?? selectDeterministicCluster(type, graph, 14, parsed.layer),
      priority: 4,
    };
  } else if (type === 'success') {
    spec = {
      color: '#22c55e',
      edgeOpacity: 0.74,
      pulseSpeed: 1.75,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 3200,
      attackMs: 300,
      propagationDirection: 'radial',
      nodeIds:
        parsed.nodeIds ??
        (parsed.layer !== undefined ? layerIds(parsed.layer) : layerIds(maxLayer)),
      priority: 5,
    };
  } else if (type === 'warning') {
    spec = {
      color: '#f59e0b',
      edgeOpacity: 0.78,
      pulseSpeed: 2.1,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 3600,
      attackMs: 340,
      propagationDirection: 'radial',
      nodeIds:
        parsed.nodeIds ??
        (parsed.layer !== undefined
          ? layerIds(parsed.layer)
          : selectDeterministicCluster('warning', graph, 16)),
      priority: 6,
    };
  } else if (type === 'error') {
    spec = {
      color: '#ef4444',
      edgeOpacity: 0.92,
      pulseSpeed: 2.6,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 4200,
      attackMs: 300,
      propagationDirection: 'radial',
      shake: 0.85,
      nodeIds:
        parsed.nodeIds ??
        (parsed.layer !== undefined
          ? layerIds(parsed.layer)
          : selectDeterministicCluster('error', graph, 18)),
      priority: 8,
    };
  } else {
    // Unknown string -> deterministic hash to stable node subset + hue
    const h = hashString(type);
    const hue = h % 360;
    spec = {
      color: hslToHex(hue, 78, 58),
      edgeOpacity: 0.56,
      pulseSpeed: 1.45,
      intensity: parsed.intensity,
      durationMs: parsed.duration ?? 2200,
      attackMs: 400,
      propagationDirection: 'cluster',
      nodeIds:
        parsed.nodeIds ?? selectDeterministicCluster(type, graph, 14, parsed.layer),
      priority: 3,
    };
  }

  // Apply custom activity handler overrides if registered
  const customHandler = customMap?.[type];
  if (customHandler) {
    const patch = customHandler(parsed, graph);
    spec = {
      ...spec,
      ...patch,
      nodeIds: patch.nodeIds ?? spec.nodeIds,
    };
  }

  return spec;
}

/**
 * BFS hop distances from a set of seed nodes across graph edges.
 */
export function computeHopDistances(
  seedNodeIds: number[],
  graph: GraphTopology,
  direction: 'forward' | 'backward' | 'radial' | 'cluster' = 'radial',
): Map<number, number> {
  const distMap = new Map<number, number>();
  if (seedNodeIds.length === 0 || graph.nodes.length === 0) return distMap;

  const adj = new Map<number, number[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) {
    if (direction === 'forward') {
      adj.get(e.source)?.push(e.target);
    } else if (direction === 'backward') {
      adj.get(e.target)?.push(e.source);
    } else {
      adj.get(e.source)?.push(e.target);
      adj.get(e.target)?.push(e.source);
    }
  }

  const queue: number[] = [];
  for (const id of seedNodeIds) {
    if (!distMap.has(id)) {
      distMap.set(id, 0);
      queue.push(id);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const currDist = distMap.get(curr) ?? 0;
    const neighbors = adj.get(curr) ?? [];
    for (const nb of neighbors) {
      if (!distMap.has(nb)) {
        distMap.set(nb, currDist + 1);
        queue.push(nb);
      }
    }
  }

  return distMap;
}

/** Smooth attack (300-600ms) + exponential-feel release envelope */
export function evaluateEnvelope(
  ageMs: number,
  attackMs: number,
  durationMs: number,
): number {
  if (ageMs <= 0) return 0;
  if (ageMs >= durationMs) return 0;
  const safeAttack = Math.max(250, Math.min(600, attackMs));
  if (ageMs < safeAttack) {
    const t = ageMs / safeAttack;
    return t * t * (3 - 2 * t); // smoothstep attack
  }
  const releaseSpan = Math.max(200, durationMs - safeAttack);
  const r = (ageMs - safeAttack) / releaseSpan;
  return Math.pow(1 - r, 1.65);
}
