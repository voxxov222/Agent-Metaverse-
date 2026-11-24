export type NodeVisualState = 'idle' | 'active' | 'selected' | 'warning' | 'error';

export interface GraphNode {
  id: number;
  layer: number;
  position: [number, number, number];
  neighbors: number[];
  baseColor: string;
  activation: number; // 0..1
  state: NodeVisualState | string;
}

export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  weight: number; // 0..1
  activity: number; // 0..1
}

export interface GraphTopology {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ActivityEvent {
  type: string;
  nodeIds?: number[];
  layer?: number;
  intensity?: number; // 0..1+
  duration?: number; // ms total lifetime
  meta?: Record<string, unknown>;
}

export interface ParsedActivity {
  type: string;
  intensity: number;
  layer?: number;
  nodeIds?: number[];
  duration?: number;
  meta?: Record<string, unknown>;
}

export interface ActivityTargetSpec {
  color: string; // hex e.g. '#a855f7'
  edgeOpacity: number; // 0..1
  pulseSpeed: number; // multiplier e.g. 0.4..3.0
  intensity: number; // 0..1
  durationMs: number;
  attackMs: number;
  propagationDirection: 'forward' | 'backward' | 'radial' | 'cluster';
  shake?: number; // 0..1
  nodeIds: number[];
  priority: number;
}

export type ActivityHandler = (
  event: ParsedActivity,
  graph: GraphTopology,
) => Partial<ActivityTargetSpec>;

export interface VizOptions {
  nodeCount?: number; // default 140
  layers?: number[]; // e.g. [18, 36, 38, 30, 18]
  seed?: number; // default 1337
  bloomStrength?: number; // default 0.85
  bloomRadius?: number; // default 0.45
  bloomThreshold?: number; // default 0.25
  enableBloom?: boolean; // default true (auto-guarded on software WebGL)
  propagationFalloff?: number; // default 0.7 (0.6 - 0.8)
  hopDelayMs?: number; // default 75
  idleDecayMs?: number; // default 3600
  autoRotate?: boolean; // default true
  autoRotateSpeed?: number; // default 0.45
  backgroundColor?: string; // default '#05060f'
  maxDpr?: number; // capped at 2
  rateLimitMs?: number; // min interval per coalescing flush (default 16ms)
  reducedMotion?: boolean;
  activityMap?: Record<string, ActivityHandler>;
}

export interface NodeHoverPayload {
  node: GraphNode | null;
  screenX: number;
  screenY: number;
}

export interface NodeClickPayload {
  node: GraphNode | null;
  connectedNodeIds: number[];
  connectedEdgeIds: number[];
}

export interface VizAggregateState {
  dominantActivity: string;
  perLayerActivation: number[];
  activeEventCount: number;
  selectedNodeId: number | null;
  hoveredNodeId: number | null;
  qualityTier: 'high' | 'medium' | 'low';
  avgFrameMs: number;
}

export type ConnectSource =
  | EventTarget
  | AsyncIterable<string | ActivityEvent>
  | { type: 'ws'; url: string }
  | { type: 'sse'; url: string; eventName?: string }
  | string;

export interface ConnectionHandle {
  close: () => void;
}

export interface VizEventMap {
  nodeHover: NodeHoverPayload;
  nodeClick: NodeClickPayload;
  activity: ParsedActivity;
  stateChange: VizAggregateState;
}

export interface NeuralNetworkVizHandle {
  getNode: (id: number) => GraphNode | undefined;
  getEdge: (id: number) => GraphEdge | undefined;
  getNeighbors: (id: number, hops?: number) => GraphNode[];
  getLayer: (n: number) => GraphNode[];
  setGraph: (topology: GraphTopology) => void;
  updateActivity: (input: string | string[] | ActivityEvent | ActivityEvent[]) => void;
  registerActivity: (name: string, handler: ActivityHandler) => void;
  connect: (source: ConnectSource) => ConnectionHandle;
  on: <K extends keyof VizEventMap>(event: K, cb: (payload: VizEventMap[K]) => void) => () => void;
  off: <K extends keyof VizEventMap>(event: K, cb: (payload: VizEventMap[K]) => void) => void;
  getState: () => VizAggregateState;
  setNodeState: (id: number, patch: { color?: string; intensity?: number; state?: string }) => void;
  setEdgeState: (id: number, patch: { opacity?: number; activity?: number; color?: string }) => void;
  pulseEdge: (id: number, intensity?: number) => void;
  focusNode: (id: number, durationMs?: number) => void;
  focusLayer: (layerIndex: number, durationMs?: number) => void;
  setBloomStrength: (strength: number) => void;
  reset: () => void;
  dispose: () => void;
}
