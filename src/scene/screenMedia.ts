import * as THREE from 'three';
import type { ScreenMediaType, ScreenProceduralPreset } from '../types/os';

interface ManagedScreenEntry {
  key: string;
  mediaType: ScreenMediaType;
  preset: ScreenProceduralPreset;
  accentColor: string;
  label: string;
  texture: THREE.Texture;
  canvas?: HTMLCanvasElement;
  ctx?: CanvasRenderingContext2D;
  video?: HTMLVideoElement;
  gifFrames?: Array<{ bitmap: ImageBitmap; durationMs: number }>;
  gifIndex: number;
  gifElapsedMs: number;
  lastDrawTime: number;
  disposed: boolean;
}

function makeScreenKey(
  id: string,
  mediaType: ScreenMediaType,
  mediaUrl: string | undefined,
  preset: ScreenProceduralPreset,
  color: string,
  label: string,
): string {
  return `${id}|${mediaType}|${mediaUrl || ''}|${preset}|${color}|${label}`;
}

export class AnimatedScreenManager {
  private entries = new Map<string, ManagedScreenEntry>();
  private maxAnisotropy: number;
  private isSoftwareGl: boolean;
  private loader = new THREE.TextureLoader();

  constructor(maxAnisotropy: number, isSoftwareGl: boolean) {
    this.maxAnisotropy = maxAnisotropy;
    this.isSoftwareGl = isSoftwareGl;
  }

