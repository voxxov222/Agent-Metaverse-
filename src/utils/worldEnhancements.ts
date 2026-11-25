import type {
  EnvironmentTheme,
  ScreenMediaType,
  ScreenProceduralPreset,
  SkyboxConfig,
  SkyboxPresetId,
  WorldObjectMotion,
  WorldPropKind,
} from '../types/os';

export const ENVIRONMENT_THEME_OPTIONS: Array<{
  id: EnvironmentTheme;
  label: string;
  subtitle: string;
  tier: 'core' | 'hyper';
}> = [
  { id: 'command-center', label: 'Command Center', subtitle: 'Obsidian titanium deck & cyan shafts', tier: 'core' },
  { id: 'aether-district', label: 'Aether District', subtitle: 'Campus skyline & illuminated plazas', tier: 'core' },
  { id: 'cyber-metropolis', label: 'Cyber Metropolis', subtitle: 'Wet mirror asphalt & neon skyscrapers', tier: 'hyper' },
  { id: 'orbital-station', label: 'Orbital Station', subtitle: 'Zero-G ring deck & docked solar arrays', tier: 'hyper' },
  { id: 'alpine-observatory', label: 'Alpine Observatory', subtitle: 'Snow peaks, aurora sky & warm beacons', tier: 'hyper' },
  { id: 'bioluminescent-canyon', label: 'Bio-Lum Canyon', subtitle: 'Crystal gorges & drifting spores', tier: 'hyper' },
  { id: 'tech-office', label: 'Tech Office', subtitle: 'Architectural studio & glass partitions', tier: 'core' },
  { id: 'outdoor-world', label: 'Outdoor World', subtitle: 'Basalt terrain & atmospheric twilight', tier: 'core' },
  { id: 'neural-chamber', label: 'Neural Chamber', subtitle: 'Deep violet obsidian sanctuary', tier: 'core' },
  { id: 'holo-ops', label: 'Holo Ops Room', subtitle: 'Tactical emerald radar bunker', tier: 'core' },
];

export const SKYBOX_PRESETS: Record<Exclude<SkyboxPresetId, 'theme-auto'>, Omit<SkyboxConfig, 'enabled' | 'preset'>> = {
  'aether-twilight': {
    zenithColor: '#040a1a',
    horizonColor: '#123052',
    nadirColor: '#050811',
    sunColor: '#67e8f9',
    sunElevation: 11,
    sunAzimuth: 215,
    sunSize: 1.0,
    starDensity: 0.55,
    auroraIntensity: 0.42,
    cloudCoverage: 0.36,
    nebulaHue: 0.54,
    envIntensity: 1.05,
    exposure: 1.12,
  },
  'orbital-deep-space': {
    zenithColor: '#02030a',
    horizonColor: '#09152b',
    nadirColor: '#010206',
    sunColor: '#fde68a',
    sunElevation: 18,
    sunAzimuth: 140,
    sunSize: 1.25,
    starDensity: 0.96,
    auroraIntensity: 0.25,
    cloudCoverage: 0.04,
    nebulaHue: 0.68,
    envIntensity: 1.15,
    exposure: 1.18,
  },
  'aurora-horizon': {
    zenithColor: '#030b16',
    horizonColor: '#0d3b3e',
    nadirColor: '#050912',
    sunColor: '#a7f3d0',
    sunElevation: 4,
    sunAzimuth: 245,
    sunSize: 0.75,
    starDensity: 0.82,
    auroraIntensity: 0.95,
    cloudCoverage: 0.28,
    nebulaHue: 0.44,
    envIntensity: 1.1,
    exposure: 1.14,
  },
  'golden-canyon': {
    zenithColor: '#171d36',
    horizonColor: '#9a4d2c',
    nadirColor: '#1a0e0c',
    sunColor: '#fbbf24',
    sunElevation: 7,
    sunAzimuth: 205,
    sunSize: 1.65,
    starDensity: 0.22,
    auroraIntensity: 0.08,
    cloudCoverage: 0.52,
    nebulaHue: 0.08,
    envIntensity: 1.22,
    exposure: 1.1,
  },
  'cyber-neon-rain': {
    zenithColor: '#070414',
    horizonColor: '#3b0764',
    nadirColor: '#06030d',
    sunColor: '#f472b6',
    sunElevation: 6,
    sunAzimuth: 185,
    sunSize: 1.35,
    starDensity: 0.3,
    auroraIntensity: 0.65,
    cloudCoverage: 0.74,
    nebulaHue: 0.84,
    envIntensity: 1.28,
    exposure: 1.18,
  },
  'obsidian-studio': {
    zenithColor: '#060911',
    horizonColor: '#1a2334',
    nadirColor: '#03050a',
    sunColor: '#e2e8f0',
    sunElevation: 32,
    sunAzimuth: 160,
    sunSize: 0.85,
    starDensity: 0.12,
    auroraIntensity: 0.05,
    cloudCoverage: 0.14,
    nebulaHue: 0.58,
    envIntensity: 1.25,
    exposure: 1.08,
  },
};

