import * as THREE from 'three';
import type { JarvisHologramConfig, NeuralRegion, NeuralRegionId } from '../types/os';
import {
  generateMethaneWireframe,
  generateNeuralLatticeWireframe,
  generateStarkGearWireframe,
} from '../utils/jarvisOperationsLogic';

export interface NeuralCoreHandle {
  group: THREE.Group;
  interactables: THREE.Object3D[];
  triggerPulse: (regionId: NeuralRegionId, fromPos?: THREE.Vector3, colorHex?: string) => void;
  setHologramState: (config: JarvisHologramConfig) => void;
  update: (elapsed: number, delta: number, regions: NeuralRegion[]) => void;
  dispose: () => void;
}

const REGION_META: Array<{ id: NeuralRegionId; offset: [number, number, number]; color: string }> = [
  { id: 'reasoning-cortex', offset: [0, 0.96, 0], color: '#22D3EE' },
  { id: 'memory-lattice', offset: [-1.24, 0.08, 0.42], color: '#38BDF8' },
  { id: 'planning-engine', offset: [1.24, 0.08, 0.42], color: '#A855F7' },
  { id: 'tool-bus', offset: [-0.84, -0.82, -0.6], color: '#10B981' },
  { id: 'security-gate', offset: [0.84, -0.82, -0.6], color: '#F59E0B' },
];

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();

function createHolographicDialTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    // Outer calibrated rings
    const ringRadii = [480, 445, 392, 340, 275];
    ringRadii.forEach((r, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = idx % 2 === 0 ? 'rgba(56, 189, 248, 0.72)' : 'rgba(139, 92, 246, 0.45)';
      ctx.lineWidth = idx === 0 ? 3.5 : 1.8;
      if (idx === 2) ctx.setLineDash([18, 12]);
      else ctx.setLineDash([]);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // 72 precision radial ticks + major sector callouts
    for (let i = 0; i < 72; i++) {
      const ang = (i / 72) * Math.PI * 2;
      const major = i % 6 === 0;
      const rIn = major ? 412 : 432;
      const rOut = 445;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn);
      ctx.lineTo(cx + Math.cos(ang) * rOut, cy + Math.sin(ang) * rOut);
      ctx.strokeStyle = major ? 'rgba(103, 232, 249, 0.92)' : 'rgba(56, 189, 248, 0.48)';
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.stroke();
    }

    // Segmented arc wedges
    const sectorColors = ['rgba(34,211,238,0.55)', 'rgba(168,85,247,0.5)', 'rgba(16,185,129,0.5)'];
    for (let s = 0; s < 6; s++) {
      const start = (s / 6) * Math.PI * 2 + 0.08;
      const end = ((s + 1) / 6) * Math.PI * 2 - 0.08;
      ctx.beginPath();
      ctx.arc(cx, cy, 366, start, end);
      ctx.strokeStyle = sectorColors[s % sectorColors.length];
      ctx.lineWidth = 8;
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createCircuitBusTexture(): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2;
    const cy = size / 2;

    // Isometric / orthogonal holographic PCB bus traces radiating from center
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 2.2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r1 = 155;
      const r2 = 285 + (i % 3) * 42;
      const r3 = 435;
      const x1 = cx + Math.cos(a) * r1;
      const y1 = cy + Math.sin(a) * r1;
      const x2 = cx + Math.cos(a) * r2;
      const y2 = cy + Math.sin(a) * r2;
      const aBent = a + (i % 2 === 0 ? 0.14 : -0.14);
      const x3 = cx + Math.cos(aBent) * r3;
      const y3 = cy + Math.sin(aBent) * r3;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.stroke();

      // Solder / IC node pads
      ctx.fillStyle = i % 3 === 0 ? '#a855f7' : '#67e8f9';
      ctx.beginPath();
      ctx.arc(x2, y2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeRect(x3 - 6, y3 - 6, 12, 12);
    }

    // Outer hexagonal lock frame
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = cx + Math.cos(a) * 462;
      const py = cy + Math.sin(a) * 462;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function buildNeuralCore(isSoftwareGl: boolean, maxAnisotropy = 4): NeuralCoreHandle {
  const group = new THREE.Group();
  group.position.set(0, 3.4, 0);

  const interactables: THREE.Object3D[] = [];
  const disposables: Array<{ dispose: () => void }> = [];

  // 1. Sculpted Containment Pedestal grounded at y = 0 in world (local y = -3.4)
  const pedestalGroup = new THREE.Group();
  pedestalGroup.position.set(0, -3.4, 0);

  const plinthPoints = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(2.38, 0),
    new THREE.Vector2(2.26, 0.18),
    new THREE.Vector2(1.88, 0.28),
    new THREE.Vector2(1.62, 0.44),
    new THREE.Vector2(1.46, 0.68),
    new THREE.Vector2(1.22, 0.76),
    new THREE.Vector2(0.0, 0.76),
  ];
  const plinthGeo = new THREE.LatheGeometry(plinthPoints, isSoftwareGl ? 32 : 48);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.3,
    metalness: 0.88,
  });
  const plinth = new THREE.Mesh(plinthGeo, plinthMat);
  plinth.receiveShadow = true;
  plinth.castShadow = !isSoftwareGl;
  pedestalGroup.add(plinth);
  disposables.push(plinthGeo, plinthMat);

  // Brushed titanium collar ring + glowing emitter torus
  const collarGeo = new THREE.TorusGeometry(1.52, 0.065, 16, 64);
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.16,
    metalness: 0.95,
  });
  const collar = new THREE.Mesh(collarGeo, collarMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.68;
  pedestalGroup.add(collar);

  const emitterRingGeo = new THREE.TorusGeometry(1.32, 0.042, 16, 72);
  const emitterRingMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.75,
    roughness: 0.18,
    metalness: 0.85,
  });
  const emitterRing = new THREE.Mesh(emitterRingGeo, emitterRingMat);
  emitterRing.rotation.x = Math.PI / 2;
  emitterRing.position.y = 0.77;
  pedestalGroup.add(emitterRing);
  disposables.push(collarGeo, collarMat, emitterRingGeo, emitterRingMat);

  // 6 radial holographic projector pylons around pedestal
  const pylonGeo = new THREE.BoxGeometry(0.14, 0.56, 0.22);
  const pylonTipGeo = new THREE.OctahedronGeometry(0.065, 0);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.35,
    metalness: 0.85,
  });
  const pylonTipMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
  disposables.push(pylonGeo, pylonTipGeo, pylonMat, pylonTipMat);

  // 6 Converging Quantum Beam Filaments linking pedestal projector tips into the singularity
  const beamPathLen = 2.85;
  const beamGeo = new THREE.CylinderGeometry(0.012, 0.032, beamPathLen, 8, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.34,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  disposables.push(beamGeo, beamMat);

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const pylonWrap = new THREE.Group();
    pylonWrap.position.set(Math.cos(angle) * 1.72, 0.42, Math.sin(angle) * 1.72);
    pylonWrap.rotation.y = -angle;
    const arm = new THREE.Mesh(pylonGeo, pylonMat);
    arm.rotation.z = 0.35;
    const tip = new THREE.Mesh(pylonTipGeo, pylonTipMat);
    tip.position.set(-0.12, 0.28, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(-0.78, 1.56, 0);
    beam.rotation.z = 0.46;
    pylonWrap.add(arm, tip, beam);
    pedestalGroup.add(pylonWrap);
  }

  // Holographic Calibration Dial + Circuit Motherboard Bus Plate floating above emitter
  const dialTex = createHolographicDialTexture();
  dialTex.anisotropy = maxAnisotropy;
  const dialGeo = new THREE.PlaneGeometry(3.4, 3.4);
  const dialMat = new THREE.MeshBasicMaterial({
    map: dialTex,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const dialMesh = new THREE.Mesh(dialGeo, dialMat);
  dialMesh.rotation.x = -Math.PI / 2;
  dialMesh.position.y = 0.82;
  pedestalGroup.add(dialMesh);

  const circuitTex = createCircuitBusTexture();
  circuitTex.anisotropy = maxAnisotropy;
  const circuitGeo = new THREE.PlaneGeometry(5.2, 5.2);
  const circuitMat = new THREE.MeshBasicMaterial({
    map: circuitTex,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const circuitMesh = new THREE.Mesh(circuitGeo, circuitMat);
  circuitMesh.rotation.x = -Math.PI / 2;
  circuitMesh.position.y = 0.14;
  pedestalGroup.add(circuitMesh);

  // 4 Wireframe Containment Cubes orbiting the holographic circuit deck
  const wireCubeBaseGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const wireCubeEdgesGeo = new THREE.EdgesGeometry(wireCubeBaseGeo);
  const wireCubeMat = new THREE.LineBasicMaterial({
    color: 0x818cf8,
    transparent: true,
    opacity: 0.82,
  });
  const wireCubes: THREE.LineSegments[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const wc = new THREE.LineSegments(wireCubeEdgesGeo, wireCubeMat);
    wc.position.set(Math.cos(a) * 2.48, 0.34, Math.sin(a) * 2.48);
    wc.rotation.y = a;
    pedestalGroup.add(wc);
    wireCubes.push(wc);
  }
  disposables.push(
    dialTex,
    dialGeo,
    dialMat,
    circuitTex,
    circuitGeo,
    circuitMat,
    wireCubeBaseGeo,
    wireCubeEdgesGeo,
    wireCubeMat,
  );

  // Projected Volumetric Hologram Containment Cone rising into the core
  const coneGeo = new THREE.CylinderGeometry(2.1, 1.24, 3.0, 40, 1, true);
  const coneMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.35 },
      uColor: { value: new THREE.Color('#22d3ee') },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uActivity;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      void main() {
        float verticalFade = smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
        float streaks = 0.55 + 0.45 * sin(vUv.x * 48.0 - uTime * 2.2) * cos(vUv.x * 18.0 + uTime * 1.1);
        float scanline = 0.72 + 0.28 * sin(vUv.y * 90.0 - uTime * 7.5);
        vec3 viewDir = normalize(vViewPos);
        float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 1.3);
        float alpha = verticalFade * streaks * scanline * (0.14 + uActivity * 0.14) * (0.65 + fresnel * 0.6);
        gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 0.45));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const coneMesh = new THREE.Mesh(coneGeo, coneMat);
  coneMesh.position.y = 2.28;
  pedestalGroup.add(coneMesh);
  disposables.push(coneGeo, coneMat);

  group.add(pedestalGroup);

  // 2. Super-HD Quantum Singularity Core (Subdivision 5 = 20,480 faces) with Holographic Interference Shader
  const coreDetail = isSoftwareGl ? 3 : 5;
  const coreGeo = new THREE.IcosahedronGeometry(0.76, coreDetail);
  const coreMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.35 },
      uPulseShock: { value: 0.0 },
      uColorA: { value: new THREE.Color('#06b6d4') },
      uColorB: { value: new THREE.Color('#8b5cf6') },
      uColorHot: { value: new THREE.Color('#e0f2fe') },
    },
    vertexShader: `
      uniform float uTime;
      uniform float uActivity;
      uniform float uPulseShock;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vLocalPos;
      varying float vRipple;
      void main() {
        float t = uTime;
        float n1 = sin(position.x * 6.5 + t * 2.6) * cos(position.y * 6.5 - t * 2.1);
        float n2 = cos(position.z * 9.0 + t * 3.4) * sin((position.x + position.y) * 5.0 - t * 1.7);
        float wave = (n1 * 0.65 + n2 * 0.35) * (0.022 + uActivity * 0.048 + uPulseShock * 0.055);
        vec3 displaced = position + normal * wave;
        vLocalPos = displaced;
        vRipple = n1 * 0.5 + n2 * 0.5;
        vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
        vViewPos = -mvPos.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uActivity;
      uniform float uPulseShock;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uColorHot;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vLocalPos;
      varying float vRipple;
      void main() {
        vec3 viewDir = normalize(vViewPos);
        vec3 n = normalize(vNormal);
        float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 2.1);

        // Holographic interference grid + scanline sweep
        float latLines = smoothstep(0.92, 0.99, abs(sin(vLocalPos.y * 28.0 - uTime * 3.0)));
        float lonLines = smoothstep(0.93, 0.995, abs(sin(atan(vLocalPos.z, vLocalPos.x) * 12.0 + uTime * 1.4)));
        float lattice = max(latLines, lonLines * 0.75);

        float plasmaBand = 0.5 + 0.5 * sin(vLocalPos.y * 5.2 + vRipple * 3.2 + uTime * 2.2);
        vec3 baseCol = mix(uColorA, uColorB, plasmaBand);

        vec3 finalCol =
          baseCol * (0.55 + uActivity * 0.7) +
          uColorHot * fresnel * (1.25 + uPulseShock * 0.8) +
          vec3(0.35, 0.95, 1.0) * lattice * (0.45 + uActivity * 0.5);

        float alpha = clamp(0.84 + fresnel * 0.16, 0.0, 0.98);
        gl_FragColor = vec4(finalCol, alpha);
      }
    `,
    transparent: true,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  group.add(coreMesh);
  disposables.push(coreGeo, coreMat);

  // 3. Dual Counter-Rotating Holographic Containment Shells
  const innerLatticeGeo = new THREE.IcosahedronGeometry(1.06, 2);
  const innerLatticeMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const innerLattice = new THREE.Mesh(innerLatticeGeo, innerLatticeMat);
  group.add(innerLattice);
  disposables.push(innerLatticeGeo, innerLatticeMat);

  const outerShellGeo = new THREE.SphereGeometry(1.36, 48, 32);
  const outerShellMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.35 },
      uColor: { value: new THREE.Color('#22d3ee') },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uActivity;
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vViewPos;
      varying vec3 vLocal;
      void main() {
        vec3 viewDir = normalize(vViewPos);
        float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), 2.6);
        float scan = smoothstep(0.84, 0.99, sin(vLocal.y * 36.0 - uTime * 5.0));
        float eqBand = smoothstep(0.18, 0.0, abs(vLocal.y));
        float alpha = (fresnel * 0.42 + scan * 0.14 + eqBand * 0.16) * (0.6 + uActivity * 0.65);
        gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 0.65));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const outerShell = new THREE.Mesh(outerShellGeo, outerShellMat);
  outerShell.renderOrder = 2;
  group.add(outerShell);
  disposables.push(outerShellGeo, outerShellMat);

  // 4. Four Articulated Precision Gimbal Rings + 16 Orbital Satellite Nodes
  const ringConfigs = [
    { radius: 1.58, tube: 0.026, tiltX: 0.42, tiltZ: 0.18, color: 0x38bdf8 },
    { radius: 1.88, tube: 0.024, tiltX: -0.58, tiltZ: 0.48, color: 0x818cf8 },
    { radius: 2.18, tube: 0.02, tiltX: 0.22, tiltZ: -0.72, color: 0x22d3ee },
    { radius: 2.48, tube: 0.018, tiltX: -0.18, tiltZ: 0.88, color: 0xa855f7 },
  ];
  const gimbals: THREE.Group[] = [];
  const gimbalMetalMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.15,
    metalness: 0.94,
  });
  disposables.push(gimbalMetalMat);

  const satGeo = new THREE.OctahedronGeometry(0.052, 0);
  const satMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
  disposables.push(satGeo, satMat);

  ringConfigs.forEach((cfg) => {
    const rGroup = new THREE.Group();
    rGroup.rotation.set(cfg.tiltX, 0, cfg.tiltZ);

    const rGeo = new THREE.TorusGeometry(cfg.radius, cfg.tube, 14, 96);
    const rMesh = new THREE.Mesh(rGeo, gimbalMetalMat);
    rGroup.add(rMesh);

    const glowGeo = new THREE.TorusGeometry(cfg.radius - cfg.tube * 1.4, 0.008, 8, 72);
    const glowMat = new THREE.MeshBasicMaterial({
      color: cfg.color,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
    });
    const glowRing = new THREE.Mesh(glowGeo, glowMat);
    rGroup.add(glowRing);

    // 4 orbital micro-nodes mounted symmetrically on each gimbal ring
    for (let s = 0; s < 4; s++) {
      const a = (s / 4) * Math.PI * 2;
      const sat = new THREE.Mesh(satGeo, satMat);
      sat.position.set(Math.cos(a) * cfg.radius, Math.sin(a) * cfg.radius, 0);
      rGroup.add(sat);
    }

    group.add(rGroup);
    gimbals.push(rGroup);
    disposables.push(rGeo, glowGeo, glowMat);
  });

  // 4B. Dashed Tactical Planetary Lock Ring + 12 Rising Data Spire Columns above Core Crown
  const lockRingGeo = new THREE.RingGeometry(1.52, 1.62, 72);
  const lockRingMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.35 },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uActivity;
      varying vec3 vPos;
      void main() {
        float ang = atan(vPos.y, vPos.x);
        float seg = step(0.42, fract(ang * 4.45 - uTime * 0.65));
        if (seg < 0.5) discard;
        vec3 col = mix(vec3(0.96, 0.28, 0.42), vec3(0.14, 0.86, 0.96), 0.5 + 0.5 * sin(ang * 3.0 + uTime));
        gl_FragColor = vec4(col, 0.72 + uActivity * 0.25);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const lockRing = new THREE.Mesh(lockRingGeo, lockRingMat);
  lockRing.rotation.x = Math.PI / 2;
  lockRing.position.y = 0.28;
  group.add(lockRing);
  disposables.push(lockRingGeo, lockRingMat);

  const spireCount = 12;
  const spireGeo = new THREE.CylinderGeometry(0.032, 0.018, 0.62, 6);
  const spireMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.78,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const spireInst = new THREE.InstancedMesh(spireGeo, spireMat, spireCount);
  spireInst.frustumCulled = false;
  group.add(spireInst);
  disposables.push(spireGeo, spireMat);

  // 5. Holographic Cortex Region Anchors (visible glowing crystal anchors + halos + click proxies)
  const regionProxyGeo = new THREE.SphereGeometry(0.58, 12, 12);
  const regionProxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const anchorCrystalGeo = new THREE.OctahedronGeometry(0.14, 0);
  const anchorHaloGeo = new THREE.TorusGeometry(0.24, 0.015, 8, 32);
  disposables.push(regionProxyGeo, regionProxyMat, anchorCrystalGeo, anchorHaloGeo);

  const regionVisuals = new Map<
    NeuralRegionId,
    { anchor: THREE.Group; halo: THREE.Mesh; mat: THREE.MeshStandardMaterial }
  >();

  REGION_META.forEach((reg) => {
    const anchor = new THREE.Group();
    anchor.position.set(reg.offset[0], reg.offset[1], reg.offset[2]);

    const mat = new THREE.MeshStandardMaterial({
      color: reg.color,
      emissive: reg.color,
      emissiveIntensity: 1.5,
      roughness: 0.18,
      metalness: 0.5,
    });
    const crystal = new THREE.Mesh(anchorCrystalGeo, mat);
    const halo = new THREE.Mesh(anchorHaloGeo, mat);
    halo.rotation.x = Math.PI / 2;
    anchor.add(crystal, halo);
    group.add(anchor);
    disposables.push(mat);
    regionVisuals.set(reg.id, { anchor, halo, mat });

    const proxy = new THREE.Mesh(regionProxyGeo, regionProxyMat);
    proxy.position.set(reg.offset[0], reg.offset[1], reg.offset[2]);
    proxy.userData = { kind: 'neural-region', regionId: reg.id };
    group.add(proxy);
    interactables.push(proxy);
  });

  // 6. Instanced Synaptic Neural Nodes (240 crystalline nodes breathing & scaling dynamically)
  const nodeCount = 240;
  const nodeGeo = new THREE.OctahedronGeometry(0.052, 0);
  const nodeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.85,
    roughness: 0.18,
    metalness: 0.75,
  });
  const instancedNodes = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCount);
  const nodePositions: THREE.Vector3[] = [];
  const nodeRegions: NeuralRegionId[] = [];
  const nodeBaseScales: number[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const region = REGION_META[i % REGION_META.length];
    const theta = (i * 2.39996) % (Math.PI * 2);
    const phi = Math.acos(1 - (2 * ((i % 48) + 0.5)) / 48);
    const rad = 0.42 + (i % 6) * 0.13;
    const px = region.offset[0] + Math.sin(phi) * Math.cos(theta) * rad;
    const py = region.offset[1] + Math.cos(phi) * rad * 0.88;
    const pz = region.offset[2] + Math.sin(phi) * Math.sin(theta) * rad;

    const pos = new THREE.Vector3(px, py, pz);
    nodePositions.push(pos);
    nodeRegions.push(region.id);
    const s = 0.72 + (i % 5) * 0.15;
    nodeBaseScales.push(s);

    _dummy.position.copy(pos);
    _dummy.scale.setScalar(s);
    _dummy.updateMatrix();
    instancedNodes.setMatrixAt(i, _dummy.matrix);
    _color.set(region.color);
    instancedNodes.setColorAt(i, _color);
  }
  instancedNodes.instanceMatrix.needsUpdate = true;
  if (instancedNodes.instanceColor) instancedNodes.instanceColor.needsUpdate = true;
  instancedNodes.computeBoundingSphere();
  instancedNodes.frustumCulled = false;
  group.add(instancedNodes);
  disposables.push(nodeGeo, nodeMat);

  // 7. Animated Custom-Shader Synaptic Filaments (Light packets racing along edges)
  const lineVerts: number[] = [];
  const lineColors: number[] = [];
  const lineProgress: number[] = [];
  const linePhase: number[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const a = nodePositions[i];
    const b = nodePositions[(i + 5) % nodeCount];
    const c = nodePositions[(i + 19) % nodeCount];
    _color.set(REGION_META[i % REGION_META.length].color);
    const ph = (i * 0.37) % 1.0;

    lineVerts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    lineColors.push(_color.r, _color.g, _color.b, _color.r, _color.g, _color.b);
    lineProgress.push(0, 1);
    linePhase.push(ph, ph);

    if (i % 2 === 0) {
      lineVerts.push(a.x, a.y, a.z, c.x, c.y, c.z);
      lineColors.push(_color.r, _color.g, _color.b, 0.45, 0.82, 1.0);
      lineProgress.push(0, 1);
      linePhase.push((ph + 0.5) % 1.0, (ph + 0.5) % 1.0);
    }
  }
  const synGeo = new THREE.BufferGeometry();
  synGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
  synGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
  synGeo.setAttribute('aProgress', new THREE.Float32BufferAttribute(lineProgress, 1));
  synGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(linePhase, 1));

  const synMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.35 },
    },
    vertexShader: `
      attribute float aProgress;
      attribute float aPhase;
      attribute vec3 color;
      varying float vProgress;
      varying float vPhase;
      varying vec3 vColor;
      void main() {
        vProgress = aProgress;
        vPhase = aPhase;
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uActivity;
      varying float vProgress;
      varying float vPhase;
      varying vec3 vColor;
      void main() {
        float speed = 0.45 + uActivity * 1.15;
        float packet = pow(max(0.0, 1.0 - abs(fract(vProgress - uTime * speed + vPhase) - 0.5) * 5.0), 3.0);
        float alpha = (0.18 + uActivity * 0.22) + packet * (0.6 + uActivity * 0.4);
        vec3 col = mix(vColor, vec3(0.82, 0.98, 1.0), packet * 0.75);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const synLines = new THREE.LineSegments(synGeo, synMat);
  group.add(synLines);
  disposables.push(synGeo, synMat);

  // 8. Quantum Accretion Micro-Glyph Particle Halo (280 glowing motes)
  const moteCount = isSoftwareGl ? 140 : 280;
  const motePositions = new Float32Array(moteCount * 3);
  const motePhases = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const theta = (i / moteCount) * Math.PI * 2 * 5;
    const rad = 1.65 + (i % 13) * 0.12;
    const height = (Math.sin(i * 1.7) * 0.9);
    motePositions[i * 3] = Math.cos(theta) * rad;
    motePositions[i * 3 + 1] = height;
    motePositions[i * 3 + 2] = Math.sin(theta) * rad;
    motePhases[i] = (i * 0.13) % (Math.PI * 2);
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(motePhases, 1));
  const moteMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0.35 },
    },
    vertexShader: `
      attribute float aPhase;
      uniform float uTime;
      varying float vTwinkle;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * 1.5 + aPhase) * 0.14;
        vTwinkle = 0.55 + 0.45 * sin(uTime * 3.0 + aPhase * 2.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (18.0 + 14.0 * vTwinkle) / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uActivity;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float glow = smoothstep(0.5, 0.05, d);
        vec3 col = mix(vec3(0.22, 0.78, 0.98), vec3(0.75, 0.52, 0.98), vTwinkle);
        gl_FragColor = vec4(col, glow * (0.45 + uActivity * 0.45));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const motePoints = new THREE.Points(moteGeo, moteMat);
  group.add(motePoints);
  disposables.push(moteGeo, moteMat);

  // 9. Expanding Holographic Shockwave Ring + Active Agent Pulse Particles
  const shockGeo = new THREE.RingGeometry(0.95, 1.08, 48);
  const shockMat = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shockRing = new THREE.Mesh(shockGeo, shockMat);
  shockRing.rotation.x = Math.PI / 2;
  shockRing.visible = false;
  group.add(shockRing);
  disposables.push(shockGeo, shockMat);

  interface PulseToken {
    mesh: THREE.Mesh;
    start: THREE.Vector3;
    end: THREE.Vector3;
    progress: number;
    active: boolean;
  }
  const pulseGeo = new THREE.SphereGeometry(0.12, 10, 10);
  const pulses: PulseToken[] = [];
  for (let i = 0; i < 14; i++) {
    const pMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
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

  // 10. JARVIS 3D Hologram Wireframe Projector (Methane / Stark Gear / Subnet Topology / Explode + Thermal Heatmap)
  const holoGroup = new THREE.Group();
  holoGroup.position.set(0, 1.52, 0);
  holoGroup.visible = false;
  group.add(holoGroup);

  const holoLineMat = new THREE.LineBasicMaterial({
    color: 0x00d2ff,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const holoNodeGeo = new THREE.SphereGeometry(0.068, 10, 10);
  const holoNodeMat = new THREE.MeshBasicMaterial({
    color: 0x64ffda,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(holoLineMat, holoNodeGeo, holoNodeMat);

  let holoState: JarvisHologramConfig = {
    model: 'neural-lattice',
    title: 'Central Neural Lattice',
    explodeFactor: 0,
    heatmap: false,
  };
  let holoBaseVerts: Array<[number, number, number]> = [];
  let holoConnections: Array<[number, number]> = [];
  let holoLineGeo: THREE.BufferGeometry | null = null;
  let holoLineMesh: THREE.LineSegments | null = null;
  let holoNodesMesh: THREE.InstancedMesh | null = null;
  let holoPosAttr: Float32Array | null = null;
  let holoTargetExplode = 0;
  let holoCurrentExplode = 0;

  function rebuildHoloGeometry(cfg: JarvisHologramConfig) {
    if (holoLineMesh) {
      holoGroup.remove(holoLineMesh);
      holoLineMesh = null;
    }
    if (holoLineGeo) {
      holoLineGeo.dispose();
      holoLineGeo = null;
    }
    if (holoNodesMesh) {
      holoGroup.remove(holoNodesMesh);
      holoNodesMesh.dispose();
      holoNodesMesh = null;
    }

    if (cfg.customVertices && cfg.customConnections && cfg.customVertices.length > 0) {
      holoBaseVerts = cfg.customVertices;
      holoConnections = cfg.customConnections;
    } else if (cfg.model === 'methane') {
      const m = generateMethaneWireframe();
      holoBaseVerts = m.vertices;
      holoConnections = m.connections;
    } else if (cfg.model === 'stark-gear') {
      const g = generateStarkGearWireframe(12);
      holoBaseVerts = g.vertices;
      holoConnections = g.connections;
    } else {
      const n = generateNeuralLatticeWireframe();
      holoBaseVerts = n.vertices;
      holoConnections = n.connections;
    }

    const segFloats = new Float32Array(Math.max(1, holoConnections.length) * 6);
    holoPosAttr = segFloats;
    holoLineGeo = new THREE.BufferGeometry();
    holoLineGeo.setAttribute('position', new THREE.BufferAttribute(segFloats, 3));
    holoLineMesh = new THREE.LineSegments(holoLineGeo, holoLineMat);
    holoGroup.add(holoLineMesh);

    const vCount = Math.max(1, holoBaseVerts.length);
    holoNodesMesh = new THREE.InstancedMesh(holoNodeGeo, holoNodeMat, vCount);
    holoNodesMesh.frustumCulled = false;
    holoGroup.add(holoNodesMesh);
  }

  function applyHoloDeformation(explode: number, heatmap: boolean) {
    holoGroup.visible = holoState.model !== 'neural-lattice' || explode > 0.015 || heatmap;
    if (!holoGroup.visible || !holoPosAttr || !holoLineGeo || !holoNodesMesh) return;

    const expScale = 1 + explode * 1.15;
    holoLineMat.color.set(heatmap ? '#ff8c32' : '#00d2ff');
    holoNodeMat.color.set(heatmap ? '#f43f5e' : '#64ffda');

    for (let i = 0; i < holoBaseVerts.length; i++) {
      const v = holoBaseVerts[i];
      const vx = v[0] * expScale * 1.65;
      const vy = v[1] * expScale * 1.65;
      const vz = v[2] * expScale * 1.65;
      _dummy.position.set(vx, vy, vz);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.setScalar(i === 0 ? 1.35 : 0.95);
      _dummy.updateMatrix();
      holoNodesMesh.setMatrixAt(i, _dummy.matrix);
    }
    holoNodesMesh.instanceMatrix.needsUpdate = true;

    for (let c = 0; c < holoConnections.length; c++) {
      const [aIdx, bIdx] = holoConnections[c];
      const va = holoBaseVerts[aIdx] ?? holoBaseVerts[0];
      const vb = holoBaseVerts[bIdx] ?? holoBaseVerts[0];
      const base = c * 6;
      holoPosAttr[base] = va[0] * expScale * 1.65;
      holoPosAttr[base + 1] = va[1] * expScale * 1.65;
      holoPosAttr[base + 2] = va[2] * expScale * 1.65;
      holoPosAttr[base + 3] = vb[0] * expScale * 1.65;
      holoPosAttr[base + 4] = vb[1] * expScale * 1.65;
      holoPosAttr[base + 5] = vb[2] * expScale * 1.65;
    }
    const attr = holoLineGeo.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    holoLineGeo.computeBoundingSphere();
  }

  let activityBoost = 0.25;
  let shockProgress = 1.0;

  return {
    group,
    interactables,
    setHologramState: (cfg) => {
      const topologyChanged =
        cfg.model !== holoState.model ||
        Boolean(cfg.customVertices && cfg.customVertices.length !== holoBaseVerts.length) ||
        Boolean(cfg.customConnections && cfg.customConnections.length !== holoConnections.length) ||
        !holoLineGeo;
      holoState = cfg;
      holoTargetExplode = Math.max(0, Math.min(1, cfg.explodeFactor ?? 0));
      if (topologyChanged) {
        rebuildHoloGeometry(cfg);
      }
      applyHoloDeformation(holoCurrentExplode, Boolean(cfg.heatmap));
    },
    triggerPulse: (regionId, fromWorldPos, colorHex) => {
      activityBoost = Math.min(1.0, activityBoost + 0.55);
      shockProgress = 0;
      shockRing.visible = true;
      shockMat.color.set(colorHex || '#67e8f9');

      const reg = REGION_META.find((r) => r.id === regionId) ?? REGION_META[0];
      const slot = pulses.find((p) => !p.active) ?? pulses[0];
      slot.active = true;
      slot.progress = 0;
      slot.end.set(reg.offset[0], reg.offset[1], reg.offset[2]);
      if (fromWorldPos) {
        slot.start.copy(fromWorldPos).sub(group.position);
      } else {
        slot.start.set(0, -2.55, 0);
      }
      (slot.mesh.material as THREE.MeshBasicMaterial).color.set(colorHex || reg.color);
      slot.mesh.visible = true;
    },
    update: (elapsed, delta, regions) => {
      activityBoost = Math.max(0.2, activityBoost - delta * 0.35);
      const avgLoad =
        regions.length > 0 ? regions.reduce((acc, r) => acc + r.load, 0) / (regions.length * 100) : 0.24;
      const totalAct = Math.min(1, avgLoad + activityBoost);

      // Update holographic shaders
      coreMat.uniforms.uTime.value = elapsed;
      coreMat.uniforms.uActivity.value = totalAct;
      coreMat.uniforms.uPulseShock.value = Math.max(0, 1.0 - shockProgress);
      coneMat.uniforms.uTime.value = elapsed;
      coneMat.uniforms.uActivity.value = totalAct;
      outerShellMat.uniforms.uTime.value = elapsed;
      outerShellMat.uniforms.uActivity.value = totalAct;
      lockRingMat.uniforms.uTime.value = elapsed;
      lockRingMat.uniforms.uActivity.value = totalAct;
      synMat.uniforms.uTime.value = elapsed;
      synMat.uniforms.uActivity.value = totalAct;
      moteMat.uniforms.uTime.value = elapsed;
      moteMat.uniforms.uActivity.value = totalAct;
      beamMat.opacity = 0.22 + totalAct * 0.28;

      // Smooth JARVIS hologram explode transition & rotation
      if (Math.abs(holoCurrentExplode - holoTargetExplode) > 0.002) {
        holoCurrentExplode += (holoTargetExplode - holoCurrentExplode) * Math.min(1, delta * 8);
        applyHoloDeformation(holoCurrentExplode, Boolean(holoState.heatmap));
      }
      if (holoGroup.visible) {
        holoGroup.rotation.y += delta * 0.48;
        holoGroup.rotation.x = Math.sin(elapsed * 0.55) * 0.16;
      }

      // Core & shells kinetic rotations
      coreMesh.rotation.y += delta * (0.32 + totalAct * 0.45);
      coreMesh.rotation.x = Math.sin(elapsed * 0.45) * 0.14;

      innerLattice.rotation.y -= delta * 0.28;
      innerLattice.rotation.z += delta * 0.16;
      const breath = 1.0 + Math.sin(elapsed * 2.1) * 0.03 + totalAct * 0.04;
      innerLattice.scale.setScalar(breath);

      outerShell.rotation.y += delta * 0.15;
      dialMesh.rotation.z += delta * 0.18;
      circuitMesh.rotation.z -= delta * 0.09;
      lockRing.rotation.z -= delta * 0.26;

      for (let i = 0; i < wireCubes.length; i++) {
        wireCubes[i].rotation.y += delta * 0.65;
        wireCubes[i].position.y = 0.34 + Math.sin(elapsed * 2.2 + i * 1.4) * 0.08;
      }

      // 12 Rising Holographic Data Spire Bars orbiting above the core crown
      for (let i = 0; i < spireCount; i++) {
        const ang = (i / spireCount) * Math.PI * 2 + elapsed * 0.28;
        const rad = i % 2 === 0 ? 0.56 : 0.34;
        const hScale = 0.65 + 0.75 * (0.5 + 0.5 * Math.sin(elapsed * 3.1 + i * 0.7)) * (0.6 + totalAct);
        _dummy.position.set(
          Math.cos(ang) * rad,
          1.34 + Math.sin(elapsed * 2.4 + i) * 0.12,
          Math.sin(ang) * rad,
        );
        _dummy.rotation.set(0, -ang, 0);
        _dummy.scale.set(1, hScale, 1);
        _dummy.updateMatrix();
        spireInst.setMatrixAt(i, _dummy.matrix);
      }
      spireInst.instanceMatrix.needsUpdate = true;

      // 4 Gimbal containment rings counter-rotation
      gimbals[0].rotation.y += delta * 0.42;
      gimbals[1].rotation.x -= delta * 0.31;
      gimbals[2].rotation.z += delta * 0.24;
      gimbals[3].rotation.y -= delta * 0.19;
      gimbals[3].rotation.x += delta * 0.12;

      motePoints.rotation.y += delta * 0.14;

      // Region load map & anchor animations
      const loadByRegion = new Map<NeuralRegionId, number>();
      for (const r of regions) {
        loadByRegion.set(r.id, Math.max(0.15, Math.min(1, r.load / 100)));
      }
      for (const [regId, vis] of regionVisuals.entries()) {
        const l = loadByRegion.get(regId) ?? 0.25;
        vis.anchor.rotation.y += delta * (0.7 + l * 1.4);
        vis.halo.rotation.z += delta * (1.2 + l * 2.0);
        vis.anchor.scale.setScalar(0.9 + l * 0.45 + Math.sin(elapsed * 3.5) * 0.06);
        vis.mat.emissiveIntensity = 1.1 + l * 1.3;
      }

      // Dynamic instanced cortex node breathing
      const rotY = Math.sin(elapsed * 0.16) * 0.22;
      instancedNodes.rotation.y = rotY;
      synLines.rotation.y = rotY;

      for (let i = 0; i < nodeCount; i++) {
        const regLoad = loadByRegion.get(nodeRegions[i]) ?? 0.25;
        const pulse = 1.0 + Math.sin(elapsed * 2.6 + i * 0.41) * (0.14 + regLoad * 0.25);
        _dummy.position.copy(nodePositions[i]);
        _dummy.rotation.set(elapsed * 0.5 + i * 0.1, elapsed * 0.7 + i * 0.2, 0);
        _dummy.scale.setScalar(nodeBaseScales[i] * pulse);
        _dummy.updateMatrix();
        instancedNodes.setMatrixAt(i, _dummy.matrix);
      }
      instancedNodes.instanceMatrix.needsUpdate = true;

      // Shockwave ring expansion
      if (shockProgress < 1.0) {
        shockProgress = Math.min(1.0, shockProgress + delta * 1.35);
        const s = 1.0 + shockProgress * 2.8;
        shockRing.scale.setScalar(s);
        shockMat.opacity = (1.0 - shockProgress) * 0.72;
        if (shockProgress >= 1.0) {
          shockRing.visible = false;
        }
      }

      // Active agent pulse particles traveling into cortex
      for (const p of pulses) {
        if (!p.active) continue;
        p.progress += delta * 1.5;
        if (p.progress >= 1) {
          p.active = false;
          p.mesh.visible = false;
          continue;
        }
        _vA.copy(p.start);
        _vB.copy(p.end);
        p.mesh.position.lerpVectors(_vA, _vB, p.progress);
        p.mesh.position.y += Math.sin(p.progress * Math.PI) * 0.85;
        const pScale = 1.0 + Math.sin(p.progress * Math.PI) * 0.6;
        p.mesh.scale.setScalar(pScale);
      }
    },
    dispose: () => {
      if (holoLineGeo) holoLineGeo.dispose();
      if (holoNodesMesh) holoNodesMesh.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}