  public getTexture(params: {
    objectId: string;
    label: string;
    color: string;
    mediaType?: ScreenMediaType;
    mediaUrl?: string;
    screenPreset?: ScreenProceduralPreset;
  }): THREE.Texture {
    const mediaType: ScreenMediaType = params.mediaType ?? 'procedural';
    const preset: ScreenProceduralPreset = params.screenPreset ?? 'waveform';
    const key = makeScreenKey(params.objectId, mediaType, params.mediaUrl, preset, params.color, params.label);
    const existing = this.entries.get(params.objectId);
    if (existing && existing.key === key) {
      return existing.texture;
    }
    if (existing) {
      this.disposeEntry(existing);
    }

    if (mediaType === 'video' && params.mediaUrl) {
      const video = document.createElement('video');
      video.src = params.mediaUrl;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.autoplay = true;
      void video.play().catch(() => {
        // Autoplay may resolve once user interacts
      });

      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;

      const entry: ManagedScreenEntry = {
        key,
        mediaType,
        preset,
        accentColor: params.color,
        label: params.label,
        texture: tex,
        video,
        gifIndex: 0,
        gifElapsedMs: 0,
        lastDrawTime: -1,
        disposed: false,
      };
      this.entries.set(params.objectId, entry);
      return tex;
    }

    if (mediaType === 'image' && params.mediaUrl) {
      const tex = this.loader.load(params.mediaUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.maxAnisotropy;
      const entry: ManagedScreenEntry = {
        key,
        mediaType,
        preset,
        accentColor: params.color,
        label: params.label,
        texture: tex,
        gifIndex: 0,
        gifElapsedMs: 0,
        lastDrawTime: -1,
        disposed: false,
      };
      this.entries.set(params.objectId, entry);
      return tex;
    }

    // Canvas-backed texture for 'gif' (animated frame decoder) & 'procedural' (live shaders)
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 288;
    const ctx = canvas.getContext('2d')!;
    this.drawProceduralFrame(ctx, preset, params.color, params.label, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAnisotropy;

    const entry: ManagedScreenEntry = {
      key,
      mediaType,
      preset,
      accentColor: params.color,
      label: params.label,
      texture: tex,
      canvas,
      ctx,
      gifIndex: 0,
      gifElapsedMs: 0,
      lastDrawTime: -1,
      disposed: false,
    };
    this.entries.set(params.objectId, entry);

    if (mediaType === 'gif' && params.mediaUrl) {
      void this.loadAnimatedGif(entry, params.mediaUrl);
    }

    return tex;
  }

  private async loadAnimatedGif(entry: ManagedScreenEntry, url: string) {
    try {
      const resp = await fetch(url);
      if (!resp.ok || entry.disposed) return;
      const ImageDecoderCtor = (window as unknown as { ImageDecoder?: any }).ImageDecoder;
      if (ImageDecoderCtor && resp.body) {
        const buffer = await resp.arrayBuffer();
        if (entry.disposed) return;
        const decoder = new ImageDecoderCtor({ data: buffer, type: 'image/gif' });
        await decoder.tracks.ready;
        const frameCount = Math.min(120, decoder.tracks.selectedTrack?.frameCount ?? 1);
        const frames: Array<{ bitmap: ImageBitmap; durationMs: number }> = [];
        for (let i = 0; i < frameCount; i++) {
          if (entry.disposed) break;
          const decoded = await decoder.decode({ frameIndex: i });
          const bitmap = await createImageBitmap(decoded.image);
          const durationMs = Math.max(25, Math.round((decoded.image.duration ?? 80_000) / 1000));
          decoded.image.close?.();
          frames.push({ bitmap, durationMs });
        }
        decoder.close?.();
        if (!entry.disposed && frames.length > 0) {
          entry.gifFrames = frames;
          entry.ctx?.clearRect(0, 0, 512, 288);
          entry.ctx?.drawImage(frames[0].bitmap, 0, 0, 512, 288);
          entry.texture.needsUpdate = true;
          return;
        }
      }
      // Fallback: static image draw onto CanvasTexture if ImageDecoder unavailable
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (entry.disposed || !entry.ctx) return;
        entry.ctx.drawImage(img, 0, 0, 512, 288);
        entry.texture.needsUpdate = true;
      };
      img.src = url;
    } catch {
      // Retain procedural fallback if GIF fails to load
    }
  }

  private drawProceduralFrame(
    ctx: CanvasRenderingContext2D,
    preset: ScreenProceduralPreset,
    accentHex: string,
    label: string,
    t: number,
  ) {
    const w = 512;
    const h = 288;

    ctx.fillStyle = '#060c18';
    ctx.fillRect(0, 0, w, h);

    // Grid backdrop
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (preset === 'maya-os') {
      // Maya AI HUD rendered live onto Admin's 3D Main Computer screen
      ctx.fillStyle = '#05050a';
      ctx.fillRect(0, 0, w, h);

      // Sweeping cyan aura & glowing frame
      const sweep = ctx.createLinearGradient(0, 0, w, h);
      sweep.addColorStop(0, 'rgba(0, 90, 150, 0.22)');
      sweep.addColorStop(0.5, 'rgba(0, 170, 220, 0.14)');
      sweep.addColorStop(1, 'rgba(10, 20, 50, 0.22)');
      ctx.fillStyle = sweep;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#00c8ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, w - 8, h - 8);

      // Left Panel: SYSTEM METRICS
      ctx.fillStyle = 'rgba(10, 14, 34, 0.86)';
      ctx.fillRect(12, 12, 118, h - 24);
      ctx.strokeStyle = 'rgba(0, 180, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(12, 12, 118, h - 24);
      ctx.fillStyle = '#00c8ff';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('SYSTEM METRICS', 20, 28);

      const sysItems = [
        { k: 'CPU', v: 18 + Math.round(Math.sin(t * 1.4) * 7), u: '%', c: '#00ff64' },
        { k: 'RAM', v: 64 + Math.round(Math.cos(t * 0.7) * 4), u: '%', c: '#ffc800' },
        { k: 'TEMP', v: 46 + Math.round(Math.sin(t * 0.9) * 3), u: 'C', c: '#00ff64' },
        { k: 'GPU', v: 24 + Math.round(Math.sin(t * 2.1) * 14), u: '%', c: '#00ff64' },
        { k: 'DISK', v: 56, u: '%', c: '#ffc800' },
      ];
      sysItems.forEach((m, idx) => {
        const y0 = 44 + idx * 44;
        ctx.fillStyle = '#96c8ff';
        ctx.font = '8px monospace';
        ctx.fillText(m.k, 20, y0);
        ctx.fillStyle = m.c;
        ctx.font = 'bold 14px monospace';
        ctx.fillText(`${m.v}${m.u}`, 20, y0 + 16);
        ctx.fillStyle = '#141428';
        ctx.fillRect(20, y0 + 22, 100, 4);
        ctx.fillStyle = m.c;
        ctx.fillRect(20, y0 + 22, Math.max(4, Math.min(100, m.v)), 4);
      });

      // Center MAYA Plasma Orb & Waveform
      const cx = w * 0.5;
      const cy = h * 0.44;
      const pulseR = 54 + Math.sin(t * 3.1) * 6;
      const orbGlow = ctx.createRadialGradient(cx, cy, 8, cx, cy, pulseR * 1.35);
      orbGlow.addColorStop(0, 'rgba(130, 180, 255, 0.95)');
      orbGlow.addColorStop(0.4, 'rgba(80, 120, 255, 0.55)');
      orbGlow.addColorStop(0.75, 'rgba(0, 210, 255, 0.25)');
      orbGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = orbGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, pulseR * 1.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(180, 240, 255, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, pulseR * 0.95, pulseR * 0.72, t * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, pulseR * 0.72, pulseR * 0.98, -t * 0.8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MAYA', cx, cy + 5);
      ctx.textAlign = 'left';

      // Bottom Mic Wave
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 142; x <= 370; x += 6) {
        const edge = Math.sin(((x - 142) / 228) * Math.PI);
        const wy = h - 22 - Math.abs(Math.sin(x * 0.08 + t * 5.2)) * 18 * edge;
        if (x === 142) ctx.moveTo(x, wy);
        else ctx.lineTo(x, wy);
      }
      ctx.stroke();

      // Right Panel: AI STATUS
      ctx.fillStyle = 'rgba(10, 14, 34, 0.86)';
      ctx.fillRect(w - 130, 12, 118, h - 24);
      ctx.strokeStyle = 'rgba(0, 255, 136, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(w - 130, 12, 118, h - 24);
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('AI STATUS', w - 102, 28);
      ctx.strokeStyle = '#00ffff';
      ctx.strokeRect(w - 122, 42, 102, 28);
      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(new Date().toTimeString().slice(0, 8), w - 106, 61);
      ctx.fillStyle = '#00ff64';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('● MAYA ONLINE', w - 114, 96);
      ctx.fillStyle = '#ffaa00';
      ctx.font = '8px monospace';
      ctx.fillText('PERF: OPTIMAL', w - 114, 122);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('ADMIN HOST LOCKED', w - 118, 146);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('ADMIN WORKSTATION', w - 118, h - 20);
    } else if (preset === 'jarvis-core') {
      // JARVIS Mark-VII Arc Reactor & Command Telemetry Screen
      const cx = w * 0.34;
      const cy = h * 0.56;
      const rings = [86, 68, 50, 32];
      rings.forEach((r, idx) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(idx % 2 === 0 ? t * (0.45 + idx * 0.12) : -t * (0.38 + idx * 0.14));
        ctx.strokeStyle = idx === 1 ? '#64ffda' : '#00d2ff';
        ctx.lineWidth = idx === 0 ? 3.5 : 2;
        ctx.setLineDash(idx % 2 === 0 ? [16, 10] : [8, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
      ctx.setLineDash([]);
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 38);
      grad.addColorStop(0, '#e0f2fe');
      grad.addColorStop(0.4, '#00d2ff');
      grad.addColorStop(1, 'rgba(0, 210, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 38, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#071427';
      ctx.fillRect(w * 0.62, 46, 180, 224);
      ctx.strokeStyle = 'rgba(0, 210, 255, 0.55)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(w * 0.62, 46, 180, 224);

      ctx.fillStyle = '#00d2ff';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('JARVIS // OPS HUD', w * 0.62 + 12, 68);
      const metrics = [
        ['ARC CORE', 0.92],
        ['NEURAL SWARM', 0.68 + 0.2 * Math.sin(t * 2)],
        ['NET MESH', 0.84],
        ['CAD FIELD', 0.55 + 0.3 * Math.cos(t * 1.7)],
      ] as const;
      metrics.forEach(([name, pct], idx) => {
        const by = 88 + idx * 42;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.fillText(name, w * 0.62 + 12, by);
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(w * 0.62 + 12, by + 6, 156, 8);
        ctx.fillStyle = idx === 1 ? '#64ffda' : '#00d2ff';
        ctx.fillRect(w * 0.62 + 12, by + 6, Math.round(156 * Math.min(1, Math.max(0.1, pct))), 8);
      });
    } else if (preset === 'virtual-os') {
      // Virtual OS Desktop: window manager, live terminal shell, file tree, and CPU/RAM graphs
      ctx.fillStyle = 'rgba(10, 18, 36, 0.92)';
      ctx.fillRect(10, 44, 138, 204);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 44, 138, 204);

      ctx.fillStyle = accentHex;
      ctx.font = 'bold 11px monospace';
      ctx.fillText('VFS /KERNEL', 18, 62);
      const files = ['boot.sys', 'kernel_bus.ts', 'neural.mesh', 'vault.enc', 'agents.cfg', 'physics.sim', 'halo_hud.ui'];
      ctx.font = '10px monospace';
      files.forEach((f, idx) => {
        const active = Math.floor(t * 0.9) % files.length === idx;
        if (active) {
          ctx.fillStyle = 'rgba(34, 211, 238, 0.22)';
          ctx.fillRect(14, 72 + idx * 23, 130, 18);
        }
        ctx.fillStyle = active ? '#e0f2fe' : '#94a3b8';
        ctx.fillText(`> ${f}`, 18, 84 + idx * 23);
      });

      // Terminal Window
      ctx.fillStyle = 'rgba(6, 11, 24, 0.94)';
      ctx.fillRect(156, 44, 218, 128);
      ctx.strokeStyle = accentHex;
      ctx.strokeRect(156, 44, 218, 128);
      ctx.fillStyle = 'rgba(34, 211, 238, 0.18)';
      ctx.fillRect(156, 44, 218, 18);
      ctx.fillStyle = '#e0f2fe';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('TTY0 // AGENT KERNEL SHELL', 164, 57);

      const logs = [
        '$ vca-ctl status --core',
        'CORE: SINGULARITY ONLINE',
        'CANNON: 60Hz RIGID-BODY OK',
        'MEM: 14.2GB / 32GB SYNCED',
        `EXEC_TICK: ${Math.floor(t * 100)}ms`,
      ];
      ctx.font = '10px monospace';
      logs.forEach((line, i) => {
        ctx.fillStyle = i === 1 || i === 2 ? '#34d399' : '#bae6fd';
        ctx.fillText(line, 164, 78 + i * 17);
      });
      if (Math.floor(t * 2.5) % 2 === 0) {
        ctx.fillStyle = accentHex;
        ctx.fillRect(164, 156, 7, 10);
      }

      // Telemetry Graph Window
      ctx.fillStyle = 'rgba(8, 15, 32, 0.94)';
      ctx.fillRect(156, 180, 344, 68);
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.55)';
      ctx.strokeRect(156, 180, 344, 68);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= 324; x += 9) {
        const py = 216 + Math.sin(x * 0.05 + t * 4.2) * 16 + Math.cos(x * 0.11 - t * 2.1) * 7;
        if (x === 0) ctx.moveTo(166 + x, py);
        else ctx.lineTo(166 + x, py);
      }
      ctx.stroke();

      // Right mini CPU/GPU bars
      ctx.fillStyle = 'rgba(10, 18, 36, 0.94)';
      ctx.fillRect(382, 44, 118, 128);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(382, 44, 118, 128);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('COMPUTE CORES', 390, 60);
      for (let c = 0; c < 4; c++) {
        const pct = 0.38 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.8 + c * 1.4));
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(390, 72 + c * 22, 100, 10);
        ctx.fillStyle = c % 2 === 0 ? accentHex : '#a855f7';
        ctx.fillRect(390, 72 + c * 22, Math.round(100 * pct), 10);
      }

      // OS Taskbar Dock
      ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
      ctx.fillRect(10, 256, w - 20, 22);
      ctx.fillStyle = accentHex;
      ctx.fillRect(16, 260, 44, 14);
      ctx.fillStyle = '#04101f';
      ctx.font = 'bold 10px monospace';
      ctx.fillText('VCA OS', 20, 270);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('NODES: 240  |  SIM: ACTIVE  |  HALO READY', 72, 270);
    } else if (preset === 'matrix') {
      ctx.font = '13px monospace';
      for (let col = 0; col < 26; col++) {
        const x = 14 + col * 19;
        const speed = 42 + (col % 5) * 18;
        const headY = ((t * speed + col * 57) % (h + 90)) - 45;
        for (let row = 0; row < 7; row++) {
          const y = headY - row * 16;
          if (y < 24 || y > h - 10) continue;
          ctx.fillStyle = row === 0 ? '#e0f2fe' : accentHex;
          ctx.globalAlpha = Math.max(0.12, 1 - row * 0.15);
          const ch = ((col * 13 + row * 7 + Math.floor(t * 6)) % 16).toString(16).toUpperCase();
          ctx.fillText(ch, x, y);
        }
      }
      ctx.globalAlpha = 1;
    } else if (preset === 'radar') {
      const cx = w * 0.5;
      const cy = h * 0.54;
      const maxR = 98;
      ctx.strokeStyle = accentHex;
      ctx.globalAlpha = 0.45;
      for (const r of [32, 64, maxR]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const sweep = t * 1.9;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = accentHex;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, sweep - 0.55, sweep);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        const ang = i * 1.45 + 0.3;
        const rr = 30 + i * 18;
        const bx = cx + Math.cos(ang) * rr;
        const by = cy + Math.sin(ang) * rr;
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(bx, by, 3.5 + Math.sin(t * 4 + i) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (preset === 'neural-pulse') {
      const nodes: Array<[number, number]> = [];
      for (let l = 0; l < 4; l++) {
        for (let n = 0; n < 4; n++) {
          nodes.push([95 + l * 108, 68 + n * 52]);
        }
      }
      ctx.lineWidth = 1.4;
      for (let l = 0; l < 3; l++) {
        for (let a = 0; a < 4; a++) {
          for (let b = 0; b < 4; b++) {
            const n1 = nodes[l * 4 + a];
            const n2 = nodes[(l + 1) * 4 + b];
            const pulse = 0.2 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.5 - l * 0.9 + a * 0.7));
            ctx.strokeStyle = accentHex;
            ctx.globalAlpha = pulse * 0.55;
            ctx.beginPath();
            ctx.moveTo(n1[0], n1[1]);
            ctx.lineTo(n2[0], n2[1]);
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
      nodes.forEach(([nx, ny], idx) => {
        const glow = 0.5 + 0.5 * Math.sin(t * 4 + idx * 0.6);
        ctx.fillStyle = glow > 0.7 ? '#f8fafc' : accentHex;
        ctx.beginPath();
        ctx.arc(nx, ny, 4 + glow * 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    } else {
      // waveform + spectrum bars
      ctx.fillStyle = accentHex;
      for (let i = 0; i < 24; i++) {
        const bh = 18 + Math.abs(Math.sin(t * 3.4 + i * 0.45)) * 75;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(28 + i * 19, h - 26 - bh, 12, bh);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 20; x <= w - 20; x += 6) {
        const y =
          h * 0.52 +
          Math.sin(x * 0.032 + t * 4.2) * 32 +
          Math.cos(x * 0.075 - t * 2.8) * 14;
        if (x === 20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Header HUD strip + animated scanline
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 33, w, 2);
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(label.slice(0, 32).toUpperCase(), 14, 22);
    ctx.font = '11px monospace';
    ctx.fillStyle = accentHex;
    ctx.fillText(`LIVE · ${preset.toUpperCase()}`, w - 148, 21);

    const scanY = (t * 95) % h;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(0, scanY, w, 4);
  }

  public update(elapsed: number, delta: number, activeObjectIds: Set<string>) {
    // Prune deleted object screens cleanly
    for (const [objId, entry] of this.entries.entries()) {
      if (!activeObjectIds.has(objId)) {
        this.disposeEntry(entry);
        this.entries.delete(objId);
      }
    }

    const minFrameGap = this.isSoftwareGl ? 0.14 : 0.04;
    for (const entry of this.entries.values()) {
      if (entry.mediaType === 'gif' && entry.gifFrames && entry.gifFrames.length > 1 && entry.ctx) {
        entry.gifElapsedMs += delta * 1000;
        const cur = entry.gifFrames[entry.gifIndex];
        if (entry.gifElapsedMs >= cur.durationMs) {
          entry.gifElapsedMs %= cur.durationMs;
          entry.gifIndex = (entry.gifIndex + 1) % entry.gifFrames.length;
          entry.ctx.clearRect(0, 0, 512, 288);
          entry.ctx.drawImage(entry.gifFrames[entry.gifIndex].bitmap, 0, 0, 512, 288);
          entry.texture.needsUpdate = true;
        }
      } else if (entry.mediaType === 'procedural' && entry.ctx) {
        if (elapsed - entry.lastDrawTime >= minFrameGap) {
          entry.lastDrawTime = elapsed;
          this.drawProceduralFrame(entry.ctx, entry.preset, entry.accentColor, entry.label, elapsed);
          entry.texture.needsUpdate = true;
        }
      }
    }
  }

  private disposeEntry(entry: ManagedScreenEntry) {
    entry.disposed = true;
    entry.texture.dispose();
    if (entry.video) {
      entry.video.pause();
      entry.video.removeAttribute('src');
      entry.video.load();
    }
    if (entry.gifFrames) {
      entry.gifFrames.forEach((f) => f.bitmap.close?.());
    }
  }

  public dispose() {
    for (const entry of this.entries.values()) {
      this.disposeEntry(entry);
    }
    this.entries.clear();
  }
}
