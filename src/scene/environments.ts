import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { EnvironmentTheme, WeatherMode, WorldObject } from '../types/os';

export type PrototypeKind = 'drone-chassis' | 'server-rack' | 'orbital-relay' | 'kinetic-rover';

export interface EnvironmentController {
  root: THREE.Group;
  prototypeGroup: THREE.Group;
  applyTheme: (theme: EnvironmentTheme, weather: WeatherMode, timeOfDayHours: number) => void;
  setPrototype: (kind: PrototypeKind, primaryHex: string, metalness: number) => void;
  syncWorldObjects: (objects: WorldObject[]) => void;
  update: (elapsed: number, delta: number, weather: WeatherMode) => void;
  dispose: () => void;
}

export function createEnvironmentController(
  scene: THREE.Scene,
  floorAlbedo: THREE.Texture,
  floorBump: THREE.Texture,
  isSoftwareGl: boolean,
): EnvironmentController {
  const root = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  // Lighting Rig (Warm directional key + cool hemisphere fill + subtle rim)
  const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.75);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
  keyLight.position.set(12, 18, 10);
  if (!isSoftwareGl) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 48;
    const d = 16;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
  }
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.85);
  rimLight.position.set(-14, 9, -12);
  scene.add(rimLight);

  // Main Ground Floor (offset y=0)
  const floorGeo = new THREE.CircleGeometry(65, 48);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorAlbedo,
    bumpMap: floorBump,
    bumpScale: 0.03,
    roughness: 0.62,
    metalness: 0.45,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  root.add(floorMesh);
  disposables.push(floorGeo, floorMat);

  // Subtle Holographic Polar Floor Ring (polygonOffset prevents Z-fighting)
  const gridRingGeo = new THREE.RingGeometry(4.0, 4.12, 64);
  const gridRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.35,
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

  // Indoor Architectural Pylons (6 beveled curved columns around perimeter)
  const indoorGroup = new THREE.Group();
  const pylonShape = new THREE.Shape();
  pylonShape.moveTo(-0.35, 0);
  pylonShape.lineTo(0.35, 0);
  pylonShape.lineTo(0.22, 6.2);
  pylonShape.lineTo(-0.22, 6.2);
  pylonShape.closePath();

  const pylonGeo = new THREE.ExtrudeGeometry(pylonShape, {
    depth: 0.5,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x161f30,
    roughness: 0.5,
    metalness: 0.72,
  });
  const pylonLightGeo = new THREE.BoxGeometry(0.08, 4.8, 0.08);
  const pylonLightMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const pGroup = new THREE.Group();
    pGroup.position.set(Math.cos(angle) * 11.5, 0, Math.sin(angle) * 11.5);
    pGroup.lookAt(0, 0, 0);
    const mesh = new THREE.Mesh(pylonGeo, pylonMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const strip = new THREE.Mesh(pylonLightGeo, pylonLightMat);
    strip.position.set(0, 3.1, 0.56);
    pGroup.add(mesh, strip);
    indoorGroup.add(pGroup);
  }
  root.add(indoorGroup);
  disposables.push(pylonGeo, pylonMat, pylonLightGeo, pylonLightMat);

  // Outdoor Environment Elements (Sky + Natural Basalt Perimeter Rocks via InstancedMesh)
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
  const rockCount = 42;
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

  // Aether District Campus Skyline & Walkways (Instanced architectural towers + illuminated trim + walkways)
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

  // Persistent Placed World Objects Layer
  const worldObjectsGroup = new THREE.Group();
  root.add(worldObjectsGroup);
  let worldObjDisposables: Array<{ dispose: () => void }> = [];

  function syncWorldObjects(objects: WorldObject[]) {
    worldObjDisposables.forEach((d) => d.dispose());
    worldObjDisposables = [];
    while (worldObjectsGroup.children.length > 0) {
      worldObjectsGroup.remove(worldObjectsGroup.children[0]);
    }

    const baseDarkMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.45,
      metalness: 0.65,
    });
    worldObjDisposables.push(baseDarkMat);

    for (const obj of objects) {
      const group = new THREE.Group();
      group.position.set(obj.position[0], 0, obj.position[2]);
      group.rotation.y = obj.rotationY;

      const accentMat = new THREE.MeshStandardMaterial({
        color: obj.color,
        emissive: obj.color,
        emissiveIntensity: 0.85,
        roughness: 0.25,
        metalness: 0.45,
      });
      worldObjDisposables.push(accentMat);

      if (obj.kind === 'workstation-desk') {
        const legG = new THREE.BoxGeometry(1.4, 0.72, 0.7);
        const topG = new THREE.BoxGeometry(1.65, 0.08, 0.85);
        const monG = new THREE.BoxGeometry(0.95, 0.48, 0.05);
        worldObjDisposables.push(legG, topG, monG);
        const legs = new THREE.Mesh(legG, baseDarkMat);
        legs.position.y = 0.36;
        const top = new THREE.Mesh(topG, baseDarkMat);
        top.position.y = 0.76;
        const mon = new THREE.Mesh(monG, accentMat);
        mon.position.set(0, 1.12, -0.22);
        group.add(legs, top, mon);
      } else if (obj.kind === 'holo-kiosk') {
        const pedG = new THREE.CylinderGeometry(0.38, 0.48, 0.95, 16);
        const screenG = new THREE.BoxGeometry(0.85, 0.65, 0.06);
        worldObjDisposables.push(pedG, screenG);
        const ped = new THREE.Mesh(pedG, baseDarkMat);
        ped.position.y = 0.475;
        const screen = new THREE.Mesh(screenG, accentMat);
        screen.position.set(0, 1.35, 0);
        screen.rotation.x = -0.22;
        group.add(ped, screen);
      } else if (obj.kind === 'relay-beacon') {
        const baseG = new THREE.CylinderGeometry(0.42, 0.56, 0.4, 12);
        const spireG = new THREE.CylinderGeometry(0.08, 0.16, 2.2, 12);
        const ringG = new THREE.TorusGeometry(0.45, 0.04, 8, 24);
        worldObjDisposables.push(baseG, spireG, ringG);
        const b = new THREE.Mesh(baseG, baseDarkMat);
        b.position.y = 0.2;
        const s = new THREE.Mesh(spireG, baseDarkMat);
        s.position.y = 1.4;
        const r = new THREE.Mesh(ringG, accentMat);
        r.rotation.x = Math.PI / 2;
        r.position.y = 2.35;
        group.add(b, s, r);
      } else if (obj.kind === 'data-monolith') {
        const monoG = new THREE.BoxGeometry(0.75, 2.6, 0.32);
        const stripG = new THREE.BoxGeometry(0.14, 2.2, 0.36);
        worldObjDisposables.push(monoG, stripG);
        const m = new THREE.Mesh(monoG, baseDarkMat);
        m.position.y = 1.3;
        const st = new THREE.Mesh(stripG, accentMat);
        st.position.y = 1.3;
        group.add(m, st);
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
      }

      worldObjectsGroup.add(group);
    }
  }

  // Weather Particles (Rain / Ion Storm)
  const particleCount = 450;
  const pPositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    pPositions[i * 3] = (Math.random() - 0.5) * 32;
    pPositions[i * 3 + 1] = Math.random() * 14;
    pPositions[i * 3 + 2] = (Math.random() - 0.5) * 32;
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
    setPrototype,
    syncWorldObjects,
    applyTheme: (theme, weather, timeOfDayHours) => {
      indoorGroup.visible = theme !== 'outdoor-world' && theme !== 'aether-district';
      outdoorGroup.visible = theme === 'outdoor-world' || theme === 'aether-district';
      rockInstanced.visible = theme === 'outdoor-world';
      districtGroup.visible = theme === 'aether-district';

      // Keep sun low near dusk/dawn horizon so Sky renders rich deep twilight without white blowout
      const normalizedHour = ((timeOfDayHours - 6) / 16) * Math.PI;
      const sunElevation = Math.max(-2, Math.min(10, Math.sin(normalizedHour) * 10 - 1));
      const phi = THREE.MathUtils.degToRad(90 - sunElevation);
      const theta = THREE.MathUtils.degToRad(210);
      sunVec.setFromSphericalCoords(1, phi, theta);
      skyUniforms['sunPosition'].value.copy(sunVec);

      if (theme === 'aether-district') {
        const bg = timeOfDayHours >= 8 && timeOfDayHours <= 17 ? 0x0c1a2e : 0x050914;
        scene.background = new THREE.Color(bg);
        scene.fog = new THREE.FogExp2(bg, 0.016);
        hemiLight.color.setHex(0xbae6fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 1.05;
        keyLight.intensity = 2.25;
        gridRingMat.color.setHex(0x38bdf8);
        floorMat.color.setHex(0x94a3b8);
      } else if (theme === 'outdoor-world') {
        const bg = timeOfDayHours >= 8 && timeOfDayHours <= 17 ? 0x132238 : 0x070d1a;
        scene.background = new THREE.Color(bg);
        scene.fog = new THREE.FogExp2(bg, 0.022);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.95;
        keyLight.intensity = 2.0;
        floorMat.color.setHex(0x64748b);
      } else if (theme === 'tech-office') {
        scene.background = new THREE.Color(0x0f172a);
        scene.fog = new THREE.FogExp2(0x0f172a, 0.022);
        hemiLight.color.setHex(0xe2e8f0);
        hemiLight.groundColor.setHex(0x1e293b);
        hemiLight.intensity = 1.1;
        keyLight.intensity = 2.3;
        pylonLightMat.color.setHex(0x60a5fa);
        gridRingMat.color.setHex(0x60a5fa);
        floorMat.color.setHex(0xcbd5e1);
      } else if (theme === 'neural-chamber') {
        scene.background = new THREE.Color(0x04060d);
        scene.fog = new THREE.FogExp2(0x04060d, 0.032);
        hemiLight.color.setHex(0x6366f1);
        hemiLight.groundColor.setHex(0x030712);
        hemiLight.intensity = 0.65;
        keyLight.intensity = 1.85;
        pylonLightMat.color.setHex(0x8b5cf6);
        gridRingMat.color.setHex(0x8b5cf6);
        floorMat.color.setHex(0x64748b);
      } else if (theme === 'holo-ops') {
        scene.background = new THREE.Color(0x06101e);
        scene.fog = new THREE.FogExp2(0x06101e, 0.026);
        hemiLight.color.setHex(0x38bdf8);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.9;
        keyLight.intensity = 2.0;
        pylonLightMat.color.setHex(0x10b981);
        gridRingMat.color.setHex(0x10b981);
        floorMat.color.setHex(0x94a3b8);
      } else {
        // command-center default
        scene.background = new THREE.Color(0x070b14);
        scene.fog = new THREE.FogExp2(0x070b14, 0.024);
        hemiLight.color.setHex(0x93c5fd);
        hemiLight.groundColor.setHex(0x0f172a);
        hemiLight.intensity = 0.85;
        keyLight.intensity = 2.2;
        pylonLightMat.color.setHex(0x22d3ee);
        gridRingMat.color.setHex(0x22d3ee);
        floorMat.color.setHex(0xffffff);
      }

      weatherPoints.visible = weather !== 'clear';
      weatherMat.color.setHex(weather === 'ion-storm' ? 0xa78bfa : 0x7dd3fc);
    },
    update: (_elapsed, delta, weather) => {
      prototypeGroup.rotation.y += delta * 0.45;
      if (weather !== 'clear' && weatherPoints.visible) {
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
      worldObjDisposables.forEach((d) => d.dispose());
      currentProtoDisposables.forEach((d) => d.dispose());
      disposables.forEach((d) => d.dispose());
    },
  };
}
