/**
 * Inline GLSL & WGSL shaders for the HALO 3D Command Dome & Holo Table panels.
 * Features Fresnel edge glow, animated scanlines, chromatic aberration,
 * glitch/flicker on kernel state change, depth-aware transparency, and parallax.
 */

export const HALO_PANEL_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uParallax;
  uniform float uGlitch;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Subtle glitch jitter during state transitions
    if (uGlitch > 0.01) {
      float band = step(0.65, fract(pos.y * 9.0 + uTime * 24.0));
      pos.x += band * sin(uTime * 80.0) * 0.035 * uGlitch;
    }

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    // Subtle view-space parallax offset
    mvPos.xy += mvPos.xy * (uParallax * 0.015);
    vViewPos = -mvPos.xyz;
    vNormalView = normalize(normalMatrix * normal);

    gl_Position = projectionMatrix * mvPos;
  }
`;

export const HALO_PANEL_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uAccentColor;
  uniform float uTime;
  uniform float uScanlineOpacity;
  uniform float uGlitch;
  uniform float uOpacity;
  uniform float uHover;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vec2 uv = vUv;

    // Chromatic aberration shift amplified by glitch state & edge distance
    float edgeDist = length(uv - 0.5);
    float chromaOffset = (0.0018 + uGlitch * 0.009) * (0.4 + edgeDist);

    // Occasional horizontal glitch tear
    if (uGlitch > 0.02) {
      float slice = fract(uv.y * 16.0 + uTime * 11.0);
      if (slice > 0.86) {
        uv.x += sin(uTime * 60.0 + uv.y * 40.0) * 0.025 * uGlitch;
      }
    }

    float r = texture2D(uMap, clamp(uv + vec2(chromaOffset, 0.0), 0.002, 0.998)).r;
    float g = texture2D(uMap, clamp(uv, 0.002, 0.998)).g;
    float b = texture2D(uMap, clamp(uv - vec2(chromaOffset, 0.0), 0.002, 0.998)).b;
    float texAlpha = texture2D(uMap, clamp(uv, 0.002, 0.998)).a;

    vec3 texColor = vec3(r, g, b);

    // Fresnel edge glow
    vec3 viewDir = normalize(vViewPos);
    float ndotv = clamp(abs(dot(normalize(vNormalView), viewDir)), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 2.35);

    // Crisp HUD border frame
    float borderX = step(uv.x, 0.018) + step(0.982, uv.x);
    float borderY = step(uv.y, 0.025) + step(0.975, uv.y);
    float border = clamp(borderX + borderY, 0.0, 1.0);

    // Horizontal holographic scanlines
    float scan = 1.0 - uScanlineOpacity * (0.5 + 0.5 * sin(uv.y * 210.0 - uTime * 5.0));

    // Flicker envelope during state transition
    float flicker = 1.0 - uGlitch * 0.18 * (0.5 + 0.5 * sin(uTime * 54.0));

    vec3 glow = uAccentColor * (fresnel * 0.85 + border * (0.55 + uHover * 0.55));
    vec3 finalRgb = (texColor * scan + glow) * flicker;
    float finalAlpha = clamp((texAlpha * 0.88 + fresnel * 0.35 + border * 0.45) * uOpacity, 0.14, 0.98);

    gl_FragColor = vec4(finalRgb, finalAlpha);
  }
`;

export const HALO_WGSL_SHADER = /* wgsl */ `
// WebGPU WGSL Holographic Panel Shader (HALO)
struct HaloUniforms {
  time: f32,
  scanlineOpacity: f32,
  glitch: f32,
  opacity: f32,
  accentColor: vec3<f32>,
};

@group(0) @binding(0) var<uniform> u: HaloUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var panelTex: texture_2d<f32>;

@fragment
fn fs_main(@location(0) uv: vec2<f32>, @location(1) ndotv: f32) -> @location(0) vec4<f32> {
  let chroma = 0.002 + u.glitch * 0.008;
  let r = textureSample(panelTex, samp, clamp(uv + vec2<f32>(chroma, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).r;
  let g = textureSample(panelTex, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).g;
  let b = textureSample(panelTex, samp, clamp(uv - vec2<f32>(chroma, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).b;
  let a = textureSample(panelTex, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0))).a;
  let fresnel = pow(1.0 - clamp(abs(ndotv), 0.0, 1.0), 2.35);
  let scan = 1.0 - u.scanlineOpacity * (0.5 + 0.5 * sin(uv.y * 210.0 - u.time * 5.0));
  let rgb = vec3<f32>(r, g, b) * scan + u.accentColor * fresnel * 0.85;
  return vec4<f32>(rgb, clamp((a * 0.88 + fresnel * 0.35) * u.opacity, 0.14, 0.98));
}
`;
