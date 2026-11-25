import { useState } from 'react';
import {
  Users,
  Box,
  MapPin,
  MessageSquare,
  RotateCcw,
  RotateCw,
  Trash2,
  CheckCircle2,
  Clock,
  KeyRound,
  Server,
  ShieldAlert,
  Sparkles,
  Upload,
  Move,
  Crosshair,
  Film,
} from 'lucide-react';
import type {
  EnvironmentTheme,
  PhysicsGravityPreset,
  RoadmapItem,
  RoadmapItemStatus,
  ScreenProceduralPreset,
  SkyboxConfig,
  SkyboxPresetId,
  WorldChatMessage,
  WorldObject,
  WorldObjectMotion,
  WorldPlayer,
  WorldPropKind,
} from '../../types/os';
import {
  ENVIRONMENT_THEME_OPTIONS,
  SKYBOX_PRESETS,
} from '../../utils/worldEnhancements';
import { computeSupportTopY } from '../../scene/worldPhysics';

interface WorldRoadmapPanelProps {
  selfPlayerId: string | null;
  callsign: string;
  avatarColor: string;
  players: WorldPlayer[];
  worldObjects: WorldObject[];
  chatMessages: WorldChatMessage[];
  roadmap: RoadmapItem[];
  theme: EnvironmentTheme;
  skybox: SkyboxConfig;
  selectedWorldObjectId: string | null;
  objectDragMode: boolean;
  tapPlaceActive: boolean;
  gridSnap: boolean;
  gravityPreset: PhysicsGravityPreset;
  onChangeTheme: (theme: EnvironmentTheme) => void;
  onChangeSkybox: (skybox: SkyboxConfig) => void;
  onChangeGravity: (preset: PhysicsGravityPreset) => void;
  onPhysicsCommand: (cmd: { kind: 'drop' | 'nudge' | 'wake'; objectId?: string }) => void;
  onSelectWorldObject: (id: string | null) => void;
  onToggleObjectDragMode: () => void;
  onToggleTapPlace: () => void;
  onToggleGridSnap: () => void;
  onJoinUpdate: (callsign: string, avatarColor: string) => void;
  onEmote: (emote: WorldPlayer['emote']) => void;
  onSendChat: (text: string, radius: number) => void;
  onPlaceObject: (obj: {
    id?: string;
    kind: WorldPropKind;
    label: string;
    position: [number, number, number];
    rotationY: number;
    color: string;
    motion?: WorldObjectMotion;
    scale?: number;
    mediaUrl?: string;
    mediaType?: WorldObject['mediaType'];
    screenPreset?: ScreenProceduralPreset;
  }) => void;
  onUpdateObject: (
    id: string,
    patch: Partial<
      Pick<
        WorldObject,
        'label' | 'color' | 'motion' | 'scale' | 'mediaUrl' | 'mediaType' | 'screenPreset' | 'rotationY' | 'position'
      >
    >,
  ) => void;
  onRemoveObject: (id: string) => void;
}

const PROP_TEMPLATES: Array<{ kind: WorldPropKind; title: string }> = [
  { kind: 'quantum-workstation', title: 'Real Triple-Screen OS Rig' },
  { kind: 'holo-terrain-table', title: 'Holo-Terrain Tactical Table' },
  { kind: 'holo-hud-terminal', title: 'Floating Holo-HUD Terminal' },
  { kind: 'mainframe-rack', title: 'Supercomputer Blade Rack' },
  { kind: 'arch-portal', title: 'Architectural Command Arch' },
  { kind: 'quantum-crate', title: 'Quantum Stack Crate' },
  { kind: 'media-screen', title: 'Animated Media Screen' },
  { kind: 'holo-billboard', title: 'Wide Holo Billboard' },
  { kind: 'kinetic-sculpture', title: 'Kinetic Gyro Sculpture' },
  { kind: 'workstation-desk', title: 'Workstation Desk' },
  { kind: 'holo-kiosk', title: 'Holo Terminal Kiosk' },
  { kind: 'relay-beacon', title: 'Aether Relay Beacon' },
  { kind: 'data-monolith', title: 'Data Monolith' },
  { kind: 'lounge-pod', title: 'Collaboration Pod' },
];

