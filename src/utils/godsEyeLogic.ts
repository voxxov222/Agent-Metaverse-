export type OpticalPresetId = 'normal' | 'nvg' | 'flir' | 'crt' | 'noir';

export interface OpticalPresetSpec {
  id: OpticalPresetId;
  label: string;
  shortLabel: string;
  badgeColor: string;
  cssFilter: string;
  tintOverlay: string;
  scanlineOpacity: number;
  reticleColor: string;
  coastColor: number;
  cableColor: number;
  globeTint: number;
}

export const OPTICAL_PRESETS: Record<OpticalPresetId, OpticalPresetSpec> = {
  normal: {
    id: 'normal',
    label: 'EO / OPTICAL',
    shortLabel: 'NORMAL',
    badgeColor: '#00c8ff',
    cssFilter: 'contrast(1.06) saturate(1.1)',
    tintOverlay: 'rgba(0, 120, 255, 0.0)',
    scanlineOpacity: 0.06,
    reticleColor: '#00e5ff',
    coastColor: 0x38bdf8,
    cableColor: 0x0ea5e9,
    globeTint: 0x071327,
  },
  nvg: {
    id: 'nvg',
    label: 'NVG GEN-III',
    shortLabel: 'NVG',
    badgeColor: '#22ff66',
    cssFilter: 'grayscale(1) sepia(1) hue-rotate(68deg) saturate(3.2) contrast(1.32) brightness(1.04)',
    tintOverlay: 'rgba(16, 185, 72, 0.12)',
    scanlineOpacity: 0.22,
    reticleColor: '#4ade80',
    coastColor: 0x4ade80,
    cableColor: 0x22c55e,
    globeTint: 0x04190c,
  },
  flir: {
    id: 'flir',
    label: 'FLIR THERMAL',
    shortLabel: 'FLIR',
    badgeColor: '#ff7b29',
    cssFilter: 'grayscale(1) sepia(1) hue-rotate(-26deg) saturate(4.2) contrast(1.42)',
    tintOverlay: 'rgba(255, 84, 0, 0.1)',
    scanlineOpacity: 0.14,
    reticleColor: '#fb923c',
    coastColor: 0xfb923c,
    cableColor: 0xf43f5e,
    globeTint: 0x1c0711,
  },
  crt: {
    id: 'crt',
    label: 'CRT PHOSPHOR',
    shortLabel: 'CRT',
    badgeColor: '#facc15',
    cssFilter: 'contrast(1.26) saturate(1.35) brightness(0.96)',
    tintOverlay: 'rgba(250, 204, 21, 0.07)',
    scanlineOpacity: 0.34,
    reticleColor: '#fde047',
    coastColor: 0xfacc15,
    cableColor: 0x22d3ee,
    globeTint: 0x0d1117,
  },
  noir: {
    id: 'noir',
    label: 'RECON NOIR',
    shortLabel: 'NOIR',
    badgeColor: '#e2e8f0',
    cssFilter: 'grayscale(1) contrast(1.55) brightness(0.95)',
    tintOverlay: 'rgba(255, 255, 255, 0.03)',
    scanlineOpacity: 0.18,
    reticleColor: '#f8fafc',
    coastColor: 0xe2e8f0,
    cableColor: 0x94a3b8,
    globeTint: 0x090b10,
  },
};

export interface GeoEarthquake {
  id: string;
  mag: number;
  place: string;
  lat: number;
  lon: number;
  depthKm: number;
  time: number;
  tsunami: boolean;
}

export interface GeoFlight {
  id: string;
  callsign: string;
  lat: number;
  lon: number;
  altFt: number;
  speedKts: number;
  heading: number;
  aircraftType: string;
}

export interface GeoSatellite {
  id: string;
  name: string;
  noradId: number;
  lat: number;
  lon: number;
  altKm: number;
  velocityKmh: number;
  inclinationDeg: number;
  category: 'station' | 'recon' | 'comms';
}

export interface GeoWeather {
  lat: number;
  lon: number;
  temperatureC: number | null;
  windKmh: number | null;
  cloudCoverPct: number | null;
  condition: string;
}

export interface GeoFeedStatus {
  earthquakes: 'live' | 'cached' | 'unavailable';
  flights: 'live' | 'cached' | 'unavailable';
  satellites: 'live' | 'cached' | 'unavailable';
  weather: 'live' | 'cached' | 'unavailable';
}

export interface GeoSnapshot {
  updatedAt: number;
  earthquakes: GeoEarthquake[];
  flights: GeoFlight[];
  satellites: GeoSatellite[];
  weather: GeoWeather | null;
  feedStatus: GeoFeedStatus;
}

