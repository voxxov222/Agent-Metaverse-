import { useState } from 'react';
import { GitFork, GitMerge, Layers, Trash2 } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { useHaloSelector } from '../store';

export function MultiverseModule() {
  const forks = useHaloSelector((s) => s.forks);
  const activeForkId = useHaloSelector((s) => s.activeForkId);
  const [forkName, setForkName] = useState('');

  const mainFork = forks.find((f) => f.id === 'world-main');

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 text-xs">
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
        <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
          <GitFork className="w-4 h-4" />
          <span>Multiverse Navigator · Sandbox World Forks</span>
        </div>
        <p className="text-[11px] text-slate-400">
          Fork the live 3D world into an isolated sandbox reality, experiment with objects & zones, inspect deltas vs Prime Reality, then merge or discard.
        </p>

        <div className="flex flex-wrap gap-2">
          <input
            value={forkName}
            onChange={(e) => setForkName(e.target.value)}
            placeholder="New sandbox fork name (e.g. Chaos-Test-02)"
            className="flex-1 min-w-44 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5"
          />
          <button
            type="button"
            onClick={() => {
              void dispatchHaloCommand(
                createHaloCommand({
                  target: 'world',
                  verb: 'world.fork.create',
                  args: { name: forkName.trim() || `Sandbox Fork ${forks.length}` },
                }),
              );
              setForkName('');
            }}
            className="px-3 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center gap-1 cursor-pointer"
          >
            <GitFork className="w-3.5 h-3.5" /> Fork Current World
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {forks.map((fork) => {
          const isCurrent = fork.id === activeForkId;
          const objDelta = mainFork ? fork.objects.length - mainFork.objects.length : 0;
          const zoneDelta = mainFork ? fork.zones.length - mainFork.zones.length : 0;

          return (
            <div
              key={fork.id}
              className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2 ${
                isCurrent
                  ? 'border-cyan-400 bg-cyan-500/10'
                  : 'border-slate-800 bg-black/35'
              }`}
            >
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-100 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-cyan-300" />
                  <span>{fork.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 uppercase">
                    {isCurrent ? 'ACTIVE' : fork.status}
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  Theme: {fork.theme} · Weather: {fork.weather} · Objects: {fork.objects.length} (Δ{objDelta >= 0 ? `+${objDelta}` : objDelta}) · Zones: {fork.zones.length} (Δ{zoneDelta >= 0 ? `+${zoneDelta}` : zoneDelta})
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {fork.status === 'active' && !isCurrent && (
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchHaloCommand(createHaloCommand({ target: fork.id, verb: 'world.fork.switch' }))
                    }
                    className="px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 cursor-pointer"
                  >
                    Switch
                  </button>
                )}
                {fork.id !== 'world-main' && fork.status === 'active' && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void dispatchHaloCommand(createHaloCommand({ target: fork.id, verb: 'world.fork.merge' }))
                      }
                      className="px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 flex items-center gap-1 cursor-pointer"
                    >
                      <GitMerge className="w-3 h-3" /> Merge
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void dispatchHaloCommand(createHaloCommand({ target: fork.id, verb: 'world.fork.discard' }))
                      }
                      className="px-2.5 py-1 rounded border border-rose-500/40 bg-rose-500/15 text-rose-200 flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Discard
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