const SKYBOX_PRESET_LABELS: Array<{ id: Exclude<SkyboxPresetId, 'theme-auto'>; label: string }> = [
  { id: 'aether-twilight', label: 'Aether Twilight' },
  { id: 'orbital-deep-space', label: 'Orbital Deep Space' },
  { id: 'aurora-horizon', label: 'Aurora Horizon' },
  { id: 'golden-canyon', label: 'Golden Canyon Dusk' },
  { id: 'cyber-neon-rain', label: 'Cyber Neon Storm' },
  { id: 'obsidian-studio', label: 'Obsidian Studio' },
];

export function WorldRoadmapPanel({
  selfPlayerId,
  callsign,
  avatarColor,
  players,
  worldObjects,
  chatMessages,
  roadmap,
  theme,
  skybox,
  selectedWorldObjectId,
  objectDragMode,
  tapPlaceActive,
  gridSnap,
  gravityPreset,
  onChangeTheme,
  onChangeSkybox,
  onChangeGravity,
  onPhysicsCommand,
  onSelectWorldObject,
  onToggleObjectDragMode,
  onToggleTapPlace,
  onToggleGridSnap,
  onJoinUpdate,
  onEmote,
  onSendChat,
  onPlaceObject,
  onUpdateObject,
  onRemoveObject,
}: WorldRoadmapPanelProps) {
  const [tab, setTab] = useState<'builder' | 'skybox' | 'presence' | 'roadmap'>('builder');

  // Presence & Chat state
  const [draftName, setDraftName] = useState(callsign);
  const [draftColor, setDraftColor] = useState(avatarColor);
  const [chatText, setChatText] = useState('');
  const [chatRadius, setChatRadius] = useState(18);

  // World Builder + Undo/Redo history
  const [propKind, setPropKind] = useState<WorldPropKind>('media-screen');
  const [propLabel, setPropLabel] = useState('Holo Media Display');
  const [propX, setPropX] = useState(3);
  const [propZ, setPropZ] = useState(4);
  const [propColor, setPropColor] = useState('#22d3ee');
  const [propMotion, setPropMotion] = useState<WorldObjectMotion>('static');
  const [propScreenPreset, setPropScreenPreset] = useState<ScreenProceduralPreset>('waveform');
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [undoStack, setUndoStack] = useState<Array<{ op: 'place' | 'remove'; obj: WorldObject }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ op: 'place' | 'remove'; obj: WorldObject }>>([]);

  const selfPlayer = players.find((p) => p.id === selfPlayerId);
  const selectedObj = worldObjects.find((o) => o.id === selectedWorldObjectId) ?? null;

  function distanceFromSelf(pos: [number, number, number]): number | null {
    if (!selfPlayer) return null;
    return Math.hypot(pos[0] - selfPlayer.position[0], pos[2] - selfPlayer.position[2]);
  }

  function handlePlaceNewObject(e: React.FormEvent) {
    e.preventDefault();
    const id = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const now = Date.now();
    const dropY = Number((computeSupportTopY(propX, propZ, null, worldObjects) + 1.1).toFixed(2));
    const created: WorldObject = {
      id,
      kind: propKind,
      label: propLabel.trim() || propKind,
      position: [propX, propMotion === 'static' ? dropY : 0, propZ],
      rotationY: 0,
      color: propColor,
      ownerCallsign: callsign,
      motion: propMotion,
      scale: 1,
      mediaType: 'procedural',
      screenPreset: propScreenPreset,
      createdAt: now,
      updatedAt: now,
    };
    onPlaceObject(created);
    onSelectWorldObject(id);
    setUndoStack((prev) => [...prev, { op: 'place', obj: created }]);
    setRedoStack([]);
  }

  function handleSpawnStackedCrate() {
    const targetX = selectedObj ? selectedObj.position[0] : propX;
    const targetZ = selectedObj ? selectedObj.position[2] : propZ;
    const topY = computeSupportTopY(targetX, targetZ, null, worldObjects);
    const id = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    onPlaceObject({
      id,
      kind: 'quantum-crate',
      label: `Stack Cube #${worldObjects.length + 1}`,
      position: [targetX, Number((topY + 1.4).toFixed(2)), targetZ],
      rotationY: 0,
      color: propColor,
      motion: 'static',
      scale: 1,
    });
    onSelectWorldObject(id);
  }

  function handleDeleteWithHistory(obj: WorldObject) {
    onRemoveObject(obj.id);
    if (selectedWorldObjectId === obj.id) onSelectWorldObject(null);
    setUndoStack((prev) => [...prev, { op: 'remove', obj }]);
    setRedoStack([]);
  }

  function handleUndo() {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev, last]);
    if (last.op === 'place') {
      onRemoveObject(last.obj.id);
    } else {
      onPlaceObject(last.obj);
    }
  }

  function handleRedo() {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev, last]);
    if (last.op === 'place') {
      onPlaceObject(last.obj);
    } else {
      onRemoveObject(last.obj.id);
    }
  }

  async function handleUploadMediaFile(file: File, targetObjectId?: string) {
    setUploading(true);
    setUploadStatus(`Uploading ${file.name}...`);
    try {
      const resp = await fetch('/api/media/upload', {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await resp.json();
      if (!resp.ok || !data.url) {
        throw new Error(data.error || 'Upload failed.');
      }

      if (targetObjectId) {
        onUpdateObject(targetObjectId, {
          mediaUrl: data.url,
          mediaType: data.mediaType,
        });
        setUploadStatus(`Attached ${data.mediaType.toUpperCase()} to selected screen.`);
      } else {
        const id = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        onPlaceObject({
          id,
          kind: 'media-screen',
          label: file.name.replace(/\.[^.]+$/, '').slice(0, 28) || 'Uploaded Media',
          position: [propX, 0, propZ],
          rotationY: 0,
          color: propColor,
          motion: propMotion,
          scale: 1,
          mediaUrl: data.url,
          mediaType: data.mediaType,
          screenPreset: propScreenPreset,
        });
        onSelectWorldObject(id);
        setUploadStatus(`Spawned 3D Media Screen with ${data.mediaType.toUpperCase()}.`);
      }
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : 'Media upload error.');
    } finally {
      setUploading(false);
    }
  }

  const roadmapSections: Array<{
    status: RoadmapItemStatus;
    heading: string;
    badgeClass: string;
    icon: typeof CheckCircle2;
  }> = [
    {
      status: 'completed',
      heading: 'Completed Functionality',
      badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      icon: CheckCircle2,
    },
    {
      status: 'in-development',
      heading: 'Currently Being Developed',
      badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
      icon: Clock,
    },
    {
      status: 'awaiting-credentials',
      heading: 'Awaiting External API Credentials',
      badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      icon: KeyRound,
    },
    {
      status: 'requires-backend-infra',
      heading: 'Requiring Backend Infrastructure',
      badgeClass: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
      icon: Server,
    },
    {
      status: 'security-testing',
      heading: 'Outstanding Security & Testing Requirements',
      badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="flex flex-col h-full gap-3 text-xs">
      {/* Sub-Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800 shrink-0">
        {(
          [
            ['builder', `Build & Media (${worldObjects.length})`],
            ['skybox', 'Skybox 3D'],
            ['presence', `Presence (${players.length})`],
            ['roadmap', 'Roadmap'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 py-1.5 px-1.5 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap text-[11px] ${
              tab === key ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Interactive 3D Object Builder, Touch-Hold & Media Screen Upload */}
      {tab === 'builder' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          {/* Touch-Hold / Tap-to-Place / Snap Controls */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <span className="font-semibold text-cyan-300">3D Viewport Manipulation</span>
              <span className="text-slate-400">Hold any object 0.2s or use Drag Mode</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={onToggleObjectDragMode}
                className={`py-1.5 px-2 rounded border flex items-center justify-center gap-1 cursor-pointer ${
                  objectDragMode
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                <span>{objectDragMode ? 'Drag ON' : 'Drag Mode'}</span>
              </button>
              <button
                type="button"
                onClick={onToggleTapPlace}
                className={`py-1.5 px-2 rounded border flex items-center justify-center gap-1 cursor-pointer ${
                  tapPlaceActive
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>{tapPlaceActive ? 'Tap Drop ON' : 'Tap to Place'}</span>
              </button>
              <button
                type="button"
                onClick={onToggleGridSnap}
                className={`py-1.5 px-2 rounded border flex items-center justify-center gap-1 cursor-pointer ${
                  gridSnap
                    ? 'bg-violet-500/20 border-violet-400 text-violet-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                }`}
              >
                <span>{gridSnap ? '0.5m Snap ON' : 'Free Snap'}</span>
              </button>
            </div>

            {/* Cannon.js Physics Gravity & Stacking Bar */}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-slate-400 mr-1">Gravity</span>
                {(
                  [
                    ['earth', '1G'],
                    ['lunar', '0.16G'],
                    ['zero-g', '0G'],
                  ] as const
                ).map(([gKey, gLabel]) => (
                  <button
                    key={gKey}
                    type="button"
                    onClick={() => onChangeGravity(gKey)}
                    className={`px-2 py-0.5 rounded border text-[11px] cursor-pointer ${
                      gravityPreset === gKey
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {gLabel}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleSpawnStackedCrate}
                className="px-2.5 py-1 rounded bg-violet-500/20 border border-violet-400/60 text-violet-200 hover:bg-violet-500/30 text-[11px] font-medium cursor-pointer"
              >
                + Stack Cube
              </button>
            </div>
          </div>

          {/* Selected Object Live Motion & Media Inspector */}
          {selectedObj && (
            <div className="border border-cyan-500/40 bg-[#0B1628] rounded-lg p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-cyan-200 truncate">
                  <Film className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Selected: {selectedObj.label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectWorldObject(null)}
                  className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                >
                  Deselect
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Motion Animation</span>
                  <select
                    value={selectedObj.motion || 'static'}
                    onChange={(e) =>
                      onUpdateObject(selectedObj.id, { motion: e.target.value as WorldObjectMotion })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                  >
                    <option value="static">Static Grounded</option>
                    <option value="hover">Hover Levitation</option>
                    <option value="spin">Continuous Spin</option>
                    <option value="orbit">Orbital Float</option>
                    <option value="patrol">Autonomous Patrol</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">
                    Scale ({(selectedObj.scale ?? 1).toFixed(1)}x)
                  </span>
                  <input
                    type="range"
                    min="0.5"
                    max="2.5"
                    step="0.1"
                    value={selectedObj.scale ?? 1}
                    onChange={(e) => onUpdateObject(selectedObj.id, { scale: Number(e.target.value) })}
                    className="w-full accent-cyan-400 mt-1"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 items-center">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">
                    Rotate ({Math.round(((selectedObj.rotationY ?? 0) * 180) / Math.PI)}°)
                  </span>
                  <input
                    type="range"
                    min="0"
                    max={Math.PI * 2}
                    step="0.1"
                    value={selectedObj.rotationY ?? 0}
                    onChange={(e) => onUpdateObject(selectedObj.id, { rotationY: Number(e.target.value) })}
                    className="w-full accent-cyan-400"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Animated Screen Mode</span>
                  <select
                    value={selectedObj.screenPreset || 'waveform'}
                    onChange={(e) =>
                      onUpdateObject(selectedObj.id, {
                        mediaType: 'procedural',
                        screenPreset: e.target.value as ScreenProceduralPreset,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-100"
                  >
                    <option value="maya-os">MAYA Admin OS</option>
                    <option value="jarvis-core">JARVIS Arc Core</option>
                    <option value="virtual-os">Virtual OS Desktop</option>
                    <option value="waveform">Live FFT Waveform</option>
                    <option value="matrix">Holo Telemetry Matrix</option>
                    <option value="radar">Orbital Sweeping Radar</option>
                    <option value="neural-pulse">Neural Tensor Graph</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onPhysicsCommand({ kind: 'drop', objectId: selectedObj.id })}
                  className="py-1.5 px-2 rounded bg-slate-900 border border-slate-700 text-cyan-200 hover:border-cyan-400 cursor-pointer text-[11px] font-medium"
                >
                  Drop +3m (Gravity)
                </button>
                <button
                  type="button"
                  onClick={() => onPhysicsCommand({ kind: 'nudge', objectId: selectedObj.id })}
                  className="py-1.5 px-2 rounded bg-slate-900 border border-slate-700 text-amber-200 hover:border-amber-400 cursor-pointer text-[11px] font-medium"
                >
                  Nudge Impulse
                </button>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded bg-cyan-500/20 border border-cyan-400/60 text-cyan-200 hover:bg-cyan-500/30 cursor-pointer font-medium">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploading ? 'Uploading...' : 'Attach Image / GIF / Video'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadMediaFile(f, selectedObj.id);
                      e.currentTarget.value = '';
                    }}
                    className="hidden"
                  />
                </label>
                {selectedObj.mediaUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateObject(selectedObj.id, { mediaType: 'procedural', mediaUrl: '' })
                    }
                    className="px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                  >
                    Reset Screen
                  </button>
                )}
              </div>
              {selectedObj.mediaUrl && (
                <div className="text-[10px] font-mono text-emerald-300 truncate">
                  Active Media ({selectedObj.mediaType}): {selectedObj.mediaUrl}
                </div>
              )}
            </div>
          )}

          {/* Spawn New 3D Object / Upload Media Screen */}
          <form onSubmit={handlePlaceNewObject} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <Box className="w-4 h-4 text-cyan-400" />
                <span>Deploy 3D Object or Media Screen</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={undoStack.length === 0}
                  onClick={handleUndo}
                  title="Undo"
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-35 hover:border-slate-700 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={redoStack.length === 0}
                  onClick={handleRedo}
                  title="Redo"
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-35 hover:border-slate-700 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-slate-400 mb-1">Prop Blueprint</label>
                <select
                  value={propKind}
                  onChange={(e) => setPropKind(e.target.value as WorldPropKind)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
                >
                  {PROP_TEMPLATES.map((t) => (
                    <option key={t.kind} value={t.kind}>
                      {t.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Label</label>
                <input
                  type="text"
                  value={propLabel}
                  onChange={(e) => setPropLabel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Motion Mode</label>
                <select
                  value={propMotion}
                  onChange={(e) => setPropMotion(e.target.value as WorldObjectMotion)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
                >
                  <option value="static">Static Grounded</option>
                  <option value="hover">Hover Levitation</option>
                  <option value="spin">Spin</option>
                  <option value="orbit">Orbit</option>
                  <option value="patrol">Patrol</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Screen Animation</label>
                <select
                  value={propScreenPreset}
                  onChange={(e) => setPropScreenPreset(e.target.value as ScreenProceduralPreset)}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
                >
                  <option value="maya-os">MAYA Admin OS</option>
                  <option value="jarvis-core">JARVIS Arc Core</option>
                  <option value="virtual-os">Virtual OS Desktop</option>
                  <option value="waveform">Waveform Spectrum</option>
                  <option value="matrix">Holo Matrix</option>
                  <option value="radar">Orbital Radar</option>
                  <option value="neural-pulse">Neural Pulse</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 mb-1">X Coord (-20..20)</label>
                <input
                  type="number"
                  min={-20}
                  max={20}
                  step={0.5}
                  value={propX}
                  onChange={(e) => setPropX(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Z Coord (-20..20)</label>
                <input
                  type="number"
                  min={-20}
                  max={20}
                  step={0.5}
                  value={propZ}
                  onChange={(e) => setPropZ(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Object accent color"
                value={propColor}
                onChange={(e) => setPropColor(e.target.value)}
                className="w-10 h-8 bg-slate-950 border border-slate-700 rounded p-0.5 cursor-pointer"
              />
              {selfPlayer && (
                <button
                  type="button"
                  onClick={() => {
                    setPropX(Number((selfPlayer.position[0] + 1.5).toFixed(1)));
                    setPropZ(Number((selfPlayer.position[2] - 2.0).toFixed(1)));
                  }}
                  className="px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 hover:border-cyan-400 flex items-center gap-1 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Near Me</span>
                </button>
              )}
              <button
                type="submit"
                className="flex-1 py-1.5 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
              >
                Deploy 3D Object
              </button>
            </div>

            {/* Quick Upload Image/GIF/Video directly as a new 3D Screen */}
            <label className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded border border-dashed border-cyan-500/50 bg-slate-950/70 text-cyan-200 hover:border-cyan-400 cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Uploading Media...' : 'Upload Image / GIF / Video as 3D Screen'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadMediaFile(f);
                  e.currentTarget.value = '';
                }}
                className="hidden"
              />
            </label>
            {uploadStatus && <div className="text-[11px] text-cyan-300 font-mono">{uploadStatus}</div>}
          </form>

          {/* Placed Objects List */}
          <div className="space-y-1.5">
            {worldObjects.map((obj) => (
              <div
                key={obj.id}
                className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-colors ${
                  selectedWorldObjectId === obj.id
                    ? 'bg-cyan-950/40 border-cyan-400'
                    : 'bg-[#0F1524] border-slate-800 hover:border-slate-700'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectWorldObject(obj.id)}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2 font-medium text-slate-200">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: obj.color }} />
                    <span className="truncate">{obj.label}</span>
                    {obj.motion && obj.motion !== 'static' && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-violet-500/20 text-violet-200 font-mono">
                        {obj.motion}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {obj.kind} · ({obj.position[0]}, {obj.position[1]}, {obj.position[2]}) · {obj.mediaType || 'procedural'}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteWithHistory(obj);
                  }}
                  aria-label={`Remove ${obj.label}`}
                  className="p-1.5 rounded bg-slate-900 border border-slate-800 text-rose-300 hover:border-rose-500/60 cursor-pointer shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: 3D Skybox Creator & Hyper-Realistic Biomes */}
      {tab === 'skybox' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          {/* Hyper-Realistic Theme Selector */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Hyper-Realistic Environment Themes
              </span>
              <span className="text-[10px] font-mono text-slate-400">{theme}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {ENVIRONMENT_THEME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChangeTheme(t.id)}
                  className={`text-left p-2 rounded border cursor-pointer transition-colors ${
                    theme === t.id
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-100'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="font-medium flex items-center justify-between">
                    <span>{t.label}</span>
                    {t.tier === 'hyper' && (
                      <span className="text-[9px] px-1 rounded bg-violet-500/25 text-violet-200">HYPER</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{t.subtitle}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 3D Skybox Creator */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-cyan-300">3D Skybox Creator (Live IBL Reflections)</span>
              <button
                type="button"
                onClick={() => onChangeSkybox({ ...skybox, enabled: !skybox.enabled })}
                className={`px-2.5 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                  skybox.enabled
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                    : 'bg-slate-900 border-slate-700 text-slate-300'
                }`}
              >
                {skybox.enabled ? 'Custom Skybox ON' : 'Auto Theme Sky'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {SKYBOX_PRESET_LABELS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onChangeSkybox({
                      ...SKYBOX_PRESETS[p.id],
                      enabled: true,
                      preset: p.id,
                    })
                  }
                  className={`px-2 py-1.5 rounded border text-[10px] font-medium cursor-pointer ${
                    skybox.enabled && skybox.preset === p.id
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Atmospheric Colors */}
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ['zenithColor', 'Zenith'],
                  ['horizonColor', 'Horizon'],
                  ['nadirColor', 'Nadir'],
                  ['sunColor', 'Sun/Glow'],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="space-y-1 text-center">
                  <span className="block text-[10px] text-slate-400">{label}</span>
                  <input
                    type="color"
                    value={skybox[field]}
                    onChange={(e) =>
                      onChangeSkybox({ ...skybox, enabled: true, [field]: e.target.value })
                    }
                    className="w-full h-7 bg-slate-950 border border-slate-700 rounded p-0.5 cursor-pointer"
                  />
                </label>
              ))}
            </div>

            {/* Sliders */}
            <div className="space-y-2">
              {(
                [
                  ['sunElevation', 'Sun Elevation', -15, 75, 1, '°'],
                  ['sunAzimuth', 'Sun Azimuth', 0, 360, 5, '°'],
                  ['sunSize', 'Sun / Moon Size', 0.2, 3.0, 0.05, 'x'],
                  ['starDensity', 'Starfield Density', 0, 1, 0.02, ''],
                  ['auroraIntensity', 'Aurora & Nebula Intensity', 0, 1, 0.02, ''],
                  ['cloudCoverage', 'Procedural Cloud Coverage', 0, 1, 0.02, ''],
                  ['nebulaHue', 'Aurora Spectrum Hue', 0, 1, 0.02, ''],
                  ['envIntensity', 'PBR Reflection Intensity', 0.2, 2.2, 0.05, 'x'],
                  ['exposure', 'Tone Mapping Exposure', 0.6, 1.8, 0.02, ''],
                ] as const
              ).map(([key, label, min, max, step, suffix]) => (
                <label key={key} className="block space-y-0.5">
                  <div className="flex justify-between text-[11px] text-slate-300">
                    <span>{label}</span>
                    <span className="font-mono text-cyan-300">
                      {Number(skybox[key]).toFixed(step >= 1 ? 0 : 2)}
                      {suffix}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={skybox[key]}
                    onChange={(e) =>
                      onChangeSkybox({ ...skybox, enabled: true, [key]: Number(e.target.value) })
                    }
                    className="w-full accent-cyan-400"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Multiplayer Presence & Proximity Chat */}
      {tab === 'presence' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {/* Operator Identity & Emotes */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <Users className="w-4 h-4 text-cyan-400" />
                <span>Operator Identity & Spatial Emote</span>
              </div>
              <span className="font-mono text-[11px] text-slate-400">
                {selfPlayer ? `(${selfPlayer.position[0]}, ${selfPlayer.position[2]})` : 'connecting'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                aria-label="Operator callsign"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
                placeholder="Operator callsign"
              />
              <input
                type="color"
                aria-label="Avatar color"
                value={draftColor}
                onChange={(e) => setDraftColor(e.target.value)}
                className="w-10 h-8 bg-slate-950 border border-slate-700 rounded p-0.5 cursor-pointer"
              />
              <button
                type="button"
                onClick={() => onJoinUpdate(draftName, draftColor)}
                className="px-3 py-1.5 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
              >
                Update
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Emote:</span>
              {(['idle', 'wave', 'work', 'focus'] as const).map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => onEmote(em)}
                  className={`px-2 py-1 rounded border capitalize cursor-pointer ${
                    selfPlayer?.emote === em
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          {/* Connected Players Roster */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-2.5 max-h-32 overflow-y-auto vca-scroll space-y-1.5 shrink-0">
            <div className="text-[11px] font-medium text-slate-400">
              Active Operators in Instance ({players.length})
            </div>
            {players.map((p) => {
              const isSelf = p.id === selfPlayerId;
              const dist = distanceFromSelf(p.position);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-2 py-1 rounded bg-slate-900/75 border border-slate-800/80"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.avatarColor }} />
                    <span className="text-slate-200 font-medium">
                      {p.callsign} {isSelf ? '(You)' : ''}
                    </span>
                    <span className="text-slate-400 font-mono text-[10px]">[{p.emote}]</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                    ({p.position[0]}, {p.position[2]}){!isSelf && dist !== null ? ` · ${dist.toFixed(1)}m` : ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Proximity Chat Feed */}
          <div className="flex-1 min-h-0 flex flex-col border border-slate-800 bg-[#0F1524] rounded-lg p-2.5 gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                <span>Proximity Spatial Chat</span>
              </div>
              <label className="flex items-center gap-1 text-[11px] text-slate-400">
                <span>Radius</span>
                <select
                  value={chatRadius}
                  onChange={(e) => setChatRadius(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200"
                >
                  <option value={10}>10m (Close)</option>
                  <option value={18}>18m (Room)</option>
                  <option value={45}>45m (District)</option>
                </select>
              </label>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-1.5 pr-1">
              {chatMessages.length === 0 ? (
                <div className="text-slate-500 text-[11px] py-2">
                  No proximity messages yet. Send a message to nearby operators or walk closer with WASD.
                </div>
              ) : (
                chatMessages.map((m) => {
                  const dist = distanceFromSelf(m.position);
                  const inRange = dist === null || dist <= m.radius;
                  return (
                    <div
                      key={m.id}
                      className={`p-2 rounded border ${
                        inRange
                          ? 'bg-slate-900 border-slate-800 text-slate-200'
                          : 'bg-slate-950/60 border-slate-900 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5">
                        <span className="font-semibold text-cyan-300">{m.callsign}</span>
                        <span className="font-mono">
                          {inRange ? `in range (${m.radius}m)` : `out of range (${dist?.toFixed(0)}m)`}
                        </span>
                      </div>
                      <p>{inRange ? m.text : '[Signal attenuated beyond proximity radius]'}</p>
                    </div>
                  );
                })
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!chatText.trim()) return;
                onSendChat(chatText.trim(), chatRadius);
                setChatText('');
              }}
              className="flex gap-1.5"
            >
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Broadcast to nearby operators..."
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
              />
              <button
                type="submit"
                disabled={!chatText.trim()}
                className="px-3 py-1.5 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 disabled:opacity-40 cursor-pointer"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab 4: Honest Visible Implementation Roadmap */}
      {tab === 'roadmap' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          {roadmapSections.map((sec) => {
            const items = roadmap.filter((r) => r.status === sec.status);
            if (items.length === 0) return null;
            const Icon = sec.icon;
            return (
              <div key={sec.status} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Icon className="w-4 h-4 text-cyan-400" />
                    <span>{sec.heading}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-mono ${sec.badgeClass}`}>
                    {items.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {items.map((item) => (
                    <div key={item.id} className="p-2 rounded bg-slate-900/80 border border-slate-800/80">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-medium text-slate-100">{item.title}</span>
                        <span className="text-[10px] font-mono text-slate-400 shrink-0">{item.milestone}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
