import * as THREE from 'three';
import { HALO_PANEL_FRAGMENT_SHADER, HALO_PANEL_VERTEX_SHADER } from './shaders';
import type { AgentProfile } from '../../src/types/os';
import type {
  HaloFormFactor,
  HaloModuleId,
  HaloPanelState3D,
  HaloThemePalette,
  WorldZone,
} from './types';

export interface Halo3DController {
  root: THREE.Group;
  interactables: THREE.Object3D[];
  syncState: (params: {
    formFactor: HaloFormFactor;
    palette: HaloThemePalette;
    panels: HaloPanelState3D[];
    agents: AgentProfile[];
    zones: WorldZone[];
    activeModule: HaloModuleId;
    killSwitchActive: boolean;
    glitchPulseAt: number;
    pendingApprovals: number;
    tasksRunning: number;
  }) => void;
  update: (elapsed: number, cameraPos: THREE.Vector3) => void;
  dispose: () => void;
}

interface PanelRig {
  id: string;
  moduleId: HaloModuleId;
  group: THREE.Group;
  frameMesh: THREE.Mesh;
  screenMesh: THREE.Mesh;
  orbMesh: THREE.Mesh;
  shaderMat: THREE.ShaderMaterial;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

export function createHalo3DController(): Halo3DController {
  const root = new THREE.Group();
  const domeGroup = new THREE.Group();
  const tableGroup = new THREE.Group();
  const zoneGroup = new THREE.Group();
  root.add(domeGroup, tableGroup, zoneGroup);

  domeGroup.visible = false;
  tableGroup.visible = false;

  const interactables: THREE.Object3D[] = [];
  const panelRigs = new Map<string, PanelRig>();
  const disposables: Array<{ dispose: () => void }> = [];

  // Shared physical frame geometries
  const panelWidth = 2.6;
  const panelHeight = 1.58;
  const screenGeo = new THREE.PlaneGeometry(panelWidth, panelHeight, 12, 8);
  const frameGeo = new THREE.BoxGeometry(panelWidth + 0.1, panelHeight + 0.1, 0.06);
  const orbGeo = new THREE.OctahedronGeometry(0.24, 1);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.3,
    metalness: 0.85,
  });
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x22d3ee,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.5,
  });
  disposables.push(screenGeo, frameGeo, orbGeo, frameMat, orbMat);

  function ensurePanelRig(p: HaloPanelState3D): PanelRig {
    const existing = panelRigs.get(p.id);
    if (existing) return existing;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const shaderMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uAccentColor: { value: new THREE.Color('#22d3ee') },
        uTime: { value: 0 },
        uScanlineOpacity: { value: 0.09 },
        uGlitch: { value: 0 },
        uOpacity: { value: 0.94 },
        uHover: { value: 0 },
        uParallax: { value: 0.35 },
      },
      vertexShader: HALO_PANEL_VERTEX_SHADER,
      fragmentShader: HALO_PANEL_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const group = new THREE.Group();
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.z = -0.04;

    const screenMesh = new THREE.Mesh(screenGeo, shaderMat);
    screenMesh.userData = { kind: 'halo-panel', moduleId: p.moduleId, panelId: p.id };

    const orbMesh = new THREE.Mesh(orbGeo, orbMat);
    orbMesh.visible = false;
    orbMesh.userData = { kind: 'halo-panel', moduleId: p.moduleId, panelId: p.id };

    group.add(frameMesh, screenMesh, orbMesh);
    domeGroup.add(group);
    interactables.push(screenMesh, orbMesh);

    const rig: PanelRig = {
      id: p.id,
      moduleId: p.moduleId,
      group,
      frameMesh,
      screenMesh,
      orbMesh,
      shaderMat,
      canvas,
      ctx,
      texture,
    };
    panelRigs.set(p.id, rig);
    return rig;
  }

  function paintPanelCanvas(
    rig: PanelRig,
    panel: HaloPanelState3D,
    palette: HaloThemePalette,
    agents: AgentProfile[],
    killSwitchActive: boolean,
    pendingApprovals: number,
    tasksRunning: number,
    active: boolean,
  ) {
    const { ctx, canvas } = rig;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Translucent dark cyber glass card
    ctx.fillStyle = killSwitchActive ? 'rgba(42, 10, 16, 0.94)' : 'rgba(8, 15, 30, 0.92)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header band
    ctx.fillStyle = killSwitchActive ? '#ef4444' : active ? palette.primary : palette.secondary;
    ctx.fillRect(0, 0, canvas.width, 46);

    ctx.fillStyle = '#040812';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`HALO // ${panel.title.toUpperCase()}`, 18, 30);

    ctx.fillStyle = palette.textPrimary;
    ctx.font = 'bold 16px monospace';
    ctx.fillText(
      killSwitchActive
        ? 'EMERGENCY KILL SWITCH ENGAGED — ALL AGENTS FROZEN'
        : `ACTIVE AGENTS: ${agents.length}  |  RUNNING TASKS: ${tasksRunning}  |  APPROVALS: ${pendingApprovals}`,
      18,
      82,
    );

    // Live agent rows
    ctx.font = '14px monospace';
    agents.slice(0, 5).forEach((ag, idx) => {
      const y = 122 + idx * 36;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(18, y - 20, canvas.width - 36, 28);
      ctx.fillStyle = ag.appearance.accentColor;
      ctx.fillRect(18, y - 20, 6, 28);
      ctx.fillStyle = '#e6edf7';
      ctx.fillText(`${ag.name.padEnd(13)} ${ag.status.toUpperCase().padEnd(12)} ${ag.metrics.tokensUsed} tok`, 34, y);
    });

    ctx.fillStyle = palette.textMuted;
    ctx.font = '13px monospace';
    ctx.fillText('CLICK PANEL TO FOCUS MODULE IN HUD  ·  3D SHADER LIVE', 18, 302);
    rig.texture.needsUpdate = true;
  }

  // Holo Table (tactical map pedestal positioned in front-right of Core)
  tableGroup.position.set(0, 0, 4.4);
  const tablePedGeo = new THREE.CylinderGeometry(1.55, 1.85, 0.72, 24);
  const tablePedMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.35,
    metalness: 0.8,
  });
  const tablePed = new THREE.Mesh(tablePedGeo, tablePedMat);
  tablePed.position.y = 0.36;

  const mapPlaneGeo = new THREE.CircleGeometry(1.5, 32);
  const mapPlaneMat = new THREE.MeshBasicMaterial({
    color: 0x0b253a,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
  });
  const mapPlane = new THREE.Mesh(mapPlaneGeo, mapPlaneMat);
  mapPlane.rotation.x = -Math.PI / 2;
  mapPlane.position.y = 0.74;

  const gridRingGeo = new THREE.RingGeometry(1.42, 1.49, 48);
  const gridRingMat = new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    side: THREE.DoubleSide,
  });
  const gridRing = new THREE.Mesh(gridRingGeo, gridRingMat);
  gridRing.rotation.x = -Math.PI / 2;
  gridRing.position.y = 0.75;

  const markersGroup = new THREE.Group();
  markersGroup.position.y = 0.78;
  tableGroup.add(tablePed, mapPlane, gridRing, markersGroup);
  disposables.push(tablePedGeo, tablePedMat, mapPlaneGeo, mapPlaneMat, gridRingGeo, gridRingMat);

  let tableMarkerDisposables: Array<{ dispose: () => void }> = [];
  let zoneDisposables: Array<{ dispose: () => void }> = [];
  let lastGlitchTrigger = 0;

  return {
    root,
    interactables,
    syncState: (params) => {
      domeGroup.visible = params.formFactor === 'dome' || params.formFactor === 'shared';
      tableGroup.visible = params.formFactor === 'table';

      if (params.glitchPulseAt > lastGlitchTrigger) {
        lastGlitchTrigger = params.glitchPulseAt;
      }

      const accentColor = new THREE.Color(
        params.killSwitchActive ? params.palette.danger : params.palette.primary,
      );
      orbMat.color.copy(accentColor);
      orbMat.emissive.copy(accentColor);
      gridRingMat.color.copy(accentColor);

      // Sync Command Dome panels
      for (const p of params.panels) {
        const rig = ensurePanelRig(p);
        rig.group.position.set(p.position[0], p.position[1], p.position[2]);
        rig.group.rotation.y = p.rotationY;
        rig.frameMesh.visible = !p.minimized;
        rig.screenMesh.visible = !p.minimized;
        rig.orbMesh.visible = p.minimized;
        rig.shaderMat.uniforms.uAccentColor.value.copy(accentColor);
        rig.shaderMat.uniforms.uScanlineOpacity.value = params.palette.scanlineOpacity;
        rig.shaderMat.uniforms.uHover.value = params.activeModule === p.moduleId ? 1.0 : 0.15;

        paintPanelCanvas(
          rig,
          p,
          params.palette,
          params.agents,
          params.killSwitchActive,
          params.pendingApprovals,
          params.tasksRunning,
          params.activeModule === p.moduleId,
        );
      }

      // Rebuild Holo Table live agent markers (scale world [-15..15] -> table radius 1.35)
      tableMarkerDisposables.forEach((d) => d.dispose());
      tableMarkerDisposables = [];
      while (markersGroup.children.length > 0) {
        markersGroup.remove(markersGroup.children[0]);
      }

      const pinGeo = new THREE.ConeGeometry(0.065, 0.22, 8);
      tableMarkerDisposables.push(pinGeo);
      for (const ag of params.agents) {
        const mat = new THREE.MeshBasicMaterial({ color: ag.appearance.accentColor });
        tableMarkerDisposables.push(mat);
        const pin = new THREE.Mesh(pinGeo, mat);
        pin.position.set((ag.position[0] / 14) * 1.3, 0.12, (ag.position[2] / 14) * 1.3);
        pin.userData = { kind: 'agent', agentId: ag.id };
        markersGroup.add(pin);
      }

      // Sync 3D World Zones (translucent security/rule cylinders on ground)
      zoneDisposables.forEach((d) => d.dispose());
      zoneDisposables = [];
      while (zoneGroup.children.length > 0) {
        zoneGroup.remove(zoneGroup.children[0]);
      }
      for (const z of params.zones) {
        const cylGeo = new THREE.CylinderGeometry(z.radius, z.radius, 0.12, 32, 1, true);
        const cylMat = new THREE.MeshBasicMaterial({
          color: z.color,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        zoneDisposables.push(cylGeo, cylMat);
        const mesh = new THREE.Mesh(cylGeo, cylMat);
        mesh.position.set(z.center[0], 0.08, z.center[2]);
        zoneGroup.add(mesh);
      }
    },
    update: (elapsed, cameraPos) => {
      const glitchAge = (Date.now() - lastGlitchTrigger) / 1000;
      const glitchVal = glitchAge < 0.45 ? Math.max(0, 1 - glitchAge / 0.45) : 0;
      const parallaxVal = Math.sin(cameraPos.x * 0.25) * 0.6;

      for (const rig of panelRigs.values()) {
        rig.shaderMat.uniforms.uTime.value = elapsed;
        rig.shaderMat.uniforms.uGlitch.value = glitchVal;
        rig.shaderMat.uniforms.uParallax.value = parallaxVal;
        if (rig.orbMesh.visible) {
          rig.orbMesh.rotation.y = elapsed * 1.2;
        }
      }
    },
    dispose: () => {
      tableMarkerDisposables.forEach((d) => d.dispose());
      zoneDisposables.forEach((d) => d.dispose());
      for (const rig of panelRigs.values()) {
        rig.shaderMat.dispose();
        rig.texture.dispose();
      }
      disposables.forEach((d) => d.dispose());
    },
  };
}
