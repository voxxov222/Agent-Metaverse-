import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Bot,
  Crosshair,
  Globe2,
  Layers,
  Radar,
  RefreshCw,
  Search,
  Sparkles,
  Thermometer,
} from 'lucide-react';
import {
  buildGeoReconPrompt,
  cartesianToLatLon,
  formatLatLonDms,
  GLOBE_RADIUS,
  latLonAltToCartesian,
  OPTICAL_PRESETS,
  type GeoCable,
  type GeoCountryPolygon,
  type GeoDatacenter,
  type GeoPlace,
  type GeoSelectedTarget,
  type GeoSnapshot,
  type OpticalPresetId,
} from '../../utils/godsEyeLogic';
import type { AgentProfile } from '../../types/os';

interface GodsEyeGlobeViewProps {
  agents: AgentProfile[];
  reducedMotion: boolean;
  onDispatchRecon: (prompt: string) => void;
  onSelectFocusCoords?: (lat: number, lon: number, label: string) => void;
}

interface LayerVisibility {
  borders: boolean;
  cables: boolean;
  datacenters: boolean;
  quakes: boolean;
  flights: boolean;
  satellites: boolean;
  reticle: boolean;
}

const QUICK_BOOKMARKS: Array<{ label: string; lat: number; lon: number }> = [
  { label: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { label: 'Washington DC', lat: 38.9072, lon: -77.0369 },
  { label: 'London', lat: 51.5074, lon: -0.1278 },
  { label: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { label: 'Zurich', lat: 47.3769, lon: 8.5417 },
];

// Pre-allocated math helpers (zero per-frame GC allocations)
const _tmpVec = new THREE.Vector3();
const _tmpNormal = new THREE.Vector3();
const _tmpTargetCam = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3();
const _tmpMat = new THREE.Matrix4();
const _upVec = new THREE.Vector3(0, 1, 0);

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function createGlobeSurfaceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#071426');
    grad.addColorStop(0.22, '#040c1a');
    grad.addColorStop(0.5, '#030814');
    grad.addColorStop(0.78, '#040c1a');
    grad.addColorStop(1, '#071426');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle latitude/longitude graticule lines
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
    ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 15) {
      const x = ((lon + 180) / 360) * canvas.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = ((90 - lat) / 180) * canvas.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Equator + Prime Meridian accent
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.34)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function GodsEyeGlobeView({
  agents,
  reducedMotion,
  onDispatchRecon,
  onSelectFocusCoords,
}: GodsEyeGlobeViewProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [opticalMode, setOpticalMode] = useState<OpticalPresetId>('normal');
  const [layers, setLayers] = useState<LayerVisibility>({
    borders: true,
    cables: true,
    datacenters: true,
    quakes: true,
    flights: true,
    satellites: true,
    reticle: true,
  });

  const [focusCoords, setFocusCoords] = useState<{ lat: number; lon: number }>({
    lat: 37.7749,
    lon: -122.4194,
  });
  const [snapshot, setSnapshot] = useState<GeoSnapshot | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeoPlace[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<GeoSelectedTarget>({
    kind: 'place',
    id: 'focus-sf',
    title: 'San Francisco Command Node',
    subtitle: 'Active Global Reference Lock',
    lat: 37.7749,
    lon: -122.4194,
    details: ['Admin Home Sector', 'Real-time USGS / ADS-B / Orbital telemetry active'],
  });
  const [dispatchAgentIdx, setDispatchAgentIdx] = useState(0);
  const [datacenters, setDatacenters] = useState<GeoDatacenter[]>([]);
  const [autoSpin, setAutoSpin] = useState(false);

  // Refs synced into the Three.js scene loop so state updates never remount WebGL
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const opticalRef = useRef(opticalMode);
  opticalRef.current = opticalMode;
  const autoSpinRef = useRef(autoSpin);
  autoSpinRef.current = autoSpin;
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const sceneHandleRef = useRef<{
    flyTo: (lat: number, lon: number, dist?: number) => void;
    updateDynamicLayers: (snap: GeoSnapshot | null, dcs: GeoDatacenter[]) => void;
    updateOpticalTheme: (mode: OpticalPresetId) => void;
    updateLockMarker: (lat: number, lon: number) => void;
    updateLayerVisibility: (l: LayerVisibility) => void;
  } | null>(null);

  const onSelectTargetRef = useRef<(t: GeoSelectedTarget) => void>(() => {});
  onSelectTargetRef.current = (t) => {
    setSelectedTarget(t);
    setFocusCoords({ lat: t.lat, lon: t.lon });
    onSelectFocusCoords?.(t.lat, t.lon, t.title);
  };

  const fetchSnapshot = useCallback(async (lat: number, lon: number) => {
    setSnapshotBusy(true);
    try {
      const res = await fetch(`/api/gods-eye/snapshot?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
      if (!res.ok) return;
      const data = (await res.json()) as GeoSnapshot;
      setSnapshot(data);
    } catch {
      // Preserve last snapshot if offline
    } finally {
      setSnapshotBusy(false);
    }
  }, []);

  // Poll live snapshot every 45s or when focus sector shifts materially
  useEffect(() => {
    void fetchSnapshot(focusCoords.lat, focusCoords.lon);
    const id = window.setInterval(() => {
      void fetchSnapshot(focusCoords.lat, focusCoords.lon);
    }, 45_000);
    return () => window.clearInterval(id);
  }, [fetchSnapshot, focusCoords.lat, focusCoords.lon]);

  // Mount Three.js Globe once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = Math.max(320, container.clientWidth);
    const height = Math.max(260, container.clientHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020611);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 200);
    const initialPos = latLonAltToCartesian(37.7749, -122.4194, 0, 22.5);
    camera.position.set(initialPos.x, initialPos.y, initialPos.z);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    // Lighting rig: warm key + cool fill
    const hemi = new THREE.HemisphereLight(0x7dd3fc, 0x0f172a, 0.9);
    scene.add(hemi);
    const sunKey = new THREE.DirectionalLight(0xfff1d6, 1.45);
    sunKey.position.set(22, 14, 18);
    scene.add(sunKey);
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    rimLight.position.set(-18, -10, -16);
    scene.add(rimLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 12.2;
    controls.maxDistance = 36;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;

    // Globe sphere
    const surfaceTex = createGlobeSurfaceTexture();
    surfaceTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 48, 36);
    const globeMat = new THREE.MeshStandardMaterial({
      map: surfaceTex,
      color: 0x0b1d38,
      roughness: 0.78,
      metalness: 0.18,
    });
    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globeMesh);

    // Atmospheric Fresnel Halo
    const atmoGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.075, 42, 30);
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x00c8ff) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          float rim = 1.0 - max(0.0, dot(normalize(vViewPos), vNormal));
          float intensity = pow(rim, 3.2) * 0.82;
          gl_FragColor = vec4(uColor, intensity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmoMesh);

    // Subtle Starfield
    const starCount = 550;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = ((i * 73) % 1000) / 1000;
      const v = ((i * 197) % 1000) / 1000;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = 64 + (i % 19);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.24, transparent: true, opacity: 0.72 });
    const starPoints = new THREE.Points(starGeo, starMat);
    scene.add(starPoints);

    // Vector layer containers
    let bordersLines: THREE.LineSegments | null = null;
    const bordersMat = new THREE.LineBasicMaterial({
      color: OPTICAL_PRESETS.normal.coastColor,
      transparent: true,
      opacity: 0.78,
    });

    let cablesLines: THREE.LineSegments | null = null;
    const cablesMat = new THREE.LineBasicMaterial({
      color: OPTICAL_PRESETS.normal.cableColor,
      transparent: true,
      opacity: 0.42,
    });

    // Instanced DataCenters
    const dcGeo = new THREE.BoxGeometry(0.085, 0.085, 0.085);
    const dcMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const dcInstanced = new THREE.InstancedMesh(dcGeo, dcMat, 900);
    dcInstanced.count = 0;
    dcInstanced.frustumCulled = false;
    scene.add(dcInstanced);

    // Instanced Earthquakes (crisp tactical seismic rings)
    const eqGeo = new THREE.RingGeometry(0.095, 0.138, 24);
    const eqMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, side: THREE.DoubleSide });
    const eqInstanced = new THREE.InstancedMesh(eqGeo, eqMat, 80);
    eqInstanced.count = 0;
    eqInstanced.frustumCulled = false;
    scene.add(eqInstanced);

    // Instanced ADS-B Tactical Aircraft (tangent wedge cones oriented by compass heading)
    const flightGeo = new THREE.ConeGeometry(0.065, 0.21, 4);
    flightGeo.rotateX(Math.PI / 2);
    const flightMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const flightInstanced = new THREE.InstancedMesh(flightGeo, flightMat, 120);
    flightInstanced.count = 0;
    flightInstanced.frustumCulled = false;
    scene.add(flightInstanced);

    // Instanced Orbital Satellites
    const satGeo = new THREE.OctahedronGeometry(0.16, 0);
    const satMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });
    const satInstanced = new THREE.InstancedMesh(satGeo, satMat, 24);
    satInstanced.count = 0;
    satInstanced.frustumCulled = false;
    scene.add(satInstanced);

    // Selected Target Lock Beacon
    const lockGroup = new THREE.Group();
    const lockRingGeo = new THREE.RingGeometry(0.26, 0.36, 28);
    const lockRingMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    });
    const lockRing = new THREE.Mesh(lockRingGeo, lockRingMat);
    lockGroup.add(lockRing);
    scene.add(lockGroup);

    const placeLockMarker = (lat: number, lon: number) => {
      const p = latLonAltToCartesian(lat, lon, 0, GLOBE_RADIUS + 0.06);
      _tmpVec.set(p.x, p.y, p.z);
      lockGroup.position.copy(_tmpVec);
      _tmpNormal.copy(_tmpVec).normalize();
      lockGroup.quaternion.setFromUnitVectors(_upVec, _tmpNormal);
      lockRing.rotation.x = Math.PI / 2;
    };
    placeLockMarker(37.7749, -122.4194);

    // Dynamic store refs for click raycasting
    let latestDcs: GeoDatacenter[] = [];
    let latestSnap: GeoSnapshot | null = null;

    // Fetch static Natural Earth countries & TeleGeography submarine cables & datacenters
    let disposed = false;

    void fetch('/data/geoview/countries.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((countries: GeoCountryPolygon[]) => {
        if (disposed || !Array.isArray(countries)) return;
        const pts: number[] = [];
        for (const c of countries) {
          for (const ring of c.rings) {
            for (let i = 0; i < ring.length - 1; i++) {
              const [lon1, lat1] = ring[i];
              const [lon2, lat2] = ring[i + 1];
              // Skip anti-meridian wrap or long interior jump chords
              if (Math.abs(lon1 - lon2) > 14 || Math.abs(lat1 - lat2) > 12) continue;
              const a = latLonAltToCartesian(lat1, lon1, 0, GLOBE_RADIUS + 0.03);
              const b = latLonAltToCartesian(lat2, lon2, 0, GLOBE_RADIUS + 0.03);
              pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        bordersLines = new THREE.LineSegments(geo, bordersMat);
        bordersLines.visible = layersRef.current.borders;
        scene.add(bordersLines);
        requestRender();
      })
      .catch(() => {});

    void fetch('/data/geoview/cables.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((cables: GeoCable[]) => {
        if (disposed || !Array.isArray(cables)) return;
        const pts: number[] = [];
        for (const cable of cables) {
          for (const line of cable.lines) {
            for (let i = 0; i < line.length - 1; i++) {
              const [lon1, lat1] = line[i];
              const [lon2, lat2] = line[i + 1];
              if (Math.abs(lon1 - lon2) > 25 || Math.abs(lat1 - lat2) > 20) continue;
              const a = latLonAltToCartesian(lat1, lon1, 0, GLOBE_RADIUS + 0.02);
              const b = latLonAltToCartesian(lat2, lon2, 0, GLOBE_RADIUS + 0.02);
              pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
            }
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        cablesLines = new THREE.LineSegments(geo, cablesMat);
        cablesLines.visible = layersRef.current.cables;
        scene.add(cablesLines);
        requestRender();
      })
      .catch(() => {});

    void fetch('/data/geoview/datacenters.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((dcs: GeoDatacenter[]) => {
        if (disposed || !Array.isArray(dcs)) return;
        latestDcs = dcs.slice(0, 900);
        setDatacenters(latestDcs);
        dcInstanced.count = latestDcs.length;
        for (let i = 0; i < latestDcs.length; i++) {
          const dc = latestDcs[i];
          const p = latLonAltToCartesian(dc.lat, dc.lon, 0, GLOBE_RADIUS + 0.06);
          _tmpVec.set(p.x, p.y, p.z);
          _tmpNormal.copy(_tmpVec).normalize();
          _tmpQuat.setFromUnitVectors(_upVec, _tmpNormal);
          _tmpScale.set(1, 1, 1);
          _tmpMat.compose(_tmpVec, _tmpQuat, _tmpScale);
          dcInstanced.setMatrixAt(i, _tmpMat);
        }
        dcInstanced.instanceMatrix.needsUpdate = true;
        dcInstanced.computeBoundingSphere();
        requestRender();
      })
      .catch(() => {});

    // Fly-to camera state
    let flyActive = false;
    const flyDest = new THREE.Vector3();

    const flyTo = (lat: number, lon: number, dist = 19.5) => {
      const p = latLonAltToCartesian(lat, lon, 0, dist);
      flyDest.set(p.x, p.y, p.z);
      flyActive = true;
      placeLockMarker(lat, lon);
      requestRender();
    };

    controls.addEventListener('start', () => {
      flyActive = false;
    });
    controls.addEventListener('change', () => {
      requestRender();
    });

    const updateDynamicLayers = (snap: GeoSnapshot | null, dcs: GeoDatacenter[]) => {
      latestSnap = snap;
      if (dcs.length > 0) latestDcs = dcs;
      if (!snap) return;

      // Earthquakes
      const eqs = snap.earthquakes.slice(0, 80);
      eqInstanced.count = eqs.length;
      for (let i = 0; i < eqs.length; i++) {
        const eq = eqs[i];
        const p = latLonAltToCartesian(eq.lat, eq.lon, 0, GLOBE_RADIUS + 0.07);
        _tmpVec.set(p.x, p.y, p.z);
        _tmpNormal.copy(_tmpVec).normalize();
        _tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _tmpNormal);
        const magScale = Math.max(0.65, Math.min(1.85, eq.mag * 0.34));
        _tmpScale.set(magScale, magScale, 1);
        _tmpMat.compose(_tmpVec, _tmpQuat, _tmpScale);
        eqInstanced.setMatrixAt(i, _tmpMat);
      }
      eqInstanced.instanceMatrix.needsUpdate = true;
      eqInstanced.computeBoundingSphere();

      // ADS-B Flights (oriented tangent to sphere along heading)
      const fls = snap.flights.slice(0, 120);
      flightInstanced.count = fls.length;
      const forwardAhead = new THREE.Vector3();
      for (let i = 0; i < fls.length; i++) {
        const fl = fls[i];
        const altKm = Math.max(12, (fl.altFt || 28000) * 0.0003048 * 14);
        const p = latLonAltToCartesian(fl.lat, fl.lon, altKm, GLOBE_RADIUS + 0.09);
        const hRad = ((fl.heading || 0) * Math.PI) / 180;
        const pAhead = latLonAltToCartesian(
          fl.lat + Math.cos(hRad) * 0.5,
          fl.lon + Math.sin(hRad) * 0.5,
          altKm,
          GLOBE_RADIUS + 0.09,
        );
        _tmpVec.set(p.x, p.y, p.z);
        _tmpNormal.copy(_tmpVec).normalize();
        forwardAhead.set(pAhead.x, pAhead.y, pAhead.z);
        _tmpMat.lookAt(forwardAhead, _tmpVec, _tmpNormal);
        _tmpQuat.setFromRotationMatrix(_tmpMat);
        _tmpScale.set(1, 1, 1);
        _tmpMat.compose(_tmpVec, _tmpQuat, _tmpScale);
        flightInstanced.setMatrixAt(i, _tmpMat);
      }
      flightInstanced.instanceMatrix.needsUpdate = true;
      flightInstanced.computeBoundingSphere();

      // Satellites
      const sats = snap.satellites.slice(0, 24);
      satInstanced.count = sats.length;
      for (let i = 0; i < sats.length; i++) {
        const sat = sats[i];
        const visualAlt = Math.max(0.7, Math.min(2.2, (sat.altKm / 6371) * GLOBE_RADIUS * 1.6));
        const p = latLonAltToCartesian(sat.lat, sat.lon, 0, GLOBE_RADIUS + visualAlt);
        _tmpVec.set(p.x, p.y, p.z);
        _tmpQuat.identity();
        _tmpScale.set(sat.noradId === 25544 ? 1.45 : 1.0, sat.noradId === 25544 ? 1.45 : 1.0, sat.noradId === 25544 ? 1.45 : 1.0);
        _tmpMat.compose(_tmpVec, _tmpQuat, _tmpScale);
        satInstanced.setMatrixAt(i, _tmpMat);
      }
      satInstanced.instanceMatrix.needsUpdate = true;
      satInstanced.computeBoundingSphere();

      requestRender();
    };

    const updateOpticalTheme = (mode: OpticalPresetId) => {
      const spec = OPTICAL_PRESETS[mode];
      bordersMat.color.setHex(spec.coastColor);
      cablesMat.color.setHex(spec.cableColor);
      globeMat.color.setHex(spec.globeTint);
      atmoMat.uniforms.uColor.value.setHex(spec.coastColor);
      lockRingMat.color.set(spec.reticleColor);
      requestRender();
    };

    const updateLayerVisibility = (l: LayerVisibility) => {
      if (bordersLines) bordersLines.visible = l.borders;
      if (cablesLines) cablesLines.visible = l.cables;
      dcInstanced.visible = l.datacenters;
      eqInstanced.visible = l.quakes;
      flightInstanced.visible = l.flights;
      satInstanced.visible = l.satellites;
      requestRender();
    };

    sceneHandleRef.current = {
      flyTo,
      updateDynamicLayers,
      updateOpticalTheme,
      updateLockMarker: placeLockMarker,
      updateLayerVisibility,
    };

    // Click picking on globe & live telemetry targets
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 6) return; // drag/orbit, not click

      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      // Priority order: Satellites -> Earthquakes -> Flights -> DataCenters -> Surface coordinate
      const satHits = satInstanced.visible ? raycaster.intersectObject(satInstanced, false) : [];
      if (satHits.length > 0 && typeof satHits[0].instanceId === 'number' && latestSnap) {
        const sat = latestSnap.satellites[satHits[0].instanceId];
        if (sat) {
          placeLockMarker(sat.lat, sat.lon);
          onSelectTargetRef.current({
            kind: 'satellite',
            id: sat.id,
            title: sat.name,
            subtitle: `NORAD ${sat.noradId} · ${sat.category.toUpperCase()}`,
            lat: sat.lat,
            lon: sat.lon,
            altLabel: `${sat.altKm} km ALT · ${sat.velocityKmh.toLocaleString()} km/h`,
            details: [`Inclination ${sat.inclinationDeg}°`, `Orbit velocity ${sat.velocityKmh} km/h`],
          });
          requestRender();
          return;
        }
      }

      const eqHits = eqInstanced.visible ? raycaster.intersectObject(eqInstanced, false) : [];
      if (eqHits.length > 0 && typeof eqHits[0].instanceId === 'number' && latestSnap) {
        const eq = latestSnap.earthquakes[eqHits[0].instanceId];
        if (eq) {
          placeLockMarker(eq.lat, eq.lon);
          onSelectTargetRef.current({
            kind: 'earthquake',
            id: eq.id,
            title: `M${eq.mag.toFixed(1)} Seismic Event`,
            subtitle: eq.place,
            lat: eq.lat,
            lon: eq.lon,
            altLabel: `Depth ${eq.depthKm} km`,
            details: [
              `USGS Magnitude M${eq.mag.toFixed(1)}`,
              `Hypocenter depth ${eq.depthKm} km`,
              eq.tsunami ? 'Tsunami Advisory Active' : 'No tsunami flag',
            ],
          });
          requestRender();
          return;
        }
      }

      const flHits = flightInstanced.visible ? raycaster.intersectObject(flightInstanced, false) : [];
      if (flHits.length > 0 && typeof flHits[0].instanceId === 'number' && latestSnap) {
        const fl = latestSnap.flights[flHits[0].instanceId];
        if (fl) {
          placeLockMarker(fl.lat, fl.lon);
          onSelectTargetRef.current({
            kind: 'flight',
            id: fl.id,
            title: `${fl.callsign} (${fl.aircraftType})`,
            subtitle: 'ADS-B Live Tactical Track',
            lat: fl.lat,
            lon: fl.lon,
            altLabel: `${fl.altFt.toLocaleString()} ft · ${fl.speedKts} kts`,
            details: [`Heading ${fl.heading}°`, `Baro Alt ${fl.altFt.toLocaleString()} ft`, `Speed ${fl.speedKts} kts`],
          });
          requestRender();
          return;
        }
      }

      const dcHits = dcInstanced.visible ? raycaster.intersectObject(dcInstanced, false) : [];
      if (dcHits.length > 0 && typeof dcHits[0].instanceId === 'number') {
        const dc = latestDcs[dcHits[0].instanceId];
        if (dc) {
          placeLockMarker(dc.lat, dc.lon);
          onSelectTargetRef.current({
            kind: 'datacenter',
            id: dc.id,
            title: dc.name,
            subtitle: `AI/Cloud Facility · ${dc.operator}`,
            lat: dc.lat,
            lon: dc.lon,
            details: [`Operator: ${dc.operator}`, 'TeleGeography/OSM Facility Index'],
          });
          requestRender();
          return;
        }
      }

      const globeHits = raycaster.intersectObject(globeMesh, false);
      if (globeHits.length > 0) {
        const pt = globeHits[0].point;
        const { lat, lon } = cartesianToLatLon(pt.x, pt.y, pt.z);
        placeLockMarker(lat, lon);
        onSelectTargetRef.current({
          kind: 'point',
          id: `pt-${lat}-${lon}`,
          title: `Sector ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
          subtitle: 'Surface Coordinate Lock',
          lat,
          lon,
          details: ['Manual orbital reticle designation'],
        });
        requestRender();
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // ResizeObserver for crisp fit inside Admin Workstation panel
    const resizeObs = new ResizeObserver(() => {
      if (disposed) return;
      const w = Math.max(320, container.clientWidth);
      const h = Math.max(240, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObs.observe(container);

    // Render loop: on-demand with software-GL pacing & smooth damping for fly-to
    let frameId = 0;
    let renderBusy = false;
    let renderDirty = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function requestRender() {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        const now = performance.now();
        const delta = Math.min(0.1, (now - lastTime) / 1000);
        lastTime = now;

        let needsMoreFrames = false;
        if (flyActive) {
          const factor = 1 - Math.exp(-5.5 * delta);
          camera.position.lerp(flyDest, factor);
          camera.lookAt(0, 0, 0);
          if (camera.position.distanceTo(flyDest) < 0.08) {
            camera.position.copy(flyDest);
            flyActive = false;
          } else {
            needsMoreFrames = true;
          }
        }

        if (autoSpinRef.current && !flyActive && !reducedMotionRef.current) {
          const angle = delta * 0.14;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const x = camera.position.x;
          const z = camera.position.z;
          camera.position.x = x * cos - z * sin;
          camera.position.z = x * sin + z * cos;
          needsMoreFrames = true;
        }

        controls.update();
        renderer.render(scene, camera);

        const done = () => {
          renderBusy = false;
          if (!disposed && (renderDirty || needsMoreFrames)) {
            requestRender();
          }
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    }

    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      globeGeo.dispose();
      globeMat.dispose();
      surfaceTex.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      bordersLines?.geometry.dispose();
      bordersMat.dispose();
      cablesLines?.geometry.dispose();
      cablesMat.dispose();
      dcGeo.dispose();
      dcMat.dispose();
      eqGeo.dispose();
      eqMat.dispose();
      flightGeo.dispose();
      flightMat.dispose();
      satGeo.dispose();
      satMat.dispose();
      lockRingGeo.dispose();
      lockRingMat.dispose();
      envTex.dispose();
      renderer.dispose();
      sceneHandleRef.current = null;
    };
  }, []);

  // Push dynamic updates cleanly without touching WebGL lifecycle
  useEffect(() => {
    sceneHandleRef.current?.updateDynamicLayers(snapshot, datacenters);
  }, [snapshot, datacenters]);

  useEffect(() => {
    sceneHandleRef.current?.updateOpticalTheme(opticalMode);
  }, [opticalMode]);

  useEffect(() => {
    sceneHandleRef.current?.updateLayerVisibility(layers);
  }, [layers]);

  useEffect(() => {
    if (autoSpin) {
      sceneHandleRef.current?.flyTo(focusCoords.lat, focusCoords.lon, 21.5);
    }
  }, [autoSpin]);

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q || searchBusy) return;
    setSearchBusy(true);
    try {
      const res = await fetch(`/api/gods-eye/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { results?: GeoPlace[] };
      const list = data.results ?? [];
      setSearchResults(list);
      if (list[0]) {
        jumpToPlace(list[0]);
      }
    } finally {
      setSearchBusy(false);
    }
  }

  function jumpToPlace(place: GeoPlace) {
    setSearchResults([]);
    sceneHandleRef.current?.flyTo(place.lat, place.lon, 17.8);
    onSelectTargetRef.current({
      kind: 'place',
      id: `place-${place.name}`,
      title: place.name,
      subtitle: place.source ? `Geocode (${place.source})` : 'World City Lock',
      lat: place.lat,
      lon: place.lon,
      details: [`Coordinates: ${place.lat.toFixed(4)}°, ${place.lon.toFixed(4)}°`],
    });
  }

  function toggleLayer(key: keyof LayerVisibility) {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const preset = OPTICAL_PRESETS[opticalMode];
  const dms = useMemo(() => formatLatLonDms(focusCoords.lat, focusCoords.lon), [focusCoords.lat, focusCoords.lon]);
  const selectedAgent = agents[dispatchAgentIdx] ?? agents[0];

  return (
    <div
      data-testid="gods-eye-viewport"
      className="relative flex-1 min-h-[380px] rounded-lg border border-[#00c8ff]/50 bg-[#020611] overflow-hidden flex flex-col font-mono text-xs select-none"
    >
      {/* Top Geospatial Search & Quick Sector Strip */}
      <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-[#0096ff]/35 bg-[#050a18]/92">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5 min-w-[220px] flex-1 max-w-md relative">
          <Search className="w-3.5 h-3.5 text-[#00c8ff] shrink-0" />
          <input
            type="text"
            aria-label="God's Eye location or coordinate search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search city, lat,lon, or geo:..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#00c8ff]"
          />
          <button
            type="submit"
            disabled={searchBusy || !searchQuery.trim()}
            className="px-2 py-1 rounded bg-[#00c8ff] text-slate-950 font-bold text-[10px] hover:bg-cyan-300 disabled:opacity-45 cursor-pointer"
          >
            {searchBusy ? '...' : 'Lock'}
          </button>

          {searchResults.length > 1 && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded border border-cyan-500/40 bg-[#050a18] shadow-xl z-30 overflow-hidden">
              {searchResults.map((r, idx) => (
                <button
                  key={`${r.name}-${idx}`}
                  type="button"
                  onClick={() => jumpToPlace(r)}
                  className="w-full text-left px-2.5 py-1.5 text-[11px] text-slate-200 hover:bg-cyan-500/20 flex items-center justify-between cursor-pointer"
                >
                  <span className="truncate">{r.name}</span>
                  <span className="text-[10px] text-slate-400">
                    {r.lat.toFixed(2)}, {r.lon.toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>

        {/* Quick Global Bookmarks + ISS Lock */}
        <div className="flex items-center gap-1 flex-wrap">
          {QUICK_BOOKMARKS.map((bm) => (
            <button
              key={bm.label}
              type="button"
              onClick={() => jumpToPlace({ name: bm.label, lat: bm.lat, lon: bm.lon, source: 'local' })}
              className="px-2 py-0.5 rounded border border-slate-700 bg-slate-950/90 text-[10px] text-slate-300 hover:border-[#00c8ff] hover:text-white cursor-pointer"
            >
              {bm.label}
            </button>
          ))}
          {snapshot?.satellites[0] && (
            <button
              type="button"
              onClick={() => {
                const iss = snapshot.satellites[0];
                sceneHandleRef.current?.flyTo(iss.lat, iss.lon, 19.2);
                onSelectTargetRef.current({
                  kind: 'satellite',
                  id: iss.id,
                  title: iss.name,
                  subtitle: `NORAD ${iss.noradId} · Orbital Station`,
                  lat: iss.lat,
                  lon: iss.lon,
                  altLabel: `${iss.altKm} km · ${iss.velocityKmh.toLocaleString()} km/h`,
                  details: [`Inclination ${iss.inclinationDeg}°`, 'Live orbital telemetry track'],
                });
              }}
              className="px-2 py-0.5 rounded border border-purple-500/60 bg-purple-500/15 text-[10px] text-purple-200 hover:bg-purple-500/25 cursor-pointer"
            >
              Track ISS
            </button>
          )}
        </div>
      </div>

      {/* Main 3D Globe Canvas + Optical Sensor Layer */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          ref={mountRef}
          data-testid="gods-eye-canvas-mount"
          className="w-full h-full"
          style={{ filter: preset.cssFilter }}
        />

        {/* Optical Tint & Subtle CRT/NVG Scanlines (pointer-events-none) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: preset.tintOverlay,
            backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,${preset.scanlineOpacity * 0.2}) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,${preset.scanlineOpacity}) 4px)`,
          }}
        />

        {/* Center Tactical Targeting Reticle */}
        {layers.reticle && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="w-28 h-28 rounded-full border border-dashed opacity-35 flex items-center justify-center"
              style={{ borderColor: preset.reticleColor }}
            >
              <Crosshair className="w-5 h-5 opacity-70" style={{ color: preset.reticleColor }} />
            </div>
          </div>
        )}

        {/* Top-Left Live Coordinate & Weather Readout */}
        <div className="pointer-events-none absolute top-2.5 left-3 z-10 space-y-1 text-[10px]">
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#050a18]/88 border border-[#00c8ff]/40 text-slate-100">
            <Globe2 className="w-3 h-3" style={{ color: preset.badgeColor }} />
            <span className="font-bold tracking-wider" style={{ color: preset.badgeColor }}>
              GOD&apos;S EYE // {preset.label}
            </span>
          </div>
          <div className="px-2 py-1 rounded bg-[#050a18]/88 border border-slate-800 text-cyan-200 tabular-nums">
            <div>
              {dms.latStr} · {dms.lonStr}
            </div>
            {snapshot?.weather && (
              <div className="text-[10px] text-slate-300 flex items-center gap-1.5 mt-0.5">
                <Thermometer className="w-3 h-3 text-amber-300" />
                <span>
                  {snapshot.weather.temperatureC ?? '--'}°C · {snapshot.weather.windKmh ?? '--'} km/h ·{' '}
                  {snapshot.weather.condition}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Top-Right Live Feed Telemetry Counters */}
        <div className="pointer-events-none absolute top-2.5 right-3 z-10 flex flex-col items-end gap-1 text-[10px]">
          <div className="px-2 py-1 rounded bg-[#050a18]/88 border border-slate-800 flex items-center gap-2 text-slate-300">
            <span>EQ: {snapshot?.earthquakes.length ?? '--'}</span>
            <span className="text-amber-300">MIL-AIR: {snapshot?.flights.length ?? '--'}</span>
            <span className="text-purple-300">ORB: {snapshot?.satellites.length ?? '--'}</span>
            <span className="text-cyan-300">DC: {datacenters.length}</span>
          </div>
          {snapshot && (
            <div className="px-2 py-0.5 rounded bg-[#050a18]/85 border border-slate-800/80 text-[9px] text-slate-400">
              USGS:{snapshot.feedStatus.earthquakes} · ADS-B:{snapshot.feedStatus.flights} · ORB:
              {snapshot.feedStatus.satellites}
            </div>
          )}
        </div>

        {/* Bottom-Left Selected Target Inspection & Agent/MAYA Dispatch Card */}
        <div className="absolute bottom-2.5 left-3 z-20 max-w-[330px] rounded-md border border-[#00c8ff]/50 bg-[#050a18]/92 p-2.5 space-y-1.5 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold">
                {selectedTarget.kind} lock {selectedTarget.altLabel ? `· ${selectedTarget.altLabel}` : ''}
              </div>
              <div className="font-bold text-xs text-white truncate">{selectedTarget.title}</div>
              <div className="text-[10px] text-slate-400 truncate">{selectedTarget.subtitle}</div>
            </div>
            <Radar className="w-4 h-4 text-[#00c8ff] shrink-0 mt-0.5" />
          </div>
          <div className="text-[10px] text-slate-300 space-y-0.5">
            {selectedTarget.details.slice(0, 2).map((d) => (
              <div key={d} className="truncate">
                • {d}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() =>
                onDispatchRecon(buildGeoReconPrompt(selectedTarget, snapshot?.weather ?? null))
              }
              className="px-2 py-1 rounded bg-[#00c8ff] text-slate-950 font-bold text-[10px] hover:bg-cyan-300 flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>Analyze w/ MAYA</span>
            </button>
            {selectedAgent && (
              <div className="flex items-center gap-1">
                <select
                  aria-label="Recon target agent"
                  value={dispatchAgentIdx}
                  onChange={(e) => setDispatchAgentIdx(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[10px] text-slate-200"
                >
                  {agents.map((ag, idx) => (
                    <option key={ag.id} value={idx}>
                      {ag.name.split(' ')[0]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    onDispatchRecon(
                      buildGeoReconPrompt(
                        selectedTarget,
                        snapshot?.weather ?? null,
                        selectedAgent.name.split(' ')[0],
                      ),
                    )
                  }
                  className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/60 text-emerald-200 hover:bg-emerald-500/30 font-bold text-[10px] flex items-center gap-1 cursor-pointer"
                >
                  <Bot className="w-3 h-3" />
                  <span>Dispatch</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Optical Filter & Layer Dock */}
      <div className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-t border-[#0096ff]/35 bg-[#050a18]/94 text-[10px]">
        {/* Optical Sensor Presets (NORMAL / NVG / FLIR / CRT / NOIR) */}
        <div className="flex items-center gap-1">
          <span className="text-slate-400 mr-1">OPTICS:</span>
          {(Object.keys(OPTICAL_PRESETS) as OpticalPresetId[]).map((modeId) => {
            const spec = OPTICAL_PRESETS[modeId];
            const active = opticalMode === modeId;
            return (
              <button
                key={modeId}
                type="button"
                onClick={() => setOpticalMode(modeId)}
                className={`px-2 py-0.5 rounded border font-bold cursor-pointer ${
                  active
                    ? 'text-slate-950 border-white'
                    : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
                style={active ? { backgroundColor: spec.badgeColor } : undefined}
              >
                {spec.shortLabel}
              </button>
            );
          })}
        </div>

        {/* Layer Toggles & Feed Refresh */}
        <div className="flex items-center gap-1 flex-wrap">
          <Layers className="w-3 h-3 text-slate-400 mr-0.5" />
          {(
            [
              ['borders', 'Borders'],
              ['cables', 'Cables'],
              ['datacenters', 'DCs'],
              ['quakes', 'Quakes'],
              ['flights', 'Flights'],
              ['satellites', 'Sats'],
              ['reticle', 'Reticle'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleLayer(key)}
              aria-pressed={layers[key]}
              className={`px-1.5 py-0.5 rounded border cursor-pointer ${
                layers[key]
                  ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                  : 'bg-slate-950 border-slate-800 text-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAutoSpin((v) => !v)}
            className={`px-1.5 py-0.5 rounded border cursor-pointer ${
              autoSpin
                ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            {autoSpin ? 'Orbit On' : 'Orbit Off'}
          </button>
          <button
            type="button"
            onClick={() => void fetchSnapshot(focusCoords.lat, focusCoords.lon)}
            disabled={snapshotBusy}
            aria-label="Refresh God's Eye feeds"
            className="px-2 py-0.5 rounded border border-slate-700 bg-slate-950 text-cyan-300 hover:border-cyan-400 flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${snapshotBusy ? 'animate-spin' : ''}`} />
            <span>Sync</span>
          </button>
        </div>
      </div>
    </div>
  );
}
