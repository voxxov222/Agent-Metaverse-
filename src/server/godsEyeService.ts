import fs from 'fs';
import path from 'path';
import {
  parseGeoQuery,
  type GeoEarthquake,
  type GeoFeedStatus,
  type GeoFlight,
  type GeoPlace,
  type GeoSatellite,
  type GeoSnapshot,
  type GeoWeather,
} from '../utils/godsEyeLogic';

interface CachedEntry<T> {
  value: T;
  fetchedAt: number;
}

const FEED_TTL_MS = 60_000;
const WEATHER_TTL_MS = 180_000;

let eqCache: CachedEntry<GeoEarthquake[]> | null = null;
let flightCache: CachedEntry<GeoFlight[]> | null = null;
let satCache: CachedEntry<GeoSatellite[]> | null = null;
const weatherCache = new Map<string, CachedEntry<GeoWeather>>();
let localPlacesCache: GeoPlace[] | null = null;

async function fetchJsonWithTimeout(url: string, timeoutMs = 4200, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'VCALABS-GodsEye/1.0 (admin-workstation)',
        ...headers,
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeUsgsEarthquakes(geojson: unknown, limit = 60): GeoEarthquake[] {
  const features = (geojson as { features?: Array<Record<string, unknown>> })?.features;
  if (!Array.isArray(features)) return [];
  const items: GeoEarthquake[] = [];
  for (const feat of features) {
    const props = (feat?.properties ?? {}) as Record<string, unknown>;
    const coords = ((feat?.geometry as { coordinates?: number[] })?.coordinates ?? []) as number[];
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const depthKm = Number(coords[2] ?? 0);
    const mag = Number(props.mag ?? 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mag)) continue;
    items.push({
      id: String(feat.id ?? `eq-${items.length}`),
      mag: Number(mag.toFixed(1)),
      place: String(props.place || 'Seismic Event'),
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      depthKm: Number(Math.max(0, depthKm).toFixed(1)),
      time: Number(props.time ?? Date.now()),
      tsunami: Boolean(props.tsunami),
    });
    if (items.length >= limit) break;
  }
  return items.sort((a, b) => b.mag - a.mag);
}

