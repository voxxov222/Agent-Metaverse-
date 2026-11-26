import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type {
  AgentProfile,
  CameraMode,
  EnvironmentTheme,
  JarvisHologramConfig,
  NeuralRegion,
  NeuralRegionId,
  PhysicsGravityPreset,
  SkyboxConfig,
  WeatherMode,
  WorldObject,
  WorldPlayer,
} from '../types/os';
import { createProceduralTextures } from '../scene/textures';
import { buildNeuralCore } from '../scene/neuralCore';
import { createAgentVisualRig, type AgentVisualRig } from '../scene/agentBuilder';
import { createMultiplayerAvatarRig, type MultiplayerAvatarRig } from '../scene/multiplayerAvatars';
import { createEnvironmentController, type PrototypeKind } from '../scene/environments';
import { createSkyboxController } from '../scene/skyboxCreator';
import { WorldPhysicsEngine } from '../scene/worldPhysics';
import { getDefaultSkyboxForTheme } from '../utils/worldEnhancements';
import type { ZimTrackingFrame } from '../utils/zimHandTracker';
import { SpatialAudioEngine } from '../utils/spatialAudioEngine';
import { createHalo3DController } from '../../packages/halo/halo3d';
import type {
  HaloFormFactor,
  HaloModuleId,
  HaloPanelState3D,
  HaloThemePalette,
  WorldZone,
} from '../../packages/halo/types';

export interface PulseSignal {
  id: number;
  regionId: NeuralRegionId;
  fromAgentId?: string;
}

interface CommandViewport3DProps {
  agents: AgentProfile[];
  regions: NeuralRegion[];
  worldPlayers: WorldPlayer[];
  selfPlayerId: string | null;
  worldObjects: WorldObject[];
  theme: EnvironmentTheme;
  weather: WeatherMode;
  timeOfDayHours: number;
  skybox: SkyboxConfig;
  cameraMode: CameraMode;
  selectedAgentId: string | null;
  selectedWorldObjectId: string | null;
  objectDragMode?: boolean;
  tapPlaceActive?: boolean;
  gridSnap?: boolean;
  gravityPreset?: PhysicsGravityPreset;
  physicsCommand?: { kind: 'drop' | 'nudge' | 'wake'; objectId?: string; nonce: number } | null;
  prototypeKind: PrototypeKind;
  prototypeColor: string;
  prototypeMetalness: number;
  reducedMotion: boolean;
  latestPulse: PulseSignal | null;
  touchMoveVector?: { x: number; z: number };
  onSelectAgent: (agentId: string) => void;
  onSelectRegion: (regionId: NeuralRegionId) => void;
  onSelectWorldObject?: (objectId: string | null) => void;
  onMoveWorldObject?: (objectId: string, position: [number, number, number], rotationY?: number) => void;
  onTapPlaceGround?: (position: [number, number, number]) => void;
  onHoldStateChange?: (holdingObjectId: string | null) => void;
  onUserCameraOverride: () => void;
  onLocalMove?: (position: [number, number, number], yaw: number) => void;
  haloFormFactor: HaloFormFactor;
  haloPalette: HaloThemePalette;
  haloPanels3D: HaloPanelState3D[];
  haloZones: WorldZone[];
  haloActiveModule: HaloModuleId;
  haloKillSwitch: boolean;
  haloGlitchPulseAt: number;
  pendingApprovalsCount: number;
  runningTasksCount: number;
  jarvisHologram?: JarvisHologramConfig;
  spatialAudioEnabled?: boolean;
  spatialAudioVolume?: number;
  onClickHaloPanel?: (moduleId: HaloModuleId, panelId: string) => void;
  onRegisterHandDriver?: (driver: ((frame: ZimTrackingFrame) => void) | null) => void;
}

const _desiredCamPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _listenerForward = new THREE.Vector3();
const _listenerUp = new THREE.Vector3(0, 1, 0);
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _planeHit = new THREE.Vector3();
const _camOffset = new THREE.Vector3();

