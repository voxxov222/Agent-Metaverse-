import * as THREE from 'three';

export interface ProceduralTextureSet {
  floorAlbedo: THREE.CanvasTexture;
  floorBump: THREE.CanvasTexture;
  floorRoughness: THREE.CanvasTexture;
  carbonWeaveAlbedo: THREE.CanvasTexture;
  brushedMetalBump: THREE.CanvasTexture;
  towerFacadeAlbedo: THREE.CanvasTexture;
  towerFacadeEmissive: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  holoGrid: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. High-Res 1024x1024 Aerospace Modular Floor Decking Albedo (SRGB)
  const size = 1024;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const actx = albedoCanvas.getContext('2d')!;

  // Base dark anodized titanium plating
  actx.fillStyle = '#0e1522';
  actx.fillRect(0, 0, size, size);

  // Subtle quadrant tonal variation for realistic modular panel manufacturing tolerances
  const quads = [
    [0, 0, '#111a2a'],
    [512, 0, '#0d1421'],
    [0, 512, '#0e1624'],
    [512, 512, '#121b2c'],
  ] as const;
  for (const [qx, qy, fill] of quads) {
    actx.fillStyle = fill;
    actx.fillRect(qx + 4, qy + 4, 504, 504);
  }

  // Directional brushed aluminum micro-streaks
  for (let i = 0; i < 6200; i++) {
    const x = (i * 131) % size;
    const y = (i * 257) % size;
    const w = 18 + (i % 54);
    actx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(2,6,14,0.11)';
    actx.fillRect(x, y, w, 1);
  }

  // Recessed diamond micro-tread sub-strip in center-left panel
  actx.fillStyle = 'rgba(15, 23, 42, 0.72)';
  actx.fillRect(64, 180, 384, 152);
  actx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  actx.lineWidth = 1.5;
  for (let gx = 74; gx < 440; gx += 16) {
    for (let gy = 190; gy < 326; gy += 16) {
      actx.beginPath();
      actx.moveTo(gx, gy + 5);
      actx.lineTo(gx + 5, gy);
      actx.lineTo(gx + 10, gy + 5);
      actx.lineTo(gx + 5, gy + 10);
      actx.closePath();
      actx.stroke();
    }
  }

  // Chamfered panel seams & shadowed expansion joints
  actx.strokeStyle = 'rgba(2, 6, 14, 0.9)';
  actx.lineWidth = 6;
  actx.strokeRect(2, 2, size - 4, size - 4);
  actx.beginPath();
  actx.moveTo(512, 0);
  actx.lineTo(512, size);
  actx.moveTo(0, 512);
  actx.lineTo(size, 512);
  actx.stroke();

  // Precision specular highlight edges & subtle cyan telemetry seam accent
  actx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  actx.lineWidth = 1.5;
  actx.strokeRect(8, 8, 496, 496);
  actx.strokeRect(520, 8, 496, 496);
  actx.strokeRect(8, 520, 496, 496);
  actx.strokeRect(520, 520, 496, 496);

  actx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
  actx.lineWidth = 2;
  actx.beginPath();
  actx.moveTo(24, 505);
  actx.lineTo(488, 505);
  actx.moveTo(536, 505);
  actx.lineTo(1000, 505);
  actx.stroke();

  // Machined hex fasteners at panel corners
  for (const [qx, qy] of quads) {
    const bolts = [
      [qx + 22, qy + 22],
      [qx + 490, qy + 22],
      [qx + 22, qy + 490],
      [qx + 490, qy + 490],
      [qx + 256, qy + 22],
      [qx + 256, qy + 490],
    ];
    for (const [bx, by] of bolts) {
      actx.fillStyle = '#060a12';
      actx.beginPath();
      actx.arc(bx, by, 4.5, 0, Math.PI * 2);
      actx.fill();
      actx.fillStyle = 'rgba(148, 163, 184, 0.45)';
      actx.beginPath();
      actx.arc(bx - 0.6, by - 0.6, 2.8, 0, Math.PI * 2);
      actx.fill();
    }
  }

