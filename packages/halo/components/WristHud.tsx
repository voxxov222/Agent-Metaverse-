import { Activity, AlertOctagon, Command, Cpu, Mic, ShieldCheck, X } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { haloStore, useHaloSelector } from '../store';
import { resolveHaloPalette } from '../themes';

export function WristHud() {
  const wristOpen = useHaloSelector((s) => s.wristOpen);
  const layout = useHaloSelector((s) => s.layout);
  const agents = useHaloSelector((s) => s.agents);
  const projects = useHaloSelector((s) => s.projects);
  const approvals = useHaloSelector((s) => s.approvals);
  const telemetry = useHaloSelector((s) => s.telemetry);
  const killSwitchActive = useHaloSelector((s) => s.killSwitchActive);

  if (!wristOpen) return null;

  const palette = resolveHaloPalette(layout.themeId, layout.customPalette);
  const pendingCount = approvals.filter((a) => a.status === 'pending').length;
  const activeAgents = agents.filter((a) => a.status !== 'idle').length;
  const runningTasks = projects.flatMap((p) => p.tasks).filter((t) => t.status === 'in-progress').length;

  return (
    <aside
      aria-label="HALO Wrist HUD"
      className="fixed left-4 bottom-24 z-30 w-72 rounded-xl border p-3 shadow-2xl"
      style={{
        backgroundColor: palette.bgPanel,
        borderColor: killSwitchActive ? palette.danger : palette.border,
        color: palette.textPrimary,
      }}
    >
      <div className="flex items-center justify-between pb-2 mb-2 border-b" style={{ borderColor: palette.border }}>
        <div className="flex items-center gap-1.5 text-xs font-bold tracking-wide">
          <Activity className="w-3.5 h-3.5" style={{ color: palette.primary }} />
          <span>WRIST / PALM HUD (TAB)</span>
        </div>
        <button
          type="button"
          aria-label="Close Wrist HUD"
          onClick={() => haloStore.setState({ wristOpen: false })}
          className="p-0.5 rounded hover:bg-white/10 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Vitals */}
      <div className="grid grid-cols-3 gap-1.5 text-center mb-2.5">
        <div className="rounded bg-black/35 p-1.5 border border-slate-800">
          <div className="text-[10px] opacity-70">AGENTS</div>
          <div className="text-xs font-mono font-bold">
            {activeAgents}/{agents.length}
          </div>
        </div>
        <div className="rounded bg-black/35 p-1.5 border border-slate-800">
          <div className="text-[10px] opacity-70">TASKS</div>
          <div className="text-xs font-mono font-bold">{runningTasks}</div>
        </div>
        <div className="rounded bg-black/35 p-1.5 border border-slate-800">
          <div className="text-[10px] opacity-70">CPU</div>
          <div className="text-xs font-mono font-bold">
            {telemetry ? `${telemetry.hostCpuLoad1m.toFixed(1)}` : '0.0'}
          </div>
        </div>
      </div>

      {/* Quick Form-Factor & Module Jump */}
      <div className="grid grid-cols-2 gap-1.5 mb-2.5 text-[11px]">
        <button
          type="button"
          onClick={() => haloStore.setState({ isOpen: true, activeModule: 'security-approvals' })}
          className="px-2 py-1.5 rounded border border-slate-700 bg-black/40 hover:bg-white/5 flex items-center justify-between cursor-pointer"
        >
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-amber-400" />
            Approvals
          </span>
          <span className="font-mono font-bold text-amber-300">{pendingCount}</span>
        </button>

        <button
          type="button"
          onClick={() => haloStore.setState({ isOpen: true, activeModule: 'voice-comms' })}
          className="px-2 py-1.5 rounded border border-slate-700 bg-black/40 hover:bg-white/5 flex items-center gap-1 cursor-pointer"
        >
          <Mic className="w-3 h-3 text-cyan-400" />
          <span>Voice Link</span>
        </button>

        <button
          type="button"
          onClick={() => haloStore.setState({ paletteOpen: true })}
          className="px-2 py-1.5 rounded border border-slate-700 bg-black/40 hover:bg-white/5 flex items-center gap-1 cursor-pointer"
        >
          <Command className="w-3 h-3 text-cyan-400" />
          <span>Palette</span>
        </button>

        <button
          type="button"
          onClick={() => haloStore.setState({ isOpen: true, activeModule: 'process-monitor' })}
          className="px-2 py-1.5 rounded border border-slate-700 bg-black/40 hover:bg-white/5 flex items-center gap-1 cursor-pointer"
        >
          <Cpu className="w-3 h-3 text-emerald-400" />
          <span>Processes</span>
        </button>
      </div>

      {/* Emergency Wrist Kill Switch / Resume */}
      {killSwitchActive ? (
        <button
          type="button"
          onClick={() =>
            void dispatchHaloCommand(createHaloCommand({ target: 'kernel', verb: 'system.resume' }))
          }
          className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white cursor-pointer"
        >
          RESUME SYSTEM
        </button>
      ) : (
        <button
          type="button"
          onClick={() =>
            void dispatchHaloCommand(
              createHaloCommand({ target: 'kernel', verb: 'system.killswitch' }),
            )
          }
          className="w-full py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <AlertOctagon className="w-3.5 h-3.5" />
          <span>KILL SWITCH</span>
        </button>
      )}
    </aside>
  );
}