export const DEFAULT_SKYBOX_CONFIG: SkyboxConfig = {
  enabled: false,
  preset: 'theme-auto',
  ...SKYBOX_PRESETS['aether-twilight'],
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Number(Math.max(min, Math.min(max, n)).toFixed(3));
}

function cleanHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : fallback;
}

export function getDefaultSkyboxForTheme(theme: EnvironmentTheme, timeOfDayHours: number): SkyboxConfig {
  if (theme === 'orbital-station') {
    return { enabled: true, preset: 'orbital-deep-space', ...SKYBOX_PRESETS['orbital-deep-space'] };
  }
  if (theme === 'alpine-observatory') {
    return { enabled: true, preset: 'aurora-horizon', ...SKYBOX_PRESETS['aurora-horizon'] };
  }
  if (theme === 'cyber-metropolis') {
    return { enabled: true, preset: 'cyber-neon-rain', ...SKYBOX_PRESETS['cyber-neon-rain'] };
  }
  if (theme === 'bioluminescent-canyon') {
    return {
      enabled: true,
      preset: 'aurora-horizon',
      ...SKYBOX_PRESETS['aurora-horizon'],
      zenithColor: '#050819',
      horizonColor: '#164e63',
      sunColor: '#e879f9',
      nebulaHue: 0.78,
      auroraIntensity: 0.72,
    };
  }
  if (theme === 'outdoor-world') {
    const isGolden = timeOfDayHours <= 9 || timeOfDayHours >= 17;
    const base = isGolden ? SKYBOX_PRESETS['golden-canyon'] : SKYBOX_PRESETS['aether-twilight'];
    return {
      enabled: true,
      preset: isGolden ? 'golden-canyon' : 'aether-twilight',
      ...base,
      sunElevation: Math.max(2, Math.min(48, Math.sin(((timeOfDayHours - 6) / 16) * Math.PI) * 42)),
    };
  }
  if (theme === 'aether-district') {
    return { enabled: true, preset: 'aether-twilight', ...SKYBOX_PRESETS['aether-twilight'] };
  }
  if (theme === 'neural-chamber') {
    return {
      enabled: true,
      preset: 'cyber-neon-rain',
      ...SKYBOX_PRESETS['cyber-neon-rain'],
      horizonColor: '#1e1b4b',
      cloudCoverage: 0.2,
      starDensity: 0.75,
    };
  }
  if (theme === 'tech-office') {
    return { enabled: true, preset: 'obsidian-studio', ...SKYBOX_PRESETS['obsidian-studio'] };
  }
  return { enabled: true, preset: 'aether-twilight', ...SKYBOX_PRESETS['aether-twilight'], cloudCoverage: 0.22 };
}

export function sanitizeSkyboxConfig(input: Partial<SkyboxConfig> | undefined | null): SkyboxConfig {
  const src = input ?? {};
  const validPreset: SkyboxPresetId =
    src.preset && (src.preset === 'theme-auto' || src.preset in SKYBOX_PRESETS) ? src.preset : 'theme-auto';
  const base =
    validPreset !== 'theme-auto' ? SKYBOX_PRESETS[validPreset] : SKYBOX_PRESETS['aether-twilight'];
  return {
    enabled: Boolean(src.enabled ?? false),
    preset: validPreset,
    zenithColor: cleanHex(src.zenithColor, base.zenithColor),
    horizonColor: cleanHex(src.horizonColor, base.horizonColor),
    nadirColor: cleanHex(src.nadirColor, base.nadirColor),
    sunColor: cleanHex(src.sunColor, base.sunColor),
    sunElevation: clampNum(src.sunElevation, -15, 75, base.sunElevation),
    sunAzimuth: clampNum(src.sunAzimuth, 0, 360, base.sunAzimuth),
    sunSize: clampNum(src.sunSize, 0.2, 3.0, base.sunSize),
    starDensity: clampNum(src.starDensity, 0, 1, base.starDensity),
    auroraIntensity: clampNum(src.auroraIntensity, 0, 1, base.auroraIntensity),
    cloudCoverage: clampNum(src.cloudCoverage, 0, 1, base.cloudCoverage),
    nebulaHue: clampNum(src.nebulaHue, 0, 1, base.nebulaHue),
    envIntensity: clampNum(src.envIntensity, 0.2, 2.2, base.envIntensity),
    exposure: clampNum(src.exposure, 0.6, 1.8, base.exposure),
  };
}

