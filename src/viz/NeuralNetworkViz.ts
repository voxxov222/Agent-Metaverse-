import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  computeHopDistances,
  evaluateEnvelope,
  generateLayeredGraph,
  normalizeActivityInput,
  resolveActivitySpec,
} from './graphModel';
import {
  EDGE_FRAGMENT_SHADER,
  EDGE_VERTEX_SHADER,
  NODE_FRAGMENT_SHADER,
  NODE_VERTEX_SHADER,
} from './shaders';
import type {
  ActivityEvent,
  ActivityHandler,
  ActivityTargetSpec,
  ConnectionHandle,
  ConnectSource,
  GraphEdge,
  GraphNode,
  GraphTopology,
  NeuralNetworkVizHandle,
  ParsedActivity,
  VizAggregateState,
  VizEventMap,
  VizOptions,
} from './types';

interface ActiveWave {
  id: number;
  parsed: ParsedActivity;
  spec: ActivityTargetSpec;
  color: THREE.Color;
  startedAt: number;
  hopDistances: Map<number, number>;
}

interface ManualNodeOverride {
  color?: THREE.Color;
  intensity?: number;
  state?: string;
}

interface ManualEdgeOverride {
  color?: THREE.Color;
  opacity?: number;
  activity?: number;
}

// Pre-allocated scratch math objects (zero GC in render loop)
const _dummy = new THREE.Object3D();
const _tmpColor = new THREE.Color();
const _idleEdgeColor = new THREE.Color('#1e4f6e');
const _selectColor = new THREE.Color('#f8fafc');
const _shakeOffset = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return true;
    const ext = probe.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
    const gpu = String(probe.getParameter(param));
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export class NeuralNetworkViz implements NeuralNetworkVizHandle {
  private container: HTMLElement;
  private options: Required<
    Pick<
      VizOptions,
      | 'nodeCount'
      | 'seed'
      | 'bloomStrength'
      | 'bloomRadius'
      | 'bloomThreshold'
      | 'enableBloom'
      | 'propagationFalloff'
      | 'hopDelayMs'
      | 'idleDecayMs'
      | 'autoRotate'
      | 'autoRotateSpeed'
      | 'backgroundColor'
      | 'maxDpr'
      | 'rateLimitMs'
    >
  > & { layers?: number[]; reducedMotion?: boolean };

  private isSoftwareGl: boolean;
  private reducedMotion: boolean;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bloomSupported = false;

  // Graph & lookup structures
  private graph: GraphTopology;
  private nodeById = new Map<number, GraphNode>();
  private edgeById = new Map<number, GraphEdge>();
  private nodeIdToIndex = new Map<number, number>();
  private edgeIdToIndex = new Map<number, number>();
  private edgesByNodeId = new Map<number, number[]>();

  // Three.js Graph Objects & Typed Buffer Attributes (mutated in-place)
  private networkGroup = new THREE.Group();
  private nodeGeo!: THREE.SphereGeometry;
  private nodeMat!: THREE.ShaderMaterial;
  private nodeMesh: THREE.InstancedMesh | null = null;
  private nodeColorsAttr!: THREE.InstancedBufferAttribute;
  private nodeIntensityAttr!: THREE.InstancedBufferAttribute;
  private nodePhaseAttr!: THREE.InstancedBufferAttribute;
  private nodeBaseColors: THREE.Color[] = [];

  private edgeGeo: THREE.BufferGeometry | null = null;
  private edgeMat!: THREE.ShaderMaterial;
  private edgeLines: THREE.LineSegments | null = null;
  private edgeColorsAttr!: THREE.BufferAttribute;
  private edgeOpacityAttr!: THREE.BufferAttribute;
  private edgeActivityAttr!: THREE.BufferAttribute;

  // Activity Engine State
  private customActivities: Record<string, ActivityHandler> = {};
  private activeWaves: ActiveWave[] = [];
  private nextWaveId = 1;
  private lastActivityAt = performance.now();
  private pendingQueue: ParsedActivity[] = [];
  private lastFlushAt = 0;
  private lastStateBroadcastAt = 0;

  // Manual overrides & selection
  private manualNodes = new Map<number, ManualNodeOverride>();
  private manualEdges = new Map<number, ManualEdgeOverride>();
  private selectedNodeId: number | null = null;
  private hoveredNodeId: number | null = null;
  private selectedConnectedNodes = new Set<number>();
  private selectedConnectedEdges = new Set<number>();

  // Camera Focus Tween
  private tweenActive = false;
  private tweenCamStart = new THREE.Vector3();
  private tweenCamGoal = new THREE.Vector3();
  private tweenTargetStart = new THREE.Vector3();
  private tweenTargetGoal = new THREE.Vector3();
  private tweenStartedAt = 0;
  private tweenDurationMs = 700;

  // Interaction & Observers
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private lastRaycastAt = 0;
  private pointerDownPos = { x: 0, y: 0 };
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private motionMediaQuery: MediaQueryList | null = null;

  // Lifecycle & Performance
  private frameId = 0;
  private disposed = false;
  private contextLost = false;
  private tabHidden = typeof document !== 'undefined' ? document.hidden : false;
  private isOffscreen = false;
  private startTimeMs = performance.now();
  private lastFrameMs = performance.now();
  private avgFrameMs = 16.6;
  private qualityTier: 'high' | 'medium' | 'low' = 'high';
  private activeConnections = new Set<ConnectionHandle>();
  private listeners: { [K in keyof VizEventMap]: Set<(payload: VizEventMap[K]) => void> } = {
    nodeHover: new Set(),
    nodeClick: new Set(),
    activity: new Set(),
    stateChange: new Set(),
  };

  constructor(container: HTMLElement, options: VizOptions = {}) {
    if (!container) {
      throw new Error('NeuralNetworkViz requires a valid container HTMLElement.');
    }
    this.container = container;
    this.options = {
      nodeCount: options.nodeCount ?? 140,
      layers: options.layers,
      seed: options.seed ?? 1337,
      bloomStrength: options.bloomStrength ?? 0.85,
      bloomRadius: options.bloomRadius ?? 0.45,
      bloomThreshold: options.bloomThreshold ?? 0.25,
      enableBloom: options.enableBloom ?? true,
      propagationFalloff: Math.max(0.4, Math.min(0.92, options.propagationFalloff ?? 0.72)),
      hopDelayMs: options.hopDelayMs ?? 75,
      idleDecayMs: options.idleDecayMs ?? 3600,
      autoRotate: options.autoRotate ?? true,
      autoRotateSpeed: options.autoRotateSpeed ?? 0.45,
      backgroundColor: options.backgroundColor ?? '#05060f',
      maxDpr: Math.min(2, options.maxDpr ?? 2),
      rateLimitMs: options.rateLimitMs ?? 16,
      reducedMotion: options.reducedMotion,
    };

    if (options.activityMap) {
      for (const [k, fn] of Object.entries(options.activityMap)) {
        this.customActivities[k.toLowerCase()] = fn;
      }
    }

    this.isSoftwareGl = detectSoftwareWebGL();
    this.motionMediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.reducedMotion = this.options.reducedMotion ?? Boolean(this.motionMediaQuery?.matches);

    this.graph = generateLayeredGraph({
      nodeCount: this.options.nodeCount,
      layers: this.options.layers,
      seed: this.options.seed,
    });

    this.initScene();
    this.rebuildGraphMeshes();
    this.bindEvents();
    this.updateActivity('idle');
    this.startLoop();
  }

  private initScene(): void {
    const width = Math.max(1, this.container.clientWidth || 640);
    const height = Math.max(1, this.container.clientHeight || 420);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
      preserveDrawingBuffer: this.isSoftwareGl,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    const dpr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, this.options.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.dataset.testid = 'neural-viz-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.backgroundColor);
    this.scene.fog = new THREE.FogExp2(this.options.backgroundColor, 0.025);
    this.scene.add(this.networkGroup);

    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 180);
    this.camera.position.set(0, 1.8, 11.4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = !this.isSoftwareGl && this.options.autoRotate && !this.reducedMotion;
    this.controls.autoRotateSpeed = this.options.autoRotateSpeed;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 32;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.nodeGeo = new THREE.SphereGeometry(0.145, this.isSoftwareGl ? 10 : 16, this.isSoftwareGl ? 8 : 12);
    this.nodeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDriftAmp: { value: 0.055 },
        uReducedMotion: { value: this.reducedMotion ? 1 : 0 },
      },
      vertexShader: NODE_VERTEX_SHADER,
      fragmentShader: NODE_FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.edgeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPulseDensity: { value: 1.0 },
        uReducedMotion: { value: this.reducedMotion ? 1 : 0 },
      },
      vertexShader: EDGE_VERTEX_SHADER,
      fragmentShader: EDGE_FRAGMENT_SHADER,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    // Post-processing UnrealBloomPass (skipped on software WebGL or if unsupported)
    if (this.options.enableBloom && !this.isSoftwareGl) {
      try {
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene, this.camera);
        this.composer.addPass(renderPass);
        this.bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          this.options.bloomStrength,
          this.options.bloomRadius,
          this.options.bloomThreshold,
        );
        this.composer.addPass(this.bloomPass);
        this.bloomSupported = true;
      } catch {
        this.composer = null;
        this.bloomPass = null;
        this.bloomSupported = false;
      }
    }
  }

  private indexTopology(): void {
    this.nodeById.clear();
    this.edgeById.clear();
    this.nodeIdToIndex.clear();
    this.edgeIdToIndex.clear();
    this.edgesByNodeId.clear();
    this.nodeBaseColors = [];

    this.graph.nodes.forEach((n, idx) => {
      this.nodeById.set(n.id, n);
      this.nodeIdToIndex.set(n.id, idx);
      this.edgesByNodeId.set(n.id, []);
      this.nodeBaseColors.push(new THREE.Color(n.baseColor));
    });

    this.graph.edges.forEach((e, idx) => {
      this.edgeById.set(e.id, e);
      this.edgeIdToIndex.set(e.id, idx);
      this.edgesByNodeId.get(e.source)?.push(e.id);
      this.edgesByNodeId.get(e.target)?.push(e.id);
    });
  }

  private rebuildGraphMeshes(): void {
    this.indexTopology();

    if (this.nodeMesh) {
      this.networkGroup.remove(this.nodeMesh);
      this.nodeMesh.geometry.dispose();
      this.nodeMesh = null;
    }
    if (this.edgeLines) {
      this.networkGroup.remove(this.edgeLines);
      this.edgeGeo?.dispose();
      this.edgeLines = null;
      this.edgeGeo = null;
    }

    const nCount = Math.max(1, this.graph.nodes.length);
    const nodeGeoInstance = this.nodeGeo.clone();
    const colors = new Float32Array(nCount * 3);
    const intensities = new Float32Array(nCount);
    const phases = new Float32Array(nCount);

    this.graph.nodes.forEach((node, idx) => {
      _tmpColor.set(node.baseColor);
      colors[idx * 3] = _tmpColor.r;
      colors[idx * 3 + 1] = _tmpColor.g;
      colors[idx * 3 + 2] = _tmpColor.b;
      intensities[idx] = node.activation;
      phases[idx] = (idx * 1.618) % (Math.PI * 2);
    });

    this.nodeColorsAttr = new THREE.InstancedBufferAttribute(colors, 3);
    this.nodeColorsAttr.setUsage(THREE.DynamicDrawUsage);
    this.nodeIntensityAttr = new THREE.InstancedBufferAttribute(intensities, 1);
    this.nodeIntensityAttr.setUsage(THREE.DynamicDrawUsage);
    this.nodePhaseAttr = new THREE.InstancedBufferAttribute(phases, 1);

    nodeGeoInstance.setAttribute('aColor', this.nodeColorsAttr);
    nodeGeoInstance.setAttribute('aIntensity', this.nodeIntensityAttr);
    nodeGeoInstance.setAttribute('aPhase', this.nodePhaseAttr);

    this.nodeMesh = new THREE.InstancedMesh(nodeGeoInstance, this.nodeMat, nCount);
    this.nodeMesh.renderOrder = 2;
    this.graph.nodes.forEach((node, idx) => {
      _dummy.position.set(node.position[0], node.position[1], node.position[2]);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(1);
      _dummy.updateMatrix();
      this.nodeMesh!.setMatrixAt(idx, _dummy.matrix);
    });
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    this.nodeMesh.computeBoundingSphere();
    this.networkGroup.add(this.nodeMesh);

    // Edges LineSegments
    const eCount = this.graph.edges.length;
    const vertCount = Math.max(2, eCount * 2);
    const ePos = new Float32Array(vertCount * 3);
    const eProg = new Float32Array(vertCount);
    const eCol = new Float32Array(vertCount * 3);
    const eOpac = new Float32Array(vertCount);
    const eAct = new Float32Array(vertCount);
    const eSeed = new Float32Array(vertCount);

    for (let i = 0; i < eCount; i++) {
      const edge = this.graph.edges[i];
      const src = this.nodeById.get(edge.source);
      const dst = this.nodeById.get(edge.target);
      if (!src || !dst) continue;
      const v0 = i * 2;
      const v1 = i * 2 + 1;

      ePos[v0 * 3] = src.position[0];
      ePos[v0 * 3 + 1] = src.position[1];
      ePos[v0 * 3 + 2] = src.position[2];
      ePos[v1 * 3] = dst.position[0];
      ePos[v1 * 3 + 1] = dst.position[1];
      ePos[v1 * 3 + 2] = dst.position[2];

      eProg[v0] = 0;
      eProg[v1] = 1;

      eCol[v0 * 3] = _idleEdgeColor.r;
      eCol[v0 * 3 + 1] = _idleEdgeColor.g;
      eCol[v0 * 3 + 2] = _idleEdgeColor.b;
      eCol[v1 * 3] = _idleEdgeColor.r;
      eCol[v1 * 3 + 1] = _idleEdgeColor.g;
      eCol[v1 * 3 + 2] = _idleEdgeColor.b;

      eOpac[v0] = 0.15;
      eOpac[v1] = 0.15;
      eAct[v0] = edge.activity;
      eAct[v1] = edge.activity;

      const seedVal = ((i * 0.6180339887) % 1);
      eSeed[v0] = seedVal;
      eSeed[v1] = seedVal;
    }

    this.edgeGeo = new THREE.BufferGeometry();
    this.edgeGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    this.edgeGeo.setAttribute('aProgress', new THREE.BufferAttribute(eProg, 1));
    this.edgeColorsAttr = new THREE.BufferAttribute(eCol, 3);
    this.edgeColorsAttr.setUsage(THREE.DynamicDrawUsage);
    this.edgeOpacityAttr = new THREE.BufferAttribute(eOpac, 1);
    this.edgeOpacityAttr.setUsage(THREE.DynamicDrawUsage);
    this.edgeActivityAttr = new THREE.BufferAttribute(eAct, 1);
    this.edgeActivityAttr.setUsage(THREE.DynamicDrawUsage);

    this.edgeGeo.setAttribute('aEdgeColor', this.edgeColorsAttr);
    this.edgeGeo.setAttribute('aEdgeOpacity', this.edgeOpacityAttr);
    this.edgeGeo.setAttribute('aEdgeActivity', this.edgeActivityAttr);
    this.edgeGeo.setAttribute('aEdgeSeed', new THREE.BufferAttribute(eSeed, 1));

    this.edgeLines = new THREE.LineSegments(this.edgeGeo, this.edgeMat);
    this.edgeLines.renderOrder = 1;
    this.networkGroup.add(this.edgeLines);
  }

  // ---------- Query & Graph API ----------

  public getNode(id: number): GraphNode | undefined {
    return this.nodeById.get(id);
  }

  public getEdge(id: number): GraphEdge | undefined {
    return this.edgeById.get(id);
  }

  public getNeighbors(id: number, hops = 1): GraphNode[] {
    const start = this.nodeById.get(id);
    if (!start) return [];
    const maxHops = Math.max(1, Math.min(8, Math.floor(hops)));
    const visited = new Set<number>([id]);
    const result: GraphNode[] = [];
    const queue: Array<{ nid: number; dist: number }> = [{ nid: id, dist: 0 }];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (curr.dist >= maxHops) continue;
      const node = this.nodeById.get(curr.nid);
      if (!node) continue;
      for (const nbId of node.neighbors) {
        if (!visited.has(nbId)) {
          visited.add(nbId);
          const nb = this.nodeById.get(nbId);
          if (nb) {
            result.push(nb);
            queue.push({ nid: nbId, dist: curr.dist + 1 });
          }
        }
      }
    }
    return result;
  }

  public getLayer(n: number): GraphNode[] {
    return this.graph.nodes.filter((node) => node.layer === n);
  }

  public setGraph(topology: GraphTopology): void {
    this.graph = {
      nodes: topology.nodes.map((n) => ({ ...n, neighbors: [...n.neighbors] })),
      edges: topology.edges.map((e) => ({ ...e })),
    };
    this.activeWaves = [];
    this.manualNodes.clear();
    this.manualEdges.clear();
    this.selectedNodeId = null;
    this.hoveredNodeId = null;
    this.selectedConnectedNodes.clear();
    this.selectedConnectedEdges.clear();
    this.rebuildGraphMeshes();
    this.emitStateChange();
  }

  // ---------- Activity Engine ----------

  public registerActivity(name: string, handler: ActivityHandler): void {
    this.customActivities[name.trim().toLowerCase()] = handler;
  }

  public updateActivity(input: string | string[] | ActivityEvent | ActivityEvent[]): void {
    const normalized = normalizeActivityInput(input);
    for (const item of normalized) {
      // Coalesce identical activity events queued in the same burst window
      const existing = this.pendingQueue.find(
        (q) =>
          q.type === item.type &&
          q.layer === item.layer &&
          (!q.nodeIds || q.nodeIds.length === 0),
      );
      if (existing) {
        existing.intensity = Math.max(existing.intensity, item.intensity);
        if (item.duration) existing.duration = item.duration;
      } else {
        this.pendingQueue.push(item);
      }
    }
    this.flushQueueIfReady(true);
  }

  private flushQueueIfReady(immediate = false): void {
    if (this.pendingQueue.length === 0) return;
    const now = performance.now();
    if (!immediate && now - this.lastFlushAt < this.options.rateLimitMs) {
      return;
    }
    if (immediate && now - this.lastFlushAt < this.options.rateLimitMs && this.activeWaves.length > 6) {
      // Defer under high-rate bursts (> 50 events/s) to coalesce cleanly
      return;
    }

    this.lastFlushAt = now;
    const batch = this.pendingQueue.splice(0, 12);
    for (const parsed of batch) {
      const spec = resolveActivitySpec(parsed, this.graph, this.customActivities);
      const hopDistances = computeHopDistances(spec.nodeIds, this.graph, spec.propagationDirection);
      const wave: ActiveWave = {
        id: this.nextWaveId++,
        parsed,
        spec,
        color: new THREE.Color(spec.color),
        startedAt: now,
        hopDistances,
      };
      this.activeWaves.push(wave);
      if (this.activeWaves.length > 24) {
        // Drop lowest-priority oldest wave if bounded limit reached
        this.activeWaves.sort((a, b) => a.spec.priority - b.spec.priority || a.startedAt - b.startedAt);
        this.activeWaves.shift();
      }
      this.lastActivityAt = now;
      this.emit('activity', parsed);
    }
    this.emitStateChange();
  }

  // ---------- Direct Control & State API ----------

  public setNodeState(id: number, patch: { color?: string; intensity?: number; state?: string }): void {
    const node = this.nodeById.get(id);
    if (!node) return;
    const prev = this.manualNodes.get(id) ?? {};
    if (patch.color) prev.color = new THREE.Color(patch.color);
    if (typeof patch.intensity === 'number') prev.intensity = Math.max(0, Math.min(2, patch.intensity));
    if (patch.state) {
      prev.state = patch.state;
      node.state = patch.state;
    }
    this.manualNodes.set(id, prev);
  }

  public setEdgeState(id: number, patch: { opacity?: number; activity?: number; color?: string }): void {
    const edge = this.edgeById.get(id);
    if (!edge) return;
    const prev = this.manualEdges.get(id) ?? {};
    if (typeof patch.opacity === 'number') prev.opacity = Math.max(0, Math.min(1, patch.opacity));
    if (typeof patch.activity === 'number') prev.activity = Math.max(0, Math.min(1, patch.activity));
    if (patch.color) prev.color = new THREE.Color(patch.color);
    this.manualEdges.set(id, prev);
  }

  public pulseEdge(id: number, intensity = 1.0): void {
    const edge = this.edgeById.get(id);
    if (!edge) return;
    this.updateActivity({
      type: 'tool',
      nodeIds: [edge.source, edge.target],
      intensity,
      duration: 1400,
    });
  }

  public reset(): void {
    this.activeWaves = [];
    this.pendingQueue = [];
    this.manualNodes.clear();
    this.manualEdges.clear();
    this.selectedNodeId = null;
    this.selectedConnectedNodes.clear();
    this.selectedConnectedEdges.clear();
    this.updateActivity('idle');
  }

  public getState(): VizAggregateState {
    const layerSums = new Map<number, { sum: number; count: number }>();
    for (const node of this.graph.nodes) {
      const bucket = layerSums.get(node.layer) ?? { sum: 0, count: 0 };
      bucket.sum += node.activation;
      bucket.count += 1;
      layerSums.set(node.layer, bucket);
    }
    const maxLayer = Array.from(layerSums.keys()).reduce((a, b) => Math.max(a, b), -1);
    const perLayerActivation: number[] = [];
    for (let l = 0; l <= maxLayer; l++) {
      const b = layerSums.get(l);
      perLayerActivation.push(b && b.count > 0 ? Number((b.sum / b.count).toFixed(3)) : 0);
    }

    let dominantActivity = 'idle';
    if (this.activeWaves.length > 0) {
      let top = this.activeWaves[0];
      for (const w of this.activeWaves) {
        if (w.spec.priority >= top.spec.priority) top = w;
      }
      dominantActivity = top.parsed.type;
    }

    return {
      dominantActivity,
      perLayerActivation,
      activeEventCount: this.activeWaves.length,
      selectedNodeId: this.selectedNodeId,
      hoveredNodeId: this.hoveredNodeId,
      qualityTier: this.qualityTier,
      avgFrameMs: Number(this.avgFrameMs.toFixed(1)),
    };
  }

  public setBloomStrength(strength: number): void {
    this.options.bloomStrength = strength;
    if (this.bloomPass) {
      this.bloomPass.strength = strength;
    }
  }

  // ---------- Camera Focus Tweens ----------

  public focusNode(id: number, durationMs = 680): void {
    const node = this.nodeById.get(id);
    if (!node) return;
    this.tweenCamStart.copy(this.camera.position);
    this.tweenTargetStart.copy(this.controls.target);
    this.tweenTargetGoal.set(node.position[0], node.position[1], node.position[2]);
    this.tweenCamGoal.set(node.position[0] + 0.8, node.position[1] + 1.1, node.position[2] + 5.2);
    this.tweenDurationMs = this.reducedMotion ? 50 : Math.max(150, durationMs);
    this.tweenStartedAt = performance.now();
    this.tweenActive = true;
  }

  public focusLayer(layerIndex: number, durationMs = 700): void {
    const layerNodes = this.getLayer(layerIndex);
    if (layerNodes.length === 0) return;
    const avgX = layerNodes.reduce((s, n) => s + n.position[0], 0) / layerNodes.length;
    this.tweenCamStart.copy(this.camera.position);
    this.tweenTargetStart.copy(this.controls.target);
    this.tweenTargetGoal.set(avgX, 0, 0);
    this.tweenCamGoal.set(avgX, 1.4, 8.8);
    this.tweenDurationMs = this.reducedMotion ? 50 : Math.max(150, durationMs);
    this.tweenStartedAt = performance.now();
    this.tweenActive = true;
  }

  // ---------- Integration Layer (EventEmitter & connect adapters) ----------

  public on<K extends keyof VizEventMap>(event: K, cb: (payload: VizEventMap[K]) => void): () => void {
    this.listeners[event].add(cb);
    return () => this.off(event, cb);
  }

  public off<K extends keyof VizEventMap>(event: K, cb: (payload: VizEventMap[K]) => void): void {
    this.listeners[event].delete(cb);
  }

  private emit<K extends keyof VizEventMap>(event: K, payload: VizEventMap[K]): void {
    for (const cb of this.listeners[event]) {
      try {
        cb(payload);
      } catch {
        // isolate subscriber errors
      }
    }
  }

  private emitStateChange(): void {
    if (this.listeners.stateChange.size > 0) {
      this.emit('stateChange', this.getState());
    }
  }

  public connect(source: ConnectSource): ConnectionHandle {
    let closed = false;
    let closeImpl: () => void = () => {};

    const handle: ConnectionHandle = {
      close: () => {
        if (closed) return;
        closed = true;
        closeImpl();
        this.activeConnections.delete(handle);
      },
    };
    this.activeConnections.add(handle);

    const dispatchRaw = (raw: unknown) => {
      if (closed || raw == null) return;
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === 'string') {
            this.updateActivity(parsed);
            return;
          }
          if (parsed && typeof parsed === 'object') {
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.type === 'string') {
              // Map kernel / VCALABS WebSocket events seamlessly if emitted directly
              if (obj.type === 'neural:pulse') {
                const label = String(obj.label || '').toLowerCase();
                const reg = String(obj.regionId || '');
                const mapped =
                  label.includes('error')
                    ? 'error'
                    : label.includes('warn') || reg === 'security-gate'
                      ? 'warning'
                      : reg === 'memory-lattice'
                        ? 'memory'
                        : reg === 'tool-bus'
                          ? 'tool'
                          : reg === 'planning-engine'
                            ? 'thinking'
                            : 'query';
                this.updateActivity({
                  type: mapped,
                  intensity: Number(obj.intensity ?? 0.85),
                  meta: obj,
                });
                return;
              }
              if (obj.type === 'activity:logged' && obj.entry && typeof obj.entry === 'object') {
                const entry = obj.entry as Record<string, unknown>;
                const sev = String(entry.severity || 'info');
                const mapped =
                  sev === 'error'
                    ? 'error'
                    : sev === 'warning'
                      ? 'warning'
                      : sev === 'success'
                        ? 'success'
                        : 'thinking';
                this.updateActivity({ type: mapped, meta: entry });
                return;
              }
              this.updateActivity(obj as unknown as ActivityEvent);
              return;
            }
          }
        } catch {
          this.updateActivity(raw);
          return;
        }
        return;
      }
      if (typeof raw === 'object') {
        this.updateActivity(raw as ActivityEvent);
      }
    };

    // 1a. Existing WebSocket instance
    if (typeof WebSocket !== 'undefined' && source instanceof WebSocket) {
      const onMsg = (ev: MessageEvent) => dispatchRaw(ev.data);
      source.addEventListener('message', onMsg);
      closeImpl = () => source.removeEventListener('message', onMsg);
      return handle;
    }

    // 1b. Existing EventSource instance
    if (typeof EventSource !== 'undefined' && source instanceof EventSource) {
      const onMsg = (ev: MessageEvent) => dispatchRaw(ev.data);
      source.addEventListener('message', onMsg);
      closeImpl = () => source.removeEventListener('message', onMsg);
      return handle;
    }

    // 1c. Generic EventTarget / CustomEvent
    if (typeof EventTarget !== 'undefined' && source instanceof EventTarget) {
      const listener = (ev: Event) => {
        const detail = (ev as CustomEvent).detail;
        dispatchRaw(detail ?? (ev as MessageEvent).data ?? ev.type);
      };
      source.addEventListener('activity', listener);
      source.addEventListener('neural:activity', listener);
      closeImpl = () => {
        source.removeEventListener('activity', listener);
        source.removeEventListener('neural:activity', listener);
      };
      return handle;
    }

    // 2. AsyncIterable
    if (typeof source === 'object' && source !== null && Symbol.asyncIterator in source) {
      const iter = (source as AsyncIterable<string | ActivityEvent>)[Symbol.asyncIterator]();
      (async () => {
        try {
          while (!closed) {
            const next = await iter.next();
            if (next.done || closed) break;
            dispatchRaw(next.value);
          }
        } catch {
          // stream ended
        }
      })();
      closeImpl = () => {
        if (typeof iter.return === 'function') {
          void iter.return(undefined);
        }
      };
      return handle;
    }

    // 3. WebSocket or SSE URL
    const resolved =
      typeof source === 'string'
        ? { type: source.startsWith('ws://') || source.startsWith('wss://') ? ('ws' as const) : ('sse' as const), url: source }
        : source;

    if (typeof resolved !== 'object' || resolved === null || !('type' in resolved) || !('url' in resolved)) {
      return handle;
    }

    if (resolved.type === 'ws') {
      let ws: WebSocket | null = null;
      let reconnectTimer = 0;
      let attempt = 0;

      const openWs = () => {
        if (closed) return;
        ws = new WebSocket(resolved.url);
        ws.onopen = () => {
          attempt = 0;
        };
        ws.onmessage = (ev) => dispatchRaw(ev.data);
        ws.onclose = () => {
          if (closed) return;
          const backoff = Math.min(15000, 600 * Math.pow(1.8, attempt++));
          reconnectTimer = window.setTimeout(openWs, backoff);
        };
      };
      openWs();
      closeImpl = () => {
        clearTimeout(reconnectTimer);
        ws?.close();
      };
      return handle;
    }

    if (resolved.type === 'sse') {
      let es: EventSource | null = null;
      let reconnectTimer = 0;
      let attempt = 0;
      const evtName = 'eventName' in resolved && resolved.eventName ? resolved.eventName : 'message';

      const openSse = () => {
        if (closed) return;
        es = new EventSource(resolved.url);
        es.onopen = () => {
          attempt = 0;
        };
        es.addEventListener(evtName, (ev) => dispatchRaw((ev as MessageEvent).data));
        es.onerror = () => {
          es?.close();
          if (closed) return;
          const backoff = Math.min(15000, 800 * Math.pow(1.8, attempt++));
          reconnectTimer = window.setTimeout(openSse, backoff);
        };
      };
      openSse();
      closeImpl = () => {
        clearTimeout(reconnectTimer);
        es?.close();
      };
      return handle;
    }

    return handle;
  }

  // ---------- Events, Resize, Visibility, Context Loss ----------

  private onPointerMove = (ev: PointerEvent) => {
    const now = performance.now();
    if (now - this.lastRaycastAt < 45 || !this.nodeMesh) return;
    this.lastRaycastAt = now;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hits = this.raycaster.intersectObject(this.nodeMesh, false);
    if (hits.length > 0 && typeof hits[0].instanceId === 'number') {
      const node = this.graph.nodes[hits[0].instanceId] ?? null;
      const nextId = node ? node.id : null;
      if (nextId !== this.hoveredNodeId) {
        this.hoveredNodeId = nextId;
      }
      this.renderer.domElement.style.cursor = node ? 'pointer' : 'grab';
      this.emit('nodeHover', {
        node,
        screenX: ev.clientX - rect.left,
        screenY: ev.clientY - rect.top,
      });
    } else if (this.hoveredNodeId !== null) {
      this.hoveredNodeId = null;
      this.renderer.domElement.style.cursor = 'grab';
      this.emit('nodeHover', { node: null, screenX: 0, screenY: 0 });
    }
  };

  private onPointerDown = (ev: PointerEvent) => {
    this.pointerDownPos = { x: ev.clientX, y: ev.clientY };
  };

  private onPointerUp = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - this.pointerDownPos.x, ev.clientY - this.pointerDownPos.y) > 6) return;
    if (!this.nodeMesh) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const hits = this.raycaster.intersectObject(this.nodeMesh, false);
    if (hits.length > 0 && typeof hits[0].instanceId === 'number') {
      const node = this.graph.nodes[hits[0].instanceId] ?? null;
      if (node) {
        this.selectedNodeId = node.id;
        this.selectedConnectedNodes = new Set([node.id, ...node.neighbors]);
        this.selectedConnectedEdges = new Set(this.edgesByNodeId.get(node.id) ?? []);
        this.emit('nodeClick', {
          node,
          connectedNodeIds: Array.from(this.selectedConnectedNodes),
          connectedEdgeIds: Array.from(this.selectedConnectedEdges),
        });
        this.emitStateChange();
        return;
      }
    }
    if (this.selectedNodeId !== null) {
      this.selectedNodeId = null;
      this.selectedConnectedNodes.clear();
      this.selectedConnectedEdges.clear();
      this.emit('nodeClick', { node: null, connectedNodeIds: [], connectedEdgeIds: [] });
      this.emitStateChange();
    }
  };

  private onControlStart = () => {
    this.tweenActive = false;
  };

  private onVisibilityChange = () => {
    this.tabHidden = document.hidden;
    if (!this.tabHidden && !this.isOffscreen && !this.disposed) {
      this.lastFrameMs = performance.now();
    }
  };

  private onMotionPrefChange = (ev: MediaQueryListEvent) => {
    this.reducedMotion = this.options.reducedMotion ?? ev.matches;
    this.nodeMat.uniforms.uReducedMotion.value = this.reducedMotion ? 1 : 0;
    this.edgeMat.uniforms.uReducedMotion.value = this.reducedMotion ? 1 : 0;
    this.controls.autoRotate = !this.isSoftwareGl && this.options.autoRotate && !this.reducedMotion;
  };

  private onContextLost = (ev: Event) => {
    ev.preventDefault();
    this.contextLost = true;
  };

  private onContextRestored = () => {
    this.contextLost = false;
    this.rebuildGraphMeshes();
  };

  private handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || 640);
    const height = Math.max(1, this.container.clientHeight || 420);
    const dpr = this.getEffectiveDpr();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
    this.renderFrame();
  };

  private bindEvents(): void {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('webglcontextlost', this.onContextLost);
    dom.addEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.addEventListener('start', this.onControlStart);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.motionMediaQuery?.addEventListener('change', this.onMotionPrefChange);

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.container);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          this.isOffscreen = entries.every((e) => !e.isIntersecting);
        },
        { threshold: 0.02 },
      );
      this.intersectionObserver.observe(this.container);
    }
  }

  private getEffectiveDpr(): number {
    if (this.isSoftwareGl) return 1;
    const base = Math.min(window.devicePixelRatio || 1, this.options.maxDpr);
    if (this.qualityTier === 'low') return Math.min(1, base);
    if (this.qualityTier === 'medium') return Math.min(1.5, base);
    return base;
  }

  private updateAdaptiveQuality(dtMs: number): void {
    if (this.isSoftwareGl) return;
    this.avgFrameMs = this.avgFrameMs * 0.9 + dtMs * 0.1;
    let nextTier = this.qualityTier;
    if (this.avgFrameMs > 28) nextTier = 'low';
    else if (this.avgFrameMs > 21) nextTier = 'medium';
    else if (this.avgFrameMs < 17) nextTier = 'high';

    if (nextTier !== this.qualityTier) {
      this.qualityTier = nextTier;
      this.renderer.setPixelRatio(this.getEffectiveDpr());
      if (this.bloomPass) {
        this.bloomPass.enabled = nextTier !== 'low';
        this.bloomPass.strength =
          nextTier === 'high' ? this.options.bloomStrength : this.options.bloomStrength * 0.65;
      }
      this.edgeMat.uniforms.uPulseDensity.value = nextTier === 'low' ? 0.5 : nextTier === 'medium' ? 0.75 : 1.0;
    }
  }

  // ---------- Frame Simulation (In-Place Typed Array Updates, Zero Allocations) ----------

  private stepSimulation(now: number): void {
    this.flushQueueIfReady(false);

    // Prune expired waves & trigger idle decay if quiet
    for (let i = this.activeWaves.length - 1; i >= 0; i--) {
      if (now - this.activeWaves[i].startedAt >= this.activeWaves[i].spec.durationMs) {
        this.activeWaves.splice(i, 1);
      }
    }
    if (this.activeWaves.length === 0 && now - this.lastActivityAt > this.options.idleDecayMs) {
      this.lastActivityAt = now;
      this.updateActivity('idle');
    }

    const elapsedSec = (now - this.startTimeMs) / 1000;
    this.nodeMat.uniforms.uTime.value = elapsedSec;
    this.edgeMat.uniforms.uTime.value = elapsedSec;

    // Camera focus tween
    if (this.tweenActive) {
      const t = Math.min(1, (now - this.tweenStartedAt) / this.tweenDurationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(this.tweenCamStart, this.tweenCamGoal, ease);
      this.controls.target.lerpVectors(this.tweenTargetStart, this.tweenTargetGoal, ease);
      if (t >= 1) this.tweenActive = false;
    }

    // Subtle error camera shake (suppressed under prefers-reduced-motion)
    let shakeAmp = 0;
    for (let w = 0; w < this.activeWaves.length; w++) {
      const wave = this.activeWaves[w];
      if (wave.spec.shake) {
        const env = evaluateEnvelope(now - wave.startedAt, wave.spec.attackMs, wave.spec.durationMs);
        shakeAmp = Math.max(shakeAmp, wave.spec.shake * env);
      }
    }
    if (shakeAmp > 0.01 && !this.reducedMotion) {
      _shakeOffset.set(
        Math.sin(elapsedSec * 47) * 0.07 * shakeAmp,
        Math.cos(elapsedSec * 53) * 0.06 * shakeAmp,
        0,
      );
      this.networkGroup.position.copy(_shakeOffset);
    } else {
      this.networkGroup.position.set(0, 0, 0);
    }

    // Update Nodes in-place
    const falloff = this.options.propagationFalloff;
    const hopDelay = this.options.hopDelayMs;
    const nodeColorArr = this.nodeColorsAttr.array as Float32Array;
    const nodeIntArr = this.nodeIntensityAttr.array as Float32Array;

    for (let i = 0; i < this.graph.nodes.length; i++) {
      const node = this.graph.nodes[i];
      const baseCol = this.nodeBaseColors[i];
      let r = baseCol.r * 0.65;
      let g = baseCol.g * 0.65;
      let b = baseCol.b * 0.65;
      let activation = 0.12;
      let state = 'idle';

      for (let w = 0; w < this.activeWaves.length; w++) {
        const wave = this.activeWaves[w];
        const dist = wave.hopDistances.get(node.id);
        if (dist === undefined) continue;
        const localAge = now - wave.startedAt - dist * hopDelay;
        if (localAge <= 0) continue;
        const env = evaluateEnvelope(localAge, wave.spec.attackMs, wave.spec.durationMs);
        if (env <= 0.001) continue;
        const contrib = wave.spec.intensity * env * Math.pow(falloff, dist);
        activation += contrib;
        r += wave.color.r * contrib * 0.95;
        g += wave.color.g * contrib * 0.95;
        b += wave.color.b * contrib * 0.95;
        if (contrib > 0.25) state = wave.parsed.type;
      }

      if (this.selectedConnectedNodes.has(node.id)) {
        const boost = node.id === this.selectedNodeId ? 0.95 : 0.45;
        activation += boost;
        r += _selectColor.r * boost * 0.55;
        g += _selectColor.g * boost * 0.55;
        b += _selectColor.b * boost * 0.55;
        state = node.id === this.selectedNodeId ? 'selected' : state;
      }

      if (this.hoveredNodeId === node.id) {
        activation += 0.55;
        r += 0.35;
        g += 0.45;
        b += 0.55;
      }

      const manual = this.manualNodes.get(node.id);
      if (manual) {
        if (manual.color) {
          r = manual.color.r;
          g = manual.color.g;
          b = manual.color.b;
        }
        if (manual.intensity !== undefined) activation = manual.intensity;
        if (manual.state) state = manual.state;
      }

      node.activation = Math.min(1, activation);
      node.state = state;

      const maxComp = Math.max(1, r, g, b);
      nodeColorArr[i * 3] = r / maxComp;
      nodeColorArr[i * 3 + 1] = g / maxComp;
      nodeColorArr[i * 3 + 2] = b / maxComp;
      nodeIntArr[i] = Math.min(1.6, activation);
    }
    this.nodeColorsAttr.needsUpdate = true;
    this.nodeIntensityAttr.needsUpdate = true;

    // Update Edges in-place
    const edgeColorArr = this.edgeColorsAttr.array as Float32Array;
    const edgeOpacArr = this.edgeOpacityAttr.array as Float32Array;
    const edgeActArr = this.edgeActivityAttr.array as Float32Array;

    for (let i = 0; i < this.graph.edges.length; i++) {
      const edge = this.graph.edges[i];
      let er = _idleEdgeColor.r;
      let eg = _idleEdgeColor.g;
      let eb = _idleEdgeColor.b;
      let opacity = 0.14;
      let activity = 0.08 * edge.weight;

      for (let w = 0; w < this.activeWaves.length; w++) {
        const wave = this.activeWaves[w];
        const dSrc = wave.hopDistances.get(edge.source);
        const dDst = wave.hopDistances.get(edge.target);
        const hop =
          dSrc === undefined ? dDst : dDst === undefined ? dSrc : Math.min(dSrc, dDst);
        if (hop === undefined) continue;
        const localAge = now - wave.startedAt - hop * hopDelay;
        if (localAge <= 0) continue;
        const env = evaluateEnvelope(localAge, wave.spec.attackMs, wave.spec.durationMs);
        if (env <= 0.001) continue;
        const edgeWeight = Math.pow(falloff, hop) * env * wave.spec.intensity;
        opacity += wave.spec.edgeOpacity * edgeWeight * 0.75;
        activity += edgeWeight * wave.spec.pulseSpeed * 0.55;
        er += wave.color.r * edgeWeight;
        eg += wave.color.g * edgeWeight;
        eb += wave.color.b * edgeWeight;
      }

      if (this.selectedConnectedEdges.has(edge.id)) {
        opacity = Math.max(opacity, 0.85);
        activity = Math.max(activity, 0.82);
        er += 0.45;
        eg += 0.65;
        eb += 0.8;
      }

      const manualEdge = this.manualEdges.get(edge.id);
      if (manualEdge) {
        if (manualEdge.color) {
          er = manualEdge.color.r;
          eg = manualEdge.color.g;
          eb = manualEdge.color.b;
        }
        if (manualEdge.opacity !== undefined) opacity = manualEdge.opacity;
        if (manualEdge.activity !== undefined) activity = manualEdge.activity;
      }

      edge.activity = Math.min(1, activity);
      const norm = Math.max(1, er, eg, eb);
      const v0 = i * 2;
      const v1 = i * 2 + 1;
      edgeColorArr[v0 * 3] = er / norm;
      edgeColorArr[v0 * 3 + 1] = eg / norm;
      edgeColorArr[v0 * 3 + 2] = eb / norm;
      edgeColorArr[v1 * 3] = er / norm;
      edgeColorArr[v1 * 3 + 1] = eg / norm;
      edgeColorArr[v1 * 3 + 2] = eb / norm;

      const clampedOp = Math.min(1, opacity);
      const clampedAct = Math.min(1, activity);
      edgeOpacArr[v0] = clampedOp;
      edgeOpacArr[v1] = clampedOp;
      edgeActArr[v0] = clampedAct;
      edgeActArr[v1] = clampedAct;
    }

    this.edgeColorsAttr.needsUpdate = true;
    this.edgeOpacityAttr.needsUpdate = true;
    this.edgeActivityAttr.needsUpdate = true;

    if (now - this.lastStateBroadcastAt > 350) {
      this.lastStateBroadcastAt = now;
      this.emitStateChange();
    }
  }

  private renderFrame(): void {
    if (this.contextLost || this.disposed) return;
    if (this.composer && this.bloomSupported && this.bloomPass?.enabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext | null;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private startLoop(): void {
    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const dtMs = now - this.lastFrameMs;
      this.lastFrameMs = now;

      if (!this.tabHidden && !this.isOffscreen && !this.contextLost) {
        this.updateAdaptiveQuality(dtMs);
        this.controls.update();
        this.stepSimulation(now);
        this.renderFrame();
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    tick();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    for (const conn of Array.from(this.activeConnections)) {
      conn.close();
    }
    this.activeConnections.clear();

    const dom = this.renderer.domElement;
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('webglcontextlost', this.onContextLost);
    dom.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.controls.removeEventListener('start', this.onControlStart);

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.motionMediaQuery?.removeEventListener('change', this.onMotionPrefChange);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();

    this.controls.dispose();
    this.nodeMesh?.geometry.dispose();
    this.nodeGeo.dispose();
    this.nodeMat.dispose();
    this.edgeGeo?.dispose();
    this.edgeMat.dispose();
    this.composer?.dispose();
    this.renderer.dispose();

    if (dom.parentNode === this.container) {
      this.container.removeChild(dom);
    }

    (Object.keys(this.listeners) as Array<keyof VizEventMap>).forEach((k) => {
      this.listeners[k].clear();
    });
  }
}
