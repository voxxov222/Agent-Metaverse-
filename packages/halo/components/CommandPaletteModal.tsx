import { useMemo, useState } from 'react';
import { Command, CircleDot, Play, RotateCcw, ShieldAlert, X } from 'lucide-react';
import {
  createHaloCommand,
  fuzzySearchCommands,
  parseCommandString,
  type PaletteActionEntry,
} from '../commandBus';
import { haloStore, useHaloSelector } from '../store';
import { dispatchHaloCommand, replayMacroSequence, undoLastHaloAction } from '../clientDispatch';
import { resolveHaloPalette } from '../themes';

export function CommandPaletteModal() {
  const paletteOpen = useHaloSelector((s) => s.paletteOpen);
  const layout = useHaloSelector((s) => s.layout);
  const agents = useHaloSelector((s) => s.agents);
  const recordingMacro = useHaloSelector((s) => s.recordingMacro);
  const macroCommands = useHaloSelector((s) => s.macroCommands);
  const undoStack = useHaloSelector((s) => s.undoStack);

  const [query, setQuery] = useState('');
  const palette = resolveHaloPalette(layout.themeId, layout.customPalette);

  const baseEntries: PaletteActionEntry[] = useMemo(() => {
    const entries: PaletteActionEntry[] = [
      { id: 'mod-agent', label: 'Open Agent Command Ring', category: 'module', commandText: 'hud.module agent-ring', moduleId: 'agent-ring', verb: 'hud.module', target: 'hud', args: { moduleId: 'agent-ring' } },
      { id: 'mod-mission', label: 'Open Mission Control DAG', category: 'module', commandText: 'hud.module mission-control', moduleId: 'mission-control', verb: 'hud.module', target: 'hud', args: { moduleId: 'mission-control' } },
      { id: 'mod-voice', label: 'Open Voice & Comms Deck', category: 'module', commandText: 'hud.module voice-comms', moduleId: 'voice-comms', verb: 'hud.module', target: 'hud', args: { moduleId: 'voice-comms' } },
      { id: 'mod-env', label: 'Open Environment Control Deck', category: 'module', commandText: 'hud.module environment-deck', moduleId: 'environment-deck', verb: 'hud.module', target: 'hud', args: { moduleId: 'environment-deck' } },
      { id: 'mod-proc', label: 'Open Process & Scheduler Monitor', category: 'module', commandText: 'hud.module process-monitor', moduleId: 'process-monitor', verb: 'hud.module', target: 'hud', args: { moduleId: 'process-monitor' } },
      { id: 'mod-mem', label: 'Open Memory Atlas', category: 'module', commandText: 'hud.module memory-atlas', moduleId: 'memory-atlas', verb: 'hud.module', target: 'hud', args: { moduleId: 'memory-atlas' } },
      { id: 'mod-sec', label: 'Open Security & Approval Center', category: 'module', commandText: 'hud.module security-approvals', moduleId: 'security-approvals', verb: 'hud.module', target: 'hud', args: { moduleId: 'security-approvals' } },
      { id: 'mod-tel', label: 'Open Telemetry & Trace Explorer', category: 'module', commandText: 'hud.module telemetry-insight', moduleId: 'telemetry-insight', verb: 'hud.module', target: 'hud', args: { moduleId: 'telemetry-insight' } },
      { id: 'mod-auto', label: 'Open Automation Studio', category: 'module', commandText: 'hud.module automation-studio', moduleId: 'automation-studio', verb: 'hud.module', target: 'hud', args: { moduleId: 'automation-studio' } },
      { id: 'mod-multi', label: 'Open Multiverse Navigator', category: 'module', commandText: 'hud.module multiverse', moduleId: 'multiverse', verb: 'hud.module', target: 'hud', args: { moduleId: 'multiverse' } },
      { id: 'ff-dome', label: 'Switch HUD to 3D Command Dome', category: 'form-factor', commandText: 'hud.formfactor dome', verb: 'hud.formfactor', target: 'hud', args: { formFactor: 'dome' } },
      { id: 'ff-table', label: 'Switch HUD to 3D Holo Table', category: 'form-factor', commandText: 'hud.formfactor table', verb: 'hud.formfactor', target: 'hud', args: { formFactor: 'table' } },
      { id: 'ff-flat', label: 'Switch HUD to Flat Overlay', category: 'form-factor', commandText: 'hud.formfactor flat', verb: 'hud.formfactor', target: 'hud', args: { formFactor: 'flat' } },
      { id: 'sys-spawn', label: 'Spawn Autonomous Specialist Agent', category: 'agent', commandText: 'agent.spawn name=Astra role=SystemsAnalyst', verb: 'agent.spawn', target: 'agents', args: { name: 'Astra', role: 'Systems Analyst' } },
      { id: 'sys-rain', label: 'Set World Weather: Ion Storm', category: 'world', commandText: 'world.weather weather=ion-storm', verb: 'world.weather', target: 'world', args: { weather: 'ion-storm' } },
      { id: 'sys-clear', label: 'Set World Weather: Clear', category: 'world', commandText: 'world.weather weather=clear', verb: 'world.weather', target: 'world', args: { weather: 'clear' } },
      { id: 'sys-snap', label: 'Save 3D World Snapshot', category: 'world', commandText: 'world.snapshot.save name=OpsCheckpoint', verb: 'world.snapshot.save', target: 'world', args: { name: 'Ops Checkpoint' } },
      { id: 'sys-egress', label: 'Test Risky Network Egress (Queued Approval)', category: 'syscall', commandText: 'net.egress target=external-api endpoint=https://api.github.com', verb: 'net.egress', target: 'external-api', args: { endpoint: 'https://api.github.com' } },
      { id: 'sys-kill', label: 'ENGAGE GLOBAL KILL SWITCH', category: 'syscall', commandText: 'system.killswitch', verb: 'system.killswitch', target: 'kernel', args: {} },
    ];

    for (const ag of agents) {
      entries.push({
        id: `pause-${ag.id}`,
        label: `Pause Agent ${ag.name}`,
        category: 'agent',
        commandText: `agent.pause target=${ag.id}`,
        verb: 'agent.pause',
        target: ag.id,
      });
    }
    return entries;
  }, [agents]);

  if (!paletteOpen) return null;

  const matches = fuzzySearchCommands(query, baseEntries);

  async function executeRaw() {
    const cmd = parseCommandString(query);
    if (!cmd) return;
    await dispatchHaloCommand(cmd);
    setQuery('');
    haloStore.setState({ paletteOpen: false });
  }

  return (
    <div
      role="dialog"
      aria-label="HALO Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/70"
      onClick={() => haloStore.setState({ paletteOpen: false })}
    >
      <div
        className="w-full max-w-2xl rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: palette.bgPanel, borderColor: palette.border, color: palette.textPrimary }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b" style={{ borderColor: palette.border }}>
          <Command className="w-4 h-4 shrink-0" style={{ color: palette.primary }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (query.includes('.') || query.includes('=')) {
                  void executeRaw();
                } else if (matches[0]?.verb) {
                  void dispatchHaloCommand(
                    createHaloCommand({
                      target: matches[0].target || 'kernel',
                      verb: matches[0].verb,
                      args: matches[0].args,
                    }),
                  );
                  haloStore.setState({ paletteOpen: false });
                }
              } else if (e.key === 'Escape') {
                haloStore.setState({ paletteOpen: false });
              }
            }}
            placeholder='Search HALO commands or enter syscall (e.g. "agent.spawn name=Nova role=Security")'
            className="flex-1 bg-transparent text-sm focus:outline-none font-mono"
          />
          <button
            type="button"
            onClick={() => haloStore.setState({ paletteOpen: false })}
            className="p-1 rounded hover:bg-slate-800 cursor-pointer"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Macro & Undo Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] bg-black/30 border-b" style={{ borderColor: palette.border }}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => haloStore.setState({ recordingMacro: !recordingMacro })}
              className={`px-2 py-1 rounded border flex items-center gap-1 cursor-pointer ${
                recordingMacro ? 'bg-rose-500/20 border-rose-400 text-rose-200' : 'bg-slate-900 border-slate-700 text-slate-300'
              }`}
            >
              <CircleDot className="w-3 h-3" />
              <span>{recordingMacro ? `Recording (${macroCommands.length})` : 'Record Macro'}</span>
            </button>
            <button
              type="button"
              disabled={macroCommands.length === 0}
              onClick={() => {
                void replayMacroSequence();
                haloStore.setState({ paletteOpen: false });
              }}
              className="px-2 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <Play className="w-3 h-3" />
              <span>Run Macro ({macroCommands.length})</span>
            </button>
            <button
              type="button"
              disabled={undoStack.length === 0}
              onClick={() => {
                void undoLastHaloAction();
                haloStore.setState({ paletteOpen: false });
              }}
              className="px-2 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Undo ({undoStack.length})</span>
            </button>
          </div>
          <span className="font-mono opacity-75">Hotkeys: Ctrl+K · Tab · Ctrl+Shift+X</span>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/70">
          {query.includes('.') && (
            <button
              type="button"
              onClick={() => void executeRaw()}
              className="w-full px-4 py-2.5 text-left text-xs font-mono bg-cyan-500/15 hover:bg-cyan-500/25 flex items-center justify-between cursor-pointer"
            >
              <span>Execute raw syscall: {query}</span>
              <span className="text-cyan-300">Enter</span>
            </button>
          )}
          {matches.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.verb) {
                  void dispatchHaloCommand(
                    createHaloCommand({
                      target: item.target || 'kernel',
                      verb: item.verb,
                      args: item.args,
                    }),
                  );
                }
                haloStore.setState({ paletteOpen: false });
              }}
              className="w-full px-4 py-2.5 text-left hover:bg-white/5 flex items-center justify-between gap-3 cursor-pointer"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium flex items-center gap-2">
                  {item.verb === 'system.killswitch' && <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />}
                  <span>{item.label}</span>
                </div>
                <div className="text-[11px] font-mono opacity-65 truncate">{item.commandText}</div>
              </div>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-slate-700 opacity-75 shrink-0">
                {item.category}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
