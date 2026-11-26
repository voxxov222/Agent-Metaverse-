import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Hand, Sliders, Crosshair, Activity, X } from 'lucide-react';
import {
  buildSyntheticHandLandmarks,
  computeCamMotionGrid,
  DEFAULT_ZIM_CONFIG,
  ZimHandStateTracker,
  type TrackedHandInput,
  type ZimHandSelection,
  type ZimTrackingConfig,
  type ZimTrackingFrame,
} from '../utils/zimHandTracker';

interface ZimHandCamOverlayProps {
  open: boolean;
  onClose: () => void;
  onFrame: (frame: ZimTrackingFrame) => void;
}

type TrackingSourceMode = 'idle' | 'webcam' | 'virtual';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const PREVIEW_W = 304;
const PREVIEW_H = 192;
const MOTION_W = 64;
const MOTION_H = 48;

export function ZimHandCamOverlay({ open, onClose, onFrame }: ZimHandCamOverlayProps) {
  const [sourceMode, setSourceMode] = useState<TrackingSourceMode>('idle');
  const [statusNote, setStatusNote] = useState<string>('Choose Webcam or Virtual Hand Pad');
  const [showMotionOverlay, setShowMotionOverlay] = useState(true);
  const [config, setConfig] = useState<ZimTrackingConfig>(DEFAULT_ZIM_CONFIG);
  const [hudReadout, setHudReadout] = useState<{
    cursorX: number;
    cursorY: number;
    cursorVisible: boolean;
    pinching: boolean;
    bothPinching: boolean;
    replaceCursor: boolean;
    leftVisible: boolean;
    leftX: number;
    leftY: number;
    leftPinching: boolean;
    rightVisible: boolean;
    rightX: number;
    rightY: number;
    rightPinching: boolean;
    twoHandDist: number | null;
    twoHandAngle: number | null;
    motionEnergy: number;
  }>({
    cursorX: 0.5,
    cursorY: 0.5,
    cursorVisible: false,
    pinching: false,
    bothPinching: false,
    replaceCursor: true,
    leftVisible: false,
    leftX: 0.35,
    leftY: 0.5,
    leftPinching: false,
    rightVisible: false,
    rightX: 0.65,
    rightY: 0.5,
    rightPinching: false,
    twoHandDist: null,
    twoHandAngle: null,
    motionEnergy: 0,
  });

  // Virtual Hand Simulator interactive targets (normalized 0..1)
  const [vRightPos, setVRightPos] = useState({ x: 0.52, y: 0.56 });
  const [vRightPinch, setVRightPinch] = useState(false);
  const [vLeftEnabled, setVLeftEnabled] = useState(false);
  const [vLeftPos, setVLeftPos] = useState({ x: 0.32, y: 0.56 });
  const [vLeftPinch, setVLeftPinch] = useState(false);
  const [activeVirtualPad, setActiveVirtualPad] = useState<'right' | 'left' | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackerRef = useRef<ZimHandStateTracker>(new ZimHandStateTracker(DEFAULT_ZIM_CONFIG));
  const streamRef = useRef<MediaStream | null>(null);
  const handLandmarkerRef = useRef<{
    detectForVideo: (video: HTMLVideoElement, ts: number) => {
      landmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
      handednesses?: Array<Array<{ categoryName?: string }>>;
    };
    close?: () => void;
  } | null>(null);

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;
  const showMotionRef = useRef(showMotionOverlay);
  showMotionRef.current = showMotionOverlay;
  const virtualStateRef = useRef({ vRightPos, vRightPinch, vLeftEnabled, vLeftPos, vLeftPinch });
  virtualStateRef.current = { vRightPos, vRightPinch, vLeftEnabled, vLeftPos, vLeftPinch };

  useEffect(() => {
    trackerRef.current.updateConfig(config);
  }, [config]);

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (handLandmarkerRef.current?.close) {
      try {
        handLandmarkerRef.current.close();
      } catch {
        // ignore
      }
      handLandmarkerRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopWebcam();
      setSourceMode('idle');
    }
    return () => {
      stopWebcam();
    };
  }, [open]);

  async function startWebcam() {
    stopWebcam();
    setStatusNote('Requesting camera permission...');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera API unavailable in this context');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setSourceMode('webcam');
      setStatusNote('Webcam active · Loading HandLandmarker...');

      // Load MediaPipe HandLandmarker using locally bundled WASM + model fallback to CamMotion optical-flow
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
        const landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
        handLandmarkerRef.current = landmarker;
        setStatusNote('21-pt HandLandmarker + CamMotion active');
      } catch {
        // Offline / blocked CDN fallback: ZIM CamMotion optical-flow tracks live motion centroid seamlessly
        setStatusNote('CamMotion Optical-Flow active (offline mode)');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera permission denied';
      setStatusNote(`Webcam unavailable (${msg}) · Switched to Virtual Hand Pad`);
      setSourceMode('virtual');
      trackerRef.current.updateConfig({ flip: false });
    }
  }

  function startVirtualPad() {
    stopWebcam();
    trackerRef.current.reset();
    trackerRef.current.updateConfig({ flip: false });
    setConfig((prev) => ({ ...prev, flip: false }));
    setSourceMode('virtual');
    setStatusNote('Virtual Hand Pad active · Drag & Pinch directly into 3D scene');
  }

  // Main real-time tracking & canvas HUD render loop
  useEffect(() => {
    if (!open || sourceMode === 'idle') return;

    let rafId = 0;
    let lastUiSync = 0;
    let prevGray: Uint8Array | null = null;
    const motionCanvas = document.createElement('canvas');
    motionCanvas.width = MOTION_W;
    motionCanvas.height = MOTION_H;
    const motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });

    const step = () => {
      const now = performance.now();
      const canvas = previewCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      let motionEnergy = 0;
      let motionCells: number[] = [];
      let detected: TrackedHandInput[] = [];

      if (sourceModeRef.current === 'webcam' && videoRef.current && videoRef.current.readyState >= 2) {
        const video = videoRef.current;
        // 1. CamMotion frame-difference optical flow
        if (motionCtx) {
          motionCtx.save();
          if (trackerRef.current.getConfig().flip) {
            motionCtx.scale(-1, 1);
            motionCtx.drawImage(video, -MOTION_W, 0, MOTION_W, MOTION_H);
          } else {
            motionCtx.drawImage(video, 0, 0, MOTION_W, MOTION_H);
          }
          motionCtx.restore();
          const img = motionCtx.getImageData(0, 0, MOTION_W, MOTION_H).data;
          const currGray = new Uint8Array(MOTION_W * MOTION_H);
          for (let i = 0; i < currGray.length; i++) {
            const p = i * 4;
            currGray[i] = (img[p] * 77 + img[p + 1] * 150 + img[p + 2] * 29) >> 8;
          }
          if (prevGray) {
            const res = computeCamMotionGrid(prevGray, currGray, MOTION_W, MOTION_H, 12, 8, 20);
            motionEnergy = res.energy;
            motionCells = res.gridEnergies;
            // If HandLandmarker isn't loaded (offline fallback), drive single-hand optical centroid
            if (!handLandmarkerRef.current && res.centroid && res.energy > 0.08) {
              const cx = trackerRef.current.getConfig().flip ? 1 - res.centroid.x : res.centroid.x;
              const cy = res.centroid.y;
              detected.push({
                handedness: 'right',
                landmarks: buildSyntheticHandLandmarks(
                  { x: cx, y: cy },
                  { x: Math.min(1, cx + 0.08), y: Math.min(1, cy + 0.08) },
                  'right',
                ),
              });
            }
          }
          prevGray = currGray;
        }

        // 2. Real 21-point MediaPipe HandLandmarker detection
        if (handLandmarkerRef.current) {
          try {
            const res = handLandmarkerRef.current.detectForVideo(video, now);
            const lmList = res.landmarks ?? [];
            const hdList = res.handednesses ?? [];
            detected = [];
            for (let i = 0; i < lmList.length; i++) {
              const label = hdList[i]?.[0]?.categoryName?.toLowerCase() === 'left' ? 'left' : 'right';
              detected.push({ handedness: label, landmarks: lmList[i] });
            }
          } catch {
            // Ignore transient video timestamp errors
          }
        }
      } else if (sourceModeRef.current === 'virtual') {
        const v = virtualStateRef.current;
        const rIdx = v.vRightPos;
        const rThumb = v.vRightPinch
          ? { x: rIdx.x + 0.008, y: rIdx.y + 0.008 }
          : { x: Math.max(0, rIdx.x - 0.075), y: Math.min(1, rIdx.y + 0.085) };
        detected.push({
          handedness: 'right',
          landmarks: buildSyntheticHandLandmarks(rIdx, rThumb, 'right'),
        });

        if (v.vLeftEnabled) {
          const lIdx = v.vLeftPos;
          const lThumb = v.vLeftPinch
            ? { x: lIdx.x - 0.008, y: lIdx.y + 0.008 }
            : { x: Math.min(1, lIdx.x + 0.075), y: Math.min(1, lIdx.y + 0.085) };
          detected.push({
            handedness: 'left',
            landmarks: buildSyntheticHandLandmarks(lIdx, lThumb, 'left'),
          });
        }
      }

      const frame = trackerRef.current.update(detected, now);
      if (frame.replaceToggled) {
        setConfig((prev) => ({ ...prev, replaceCursor: frame.replaceCursor }));
      }
      onFrameRef.current(frame);

      // Draw Live Tracking Preview Canvas
      if (ctx) {
        ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
        if (sourceModeRef.current === 'webcam' && videoRef.current && videoRef.current.readyState >= 2) {
          ctx.save();
          if (trackerRef.current.getConfig().flip) {
            ctx.scale(-1, 1);
            ctx.drawImage(videoRef.current, -PREVIEW_W, 0, PREVIEW_W, PREVIEW_H);
          } else {
            ctx.drawImage(videoRef.current, 0, 0, PREVIEW_W, PREVIEW_H);
          }
          ctx.restore();
          ctx.fillStyle = 'rgba(6, 12, 24, 0.28)';
          ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
        } else {
          // Virtual Spatial Grid Calibration Surface
          ctx.fillStyle = '#070d19';
          ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
          ctx.strokeStyle = 'rgba(34, 211, 238, 0.14)';
          ctx.lineWidth = 1;
          for (let gx = 0; gx <= PREVIEW_W; gx += 38) {
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, PREVIEW_H);
            ctx.stroke();
          }
          for (let gy = 0; gy <= PREVIEW_H; gy += 32) {
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(PREVIEW_W, gy);
            ctx.stroke();
          }
        }

        // Optional CamMotion Grid Heatmap
        if (showMotionRef.current && motionCells.length === 96) {
          const cw = PREVIEW_W / 12;
          const ch = PREVIEW_H / 8;
          for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 12; c++) {
              const e = motionCells[r * 12 + c];
              if (e > 0.1) {
                ctx.fillStyle = `rgba(34, 211, 238, ${(e * 0.42).toFixed(2)})`;
                ctx.fillRect(c * cw + 1, r * ch + 1, cw - 2, ch - 2);
              }
            }
          }
        }

        // Draw Left & Right ZIM Hand Skeleton + Finger / Thumb / Pinch Circles
        const drawHand = (side: 'left' | 'right', color: string) => {
          const st = frame.hands[side];
          if (!st.visible) return;
          if (st.landmarks.length >= 21) {
            ctx.strokeStyle = `${color}88`;
            ctx.lineWidth = 1.6;
            for (const [a, b] of HAND_CONNECTIONS) {
              const pA = st.landmarks[a];
              const pB = st.landmarks[b];
              ctx.beginPath();
              ctx.moveTo(pA.x * PREVIEW_W, pA.y * PREVIEW_H);
              ctx.lineTo(pB.x * PREVIEW_W, pB.y * PREVIEW_H);
              ctx.stroke();
            }
            ctx.fillStyle = color;
            for (let k = 0; k < st.landmarks.length; k++) {
              const pt = st.landmarks[k];
              ctx.beginPath();
              ctx.arc(pt.x * PREVIEW_W, pt.y * PREVIEW_H, k === 4 || k === 8 ? 3.5 : 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Thumb circle
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(st.thumb.x * PREVIEW_W, st.thumb.y * PREVIEW_H, 6, 0, Math.PI * 2);
          ctx.stroke();

          // Index Finger circle
          ctx.beginPath();
          ctx.arc(st.finger.x * PREVIEW_W, st.finger.y * PREVIEW_H, 7, 0, Math.PI * 2);
          ctx.stroke();

          // Merged ZIM Pinch Circle
          if (st.pinching) {
            ctx.fillStyle = 'rgba(52, 211, 153, 0.35)';
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(st.pinchPoint.x * PREVIEW_W, st.pinchPoint.y * PREVIEW_H, 13, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        };

        drawHand('left', '#10b981');
        drawHand('right', '#22d3ee');

        // Two-hand span line
        if (frame.hands.left.visible && frame.hands.right.visible) {
          ctx.strokeStyle = frame.bothPinching ? '#f472b6' : 'rgba(226, 232, 240, 0.55)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(frame.hands.left.pinchPoint.x * PREVIEW_W, frame.hands.left.pinchPoint.y * PREVIEW_H);
          ctx.lineTo(frame.hands.right.pinchPoint.x * PREVIEW_W, frame.hands.right.pinchPoint.y * PREVIEW_H);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (now - lastUiSync > 32) {
        lastUiSync = now;
        setHudReadout({
          cursorX: frame.cursor.x,
          cursorY: frame.cursor.y,
          cursorVisible: frame.cursor.visible,
          pinching: frame.cursor.pinching,
          bothPinching: frame.bothPinching,
          replaceCursor: frame.replaceCursor,
          leftVisible: frame.hands.left.visible,
          leftX: frame.hands.left.pinchPoint.x,
          leftY: frame.hands.left.pinchPoint.y,
          leftPinching: frame.hands.left.pinching,
          rightVisible: frame.hands.right.visible,
          rightX: frame.hands.right.pinchPoint.x,
          rightY: frame.hands.right.pinchPoint.y,
          rightPinching: frame.hands.right.pinching,
          twoHandDist: frame.twoHandDistance,
          twoHandAngle: frame.twoHandAngleDeg,
          motionEnergy,
        });
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [open, sourceMode]);

  if (!open) return null;

  const updateVirtualCoord = (clientX: number, clientY: number, rect: DOMRect, pad: 'right' | 'left') => {
    const nx = Math.max(0.04, Math.min(0.96, (clientX - rect.left) / rect.width));
    const ny = Math.max(0.06, Math.min(0.94, (clientY - rect.top) / rect.height));
    if (pad === 'right') setVRightPos({ x: nx, y: ny });
    else setVLeftPos({ x: nx, y: ny });
  };

  return (
    <>
      {/* Hidden video element for webcam MediaPipe / CamMotion feed */}
      <video ref={videoRef} playsInline muted className="hidden" />

      {/* Full-screen Spatial Hand Reticle (when Replace Cursor is active) */}
      {sourceMode !== 'idle' && hudReadout.cursorVisible && hudReadout.replaceCursor && (
        <div
          aria-hidden="true"
          className="fixed inset-0 pointer-events-none z-40 overflow-hidden"
        >
          {/* Primary Spatial Hand Cursor */}
          <div
            style={{
              left: `${(hudReadout.cursorX * 100).toFixed(2)}%`,
              top: `${(hudReadout.cursorY * 100).toFixed(2)}%`,
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
          >
            <div
              className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${
                hudReadout.bothPinching
                  ? 'border-pink-400 bg-pink-500/20 scale-125'
                  : hudReadout.pinching
                    ? 'border-emerald-400 bg-emerald-500/25 scale-110'
                    : 'border-cyan-400 bg-cyan-500/10'
              }`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  hudReadout.bothPinching
                    ? 'bg-pink-300'
                    : hudReadout.pinching
                      ? 'bg-emerald-300'
                      : 'bg-cyan-300'
                }`}
              />
            </div>
            <div className="mt-1 px-1.5 py-0.5 rounded bg-[#070b14]/90 border border-slate-700 text-[10px] font-mono text-center text-cyan-200 whitespace-nowrap">
              {hudReadout.bothPinching ? '2-HAND ZOOM/ROTATE' : hudReadout.pinching ? 'PINCH GRAB' : 'HAND CURSOR'}
            </div>
          </div>

          {/* Secondary Left Hand Marker during dual-hand tracking */}
          {hudReadout.leftVisible && hudReadout.rightVisible && (
            <div
              style={{
                left: `${(hudReadout.leftX * 100).toFixed(2)}%`,
                top: `${(hudReadout.leftY * 100).toFixed(2)}%`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-2 border-emerald-400 bg-emerald-500/20"
            />
          )}
        </div>
      )}

      {/* ZIM-Cam Hand Tracking PIP Control Deck */}
      <section
        aria-label="ZIM-Cam Hand Tracking Deck"
        className="fixed bottom-20 left-4 z-30 w-[332px] bg-[#0A0F1B]/96 border border-cyan-500/40 rounded-xl shadow-2xl overflow-hidden text-xs text-slate-200"
      >
        <div className="flex items-center justify-between px-3 py-2 bg-slate-900/90 border-b border-slate-800">
          <div className="flex items-center gap-2 font-semibold text-cyan-200">
            <Hand className="w-4 h-4 text-cyan-400" />
            <span>ZIM-Cam Hand Tracker</span>
          </div>
          <button
            type="button"
            aria-label="Close Hand Tracker"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="p-3 space-y-2.5">
          {sourceMode === 'idle' ? (
            /* CamAsk Permission / Launch Prompt */
            <div className="space-y-2.5 text-slate-300">
              <p className="text-[11px] leading-relaxed text-slate-300">
                Control 3D props with bare hands: pinch to grab &amp; stack objects, quick-pinch to click UI, or
                pinch both hands to zoom &amp; rotate.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void startWebcam()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-400 text-slate-950 font-semibold hover:bg-cyan-300 cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Enable Camera</span>
                </button>
                <button
                  type="button"
                  onClick={startVirtualPad}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 border border-cyan-500/50 text-cyan-200 font-semibold hover:bg-slate-700 cursor-pointer"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  <span>Virtual Hand Pad</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Live Preview / Virtual Pad Surface */}
              <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-[#070d19]">
                <canvas
                  ref={previewCanvasRef}
                  width={PREVIEW_W}
                  height={PREVIEW_H}
                  className="block w-full h-[192px] touch-none"
                  onPointerDown={(e) => {
                    if (sourceMode !== 'virtual') return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nx = (e.clientX - rect.left) / rect.width;
                    const pad: 'right' | 'left' =
                      vLeftEnabled && Math.abs(nx - vLeftPos.x) < Math.abs(nx - vRightPos.x) ? 'left' : 'right';
                    setActiveVirtualPad(pad);
                    updateVirtualCoord(e.clientX, e.clientY, rect, pad);
                  }}
                  onPointerMove={(e) => {
                    if (sourceMode !== 'virtual' || !activeVirtualPad) return;
                    updateVirtualCoord(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), activeVirtualPad);
                  }}
                  onPointerUp={() => setActiveVirtualPad(null)}
                  onPointerLeave={() => setActiveVirtualPad(null)}
                />

                <div className="absolute top-1.5 left-2 right-2 flex items-center justify-between pointer-events-none text-[10px] font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/85 border border-slate-700 text-cyan-200">
                    {sourceMode === 'webcam' ? 'CAM LIVE' : 'VIRTUAL CALIBRATOR'}
                  </span>
                  {hudReadout.twoHandDist !== null && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-950/85 border border-pink-500/40 text-pink-200">
                      SPAN {(hudReadout.twoHandDist * 100).toFixed(0)}% · {hudReadout.twoHandAngle?.toFixed(0)}°
                    </span>
                  )}
                </div>
              </div>

              {/* Status & Quick Gesture Action Row */}
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span className="truncate text-cyan-300">{statusNote}</span>
                {sourceMode === 'webcam' ? (
                  <button
                    type="button"
                    onClick={startVirtualPad}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 hover:bg-slate-700 shrink-0 cursor-pointer"
                  >
                    Virtual Pad
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startWebcam()}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 hover:bg-slate-700 shrink-0 cursor-pointer flex items-center gap-1"
                  >
                    <CameraOff className="w-3 h-3" />
                    <span>Webcam</span>
                  </button>
                )}
              </div>

              {/* Virtual Hand Pinch Controls (when in Virtual Pad mode) */}
              {sourceMode === 'virtual' && (
                <div className="grid grid-cols-2 gap-1.5 p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setVRightPinch((p) => !p)}
                    className={`px-2 py-1.5 rounded font-semibold cursor-pointer ${
                      vRightPinch
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-800 border border-cyan-500/40 text-cyan-200'
                    }`}
                  >
                    {vRightPinch ? 'Right Pinch: HELD' : 'Right Pinch Grab'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!vLeftEnabled) {
                        setVLeftEnabled(true);
                        setVLeftPinch(true);
                      } else {
                        setVLeftPinch((p) => !p);
                      }
                    }}
                    className={`px-2 py-1.5 rounded font-semibold cursor-pointer ${
                      vLeftEnabled && vLeftPinch
                        ? 'bg-pink-500 text-slate-950'
                        : 'bg-slate-800 border border-slate-700 text-slate-300'
                    }`}
                  >
                    {vLeftEnabled ? (vLeftPinch ? 'Left Pinch: HELD' : 'Left Open') : '+ 2nd Hand'}
                  </button>
                </div>
              )}

              {/* ZIM-Cam Ergonomic Parameters (Hand mode, Cursor replace, CamMotion, Damp & Gain) */}
              <div className="grid grid-cols-3 gap-1">
                {(['both', 'right', 'left'] as ZimHandSelection[]).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, hand: h }))}
                    className={`py-1 rounded text-[11px] capitalize cursor-pointer border ${
                      config.hand === h
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, replaceCursor: !prev.replaceCursor }))}
                  className={`flex-1 py-1 px-2 rounded border text-[11px] cursor-pointer ${
                    config.replaceCursor
                      ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  Cursor: {config.replaceCursor ? 'ON' : 'OFF'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMotionOverlay((p) => !p)}
                  className={`flex-1 py-1 px-2 rounded border text-[11px] flex items-center justify-center gap-1 cursor-pointer ${
                    showMotionOverlay
                      ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                      : 'bg-slate-900 border-slate-800 text-slate-400'
                  }`}
                >
                  <Activity className="w-3 h-3" />
                  <span>CamMotion</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] text-slate-400">
                <label className="flex flex-col gap-1">
                  <span className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <Sliders className="w-3 h-3" /> Damp
                    </span>
                    <span className="text-slate-200">{config.damp.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min="0.1"
                    max="0.85"
                    step="0.05"
                    value={config.damp}
                    onChange={(e) => setConfig((prev) => ({ ...prev, damp: Number(e.target.value) }))}
                    className="accent-cyan-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="flex items-center justify-between">
                    <span>Gain</span>
                    <span className="text-slate-200">{config.sensitivity.toFixed(2)}x</span>
                  </span>
                  <input
                    type="range"
                    min="0.8"
                    max="1.8"
                    step="0.05"
                    value={config.sensitivity}
                    onChange={(e) => setConfig((prev) => ({ ...prev, sensitivity: Number(e.target.value) }))}
                    className="accent-cyan-400"
                  />
                </label>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
