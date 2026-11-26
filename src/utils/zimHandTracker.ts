export type ZimHandSelection = 'right' | 'left' | 'both';

export interface ZimPoint2D {
  x: number;
  y: number;
  z?: number;
}

export interface TrackedHandInput {
  handedness: 'left' | 'right';
  landmarks: ZimPoint2D[]; // Standard 21-point hand landmark topology (4=thumb tip, 8=index tip)
  confidence?: number;
}

export type ZimPinchPhase = 'none' | 'down' | 'move' | 'up' | 'tap';

export interface ZimHandTrackState {
  handedness: 'left' | 'right';
  visible: boolean;
  finger: { x: number; y: number };
  thumb: { x: number; y: number };
  pinchPoint: { x: number; y: number };
  pinchDistance: number;
  rawPinching: boolean;
  pinching: boolean;
  phase: ZimPinchPhase;
  landmarks: ZimPoint2D[];
  lastSeenMs: number;
}

export interface ZimTrackingConfig {
  hand: ZimHandSelection;
  damp: number; // 0.05 .. 0.90 (matches ZIM Damp)
  pinchThreshold: number; // Normalized distance threshold (default 0.058)
  tapTimeMs: number; // Default 300ms (matches zim-cam tapTime = 0.3)
  gapTimeMs: number; // Default 500ms dropout bridge (matches zim-cam gapTime = 0.5)
  toggleReplace: boolean; // Touching both pinches together toggles cursor replacement
  replaceCursor: boolean;
  sensitivity: number; // 0.8 .. 1.8 reach gain around center (0.5, 0.5)
  flip: boolean; // Mirror horizontally for natural selfie view
}

export interface ZimTrackingFrame {
  timestampMs: number;
  hands: {
    left: ZimHandTrackState;
    right: ZimHandTrackState;
  };
  primaryHand: 'left' | 'right';
  cursor: {
    x: number;
    y: number;
    visible: boolean;
    pinching: boolean;
    phase: ZimPinchPhase;
  };
  twoHandDistance: number | null;
  twoHandAngleDeg: number | null;
  bothPinching: boolean;
  twoHandZoomDelta: number;
  twoHandAngleDeltaDeg: number;
  replaceCursor: boolean;
  replaceToggled: boolean;
}

export interface CamMotionResult {
  energy: number; // 0..1 normalized frame change
  centroid: { x: number; y: number } | null; // Normalized [0..1]
  gridEnergies: number[];
  cols: number;
  rows: number;
  activeCells: number;
}

