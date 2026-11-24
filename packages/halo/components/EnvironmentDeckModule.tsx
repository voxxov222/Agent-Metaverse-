import { useState } from 'react';
import { Camera, Compass, Layers, Plus, RotateCcw, Shield, Trash2 } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand, undoLastHaloAction } from '../clientDispatch';
import { useHaloSelector } from '../store';
import type { WorldPropKind } from '../../../src/types/os';

export function EnvironmentDeckModule() {
  const zones = useHaloSelector((s) => s.zones);
  const snapshots = useHaloSelector((s) => s.snapshots);
  const worldObjects = useHaloSelector((s) => s.worldObjects);
  const undoStack = useHaloSelector((s) => s.undoStack);

  const [theme, setTheme] = useState('command-center');
  const [weather, setWeather] = useState('clear');
  const [tod, setTod] = useState(14);
  const [gravity, setGravity] = useState(1.0);
  const [propKind, setPropKind] = useState<WorldPropKind>('holo-kiosk');
  const [propLabel, setPropLabel] = useState('Ops Terminal');
  const [propX, setPropX] = useState(2);
  const [propZ, setPropZ] = useState(3);
  const [zoneName, setZoneName] = useState('Secure Perimeter');
  const [zoneRule, setZoneRule] = useState<'read-only-fs' | 'no-code-exec' | 'approval-required' | 'sandbox-boost'>('read-only-fs');
  const [snapName, setSnapName] = useState('');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-full overflow-y-auto pr-1 text-xs">
      {/* World Lighting, Weather & Physics */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2.5">
        <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5" />
          <span>Atmosphere, Lighting & Physics Controls</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">Scene Biome</span>
            <select
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value);
                void dispatchHaloCommand(
                  createHaloCommand({ target: 'world', verb: 'world.theme', args: { theme: e.target.value } }),
                );
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5"
            >
              <option value="command-center">Command Center</option>
              <option value="aether-district">Aether District</option>
              <option value="tech-office">Tech Office</option>
              <option value="outdoor-world">Outdoor World</option>
              <option value="neural-chamber">Neural Chamber</option>
              <option value="holo-ops">Holo Ops</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-slate-400">Weather</span>
            <select
              value={weather}
              onChange={(e) => {
                setWeather(e.target.value);
                void dispatchHaloCommand(
                  createHaloCommand({ target: 'world', verb: 'world.weather', args: { weather: e.target.value } }),
                );
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5"
            >
              <option value="clear">Clear</option>
              <option value="rain">Rain</option>
              <option value="ion-storm">Ion Storm</option>
            </select>
          </label>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Time of Day ({tod}:00)</span>
            <span>Gravity Scale ({gravity.toFixed(1)}g)</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="range"
              min="6"
              max="22"
              value={tod}
              onChange={(e) => {
                const v = Number(e.target.value);
                setTod(v);
                void dispatchHaloCommand(
                  createHaloCommand({ target: 'world', verb: 'world.time', args: { timeOfDayHours: v } }),
                );
              }}
              className="accent-cyan-400"
            />
            <input
              type="range"
              min="0.2"
              max="2.0"
              step="0.1"
              value={gravity}
              onChange={(e) => {
                const v = Number(e.target.value);
                setGravity(v);
                void dispatchHaloCommand(
                  createHaloCommand({ target: 'world', verb: 'world.physics', args: { gravityScale: v } }),
                );
              }}
              className="accent-cyan-400"
            />
          </div>
        </div>

        {/* World Prop Placer */}
        <div className="pt-2 border-t border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-200">Place 3D Object ({worldObjects.length})</span>
            <button
              type="button"
              disabled={undoStack.length === 0}
              onClick={() => void undoLastHaloAction()}
              className="px-2 py-0.5 rounded border border-slate-700 bg-slate-900 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" /> Undo
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={propKind}
              onChange={(e) => setPropKind(e.target.value as WorldPropKind)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              <option value="workstation-desk">Workstation Desk</option>
              <option value="holo-kiosk">Holo Kiosk</option>
              <option value="relay-beacon">Relay Beacon</option>
              <option value="data-monolith">Data Monolith</option>
              <option value="lounge-pod">Lounge Pod</option>
            </select>
            <input
              value={propLabel}
              onChange={(e) => setPropLabel(e.target.value)}
              placeholder="Label"
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={propX}
              onChange={(e) => setPropX(Number(e.target.value))}
              className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
            />
            <input
              type="number"
              value={propZ}
              onChange={(e) => setPropZ(Number(e.target.value))}
              className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
            />
            <button
              type="button"
              onClick={() =>
                void dispatchHaloCommand(
                  createHaloCommand({
                    target: 'world',
                    verb: 'world.object.place',
                    args: { kind: propKind, label: propLabel || 'Prop', position: [propX, 0, propZ] },
                  }),
                )
              }
              className="flex-1 px-2.5 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center justify-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Spawn Prop
            </button>
          </div>
        </div>
      </div>

      {/* Zones & Rules + Scene Snapshots */}
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            <span>3D Zones & Rules ({zones.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={zoneName}
              onChange={(e) => setZoneName(e.target.value)}
              className="flex-1 min-w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            />
            <select
              value={zoneRule}
              onChange={(e) => setZoneRule(e.target.value as any)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              <option value="read-only-fs">read-only-fs</option>
              <option value="no-code-exec">no-code-exec</option>
              <option value="approval-required">approval-required</option>
              <option value="sandbox-boost">sandbox-boost</option>
            </select>
            <button
              type="button"
              onClick={() =>
                void dispatchHaloCommand(
                  createHaloCommand({
                    target: 'world',
                    verb: 'world.zone.create',
                    args: { name: zoneName, rule: zoneRule, center: [3, 0, -2], radius: 3.0 },
                  }),
                )
              }
              className="px-2.5 py-1 rounded bg-amber-500 text-slate-950 font-semibold cursor-pointer"
            >
              Create Zone
            </button>
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {zones.map((z) => (
              <div key={z.id} className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800">
                <span>
                  {z.name} <span className="font-mono text-amber-300">[{z.rule}]</span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(createHaloCommand({ target: z.id, verb: 'world.zone.delete' }))
                  }
                  className="text-rose-400 hover:text-rose-300 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
            <Camera className="w-3.5 h-3.5" />
            <span>Scene Snapshots & Restore ({snapshots.length})</span>
          </div>
          <div className="flex gap-2">
            <input
              value={snapName}
              onChange={(e) => setSnapName(e.target.value)}
              placeholder="Snapshot label..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            />
            <button
              type="button"
              onClick={() => {
                void dispatchHaloCommand(
                  createHaloCommand({
                    target: 'world',
                    verb: 'world.snapshot.save',
                    args: { name: snapName || `Snapshot ${snapshots.length + 1}`, theme, weather, timeOfDayHours: tod },
                  }),
                );
                setSnapName('');
              }}
              className="px-2.5 py-1 rounded bg-cyan-500 text-slate-950 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" /> Save
            </button>
          </div>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {snapshots.map((s) => (
              <div key={s.id} className="flex items-center justify-between px-2 py-1 rounded bg-slate-950 border border-slate-800">
                <span className="truncate">
                  {s.name} ({s.objectCount} objs · {s.weather})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(createHaloCommand({ target: s.id, verb: 'world.snapshot.restore' }))
                  }
                  className="px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/15 cursor-pointer"
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
