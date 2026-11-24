import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  AgentProfile,
  CameraMode,
  EnvironmentTheme,
  NeuralRegion,
  NeuralRegionId,
  WeatherMode,
  WorldObject,
  WorldPlayer,
} from '../types/os';
import { createProceduralTextures } from '../scene/textures';
import { buildNeuralCore } from '../scene/neuralCore';
import { createAgentVisualRig, type AgentVisualRig } from '../scene/agentBuilder';
import { createMultiplayerAvatarRig, type MultiplayerAvatarRig } from '../scene/multiplayerAvatars';
import { createEnvironmentController, type PrototypeKind } from '../scene/environments';
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
  cameraMode: CameraMode;
  selectedAgentId: string | null;
  prototypeKind: PrototypeKind;
  prototypeColor: string;
  prototypeMetalness: number;
  reducedMotion: boolean;
  latestPulse: PulseSignal | null;
  touchMoveVector?: { x: number; z: number };
  onSelectAgent: (agentId: string) => void;
  onSelectRegion: (regionId: NeuralRegionId) => void;
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
  onClickHaloPanel?: (moduleId: HaloModuleId, panelId: string) => void;
}

const _desiredCamPos = new THREE.Vector3();
const _desiredTarget = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function CommandViewport3D(props: CommandViewport3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const sceneApiRef = useRef<{
    syncAgents: (agents: AgentProfile[]) => void;
    syncPlayers: (players: WorldPlayer[], selfId: string | null) => void;
    syncWorldObjects: (objects: WorldObject[]) => void;
    applyTheme: (theme: EnvironmentTheme, weather: WeatherMode, tod: number) => void;
    setPrototype: (kind: PrototypeKind, color: string, metalness: number) => void;
    triggerPulse: (sig: PulseSignal) => void;
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

    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(54, width / height, 0.1, 280);
    camera.position.set(0, 6.4, 14.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 2.6;
    controls.maxDistance = 32;
    controls.target.set(0, 2.35, 0);
    controls.update();

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const textures = createProceduralTextures(maxAniso);
    const envCtrl = createEnvironmentController(scene, textures.floorAlbedo, textures.floorBump, isSoftwareGl);
    scene.add(envCtrl.root);

    const neuralCore = buildNeuralCore(isSoftwareGl);
    scene.add(neuralCore.group);

    const halo3d = createHalo3DController();
    scene.add(halo3d.root);

    const agentRigs = new Map<string, AgentVisualRig>();
    const agentGroupRoot = new THREE.Group();
    scene.add(agentGroupRoot);

    function syncAgents(agentList: AgentProfile[]) {
      const seen = new Set<string>();
      for (const agent of agentList) {
        seen.add(agent.id);
        const existing = agentRigs.get(agent.id);
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
      for (const [id, rig] of agentRigs.entries()) {
        if (!seen.has(id)) {
          agentGroupRoot.remove(rig.root);
          rig.dispose();
          agentRigs.delete(id);
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

    syncAgents(propsRef.current.agents);
    syncPlayers(propsRef.current.worldPlayers, propsRef.current.selfPlayerId);
    envCtrl.syncWorldObjects(propsRef.current.worldObjects);
    envCtrl.applyTheme(propsRef.current.theme, propsRef.current.weather, propsRef.current.timeOfDayHours);
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

    // Keyboard WASD / Arrow navigation on window
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

    // Pointer click raycasting on agents and neural core regions
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (ev: PointerEvent) => {
      pointerDownPos = { x: ev.clientX, y: ev.clientY };
    };
    const onPointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - pointerDownPos.x, ev.clientY - pointerDownPos.y);
      if (moved > 6) return; // Dragging camera, not clicking

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const targets: THREE.Object3D[] = [...neuralCore.interactables, ...halo3d.interactables];
      agentRigs.forEach((rig) => targets.push(rig.clickProxy));
      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length > 0) {
        const data = hits[0].object.userData;
        if (data.kind === 'agent' && data.agentId) {
          propsRef.current.onSelectAgent(data.agentId);
        } else if (data.kind === 'neural-region' && data.regionId) {
          propsRef.current.onSelectRegion(data.regionId);
        } else if (data.kind === 'halo-panel' && data.moduleId) {
          propsRef.current.onClickHaloPanel?.(data.moduleId, data.panelId);
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

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
      syncWorldObjects: (objects) => envCtrl.syncWorldObjects(objects),
      applyTheme: (theme, weather, tod) => envCtrl.applyTheme(theme, weather, tod),
      setPrototype: (kind, color, metalness) => envCtrl.setPrototype(kind, color, metalness),
      triggerPulse: (sig) => {
        const rig = sig.fromAgentId ? agentRigs.get(sig.fromAgentId) : undefined;
        neuralCore.triggerPulse(sig.regionId, rig?.root.position);
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
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.removeEventListener('start', onControlStart);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);

      controls.dispose();
      neuralCore.dispose();
      halo3d.dispose();
      envCtrl.dispose();
      textures.dispose();
      agentRigs.forEach((rig) => rig.dispose());
      playerRigs.forEach((rig) => rig.dispose());
      envTex.dispose();
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
    sceneApiRef.current?.applyTheme(props.theme, props.weather, props.timeOfDayHours);
  }, [props.theme, props.weather, props.timeOfDayHours]);

  useEffect(() => {
    sceneApiRef.current?.setPrototype(props.prototypeKind, props.prototypeColor, props.prototypeMetalness);
  }, [props.prototypeKind, props.prototypeColor, props.prototypeMetalness]);

  useEffect(() => {
    if (props.latestPulse) {
      sceneApiRef.current?.triggerPulse(props.latestPulse);
    }
  }, [props.latestPulse]);

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