export function normalizeAdsbFlights(payload: unknown, limit = 90): GeoFlight[] {
  const acList = (payload as { ac?: Array<Record<string, unknown>> })?.ac;
  if (!Array.isArray(acList)) return [];
  const out: GeoFlight[] = [];
  for (const ac of acList) {
    const lat = Number(ac.lat);
    const lon = Number(ac.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const altNum = typeof ac.alt_baro === 'number' ? ac.alt_baro : Number(ac.alt_geom ?? 28000);
    out.push({
      id: String(ac.hex || ac.r || `ac-${out.length}`),
      callsign: String(ac.flight || ac.r || ac.hex || 'TACTICAL').trim(),
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      altFt: Number.isFinite(altNum) ? Math.round(altNum) : 28000,
      speedKts: Math.round(Number(ac.gs ?? 410)),
      heading: Math.round(Number(ac.track ?? 0)),
      aircraftType: String(ac.t || ac.category || 'MIL'),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function computeOrbitalPositionFromElements(
  noradId: number,
  name: string,
  inclinationDeg: number,
  raanDeg: number,
  periodMin: number,
  altKm: number,
  nowMs: number,
  category: GeoSatellite['category'] = 'recon',
): GeoSatellite {
  const tSec = nowMs / 1000;
  const periodSec = Math.max(85, periodMin) * 60;
  const argLatRad = ((tSec / periodSec) * Math.PI * 2 + (noradId % 360) * (Math.PI / 180)) % (Math.PI * 2);
  const incRad = (inclinationDeg * Math.PI) / 180;
  const latRad = Math.asin(Math.sin(incRad) * Math.sin(argLatRad));
  const earthRotDegPerSec = 360 / 86164;
  const lonRadOffset = Math.atan2(Math.cos(incRad) * Math.sin(argLatRad), Math.cos(argLatRad));
  let lonDeg = ((raanDeg + (lonRadOffset * 180) / Math.PI - tSec * earthRotDegPerSec) % 360 + 540) % 360 - 180;
  if (lonDeg <= -180) lonDeg += 360;
  const latDeg = (latRad * 180) / Math.PI;
  const velocityKmh = Math.round(27600 * Math.sqrt(6778 / (6371 + altKm)));
  return {
    id: `sat-${noradId}`,
    name,
    noradId,
    lat: Number(latDeg.toFixed(4)),
    lon: Number(lonDeg.toFixed(4)),
    altKm: Math.round(altKm),
    velocityKmh,
    inclinationDeg: Number(inclinationDeg.toFixed(1)),
    category,
  };
}

function describeWeatherCode(code: number): string {
  if (code === 0) return 'Clear Sky';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 48) return 'Fog / Haze';
  if (code <= 67) return 'Rain / Precipitation';
  if (code <= 77) return 'Snow / Ice';
  if (code <= 82) return 'Rain Showers';
  return 'Storm Activity';
}

export function loadLocalPlaces(): GeoPlace[] {
  if (localPlacesCache) return localPlacesCache;
  try {
    const filePath = path.resolve(process.cwd(), 'public/data/geoview/places.json');
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as GeoPlace[];
      if (Array.isArray(parsed)) {
        localPlacesCache = parsed.map((p) => ({ ...p, source: 'local' }));
        return localPlacesCache;
      }
    }
  } catch {
    // Fallback below
  }
  localPlacesCache = [];
  return localPlacesCache;
}

export function searchLocalPlaces(query: string, limit = 6): GeoPlace[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const places = loadLocalPlaces();
  const startsWith: GeoPlace[] = [];
  const contains: GeoPlace[] = [];
  for (const p of places) {
    const lower = p.name.toLowerCase();
    if (lower.startsWith(q)) {
      startsWith.push(p);
    } else if (lower.includes(q)) {
      contains.push(p);
    }
    if (startsWith.length >= limit) break;
  }
  return [...startsWith, ...contains].slice(0, limit);
}

export async function geocodeLocation(query: string): Promise<GeoPlace[]> {
  const coords = parseGeoQuery(query);
  if (coords) {
    return [
      {
        name: `Target ${coords.lat.toFixed(3)}, ${coords.lon.toFixed(3)}`,
        lat: coords.lat,
        lon: coords.lon,
        source: 'coords',
      },
    ];
  }

  const localMatches = searchLocalPlaces(query, 6);
  if (localMatches.length > 0) {
    return localMatches;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query.trim())}`;
    const raw = (await fetchJsonWithTimeout(url, 3800)) as Array<Record<string, unknown>>;
    if (Array.isArray(raw)) {
      return raw
        .map((item) => ({
          name: String(item.display_name || item.name || query).split(',').slice(0, 2).join(', '),
          lat: Number(item.lat),
          lon: Number(item.lon),
          source: 'nominatim' as const,
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    }
  } catch {
    // Nominatim offline/rate-limited -> return empty
  }
  return [];
}

export async function fetchGodsEyeSnapshot(focusLat = 37.7749, focusLon = -122.4194): Promise<GeoSnapshot> {
  const now = Date.now();
  const status: GeoFeedStatus = {
    earthquakes: 'unavailable',
    flights: 'unavailable',
    satellites: 'unavailable',
    weather: 'unavailable',
  };

  // 1. USGS Earthquakes
  let earthquakes: GeoEarthquake[] = [];
  if (eqCache && now - eqCache.fetchedAt < FEED_TTL_MS) {
    earthquakes = eqCache.value;
    status.earthquakes = 'cached';
  } else {
    try {
      const eqRaw = await fetchJsonWithTimeout(
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
        4200,
      );
      earthquakes = normalizeUsgsEarthquakes(eqRaw, 65);
      eqCache = { value: earthquakes, fetchedAt: now };
      status.earthquakes = 'live';
    } catch {
      if (eqCache) {
        earthquakes = eqCache.value;
        status.earthquakes = 'cached';
      }
    }
  }

  // 2. ADS-B Live Tactical Aircraft (keyless api.adsb.lol/v2/mil)
  let flights: GeoFlight[] = [];
  if (flightCache && now - flightCache.fetchedAt < FEED_TTL_MS) {
    flights = flightCache.value;
    status.flights = 'cached';
  } else {
    try {
      const adsbRaw = await fetchJsonWithTimeout('https://api.adsb.lol/v2/mil', 4200);
      flights = normalizeAdsbFlights(adsbRaw, 90);
      flightCache = { value: flights, fetchedAt: now };
      status.flights = 'live';
    } catch {
      if (flightCache) {
        flights = flightCache.value;
        status.flights = 'cached';
      }
    }
  }

  // 3. ISS Live Telemetry + Orbital Reconnaissance Constellation (CelesTrak/wheretheiss)
  let satellites: GeoSatellite[] = [];
  if (satCache && now - satCache.fetchedAt < 25_000) {
    satellites = satCache.value;
    status.satellites = 'cached';
  } else {
    let liveIss: GeoSatellite | null = null;
    try {
      const iss = (await fetchJsonWithTimeout('https://api.wheretheiss.at/v1/satellites/25544', 3500)) as Record<
        string,
        unknown
      >;
      const lat = Number(iss.latitude);
      const lon = Number(iss.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        liveIss = {
          id: 'sat-25544',
          name: 'ISS (ZARYA)',
          noradId: 25544,
          lat: Number(lat.toFixed(4)),
          lon: Number(lon.toFixed(4)),
          altKm: Math.round(Number(iss.altitude ?? 418)),
          velocityKmh: Math.round(Number(iss.velocity ?? 27580)),
          inclinationDeg: 51.6,
          category: 'station',
        };
        status.satellites = 'live';
      }
    } catch {
      // Derive below if live telemetry unavailable
    }

    const constellationSpecs: Array<[number, string, number, number, number, number, GeoSatellite['category']]> = [
      [48274, 'CSS (TIANHE)', 41.5, 42, 92.2, 392, 'station'],
      [20580, 'HUBBLE (HST)', 28.5, 118, 95.4, 535, 'recon'],
      [40697, 'SENTINEL-2A', 98.6, 210, 100.6, 786, 'recon'],
      [43013, 'NOAA-20 (JPSS-1)', 98.7, 305, 101.4, 824, 'recon'],
      [49260, 'LANDSAT-9', 98.2, 15, 98.9, 705, 'recon'],
      [44713, 'STARLINK-1007', 53.0, 165, 95.6, 550, 'comms'],
      [51001, 'STARLINK-3402', 53.2, 260, 95.6, 548, 'comms'],
      [25994, 'TERRA (EOS-AM1)', 98.2, 74, 98.9, 705, 'recon'],
    ];

    const orbitalList = constellationSpecs.map(([id, name, inc, raan, period, alt, cat]) =>
      computeOrbitalPositionFromElements(id, name, inc, raan, period, alt, now, cat),
    );
    satellites = [
      liveIss ?? computeOrbitalPositionFromElements(25544, 'ISS (ZARYA)', 51.6, 12, 92.9, 418, now, 'station'),
      ...orbitalList,
    ];
    if (!liveIss) {
      status.satellites = 'cached';
    }
    satCache = { value: satellites, fetchedAt: now };
  }

  // 4. Open-Meteo Atmospheric Telemetry for Focus Coordinate
  let weather: GeoWeather | null = null;
  const wKey = `${focusLat.toFixed(1)},${focusLon.toFixed(1)}`;
  const cachedW = weatherCache.get(wKey);
  if (cachedW && now - cachedW.fetchedAt < WEATHER_TTL_MS) {
    weather = cachedW.value;
    status.weather = 'cached';
  } else {
    try {
      const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${focusLat.toFixed(4)}&longitude=${focusLon.toFixed(4)}&current=temperature_2m,wind_speed_10m,cloud_cover,weather_code`;
      const wxRaw = (await fetchJsonWithTimeout(wxUrl, 3600)) as { current?: Record<string, unknown> };
      if (wxRaw?.current) {
        weather = {
          lat: Number(focusLat.toFixed(4)),
          lon: Number(focusLon.toFixed(4)),
          temperatureC: Number(wxRaw.current.temperature_2m ?? 0),
          windKmh: Number(wxRaw.current.wind_speed_10m ?? 0),
          cloudCoverPct: Number(wxRaw.current.cloud_cover ?? 0),
          condition: describeWeatherCode(Number(wxRaw.current.weather_code ?? 0)),
        };
        weatherCache.set(wKey, { value: weather, fetchedAt: now });
        status.weather = 'live';
      }
    } catch {
      if (cachedW) {
        weather = cachedW.value;
        status.weather = 'cached';
      }
    }
  }

  return {
    updatedAt: now,
    earthquakes,
    flights,
    satellites,
    weather,
    feedStatus: status,
  };
}
