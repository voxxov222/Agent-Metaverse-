import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { EnvironmentTheme, WeatherMode, WorldObject } from '../types/os';
import { computeObjectMotionTransform } from '../utils/worldEnhancements';
import { AnimatedScreenManager } from './screenMedia';
import type { ProceduralTextureSet } from './textures';
import type { PhysicsBodyPose } from './worldPhysics';

export type PrototypeKind = 'drone-chassis' | 'server-rack' | 'orbital-relay' | 'kinetic-rover';

export interface EnvironmentController {
  root: THREE.Group;
  prototypeGroup: THREE.Group;
  worldObjectInteractables: THREE.Object3D[];
  floorMesh: THREE.Mesh;
  applyTheme: (theme: EnvironmentTheme, weather: WeatherMode, timeOfDayHours: number, customSkyboxActive?: boolean) => void;
  setPrototype: (kind: PrototypeKind, primaryHex: string, metalness: number) => void;
  syncWorldObjects: (objects: WorldObject[]) => void;
  applyPhysicsPoses: (poses: PhysicsBodyPose[]) => void;
  setSelectedObjectId: (id: string | null) => void;
  setDraggingObject: (id: string | null, pos?: [number, number, number], rotationY?: number) => void;
  update: (elapsed: number, delta: number, weather: WeatherMode) => void;
  dispose: () => void;
}

interface RenderedWorldObjectEntry {
  data: WorldObject;
  group: THREE.Group;
  kineticParts: THREE.Object3D[];
  bobParts: Array<{ obj: THREE.Object3D; baseY: number; phase: number }>;
  timeUniforms: Array<{ value: number }>;
  phaseOffset: number;
  hasPhysicsPose: boolean;
}