export interface GeoPlace {
  name: string;
  lat: number;
  lon: number;
  scalerank?: number;
  rankMax?: number;
  country?: string;
  source?: 'local' | 'nominatim' | 'coords';
}

export interface GeoCountryPolygon {
  name: string;
  iso2: string;
  rings: number[][][];
}

export interface GeoCable {
  id: string;
  name: string;
  color: string;
  lines: number[][][];
}

export interface GeoDatacenter {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lon: number;
}

export interface GeoSelectedTarget {
  kind: 'earthquake' | 'flight' | 'satellite' | 'datacenter' | 'place' | 'point';
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
  altLabel?: string;
  details: string[];
}

export const GLOBE_RADIUS = 10;

/**
 * Converts geodetic latitude/longitude (degrees) + altitude (km) to Three.js right-handed XYZ.
 * +Y is North Pole, +X is lon 0° (Prime Meridian) or standard Three.js spherical mapping:
 * With lon = 0 at +X, East = -Z, West = +Z? Let's keep standard Cesium/Three.js match:
 * phi = (90 - lat) deg, theta = (lon + 180) deg:
 * x = -R * sin(phi) * cos(theta)
 * y =  R * cos(phi)
 * z =  R * sin(phi) * sin(theta)
 * Check: lon=0, lat=0 -> phi=90°, theta=180° -> sin(phi)=1, cos(theta)=-1 -> x=+R, y=0, z=0.
 * Check: lon=90°E, lat=0 -> theta=270° -> cos(theta)=0, sin(theta)=-1 -> x=0, y=0, z=-R.
 * Rotating right (+East) from lon=0 toward -Z matches standard right-handed Earth rotation!
 */
export function latLonAltToCartesian(
  latDeg: number,
  lonDeg: number,
  altKm = 0,
  globeRadius = GLOBE_RADIUS,
): { x: number; y: number; z: number } {
  const r = globeRadius + (altKm / 6371) * globeRadius;
  const phi = ((90 - latDeg) * Math.PI) / 180;
  const theta = ((lonDeg + 180) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  return {
    x: -r * sinPhi * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * sinPhi * Math.sin(theta),
  };
}

/**
 * Inverse of latLonAltToCartesian for any surface or near-surface vector.
 */
export function cartesianToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r < 1e-6) return { lat: 0, lon: 0 };
  const clampedY = Math.max(-1, Math.min(1, y / r));
  const lat = 90 - (Math.acos(clampedY) * 180) / Math.PI;
  // Since x = -r sin(phi) cos(theta), z = r sin(phi) sin(theta), theta = atan2(z, -x)
  const thetaDeg = (Math.atan2(z, -x) * 180) / Math.PI;
  let lon = thetaDeg - 180;
  while (lon <= -180) lon += 360;
  while (lon > 180) lon -= 360;
  return {
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
  };
}

export function formatLatLonDms(lat: number, lon: number): { latStr: string; lonStr: string } {
  const fmt = (val: number, posHem: string, negHem: string) => {
    const hem = val >= 0 ? posHem : negHem;
    const abs = Math.abs(val);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = Math.round((mFloat - m) * 60);
    return `${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}'${String(s === 60 ? 59 : s).padStart(2, '0')}"${hem}`;
  };
  return {
    latStr: fmt(lat, 'N', 'S'),
    lonStr: fmt(lon, 'E', 'W'),
  };
}

/**
 * Parses decimal coordinate pairs (`37.7749, -122.4194`) or `geo:37.7749,-122.4194`.
 */
export function parseGeoQuery(raw: string): { lat: number; lon: number } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const geoMatch = trimmed.match(/^geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (geoMatch) {
    const lat = Number(geoMatch[1]);
    const lon = Number(geoMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  const pairMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (pairMatch) {
    const lat = Number(pairMatch[1]);
    const lon = Number(pairMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  return null;
}

export function buildGeoReconPrompt(target: GeoSelectedTarget, weather: GeoWeather | null, agentFirstName?: string): string {
  const prefix = agentFirstName ? `@${agentFirstName} ` : '';
  const weatherLine = weather
    ? ` Local WX: ${weather.temperatureC ?? '--'}°C, wind ${weather.windKmh ?? '--'} km/h, cloud ${weather.cloudCoverPct ?? '--'}% (${weather.condition}).`
    : '';
  const detailsStr = target.details.slice(0, 3).join('; ');
  return `${prefix}God's Eye geospatial recon brief at ${target.lat.toFixed(3)}, ${target.lon.toFixed(3)} — [${target.kind.toUpperCase()}] ${target.title} (${target.subtitle}). ${detailsStr}.${weatherLine} Assess strategic/infrastructure impact and recommended monitoring actions.`;
}
