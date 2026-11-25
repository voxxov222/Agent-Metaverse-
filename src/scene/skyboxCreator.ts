import * as THREE from 'three';
import type { SkyboxConfig } from '../types/os';

export interface SkyboxController {
  mesh: THREE.Mesh;
  applyConfig: (cfg: SkyboxConfig, renderer: THREE.WebGLRenderer, targetScene: THREE.Scene, isSoftwareGl: boolean) => void;
  update: (elapsed: number) => void;
  dispose: () => void;
}

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uNadirColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunSize;
  uniform float uStarDensity;
  uniform float uAuroraIntensity;
  uniform float uCloudCoverage;
  uniform float uNebulaHue;
  uniform float uTime;

  varying vec3 vWorldDir;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * noise2(p);
      p = p * 2.05 + vec2(1.7, 9.2);
      amp *= 0.5;
    }
    return v;
  }

  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float y = dir.y;

    // 3-stop atmospheric dome gradient
    float upperMix = pow(clamp(y, 0.0, 1.0), 0.55);
    float lowerMix = pow(clamp(-y, 0.0, 1.0), 0.65);
    vec3 col = mix(uHorizonColor, uZenithColor, upperMix);
    col = mix(col, uNadirColor, lowerMix);

    // Horizon atmospheric bloom
    float horizonBand = exp(-abs(y) * 9.0);
    col += uHorizonColor * 0.25 * horizonBand;

    // Sun / Moon disc & Mie corona
    float sunCos = max(dot(dir, normalize(uSunDir)), 0.0);
    float discRadius = mix(0.9988, 0.993, clamp(uSunSize / 3.0, 0.0, 1.0));
    float sunDisc = smoothstep(discRadius, discRadius + 0.0012, sunCos);
    float sunHalo = pow(sunCos, 24.0 / max(uSunSize, 0.25)) * 0.65 + pow(sunCos, 4.0) * 0.14;
    col += uSunColor * (sunDisc * 2.4 + sunHalo);

    // Multi-layer stars above horizon
    if (uStarDensity > 0.01 && y > -0.05) {
      float starMask = smoothstep(-0.05, 0.28, y);
      vec3 grid = floor(dir * 190.0);
      float r = hash31(grid);
      float thresh = mix(0.997, 0.962, uStarDensity);
      if (r > thresh) {
        vec3 cellCenter = normalize(grid + 0.5);
        float d = length(dir - cellCenter) * 190.0;
        float twinkle = 0.65 + 0.35 * sin(uTime * 2.4 + r * 80.0);
        float starGlow = smoothstep(0.45, 0.05, d) * twinkle * starMask;
        col += mix(vec3(0.75, 0.88, 1.0), uSunColor, fract(r * 31.7)) * starGlow * 1.4;
      }
    }

    // Swirling Aurora & Nebula bands
    if (uAuroraIntensity > 0.01 && y > 0.0) {
      float az = atan(dir.z, dir.x);
      vec2 aUv = vec2(az * 1.6 + uTime * 0.03, y * 4.5 - uTime * 0.025);
      float curtain = fbm(aUv * 2.2);
      float ribbon = smoothstep(0.42, 0.82, curtain) * smoothstep(0.02, 0.28, y) * smoothstep(0.92, 0.35, y);
      vec3 auroraA = hsl2rgb(fract(uNebulaHue), 0.85, 0.55);
      vec3 auroraB = hsl2rgb(fract(uNebulaHue + 0.16), 0.9, 0.62);
      vec3 auroraCol = mix(auroraA, auroraB, smoothstep(0.1, 0.6, y));
      col += auroraCol * ribbon * uAuroraIntensity * 1.35;
    }

    // Drifting FBM Clouds
    if (uCloudCoverage > 0.01 && y > 0.02) {
      vec2 cloudUv = dir.xz / (y + 0.16) * 1.1 + vec2(uTime * 0.018, uTime * 0.008);
      float c = fbm(cloudUv * 1.6);
      float cloudThreshold = mix(0.86, 0.32, uCloudCoverage);
      float cloudAlpha = smoothstep(cloudThreshold, cloudThreshold + 0.26, c) * smoothstep(0.02, 0.22, y);
      vec3 cloudBase = mix(uHorizonColor * 0.85, uSunColor * 0.95, pow(sunCos, 6.0) * 0.6 + 0.15);
      col = mix(col, cloudBase, cloudAlpha * 0.62);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSkyboxController(): SkyboxController {
  const geo = new THREE.SphereGeometry(235, 48, 32);
  const uniforms = {
    uZenithColor: { value: new THREE.Color('#040a1a') },
    uHorizonColor: { value: new THREE.Color('#123052') },
    uNadirColor: { value: new THREE.Color('#050811') },
    uSunColor: { value: new THREE.Color('#67e8f9') },
    uSunDir: { value: new THREE.Vector3(0.4, 0.2, -0.9).normalize() },
    uSunSize: { value: 1.0 },
    uStarDensity: { value: 0.55 },
    uAuroraIntensity: { value: 0.42 },
    uCloudCoverage: { value: 0.36 },
    uNebulaHue: { value: 0.54 },
    uTime: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;

  // Dedicated miniature sky scene for baking real PBR IBL reflections via PMREMGenerator
  const bakeScene = new THREE.Scene();
  const bakeGeo = new THREE.SphereGeometry(20, 24, 16);
  const bakeMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  bakeScene.add(new THREE.Mesh(bakeGeo, bakeMat));

  let pmremGenerator: THREE.PMREMGenerator | null = null;
  let currentEnvTex: THREE.Texture | null = null;
  let lastBakeHash = '';
  let bakeTimer = 0;

  function syncUniforms(cfg: SkyboxConfig) {
    uniforms.uZenithColor.value.set(cfg.zenithColor);
    uniforms.uHorizonColor.value.set(cfg.horizonColor);
    uniforms.uNadirColor.value.set(cfg.nadirColor);
    uniforms.uSunColor.value.set(cfg.sunColor);
    const phi = THREE.MathUtils.degToRad(90 - cfg.sunElevation);
    const theta = THREE.MathUtils.degToRad(cfg.sunAzimuth);
    uniforms.uSunDir.value.setFromSphericalCoords(1, phi, theta).normalize();
    uniforms.uSunSize.value = cfg.sunSize;
    uniforms.uStarDensity.value = cfg.starDensity;
    uniforms.uAuroraIntensity.value = cfg.auroraIntensity;
    uniforms.uCloudCoverage.value = cfg.cloudCoverage;
    uniforms.uNebulaHue.value = cfg.nebulaHue;
  }

  function bakeReflections(renderer: THREE.WebGLRenderer, targetScene: THREE.Scene) {
    if (!pmremGenerator) {
      pmremGenerator = new THREE.PMREMGenerator(renderer);
    }
    const nextTex = pmremGenerator.fromScene(bakeScene, 0.035).texture;
    if (currentEnvTex) {
      currentEnvTex.dispose();
    }
    currentEnvTex = nextTex;
    targetScene.environment = nextTex;
  }

  return {
    mesh,
    applyConfig: (cfg, renderer, targetScene, isSoftwareGl) => {
      syncUniforms(cfg);
      renderer.toneMappingExposure = cfg.exposure;
      targetScene.environmentIntensity = cfg.envIntensity;

      const hash = `${cfg.zenithColor}|${cfg.horizonColor}|${cfg.nadirColor}|${cfg.sunColor}|${cfg.sunElevation}|${cfg.sunAzimuth}|${cfg.auroraIntensity}|${cfg.nebulaHue}`;
      if (hash !== lastBakeHash) {
        lastBakeHash = hash;
        clearTimeout(bakeTimer);
        if (!currentEnvTex) {
          bakeReflections(renderer, targetScene);
        } else {
          bakeTimer = window.setTimeout(() => {
            bakeReflections(renderer, targetScene);
          }, isSoftwareGl ? 320 : 120);
        }
      }
    },
    update: (elapsed) => {
      uniforms.uTime.value = elapsed;
    },
    dispose: () => {
      clearTimeout(bakeTimer);
      geo.dispose();
      mat.dispose();
      bakeGeo.dispose();
      bakeMat.dispose();
      currentEnvTex?.dispose();
      pmremGenerator?.dispose();
    },
  };
}
