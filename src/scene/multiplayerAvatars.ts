import * as THREE from 'three';
import type { WorldPlayer } from '../types/os';

export interface MultiplayerAvatarRig {
  playerId: string;
  root: THREE.Group;
  updateFromPlayer: (player: WorldPlayer) => void;
  updateAnimation: (elapsed: number, emote: WorldPlayer['emote']) => void;
  dispose: () => void;
}

function createCallsignSprite(text: string, accentHex: string): {
  sprite: THREE.Sprite;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(10, 15, 28, 0.85)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(8, 12, 240, 40, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 18), 128, 33);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.65, 0.42, 1);
  sprite.position.set(0, 2.18, 0);
  return { sprite, texture, material };
}

export function createMultiplayerAvatarRig(
  player: WorldPlayer,
  contactShadowTex: THREE.Texture,
): MultiplayerAvatarRig {
  const root = new THREE.Group();
  root.position.set(player.position[0], 0, player.position[2]);
  root.rotation.y = player.yaw;

  const disposables: Array<{ dispose: () => void }> = [];

  // Ground contact shadow
  const shadowGeo = new THREE.PlaneGeometry(1.1, 1.1);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: contactShadowTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.018;
  root.add(shadowMesh);
  disposables.push(shadowGeo, shadowMat);

  const suitMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.48,
    metalness: 0.35,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: player.avatarColor,
    emissive: player.avatarColor,
    emissiveIntensity: 0.75,
    roughness: 0.25,
    metalness: 0.5,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.55,
    metalness: 0.1,
  });
  disposables.push(suitMat, accentMat, skinMat);

  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  // Legs (grounded y=0)
  const legGeo = new THREE.CapsuleGeometry(0.085, 0.56, 4, 8);
  const legL = new THREE.Mesh(legGeo, suitMat);
  legL.position.set(-0.13, 0.37, 0);
  const legR = new THREE.Mesh(legGeo, suitMat);
  legR.position.set(0.13, 0.37, 0);
  bodyPivot.add(legL, legR);
  disposables.push(legGeo);

  // Torso
  const torsoGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.62, 12);
  const torso = new THREE.Mesh(torsoGeo, suitMat);
  torso.position.set(0, 1.04, 0);
  bodyPivot.add(torso);
  disposables.push(torsoGeo);

  // Chest beacon trim
  const trimGeo = new THREE.BoxGeometry(0.26, 0.08, 0.32);
  const trim = new THREE.Mesh(trimGeo, accentMat);
  trim.position.set(0, 1.12, 0.05);
  bodyPivot.add(trim);
  disposables.push(trimGeo);

  // Arms (pivoted at shoulder)
  const armGeo = new THREE.CapsuleGeometry(0.065, 0.42, 4, 8);
  const armL = new THREE.Group();
  armL.position.set(-0.29, 1.28, 0);
  const armLMesh = new THREE.Mesh(armGeo, suitMat);
  armLMesh.position.y = -0.22;
  armL.add(armLMesh);

  const armR = new THREE.Group();
  armR.position.set(0.29, 1.28, 0);
  const armRMesh = new THREE.Mesh(armGeo, suitMat);
  armRMesh.position.y = -0.22;
  armR.add(armRMesh);
  bodyPivot.add(armL, armR);
  disposables.push(armGeo);

  // Head + visor
  const headGeo = new THREE.SphereGeometry(0.165, 16, 12);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(0, 1.56, 0);
  const visorGeo = new THREE.BoxGeometry(0.22, 0.06, 0.16);
  const visor = new THREE.Mesh(visorGeo, accentMat);
  visor.position.set(0, 1.57, 0.09);
  bodyPivot.add(head, visor);
  disposables.push(headGeo, visorGeo);

  // Floating Callsign Sprite
  let labelHandle = createCallsignSprite(player.callsign, player.avatarColor);
  root.add(labelHandle.sprite);

  let currentCallsign = player.callsign;
  let currentColor = player.avatarColor;
  const targetPos = new THREE.Vector3(player.position[0], 0, player.position[2]);
  let targetYaw = player.yaw;

  return {
    playerId: player.id,
    root,
    updateFromPlayer: (next) => {
      targetPos.set(next.position[0], 0, next.position[2]);
      targetYaw = next.yaw;
      if (next.avatarColor !== currentColor) {
        currentColor = next.avatarColor;
        accentMat.color.set(currentColor);
        accentMat.emissive.set(currentColor);
      }
      if (next.callsign !== currentCallsign || next.avatarColor !== currentColor) {
        currentCallsign = next.callsign;
        root.remove(labelHandle.sprite);
        labelHandle.texture.dispose();
        labelHandle.material.dispose();
        labelHandle = createCallsignSprite(next.callsign, next.avatarColor);
        root.add(labelHandle.sprite);
      }
    },
    updateAnimation: (elapsed, emote) => {
      root.position.lerp(targetPos, 0.22);
      root.rotation.y += (targetYaw - root.rotation.y) * 0.22;
      bodyPivot.position.y = Math.sin(elapsed * 2.4) * 0.025;

      if (emote === 'wave') {
        armR.rotation.z = -2.4 + Math.sin(elapsed * 8) * 0.35;
        armL.rotation.z = 0.08;
      } else if (emote === 'work') {
        armL.rotation.x = -0.85 + Math.sin(elapsed * 6) * 0.15;
        armR.rotation.x = -0.85 + Math.cos(elapsed * 6) * 0.15;
        armR.rotation.z = -0.05;
      } else if (emote === 'focus') {
        armL.rotation.x = -0.4;
        armR.rotation.x = -0.4;
        armR.rotation.z = -0.15;
      } else {
        armL.rotation.x = Math.sin(elapsed * 1.6) * 0.08;
        armR.rotation.x = -Math.sin(elapsed * 1.6) * 0.08;
        armL.rotation.z = 0.06;
        armR.rotation.z = -0.06;
      }
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      labelHandle.texture.dispose();
      labelHandle.material.dispose();
    },
  };
}