export function createEnvironmentController(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  maxAnisotropy: number,
  isSoftwareGl: boolean,
): EnvironmentController {
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // Calibrated Studio 3-Point + Hemisphere Lighting Rig
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.92);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.35);
  keyLight.position.set(14, 21, 11);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 58;
    const d = 20;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
  }
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.05);
  rimLight.position.set(-15, 11, -13);
  scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0xc084fc, 0.42);
  fillLight.position.set(0, 6, -16);
  scene.add(fillLight);

  // Shared High-Realism PBR Architectural Materials
  const titaniumDarkMat = new THREE.MeshPhysicalMaterial({
    color: 0x151e2e,
    map: textures.carbonWeaveAlbedo,
    bumpMap: textures.brushedMetalBump,
    bumpScale: 0.015,
    roughness: 0.34,
    metalness: 0.84,
    clearcoat: 0.25,
    clearcoatRoughness: 0.28,
  });
  const brushedSteelMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    bumpMap: textures.brushedMetalBump,
    bumpScale: 0.018,
    roughness: 0.24,
    metalness: 0.9,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.14,
    metalness: 0.95,
  });
  const brassAccentMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    roughness: 0.26,
    metalness: 0.88,
  });
  const architecturalGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbae6fd,
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: isSoftwareGl ? 0.24 : 0.28,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    depthWrite: false,
  });
  disposables.push(titaniumDarkMat, brushedSteelMat, chromeMat, brassAccentMat, architecturalGlassMat);

  // Hyper-Realistic PBR Ground Floor
  const floorGeo = new THREE.CircleGeometry(72, 72);
  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: textures.floorAlbedo,
    bumpMap: textures.floorBump,
    bumpScale: 0.036,
    roughnessMap: textures.floorRoughness,
    roughness: 0.52,
    metalness: 0.54,
    clearcoat: 0.22,
    clearcoatRoughness: 0.28,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  disposables.push(floorGeo, floorMat);

  // Calibrated Polar Deck Rings & Precision Scale Markers
  const gridRingGeo = new THREE.RingGeometry(4.0, 4.16, 72);
  const gridRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const gridRing = new THREE.Mesh(gridRingGeo, gridRingMat);
  gridRing.rotation.x = -Math.PI / 2;
  gridRing.position.y = 0.025;

  const midDeckRingGeo = new THREE.RingGeometry(8.95, 9.12, 72);
  const midDeckRing = new THREE.Mesh(midDeckRingGeo, gridRingMat);
  midDeckRing.rotation.x = -Math.PI / 2;
  midDeckRing.position.y = 0.025;
  root.add(gridRing, midDeckRing);
  disposables.push(gridRingGeo, midDeckRingGeo, gridRingMat);

  // Volumetric Additive Light Shafts (soft overhead atmospheric beams)
  const volumetricGroup = new THREE.Group();
  const beamGeo = new THREE.CylinderGeometry(0.42, 3.8, 13.5, 24, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.048,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(Math.cos(angle) * 8.2, 6.75, Math.sin(angle) * 8.2);
    volumetricGroup.add(beam);
  }
  root.add(volumetricGroup);
  disposables.push(beamGeo, beamMat);

  // 1. ULTRA-DETAILED INDOOR ARCHITECTURE (Command Center / Tech Office / Neural Chamber / Holo Ops)
  const indoorGroup = new THREE.Group();

  // Monumental Chamfered Buttress Pylons with Hydraulic Dampers & Illuminated Fiber Channels
  const pylonShape = new THREE.Shape();
  pylonShape.moveTo(-0.46, 0);
  pylonShape.lineTo(0.46, 0);
  pylonShape.lineTo(0.28, 7.2);
  pylonShape.lineTo(-0.28, 7.2);
  pylonShape.closePath();

  const pylonGeo = new THREE.ExtrudeGeometry(pylonShape, {
    depth: 0.68,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.06,
    bevelSegments: 2,
  });
  const pylonPlinthGeo = new THREE.BoxGeometry(1.48, 0.34, 1.38);
  const pylonCollarGeo = new THREE.BoxGeometry(1.12, 0.22, 1.02);
  const damperTubeGeo = new THREE.CylinderGeometry(0.065, 0.065, 2.8, 10);
  const damperSleeveGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.45, 10);
  const pylonLightGeo = new THREE.BoxGeometry(0.08, 5.8, 0.08);
  const pylonLightMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

  // Sub-floor Glass-Covered Optical Fiber & Cryo-Conduit Trenches
  const trenchCurbGeo = new THREE.BoxGeometry(0.12, 0.045, 7.8);
  const trenchPipeGeo = new THREE.CylinderGeometry(0.04, 0.04, 7.6, 8);
  const trenchFiberGeo = new THREE.BoxGeometry(0.07, 0.025, 7.6);
  const trenchGlassGeo = new THREE.PlaneGeometry(0.68, 7.75);

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const pGroup = new THREE.Group();
    pGroup.position.set(Math.cos(angle) * 12.6, 0, Math.sin(angle) * 12.6);
    pGroup.lookAt(0, 0, 0);

    const plinth = new THREE.Mesh(pylonPlinthGeo, titaniumDarkMat);
    plinth.position.set(0, 0.17, 0.25);
    plinth.receiveShadow = true;

    const mesh = new THREE.Mesh(pylonGeo, titaniumDarkMat);
    mesh.castShadow = !isSoftwareGl;
    mesh.receiveShadow = true;

    const midCollar = new THREE.Mesh(pylonCollarGeo, brushedSteelMat);
    midCollar.position.set(0, 3.25, 0.34);
    const capCollar = new THREE.Mesh(pylonCollarGeo, brushedSteelMat);
    capCollar.position.set(0, 6.85, 0.3);

    // Twin chrome hydraulic damper struts flanking each buttress
    for (const sideX of [-0.46, 0.46]) {
      const rod = new THREE.Mesh(damperTubeGeo, chromeMat);
      rod.position.set(sideX, 1.6, 0.56);
      rod.rotation.x = -0.14;
      const sleeve = new THREE.Mesh(damperSleeveGeo, brassAccentMat);
      sleeve.position.set(sideX, 1.05, 0.62);
      sleeve.rotation.x = -0.14;
      pGroup.add(rod, sleeve);
    }

    const strip = new THREE.Mesh(pylonLightGeo, pylonLightMat);
    strip.position.set(0, 3.55, 0.74);
    pGroup.add(plinth, mesh, midCollar, capCollar, strip);
    indoorGroup.add(pGroup);

    // Radiating Glass-Covered Sub-Floor Conduit Trench (from r=4.4 to r=12.2)
    const trenchWrap = new THREE.Group();
    trenchWrap.rotation.y = -angle + Math.PI / 2;

    const curbL = new THREE.Mesh(trenchCurbGeo, brushedSteelMat);
    curbL.position.set(-0.38, 0.022, 8.2);
    const curbR = new THREE.Mesh(trenchCurbGeo, brushedSteelMat);
    curbR.position.set(0.38, 0.022, 8.2);

    const pipeL = new THREE.Mesh(trenchPipeGeo, chromeMat);
    pipeL.rotation.x = Math.PI / 2;
    pipeL.position.set(-0.18, 0.008, 8.2);
    const pipeR = new THREE.Mesh(trenchPipeGeo, chromeMat);
    pipeR.rotation.x = Math.PI / 2;
    pipeR.position.set(0.18, 0.008, 8.2);

    const fiber = new THREE.Mesh(trenchFiberGeo, pylonLightMat);
    fiber.position.set(0, 0.01, 8.2);

    const glassCover = new THREE.Mesh(trenchGlassGeo, architecturalGlassMat);
    glassCover.rotation.x = -Math.PI / 2;
    glassCover.position.set(0, 0.032, 8.2);

    trenchWrap.add(curbL, curbR, pipeL, pipeR, fiber, glassCover);
    indoorGroup.add(trenchWrap);
  }

  // Elevated Observation Mezzanine Catwalk Arcs (4 quadrant balconies at r=12.1, y=3.25)
  const catwalkArcAngle = Math.PI * 0.22;
  const catwalkDeckGeo = new THREE.CylinderGeometry(12.6, 12.6, 0.16, 20, 1, false, -catwalkArcAngle / 2, catwalkArcAngle);
  const catwalkInnerCutGeo = new THREE.TorusGeometry(11.55, 0.06, 8, 24, catwalkArcAngle);
  const catwalkRailTopGeo = new THREE.TorusGeometry(11.55, 0.035, 8, 24, catwalkArcAngle);
  const catwalkGlassShape = new THREE.Shape();
  catwalkGlassShape.moveTo(-2.1, 0);
  catwalkGlassShape.lineTo(2.1, 0);
  catwalkGlassShape.lineTo(2.1, 0.92);
  catwalkGlassShape.lineTo(-2.1, 0.92);
  catwalkGlassShape.closePath();
  const catwalkGlassGeo = new THREE.PlaneGeometry(4.2, 0.9);
  const catwalkStrutGeo = new THREE.BoxGeometry(0.24, 0.34, 2.2);
  const stanchionGeo = new THREE.CylinderGeometry(0.03, 0.035, 1.02, 8);
  const bladeRackWallGeo = new THREE.BoxGeometry(1.75, 3.1, 0.56);
  const bladeServerSliceGeo = new THREE.BoxGeometry(1.48, 0.12, 0.06);

  for (let q = 0; q < 4; q++) {
    const qAngle = (q / 4) * Math.PI * 2 + Math.PI / 4;
    const mezz = new THREE.Group();
    mezz.rotation.y = qAngle;

    // Extruded curved balcony deck slice
    const deckRing = new THREE.RingGeometry(11.45, 13.15, 22, 1, -catwalkArcAngle / 2, catwalkArcAngle);
    const deckTop = new THREE.Mesh(deckRing, titaniumDarkMat);
    deckTop.rotation.x = -Math.PI / 2;
    deckTop.position.y = 3.24;
    deckTop.receiveShadow = true;

    const rimArc = new THREE.Mesh(catwalkInnerCutGeo, brushedSteelMat);
    rimArc.rotation.x = Math.PI / 2;
    rimArc.rotation.z = -Math.PI / 2;
    rimArc.position.y = 3.21;

    const railTop = new THREE.Mesh(catwalkRailTopGeo, chromeMat);
    railTop.rotation.x = Math.PI / 2;
    railTop.rotation.z = -Math.PI / 2;
    railTop.position.y = 4.22;

    const railMid = new THREE.Mesh(catwalkRailTopGeo, brushedSteelMat);
    railMid.rotation.x = Math.PI / 2;
    railMid.rotation.z = -Math.PI / 2;
    railMid.position.y = 3.74;

    const glassPanel = new THREE.Mesh(catwalkGlassGeo, architecturalGlassMat);
    glassPanel.position.set(11.56, 3.72, 0);
    glassPanel.rotation.y = Math.PI / 2;

    mezz.add(deckTop, rimArc, railTop, railMid, glassPanel);
    disposables.push(deckRing);

    // Cantilever brackets & handrail stanchions
    for (const sOffset of [-0.32, 0, 0.32]) {
      const sa = sOffset;
      const sx = Math.cos(sa) * 11.55;
      const sz = Math.sin(sa) * 11.55;
      const stanchion = new THREE.Mesh(stanchionGeo, chromeMat);
      stanchion.position.set(sx, 3.72, sz);

      const bracket = new THREE.Mesh(catwalkStrutGeo, brushedSteelMat);
      bracket.position.set(Math.cos(sa) * 12.45, 3.02, Math.sin(sa) * 12.45);
      bracket.rotation.y = -sa + Math.PI / 2;
      bracket.rotation.x = 0.22;
      mezz.add(stanchion, bracket);
    }

    // Perimeter Server Telemetry Wall Bay beneath each mezzanine quadrant
    const wallBay = new THREE.Mesh(bladeRackWallGeo, titaniumDarkMat);
    wallBay.position.set(13.8, 1.55, 0);
    wallBay.rotation.y = Math.PI / 2;
    mezz.add(wallBay);

    for (let b = 0; b < 8; b++) {
      const slice = new THREE.Mesh(bladeServerSliceGeo, b % 3 === 0 ? pylonLightMat : brushedSteelMat);
      slice.position.set(13.5, 0.45 + b * 0.31, 0);
      slice.rotation.y = Math.PI / 2;
      mezz.add(slice);
    }

    indoorGroup.add(mezz);
  }

  // Panoramic Exterior Curtain-Wall Mullions & Overhead Ceiling Truss Oculus
  const mullionGeo = new THREE.BoxGeometry(0.18, 7.6, 0.28);
  const wallHeaderGeo = new THREE.TorusGeometry(15.2, 0.2, 10, 48);
  const curtainGlassGeo = new THREE.CylinderGeometry(15.35, 15.35, 7.1, 36, 1, true);
  const oculusOuterGeo = new THREE.TorusGeometry(4.5, 0.26, 14, 56);
  const oculusInnerGeo = new THREE.TorusGeometry(4.0, 0.06, 10, 56);
  const gantryRibGeo = new THREE.BoxGeometry(0.36, 0.44, 8.8);
  const gantryLightGeo = new THREE.BoxGeometry(0.09, 0.06, 8.1);
  const sensorPodGeo = new THREE.BoxGeometry(0.65, 0.28, 0.22);

  for (let m = 0; m < 12; m++) {
    const ma = (m / 12) * Math.PI * 2 + 0.13;
    const mullion = new THREE.Mesh(mullionGeo, brushedSteelMat);
    mullion.position.set(Math.cos(ma) * 15.2, 3.8, Math.sin(ma) * 15.2);
    mullion.rotation.y = -ma;
    indoorGroup.add(mullion);
  }
  const wallHeader = new THREE.Mesh(wallHeaderGeo, titaniumDarkMat);
  wallHeader.rotation.x = Math.PI / 2;
  wallHeader.position.y = 7.45;
  const curtainGlass = new THREE.Mesh(curtainGlassGeo, architecturalGlassMat);
  curtainGlass.position.y = 3.7;
  curtainGlass.material.side = THREE.DoubleSide;
  indoorGroup.add(wallHeader, curtainGlass);

  const oculusOuter = new THREE.Mesh(oculusOuterGeo, titaniumDarkMat);
  oculusOuter.rotation.x = Math.PI / 2;
  oculusOuter.position.y = 8.6;
  const oculusGlow = new THREE.Mesh(oculusInnerGeo, pylonLightMat);
  oculusGlow.rotation.x = Math.PI / 2;
  oculusGlow.position.y = 8.45;
  indoorGroup.add(oculusOuter, oculusGlow);

  // Rotating Ceiling Radar / Sensor Array
  const ceilingSensorRotor = new THREE.Group();
  ceilingSensorRotor.position.y = 8.22;
  for (let s = 0; s < 3; s++) {
    const sa = (s / 3) * Math.PI * 2;
    const pod = new THREE.Mesh(sensorPodGeo, brushedSteelMat);
    pod.position.set(Math.cos(sa) * 4.15, 0, Math.sin(sa) * 4.15);
    pod.rotation.y = -sa;
    ceilingSensorRotor.add(pod);
  }
  indoorGroup.add(ceilingSensorRotor);

  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const ribWrap = new THREE.Group();
    ribWrap.rotation.y = -ang + Math.PI / 2;
    const rib = new THREE.Mesh(gantryRibGeo, titaniumDarkMat);
    rib.position.set(0, 7.5, 8.3);
    rib.rotation.x = 0.25;
    const ribLight = new THREE.Mesh(gantryLightGeo, pylonLightMat);
    ribLight.position.set(0, 7.25, 8.3);
    ribLight.rotation.x = 0.25;
    ribWrap.add(rib, ribLight);
    indoorGroup.add(ribWrap);
  }

  root.add(indoorGroup);
  disposables.push(
    pylonGeo,
    pylonPlinthGeo,
    pylonCollarGeo,
    damperTubeGeo,
    damperSleeveGeo,
    pylonLightGeo,
    pylonLightMat,
    trenchCurbGeo,
    trenchPipeGeo,
    trenchFiberGeo,
    trenchGlassGeo,
    catwalkDeckGeo,
    catwalkInnerCutGeo,
    catwalkRailTopGeo,
    catwalkGlassGeo,
    catwalkStrutGeo,
    stanchionGeo,
    bladeRackWallGeo,
    bladeServerSliceGeo,
    mullionGeo,
    wallHeaderGeo,
    curtainGlassGeo,
    oculusOuterGeo,
    oculusInnerGeo,
    gantryRibGeo,
    gantryLightGeo,
    sensorPodGeo,
  );

  // 2. Legacy Sky + Outdoor Terrain Boulders
  const outdoorGroup = new THREE.Group();
  outdoorGroup.visible = false;

  const sky = new Sky();
  sky.scale.setScalar(450);
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 1.6;
  skyUniforms['rayleigh'].value = 0.45;
  skyUniforms['mieCoefficient'].value = 0.002;
  skyUniforms['mieDirectionalG'].value = 0.65;
  outdoorGroup.add(sky);

  const rockGeo = new THREE.DodecahedronGeometry(1.35, 1);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    bumpMap: textures.floorBump,
    bumpScale: 0.05,
    roughness: 0.86,
    metalness: 0.1,
  });
  const rockCount = 52;
  const rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  const dummy = new THREE.Object3D();
  const rockColor = new THREE.Color();

  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2;
    const radius = 20 + (i % 5) * 4.8;
    const scaleY = 1.1 + (i % 4) * 0.95;
    const scaleXZ = 0.95 + (i % 3) * 0.4;
    dummy.position.set(Math.cos(angle) * radius, scaleY * 0.42, Math.sin(angle) * radius);
    dummy.rotation.set((i % 3) * 0.18, angle * 1.3, (i % 2) * 0.14);
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    rockInstanced.setMatrixAt(i, dummy.matrix);
    rockColor.setHSL(0.58, 0.15, 0.18 + (i % 4) * 0.045);
    rockInstanced.setColorAt(i, rockColor);
  }
  rockInstanced.instanceMatrix.needsUpdate = true;
  if (rockInstanced.instanceColor) rockInstanced.instanceColor.needsUpdate = true;
  rockInstanced.computeBoundingSphere();
  outdoorGroup.add(rockInstanced);
  root.add(outdoorGroup);
  disposables.push(rockGeo, rockMat);

  // 3. Aether District Campus Skyline, Lit Facade Pavilions & Bollard Walkways
  const districtGroup = new THREE.Group();
  districtGroup.visible = false;

  const towerGeo = new THREE.BoxGeometry(3.4, 1, 3.4);
  const towerFacadeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.towerFacadeAlbedo,
    emissive: 0xffffff,
    emissiveMap: textures.towerFacadeEmissive,
    emissiveIntensity: 0.82,
    roughness: 0.28,
    metalness: 0.72,
  });
  const towerTrimGeo = new THREE.BoxGeometry(0.18, 1, 3.48);
  const towerTrimMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const towerCount = 20;
  const towerInst = new THREE.InstancedMesh(towerGeo, towerFacadeMat, towerCount);
  const towerTrimInst = new THREE.InstancedMesh(towerTrimGeo, towerTrimMat, towerCount);
  const tDummy = new THREE.Object3D();
  for (let i = 0; i < towerCount; i++) {
    const angle = (i / towerCount) * Math.PI * 2 + 0.17;
    const radius = 23 + (i % 3) * 6.5;
    const h = 9 + (i % 5) * 4.6;
    tDummy.position.set(Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius);
    tDummy.rotation.set(0, angle, 0);
    tDummy.scale.set(1 + (i % 2) * 0.35, h, 1 + (i % 3) * 0.25);
    tDummy.updateMatrix();
    towerInst.setMatrixAt(i, tDummy.matrix);
    tDummy.scale.set(1, h * 0.88, 1);
    tDummy.updateMatrix();
    towerTrimInst.setMatrixAt(i, tDummy.matrix);
  }
  towerInst.instanceMatrix.needsUpdate = true;
  towerInst.computeBoundingSphere();
  towerTrimInst.instanceMatrix.needsUpdate = true;
  towerTrimInst.computeBoundingSphere();
  districtGroup.add(towerInst, towerTrimInst);

  const walkwayGeo = new THREE.PlaneGeometry(2.8, 38);
  const walkwayMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.45,
    metalness: 0.45,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const pathNS = new THREE.Mesh(walkwayGeo, walkwayMat);
  pathNS.rotation.x = -Math.PI / 2;
  pathNS.position.y = 0.02;
  const pathEW = new THREE.Mesh(walkwayGeo, walkwayMat);
  pathEW.rotation.x = -Math.PI / 2;
  pathEW.rotation.z = Math.PI / 2;
  pathEW.position.y = 0.02;
  districtGroup.add(pathNS, pathEW);

  // Illuminated Campus Bollard Lights
  const bollardGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.85, 10);
  const bollardCapGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10);
  for (let b = 0; b < 8; b++) {
    const ba = (b / 8) * Math.PI * 2 + 0.18;
    const bx = Math.cos(ba) * 14.2;
    const bz = Math.sin(ba) * 14.2;
    const post = new THREE.Mesh(bollardGeo, titaniumDarkMat);
    post.position.set(bx, 0.425, bz);
    const cap = new THREE.Mesh(bollardCapGeo, towerTrimMat);
    cap.position.set(bx, 0.88, bz);
    districtGroup.add(post, cap);
  }

  const outerRingGeo = new THREE.RingGeometry(13.8, 14.12, 64);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.48,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = 0.028;
  districtGroup.add(outerRing);
  root.add(districtGroup);
  disposables.push(
    towerGeo,
    towerFacadeMat,
    towerTrimGeo,
    towerTrimMat,
    walkwayGeo,
    walkwayMat,
    bollardGeo,
    bollardCapGeo,
    outerRingGeo,
    outerRingMat,
  );

  // 4. HYPER THEME: Orbital Station Ring Deck, Solar Wing Arrays & Docked Transfer Shuttle
  const orbitalGroup = new THREE.Group();
  orbitalGroup.visible = false;

  const hullRibGeo = new THREE.TorusGeometry(15.8, 0.34, 14, 52, Math.PI * 1.14);
  const hullGlowGeo = new THREE.TorusGeometry(15.42, 0.06, 8, 52, Math.PI * 1.1);
  const hullGlowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  for (let i = 0; i < 4; i++) {
    const arch = new THREE.Mesh(hullRibGeo, brushedSteelMat);
    arch.rotation.y = (i / 4) * Math.PI + 0.3;
    arch.rotation.z = -0.06;
    arch.position.y = 1.2;
    const archGlow = new THREE.Mesh(hullGlowGeo, hullGlowMat);
    archGlow.rotation.copy(arch.rotation);
    archGlow.position.y = 1.2;
    orbitalGroup.add(arch, archGlow);
  }

  const solarMastGeo = new THREE.BoxGeometry(0.38, 0.38, 18);
  const solarWingGeo = new THREE.BoxGeometry(3.8, 0.06, 7.2);
  const solarMat = new THREE.MeshPhysicalMaterial({
    color: 0x0c4a6e,
    roughness: 0.12,
    metalness: 0.85,
    clearcoat: 0.9,
  });
  for (const side of [-1, 1]) {
    const truss = new THREE.Group();
    truss.position.set(side * 25, 6.2, -15);
    truss.rotation.set(0.24, side * 0.34, 0);
    truss.add(new THREE.Mesh(solarMastGeo, brushedSteelMat));
    for (const wz of [-4.4, 4.4]) {
      const wingL = new THREE.Mesh(solarWingGeo, solarMat);
      wingL.position.set(-2.3, 0, wz);
      const wingR = new THREE.Mesh(solarWingGeo, solarMat);
      wingR.position.set(2.3, 0, wz);
      truss.add(wingL, wingR);
    }
    orbitalGroup.add(truss);
  }

  // Docked Orbital Transfer Shuttle Module
  const shuttleBodyGeo = new THREE.CylinderGeometry(1.1, 1.35, 5.2, 16);
  const shuttleNoseGeo = new THREE.ConeGeometry(1.1, 1.8, 16);
  const shuttleThrusterGeo = new THREE.CylinderGeometry(0.28, 0.44, 0.85, 12);
  const shuttleGroup = new THREE.Group();
  shuttleGroup.position.set(-19, 6.6, -18);
  shuttleGroup.rotation.set(0.14, 0.68, -0.08);
  const sHull = new THREE.Mesh(shuttleBodyGeo, chromeMat);
  sHull.rotation.x = Math.PI / 2;
  const sNose = new THREE.Mesh(shuttleNoseGeo, titaniumDarkMat);
  sNose.rotation.x = Math.PI / 2;
  sNose.position.z = 3.5;
  const sEngine = new THREE.Mesh(shuttleThrusterGeo, brassAccentMat);
  sEngine.rotation.x = Math.PI / 2;
  sEngine.position.z = -2.9;
  shuttleGroup.add(sHull, sNose, sEngine);
  orbitalGroup.add(shuttleGroup);

  root.add(orbitalGroup);
  disposables.push(hullRibGeo, hullGlowGeo, hullGlowMat, solarMastGeo, solarWingGeo, solarMat, shuttleBodyGeo, shuttleNoseGeo, shuttleThrusterGeo);

  // 5. HYPER THEME: Alpine Observatory Peaks, Geodesic Telescope Dome, Pines & Stone Lanterns
  const alpineGroup = new THREE.Group();
  alpineGroup.visible = false;

  const peakGeo = new THREE.ConeGeometry(4.8, 1, 6);
  const peakMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.1 });
  const peakCount = 36;
  const peakInst = new THREE.InstancedMesh(peakGeo, peakMat, peakCount);
  const pDummy = new THREE.Object3D();
  const pColor = new THREE.Color();
  for (let i = 0; i < peakCount; i++) {
    const angle = (i / peakCount) * Math.PI * 2;
    const r = 34 + (i % 4) * 6.5;
    const h = 11.5 + (i % 5) * 4.8;
    pDummy.position.set(Math.cos(angle) * r, h * 0.45, Math.sin(angle) * r);
    pDummy.rotation.set(0, angle * 1.7, 0);
    pDummy.scale.set(1.3 + (i % 3) * 0.45, h, 1.3 + (i % 2) * 0.45);
    pDummy.updateMatrix();
    peakInst.setMatrixAt(i, pDummy.matrix);
    pColor.setHSL(0.58, 0.2, 0.55 + (i % 3) * 0.13);
    peakInst.setColorAt(i, pColor);
  }
  peakInst.instanceMatrix.needsUpdate = true;
  if (peakInst.instanceColor) peakInst.instanceColor.needsUpdate = true;
  peakInst.computeBoundingSphere();
  alpineGroup.add(peakInst);

  // Instanced Evergreen Pines on Perimeter Ridges
  const pineGeo = new THREE.ConeGeometry(0.95, 3.8, 7);
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x0f3b2e, roughness: 0.9, metalness: 0.05 });
  const pineCount = 42;
  const pineInst = new THREE.InstancedMesh(pineGeo, pineMat, pineCount);
  for (let i = 0; i < pineCount; i++) {
    const a = (i / pineCount) * Math.PI * 2 + 0.07;
    const r = 18.5 + (i % 4) * 2.8;
    const sc = 0.8 + (i % 3) * 0.35;
    pDummy.position.set(Math.cos(a) * r, 1.85 * sc, Math.sin(a) * r);
    pDummy.rotation.set(0, a, 0);
    pDummy.scale.set(sc, sc, sc);
    pDummy.updateMatrix();
    pineInst.setMatrixAt(i, pDummy.matrix);
  }
  pineInst.instanceMatrix.needsUpdate = true;
  alpineGroup.add(pineInst);

  // Geodesic Observatory Dome + Telescope Barrel on Horizon Ridge
  const obsBaseGeo = new THREE.CylinderGeometry(3.2, 3.6, 2.2, 16);
  const obsDomeGeo = new THREE.SphereGeometry(3.15, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const obsScopeGeo = new THREE.CylinderGeometry(0.42, 0.52, 3.4, 12);
  const obsGroup = new THREE.Group();
  obsGroup.position.set(16, 0, -24);
  const obsBase = new THREE.Mesh(obsBaseGeo, brushedSteelMat);
  obsBase.position.y = 1.1;
  const obsDome = new THREE.Mesh(obsDomeGeo, chromeMat);
  obsDome.position.y = 2.2;
  const obsScope = new THREE.Mesh(obsScopeGeo, titaniumDarkMat);
  obsScope.position.set(0, 3.85, 1.35);
  obsScope.rotation.x = 0.85;
  obsGroup.add(obsBase, obsDome, obsScope);
  alpineGroup.add(obsGroup);

  const lanternPostGeo = new THREE.CylinderGeometry(0.08, 0.14, 2.2, 10);
  const lanternBulbGeo = new THREE.SphereGeometry(0.18, 12, 12);
  const lanternBulbMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.25;
    const post = new THREE.Mesh(lanternPostGeo, titaniumDarkMat);
    post.position.set(Math.cos(a) * 12.2, 1.1, Math.sin(a) * 12.2);
    const bulb = new THREE.Mesh(lanternBulbGeo, lanternBulbMat);
    bulb.position.set(Math.cos(a) * 12.2, 2.28, Math.sin(a) * 12.2);
    alpineGroup.add(post, bulb);
  }
  root.add(alpineGroup);
  disposables.push(peakGeo, peakMat, pineGeo, pineMat, obsBaseGeo, obsDomeGeo, obsScopeGeo, lanternPostGeo, lanternBulbGeo, lanternBulbMat);

  // 6. HYPER THEME: Cyber Metropolis Skyscrapers with Lit Window Grids, Rooftop Spires & Skytrain Ring
  const cyberGroup = new THREE.Group();
  cyberGroup.visible = false;

  const skyGeo = new THREE.BoxGeometry(3.8, 1, 3.8);
  const skyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: textures.towerFacadeAlbedo,
    emissive: 0xffffff,
    emissiveMap: textures.towerFacadeEmissive,
    emissiveIntensity: 1.05,
    roughness: 0.24,
    metalness: 0.82,
  });
  const neonGeo = new THREE.BoxGeometry(0.24, 1, 3.94);
  const neonMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
  const neonAltGeo = new THREE.BoxGeometry(3.96, 0.24, 3.96);
  const neonAltMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const spireGeo = new THREE.CylinderGeometry(0.04, 0.12, 4.5, 6);
  const cyberCount = 26;
  const cyberInst = new THREE.InstancedMesh(skyGeo, skyMat, cyberCount);
  const neonInst = new THREE.InstancedMesh(neonGeo, neonMat, cyberCount);
  const neonCrownInst = new THREE.InstancedMesh(neonAltGeo, neonAltMat, cyberCount);
  const spireInst = new THREE.InstancedMesh(spireGeo, chromeMat, cyberCount);
  const cDummy = new THREE.Object3D();
  for (let i = 0; i < cyberCount; i++) {
    const a = (i / cyberCount) * Math.PI * 2;
    const r = 20.5 + (i % 3) * 6.8;
    const h = 15 + (i % 6) * 5.4;
    const sx = 1 + (i % 2) * 0.36;
    const sz = 1 + (i % 3) * 0.3;
    cDummy.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    cDummy.rotation.set(0, a, 0);
    cDummy.scale.set(sx, h, sz);
    cDummy.updateMatrix();
    cyberInst.setMatrixAt(i, cDummy.matrix);
    cDummy.scale.set(1, h * 0.94, sz);
    cDummy.updateMatrix();
    neonInst.setMatrixAt(i, cDummy.matrix);
    cDummy.position.set(Math.cos(a) * r, h - 0.35, Math.sin(a) * r);
    cDummy.scale.set(sx, 1, sz);
    cDummy.updateMatrix();
    neonCrownInst.setMatrixAt(i, cDummy.matrix);
    cDummy.position.set(Math.cos(a) * r, h + 2.1, Math.sin(a) * r);
    cDummy.scale.set(1, 1, 1);
    cDummy.updateMatrix();
    spireInst.setMatrixAt(i, cDummy.matrix);
  }
  cyberInst.instanceMatrix.needsUpdate = true;
  neonInst.instanceMatrix.needsUpdate = true;
  neonCrownInst.instanceMatrix.needsUpdate = true;
  spireInst.instanceMatrix.needsUpdate = true;
  cyberGroup.add(cyberInst, neonInst, neonCrownInst, spireInst);

  // Elevated Monorail Skytrain Viaduct Ring + Moving Train Carriages
  const viaductGeo = new THREE.TorusGeometry(17.5, 0.28, 10, 64);
  const viaduct = new THREE.Mesh(viaductGeo, titaniumDarkMat);
  viaduct.rotation.x = Math.PI / 2;
  viaduct.position.y = 7.2;
  cyberGroup.add(viaduct);

  const trainOrbit = new THREE.Group();
  trainOrbit.position.y = 7.55;
  const trainCarGeo = new THREE.BoxGeometry(0.62, 0.52, 2.8);
  for (let c = 0; c < 3; c++) {
    const car = new THREE.Mesh(trainCarGeo, neonAltMat);
    const ca = c * 0.19;
    car.position.set(Math.cos(ca) * 17.5, 0, Math.sin(ca) * 17.5);
    car.rotation.y = -ca;
    trainOrbit.add(car);
  }
  cyberGroup.add(trainOrbit);

  root.add(cyberGroup);
  disposables.push(skyGeo, skyMat, neonGeo, neonMat, neonAltGeo, neonAltMat, spireGeo, viaductGeo, trainCarGeo);

  // 7. HYPER THEME: Bioluminescent Canyon Crystals & Stratified Cliffs
  const canyonGroup = new THREE.Group();
  canyonGroup.visible = false;

  const cliffGeo = new THREE.CylinderGeometry(2.8, 4.4, 1, 6);
  const cliffMat = new THREE.MeshStandardMaterial({
    color: 0x3b1f2b,
    bumpMap: textures.floorBump,
    bumpScale: 0.04,
    roughness: 0.88,
    metalness: 0.12,
  });
  const cliffCount = 18;
  const cliffInst = new THREE.InstancedMesh(cliffGeo, cliffMat, cliffCount);
  for (let i = 0; i < cliffCount; i++) {
    const a = (i / cliffCount) * Math.PI * 2;
    const r = 27 + (i % 3) * 5.2;
    const h = 8 + (i % 4) * 3.8;
    cDummy.position.set(Math.cos(a) * r, h * 0.45, Math.sin(a) * r);
    cDummy.rotation.set(0, a * 1.4, 0);
    cDummy.scale.set(1.2 + (i % 2) * 0.5, h, 1.2 + (i % 3) * 0.4);
    cDummy.updateMatrix();
    cliffInst.setMatrixAt(i, cDummy.matrix);
  }
  cliffInst.instanceMatrix.needsUpdate = true;
  canyonGroup.add(cliffInst);

  const crystalGeo = new THREE.OctahedronGeometry(0.85, 0);
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.8,
    roughness: 0.14,
    metalness: 0.25,
    clearcoat: 1.0,
  });
  const crystalCount = 30;
  const crystalInst = new THREE.InstancedMesh(crystalGeo, crystalMat, crystalCount);
  const crColor = new THREE.Color();
  for (let i = 0; i < crystalCount; i++) {
    const a = (i / crystalCount) * Math.PI * 2 + 0.1;
    const r = 13.5 + (i % 4) * 3.8;
    const h = 1.8 + (i % 4) * 1.25;
    cDummy.position.set(Math.cos(a) * r, h * 0.45, Math.sin(a) * r);
    cDummy.rotation.set((i % 3) * 0.18, a, ((i + 1) % 3) * 0.16);
    cDummy.scale.set(0.68, h, 0.68);
    cDummy.updateMatrix();
    crystalInst.setMatrixAt(i, cDummy.matrix);
    crColor.setHex(i % 2 === 0 ? 0x22d3ee : 0xe879f9);
    crystalInst.setColorAt(i, crColor);
  }
  crystalInst.instanceMatrix.needsUpdate = true;
  if (crystalInst.instanceColor) crystalInst.instanceColor.needsUpdate = true;
  canyonGroup.add(crystalInst);
  root.add(canyonGroup);
  disposables.push(cliffGeo, cliffMat, crystalGeo, crystalMat);

  // Ambient Floating Motes / Bioluminescent Spores
  const moteCount = isSoftwareGl ? 65 : 160;
  const motePos = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 30;
    motePos[i * 3 + 1] = 0.6 + Math.random() * 8.8;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * 30;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0x67e8f9,
    size: 0.08,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const motePoints = new THREE.Points(moteGeo, moteMat);
  root.add(motePoints);
  disposables.push(moteGeo, moteMat);

  const screenManager = new AnimatedScreenManager(maxAnisotropy, isSoftwareGl);

  // 8. ADD-ON BIOME: VCAOS Matrix (YukiOS Shared-State Multi-DE Holo Workspace)
  const vcaosGroup = new THREE.Group();
  vcaosGroup.visible = false;

  const vcaosPillarGeo = new THREE.BoxGeometry(0.62, 7.2, 0.85);
  const vcaosBusGeo = new THREE.BoxGeometry(0.14, 6.4, 0.14);
  const vcaosBusMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const vcaosFrameGeo = new THREE.BoxGeometry(4.1, 2.45, 0.14);
  const vcaosScreenGeo = new THREE.PlaneGeometry(3.84, 2.18);
  const vcaosBezelTrimGeo = new THREE.BoxGeometry(4.2, 0.08, 0.18);
  const vcaosWindowScreens = [
    { id: 'vcaos-win-0', label: 'VCAOS // HYPRLAND BSP', preset: 'virtual-os' as const, color: '#38bdf8', angle: -Math.PI * 0.72, y: 3.15 },
    { id: 'vcaos-win-1', label: 'VCAOS // KERNEL SHELL', preset: 'matrix' as const, color: '#a855f7', angle: -Math.PI * 0.32, y: 3.65 },
    { id: 'vcaos-win-2', label: 'VCAOS // AGENT MATRIX', preset: 'neural-pulse' as const, color: '#34d399', angle: Math.PI * 0.18, y: 3.25 },
    { id: 'vcaos-win-3', label: 'VCAOS // TELEMETRY BUS', preset: 'jarvis-core' as const, color: '#22d3ee', angle: Math.PI * 0.68, y: 3.55 },
  ];

  const vcaosWindows: THREE.Group[] = [];
  vcaosWindowScreens.forEach((spec, idx) => {
    const wg = new THREE.Group();
    const r = 10.4;
    wg.position.set(Math.cos(spec.angle) * r, spec.y, Math.sin(spec.angle) * r);
    wg.lookAt(0, spec.y * 0.85, 0);

    const frame = new THREE.Mesh(vcaosFrameGeo, titaniumDarkMat);
    const topTrim = new THREE.Mesh(vcaosBezelTrimGeo, vcaosBusMat);
    topTrim.position.y = 1.24;
    const botTrim = new THREE.Mesh(vcaosBezelTrimGeo, vcaosBusMat);
    botTrim.position.y = -1.24;

    const tex = screenManager.getTexture({
      objectId: spec.id,
      label: spec.label,
      color: spec.color,
      mediaType: 'procedural',
      screenPreset: spec.preset,
    });
    const scrMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
    const scr = new THREE.Mesh(vcaosScreenGeo, scrMat);
    scr.position.z = 0.082;
    const scrBack = new THREE.Mesh(vcaosScreenGeo, scrMat);
    scrBack.position.z = -0.082;
    scrBack.rotation.y = Math.PI;

    wg.add(frame, topTrim, botTrim, scr, scrBack);
    wg.userData = { baseY: spec.y, phase: idx * 1.35 };
    vcaosWindows.push(wg);
    vcaosGroup.add(wg);
    disposables.push(scrMat);
  });

  // 8 Orbiting Workspace Beacons [WS 1..8] + Outer Kernel Bus Pillars (positioned cleanly overhead)
  const vcaosBeaconRing = new THREE.Group();
  vcaosBeaconRing.position.y = 8.6;
  const beaconNodeGeo = new THREE.OctahedronGeometry(0.28, 0);
  const beaconCollarGeo = new THREE.TorusGeometry(0.42, 0.03, 8, 24);
  const beaconHaloGeo = new THREE.TorusGeometry(12.6, 0.04, 10, 72);
  const beaconHalo = new THREE.Mesh(beaconHaloGeo, vcaosBusMat);
  beaconHalo.rotation.x = Math.PI / 2;
  vcaosBeaconRing.add(beaconHalo);

  for (let w = 0; w < 8; w++) {
    const wa = (w / 8) * Math.PI * 2 + Math.PI / 8;
    const bx = Math.cos(wa) * 12.6;
    const bz = Math.sin(wa) * 12.6;
    const node = new THREE.Mesh(beaconNodeGeo, vcaosBusMat);
    node.position.set(bx, 0, bz);
    const collar = new THREE.Mesh(beaconCollarGeo, chromeMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(bx, 0, bz);
    vcaosBeaconRing.add(node, collar);
  }
  vcaosGroup.add(vcaosBeaconRing);

  for (let k = 0; k < 8; k++) {
    const ka = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const pillarWrap = new THREE.Group();
    pillarWrap.position.set(Math.cos(ka) * 13.6, 0, Math.sin(ka) * 13.6);
    pillarWrap.lookAt(0, 0, 0);
    const pillar = new THREE.Mesh(vcaosPillarGeo, titaniumDarkMat);
    pillar.position.y = 3.6;
    const bus = new THREE.Mesh(vcaosBusGeo, vcaosBusMat);
    bus.position.set(0, 3.6, 0.45);
    pillarWrap.add(pillar, bus);
    vcaosGroup.add(pillarWrap);
  }

  const vcaosDeckRingGeo = new THREE.RingGeometry(11.6, 11.95, 72);
  const vcaosDeckRing = new THREE.Mesh(vcaosDeckRingGeo, gridRingMat);
  vcaosDeckRing.rotation.x = -Math.PI / 2;
  vcaosDeckRing.position.y = 0.03;
  vcaosGroup.add(vcaosDeckRing);

  root.add(vcaosGroup);
  disposables.push(
    vcaosPillarGeo,
    vcaosBusGeo,
    vcaosBusMat,
    vcaosFrameGeo,
    vcaosScreenGeo,
    vcaosBezelTrimGeo,
    beaconNodeGeo,
    beaconCollarGeo,
    beaconHaloGeo,
    vcaosDeckRingGeo,
  );

  // Persistent Placed World Objects + Animated Screen Manager + Selection / Drag Gizmo
  const worldObjectsGroup = new THREE.Group();
  root.add(worldObjectsGroup);
  const worldObjectInteractables: THREE.Object3D[] = [];
  const renderedObjects = new Map<string, RenderedWorldObjectEntry>();
  let worldObjDisposables: Array<{ dispose: () => void }> = [];

  let selectedObjectId: string | null = null;
  let draggingObjectId: string | null = null;
  let dragPosition: [number, number, number] | null = null;
  let dragRotationY: number | undefined;

  const selectionRingGeo = new THREE.RingGeometry(0.95, 1.16, 48);
  const selectionRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const selectionRing = new THREE.Mesh(selectionRingGeo, selectionRingMat);
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = 0.04;
  selectionRing.visible = false;
  root.add(selectionRing);
  disposables.push(selectionRingGeo, selectionRingMat);

  function syncWorldObjects(objects: WorldObject[]) {
    worldObjDisposables.forEach((d) => d.dispose());
    worldObjDisposables = [];
    worldObjectInteractables.length = 0;
    renderedObjects.clear();
    while (worldObjectsGroup.children.length > 0) {
      worldObjectsGroup.remove(worldObjectsGroup.children[0]);
    }

    const baseDarkMat = new THREE.MeshPhysicalMaterial({
      color: 0x111827,
      map: textures.carbonWeaveAlbedo,
      bumpMap: textures.brushedMetalBump,
      bumpScale: 0.012,
      roughness: 0.36,
      metalness: 0.78,
      clearcoat: 0.2,
    });
    const metalSilverMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      bumpMap: textures.brushedMetalBump,
      bumpScale: 0.014,
      roughness: 0.24,
      metalness: 0.88,
    });
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const shadowDiscMat = new THREE.MeshBasicMaterial({
      map: textures.contactShadow,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    worldObjDisposables.push(baseDarkMat, metalSilverMat, proxyMat, shadowDiscMat);

    objects.forEach((obj, idx) => {
      const group = new THREE.Group();
      group.position.set(obj.position[0], obj.position[1] ?? 0, obj.position[2]);
      group.rotation.y = obj.rotationY;
      const objScale = Math.max(0.4, Math.min(3.0, obj.scale ?? 1));
      group.scale.setScalar(objScale);

      const accentMat = new THREE.MeshStandardMaterial({
        color: obj.color,
        emissive: obj.color,
        emissiveIntensity: 0.92,
        roughness: 0.22,
        metalness: 0.52,
      });
      worldObjDisposables.push(accentMat);

      const kineticParts: THREE.Object3D[] = [];
      const bobParts: Array<{ obj: THREE.Object3D; baseY: number; phase: number }> = [];
      const timeUniforms: Array<{ value: number }> = [];
      let proxySize: [number, number, number] = [1.5, 1.8, 1.4];

      if (obj.kind === 'media-screen' || obj.kind === 'holo-billboard') {
        const isWide = obj.kind === 'holo-billboard';
        const w = isWide ? 3.2 : 2.1;
        const h = isWide ? 1.8 : 1.2;
        const screenY = isWide ? 1.75 : 1.35;

        const baseG = new THREE.CylinderGeometry(0.55, 0.74, 0.16, 24);
        const flangeG = new THREE.CylinderGeometry(0.32, 0.42, 0.12, 16);
        const postG = new THREE.CylinderGeometry(0.08, 0.11, screenY - h * 0.4, 14);
        const frameG = new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.12);
        const bezelG = new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.13);
        const displayG = new THREE.PlaneGeometry(w, h);
        const trimG = new THREE.BoxGeometry(w + 0.26, 0.05, 0.15);
        worldObjDisposables.push(baseG, flangeG, postG, frameG, bezelG, displayG, trimG);

        const base = new THREE.Mesh(baseG, baseDarkMat);
        base.position.y = 0.08;
        const flange = new THREE.Mesh(flangeG, metalSilverMat);
        flange.position.y = 0.2;
        const post = new THREE.Mesh(postG, metalSilverMat);
        post.position.y = (screenY - h * 0.4) * 0.5 + 0.16;
        const frame = new THREE.Mesh(frameG, baseDarkMat);
        frame.position.set(0, screenY, 0);
        const bezel = new THREE.Mesh(bezelG, metalSilverMat);
        bezel.position.set(0, screenY, 0);
        const topTrim = new THREE.Mesh(trimG, accentMat);
        topTrim.position.set(0, screenY + h * 0.5 + 0.08, 0);
        const botTrim = new THREE.Mesh(trimG, accentMat);
        botTrim.position.set(0, screenY - h * 0.5 - 0.08, 0);

        const screenTex = screenManager.getTexture({
          objectId: obj.id,
          label: obj.label,
          color: obj.color,
          mediaType: obj.mediaType,
          mediaUrl: obj.mediaUrl,
          screenPreset: obj.screenPreset,
        });
        const screenMat = new THREE.MeshBasicMaterial({
          map: screenTex,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        worldObjDisposables.push(screenMat);

        const displayFront = new THREE.Mesh(displayG, screenMat);
        displayFront.position.set(0, screenY, 0.072);
        const displayBack = new THREE.Mesh(displayG, screenMat);
        displayBack.position.set(0, screenY, -0.072);
        displayBack.rotation.y = Math.PI;

        group.add(base, flange, post, frame, bezel, topTrim, botTrim, displayFront, displayBack);
        proxySize = [w + 0.4, screenY + h * 0.6, 0.9];
      } else if (obj.kind === 'quantum-workstation') {
        // Ultra-Detailed Multi-Monitor Command Rig + Liquid-Cooled PC Tower + Tactile Peripherals
        const deskTopG = new THREE.BoxGeometry(2.44, 0.085, 1.18);
        const deskEdgeG = new THREE.BoxGeometry(2.48, 0.03, 1.22);
        const legG = new THREE.BoxGeometry(0.14, 0.74, 0.96);
        const footSkidG = new THREE.BoxGeometry(0.22, 0.05, 1.08);
        const towerShellG = new THREE.BoxGeometry(0.34, 0.64, 0.64);
        const towerCoreG = new THREE.BoxGeometry(0.24, 0.46, 0.5);
        const towerReservoirG = new THREE.CylinderGeometry(0.055, 0.055, 0.34, 12);
        const kbG = new THREE.BoxGeometry(0.62, 0.032, 0.22);
        const padG = new THREE.BoxGeometry(0.95, 0.012, 0.38);
        const mouseG = new THREE.BoxGeometry(0.09, 0.035, 0.14);
        const armG = new THREE.BoxGeometry(0.08, 0.48, 0.08);
        const ctrFrameG = new THREE.BoxGeometry(1.06, 0.64, 0.055);
        const ctrScrG = new THREE.PlaneGeometry(0.98, 0.56);
        const sideFrameG = new THREE.BoxGeometry(0.7, 0.54, 0.045);
        const sideScrG = new THREE.PlaneGeometry(0.64, 0.48);
        worldObjDisposables.push(
          deskTopG,
          deskEdgeG,
          legG,
          footSkidG,
          towerShellG,
          towerCoreG,
          towerReservoirG,
          kbG,
          padG,
          mouseG,
          armG,
          ctrFrameG,
          ctrScrG,
          sideFrameG,
          sideScrG,
        );

        const deskTop = new THREE.Mesh(deskTopG, metalSilverMat);
        deskTop.position.y = 0.78;
        const deskTrim = new THREE.Mesh(deskEdgeG, accentMat);
        deskTrim.position.y = 0.74;
        const legL = new THREE.Mesh(legG, baseDarkMat);
        legL.position.set(-1.08, 0.37, 0);
        const legR = new THREE.Mesh(legG, baseDarkMat);
        legR.position.set(1.08, 0.37, 0);
        const skidL = new THREE.Mesh(footSkidG, metalSilverMat);
        skidL.position.set(-1.08, 0.025, 0);
        const skidR = new THREE.Mesh(footSkidG, metalSilverMat);
        skidR.position.set(1.08, 0.025, 0);

        const pcTower = new THREE.Mesh(towerShellG, baseDarkMat);
        pcTower.position.set(0.76, 0.32, 0.06);
        const pcGlow = new THREE.Mesh(towerCoreG, accentMat);
        pcGlow.position.set(0.76, 0.32, 0.1);
        const coolantTube = new THREE.Mesh(towerReservoirG, chromeMat);
        coolantTube.position.set(0.66, 0.34, 0.32);

        const deskPad = new THREE.Mesh(padG, baseDarkMat);
        deskPad.position.set(0.02, 0.83, 0.25);
        const kb = new THREE.Mesh(kbG, metalSilverMat);
        kb.position.set(-0.08, 0.85, 0.25);
        const mouse = new THREE.Mesh(mouseG, accentMat);
        mouse.position.set(0.36, 0.85, 0.26);
        const arm = new THREE.Mesh(armG, metalSilverMat);
        arm.position.set(0, 1.0, -0.34);

        const osTex = screenManager.getTexture({
          objectId: `${obj.id}-os`,
          label: obj.label,
          color: obj.color,
          mediaType: obj.mediaType,
          mediaUrl: obj.mediaUrl,
          screenPreset: obj.screenPreset || 'virtual-os',
        });
        const auxTex = screenManager.getTexture({
          objectId: `${obj.id}-aux`,
          label: 'KERNEL MATRIX',
          color: '#a855f7',
          mediaType: 'procedural',
          screenPreset: 'matrix',
        });
        const osMat = new THREE.MeshBasicMaterial({ map: osTex, toneMapped: false });
        const auxMat = new THREE.MeshBasicMaterial({ map: auxTex, toneMapped: false });
        worldObjDisposables.push(osMat, auxMat);

        const ctrFrame = new THREE.Mesh(ctrFrameG, baseDarkMat);
        ctrFrame.position.set(0, 1.24, -0.3);
        const ctrScr = new THREE.Mesh(ctrScrG, osMat);
        ctrScr.position.set(0, 1.24, -0.265);

        const leftWrap = new THREE.Group();
        leftWrap.position.set(-0.86, 1.22, -0.16);
        leftWrap.rotation.y = 0.42;
        leftWrap.add(new THREE.Mesh(sideFrameG, baseDarkMat));
        const lScr = new THREE.Mesh(sideScrG, auxMat);
        lScr.position.z = 0.026;
        leftWrap.add(lScr);

        const rightWrap = new THREE.Group();
        rightWrap.position.set(0.86, 1.22, -0.16);
        rightWrap.rotation.y = -0.42;
        rightWrap.add(new THREE.Mesh(sideFrameG, baseDarkMat));
        const rScr = new THREE.Mesh(sideScrG, auxMat);
        rScr.position.z = 0.026;
        rightWrap.add(rScr);

        group.add(
          deskTop,
          deskTrim,
          legL,
          legR,
          skidL,
          skidR,
          pcTower,
          pcGlow,
          coolantTube,
          deskPad,
          kb,
          mouse,
          arm,
          ctrFrame,
          ctrScr,
          leftWrap,
          rightWrap,
        );
        proxySize = [2.48, 1.65, 1.38];
      } else if (obj.kind === 'mainframe-rack') {
        const cabG = new THREE.BoxGeometry(1.18, 2.38, 0.88);
        const plinthG = new THREE.BoxGeometry(1.3, 0.1, 1.0);
        const bladeG = new THREE.BoxGeometry(0.96, 0.16, 0.72);
        const ledG = new THREE.BoxGeometry(0.82, 0.035, 0.04);
        const fanG = new THREE.TorusGeometry(0.24, 0.04, 8, 20);
        const spokeG = new THREE.BoxGeometry(0.42, 0.05, 0.03);
        const glassDoorG = new THREE.PlaneGeometry(1.04, 2.18);
        worldObjDisposables.push(cabG, plinthG, bladeG, ledG, fanG, spokeG, glassDoorG);

        const cab = new THREE.Mesh(cabG, baseDarkMat);
        cab.position.y = 1.22;
        const plinth = new THREE.Mesh(plinthG, metalSilverMat);
        plinth.position.y = 0.05;
        const glassDoor = new THREE.Mesh(glassDoorG, architecturalGlassMat);
        glassDoor.position.set(0, 1.24, 0.45);
        group.add(cab, plinth, glassDoor);

        for (let b = 0; b < 7; b++) {
          const y = 0.34 + b * 0.29;
          const blade = new THREE.Mesh(bladeG, metalSilverMat);
          blade.position.set(0, y, 0.09);
          const led = new THREE.Mesh(ledG, accentMat);
          led.position.set(0, y, 0.44);
          group.add(blade, led);
        }

        const topFan = new THREE.Group();
        topFan.position.set(0, 2.44, 0);
        topFan.rotation.x = Math.PI / 2;
        topFan.add(new THREE.Mesh(fanG, metalSilverMat), new THREE.Mesh(spokeG, accentMat));
        kineticParts.push(topFan);
        group.add(topFan);
        proxySize = [1.26, 2.45, 0.96];
      } else if (obj.kind === 'holo-terrain-table') {
        const pedG = new THREE.CylinderGeometry(0.76, 1.12, 0.72, 8);
        const pedCollarG = new THREE.CylinderGeometry(0.9, 0.96, 0.1, 8);
        const rimG = new THREE.BoxGeometry(2.38, 0.14, 2.38);
        const cornerG = new THREE.BoxGeometry(0.55, 0.06, 0.08);
        const meshGeo = new THREE.PlaneGeometry(1.96, 1.96, 16, 16);
        const gemG = new THREE.OctahedronGeometry(0.11, 0);
        const gemHaloG = new THREE.RingGeometry(0.14, 0.19, 20);
        worldObjDisposables.push(pedG, pedCollarG, rimG, cornerG, meshGeo, gemG, gemHaloG);

        const ped = new THREE.Mesh(pedG, baseDarkMat);
        ped.position.y = 0.36;
        const collar = new THREE.Mesh(pedCollarG, metalSilverMat);
        collar.position.y = 0.68;
        const rim = new THREE.Mesh(rimG, metalSilverMat);
        rim.position.y = 0.78;
        group.add(ped, collar, rim);

        const bracketMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
        worldObjDisposables.push(bracketMat);
        for (const [cx, cz, sx, sz] of [
          [-1.12, -1.12, 1, 1],
          [1.12, -1.12, -1, 1],
          [-1.12, 1.12, 1, -1],
          [1.12, 1.12, -1, -1],
        ] as const) {
          const b1 = new THREE.Mesh(cornerG, bracketMat);
          b1.position.set(cx + sx * 0.24, 0.88, cz);
          const b2 = new THREE.Mesh(cornerG, bracketMat);
          b2.rotation.y = Math.PI / 2;
          b2.position.set(cx, 0.88, cz + sz * 0.24);
          group.add(b1, b2);
        }

        const terrainShaderMat = new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uColorA: { value: new THREE.Color(obj.color || '#38bdf8') },
            uColorB: { value: new THREE.Color('#f43f5e') },
          },
          vertexShader: `
            uniform float uTime;
            varying float vElev;
            void main() {
              vec3 p = position;
              float h = sin(p.x * 3.4 + uTime * 1.8) * cos(p.y * 3.4 - uTime * 1.4) * 0.16
                      + sin((p.x + p.y) * 5.2 + uTime * 2.3) * 0.07;
              p.z += h + 0.18;
              vElev = h;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 uColorA;
            uniform vec3 uColorB;
            varying float vElev;
            void main() {
              float mixAmt = smoothstep(-0.15, 0.2, vElev);
              vec3 col = mix(uColorA, uColorB, mixAmt * 0.72);
              gl_FragColor = vec4(col, 0.92);
            }
          `,
          wireframe: true,
          transparent: true,
          blending: THREE.AdditiveBlending,
        });
        worldObjDisposables.push(terrainShaderMat);
        timeUniforms.push(terrainShaderMat.uniforms.uTime);

        const terrainMesh = new THREE.Mesh(meshGeo, terrainShaderMat);
        terrainMesh.rotation.x = -Math.PI / 2;
        terrainMesh.position.y = 0.88;
        group.add(terrainMesh);

        const waypoints: Array<[number, number, number]> = [
          [-0.48, 1.32, -0.38],
          [0.52, 1.38, -0.32],
          [0.0, 1.46, 0.08],
          [-0.36, 1.28, 0.52],
          [0.44, 1.34, 0.46],
        ];
        waypoints.forEach(([wx, wy, wz], wIdx) => {
          const gem = new THREE.Mesh(gemG, bracketMat);
          gem.position.set(wx, wy, wz);
          const halo = new THREE.Mesh(gemHaloG, bracketMat);
          halo.rotation.x = -Math.PI / 2;
          halo.position.set(wx, 1.04, wz);
          group.add(gem, halo);
          kineticParts.push(gem);
          bobParts.push({ obj: gem, baseY: wy, phase: wIdx * 1.15 });
        });
        proxySize = [2.4, 1.55, 2.4];
      } else if (obj.kind === 'holo-hud-terminal') {
        const dockG = new THREE.CylinderGeometry(0.68, 0.84, 0.28, 6);
        const emitRingG = new THREE.TorusGeometry(0.56, 0.03, 8, 24);
        const mainWinG = new THREE.PlaneGeometry(1.42, 0.86);
        const wingWinG = new THREE.PlaneGeometry(0.76, 0.58);
        const cubeG = new THREE.BoxGeometry(0.28, 0.28, 0.28);
        const cubeEdgeG = new THREE.EdgesGeometry(cubeG);
        worldObjDisposables.push(dockG, emitRingG, mainWinG, wingWinG, cubeG, cubeEdgeG);

        const dock = new THREE.Mesh(dockG, baseDarkMat);
        dock.position.y = 0.14;
        const emitRing = new THREE.Mesh(emitRingG, accentMat);
        emitRing.rotation.x = Math.PI / 2;
        emitRing.position.y = 0.29;
        group.add(dock, emitRing);

        const mainTex = screenManager.getTexture({
          objectId: `${obj.id}-hud-main`,
          label: obj.label,
          color: obj.color,
          mediaType: obj.mediaType,
          mediaUrl: obj.mediaUrl,
          screenPreset: obj.screenPreset || 'virtual-os',
        });
        const sideTex = screenManager.getTexture({
          objectId: `${obj.id}-hud-radar`,
          label: 'PLANETARY LOCK',
          color: '#f43f5e',
          mediaType: 'procedural',
          screenPreset: 'radar',
        });
        const hudMat = new THREE.MeshBasicMaterial({
          map: mainTex,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const sideHudMat = new THREE.MeshBasicMaterial({
          map: sideTex,
          transparent: true,
          opacity: 0.86,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const wireMat = new THREE.LineBasicMaterial({ color: obj.color || 0x38bdf8 });
        worldObjDisposables.push(hudMat, sideHudMat, wireMat);

        const mainPane = new THREE.Mesh(mainWinG, hudMat);
        mainPane.position.set(0, 1.38, 0);
        const leftPane = new THREE.Mesh(wingWinG, sideHudMat);
        leftPane.position.set(-1.05, 1.32, 0.26);
        leftPane.rotation.y = 0.48;
        const rightPane = new THREE.Mesh(wingWinG, sideHudMat);
        rightPane.position.set(1.05, 1.32, 0.26);
        rightPane.rotation.y = -0.48;

        const wireCubeL = new THREE.LineSegments(cubeEdgeG, wireMat);
        wireCubeL.position.set(-0.92, 0.62, 0.2);
        const wireCubeR = new THREE.LineSegments(cubeEdgeG, wireMat);
        wireCubeR.position.set(0.92, 0.62, 0.2);
        kineticParts.push(wireCubeL, wireCubeR);
        bobParts.push(
          { obj: mainPane, baseY: 1.38, phase: 0 },
          { obj: wireCubeL, baseY: 0.62, phase: 1.2 },
          { obj: wireCubeR, baseY: 0.62, phase: 2.4 },
        );
        group.add(mainPane, leftPane, rightPane, wireCubeL, wireCubeR);
        proxySize = [1.85, 2.05, 0.95];
      } else if (obj.kind === 'arch-portal') {
        const colG = new THREE.BoxGeometry(0.46, 3.3, 0.72);
        const footG = new THREE.BoxGeometry(0.72, 0.24, 0.96);
        const lintelG = new THREE.BoxGeometry(4.15, 0.44, 0.8);
        const stripG = new THREE.BoxGeometry(0.08, 3.0, 0.76);
        const crownStripG = new THREE.BoxGeometry(3.4, 0.08, 0.84);
        worldObjDisposables.push(colG, footG, lintelG, stripG, crownStripG);

        for (const sx of [-1.62, 1.62]) {
          const col = new THREE.Mesh(colG, baseDarkMat);
          col.position.set(sx, 1.65, 0);
          const foot = new THREE.Mesh(footG, metalSilverMat);
          foot.position.set(sx, 0.12, 0);
          const strip = new THREE.Mesh(stripG, accentMat);
          strip.position.set(sx - Math.sign(sx) * 0.21, 1.65, 0);
          group.add(col, foot, strip);
        }
        const lintel = new THREE.Mesh(lintelG, metalSilverMat);
        lintel.position.set(0, 3.48, 0);
        const crownStrip = new THREE.Mesh(crownStripG, accentMat);
        crownStrip.position.set(0, 3.24, 0);
        group.add(lintel, crownStrip);
        proxySize = [3.6, 3.75, 0.95];
      } else if (obj.kind === 'kinetic-sculpture') {
        const pedG = new THREE.CylinderGeometry(0.45, 0.64, 0.45, 20);
        const coreG = new THREE.OctahedronGeometry(0.42, 0);
        const ring1G = new THREE.TorusGeometry(0.68, 0.04, 10, 32);
        const ring2G = new THREE.TorusGeometry(0.92, 0.035, 10, 32);
        worldObjDisposables.push(pedG, coreG, ring1G, ring2G);

        const ped = new THREE.Mesh(pedG, baseDarkMat);
        ped.position.y = 0.225;
        const core = new THREE.Mesh(coreG, accentMat);
        core.position.y = 1.45;
        const r1 = new THREE.Mesh(ring1G, metalSilverMat);
        r1.position.y = 1.45;
        const r2 = new THREE.Mesh(ring2G, accentMat);
        r2.position.y = 1.45;
        r2.rotation.x = Math.PI / 3;
        kineticParts.push(core, r1, r2);
        group.add(ped, core, r1, r2);
        proxySize = [1.8, 2.3, 1.8];
      } else if (obj.kind === 'workstation-desk') {
        const legG = new THREE.BoxGeometry(0.14, 0.74, 0.72);
        const modestyG = new THREE.BoxGeometry(1.4, 0.44, 0.06);
        const topG = new THREE.BoxGeometry(1.78, 0.08, 0.92);
        const kbG = new THREE.BoxGeometry(0.46, 0.025, 0.16);
        const frameG = new THREE.BoxGeometry(1.14, 0.64, 0.06);
        const monG = new THREE.PlaneGeometry(1.06, 0.56);
        worldObjDisposables.push(legG, modestyG, topG, kbG, frameG, monG);
        const legL = new THREE.Mesh(legG, baseDarkMat);
        legL.position.set(-0.74, 0.37, 0);
        const legR = new THREE.Mesh(legG, baseDarkMat);
        legR.position.set(0.74, 0.37, 0);
        const backPanel = new THREE.Mesh(modestyG, baseDarkMat);
        backPanel.position.set(0, 0.48, -0.28);
        const top = new THREE.Mesh(topG, metalSilverMat);
        top.position.y = 0.76;
        const kb = new THREE.Mesh(kbG, baseDarkMat);
        kb.position.set(0, 0.815, 0.18);
        const frame = new THREE.Mesh(frameG, baseDarkMat);
        frame.position.set(0, 1.15, -0.25);

        const tex = screenManager.getTexture({
          objectId: obj.id,
          label: obj.label,
          color: obj.color,
          mediaType: obj.mediaType,
          mediaUrl: obj.mediaUrl,
          screenPreset: obj.screenPreset || 'matrix',
        });
        const scrMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
        worldObjDisposables.push(scrMat);
        const mon = new THREE.Mesh(monG, scrMat);
        mon.position.set(0, 1.15, -0.215);
        group.add(legL, legR, backPanel, top, kb, frame, mon);
        proxySize = [1.85, 1.65, 1.15];
      } else if (obj.kind === 'holo-kiosk') {
        const pedG = new THREE.CylinderGeometry(0.38, 0.52, 0.95, 18);
        const frameG = new THREE.BoxGeometry(0.95, 0.7, 0.07);
        const scrG = new THREE.PlaneGeometry(0.86, 0.6);
        worldObjDisposables.push(pedG, frameG, scrG);
        const ped = new THREE.Mesh(pedG, baseDarkMat);
        ped.position.y = 0.475;
        const frame = new THREE.Mesh(frameG, baseDarkMat);
        frame.position.set(0, 1.38, 0);
        frame.rotation.x = -0.22;

        const tex = screenManager.getTexture({
          objectId: obj.id,
          label: obj.label,
          color: obj.color,
          mediaType: obj.mediaType,
          mediaUrl: obj.mediaUrl,
          screenPreset: obj.screenPreset || 'radar',
        });
        const scrMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide });
        worldObjDisposables.push(scrMat);
        const scr = new THREE.Mesh(scrG, scrMat);
        scr.position.set(0, 1.38, 0.042);
        scr.rotation.x = -0.22;
        group.add(ped, frame, scr);
        proxySize = [1.2, 1.9, 1.1];
      } else if (obj.kind === 'relay-beacon') {
        const baseG = new THREE.CylinderGeometry(0.42, 0.58, 0.4, 14);
        const spireG = new THREE.CylinderGeometry(0.08, 0.16, 2.2, 14);
        const ringG = new THREE.TorusGeometry(0.45, 0.04, 8, 24);
        worldObjDisposables.push(baseG, spireG, ringG);
        const b = new THREE.Mesh(baseG, baseDarkMat);
        b.position.y = 0.2;
        const s = new THREE.Mesh(spireG, metalSilverMat);
        s.position.y = 1.4;
        const r = new THREE.Mesh(ringG, accentMat);
        r.rotation.x = Math.PI / 2;
        r.position.y = 2.35;
        kineticParts.push(r);
        group.add(b, s, r);
        proxySize = [1.2, 2.6, 1.2];
      } else if (obj.kind === 'data-monolith') {
        const monoG = new THREE.BoxGeometry(0.75, 2.6, 0.32);
        const stripG = new THREE.BoxGeometry(0.14, 2.2, 0.36);
        worldObjDisposables.push(monoG, stripG);
        const m = new THREE.Mesh(monoG, baseDarkMat);
        m.position.y = 1.3;
        const st = new THREE.Mesh(stripG, accentMat);
        st.position.y = 1.3;
        group.add(m, st);
        proxySize = [1.1, 2.7, 0.9];
      } else if (obj.kind === 'quantum-crate') {
        const hullG = new THREE.BoxGeometry(0.92, 0.92, 0.92);
        const coreG = new THREE.BoxGeometry(0.72, 0.72, 0.72);
        const railXG = new THREE.BoxGeometry(0.96, 0.1, 0.96);
        const padG = new THREE.BoxGeometry(0.66, 0.04, 0.66);
        worldObjDisposables.push(hullG, coreG, railXG, padG);

        const hull = new THREE.Mesh(hullG, baseDarkMat);
        hull.position.y = 0.48;
        const innerGlow = new THREE.Mesh(coreG, accentMat);
        innerGlow.position.y = 0.48;
        const botRail = new THREE.Mesh(railXG, metalSilverMat);
        botRail.position.y = 0.05;
        const topRail = new THREE.Mesh(railXG, metalSilverMat);
        topRail.position.y = 0.91;
        const topPad = new THREE.Mesh(padG, accentMat);
        topPad.position.y = 0.94;
        group.add(innerGlow, hull, botRail, topRail, topPad);
        proxySize = [0.96, 0.96, 0.96];
      } else {
        const seatG = new THREE.CylinderGeometry(0.82, 0.72, 0.46, 18);
        const rimG = new THREE.TorusGeometry(0.8, 0.05, 8, 24);
        worldObjDisposables.push(seatG, rimG);
        const seat = new THREE.Mesh(seatG, baseDarkMat);
        seat.position.y = 0.23;
        const rim = new THREE.Mesh(rimG, accentMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = 0.46;
        group.add(seat, rim);
        proxySize = [1.7, 0.56, 1.7];
      }

      // Grounding Contact Shadow Pad beneath every object
      const contactG = new THREE.PlaneGeometry(Math.max(1.3, proxySize[0] * 1.15), Math.max(1.3, proxySize[2] * 1.15));
      worldObjDisposables.push(contactG);
      const contactMesh = new THREE.Mesh(contactG, shadowDiscMat);
      contactMesh.rotation.x = -Math.PI / 2;
      contactMesh.position.y = 0.014;
      group.add(contactMesh);

      // Click / Touch-Hold / Pinch-Grab Raycast Proxy Bounding Box
      const proxyG = new THREE.BoxGeometry(proxySize[0], proxySize[1], proxySize[2]);
      worldObjDisposables.push(proxyG);
      const proxy = new THREE.Mesh(proxyG, proxyMat);
      proxy.position.y = proxySize[1] * 0.5;
      proxy.userData = { kind: 'world-object', objectId: obj.id };
      group.add(proxy);
      worldObjectInteractables.push(proxy);

      renderedObjects.set(obj.id, {
        data: obj,
        group,
        kineticParts,
        bobParts,
        timeUniforms,
        phaseOffset: idx * 1.15,
        hasPhysicsPose: false,
      });
      worldObjectsGroup.add(group);
    });
  }

  // Weather Particles (Rain / Ion Storm)
  const particleCount = isSoftwareGl ? 240 : 520;
  const pPositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    pPositions[i * 3] = (Math.random() - 0.5) * 36;
    pPositions[i * 3 + 1] = Math.random() * 14;
    pPositions[i * 3 + 2] = (Math.random() - 0.5) * 36;
  }
  const weatherGeo = new THREE.BufferGeometry();
  weatherGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  const weatherMat = new THREE.PointsMaterial({
    color: 0x7dd3fc,
    size: 0.09,
    transparent: true,
    opacity: 0.72,
  });
  const weatherPoints = new THREE.Points(weatherGeo, weatherMat);
  weatherPoints.visible = false;
  root.add(weatherPoints);
  disposables.push(weatherGeo, weatherMat);

  // Holographic Prototype Pedestal at (0, 0, -5.8)
  const protoPedestal = new THREE.Group();
  protoPedestal.position.set(0, 0, -5.8);
  const pBaseGeo = new THREE.CylinderGeometry(1.05, 1.25, 0.55, 24);
  const pRimGeo = new THREE.TorusGeometry(1.08, 0.04, 8, 28);
  const pBase = new THREE.Mesh(pBaseGeo, titaniumDarkMat);
  pBase.position.y = 0.275;
  const pRim = new THREE.Mesh(pRimGeo, pylonLightMat);
  pRim.rotation.x = Math.PI / 2;
  pRim.position.y = 0.55;
  protoPedestal.add(pBase, pRim);

  const prototypeGroup = new THREE.Group();
  prototypeGroup.position.set(0, 1.35, 0);
  protoPedestal.add(prototypeGroup);
  root.add(protoPedestal);
  disposables.push(pBaseGeo, pRimGeo);

  let currentProtoDisposables: Array<{ dispose: () => void }> = [];

  function setPrototype(kind: PrototypeKind, primaryHex: string, metalness: number) {
    currentProtoDisposables.forEach((d) => d.dispose());
    currentProtoDisposables = [];
    while (prototypeGroup.children.length > 0) {
      prototypeGroup.remove(prototypeGroup.children[0]);
    }

    const bodyMat = new THREE.MeshStandardMaterial({
      color: primaryHex,
      roughness: 0.24,
      metalness,
    });
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x22d3ee,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.4,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
      metalness: 0.45,
    });
    currentProtoDisposables.push(bodyMat, glowMat, darkMat);

    if (kind === 'drone-chassis') {
      const hullGeo = new THREE.OctahedronGeometry(0.32, 1);
      const hull = new THREE.Mesh(hullGeo, bodyMat);
      hull.scale.set(1.3, 0.55, 1.6);
      prototypeGroup.add(hull);
      currentProtoDisposables.push(hullGeo);

      const armGeo = new THREE.BoxGeometry(1.15, 0.05, 0.08);
      const rotorGeo = new THREE.TorusGeometry(0.18, 0.02, 8, 24);
      currentProtoDisposables.push(armGeo, rotorGeo);

      for (const rotY of [Math.PI / 4, -Math.PI / 4]) {
        const arm = new THREE.Mesh(armGeo, darkMat);
        arm.rotation.y = rotY;
        prototypeGroup.add(arm);
      }
      for (const [rx, rz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
        const rotor = new THREE.Mesh(rotorGeo, glowMat);
        rotor.rotation.x = Math.PI / 2;
        rotor.position.set(rx, 0.08, rz);
        prototypeGroup.add(rotor);
      }
    } else if (kind === 'server-rack') {
      const frameGeo = new THREE.BoxGeometry(0.68, 1.15, 0.58);
      const frame = new THREE.Mesh(frameGeo, darkMat);
      prototypeGroup.add(frame);
      const bladeGeo = new THREE.BoxGeometry(0.58, 0.09, 0.52);
      const ledGeo = new THREE.BoxGeometry(0.45, 0.02, 0.03);
      currentProtoDisposables.push(frameGeo, bladeGeo, ledGeo);
      for (let i = 0; i < 6; i++) {
        const y = -0.42 + i * 0.17;
        const blade = new THREE.Mesh(bladeGeo, bodyMat);
        blade.position.set(0, y, 0.04);
        const led = new THREE.Mesh(ledGeo, glowMat);
        led.position.set(0, y, 0.31);
        prototypeGroup.add(blade, led);
      }
    } else if (kind === 'orbital-relay') {
      const coreGeo = new THREE.CylinderGeometry(0.18, 0.24, 0.72, 16);
      const dishGeo = new THREE.LatheGeometry(
        [new THREE.Vector2(0.02, 0), new THREE.Vector2(0.35, 0.08), new THREE.Vector2(0.52, 0.24)],
        24,
      );
      const wingGeo = new THREE.BoxGeometry(0.7, 0.02, 0.28);
      currentProtoDisposables.push(coreGeo, dishGeo, wingGeo);
      prototypeGroup.add(new THREE.Mesh(coreGeo, bodyMat));
      const dish = new THREE.Mesh(dishGeo, glowMat);
      dish.position.y = 0.38;
      prototypeGroup.add(dish);
      const wL = new THREE.Mesh(wingGeo, darkMat);
      wL.position.x = -0.58;
      const wR = new THREE.Mesh(wingGeo, darkMat);
      wR.position.x = 0.58;
      prototypeGroup.add(wL, wR);
    } else {
      const bodyGeo = new THREE.BoxGeometry(0.65, 0.24, 0.92);
      const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.1, 16);
      const mastGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.45, 10);
      const camGeo = new THREE.BoxGeometry(0.22, 0.12, 0.14);
      currentProtoDisposables.push(bodyGeo, wheelGeo, mastGeo, camGeo);
      prototypeGroup.add(new THREE.Mesh(bodyGeo, bodyMat));
      for (const [wx, wz] of [[-0.4, -0.32], [0.4, -0.32], [-0.4, 0.32], [0.4, 0.32]]) {
        const w = new THREE.Mesh(wheelGeo, darkMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, -0.14, wz);
        prototypeGroup.add(w);
      }
      const mast = new THREE.Mesh(mastGeo, darkMat);
      mast.position.set(0, 0.32, 0.25);
      const cam = new THREE.Mesh(camGeo, glowMat);
      cam.position.set(0, 0.56, 0.28);
      prototypeGroup.add(mast, cam);
    }
  }

  setPrototype('orbital-relay', '#38bdf8', 0.85);
  const sunVec = new THREE.Vector3();

  return {
    root,
    prototypeGroup,
    worldObjectInteractables,
    floorMesh,
    setPrototype,
    syncWorldObjects,
    applyPhysicsPoses: (poses) => {
      for (const pose of poses) {
        const entry = renderedObjects.get(pose.id);
        if (!entry) continue;
        entry.hasPhysicsPose = true;
        entry.group.position.set(pose.position[0], pose.position[1], pose.position[2]);
        entry.group.quaternion.set(
          pose.quaternion[0],
          pose.quaternion[1],
          pose.quaternion[2],
          pose.quaternion[3],
        );
      }
    },
    setSelectedObjectId: (id) => {
      selectedObjectId = id;
    },
    setDraggingObject: (id, pos, rotY) => {
      draggingObjectId = id;
      dragPosition = pos ?? null;
      dragRotationY = rotY;
    },
    applyTheme: (theme, weather, timeOfDayHours, customSkyboxActive = true) => {
      indoorGroup.visible =
        theme === 'command-center' ||
        theme === 'tech-office' ||
        theme === 'neural-chamber' ||
        theme === 'holo-ops';
      outdoorGroup.visible = !customSkyboxActive && (theme === 'outdoor-world' || theme === 'aether-district');
      rockInstanced.visible = theme === 'outdoor-world' || theme === 'bioluminescent-canyon';
      districtGroup.visible = theme === 'aether-district';
      orbitalGroup.visible = theme === 'orbital-station';
      alpineGroup.visible = theme === 'alpine-observatory';
      cyberGroup.visible = theme === 'cyber-metropolis';
      canyonGroup.visible = theme === 'bioluminescent-canyon';
      vcaosGroup.visible = theme === 'vcaos-nexus';

      volumetricGroup.visible =
        theme === 'command-center' ||
        theme === 'neural-chamber' ||
        theme === 'cyber-metropolis' ||
        theme === 'bioluminescent-canyon' ||
        theme === 'vcaos-nexus';

      const normalizedHour = ((timeOfDayHours - 6) / 16) * Math.PI;
      const sunElevation = Math.max(-2, Math.min(10, Math.sin(normalizedHour) * 10 - 1));
      const phi = THREE.MathUtils.degToRad(90 - sunElevation);
      const theta = THREE.MathUtils.degToRad(210);
      sunVec.setFromSphericalCoords(1, phi, theta);
      skyUniforms['sunPosition'].value.copy(sunVec);

      const isRain = weather === 'rain' || theme === 'cyber-metropolis';
      floorMat.clearcoat = isRain ? 0.94 : theme === 'alpine-observatory' ? 0.58 : 0.24;
      floorMat.clearcoatRoughness = isRain ? 0.08 : 0.28;
      floorMat.roughness = isRain ? 0.24 : theme === 'tech-office' ? 0.44 : 0.52;

      if (theme === 'cyber-metropolis') {
        scene.background = new THREE.Color(0x050312);
        scene.fog = new THREE.FogExp2(0x130728, 0.016);
        hemiLight.color.setHex(0xe879f9);
        hemiLight.groundColor.setHex(0x090d1a);
        hemiLight.intensity = 1.05;
        keyLight.color.setHex(0x67e8f9);
        keyLight.intensity = 2.15;
        gridRingMat.color.setHex(0xf472b6);
        beamMat.color.setHex(0xf472b6);
        moteMat.color.setHex(0xf472b6);
        floorMat.color.setHex(0x475569);
      } else if (theme === 'orbital-station') {
        scene.background = new THREE.Color(0x02040a);
        scene.fog = new THREE.FogExp2(0x020612, 0.01);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 1.0;
        keyLight.color.setHex(0xfffbeb);
        keyLight.intensity = 2.6;
        gridRingMat.color.setHex(0x38bdf8);
        moteMat.color.setHex(0xe0f2fe);
        floorMat.color.setHex(0x94a3b8);
      } else if (theme === 'alpine-observatory') {
        scene.background = new THREE.Color(0x040b18);
        scene.fog = new THREE.FogExp2(0x0c2130, 0.013);
        hemiLight.color.setHex(0xa7f3d0);
        hemiLight.groundColor.setHex(0x1e293b);
        hemiLight.intensity = 1.08;
        keyLight.color.setHex(0xfde68a);
        keyLight.intensity = 2.2;
        gridRingMat.color.setHex(0x34d399);
        moteMat.color.setHex(0xa7f3d0);
        floorMat.color.setHex(0xcbd5e1);
      } else if (theme === 'bioluminescent-canyon') {
        scene.background = new THREE.Color(0x040714);
        scene.fog = new THREE.FogExp2(0x081b2d, 0.018);
        hemiLight.color.setHex(0x22d3ee);
        hemiLight.groundColor.setHex(0x1e1b4b);
        hemiLight.intensity = 1.0;
        keyLight.color.setHex(0xe879f9);
        keyLight.intensity = 2.0;
        gridRingMat.color.setHex(0x22d3ee);
        beamMat.color.setHex(0x22d3ee);
        moteMat.color.setHex(0x67e8f9);
        floorMat.color.setHex(0x64748b);
      } else if (theme === 'aether-district') {
        const bg = timeOfDayHours >= 8 && timeOfDayHours <= 17 ? 0x0c1a2e : 0x050914;
        scene.background = new THREE.Color(bg);
        scene.fog = new THREE.FogExp2(bg, 0.015);
        hemiLight.color.setHex(0xbae6fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 1.05;
        keyLight.color.setHex(0xfff1d6);
        keyLight.intensity = 2.3;
        gridRingMat.color.setHex(0x38bdf8);
        moteMat.color.setHex(0x67e8f9);
        floorMat.color.setHex(0x94a3b8);
      } else if (theme === 'outdoor-world') {
        const bg = timeOfDayHours >= 8 && timeOfDayHours <= 17 ? 0x132238 : 0x070d1a;
        scene.background = new THREE.Color(bg);
        scene.fog = new THREE.FogExp2(bg, 0.018);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.98;
        keyLight.color.setHex(0xfff1d6);
        keyLight.intensity = 2.05;
        moteMat.color.setHex(0xbae6fd);
        floorMat.color.setHex(0x64748b);
      } else if (theme === 'tech-office') {
        scene.background = new THREE.Color(0x0f172a);
        scene.fog = new THREE.FogExp2(0x0f172a, 0.018);
        hemiLight.color.setHex(0xe2e8f0);
        hemiLight.groundColor.setHex(0x1e293b);
        hemiLight.intensity = 1.15;
        keyLight.color.setHex(0xfff7ed);
        keyLight.intensity = 2.35;
        pylonLightMat.color.setHex(0x60a5fa);
        gridRingMat.color.setHex(0x60a5fa);
        moteMat.color.setHex(0x93c5fd);
        floorMat.color.setHex(0xcbd5e1);
      } else if (theme === 'neural-chamber') {
        scene.background = new THREE.Color(0x04060d);
        scene.fog = new THREE.FogExp2(0x04060d, 0.025);
        hemiLight.color.setHex(0x6366f1);
        hemiLight.groundColor.setHex(0x030712);
        hemiLight.intensity = 0.78;
        keyLight.color.setHex(0xe0e7ff);
        keyLight.intensity = 1.95;
        pylonLightMat.color.setHex(0x8b5cf6);
        gridRingMat.color.setHex(0x8b5cf6);
        beamMat.color.setHex(0x8b5cf6);
        moteMat.color.setHex(0xa78bfa);
        floorMat.color.setHex(0x64748b);
      } else if (theme === 'holo-ops') {
        scene.background = new THREE.Color(0x06101e);
        scene.fog = new THREE.FogExp2(0x06101e, 0.021);
        hemiLight.color.setHex(0x38bdf8);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 1.0;
        keyLight.color.setHex(0xecfdf5);
        keyLight.intensity = 2.1;
        pylonLightMat.color.setHex(0x10b981);
        gridRingMat.color.setHex(0x10b981);
        moteMat.color.setHex(0x34d399);
        floorMat.color.setHex(0x94a3b8);
      } else if (theme === 'vcaos-nexus') {
        scene.background = new THREE.Color(0x050816);
        scene.fog = new THREE.FogExp2(0x09112b, 0.017);
        hemiLight.color.setHex(0x818cf8);
        hemiLight.groundColor.setHex(0x060b19);
        hemiLight.intensity = 1.05;
        keyLight.color.setHex(0xe0f2fe);
        keyLight.intensity = 2.25;
        pylonLightMat.color.setHex(0x38bdf8);
        gridRingMat.color.setHex(0x6366f1);
        beamMat.color.setHex(0x6366f1);
        moteMat.color.setHex(0x38bdf8);
        floorMat.color.setHex(0x94a3b8);
      } else {
        scene.background = new THREE.Color(0x070b14);
        scene.fog = new THREE.FogExp2(0x070b14, 0.019);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.95;
        keyLight.color.setHex(0xfff1d6);
        keyLight.intensity = 2.3;
        pylonLightMat.color.setHex(0x22d3ee);
        gridRingMat.color.setHex(0x22d3ee);
        beamMat.color.setHex(0x38bdf8);
        moteMat.color.setHex(0x67e8f9);
        floorMat.color.setHex(0xffffff);
      }

      weatherPoints.visible = weather !== 'clear' || theme === 'cyber-metropolis';
      weatherMat.color.setHex(
        weather === 'ion-storm' ? 0xa78bfa : theme === 'cyber-metropolis' ? 0xf472b6 : 0x7dd3fc,
      );
    },
    update: (elapsed, delta, weather) => {
      prototypeGroup.rotation.y += delta * 0.45;
      if (indoorGroup.visible) {
        ceilingSensorRotor.rotation.y += delta * 0.28;
      }
      if (cyberGroup.visible) {
        trainOrbit.rotation.y += delta * 0.24;
      }
      if (vcaosGroup.visible) {
        vcaosBeaconRing.rotation.y += delta * 0.22;
        for (let i = 0; i < vcaosWindows.length; i++) {
          const w = vcaosWindows[i];
          const baseY = Number(w.userData.baseY ?? 3.3);
          const phase = Number(w.userData.phase ?? 0);
          w.position.y = baseY + Math.sin(elapsed * 1.4 + phase) * 0.14;
        }
      }

      // Update animated screen textures & fallback motion transforms
      const activeIds = new Set<string>(vcaosWindowScreens.map((s) => s.id));
      for (const [id, entry] of renderedObjects.entries()) {
        activeIds.add(id);
        if (draggingObjectId === id && dragPosition) {
          entry.group.position.set(dragPosition[0], dragPosition[1] ?? 0.35, dragPosition[2]);
          if (typeof dragRotationY === 'number') {
            entry.group.rotation.set(0, dragRotationY, 0);
          }
        } else if (!entry.hasPhysicsPose) {
          const t = computeObjectMotionTransform(
            entry.data.motion,
            entry.data.position,
            entry.data.rotationY,
            elapsed,
            entry.phaseOffset,
          );
          entry.group.position.set(t.x, t.y, t.z);
          entry.group.rotation.set(0, t.rotationY, 0);
        }

        for (let i = 0; i < entry.kineticParts.length; i++) {
          const part = entry.kineticParts[i];
          part.rotation.y += delta * (i % 2 === 0 ? 1.1 : -0.8);
          if (entry.data.kind === 'kinetic-sculpture' && i > 0) {
            part.rotation.x += delta * 0.45;
          }
        }
        for (let i = 0; i < entry.bobParts.length; i++) {
          const bp = entry.bobParts[i];
          bp.obj.position.y = bp.baseY + Math.sin(elapsed * 2.4 + bp.phase) * 0.08;
        }
        for (let i = 0; i < entry.timeUniforms.length; i++) {
          entry.timeUniforms[i].value = elapsed;
        }
      }
      screenManager.update(elapsed, delta, activeIds);

      // Position glowing selection/drag reticle under selected or held object
      const targetId = draggingObjectId || selectedObjectId;
      const targetEntry = targetId ? renderedObjects.get(targetId) : undefined;
      if (targetEntry) {
        selectionRing.visible = true;
        selectionRing.position.x = targetEntry.group.position.x;
        selectionRing.position.y = Math.max(0.03, targetEntry.group.position.y + 0.03);
        selectionRing.position.z = targetEntry.group.position.z;
        const pulse = 1 + Math.sin(elapsed * 5) * 0.06;
        selectionRing.scale.setScalar(pulse * Math.max(0.8, targetEntry.data.scale ?? 1));
        selectionRingMat.color.setHex(draggingObjectId ? 0x34d399 : 0x22d3ee);
      } else {
        selectionRing.visible = false;
      }

      const moteAttr = moteGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < moteCount; i++) {
        let my = moteAttr.getY(i) + Math.sin(elapsed * 0.9 + i) * delta * 0.25;
        if (my > 9.5) my = 0.6;
        if (my < 0.4) my = 9.0;
        moteAttr.setY(i, my);
      }
      moteAttr.needsUpdate = true;

      if (weather !== 'clear' || weatherPoints.visible) {
        const attr = weatherGeo.attributes.position as THREE.BufferAttribute;
        const speed = weather === 'ion-storm' ? 11 : 7;
        for (let i = 0; i < particleCount; i++) {
          let y = attr.getY(i) - delta * speed;
          if (y < 0) y = 14;
          attr.setY(i, y);
        }
        attr.needsUpdate = true;
      }
    },
    dispose: () => {
      screenManager.dispose();
      worldObjDisposables.forEach((d) => d.dispose());
      currentProtoDisposables.forEach((d) => d.dispose());
      disposables.forEach((d) => d.dispose());
    },
  };
}
