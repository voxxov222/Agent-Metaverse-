import * as THREE from 'three';
import type { AgentProfile } from '../types/os';

export interface AgentVisualRig {
  agentId: string;
  root: THREE.Group;
  avatarGroup: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  headGroup: THREE.Group;
  haloMesh: THREE.Mesh;
  visorMesh: THREE.Mesh;
  chassisMat: THREE.MeshStandardMaterial;
  accentMat: THREE.MeshStandardMaterial;
  visorMat: THREE.MeshStandardMaterial;
  haloMat: THREE.MeshBasicMaterial;
  clickProxy: THREE.Mesh;
  updateAppearance: (agent: AgentProfile) => void;
  updateAnimation: (elapsed: number, status: AgentProfile['status']) => void;
  dispose: () => void;
}

const STATUS_COLORS: Record<AgentProfile['status'], number> = {
  idle: 0x38bdf8,
  reasoning: 0x8b5cf6,
  executing: 0x10b981,
  collaborating: 0x22d3ee,
  'awaiting-approval': 0xf59e0b,
  error: 0xef4444,
};

export function createAgentVisualRig(
  agent: AgentProfile,
  contactShadowTex: THREE.Texture,
  holoScreenTex: THREE.Texture,
): AgentVisualRig {
  const root = new THREE.Group();
  root.position.set(agent.position[0], 0, agent.position[2]);
  // Face inward toward Central Neural Core at (0, 0, 0)
  root.lookAt(0, 0, 0);

  const disposables: Array<{ dispose: () => void }> = [];

  // Shared materials for this agent
  const chassisMat = new THREE.MeshStandardMaterial({
    color: agent.appearance.chassisColor,
    roughness: 0.7,
    metalness: 0.25,
  });
  const metallicJointMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.28,
    metalness: 0.88,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: agent.appearance.accentColor,
    emissive: agent.appearance.accentColor,
    emissiveIntensity: 0.35,
    roughness: 0.3,
    metalness: 0.65,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: agent.appearance.visorColor,
    emissive: agent.appearance.visorColor,
    emissiveIntensity: 1.25,
    roughness: 0.12,
    metalness: 0.1,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color: STATUS_COLORS[agent.status],
    transparent: true,
    opacity: 0.85,
  });
  disposables.push(chassisMat, metallicJointMat, accentMat, visorMat, haloMat);

  // 1. Grounded Contact Shadow Disc (y = 0.015)
  const shadowGeo = new THREE.CircleGeometry(0.95, 24);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const shadowDisc = new THREE.Mesh(shadowGeo, shadowMat);
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.y = 0.015;
  root.add(shadowDisc);
  disposables.push(shadowGeo, shadowMat);

  // 2. Agent Workstation Desk / Holographic Terminal Console in front of agent (+z in local space)
  const deskGroup = new THREE.Group();
  deskGroup.position.set(0, 0, 0.92);

  const deskBaseGeo = new THREE.BoxGeometry(1.15, 0.72, 0.44);
  const deskBaseMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.42,
    metalness: 0.75,
  });
  const deskBase = new THREE.Mesh(deskBaseGeo, deskBaseMat);
  deskBase.position.y = 0.36;
  deskBase.castShadow = true;
  deskBase.receiveShadow = true;
  deskGroup.add(deskBase);

  const screenGeo = new THREE.PlaneGeometry(1.02, 0.52);
  const screenMat = new THREE.MeshBasicMaterial({
    map: holoScreenTex,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const holoScreen = new THREE.Mesh(screenGeo, screenMat);
  holoScreen.position.set(0, 1.05, 0);
  holoScreen.rotation.x = -0.22;
  deskGroup.add(holoScreen);

  const trimGeo = new THREE.BoxGeometry(1.18, 0.04, 0.48);
  const deskTrim = new THREE.Mesh(trimGeo, accentMat);
  deskTrim.position.y = 0.73;
  deskGroup.add(deskTrim);

  root.add(deskGroup);
  disposables.push(deskBaseGeo, deskBaseMat, screenGeo, screenMat, trimGeo);

  // 3. Composite Agent Character Group (pivoted at bottom-center y = 0)
  const avatarGroup = new THREE.Group();
  avatarGroup.scale.set(
    agent.appearance.shoulderWidth,
    agent.appearance.heightScale,
    1,
  );
  root.add(avatarGroup);

  // Lower legs/boots (LatheGeometry silhouette)
  const bootPoints = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(0.14, 0),
    new THREE.Vector2(0.12, 0.16),
    new THREE.Vector2(0.09, 0.42),
    new THREE.Vector2(0.11, 0.82),
    new THREE.Vector2(0, 0.82),
  ];
  const legGeo = new THREE.LatheGeometry(bootPoints, 16);
  const leftLeg = new THREE.Mesh(legGeo, metallicJointMat);
  leftLeg.position.set(-0.16, 0, 0);
  leftLeg.castShadow = true;
  const rightLeg = new THREE.Mesh(legGeo, metallicJointMat);
  rightLeg.position.set(0.16, 0, 0);
  rightLeg.castShadow = true;
  avatarGroup.add(leftLeg, rightLeg);
  disposables.push(legGeo);

  // Torso (Beveled ExtrudeGeometry)
  const torsoShape = new THREE.Shape();
  torsoShape.moveTo(-0.22, 0);
  torsoShape.lineTo(0.22, 0);
  torsoShape.lineTo(0.28, 0.56);
  torsoShape.lineTo(0.16, 0.66);
  torsoShape.lineTo(-0.16, 0.66);
  torsoShape.lineTo(-0.28, 0.56);
  torsoShape.closePath();

  const torsoGeo = new THREE.ExtrudeGeometry(torsoShape, {
    depth: 0.24,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.035,
    bevelSegments: 2,
  });
  torsoGeo.translate(0, 0, -0.12);
  const torsoMesh = new THREE.Mesh(torsoGeo, chassisMat);
  torsoMesh.position.y = 0.8;
  torsoMesh.castShadow = true;
  avatarGroup.add(torsoMesh);
  disposables.push(torsoGeo);

  // Chest Core Crest (Accent)
  const crestGeo = new THREE.OctahedronGeometry(0.08, 0);
  const crest = new THREE.Mesh(crestGeo, accentMat);
  crest.position.set(0, 1.24, 0.16);
  crest.scale.set(1.2, 1.4, 0.5);
  avatarGroup.add(crest);
  disposables.push(crestGeo);

  // Articulated Arms + Shoulder Pauldrons
  const pauldronGeo = new THREE.SphereGeometry(0.11, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const armGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.52, 12);
  disposables.push(pauldronGeo, armGeo);

  const leftArm = new THREE.Group();
  leftArm.position.set(-0.34, 1.4, 0);
  const lPauldron = new THREE.Mesh(pauldronGeo, accentMat);
  const lLimb = new THREE.Mesh(armGeo, metallicJointMat);
  lLimb.position.y = -0.26;
  lLimb.castShadow = true;
  leftArm.add(lPauldron, lLimb);
  avatarGroup.add(leftArm);

  const rightArm = new THREE.Group();
  rightArm.position.set(0.34, 1.4, 0);
  const rPauldron = new THREE.Mesh(pauldronGeo, accentMat);
  const rLimb = new THREE.Mesh(armGeo, metallicJointMat);
  rLimb.position.y = -0.26;
  rLimb.castShadow = true;
  rightArm.add(rPauldron, rLimb);
  avatarGroup.add(rightArm);

  // Head + Visor Plate + Status Halo
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.62, 0);

  const neckGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.14, 12);
  const neck = new THREE.Mesh(neckGeo, metallicJointMat);
  neck.position.y = -0.06;
  headGroup.add(neck);

  const headGeo = new THREE.DodecahedronGeometry(0.18, 1);
  const headMesh = new THREE.Mesh(headGeo, chassisMat);
  headMesh.position.y = 0.08;
  headMesh.scale.set(0.92, 1.08, 1.0);
  headMesh.castShadow = true;
  headGroup.add(headMesh);

  const visorGeo = new THREE.BoxGeometry(0.24, 0.07, 0.08);
  const visorMesh = new THREE.Mesh(visorGeo, visorMat);
  visorMesh.position.set(0, 0.1, 0.14);
  headGroup.add(visorMesh);

  const haloGeo = new THREE.TorusGeometry(0.26, 0.015, 8, 32);
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.rotation.x = Math.PI / 2;
  haloMesh.position.y = 0.34;
  headGroup.add(haloMesh);

  avatarGroup.add(headGroup);
  disposables.push(neckGeo, headGeo, visorGeo, haloGeo);

  // 4. Simplified Raycast Proxy Box
  const proxyGeo = new THREE.BoxGeometry(1.25, 2.15, 1.45);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const clickProxy = new THREE.Mesh(proxyGeo, proxyMat);
  clickProxy.position.set(0, 1.07, 0.3);
  clickProxy.userData = { kind: 'agent', agentId: agent.id };
  root.add(clickProxy);
  disposables.push(proxyGeo, proxyMat);

  return {
    agentId: agent.id,
    root,
    avatarGroup,
    leftArm,
    rightArm,
    headGroup,
    haloMesh,
    visorMesh,
    chassisMat,
    accentMat,
    visorMat,
    haloMat,
    clickProxy,
    updateAppearance: (updated) => {
      chassisMat.color.set(updated.appearance.chassisColor);
      accentMat.color.set(updated.appearance.accentColor);
      accentMat.emissive.set(updated.appearance.accentColor);
      visorMat.color.set(updated.appearance.visorColor);
      visorMat.emissive.set(updated.appearance.visorColor);
      haloMat.color.setHex(STATUS_COLORS[updated.status]);
      avatarGroup.scale.set(
        updated.appearance.shoulderWidth,
        updated.appearance.heightScale,
        1,
      );
      if (updated.appearance.wardrobeStyle === 'architect-robe') {
        torsoMesh.scale.set(1.06, 1.08, 1.06);
      } else if (updated.appearance.wardrobeStyle === 'chassis-shell') {
        torsoMesh.scale.set(1.12, 0.96, 1.15);
      } else {
        torsoMesh.scale.set(1, 1, 1);
      }
    },
    updateAnimation: (elapsed, status) => {
      const idxOffset = agent.position[0] * 0.7;
      // Subtle breathing
      avatarGroup.position.y = Math.sin(elapsed * 1.8 + idxOffset) * 0.015;
      haloMesh.rotation.z = elapsed * 0.8;

      if (status === 'executing' || status === 'reasoning') {
        // Typing / active gesture toward workstation console
        leftArm.rotation.x = -0.75 + Math.sin(elapsed * 7.5 + idxOffset) * 0.14;
        rightArm.rotation.x = -0.75 + Math.cos(elapsed * 7.5 + idxOffset) * 0.14;
        headGroup.rotation.x = 0.12;
        headGroup.rotation.y = Math.sin(elapsed * 2.2) * 0.16;
      } else if (status === 'collaborating') {
        leftArm.rotation.x = -0.35;
        rightArm.rotation.x = -0.95 + Math.sin(elapsed * 4.5) * 0.25;
        headGroup.rotation.x = 0;
        headGroup.rotation.y = Math.sin(elapsed * 1.6) * 0.28;
      } else {
        leftArm.rotation.x = -0.15 + Math.sin(elapsed * 1.4 + idxOffset) * 0.05;
        rightArm.rotation.x = -0.15 - Math.sin(elapsed * 1.4 + idxOffset) * 0.05;
        headGroup.rotation.x = 0;
        headGroup.rotation.y = Math.sin(elapsed * 0.8 + idxOffset) * 0.14;
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