  const floorAlbedo = new THREE.CanvasTexture(albedoCanvas);
  floorAlbedo.colorSpace = THREE.SRGBColorSpace;
  floorAlbedo.wrapS = THREE.RepeatWrapping;
  floorAlbedo.wrapT = THREE.RepeatWrapping;
  floorAlbedo.repeat.set(16, 16);
  floorAlbedo.anisotropy = maxAnisotropy;

  // 2. Floor Bump Map (Linear space — deep expansion seams + tread ridges + recessed bolt sockets)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 512;
  bumpCanvas.height = 512;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#848484';
  bctx.fillRect(0, 0, 512, 512);

  // Grate diamond bumps in sub-panel
  bctx.fillStyle = '#606060';
  bctx.fillRect(32, 90, 192, 76);
  bctx.fillStyle = '#b4b4b4';
  for (let gx = 37; gx < 220; gx += 8) {
    for (let gy = 95; gy < 163; gy += 8) {
      bctx.fillRect(gx, gy, 3, 3);
    }
  }

  bctx.strokeStyle = '#181818';
  bctx.lineWidth = 4;
  bctx.strokeRect(1, 1, 510, 510);
  bctx.beginPath();
  bctx.moveTo(256, 0);
  bctx.lineTo(256, 512);
  bctx.moveTo(0, 256);
  bctx.lineTo(512, 256);
  bctx.stroke();

  bctx.strokeStyle = '#bcbcbc';
  bctx.lineWidth = 1;
  bctx.strokeRect(4, 4, 248, 248);
  bctx.strokeRect(260, 4, 248, 248);
  bctx.strokeRect(4, 260, 248, 248);
  bctx.strokeRect(260, 260, 248, 248);

  const floorBump = new THREE.CanvasTexture(bumpCanvas);
  floorBump.wrapS = THREE.RepeatWrapping;
  floorBump.wrapT = THREE.RepeatWrapping;
  floorBump.repeat.set(16, 16);
  floorBump.anisotropy = maxAnisotropy;

  // 3. Floor Roughness Map (Linear space — polished chamfer seams vs matte tread & micro-scratches)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 512;
  roughCanvas.height = 512;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#808080';
  rctx.fillRect(0, 0, 512, 512);
  rctx.fillStyle = '#686868';
  rctx.fillRect(0, 0, 256, 256);
  rctx.fillRect(256, 256, 256, 256);
  // Matte floor grate inset
  rctx.fillStyle = '#b8b8b8';
  rctx.fillRect(32, 90, 192, 76);
  // Brushed polish streaks
  for (let i = 0; i < 1400; i++) {
    const x = (i * 79) % 512;
    const y = (i * 151) % 512;
    rctx.fillStyle = i % 3 === 0 ? '#505050' : '#969696';
    rctx.fillRect(x, y, 22, 1);
  }

  const floorRoughness = new THREE.CanvasTexture(roughCanvas);
  floorRoughness.wrapS = THREE.RepeatWrapping;
  floorRoughness.wrapT = THREE.RepeatWrapping;
  floorRoughness.repeat.set(16, 16);
  floorRoughness.anisotropy = maxAnisotropy;

