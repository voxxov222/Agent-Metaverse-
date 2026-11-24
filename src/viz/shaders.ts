/**
 * Inline GLSL shaders for NeuralNetworkViz.
 * - Nodes: InstancedMesh with per-instance color, activation intensity, ambient breathing & drift.
 * - Edges: LineSegments with per-edge color, opacity, activity, and travelling synaptic light packets.
 */

export const NODE_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aColor;
  attribute float aIntensity;
  attribute float aPhase;

  uniform float uTime;
  uniform float uDriftAmp;
  uniform float uReducedMotion;

  varying vec3 vColor;
  varying float vIntensity;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vColor = aColor;
    vIntensity = aIntensity;

    // Gentle organic idle drift in instance space (muted if prefers-reduced-motion)
    float motion = 1.0 - uReducedMotion;
    vec4 worldBase = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 drift = vec3(
      sin(uTime * 0.65 + aPhase),
      cos(uTime * 0.52 + aPhase * 1.37),
      sin(uTime * 0.48 + aPhase * 0.79)
    ) * uDriftAmp * motion;

    // Ambient breathing scale pulse + excitation expansion
    float breathe = 1.0 + sin(uTime * 1.6 + aPhase) * 0.06 * motion;
    float pulseScale = breathe * (0.92 + clamp(aIntensity, 0.0, 1.6) * 0.48);

    vec3 localPos = position * pulseScale;
    vec4 worldPos = instanceMatrix * vec4(localPos, 1.0);
    worldPos.xyz += drift;

    vec4 mvPos = viewMatrix * worldPos;
    vViewPos = -mvPos.xyz;

    // Approximate view-space normal for crisp Fresnel halo
    mat3 normalMat = mat3(viewMatrix * instanceMatrix);
    vNormalView = normalize(normalMat * normal);

    gl_Position = projectionMatrix * mvPos;
  }
`;

export const NODE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uReducedMotion;

  varying vec3 vColor;
  varying float vIntensity;
  varying vec3 vNormalView;
  varying vec3 vViewPos;

  void main() {
    vec3 viewDir = normalize(vViewPos);
    float ndotv = clamp(dot(normalize(vNormalView), viewDir), 0.0, 1.0);
    float rim = pow(1.0 - ndotv, 2.2);
    float core = pow(ndotv, 0.7);

    float idleGlow = 0.55 + 0.12 * sin(uTime * 1.8) * (1.0 - uReducedMotion);
    float energy = idleGlow + vIntensity * 1.65;

    vec3 coreTint = mix(vColor, vec3(0.95, 0.98, 1.0), clamp(vIntensity * 0.45, 0.0, 0.72));
    vec3 finalRgb = coreTint * core * energy + vColor * rim * (0.95 + vIntensity * 1.7);

    float alpha = clamp(0.76 + vIntensity * 0.24 + rim * 0.25, 0.0, 1.0);
    gl_FragColor = vec4(finalRgb, alpha);
  }
`;

export const EDGE_VERTEX_SHADER = /* glsl */ `
  attribute float aProgress;
  attribute vec3 aEdgeColor;
  attribute float aEdgeOpacity;
  attribute float aEdgeActivity;
  attribute float aEdgeSeed;

  varying float vProgress;
  varying vec3 vEdgeColor;
  varying float vEdgeOpacity;
  varying float vEdgeActivity;
  varying float vEdgeSeed;

  void main() {
    vProgress = aProgress;
    vEdgeColor = aEdgeColor;
    vEdgeOpacity = aEdgeOpacity;
    vEdgeActivity = aEdgeActivity;
    vEdgeSeed = aEdgeSeed;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const EDGE_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uPulseDensity;
  uniform float uReducedMotion;

  varying float vProgress;
  varying vec3 vEdgeColor;
  varying float vEdgeOpacity;
  varying float vEdgeActivity;
  varying float vEdgeSeed;

  void main() {
    // Base synapse strand opacity
    float baseAlpha = clamp(vEdgeOpacity, 0.02, 1.0);
    float motion = 1.0 - uReducedMotion;

    // Travelling synaptic light packets source -> target
    // Idle: slow low-amplitude breathing packet; Active: fast dense bright packets
    float speed = mix(0.28, 2.25, clamp(vEdgeActivity, 0.0, 1.0)) * motion;
    float density = mix(1.0, 3.0 * uPulseDensity, clamp(vEdgeActivity, 0.0, 1.0));

    float phase = fract(vProgress * density - uTime * speed + vEdgeSeed);
    float packet = smoothstep(0.62, 0.92, phase) * (1.0 - smoothstep(0.92, 1.0, phase));

    // Ambient breathing wave even when reduced motion is enabled
    float idleBreath = 0.26 + 0.14 * sin(uTime * 1.4 + vEdgeSeed * 6.2831);
    float packetBrightness = mix(idleBreath, 2.1, clamp(vEdgeActivity, 0.0, 1.0)) * packet;

    vec3 packetColor = mix(vEdgeColor, vec3(0.96, 0.99, 1.0), 0.6 * clamp(vEdgeActivity, 0.0, 1.0));
    vec3 finalRgb = vEdgeColor * (0.72 + vEdgeActivity * 0.85) + packetColor * packetBrightness;
    float finalAlpha = clamp(baseAlpha * 1.25 + packetBrightness * (0.35 + vEdgeActivity * 0.75), 0.12, 1.0);

    gl_FragColor = vec4(finalRgb, finalAlpha);
  }
`;