export const DEFAULT_ZIM_CONFIG: ZimTrackingConfig = {
  hand: 'both',
  damp: 0.45,
  pinchThreshold: 0.062,
  tapTimeMs: 300,
  gapTimeMs: 500,
  toggleReplace: true,
  replaceCursor: true,
  sensitivity: 1.18,
  flip: true,
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class ZimDamp {
  public value: number;
  public damp: number;

  constructor(startValue = 0, damp = 0.5) {
    this.value = startValue;
    this.damp = damp;
  }

  immediate(val: number): number {
    this.value = val;
    return this.value;
  }

  convert(target: number, dtScale = 1): number {
    const clampedDamp = Math.max(0.02, Math.min(0.95, this.damp));
    const alpha = 1 - Math.pow(clampedDamp, Math.max(0.15, Math.min(3, dtScale)));
    this.value += (target - this.value) * alpha;
    return this.value;
  }
}

export function getDistance2D(a: ZimPoint2D, b: ZimPoint2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function getAngleDeg2D(a: ZimPoint2D, b: ZimPoint2D): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

function normalizeAngleDeltaDeg(nextDeg: number, prevDeg: number): number {
  let d = nextDeg - prevDeg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

interface InternalHandFilters {
  fingerX: ZimDamp;
  fingerY: ZimDamp;
  thumbX: ZimDamp;
  thumbY: ZimDamp;
  initialized: boolean;
  wasPinching: boolean;
  pinchStartMs: number;
  pinchEndPendingMs: number | null;
  lastSeenMs: number;
  landmarks: ZimPoint2D[];
}

function makeInternalHand(damp: number): InternalHandFilters {
  return {
    fingerX: new ZimDamp(0.5, damp),
    fingerY: new ZimDamp(0.5, damp),
    thumbX: new ZimDamp(0.5, damp),
    thumbY: new ZimDamp(0.5, damp),
    initialized: false,
    wasPinching: false,
    pinchStartMs: 0,
    pinchEndPendingMs: null,
    lastSeenMs: -1,
    landmarks: [],
  };
}

export class ZimHandStateTracker {
  private config: ZimTrackingConfig;
  private internal: Record<'left' | 'right', InternalHandFilters>;
  private lastToggleCheckMs = 0;
  private lastTwoPinchDist: number | null = null;
  private lastTwoPinchAngle: number | null = null;
  private lastUpdateMs = 0;

  constructor(config: Partial<ZimTrackingConfig> = {}) {
    this.config = { ...DEFAULT_ZIM_CONFIG, ...config };
    this.internal = {
      left: makeInternalHand(this.config.damp),
      right: makeInternalHand(this.config.damp),
    };
  }

  getConfig(): ZimTrackingConfig {
    return { ...this.config };
  }

  updateConfig(patch: Partial<ZimTrackingConfig>): void {
    this.config = { ...this.config, ...patch };
    for (const side of ['left', 'right'] as const) {
      this.internal[side].fingerX.damp = this.config.damp;
      this.internal[side].fingerY.damp = this.config.damp;
      this.internal[side].thumbX.damp = this.config.damp;
      this.internal[side].thumbY.damp = this.config.damp;
    }
  }

  reset(): void {
    this.internal.left = makeInternalHand(this.config.damp);
    this.internal.right = makeInternalHand(this.config.damp);
    this.lastTwoPinchDist = null;
    this.lastTwoPinchAngle = null;
    this.lastUpdateMs = 0;
  }

  private mapCoordinate(raw: ZimPoint2D): ZimPoint2D {
    const mx = this.config.flip ? 1 - raw.x : raw.x;
    const my = raw.y;
    const gain = this.config.sensitivity;
    return {
      x: clamp01(0.5 + (mx - 0.5) * gain),
      y: clamp01(0.5 + (my - 0.5) * gain),
      z: raw.z,
    };
  }

  update(detectedHands: TrackedHandInput[], timestampMs: number): ZimTrackingFrame {
    const dtMs = this.lastUpdateMs > 0 ? Math.max(4, Math.min(120, timestampMs - this.lastUpdateMs)) : 16.67;
    this.lastUpdateMs = timestampMs;
    const dtScale = dtMs / 16.67;

    const bySide: Partial<Record<'left' | 'right', TrackedHandInput>> = {};
    for (const h of detectedHands) {
      if (h.landmarks.length >= 9) {
        // Flip handedness label when camera feed is mirrored horizontally so user's physical right hand reads as 'right'
        const effectiveSide: 'left' | 'right' = this.config.flip
          ? h.handedness === 'left'
            ? 'right'
            : 'left'
          : h.handedness;
        if (!bySide[effectiveSide]) {
          bySide[effectiveSide] = h;
        }
      }
    }

    const states: Record<'left' | 'right', ZimHandTrackState> = {
      left: this.stepHand('left', bySide.left, timestampMs, dtScale),
      right: this.stepHand('right', bySide.right, timestampMs, dtScale),
    };

    // Determine primary active hand respecting configured selection
    let primaryHand: 'left' | 'right' = 'right';
    if (this.config.hand === 'left') {
      primaryHand = 'left';
    } else if (this.config.hand === 'right') {
      primaryHand = 'right';
    } else {
      if (states.right.visible && (states.right.pinching || !states.left.visible || !states.left.pinching)) {
        primaryHand = 'right';
      } else if (states.left.visible) {
        primaryHand = 'left';
      }
    }

    const activeState = states[primaryHand];

    // Two-hand span & angle metrics (ported from zim-cam getDistance / getAngle)
    let twoHandDistance: number | null = null;
    let twoHandAngleDeg: number | null = null;
    let twoHandZoomDelta = 0;
    let twoHandAngleDeltaDeg = 0;
    let replaceToggled = false;

    const bothVisible = states.left.visible && states.right.visible && this.config.hand === 'both';
    const bothPinching = bothVisible && states.left.pinching && states.right.pinching;

    if (bothVisible) {
      twoHandDistance = getDistance2D(states.left.pinchPoint, states.right.pinchPoint);
      twoHandAngleDeg = getAngleDeg2D(states.left.pinchPoint, states.right.pinchPoint);

      // Dual-hand pinch touch toggles cursor replacement with 500ms cooldown (zim-cam toggleReplace)
      if (
        this.config.toggleReplace &&
        bothPinching &&
        twoHandDistance < this.config.pinchThreshold * 1.4 &&
        timestampMs - this.lastToggleCheckMs > 650
      ) {
        this.lastToggleCheckMs = timestampMs;
        this.config.replaceCursor = !this.config.replaceCursor;
        replaceToggled = true;
      }
    }

    if (bothPinching && twoHandDistance !== null && twoHandAngleDeg !== null) {
      if (this.lastTwoPinchDist !== null && this.lastTwoPinchAngle !== null) {
        twoHandZoomDelta = twoHandDistance - this.lastTwoPinchDist;
        twoHandAngleDeltaDeg = normalizeAngleDeltaDeg(twoHandAngleDeg, this.lastTwoPinchAngle);
      }
      this.lastTwoPinchDist = twoHandDistance;
      this.lastTwoPinchAngle = twoHandAngleDeg;
    } else {
      this.lastTwoPinchDist = null;
      this.lastTwoPinchAngle = null;
    }

    return {
      timestampMs,
      hands: states,
      primaryHand,
      cursor: {
        x: activeState.pinching ? activeState.pinchPoint.x : activeState.finger.x,
        y: activeState.pinching ? activeState.pinchPoint.y : activeState.finger.y,
        visible: activeState.visible,
        pinching: activeState.pinching,
        phase: activeState.phase,
      },
      twoHandDistance,
      twoHandAngleDeg,
      bothPinching,
      twoHandZoomDelta,
      twoHandAngleDeltaDeg,
      replaceCursor: this.config.replaceCursor,
      replaceToggled,
    };
  }

  private stepHand(
    side: 'left' | 'right',
    input: TrackedHandInput | undefined,
    timestampMs: number,
    dtScale: number,
  ): ZimHandTrackState {
    const f = this.internal[side];
    const handAllowed = this.config.hand === 'both' || this.config.hand === side;

    if (!handAllowed || !input || input.landmarks.length < 9) {
      // Allow gapTimeMs dropout grace period when already pinching
      let phase: ZimPinchPhase = 'none';
      let pinching = false;
      if (handAllowed && f.wasPinching) {
        if (f.pinchEndPendingMs === null) {
          f.pinchEndPendingMs = f.lastSeenMs > 0 ? f.lastSeenMs : timestampMs;
        }
        if (timestampMs - f.pinchEndPendingMs <= this.config.gapTimeMs) {
          pinching = true;
          phase = 'move';
        } else {
          f.wasPinching = false;
          f.pinchEndPendingMs = null;
          phase = 'up';
        }
      }

      const visible = handAllowed && f.lastSeenMs > 0 && timestampMs - f.lastSeenMs <= this.config.gapTimeMs;
      return {
        handedness: side,
        visible,
        finger: { x: f.fingerX.value, y: f.fingerY.value },
        thumb: { x: f.thumbX.value, y: f.thumbY.value },
        pinchPoint: {
          x: (f.fingerX.value + f.thumbX.value) * 0.5,
          y: (f.fingerY.value + f.thumbY.value) * 0.5,
        },
        pinchDistance: getDistance2D(
          { x: f.fingerX.value, y: f.fingerY.value },
          { x: f.thumbX.value, y: f.thumbY.value },
        ),
        rawPinching: false,
        pinching,
        phase,
        landmarks: visible ? f.landmarks : [],
        lastSeenMs: f.lastSeenMs,
      };
    }

    const mappedLandmarks = input.landmarks.map((pt) => this.mapCoordinate(pt));
    const rawThumb = mappedLandmarks[4];
    const rawIndex = mappedLandmarks[8];

    if (!f.initialized || timestampMs - f.lastSeenMs > 700) {
      f.fingerX.immediate(rawIndex.x);
      f.fingerY.immediate(rawIndex.y);
      f.thumbX.immediate(rawThumb.x);
      f.thumbY.immediate(rawThumb.y);
      f.initialized = true;
    } else {
      f.fingerX.convert(rawIndex.x, dtScale);
      f.fingerY.convert(rawIndex.y, dtScale);
      f.thumbX.convert(rawThumb.x, dtScale);
      f.thumbY.convert(rawThumb.y, dtScale);
    }

    f.lastSeenMs = timestampMs;
    f.landmarks = mappedLandmarks;

    const finger = { x: f.fingerX.value, y: f.fingerY.value };
    const thumb = { x: f.thumbX.value, y: f.thumbY.value };
    const pinchPoint = { x: (finger.x + thumb.x) * 0.5, y: (finger.y + thumb.y) * 0.5 };
    const pinchDistance = getDistance2D(finger, thumb);

    // Normalize threshold dynamically slightly by hand scale (wrist 0 -> index MCP 5) when available
    let effectiveThreshold = this.config.pinchThreshold;
    if (mappedLandmarks.length > 5) {
      const palmSpan = getDistance2D(mappedLandmarks[0], mappedLandmarks[5]);
      if (palmSpan > 0.04) {
        effectiveThreshold = Math.max(0.036, Math.min(0.11, palmSpan * 0.34 * (this.config.pinchThreshold / 0.062)));
      }
    }

    // Hysteresis: slightly easier to keep pinching once grabbed
    const releaseThreshold = effectiveThreshold * 1.28;
    const rawPinching = f.wasPinching ? pinchDistance <= releaseThreshold : pinchDistance <= effectiveThreshold;

    let phase: ZimPinchPhase = 'none';
    let pinching = rawPinching;

    if (rawPinching) {
      f.pinchEndPendingMs = null;
      if (!f.wasPinching) {
        f.wasPinching = true;
        f.pinchStartMs = timestampMs;
        phase = 'down';
      } else {
        phase = 'move';
      }
    } else if (f.wasPinching) {
      const heldDuration = timestampMs - f.pinchStartMs;
      // Exact zim-cam tapTime optimization: short tap fires immediately without waiting for gapTimeMs!
      if (heldDuration <= this.config.tapTimeMs) {
        f.wasPinching = false;
        f.pinchEndPendingMs = null;
        pinching = false;
        phase = 'tap';
      } else {
        if (f.pinchEndPendingMs === null) {
          f.pinchEndPendingMs = timestampMs;
        }
        if (timestampMs - f.pinchEndPendingMs <= this.config.gapTimeMs) {
          pinching = true;
          phase = 'move';
        } else {
          f.wasPinching = false;
          f.pinchEndPendingMs = null;
          pinching = false;
          phase = 'up';
        }
      }
    }

    return {
      handedness: side,
      visible: true,
      finger,
      thumb,
      pinchPoint,
      pinchDistance,
      rawPinching,
      pinching,
      phase,
      landmarks: mappedLandmarks,
      lastSeenMs: f.lastSeenMs,
    };
  }
}

/**
 * Optical-flow frame-difference motion grid detector (ported from ZIM CamMotion).
 * Runs 100% locally on grayscale pixel buffers without requiring external ML weights.
 */
export function computeCamMotionGrid(
  prevGray: Uint8Array,
  currGray: Uint8Array,
  width: number,
  height: number,
  cols = 12,
  rows = 9,
  threshold = 22,
): CamMotionResult {
  const cellCount = cols * rows;
  const sums = new Float32Array(cellCount);
  const counts = new Uint32Array(cellCount);
  const len = Math.min(prevGray.length, currGray.length, width * height);

  for (let i = 0; i < len; i++) {
    const diff = Math.abs(currGray[i] - prevGray[i]);
    const px = i % width;
    const py = (i / width) | 0;
    const cx = Math.min(cols - 1, ((px * cols) / width) | 0);
    const cy = Math.min(rows - 1, ((py * rows) / height) | 0);
    const idx = cy * cols + cx;
    counts[idx]++;
    if (diff >= threshold) {
      sums[idx] += diff;
    }
  }

  const gridEnergies: number[] = new Array(cellCount);
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  let activeCells = 0;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cy * cols + cx;
      const denom = Math.max(1, counts[idx] * 255);
      const cellEnergy = Math.min(1, (sums[idx] / denom) * 4.5);
      gridEnergies[idx] = cellEnergy;
      if (cellEnergy > 0.08) {
        activeCells++;
        weightedX += ((cx + 0.5) / cols) * cellEnergy;
        weightedY += ((cy + 0.5) / rows) * cellEnergy;
        totalWeight += cellEnergy;
      }
    }
  }

  return {
    energy: Math.min(1, totalWeight / Math.max(1, cellCount * 0.25)),
    centroid: totalWeight > 0.05 ? { x: weightedX / totalWeight, y: weightedY / totalWeight } : null,
    gridEnergies,
    cols,
    rows,
    activeCells,
  };
}

/**
 * Generates an articulated 21-point synthetic hand skeleton around an index & thumb tip
 * so the Virtual Hand Calibrator renders authentic skeleton feedback alongside webcam tracking.
 */
export function buildSyntheticHandLandmarks(
  indexTip: ZimPoint2D,
  thumbTip: ZimPoint2D,
  side: 'left' | 'right',
): ZimPoint2D[] {
  const dir = side === 'right' ? 1 : -1;
  const midX = (indexTip.x + thumbTip.x) * 0.5;
  const midY = (indexTip.y + thumbTip.y) * 0.5;
  const wrist = { x: clamp01(midX + dir * 0.05), y: clamp01(midY + 0.14) };

  const lerpPt = (a: ZimPoint2D, b: ZimPoint2D, t: number, ox = 0, oy = 0): ZimPoint2D => ({
    x: clamp01(a.x + (b.x - a.x) * t + ox),
    y: clamp01(a.y + (b.y - a.y) * t + oy),
  });

  const l1 = lerpPt(wrist, thumbTip, 0.3, -dir * 0.02, -0.01);
  const l2 = lerpPt(wrist, thumbTip, 0.55, -dir * 0.015, -0.015);
  const l3 = lerpPt(wrist, thumbTip, 0.8, -dir * 0.008, -0.01);

  const l5 = lerpPt(wrist, indexTip, 0.48, -dir * 0.01, 0);
  const l6 = lerpPt(wrist, indexTip, 0.68, -dir * 0.005, 0);
  const l7 = lerpPt(wrist, indexTip, 0.86);

  const middleBase = { x: clamp01(l5.x + dir * 0.025), y: clamp01(l5.y + 0.005) };
  const middleTip = { x: clamp01(middleBase.x + dir * 0.015), y: clamp01(middleBase.y - 0.075) };

  const ringBase = { x: clamp01(middleBase.x + dir * 0.024), y: clamp01(middleBase.y + 0.01) };
  const ringTip = { x: clamp01(ringBase.x + dir * 0.012), y: clamp01(ringBase.y - 0.065) };

  const pinkyBase = { x: clamp01(ringBase.x + dir * 0.022), y: clamp01(ringBase.y + 0.016) };
  const pinkyTip = { x: clamp01(pinkyBase.x + dir * 0.012), y: clamp01(pinkyBase.y - 0.05) };

  return [
    wrist, // 0
    l1, // 1
    l2, // 2
    l3, // 3
    thumbTip, // 4
    l5, // 5
    l6, // 6
    l7, // 7
    indexTip, // 8
    middleBase, // 9
    lerpPt(middleBase, middleTip, 0.4), // 10
    lerpPt(middleBase, middleTip, 0.72), // 11
    middleTip, // 12
    ringBase, // 13
    lerpPt(ringBase, ringTip, 0.4), // 14
    lerpPt(ringBase, ringTip, 0.72), // 15
    ringTip, // 16
    pinkyBase, // 17
    lerpPt(pinkyBase, pinkyTip, 0.4), // 18
    lerpPt(pinkyBase, pinkyTip, 0.72), // 19
    pinkyTip, // 20
  ];
}