  // 4. Aerospace Carbon-Weave Albedo (for high-tech chassis, buttresses & desk decks)
  const carbonCanvas = document.createElement('canvas');
  carbonCanvas.width = 128;
  carbonCanvas.height = 128;
  const cctx = carbonCanvas.getContext('2d')!;
  cctx.fillStyle = '#111827';
  cctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      const diag = ((x + y) / 8) % 2 === 0;
      cctx.fillStyle = diag ? '#1a2436' : '#0b101b';
      cctx.fillRect(x, y, 4, 8);
      cctx.fillStyle = diag ? '#131c2c' : '#1f2b40';
      cctx.fillRect(x + 4, y, 4, 8);
    }
  }
  const carbonWeaveAlbedo = new THREE.CanvasTexture(carbonCanvas);
  carbonWeaveAlbedo.colorSpace = THREE.SRGBColorSpace;
  carbonWeaveAlbedo.wrapS = THREE.RepeatWrapping;
  carbonWeaveAlbedo.wrapT = THREE.RepeatWrapping;
  carbonWeaveAlbedo.repeat.set(6, 6);
  carbonWeaveAlbedo.anisotropy = maxAnisotropy;

  // 5. Brushed Steel Bump (Linear space for pillars, pylons & chassis trim)
  const metalCanvas = document.createElement('canvas');
  metalCanvas.width = 256;
  metalCanvas.height = 256;
  const mctx = metalCanvas.getContext('2d')!;
  mctx.fillStyle = '#808080';
  mctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const x = (i * 37) % 256;
    const y = (i * 89) % 256;
    mctx.fillStyle = i % 2 === 0 ? '#9e9e9e' : '#646464';
    mctx.fillRect(x, y, 28, 1);
  }
  mctx.strokeStyle = '#383838';
  mctx.lineWidth = 2;
  mctx.strokeRect(2, 2, 252, 252);
  const brushedMetalBump = new THREE.CanvasTexture(metalCanvas);
  brushedMetalBump.wrapS = THREE.RepeatWrapping;
  brushedMetalBump.wrapT = THREE.RepeatWrapping;
  brushedMetalBump.repeat.set(3, 3);
  brushedMetalBump.anisotropy = maxAnisotropy;

  // 6. Architectural Skyscraper Facade Albedo + Emissive Window Grid (for Cyber Metropolis & Aether District)
  const facadeCanvas = document.createElement('canvas');
  facadeCanvas.width = 256;
  facadeCanvas.height = 512;
  const fctx = facadeCanvas.getContext('2d')!;
  fctx.fillStyle = '#0a101d';
  fctx.fillRect(0, 0, 256, 512);

  const emCanvas = document.createElement('canvas');
  emCanvas.width = 256;
  emCanvas.height = 512;
  const ectx = emCanvas.getContext('2d')!;
  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, 256, 512);

  for (let row = 0; row < 32; row++) {
    const y = row * 16 + 3;
    // Floor slab divider
    fctx.fillStyle = '#182438';
    fctx.fillRect(0, row * 16, 256, 3);
    for (let col = 0; col < 12; col++) {
      const x = col * 21 + 4;
      const hash = ((row * 31 + col * 17) * 2654435761) >>> 0;
      const lit = hash % 10 < 6;
      const warm = hash % 7 === 0;
      const magenta = hash % 11 === 0;
      fctx.fillStyle = lit ? '#1e3a5f' : '#0d1626';
      fctx.fillRect(x, y, 14, 10);
      if (lit) {
        ectx.fillStyle = magenta ? '#f472b6' : warm ? '#fde68a' : '#38bdf8';
        ectx.fillRect(x + 1, y + 1, 12, 8);
      }
    }
  }
  const towerFacadeAlbedo = new THREE.CanvasTexture(facadeCanvas);
  towerFacadeAlbedo.colorSpace = THREE.SRGBColorSpace;
  towerFacadeAlbedo.wrapS = THREE.RepeatWrapping;
  towerFacadeAlbedo.wrapT = THREE.RepeatWrapping;
  towerFacadeAlbedo.anisotropy = maxAnisotropy;

  const towerFacadeEmissive = new THREE.CanvasTexture(emCanvas);
  towerFacadeEmissive.colorSpace = THREE.SRGBColorSpace;
  towerFacadeEmissive.wrapS = THREE.RepeatWrapping;
  towerFacadeEmissive.wrapT = THREE.RepeatWrapping;
  towerFacadeEmissive.anisotropy = maxAnisotropy;

  // 7. Soft Radial Contact Shadow Disc
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d')!;
  const grad = sctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
  grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.34)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const contactShadow = new THREE.CanvasTexture(shadowCanvas);

  // 8. Holographic Screen Grid Texture
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
    floorRoughness,
    carbonWeaveAlbedo,
    brushedMetalBump,
    towerFacadeAlbedo,
    towerFacadeEmissive,
    contactShadow,
    holoGrid,
    dispose: () => {
      floorAlbedo.dispose();
      floorBump.dispose();
      floorRoughness.dispose();
      carbonWeaveAlbedo.dispose();
      brushedMetalBump.dispose();
      towerFacadeAlbedo.dispose();
      towerFacadeEmissive.dispose();
      contactShadow.dispose();
      holoGrid.dispose();
    },
  };
}
