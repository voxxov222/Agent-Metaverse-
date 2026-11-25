import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { EnvironmentTheme, WeatherMode, WorldObject } from '../types/os';
import { computeObjectMotionTransform } from '../utils/worldEnhancements';
import { AnimatedScreenManager } from './screenMedia';
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
  floorAlbedo: THREE.Texture,
  floorBump: THREE.Texture,
  floorRoughness: THREE.Texture,
  maxAnisotropy: number,
  isSoftwareGl: boolean,
): EnvironmentController {
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // Lighting Rig (Warm directional key + cool hemisphere fill + rim + warm fill)
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.3);
  keyLight.position.set(12, 18, 10);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 52;
    const d = 18;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
  }
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.95);
  rimLight.position.set(-14, 9, -12);
  scene.add(rimLight);

  // Hyper-Realistic PBR Ground Floor
  const floorGeo = new THREE.CircleGeometry(70, 64);
  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: floorAlbedo,
    bumpMap: floorBump,
    bumpScale: 0.032,
    roughnessMap: floorRoughness,
    roughness: 0.56,
    metalness: 0.48,
    clearcoat: 0.15,
    clearcoatRoughness: 0.35,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  disposables.push(floorGeo, floorMat);

  // Polar Holographic Floor Rings
  const gridRingGeo = new THREE.RingGeometry(4.0, 4.14, 72);
  const gridRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const gridRing = new THREE.Mesh(gridRingGeo, gridRingMat);
  gridRing.rotation.x = -Math.PI / 2;
  gridRing.position.y = 0.025;
  root.add(gridRing);
  disposables.push(gridRingGeo, gridRingMat);

  // Volumetric Additive Light Shafts (soft overhead atmospheric beams)
  const volumetricGroup = new THREE.Group();
  const beamGeo = new THREE.CylinderGeometry(0.4, 3.6, 13, 24, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.055,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(Math.cos(angle) * 7.8, 6.5, Math.sin(angle) * 7.8);
    volumetricGroup.add(beam);
  }
  root.add(volumetricGroup);
  disposables.push(beamGeo, beamMat);

  // 1. Indoor Architectural Pylons (Command Center / Tech Office / Neural Chamber / Holo Ops)
  const indoorGroup = new THREE.Group();
  const pylonShape = new THREE.Shape();
  pylonShape.moveTo(-0.35, 0);
  pylonShape.lineTo(0.35, 0);
  pylonShape.lineTo(0.22, 6.4);
  pylonShape.lineTo(-0.22, 6.4);
  pylonShape.closePath();

  const pylonGeo = new THREE.ExtrudeGeometry(pylonShape, {
    depth: 0.55,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x161f30,
    roughness: 0.42,
    metalness: 0.78,
  });
  const pylonLightGeo = new THREE.BoxGeometry(0.08, 5.0, 0.08);
  const pylonLightMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const pGroup = new THREE.Group();
    pGroup.position.set(Math.cos(angle) * 11.8, 0, Math.sin(angle) * 11.8);
    pGroup.lookAt(0, 0, 0);
    const mesh = new THREE.Mesh(pylonGeo, pylonMat);
    mesh.castShadow = !isSoftwareGl;
    mesh.receiveShadow = true;
    const strip = new THREE.Mesh(pylonLightGeo, pylonLightMat);
    strip.position.set(0, 3.1, 0.6);
    pGroup.add(mesh, strip);
    indoorGroup.add(pGroup);
  }

  // Advanced Architectural Overhead Gantry Ribs + Central Ceiling Oculus + Radial Floor Bus Conduits
  const oculusOuterGeo = new THREE.TorusGeometry(4.4, 0.24, 12, 48);
  const oculusInnerGeo = new THREE.TorusGeometry(3.95, 0.055, 10, 48);
  const gantryRibGeo = new THREE.BoxGeometry(0.32, 0.38, 8.2);
  const gantryLightGeo = new THREE.BoxGeometry(0.09, 0.06, 7.6);
  const floorBusGeo = new THREE.BoxGeometry(0.14, 0.025, 9.2);
  const gantryDarkMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.34,
    metalness: 0.84,
  });

  const oculusOuter = new THREE.Mesh(oculusOuterGeo, gantryDarkMat);
  oculusOuter.rotation.x = Math.PI / 2;
  oculusOuter.position.y = 8.45;
  const oculusGlow = new THREE.Mesh(oculusInnerGeo, pylonLightMat);
  oculusGlow.rotation.x = Math.PI / 2;
  oculusGlow.position.y = 8.32;
  indoorGroup.add(oculusOuter, oculusGlow);

  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const ribWrap = new THREE.Group();
    ribWrap.rotation.y = -ang + Math.PI / 2;
    const rib = new THREE.Mesh(gantryRibGeo, gantryDarkMat);
    rib.position.set(0, 7.32, 7.9);
    rib.rotation.x = 0.28;
    const ribLight = new THREE.Mesh(gantryLightGeo, pylonLightMat);
    ribLight.position.set(0, 7.1, 7.9);
    ribLight.rotation.x = 0.28;
    const floorBus = new THREE.Mesh(floorBusGeo, pylonLightMat);
    floorBus.position.set(0, 0.018, 7.0);
    ribWrap.add(rib, ribLight, floorBus);
    indoorGroup.add(ribWrap);
  }
  root.add(indoorGroup);
  disposables.push(
    pylonGeo,
    pylonMat,
    pylonLightGeo,
    pylonLightMat,
    oculusOuterGeo,
    oculusInnerGeo,
    gantryRibGeo,
    gantryLightGeo,
    floorBusGeo,
    gantryDarkMat,
  );

  // 2. Legacy Sky + Outdoor Rocks
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

  const rockGeo = new THREE.DodecahedronGeometry(1.3, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.88,
    metalness: 0.08,
  });
  const rockCount = 44;
  const rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  const dummy = new THREE.Object3D();
  const rockColor = new THREE.Color();

  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2;
    const radius = 22 + (i % 5) * 4.5;
    const scaleY = 1.4 + (i % 4) * 0.9;
    const scaleXZ = 1.0 + (i % 3) * 0.35;
    dummy.position.set(Math.cos(angle) * radius, scaleY * 0.45, Math.sin(angle) * radius);
    dummy.rotation.set((i % 3) * 0.15, angle, (i % 2) * 0.12);
    dummy.scale.set(scaleXZ, scaleY, scaleXZ);
    dummy.updateMatrix();
    rockInstanced.setMatrixAt(i, dummy.matrix);
    rockColor.setHSL(0.58, 0.14, 0.18 + (i % 4) * 0.04);
    rockInstanced.setColorAt(i, rockColor);
  }
  rockInstanced.instanceMatrix.needsUpdate = true;
  if (rockInstanced.instanceColor) rockInstanced.instanceColor.needsUpdate = true;
  rockInstanced.computeBoundingSphere();
  outdoorGroup.add(rockInstanced);
  root.add(outdoorGroup);
  disposables.push(rockGeo, rockMat);

  // 3. Aether District Campus Skyline & Walkways
  const districtGroup = new THREE.Group();
  districtGroup.visible = false;

  const towerGeo = new THREE.BoxGeometry(3.2, 1, 3.2);
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x162238,
    roughness: 0.35,
    metalness: 0.75,
  });
  const towerTrimGeo = new THREE.BoxGeometry(0.18, 1, 3.28);
  const towerTrimMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const towerCount = 18;
  const towerInst = new THREE.InstancedMesh(towerGeo, towerMat, towerCount);
  const towerTrimInst = new THREE.InstancedMesh(towerTrimGeo, towerTrimMat, towerCount);
  const tDummy = new THREE.Object3D();
  for (let i = 0; i < towerCount; i++) {
    const angle = (i / towerCount) * Math.PI * 2 + 0.17;
    const radius = 23 + (i % 3) * 6.5;
    const h = 8 + (i % 5) * 4.5;
    tDummy.position.set(Math.cos(angle) * radius, h / 2, Math.sin(angle) * radius);
    tDummy.rotation.set(0, angle, 0);
    tDummy.scale.set(1 + (i % 2) * 0.4, h, 1 + (i % 3) * 0.25);
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

  const walkwayGeo = new THREE.PlaneGeometry(2.6, 36);
  const walkwayMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.55,
    metalness: 0.4,
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

  const outerRingGeo = new THREE.RingGeometry(13.8, 14.1, 64);
  const outerRingMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.45,
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
  disposables.push(towerGeo, towerMat, towerTrimGeo, towerTrimMat, walkwayGeo, walkwayMat, outerRingGeo, outerRingMat);

  // 4. HYPER THEME: Orbital Station Ring Deck + Solar Arrays
  const orbitalGroup = new THREE.Group();
  orbitalGroup.visible = false;

  const hullRibGeo = new THREE.TorusGeometry(15.5, 0.28, 12, 48, Math.PI * 1.12);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.88 });
  const hullGlowGeo = new THREE.TorusGeometry(15.2, 0.06, 8, 48, Math.PI * 1.1);
  const hullGlowMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  for (let i = 0; i < 4; i++) {
    const arch = new THREE.Mesh(hullRibGeo, hullMat);
    arch.rotation.y = (i / 4) * Math.PI + 0.3;
    arch.rotation.z = -0.06;
    arch.position.y = 1.2;
    const archGlow = new THREE.Mesh(hullGlowGeo, hullGlowMat);
    archGlow.rotation.copy(arch.rotation);
    archGlow.position.y = 1.2;
    orbitalGroup.add(arch, archGlow);
  }
  const solarMastGeo = new THREE.BoxGeometry(0.35, 0.35, 14);
  const solarWingGeo = new THREE.BoxGeometry(3.4, 0.06, 11.5);
  const solarMat = new THREE.MeshPhysicalMaterial({
    color: 0x0c4a6e,
    roughness: 0.14,
    metalness: 0.82,
    clearcoat: 0.8,
  });
  for (const side of [-1, 1]) {
    const truss = new THREE.Group();
    truss.position.set(side * 24, 5.5, -14);
    truss.rotation.set(0.25, side * 0.35, 0);
    truss.add(new THREE.Mesh(solarMastGeo, hullMat));
    const wing = new THREE.Mesh(solarWingGeo, solarMat);
    truss.add(wing);
    orbitalGroup.add(truss);
  }
  root.add(orbitalGroup);
  disposables.push(hullRibGeo, hullMat, hullGlowGeo, hullGlowMat, solarMastGeo, solarWingGeo, solarMat);

  // 5. HYPER THEME: Alpine Observatory Mountain Peaks & Amber Deck Beacons
  const alpineGroup = new THREE.Group();
  alpineGroup.visible = false;

  const peakGeo = new THREE.ConeGeometry(4.5, 1, 5);
  const peakMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.1 });
  const peakCount = 32;
  const peakInst = new THREE.InstancedMesh(peakGeo, peakMat, peakCount);
  const pDummy = new THREE.Object3D();
  const pColor = new THREE.Color();
  for (let i = 0; i < peakCount; i++) {
    const angle = (i / peakCount) * Math.PI * 2;
    const r = 34 + (i % 4) * 6.5;
    const h = 11 + (i % 5) * 4.5;
    pDummy.position.set(Math.cos(angle) * r, h * 0.45, Math.sin(angle) * r);
    pDummy.rotation.set(0, angle * 1.7, 0);
    pDummy.scale.set(1.3 + (i % 3) * 0.4, h, 1.3 + (i % 2) * 0.4);
    pDummy.updateMatrix();
    peakInst.setMatrixAt(i, pDummy.matrix);
    pColor.setHSL(0.58, 0.2, 0.55 + (i % 3) * 0.12);
    peakInst.setColorAt(i, pColor);
  }
  peakInst.instanceMatrix.needsUpdate = true;
  if (peakInst.instanceColor) peakInst.instanceColor.needsUpdate = true;
  peakInst.computeBoundingSphere();
  alpineGroup.add(peakInst);

  const lanternPostGeo = new THREE.CylinderGeometry(0.08, 0.14, 2.2, 10);
  const lanternBulbGeo = new THREE.SphereGeometry(0.18, 12, 12);
  const lanternBulbMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.25;
    const post = new THREE.Mesh(lanternPostGeo, hullMat);
    post.position.set(Math.cos(a) * 12.2, 1.1, Math.sin(a) * 12.2);
    const bulb = new THREE.Mesh(lanternBulbGeo, lanternBulbMat);
    bulb.position.set(Math.cos(a) * 12.2, 2.28, Math.sin(a) * 12.2);
    alpineGroup.add(post, bulb);
  }
  root.add(alpineGroup);
  disposables.push(peakGeo, peakMat, lanternPostGeo, lanternBulbGeo, lanternBulbMat);

  // 6. HYPER THEME: Cyber Metropolis Skyscrapers & Neon Strips
  const cyberGroup = new THREE.Group();
  cyberGroup.visible = false;

  const skyGeo = new THREE.BoxGeometry(3.8, 1, 3.8);
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x090d1a, roughness: 0.28, metalness: 0.85 });
  const neonGeo = new THREE.BoxGeometry(0.24, 1, 3.92);
  const neonMat = new THREE.MeshBasicMaterial({ color: 0xf472b6 });
  const neonAltGeo = new THREE.BoxGeometry(3.92, 0.22, 3.92);
  const neonAltMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const cyberCount = 24;
  const cyberInst = new THREE.InstancedMesh(skyGeo, skyMat, cyberCount);
  const neonInst = new THREE.InstancedMesh(neonGeo, neonMat, cyberCount);
  const neonCrownInst = new THREE.InstancedMesh(neonAltGeo, neonAltMat, cyberCount);
  const cDummy = new THREE.Object3D();
  for (let i = 0; i < cyberCount; i++) {
    const a = (i / cyberCount) * Math.PI * 2;
    const r = 21 + (i % 3) * 7;
    const h = 14 + (i % 6) * 5.2;
    cDummy.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    cDummy.rotation.set(0, a, 0);
    cDummy.scale.set(1 + (i % 2) * 0.35, h, 1 + (i % 3) * 0.3);
    cDummy.updateMatrix();
    cyberInst.setMatrixAt(i, cDummy.matrix);
    cDummy.scale.set(1, h * 0.92, 1);
    cDummy.updateMatrix();
    neonInst.setMatrixAt(i, cDummy.matrix);
    cDummy.position.set(Math.cos(a) * r, h - 0.5, Math.sin(a) * r);
    cDummy.scale.set(1 + (i % 2) * 0.35, 1, 1 + (i % 3) * 0.3);
    cDummy.updateMatrix();
    neonCrownInst.setMatrixAt(i, cDummy.matrix);
  }
  cyberInst.instanceMatrix.needsUpdate = true;
  neonInst.instanceMatrix.needsUpdate = true;
  neonCrownInst.instanceMatrix.needsUpdate = true;
  cyberGroup.add(cyberInst, neonInst, neonCrownInst);
  root.add(cyberGroup);
  disposables.push(skyGeo, skyMat, neonGeo, neonMat, neonAltGeo, neonAltMat);

  // 7. HYPER THEME: Bioluminescent Canyon Crystals & Cliffs
  const canyonGroup = new THREE.Group();
  canyonGroup.visible = false;

  const crystalGeo = new THREE.OctahedronGeometry(0.85, 0);
  const crystalMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x06b6d4,
    emissiveIntensity: 0.75,
    roughness: 0.2,
    metalness: 0.3,
  });
  const crystalCount = 26;
  const crystalInst = new THREE.InstancedMesh(crystalGeo, crystalMat, crystalCount);
  const crColor = new THREE.Color();
  for (let i = 0; i < crystalCount; i++) {
    const a = (i / crystalCount) * Math.PI * 2 + 0.1;
    const r = 13.5 + (i % 4) * 3.8;
    const h = 1.6 + (i % 4) * 1.1;
    cDummy.position.set(Math.cos(a) * r, h * 0.45, Math.sin(a) * r);
    cDummy.rotation.set((i % 3) * 0.18, a, ((i + 1) % 3) * 0.16);
    cDummy.scale.set(0.65, h, 0.65);
    cDummy.updateMatrix();
    crystalInst.setMatrixAt(i, cDummy.matrix);
    crColor.setHex(i % 2 === 0 ? 0x22d3ee : 0xe879f9);
    crystalInst.setColorAt(i, crColor);
  }
  crystalInst.instanceMatrix.needsUpdate = true;
  if (crystalInst.instanceColor) crystalInst.instanceColor.needsUpdate = true;
  canyonGroup.add(crystalInst);
  root.add(canyonGroup);
  disposables.push(crystalGeo, crystalMat);

  // Ambient Floating Motes / Bioluminescent Spores
  const moteCount = isSoftwareGl ? 60 : 140;
  const motePos = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 28;
    motePos[i * 3 + 1] = 0.6 + Math.random() * 8.5;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * 28;
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

  // Persistent Placed World Objects + Animated Screen Manager + Selection / Drag Gizmo
  const screenManager = new AnimatedScreenManager(maxAnisotropy, isSoftwareGl);
  const worldObjectsGroup = new THREE.Group();
  root.add(worldObjectsGroup);
  const worldObjectInteractables: THREE.Object3D[] = [];
  const renderedObjects = new Map<string, RenderedWorldObjectEntry>();
  let worldObjDisposables: Array<{ dispose: () => void }> = [];

  let selectedObjectId: string | null = null;
  let draggingObjectId: string | null = null;
  let dragPosition: [number, number, number] | null = null;
  let dragRotationY: number | undefined;

  const selectionRingGeo = new THREE.RingGeometry(0.92, 1.12, 48);
  const selectionRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.9,
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

    const baseDarkMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.38,
      metalness: 0.72,
    });
    const metalSilverMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.25,
      metalness: 0.85,
    });
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    worldObjDisposables.push(baseDarkMat, metalSilverMat, proxyMat);

    objects.forEach((obj, idx) => {
      const group = new THREE.Group();
      group.position.set(obj.position[0], obj.position[1] ?? 0, obj.position[2]);
      group.rotation.y = obj.rotationY;
      const objScale = Math.max(0.4, Math.min(3.0, obj.scale ?? 1));
      group.scale.setScalar(objScale);

      const accentMat = new THREE.MeshStandardMaterial({
        color: obj.color,
        emissive: obj.color,
        emissiveIntensity: 0.9,
        roughness: 0.24,
        metalness: 0.48,
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

        const baseG = new THREE.CylinderGeometry(0.55, 0.72, 0.16, 20);
        const postG = new THREE.CylinderGeometry(0.08, 0.11, screenY - h * 0.4, 12);
        const frameG = new THREE.BoxGeometry(w + 0.18, h + 0.18, 0.1);
        const displayG = new THREE.PlaneGeometry(w, h);
        const trimG = new THREE.BoxGeometry(w + 0.24, 0.05, 0.13);
        worldObjDisposables.push(baseG, postG, frameG, displayG, trimG);

        const base = new THREE.Mesh(baseG, baseDarkMat);
        base.position.y = 0.08;
        const post = new THREE.Mesh(postG, metalSilverMat);
        post.position.y = (screenY - h * 0.4) * 0.5 + 0.12;
        const frame = new THREE.Mesh(frameG, baseDarkMat);
        frame.position.set(0, screenY, 0);
        const topTrim = new THREE.Mesh(trimG, accentMat);
        topTrim.position.set(0, screenY + h * 0.5 + 0.07, 0);
        const botTrim = new THREE.Mesh(trimG, accentMat);
        botTrim.position.set(0, screenY - h * 0.5 - 0.07, 0);

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
        displayFront.position.set(0, screenY, 0.055);
        const displayBack = new THREE.Mesh(displayG, screenMat);
        displayBack.position.set(0, screenY, -0.055);
        displayBack.rotation.y = Math.PI;

        group.add(base, post, frame, topTrim, botTrim, displayFront, displayBack);
        proxySize = [w + 0.4, screenY + h * 0.6, 0.9];
      } else if (obj.kind === 'quantum-workstation') {
        // Real Multi-Monitor Computer Rig + Under-Desk Liquid-Cooled PC Tower + Keyboard/Mouse
        const deskTopG = new THREE.BoxGeometry(2.36, 0.08, 1.12);
        const legG = new THREE.BoxGeometry(0.14, 0.74, 0.94);
        const towerShellG = new THREE.BoxGeometry(0.32, 0.62, 0.62);
        const towerCoreG = new THREE.BoxGeometry(0.24, 0.44, 0.48);
        const kbG = new THREE.BoxGeometry(0.58, 0.03, 0.22);
        const armG = new THREE.BoxGeometry(0.08, 0.45, 0.08);
        const ctrFrameG = new THREE.BoxGeometry(1.04, 0.62, 0.05);
        const ctrScrG = new THREE.PlaneGeometry(0.96, 0.54);
        const sideFrameG = new THREE.BoxGeometry(0.68, 0.52, 0.045);
        const sideScrG = new THREE.PlaneGeometry(0.62, 0.46);
        worldObjDisposables.push(
          deskTopG, legG, towerShellG, towerCoreG, kbG, armG,
          ctrFrameG, ctrScrG, sideFrameG, sideScrG,
        );

        const deskTop = new THREE.Mesh(deskTopG, metalSilverMat);
        deskTop.position.y = 0.78;
        const legL = new THREE.Mesh(legG, baseDarkMat);
        legL.position.set(-1.05, 0.37, 0);
        const legR = new THREE.Mesh(legG, baseDarkMat);
        legR.position.set(1.05, 0.37, 0);

        const pcTower = new THREE.Mesh(towerShellG, baseDarkMat);
        pcTower.position.set(0.76, 0.31, 0.06);
        const pcGlow = new THREE.Mesh(towerCoreG, accentMat);
        pcGlow.position.set(0.76, 0.31, 0.09);

        const kb = new THREE.Mesh(kbG, baseDarkMat);
        kb.position.set(-0.08, 0.84, 0.26);
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
        ctrScr.position.set(0, 1.24, -0.27);

        const leftWrap = new THREE.Group();
        leftWrap.position.set(-0.84, 1.22, -0.16);
        leftWrap.rotation.y = 0.42;
        leftWrap.add(new THREE.Mesh(sideFrameG, baseDarkMat));
        const lScr = new THREE.Mesh(sideScrG, auxMat);
        lScr.position.z = 0.025;
        leftWrap.add(lScr);

        const rightWrap = new THREE.Group();
        rightWrap.position.set(0.84, 1.22, -0.16);
        rightWrap.rotation.y = -0.42;
        rightWrap.add(new THREE.Mesh(sideFrameG, baseDarkMat));
        const rScr = new THREE.Mesh(sideScrG, auxMat);
        rScr.position.z = 0.025;
        rightWrap.add(rScr);

        group.add(deskTop, legL, legR, pcTower, pcGlow, kb, arm, ctrFrame, ctrScr, leftWrap, rightWrap);
        proxySize = [2.45, 1.65, 1.38];
      } else if (obj.kind === 'mainframe-rack') {
        // Supercomputer Server Cabinet with 7 Compute Blades + Spinning Cooling Fans
        const cabG = new THREE.BoxGeometry(1.16, 2.34, 0.86);
        const bladeG = new THREE.BoxGeometry(0.96, 0.16, 0.72);
        const ledG = new THREE.BoxGeometry(0.82, 0.035, 0.04);
        const fanG = new THREE.TorusGeometry(0.24, 0.04, 8, 20);
        const spokeG = new THREE.BoxGeometry(0.42, 0.05, 0.03);
        worldObjDisposables.push(cabG, bladeG, ledG, fanG, spokeG);

        const cab = new THREE.Mesh(cabG, baseDarkMat);
        cab.position.y = 1.17;
        group.add(cab);

        for (let b = 0; b < 7; b++) {
          const y = 0.28 + b * 0.29;
          const blade = new THREE.Mesh(bladeG, metalSilverMat);
          blade.position.set(0, y, 0.09);
          const led = new THREE.Mesh(ledG, accentMat);
          led.position.set(0, y, 0.45);
          group.add(blade, led);
        }

        const topFan = new THREE.Group();
        topFan.position.set(0, 2.38, 0);
        topFan.rotation.x = Math.PI / 2;
        topFan.add(new THREE.Mesh(fanG, metalSilverMat), new THREE.Mesh(spokeG, accentMat));
        kineticParts.push(topFan);
        group.add(topFan);
        proxySize = [1.22, 2.4, 0.92];
      } else if (obj.kind === 'holo-terrain-table') {
        // Tactical Holographic Terrain Table (inspired by 200w__1__551cf9b7.webp!)
        const pedG = new THREE.CylinderGeometry(0.75, 1.05, 0.72, 8);
        const rimG = new THREE.BoxGeometry(2.36, 0.14, 2.36);
        const cornerG = new THREE.BoxGeometry(0.55, 0.06, 0.08);
        const meshGeo = new THREE.PlaneGeometry(1.96, 1.96, 16, 16);
        const gemG = new THREE.OctahedronGeometry(0.11, 0);
        const gemHaloG = new THREE.RingGeometry(0.14, 0.19, 20);
        worldObjDisposables.push(pedG, rimG, cornerG, meshGeo, gemG, gemHaloG);

        const ped = new THREE.Mesh(pedG, baseDarkMat);
        ped.position.y = 0.36;
        const rim = new THREE.Mesh(rimG, metalSilverMat);
        rim.position.y = 0.78;
        group.add(ped, rim);

        // Glowing crimson/accent corner HUD brackets
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

        // Animated 3D Holographic Terrain Wireframe Shader
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

        // 5 Floating Tactical Diamond Waypoints hovering over terrain
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
        // Floating Multi-Pane Virtual OS Holographic HUD Projector + Containment Cubes
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
        // Monumental Architectural Beveled Holo-Archway
        const colG = new THREE.BoxGeometry(0.46, 3.3, 0.72);
        const footG = new THREE.BoxGeometry(0.68, 0.24, 0.92);
        const lintelG = new THREE.BoxGeometry(4.1, 0.42, 0.78);
        const stripG = new THREE.BoxGeometry(0.08, 3.0, 0.76);
        const crownStripG = new THREE.BoxGeometry(3.4, 0.08, 0.82);
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
        const pedG = new THREE.CylinderGeometry(0.45, 0.62, 0.45, 16);
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
        const legG = new THREE.BoxGeometry(1.4, 0.72, 0.7);
        const topG = new THREE.BoxGeometry(1.75, 0.08, 0.9);
        const frameG = new THREE.BoxGeometry(1.12, 0.62, 0.06);
        const monG = new THREE.PlaneGeometry(1.04, 0.54);
        worldObjDisposables.push(legG, topG, frameG, monG);
        const legs = new THREE.Mesh(legG, baseDarkMat);
        legs.position.y = 0.36;
        const top = new THREE.Mesh(topG, metalSilverMat);
        top.position.y = 0.76;
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
        group.add(legs, top, frame, mon);
        proxySize = [1.85, 1.65, 1.15];
      } else if (obj.kind === 'holo-kiosk') {
        const pedG = new THREE.CylinderGeometry(0.38, 0.5, 0.95, 16);
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
        const baseG = new THREE.CylinderGeometry(0.42, 0.56, 0.4, 12);
        const spireG = new THREE.CylinderGeometry(0.08, 0.16, 2.2, 12);
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
        // Composite stackable quantum storage / compute crate (0.96m cube pivoted at bottom-center)
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
        // lounge-pod
        const seatG = new THREE.CylinderGeometry(0.82, 0.72, 0.46, 16);
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

      // Click / Touch-Hold Raycast Proxy Bounding Box
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
  const particleCount = isSoftwareGl ? 220 : 480;
  const pPositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    pPositions[i * 3] = (Math.random() - 0.5) * 34;
    pPositions[i * 3 + 1] = Math.random() * 14;
    pPositions[i * 3 + 2] = (Math.random() - 0.5) * 34;
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
  const pBaseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.8 });
  const pBase = new THREE.Mesh(pBaseGeo, pBaseMat);
  pBase.position.y = 0.275;
  protoPedestal.add(pBase);

  const prototypeGroup = new THREE.Group();
  prototypeGroup.position.set(0, 1.35, 0);
  protoPedestal.add(prototypeGroup);
  root.add(protoPedestal);
  disposables.push(pBaseGeo, pBaseMat);

  let currentProtoDisposables: Array<{ dispose: () => void }> = [];

  function setPrototype(kind: PrototypeKind, primaryHex: string, metalness: number) {
    currentProtoDisposables.forEach((d) => d.dispose());
    currentProtoDisposables = [];
    while (prototypeGroup.children.length > 0) {
      prototypeGroup.remove(prototypeGroup.children[0]);
    }

    const bodyMat = new THREE.MeshStandardMaterial({
      color: primaryHex,
      roughness: 0.25,
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
      roughness: 0.65,
      metalness: 0.4,
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
      // kinetic-rover
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

      volumetricGroup.visible =
        theme === 'command-center' ||
        theme === 'neural-chamber' ||
        theme === 'cyber-metropolis' ||
        theme === 'bioluminescent-canyon';

      const normalizedHour = ((timeOfDayHours - 6) / 16) * Math.PI;
      const sunElevation = Math.max(-2, Math.min(10, Math.sin(normalizedHour) * 10 - 1));
      const phi = THREE.MathUtils.degToRad(90 - sunElevation);
      const theta = THREE.MathUtils.degToRad(210);
      sunVec.setFromSphericalCoords(1, phi, theta);
      skyUniforms['sunPosition'].value.copy(sunVec);

      const isRain = weather === 'rain' || theme === 'cyber-metropolis';
      floorMat.clearcoat = isRain ? 0.92 : theme === 'alpine-observatory' ? 0.55 : 0.16;
      floorMat.clearcoatRoughness = isRain ? 0.08 : 0.32;
      floorMat.roughness = isRain ? 0.24 : theme === 'tech-office' ? 0.45 : 0.56;

      if (theme === 'cyber-metropolis') {
        scene.background = new THREE.Color(0x050312);
        scene.fog = new THREE.FogExp2(0x130728, 0.017);
        hemiLight.color.setHex(0xe879f9);
        hemiLight.groundColor.setHex(0x090d1a);
        hemiLight.intensity = 1.0;
        keyLight.color.setHex(0x67e8f9);
        keyLight.intensity = 2.1;
        gridRingMat.color.setHex(0xf472b6);
        beamMat.color.setHex(0xf472b6);
        moteMat.color.setHex(0xf472b6);
        floorMat.color.setHex(0x475569);
      } else if (theme === 'orbital-station') {
        scene.background = new THREE.Color(0x02040a);
        scene.fog = new THREE.FogExp2(0x020612, 0.011);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.95;
        keyLight.color.setHex(0xfffbeb);
        keyLight.intensity = 2.55;
        gridRingMat.color.setHex(0x38bdf8);
        moteMat.color.setHex(0xe0f2fe);
        floorMat.color.setHex(0x94a3b8);
      } else if (theme === 'alpine-observatory') {
        scene.background = new THREE.Color(0x040b18);
        scene.fog = new THREE.FogExp2(0x0c2130, 0.014);
        hemiLight.color.setHex(0xa7f3d0);
        hemiLight.groundColor.setHex(0x1e293b);
        hemiLight.intensity = 1.05;
        keyLight.color.setHex(0xfde68a);
        keyLight.intensity = 2.15;
        gridRingMat.color.setHex(0x34d399);
        moteMat.color.setHex(0xa7f3d0);
        floorMat.color.setHex(0xcbd5e1);
      } else if (theme === 'bioluminescent-canyon') {
        scene.background = new THREE.Color(0x040714);
        scene.fog = new THREE.FogExp2(0x081b2d, 0.019);
        hemiLight.color.setHex(0x22d3ee);
        hemiLight.groundColor.setHex(0x1e1b4b);
        hemiLight.intensity = 0.95;
        keyLight.color.setHex(0xe879f9);
        keyLight.intensity = 1.95;
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
        keyLight.intensity = 2.25;
        gridRingMat.color.setHex(0x38bdf8);
        moteMat.color.setHex(0x67e8f9);
        floorMat.color.setHex(0x94a3b8);
      } else if (theme === 'outdoor-world') {
        const bg = timeOfDayHours >= 8 && timeOfDayHours <= 17 ? 0x132238 : 0x070d1a;
        scene.background = new THREE.Color(bg);
        scene.fog = new THREE.FogExp2(bg, 0.019);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.95;
        keyLight.color.setHex(0xfff1d6);
        keyLight.intensity = 2.0;
        moteMat.color.setHex(0xbae6fd);
        floorMat.color.setHex(0x64748b);
      } else if (theme === 'tech-office') {
        scene.background = new THREE.Color(0x0f172a);
        scene.fog = new THREE.FogExp2(0x0f172a, 0.019);
        hemiLight.color.setHex(0xe2e8f0);
        hemiLight.groundColor.setHex(0x1e293b);
        hemiLight.intensity = 1.1;
        keyLight.color.setHex(0xfff7ed);
        keyLight.intensity = 2.3;
        pylonLightMat.color.setHex(0x60a5fa);
        gridRingMat.color.setHex(0x60a5fa);
        moteMat.color.setHex(0x93c5fd);
        floorMat.color.setHex(0xcbd5e1);
      } else if (theme === 'neural-chamber') {
        scene.background = new THREE.Color(0x04060d);
        scene.fog = new THREE.FogExp2(0x04060d, 0.026);
        hemiLight.color.setHex(0x6366f1);
        hemiLight.groundColor.setHex(0x030712);
        hemiLight.intensity = 0.72;
        keyLight.color.setHex(0xe0e7ff);
        keyLight.intensity = 1.9;
        pylonLightMat.color.setHex(0x8b5cf6);
        gridRingMat.color.setHex(0x8b5cf6);
        beamMat.color.setHex(0x8b5cf6);
        moteMat.color.setHex(0xa78bfa);
        floorMat.color.setHex(0x64748b);
      } else if (theme === 'holo-ops') {
        scene.background = new THREE.Color(0x06101e);
        scene.fog = new THREE.FogExp2(0x06101e, 0.022);
        hemiLight.color.setHex(0x38bdf8);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.95;
        keyLight.color.setHex(0xecfdf5);
        keyLight.intensity = 2.05;
        pylonLightMat.color.setHex(0x10b981);
        gridRingMat.color.setHex(0x10b981);
        moteMat.color.setHex(0x34d399);
        floorMat.color.setHex(0x94a3b8);
      } else {
        scene.background = new THREE.Color(0x070b14);
        scene.fog = new THREE.FogExp2(0x070b14, 0.02);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.9;
        keyLight.color.setHex(0xfff1d6);
        keyLight.intensity = 2.25;
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

      // Update animated screen textures & fallback motion transforms
      const activeIds = new Set<string>();
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

        // Kinetic sculpture / beacon / waypoint / mainframe cooling sub-part animations
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

      // Gentle ambient drifting dust / spore motes
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
