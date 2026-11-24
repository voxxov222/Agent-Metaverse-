import * as THREE from 'three';

export interface ProceduralTextureSet {
  floorAlbedo: THREE.CanvasTexture;
  floorBump: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  holoGrid: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Floor Panel Albedo (Obsidian brushed metal tiles + subtle seam lines)
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = 512;
  albedoCanvas.height = 512;
  const actx = albedoCanvas.getContext('2d')!;
  actx.fillStyle = '#0f1623';
  actx.fillRect(0, 0, 512, 512);

  // Subtle brushed grain
  for (let i = 0; i < 1800; i++) {
    const x = (i * 73) % 512;
    const y = (i * 137) % 512;
    const w = 12 + (i % 28);
    actx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.08)';
    actx.fillRect(x, y, w, 1);
  }
  // Precision tile seams
  actx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  actx.lineWidth = 2;
  actx.strokeRect(2, 2, 508, 508);
  actx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  actx.lineWidth = 1;
  actx.beginPath();
  actx.moveTo(256, 0);
  actx.lineTo(256, 512);
  actx.moveTo(0, 256);
  actx.lineTo(512, 256);
  actx.stroke();

  const floorAlbedo = new THREE.CanvasTexture(albedoCanvas);
  floorAlbedo.colorSpace = THREE.SRGBColorSpace;
  floorAlbedo.wrapS = THREE.RepeatWrapping;
  floorAlbedo.wrapT = THREE.RepeatWrapping;
  floorAlbedo.repeat.set(16, 16);
  floorAlbedo.anisotropy = maxAnisotropy;

  // 2. Floor Bump Map (Linear space)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);
  bctx.strokeStyle = '#303030';
  bctx.lineWidth = 3;
  bctx.strokeRect(1, 1, 254, 254);
  bctx.beginPath();
  bctx.moveTo(128, 0);
  bctx.lineTo(128, 256);
  bctx.moveTo(0, 128);
  bctx.lineTo(256, 128);
  bctx.stroke();

  const floorBump = new THREE.CanvasTexture(bumpCanvas);
  floorBump.wrapS = THREE.RepeatWrapping;
  floorBump.wrapT = THREE.RepeatWrapping;
  floorBump.repeat.set(16, 16);
  floorBump.anisotropy = maxAnisotropy;

  // 3. Soft Radial Contact Shadow Disc
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d')!;
  const grad = sctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.32)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);

  const contactShadow = new THREE.CanvasTexture(shadowCanvas);

  // 4. Holographic Screen Grid Texture
  const holoCanvas = document.createElement('canvas');
  holoCanvas.width = 256;
  holoCanvas.height = 128;
  const hctx = holoCanvas.getContext('2d')!;
  hctx.fillStyle = 'rgba(8, 24, 44, 0.85)';
  hctx.fillRect(0, 0, 256, 128);
  hctx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
  hctx.lineWidth = 1;
  for (let x = 0; x <= 256; x += 32) {
    hctx.beginPath();
    hctx.moveTo(x, 0);
    hctx.lineTo(x, 128);
    hctx.stroke();
  }
  for (let y = 0; y <= 128; y += 32) {
    hctx.beginPath();
    hctx.moveTo(0, y);
    hctx.lineTo(256, y);
    hctx.stroke();
  }
  // Crisp waveform line
  hctx.strokeStyle = '#22D3EE';
  hctx.lineWidth = 2;
  hctx.beginPath();
  for (let x = 8; x < 248; x += 8) {
    const y = 64 + Math.sin(x * 0.08) * 18 + Math.cos(x * 0.17) * 8;
    if (x === 8) hctx.moveTo(x, y);
    else hctx.lineTo(x, y);
  }
  hctx.stroke();

  const holoGrid = new THREE.CanvasTexture(holoCanvas);
  holoGrid.colorSpace = THREE.SRGBColorSpace;
  holoGrid.anisotropy = maxAnisotropy;

  return {
    floorAlbedo,
    floorBump,
    contactShadow,
    holoGrid,
    dispose: () => {
      floorAlbedo.dispose();
      floorBump.dispose();
      contactShadow.dispose();
      holoGrid.dispose();
    },
  };
}
