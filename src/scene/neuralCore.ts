import * as THREE from 'three';
import type { NeuralRegion, NeuralRegionId } from '../types/os';

export interface NeuralCoreHandle {
  group: THREE.Group;
  interactables: THREE.Object3D[];
  triggerPulse: (regionId: NeuralRegionId, fromPos?: THREE.Vector3, colorHex?: string) => void;
  update: (elapsed: number, delta: number, regions: NeuralRegion[]) => void;
  dispose: () => void;
}

const REGION_META: Array<{ id: NeuralRegionId; offset: [number, number, number]; color: string }> = [
  { id: 'reasoning-cortex', offset: [0, 0.85, 0], color: '#22D3EE' },
  { id: 'memory-lattice', offset: [-1.15, 0.05, 0.35], color: '#3B82F6' },
  { id: 'planning-engine', offset: [1.15, 0.05, 0.35], color: '#8B5CF6' },
  { id: 'tool-bus', offset: [-0.75, -0.75, -0.55], color: '#10B981' },
  { id: 'security-gate', offset: [0.75, -0.75, -0.55], color: '#F59E0B' },
];

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();

export function buildNeuralCore(isSoftwareGl: boolean): NeuralCoreHandle {
  const group = new THREE.Group();
  group.position.set(0, 3.35, 0);

  const interactables: THREE.Object3D[] = [];
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Central Pedestal Base grounded at y = 0 in world (local y = -3.35)
  const pedestalGroup = new THREE.Group();
  pedestalGroup.position.set(0, -3.35, 0);
  const plinthPoints = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(2.3, 0),
    new THREE.Vector2(2.15, 0.22),
    new THREE.Vector2(1.55, 0.38),
    new THREE.Vector2(1.38, 0.72),
    new THREE.Vector2(0.0, 0.72),
  ];
  const plinthGeo = new THREE.LatheGeometry(plinthPoints, 32);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.45,
    metalness: 0.8,
  });
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.receiveShadow = true;
  pedestalGroup.add(plinth);

  const emitterRingGeo = new THREE.TorusGeometry(1.42, 0.045, 12, 48);
  const emitterRingMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.9,
  });
  const emitterRing = new THREE.Mesh(emitterRingGeo, emitterRingMat);
  emitterRing.rotation.x = Math.PI / 2;
  emitterRing.position.y = 0.73;
  pedestalGroup.add(emitterRing);
  group.add(pedestalGroup);
  disposables.push(plinthGeo, plinthMat, emitterRingGeo, emitterRingMat);

  // 2. Inner Core with Custom GLSL ShaderMaterial (Fresnel + neural pulse wave)
  const coreGeo = new THREE.IcosahedronGeometry(0.72, 3);
  const coreMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.3 },
      uColorA: { value: new THREE.Color('#0ea5e9') },
      uColorB: { value: new THREE.Color('#8b5cf6') },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uActivity;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        float wave = sin(position.x * 5.0 + uTime * 2.4) * cos(position.y * 5.0 - uTime * 1.8) * (0.025 + uActivity * 0.045);
        vec3 displaced = position + normal * wave;
        vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
        vViewPos = -mvPos.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uActivity;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vec3 viewDir = normalize(vViewPos);
        float fresnel = pow(1.0 - max(dot(viewDir, normalize(vNormal)), 0.0), 2.4);
        float band = 0.5 + 0.5 * sin(vNormal.y * 6.0 + uTime * 2.0);
        vec3 col = mix(uColorA, uColorB, band);
        vec3 finalCol = col * (0.45 + uActivity * 0.65) + vec3(0.45, 0.9, 1.0) * fresnel * 1.3;
        gl_FragColor = vec4(finalCol, 0.92);
      }
    `,
    transparent: true,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  group.add(coreMesh);
  disposables.push(coreGeo, coreMat);

  // 3. Three Precision Gimbal Containment Rings
  const ringConfigs = [
    { radius: 1.55, tube: 0.028, tiltX: 0.45, tiltZ: 0.2, color: 0x38bdf8 },
    { radius: 1.88, tube: 0.024, tiltX: -0.6, tiltZ: 0.5, color: 0x818cf8 },
    { radius: 2.2, tube: 0.02, tiltX: 0.2, tiltZ: -0.75, color: 0x22d3ee },
  ];
  const gimbals: THREE.Mesh[] = [];
  const gimbalMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.22,
    metalness: 0.92,
  });
  disposables.push(gimbalMat);

  ringConfigs.forEach((cfg) => {
    const rGeo = new THREE.TorusGeometry(cfg.radius, cfg.tube, 10, 64);
    const rMesh = new THREE.Mesh(rGeo, gimbalMat);
    rMesh.rotation.set(cfg.tiltX, 0, cfg.tiltZ);
    group.add(rMesh);
    gimbals.push(rMesh);
    disposables.push(rGeo);
  });

  // 4. Instanced Synaptic Neural Nodes (150 nodes grouped around the 5 regions)
  const nodeCount = 150;
  const nodeGeo = new THREE.OctahedronGeometry(0.055, 0);
  const nodeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x1e293b,
    emissiveIntensity: 0.65,
    roughness: 0.25,
    metalness: 0.7,
  });
  const instancedNodes = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCount);
  const nodePositions: THREE.Vector3[] = [];
  const nodeRegions: NeuralRegionId[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const region = REGION_META[i % REGION_META.length];
    const theta = (i * 2.39996) % (Math.PI * 2);
    const phi = Math.acos(1 - (2 * ((i % 30) + 0.5)) / 30);
    const rad = 0.42 + (i % 5) * 0.14;
    const px = region.offset[0] + Math.sin(phi) * Math.cos(theta) * rad;
    const py = region.offset[1] + Math.cos(phi) * rad * 0.85;
    const pz = region.offset[2] + Math.sin(phi) * Math.sin(theta) * rad;

    const pos = new THREE.Vector3(px, py, pz);
    nodePositions.push(pos);
    nodeRegions.push(region.id);

    _dummy.position.copy(pos);
    _dummy.scale.setScalar(0.85 + (i % 4) * 0.15);
    _dummy.updateMatrix();
    instancedNodes.setMatrixAt(i, _dummy.matrix);
    _color.set(region.color);
    instancedNodes.setColorAt(i, _color);
  }
  instancedNodes.instanceMatrix.needsUpdate = true;
  if (instancedNodes.instanceColor) instancedNodes.instanceColor.needsUpdate = true;
  instancedNodes.computeBoundingSphere();
  group.add(instancedNodes);
  disposables.push(nodeGeo, nodeMat);

  // 5. Synaptic Pathway Connections (LineSegments)
  const lineVerts: number[] = [];
  const lineColors: number[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const a = nodePositions[i];
    const b = nodePositions[(i + 5) % nodeCount];
    const c = nodePositions[(i + 17) % nodeCount];
    _color.set(REGION_META[i % REGION_META.length].color);

    lineVerts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    lineColors.push(_color.r, _color.g, _color.b, _color.r, _color.g, _color.b);

    if (i % 3 === 0) {
      lineVerts.push(a.x, a.y, a.z, c.x, c.y, c.z);
      lineColors.push(_color.r, _color.g, _color.b, 0.35, 0.65, 0.95);
    }
  }
  const synGeo = new THREE.BufferGeometry();
  synGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
  synGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
  const synMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: isSoftwareGl ? 0.35 : 0.45,
  });
  const synLines = new THREE.LineSegments(synGeo, synMat);
  group.add(synLines);
  disposables.push(synGeo, synMat);

  // 6. Clickable Region Nodes (simplified invisible proxy spheres for reliable raycasting)
  const regionProxyGeo = new THREE.SphereGeometry(0.55, 12, 12);
  const regionProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  disposables.push(regionProxyGeo, regionProxyMat);

  REGION_META.forEach((reg) => {
    const proxy = new THREE.Mesh(regionProxyGeo, regionProxyMat);
    proxy.position.set(reg.offset[0], reg.offset[1], reg.offset[2]);
    proxy.userData = { kind: 'neural-region', regionId: reg.id };
    group.add(proxy);
    interactables.push(proxy);
  });

  // 7. Active Pulse Particles traveling from Agent workstations to Core
  interface PulseToken {
    mesh: THREE.Mesh;
    start: THREE.Vector3;
    end: THREE.Vector3;
    progress: number;
    active: boolean;
  }
  const pulseGeo = new THREE.SphereGeometry(0.11, 8, 8);
  const pulses: PulseToken[] = [];
  for (let i = 0; i < 12; i++) {
    const pMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.95 });
    const pMesh = new THREE.Mesh(pulseGeo, pMat);
    pMesh.visible = false;
    group.add(pMesh);
    pulses.push({
      mesh: pMesh,
      start: new THREE.Vector3(),
      end: new THREE.Vector3(),
      progress: 0,
      active: false,
    });
    disposables.push(pMat);
  }
  disposables.push(pulseGeo);

  let activityBoost = 0.25;

  return {
    group,
    interactables,
    triggerPulse: (regionId, fromWorldPos, colorHex) => {
      activityBoost = Math.min(1.0, activityBoost + 0.45);
      const reg = REGION_META.find((r) => r.id === regionId) ?? REGION_META[0];
      const slot = pulses.find((p) => !p.active) ?? pulses[0];
      slot.active = true;
      slot.progress = 0;
      slot.end.set(reg.offset[0], reg.offset[1], reg.offset[2]);
      if (fromWorldPos) {
        slot.start.copy(fromWorldPos).sub(group.position);
      } else {
        slot.start.set(0, -2.5, 0);
      }
      (slot.mesh.material as THREE.MeshBasicMaterial).color.set(colorHex || reg.color);
      slot.mesh.visible = true;
    },
    update: (elapsed, delta, regions) => {
      activityBoost = Math.max(0.2, activityBoost - delta * 0.35);
      const avgLoad =
        regions.length > 0 ? regions.reduce((acc, r) => acc + r.load, 0) / (regions.length * 100) : 0.2;

      coreMat.uniforms.uTime.value = elapsed;
      coreMat.uniforms.uActivity.value = Math.min(1, avgLoad + activityBoost);
      coreMesh.rotation.y += delta * (0.28 + activityBoost * 0.4);

      gimbals[0].rotation.y += delta * 0.32;
      gimbals[1].rotation.x -= delta * 0.24;
      gimbals[2].rotation.z += delta * 0.18;

      instancedNodes.rotation.y = Math.sin(elapsed * 0.15) * 0.18;
      synLines.rotation.y = instancedNodes.rotation.y;

      for (const p of pulses) {
        if (!p.active) continue;
        p.progress += delta * 1.45;
        if (p.progress >= 1) {
          p.active = false;
          p.mesh.visible = false;
          continue;
        }
        _vA.copy(p.start);
        _vB.copy(p.end);
        p.mesh.position.lerpVectors(_vA, _vB, p.progress);
        p.mesh.position.y += Math.sin(p.progress * Math.PI) * 0.75;
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