export function CommandViewport3D(props: CommandViewport3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const sceneApiRef = useRef<{
    syncAgents: (agents: AgentProfile[]) => void;
    syncPlayers: (players: WorldPlayer[], selfId: string | null) => void;
    syncWorldObjects: (objects: WorldObject[]) => void;
    setSelectedWorldObject: (id: string | null) => void;
    setGravityPreset: (preset: PhysicsGravityPreset) => void;
    runPhysicsCommand: (cmd: { kind: 'drop' | 'nudge' | 'wake'; objectId?: string }) => void;
    applyThemeAndSkybox: (
      theme: EnvironmentTheme,
      weather: WeatherMode,
      tod: number,
      skybox: SkyboxConfig,
    ) => void;
    setPrototype: (kind: PrototypeKind, color: string, metalness: number) => void;
    triggerPulse: (sig: PulseSignal) => void;
    setJarvisHologram: (cfg: JarvisHologramConfig) => void;
    setSpatialAudio: (enabled: boolean, volume?: number) => void;
    setCameraGoal: (mode: CameraMode, agentId: string | null) => void;
    syncHalo: () => void;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: isSoftwareGl,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.dataset.testid = 'command-viewport-canvas';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';

    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(54, width / height, 0.1, 320);
    camera.position.set(0, 6.4, 14.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 2.6;
    controls.maxDistance = 36;
    controls.target.set(0, 2.35, 0);
    controls.update();

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const textures = createProceduralTextures(maxAniso);

    // Studio RoomEnvironment IBL reflections (vital for brushed metals, clearcoat, glass across GPU & SwiftShader)
    const studioPmrem = new THREE.PMREMGenerator(renderer);
    const roomEnvScene = new RoomEnvironment();
    const studioEnvTex = studioPmrem.fromScene(roomEnvScene, 0.04).texture;
    roomEnvScene.dispose();
    scene.environment = studioEnvTex;
    scene.environmentIntensity = 0.85;

    // Studio Softbox Area Lights (GPU only)
    const rectLights: THREE.RectAreaLight[] = [];
    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const overheadSoftbox = new THREE.RectAreaLight(0xbae6fd, 3.2, 8.5, 4.5);
      overheadSoftbox.position.set(0, 8.2, 1.5);
      overheadSoftbox.lookAt(0, 0, 0);
      const sideSoftbox = new THREE.RectAreaLight(0xfff1d6, 2.1, 6, 3.5);
      sideSoftbox.position.set(-8, 5.2, -2);
      sideSoftbox.lookAt(0, 1.4, -2);
      scene.add(overheadSoftbox, sideSoftbox);
      rectLights.push(overheadSoftbox, sideSoftbox);
    }

    const skyboxCtrl = createSkyboxController();
    scene.add(skyboxCtrl.mesh);

    const envCtrl = createEnvironmentController(
      scene,
      textures,
      maxAniso,
      isSoftwareGl,
    );
    scene.add(envCtrl.root);

    const neuralCore = buildNeuralCore(isSoftwareGl, maxAniso);
    scene.add(neuralCore.group);

    const worldPhysics = new WorldPhysicsEngine(propsRef.current.gravityPreset ?? 'earth');

    const halo3d = createHalo3DController();
    scene.add(halo3d.root);

    const spatialAudio = new SpatialAudioEngine(
      propsRef.current.spatialAudioEnabled ?? true,
      propsRef.current.spatialAudioVolume ?? 0.45,
    );
    const agentLastState = new Map<string, string>();
    let initialAgentsSynced = false;

    const agentRigs = new Map<string, AgentVisualRig>();
    const agentGroupRoot = new THREE.Group();
    scene.add(agentGroupRoot);

    function syncAgents(agentList: AgentProfile[]) {
      const seen = new Set<string>();
      for (let i = 0; i < agentList.length; i++) {
        const agent = agentList[i];
        seen.add(agent.id);
        const existing = agentRigs.get(agent.id);
        const stateSig = `${agent.status}|${agent.currentStage}`;
        const prevSig = agentLastState.get(agent.id);
        if (initialAgentsSynced && prevSig !== undefined && prevSig !== stateSig) {
          spatialAudio.playAgentUpdate(agent.id, agent.status, agent.position, i);
        }
        agentLastState.set(agent.id, stateSig);

        if (existing) {
          existing.root.position.set(agent.position[0], 0, agent.position[2]);
          existing.root.lookAt(0, 0, 0);
          existing.updateAppearance(agent);
        } else {
          const rig = createAgentVisualRig(agent, textures.contactShadow, textures.holoGrid);
          agentRigs.set(agent.id, rig);
          agentGroupRoot.add(rig.root);
        }
      }
      initialAgentsSynced = true;
      for (const [id, rig] of agentRigs.entries()) {
        if (!seen.has(id)) {
          agentGroupRoot.remove(rig.root);
          rig.dispose();
          agentRigs.delete(id);
          agentLastState.delete(id);
        }
      }
    }

    const playerRigs = new Map<string, MultiplayerAvatarRig>();
    const playerGroupRoot = new THREE.Group();
    scene.add(playerGroupRoot);

    function syncPlayers(players: WorldPlayer[], selfId: string | null) {
      const seen = new Set<string>();
      for (const p of players) {
        if (selfId && p.id === selfId) continue;
        seen.add(p.id);
        const existing = playerRigs.get(p.id);
        if (existing) {
          existing.updateFromPlayer(p);
        } else {
          const rig = createMultiplayerAvatarRig(p, textures.contactShadow);
          playerRigs.set(p.id, rig);
          playerGroupRoot.add(rig.root);
        }
      }
      for (const [id, rig] of playerRigs.entries()) {
        if (!seen.has(id)) {
          playerGroupRoot.remove(rig.root);
          rig.dispose();
          playerRigs.delete(id);
        }
      }
    }

    function applyThemeAndSkybox(
      theme: EnvironmentTheme,
      weather: WeatherMode,
      tod: number,
      skybox: SkyboxConfig,
    ) {
      const effectiveSky = skybox.enabled ? skybox : getDefaultSkyboxForTheme(theme, tod);
      skyboxCtrl.mesh.visible = true;
      skyboxCtrl.applyConfig(effectiveSky, renderer, scene, isSoftwareGl);
      const isIndoor =
        theme === 'command-center' ||
        theme === 'tech-office' ||
        theme === 'neural-chamber' ||
        theme === 'holo-ops';
      if (isIndoor && (!skybox.enabled || skybox.preset === 'theme-auto')) {
        scene.environment = studioEnvTex;
        scene.environmentIntensity = Math.max(0.72, effectiveSky.envIntensity);
      }
      envCtrl.applyTheme(theme, weather, tod, true);
    }

    syncAgents(propsRef.current.agents);
    syncPlayers(propsRef.current.worldPlayers, propsRef.current.selfPlayerId);
    envCtrl.syncWorldObjects(propsRef.current.worldObjects);
    worldPhysics.syncObjects(propsRef.current.worldObjects);
    envCtrl.setSelectedObjectId(propsRef.current.selectedWorldObjectId);
    applyThemeAndSkybox(
      propsRef.current.theme,
      propsRef.current.weather,
      propsRef.current.timeOfDayHours,
      propsRef.current.skybox,
    );
    envCtrl.setPrototype(propsRef.current.prototypeKind, propsRef.current.prototypeColor, propsRef.current.prototypeMetalness);

    const syncHaloState = () => {
      const cur = propsRef.current;
      halo3d.syncState({
        formFactor: cur.haloFormFactor,
        palette: cur.haloPalette,
        panels: cur.haloPanels3D,
        agents: cur.agents,
        zones: cur.haloZones,
        activeModule: cur.haloActiveModule,
        killSwitchActive: cur.haloKillSwitch,
        glitchPulseAt: cur.haloGlitchPulseAt,
        pendingApprovals: cur.pendingApprovalsCount,
        tasksRunning: cur.runningTasksCount,
      });
    };
    syncHaloState();
    if (propsRef.current.jarvisHologram) {
      neuralCore.setHologramState(propsRef.current.jarvisHologram);
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Smooth camera preset tracking (cancelled immediately when user grabs OrbitControls)
    let transitionActive = false;

    function setCameraGoal(mode: CameraMode, agentId: string | null) {
      if (mode === 'core-focus') {
        _desiredCamPos.set(0, 3.8, 6.2);
        _desiredTarget.set(0, 3.2, 0);
        transitionActive = true;
      } else if (mode === 'agent-focus' && agentId) {
        const agent = propsRef.current.agents.find((a) => a.id === agentId);
        if (agent) {
          const pos = new THREE.Vector3(agent.position[0], 0, agent.position[2]);
          const dirToCore = pos.clone().multiplyScalar(-1).normalize();
          _desiredCamPos.copy(pos).addScaledVector(dirToCore, 3.1);
          _desiredCamPos.y = 2.05;
          _desiredTarget.set(pos.x, 1.35, pos.z);
          transitionActive = true;
        }
      } else if (mode === 'rig-focus') {
        const rig =
          propsRef.current.worldObjects.find((o) => o.id === 'prop-rig-west') ??
          propsRef.current.worldObjects.find((o) => o.kind === 'quantum-workstation');
        if (rig) {
          const rx = rig.position[0];
          const ry = rig.position[1] ?? 0;
          const rz = rig.position[2];
          const rot = rig.rotationY ?? 0;
          const dist = 3.1;
          _desiredCamPos.set(rx + Math.sin(rot) * dist, ry + 2.1, rz + Math.cos(rot) * dist);
          _desiredTarget.set(rx, ry + 1.28, rz);
          transitionActive = true;
        }
      } else if (mode === 'walk') {
        _desiredCamPos.set(0, 1.75, 11.2);
        _desiredTarget.set(0, 1.75, 0);
        transitionActive = true;
      } else {
        _desiredCamPos.set(0, 6.4, 14.5);
        _desiredTarget.set(0, 2.35, 0);
        transitionActive = true;
      }
    }

    const onControlStart = () => {
      transitionActive = false;
      propsRef.current.onUserCameraOverride();
    };
    controls.addEventListener('start', onControlStart);

    // Keyboard WASD / Arrow navigation + Q/E rotate held object
    const keys: Record<string, boolean> = {};
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      keys[e.code] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys[e.code] = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Unified Pointer + Touch-Hold Object Dragging & Raycast Selection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };
    let holdTimer = 0;
    let activeDragId: string | null = null;
    let activeDragPos: [number, number, number] = [0, 0, 0];
    let activeDragRotY = 0;
    let dragOffset = new THREE.Vector3();

    function updatePointerNdc(clientX: number, clientY: number) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }

    function beginDragObject(objId: string, hitPoint?: THREE.Vector3) {
      const obj = propsRef.current.worldObjects.find((o) => o.id === objId);
      if (!obj) return;
      activeDragId = objId;
      const supportY = worldPhysics.getBodyTopY(obj.position[0], obj.position[2], objId);
      const liftY = Math.max(supportY + 0.4, (obj.position[1] ?? 0) + 0.35);
      activeDragPos = [obj.position[0], liftY, obj.position[2]];
      activeDragRotY = obj.rotationY;
      if (hitPoint) {
        dragOffset.set(obj.position[0] - hitPoint.x, 0, obj.position[2] - hitPoint.z);
      } else {
        dragOffset.set(0, 0, 0);
      }
      controls.enabled = false;
      renderer.domElement.style.cursor = 'grabbing';
      worldPhysics.beginDrag(objId);
      worldPhysics.setDragTarget(objId, activeDragPos[0], activeDragPos[1], activeDragPos[2], activeDragRotY);
      envCtrl.setDraggingObject(objId, activeDragPos, activeDragRotY);
      propsRef.current.onSelectWorldObject?.(objId);
      propsRef.current.onHoldStateChange?.(objId);
      try {
        navigator.vibrate?.(18);
      } catch {
        // Ignore on unsupported browsers
      }
    }

    const unlockSpatialAudio = () => {
      if (propsRef.current.spatialAudioEnabled !== false) {
        void spatialAudio.unlock();
      }
    };
    window.addEventListener('pointerdown', unlockSpatialAudio, { passive: true });
    window.addEventListener('keydown', unlockSpatialAudio, { passive: true });

    const onPointerDown = (ev: PointerEvent) => {
      unlockSpatialAudio();
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
      clearTimeout(holdTimer);

      updatePointerNdc(ev.clientX, ev.clientY);
      raycaster.setFromCamera(pointer, camera);
      const objHits = raycaster.intersectObjects(envCtrl.worldObjectInteractables, false);
      if (objHits.length > 0) {
        const objId = objHits[0].object.userData.objectId as string | undefined;
        if (objId) {
          const planeOk = raycaster.ray.intersectPlane(_groundPlane, _planeHit);
          const hitPt = planeOk ? _planeHit.clone() : undefined;

          if (propsRef.current.objectDragMode || ev.shiftKey) {
            beginDragObject(objId, hitPt);
          } else {
            // Touch-Hold / Long-Press (220ms) grabs any 3D object directly
            holdTimer = window.setTimeout(() => {
              beginDragObject(objId, hitPt);
            }, 220);
          }
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - pointerDownPos.x, ev.clientY - pointerDownPos.y);
      if (!activeDragId && moved > 8) {
        clearTimeout(holdTimer);
      }

      if (activeDragId) {
        updatePointerNdc(ev.clientX, ev.clientY);
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(_groundPlane, _planeHit)) {
          let nx = _planeHit.x + dragOffset.x;
          let nz = _planeHit.z + dragOffset.z;
          if (propsRef.current.gridSnap) {
            nx = Math.round(nx * 2) / 2;
            nz = Math.round(nz * 2) / 2;
          }
          nx = Math.max(-36, Math.min(36, Number(nx.toFixed(2))));
          nz = Math.max(-36, Math.min(36, Number(nz.toFixed(2))));
          const supportY = worldPhysics.getBodyTopY(nx, nz, activeDragId);
          const ny = Number((supportY + 0.42).toFixed(2));
          activeDragPos = [nx, ny, nz];
          worldPhysics.setDragTarget(activeDragId, nx, ny, nz, activeDragRotY);
          envCtrl.setDraggingObject(activeDragId, activeDragPos, activeDragRotY);
        }
      }
    };

    const finishDragOrClick = (ev: PointerEvent) => {
      clearTimeout(holdTimer);

      if (activeDragId) {
        const finishedId = activeDragId;
        const finalPos = activeDragPos;
        const finalRot = activeDragRotY;
        activeDragId = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = 'default';
        worldPhysics.endDrag(finishedId);
        envCtrl.setDraggingObject(null);
        propsRef.current.onHoldStateChange?.(null);
        propsRef.current.onMoveWorldObject?.(finishedId, finalPos, finalRot);
        return;
      }

      const moved = Math.hypot(ev.clientX - pointerDownPos.x, ev.clientY - pointerDownPos.y);
      if (moved > 6) return;

      updatePointerNdc(ev.clientX, ev.clientY);
      raycaster.setFromCamera(pointer, camera);

      // Tap-to-Place mode drops a new prop with gravity (stacks onto existing props if tapped above them!)
      if (propsRef.current.tapPlaceActive) {
        const objHits = raycaster.intersectObjects(envCtrl.worldObjectInteractables, false);
        if (objHits.length > 0) {
          const pt = objHits[0].point;
          const snap = propsRef.current.gridSnap;
          const px = snap ? Math.round(pt.x * 2) / 2 : Number(pt.x.toFixed(2));
          const pz = snap ? Math.round(pt.z * 2) / 2 : Number(pt.z.toFixed(2));
          const supportY = worldPhysics.getBodyTopY(px, pz, null);
          propsRef.current.onTapPlaceGround?.([px, Number((supportY + 0.85).toFixed(2)), pz]);
          return;
        }
        if (raycaster.ray.intersectPlane(_groundPlane, _planeHit)) {
          const snap = propsRef.current.gridSnap;
          const px = snap ? Math.round(_planeHit.x * 2) / 2 : Number(_planeHit.x.toFixed(2));
          const pz = snap ? Math.round(_planeHit.z * 2) / 2 : Number(_planeHit.z.toFixed(2));
          if (Math.abs(px) <= 36 && Math.abs(pz) <= 36) {
            const supportY = worldPhysics.getBodyTopY(px, pz, null);
            propsRef.current.onTapPlaceGround?.([px, Number((supportY + 0.85).toFixed(2)), pz]);
            return;
          }
        }
      }

      const targets: THREE.Object3D[] = [
        ...envCtrl.worldObjectInteractables,
        ...neuralCore.interactables,
        ...halo3d.interactables,
      ];
      agentRigs.forEach((rig) => targets.push(rig.clickProxy));
      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        const data = hits[0].object.userData;
        if (data.kind === 'world-object' && data.objectId) {
          propsRef.current.onSelectWorldObject?.(data.objectId);
        } else if (data.kind === 'agent' && data.agentId) {
          propsRef.current.onSelectAgent(data.agentId);
        } else if (data.kind === 'neural-region' && data.regionId) {
          propsRef.current.onSelectRegion(data.regionId);
        } else if (data.kind === 'halo-panel' && data.moduleId) {
          propsRef.current.onClickHaloPanel?.(data.moduleId, data.panelId);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finishDragOrClick);
    window.addEventListener('pointercancel', finishDragOrClick);

    // ZIM-Cam Spatial Hand Gesture Driver (pinch-to-grab, move, drop, click, two-hand zoom/rotate)
    let handGrabActive = false;
    const applyHandGesture = (frame: ZimTrackingFrame) => {
      if (!frame.cursor.visible && !handGrabActive) return;

      const rect = renderer.domElement.getBoundingClientRect();
      const clientX = frame.cursor.x * window.innerWidth;
      const clientY = frame.cursor.y * window.innerHeight;
      pointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;

      // Two-hand pinch -> camera dolly zoom + held-object rotation or camera azimuth
      if (frame.bothPinching) {
        if (Math.abs(frame.twoHandZoomDelta) > 0.001) {
          transitionActive = false;
          _camOffset.copy(camera.position).sub(controls.target);
          const curDist = _camOffset.length();
          const nextDist = Math.max(
            controls.minDistance,
            Math.min(controls.maxDistance, curDist * (1 - frame.twoHandZoomDelta * 1.9)),
          );
          _camOffset.setLength(nextDist);
          camera.position.copy(controls.target).add(_camOffset);
        }
        if (Math.abs(frame.twoHandAngleDeltaDeg) > 0.05) {
          if (activeDragId && handGrabActive) {
            activeDragRotY += THREE.MathUtils.degToRad(frame.twoHandAngleDeltaDeg * 1.6);
            worldPhysics.setDragTarget(
              activeDragId,
              activeDragPos[0],
              activeDragPos[1],
              activeDragPos[2],
              activeDragRotY,
            );
            envCtrl.setDraggingObject(activeDragId, activeDragPos, activeDragRotY);
          } else {
            transitionActive = false;
            _camOffset.copy(camera.position).sub(controls.target);
            const rotRad = THREE.MathUtils.degToRad(frame.twoHandAngleDeltaDeg * 0.75);
            _camOffset.applyAxisAngle(_up, rotRad);
            camera.position.copy(controls.target).add(_camOffset);
          }
        }
        return;
      }

      if (frame.cursor.phase === 'down') {
        raycaster.setFromCamera(pointer, camera);
        const objHits = raycaster.intersectObjects(envCtrl.worldObjectInteractables, false);
        if (objHits.length > 0) {
          const objId = objHits[0].object.userData.objectId as string | undefined;
          if (objId) {
            const planeOk = raycaster.ray.intersectPlane(_groundPlane, _planeHit);
            handGrabActive = true;
            beginDragObject(objId, planeOk ? _planeHit.clone() : undefined);
          }
        }
      } else if (frame.cursor.pinching && handGrabActive && activeDragId) {
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(_groundPlane, _planeHit)) {
          let nx = _planeHit.x + dragOffset.x;
          let nz = _planeHit.z + dragOffset.z;
          if (propsRef.current.gridSnap) {
            nx = Math.round(nx * 2) / 2;
            nz = Math.round(nz * 2) / 2;
          }
          nx = Math.max(-36, Math.min(36, Number(nx.toFixed(2))));
          nz = Math.max(-36, Math.min(36, Number(nz.toFixed(2))));
          const supportY = worldPhysics.getBodyTopY(nx, nz, activeDragId);
          const ny = Number((supportY + 0.42).toFixed(2));
          activeDragPos = [nx, ny, nz];
          worldPhysics.setDragTarget(activeDragId, nx, ny, nz, activeDragRotY);
          envCtrl.setDraggingObject(activeDragId, activeDragPos, activeDragRotY);
        }
      } else if (frame.cursor.phase === 'up' || frame.cursor.phase === 'tap') {
        if (handGrabActive && activeDragId) {
          const finishedId = activeDragId;
          const finalPos = activeDragPos;
          const finalRot = activeDragRotY;
          activeDragId = null;
          handGrabActive = false;
          controls.enabled = true;
          renderer.domElement.style.cursor = 'default';
          worldPhysics.endDrag(finishedId);
          envCtrl.setDraggingObject(null);
          propsRef.current.onHoldStateChange?.(null);
          propsRef.current.onMoveWorldObject?.(finishedId, finalPos, finalRot);
        } else if (frame.cursor.phase === 'tap') {
          // Dispatch tap onto UI element above WebGL if targeted, otherwise raycast 3D entities
          const domHit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
          if (domHit && domHit !== renderer.domElement && frame.replaceCursor) {
            const btn = domHit.closest('button, a, select, input') as HTMLElement | null;
            if (btn) {
              btn.click();
              return;
            }
          }
          raycaster.setFromCamera(pointer, camera);
          const targets: THREE.Object3D[] = [
            ...envCtrl.worldObjectInteractables,
            ...neuralCore.interactables,
            ...halo3d.interactables,
          ];
          agentRigs.forEach((rig) => targets.push(rig.clickProxy));
          const hits = raycaster.intersectObjects(targets, false);
          if (hits.length > 0) {
            const data = hits[0].object.userData;
            if (data.kind === 'world-object' && data.objectId) {
              propsRef.current.onSelectWorldObject?.(data.objectId);
            } else if (data.kind === 'agent' && data.agentId) {
              propsRef.current.onSelectAgent(data.agentId);
            } else if (data.kind === 'neural-region' && data.regionId) {
              propsRef.current.onSelectRegion(data.regionId);
            } else if (data.kind === 'halo-panel' && data.moduleId) {
              propsRef.current.onClickHaloPanel?.(data.moduleId, data.panelId);
            }
          }
        }
      }
    };
    propsRef.current.onRegisterHandDriver?.(applyHandGesture);

    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
    };
    window.addEventListener('resize', onResize);

    sceneApiRef.current = {
      syncAgents,
      syncPlayers,
      syncWorldObjects: (objects) => {
        envCtrl.syncWorldObjects(objects);
        worldPhysics.syncObjects(objects);
      },
      setSelectedWorldObject: (id) => envCtrl.setSelectedObjectId(id),
      setGravityPreset: (preset) => worldPhysics.setGravityPreset(preset),
      runPhysicsCommand: (cmd) => {
        if (cmd.kind === 'drop' && cmd.objectId) {
          worldPhysics.dropFromHeight(cmd.objectId, 3.0);
        } else if (cmd.kind === 'nudge' && cmd.objectId) {
          const angle = Math.random() * Math.PI * 2;
          worldPhysics.applyImpulse(
            cmd.objectId,
            Math.cos(angle) * 3.4,
            3.6,
            Math.sin(angle) * 3.4,
          );
        } else {
          worldPhysics.wakeAll();
        }
      },
      applyThemeAndSkybox,
      setPrototype: (kind, color, metalness) => envCtrl.setPrototype(kind, color, metalness),
      triggerPulse: (sig) => {
        const rig = sig.fromAgentId ? agentRigs.get(sig.fromAgentId) : undefined;
        neuralCore.triggerPulse(sig.regionId, rig?.root.position);
        spatialAudio.playPulse(
          sig.regionId,
          rig ? [rig.root.position.x, 1.4, rig.root.position.z] : undefined,
        );
      },
      setJarvisHologram: (cfg) => {
        neuralCore.setHologramState(cfg);
      },
      setSpatialAudio: (enabled, volume) => {
        spatialAudio.setEnabled(enabled);
        if (typeof volume === 'number') spatialAudio.setVolume(volume);
      },
      setCameraGoal,
      syncHalo: syncHaloState,
    };

    document.body.dataset.sceneReady = 'true';

    // Animation loop with software-WebGL afterDraw pacing
    const startMs = performance.now();
    let lastMs = startMs;
    let lastMoveBroadcastMs = 0;
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext | null;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;
      const nowMs = performance.now();
      const rawDelta = Math.min((nowMs - lastMs) / 1000, 0.1);
      lastMs = nowMs;
      const motionScale = propsRef.current.reducedMotion ? 0.15 : 1;
      const delta = rawDelta * motionScale;
      const elapsed = ((nowMs - startMs) / 1000) * motionScale;

      if (activeDragId) {
        if (keys['KeyQ']) activeDragRotY += rawDelta * 1.8;
        if (keys['KeyE']) activeDragRotY -= rawDelta * 1.8;
        worldPhysics.setDragTarget(activeDragId, activeDragPos[0], activeDragPos[1], activeDragPos[2], activeDragRotY);
        envCtrl.setDraggingObject(activeDragId, activeDragPos, activeDragRotY);
      }

      // WASD / Arrow + Mobile Touch D-Pad movement
      const touch = propsRef.current.touchMoveVector;
      const moveSpeed = 6.5 * rawDelta;
      const moveZ =
        (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) -
        (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0) +
        (touch?.z ?? 0);
      const moveX =
        (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) -
        (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) +
        (touch?.x ?? 0);
      if (moveZ !== 0 || moveX !== 0) {
        transitionActive = false;
        camera.getWorldDirection(_forward);
        _forward.y = 0;
        _forward.normalize();
        _right.crossVectors(_forward, _up).normalize();
        camera.position.addScaledVector(_forward, moveZ * moveSpeed);
        camera.position.addScaledVector(_right, moveX * moveSpeed);
        controls.target.addScaledVector(_forward, moveZ * moveSpeed);
        controls.target.addScaledVector(_right, moveX * moveSpeed);

        if (nowMs - (lastMoveBroadcastMs || 0) > 120) {
          lastMoveBroadcastMs = nowMs;
          const yaw = Math.atan2(_forward.x, _forward.z);
          propsRef.current.onLocalMove?.(
            [Number(camera.position.x.toFixed(2)), 0, Number(camera.position.z.toFixed(2))],
            Number(yaw.toFixed(2)),
          );
        }
      }

      if (transitionActive) {
        const dampAlpha = 1 - Math.exp(-5.5 * rawDelta);
        camera.position.lerp(_desiredCamPos, dampAlpha);
        controls.target.lerp(_desiredTarget, dampAlpha);
        if (camera.position.distanceTo(_desiredCamPos) < 0.04) {
          transitionActive = false;
        }
      }

      controls.update();

      // Step Cannon.js rigid-body physics (gravity, collisions, stacking)
      const physStep = worldPhysics.step(rawDelta);
      envCtrl.applyPhysicsPoses(physStep.poses);
      if (physStep.newlySettled.length > 0) {
        for (const settled of physStep.newlySettled) {
          propsRef.current.onMoveWorldObject?.(settled.id, settled.position, settled.rotationY);
        }
      }

      skyboxCtrl.update(elapsed);
      neuralCore.update(elapsed, delta, propsRef.current.regions);
      envCtrl.update(elapsed, delta, propsRef.current.weather);
      halo3d.update(elapsed, camera.position);

      for (const agent of propsRef.current.agents) {
        const rig = agentRigs.get(agent.id);
        if (rig) {
          rig.updateAnimation(elapsed, agent.status);
        }
      }

      for (const p of propsRef.current.worldPlayers) {
        const pRig = playerRigs.get(p.id);
        if (pRig) {
          pRig.updateAnimation(elapsed, p.emote);
        }
      }

      // Sync Web Audio 3D listener to camera position & orientation with zero per-frame allocations
      if (propsRef.current.spatialAudioEnabled !== false) {
        camera.getWorldDirection(_listenerForward);
        _listenerUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
        spatialAudio.updateListener(
          camera.position.x,
          camera.position.y,
          camera.position.z,
          _listenerForward.x,
          _listenerForward.y,
          _listenerForward.z,
          _listenerUp.x,
          _listenerUp.y,
          _listenerUp.z,
          nowMs,
        );
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      clearTimeout(holdTimer);
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.removeEventListener('start', onControlStart);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerdown', unlockSpatialAudio);
      window.removeEventListener('keydown', unlockSpatialAudio);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finishDragOrClick);
      window.removeEventListener('pointercancel', finishDragOrClick);

      propsRef.current.onRegisterHandDriver?.(null);
      spatialAudio.dispose();
      controls.dispose();
      neuralCore.dispose();
      halo3d.dispose();
      skyboxCtrl.dispose();
      envCtrl.dispose();
      textures.dispose();
      studioEnvTex.dispose();
      studioPmrem.dispose();
      rectLights.forEach((l) => l.dispose());
      agentRigs.forEach((rig) => rig.dispose());
      playerRigs.forEach((rig) => rig.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    sceneApiRef.current?.syncAgents(props.agents);
  }, [props.agents]);

  useEffect(() => {
    sceneApiRef.current?.syncPlayers(props.worldPlayers, props.selfPlayerId);
  }, [props.worldPlayers, props.selfPlayerId]);

  useEffect(() => {
    sceneApiRef.current?.syncWorldObjects(props.worldObjects);
  }, [props.worldObjects]);

  useEffect(() => {
    sceneApiRef.current?.setSelectedWorldObject(props.selectedWorldObjectId);
  }, [props.selectedWorldObjectId]);

  useEffect(() => {
    if (props.gravityPreset) {
      sceneApiRef.current?.setGravityPreset(props.gravityPreset);
    }
  }, [props.gravityPreset]);

  useEffect(() => {
    if (props.physicsCommand) {
      sceneApiRef.current?.runPhysicsCommand(props.physicsCommand);
    }
  }, [props.physicsCommand]);

  useEffect(() => {
    sceneApiRef.current?.applyThemeAndSkybox(
      props.theme,
      props.weather,
      props.timeOfDayHours,
      props.skybox,
    );
  }, [props.theme, props.weather, props.timeOfDayHours, props.skybox]);

  useEffect(() => {
    sceneApiRef.current?.setPrototype(props.prototypeKind, props.prototypeColor, props.prototypeMetalness);
  }, [props.prototypeKind, props.prototypeColor, props.prototypeMetalness]);

  useEffect(() => {
    if (props.latestPulse) {
      sceneApiRef.current?.triggerPulse(props.latestPulse);
    }
  }, [props.latestPulse]);

  useEffect(() => {
    if (props.jarvisHologram) {
      sceneApiRef.current?.setJarvisHologram(props.jarvisHologram);
    }
  }, [props.jarvisHologram]);

  useEffect(() => {
    sceneApiRef.current?.setSpatialAudio(
      props.spatialAudioEnabled ?? true,
      props.spatialAudioVolume ?? 0.45,
    );
  }, [props.spatialAudioEnabled, props.spatialAudioVolume]);

  useEffect(() => {
    sceneApiRef.current?.setCameraGoal(props.cameraMode, props.selectedAgentId);
  }, [props.cameraMode, props.selectedAgentId]);

  useEffect(() => {
    sceneApiRef.current?.syncHalo();
  }, [
    props.haloFormFactor,
    props.haloPalette,
    props.haloPanels3D,
    props.haloZones,
    props.haloActiveModule,
    props.haloKillSwitch,
    props.haloGlitchPulseAt,
    props.pendingApprovalsCount,
    props.runningTasksCount,
    props.agents,
  ]);

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 w-full h-full z-0"
      aria-label="VCALABS 3D Command Environment Viewport"
    />
  );
}
