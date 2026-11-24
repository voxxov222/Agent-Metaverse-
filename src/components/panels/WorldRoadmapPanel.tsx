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
} from 'lucide-react';
import type {
  RoadmapItem,
  RoadmapItemStatus,
  WorldChatMessage,
  WorldObject,
  WorldPlayer,
  WorldPropKind,
} from '../../types/os';

interface WorldRoadmapPanelProps {
  selfPlayerId: string | null;
  callsign: string;
  avatarColor: string;
  players: WorldPlayer[];
  worldObjects: WorldObject[];
  chatMessages: WorldChatMessage[];
  roadmap: RoadmapItem[];
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
  }) => void;
  onRemoveObject: (id: string) => void;
}

const PROP_TEMPLATES: Array<{ kind: WorldPropKind; title: string }> = [
  { kind: 'workstation-desk', title: 'Workstation Desk' },
  { kind: 'holo-kiosk', title: 'Holo Terminal Kiosk' },
  { kind: 'relay-beacon', title: 'Aether Relay Beacon' },
  { kind: 'data-monolith', title: 'Data Monolith' },
  { kind: 'lounge-pod', title: 'Collaboration Pod' },
];

export function WorldRoadmapPanel({
  selfPlayerId,
  callsign,
  avatarColor,
  players,
  worldObjects,
  chatMessages,
  roadmap,
  onJoinUpdate,
  onEmote,
  onSendChat,
  onPlaceObject,
  onRemoveObject,
}: WorldRoadmapPanelProps) {
  const [tab, setTab] = useState<'presence' | 'builder' | 'roadmap'>('presence');

  // Presence & Chat state
  const [draftName, setDraftName] = useState(callsign);
  const [draftColor, setDraftColor] = useState(avatarColor);
  const [chatText, setChatText] = useState('');
  const [chatRadius, setChatRadius] = useState(18);

  // World Builder + Undo/Redo history
  const [propKind, setPropKind] = useState<WorldPropKind>('workstation-desk');
  const [propLabel, setPropLabel] = useState('Aether Terminal Station');
  const [propX, setPropX] = useState(3);
  const [propZ, setPropZ] = useState(4);
  const [propColor, setPropColor] = useState('#22d3ee');
  const [undoStack, setUndoStack] = useState<Array<{ op: 'place' | 'remove'; obj: WorldObject }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ op: 'place' | 'remove'; obj: WorldObject }>>([]);

  const selfPlayer = players.find((p) => p.id === selfPlayerId);

  function distanceFromSelf(pos: [number, number, number]): number | null {
    if (!selfPlayer) return null;
    return Math.hypot(pos[0] - selfPlayer.position[0], pos[2] - selfPlayer.position[2]);
  }

  function handlePlaceNewObject(e: React.FormEvent) {
    e.preventDefault();
    const id = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const now = Date.now();
    const created: WorldObject = {
      id,
      kind: propKind,
      label: propLabel.trim() || propKind,
      position: [propX, 0, propZ],
      rotationY: 0,
      color: propColor,
      ownerCallsign: callsign,
      createdAt: now,
      updatedAt: now,
    };
    onPlaceObject(created);
    setUndoStack((prev) => [...prev, { op: 'place', obj: created }]);
    setRedoStack([]);
  }

  function handleDeleteWithHistory(obj: WorldObject) {
    onRemoveObject(obj.id);
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
            ['presence', `Presence (${players.length})`],
            ['builder', `World Build (${worldObjects.length})`],
            ['roadmap', 'Roadmap M1–M9'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 py-1.5 px-2 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
              tab === key ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Multiplayer Presence & Proximity Chat */}
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

      {/* Tab 2: Persistent 3D World Object Builder */}
      {tab === 'builder' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <form onSubmit={handlePlaceNewObject} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <Box className="w-4 h-4 text-cyan-400" />
                <span>Place Persistent 3D World Object</span>
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
                  className="px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 hover:border-cyan-400 flex items-center gap-1 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Snap Near Me</span>
                </button>
              )}
              <button
                type="submit"
                className="flex-1 py-1.5 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
              >
                Deploy 3D Object
              </button>
            </div>
          </form>

          <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-2 pr-1">
            {worldObjects.map((obj) => (
              <div
                key={obj.id}
                className="flex items-center justify-between p-2.5 rounded-lg bg-[#0F1524] border border-slate-800"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-slate-200">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: obj.color }} />
                    <span className="truncate">{obj.label}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    {obj.kind} · ({obj.position[0]}, {obj.position[2]}) · by {obj.ownerCallsign}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteWithHistory(obj)}
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

      {/* Tab 3: Honest Visible Implementation Roadmap */}
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