export const ALLOWED_PROP_KINDS = new Set<WorldPropKind>([
  'workstation-desk',
  'quantum-workstation',
  'mainframe-rack',
  'holo-terrain-table',
  'holo-hud-terminal',
  'arch-portal',
  'holo-kiosk',
  'relay-beacon',
  'data-monolith',
  'lounge-pod',
  'media-screen',
  'holo-billboard',
  'kinetic-sculpture',
  'quantum-crate',
]);

export const ALLOWED_MOTIONS = new Set<WorldObjectMotion>(['static', 'hover', 'orbit', 'patrol', 'spin']);
export const ALLOWED_MEDIA_TYPES = new Set<ScreenMediaType>(['procedural', 'image', 'gif', 'video']);
export const ALLOWED_SCREEN_PRESETS = new Set<ScreenProceduralPreset>([
  'virtual-os',
  'matrix',
  'waveform',
  'radar',
  'neural-pulse',
]);

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024; // 20 MB

const MIME_TO_EXT: Record<string, { ext: string; mediaType: ScreenMediaType }> = {
  'image/png': { ext: 'png', mediaType: 'image' },
  'image/jpeg': { ext: 'jpg', mediaType: 'image' },
  'image/jpg': { ext: 'jpg', mediaType: 'image' },
  'image/webp': { ext: 'webp', mediaType: 'image' },
  'image/gif': { ext: 'gif', mediaType: 'gif' },
  'video/mp4': { ext: 'mp4', mediaType: 'video' },
  'video/webm': { ext: 'webm', mediaType: 'video' },
};

export function validateMediaUpload(params: {
  mimeType: string;
  byteLength: number;
  originalName?: string;
}): {
  valid: boolean;
  ext?: string;
  mediaType?: ScreenMediaType;
  reason?: string;
} {
  const mime = params.mimeType.split(';')[0].trim().toLowerCase();
  const mapped = MIME_TO_EXT[mime];
  if (!mapped) {
    return {
      valid: false,
      reason: 'Unsupported media format. Upload PNG, JPG, WebP, GIF, MP4, or WebM.',
    };
  }
  if (!Number.isFinite(params.byteLength) || params.byteLength <= 0) {
    return { valid: false, reason: 'Uploaded file is empty.' };
  }
  if (params.byteLength > MAX_MEDIA_BYTES) {
    return { valid: false, reason: 'Media exceeds 20 MB upload limit.' };
  }
  return { valid: true, ext: mapped.ext, mediaType: mapped.mediaType };
}

export function sanitizeMediaUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^\/api\/media\/[a-zA-Z0-9._-]+$/.test(trimmed)) return trimmed;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(trimmed) && trimmed.length < 3_000_000) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed) && trimmed.length < 1024) return trimmed;
  return undefined;
}

export function computeObjectMotionTransform(
  motion: WorldObjectMotion | undefined,
  basePosition: [number, number, number],
  baseRotationY: number,
  elapsed: number,
  phaseOffset = 0,
): { x: number; y: number; z: number; rotationY: number } {
  const t = elapsed + phaseOffset;
  const bx = basePosition[0];
  const by = basePosition[1] ?? 0;
  const bz = basePosition[2];
  if (motion === 'hover') {
    return {
      x: bx,
      y: by + Math.sin(t * 2.1) * 0.24 + 0.24,
      z: bz,
      rotationY: baseRotationY + Math.sin(t * 0.8) * 0.08,
    };
  }
  if (motion === 'spin') {
    return {
      x: bx,
      y: by,
      z: bz,
      rotationY: baseRotationY + t * 0.85,
    };
  }
  if (motion === 'orbit') {
    const r = 1.65;
    return {
      x: bx + Math.cos(t * 0.9) * r,
      y: by + Math.sin(t * 2.0) * 0.14 + 0.14,
      z: bz + Math.sin(t * 0.9) * r,
      rotationY: -t * 0.9,
    };
  }
  if (motion === 'patrol') {
    const dx = Math.sin(t * 0.75) * 2.4;
    const facing = Math.cos(t * 0.75) >= 0 ? Math.PI / 2 : -Math.PI / 2;
    return {
      x: bx + dx,
      y: by,
      z: bz,
      rotationY: baseRotationY + facing,
    };
  }
  return { x: bx, y: by, z: bz, rotationY: baseRotationY };
}
