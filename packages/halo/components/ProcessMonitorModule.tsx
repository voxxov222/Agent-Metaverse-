import { CalendarClock, Cpu, PauseCircle, Play, Skull } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { useHaloSelector } from '../store';

export function ProcessMonitorModule() {
  const jobs = useHaloSelector((s) => s.schedulerJobs);
  const telemetry = useHaloSelector((s) => s.telemetry);
  const history = useHaloSelector((s) => s.telemetryHistory);
  const agents = useHaloSelector((s) => s.agents);

  const cpuPoints = history
    .slice(-18)
    .map((pt, idx, arr) => {
      const x = (idx / Math.max(1, arr.length - 1)) * 180;
      const y = 38 - Math.min(34, pt.cpuLoad * 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 text-xs">
      {/* Host Resource Summary + Sparkline */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="text-[11px] text-slate-400">Host CPU Load (1m)</div>
          <div className="text-lg font-mono font-bold text-cyan-300">
            {telemetry ? telemetry.hostCpuLoad1m.toFixed(2) : '0.00'}
          </div>
          {cpuPoints && (
            <svg viewBox="0 0 180 42" className="w-full h-10 mt-1">
              <polyline fill="none" stroke="#22d3ee" strokeWidth="1.8" points={cpuPoints} />
            </svg>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="text-[11px] text-slate-400">Memory RSS / Host</div>
          <div className="text-lg font-mono font-bold text-emerald-300">
            {telemetry ? `${telemetry.processRssMb} MB` : '0 MB'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Host: {telemetry?.hostMemUsedMb ?? 0} / {telemetry?.hostMemTotalMb ?? 0} MB
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="text-[11px] text-slate-400">Token Throughput & WS Clients</div>
          <div className="text-lg font-mono font-bold text-amber-300">
            {telemetry?.totalTokensMeasured ?? 0} tok
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Active WS Links: {telemetry?.activeWsClients ?? 0}
          </div>
        </div>
      </div>

      {/* Scheduler & Process Tree */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5" />
            <span>Kernel Process Tree & Cron Scheduler ({jobs.length})</span>
          </div>
        </div>

        <div className="space-y-1.5">
          {jobs.map((job) => {
            const agName = agents.find((a) => a.id === job.targetAgentId)?.name ?? job.targetAgentId;
            return (
              <div
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
              >
                <div>
                  <div className="font-semibold text-slate-100 flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{job.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300">
                      {job.triggerType}:{job.scheduleExpr}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Agent: {agName} · CPU {job.cpuPct}% · Mem {job.memMb}MB · Net {job.netKbps}kbps · Runs: {job.runCount} · Status: {job.status}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchHaloCommand(createHaloCommand({ target: job.id, verb: 'scheduler.run' }))
                    }
                    className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Play className="w-3 h-3" /> Run
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchHaloCommand(createHaloCommand({ target: job.id, verb: 'process.throttle' }))
                    }
                    className="px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 flex items-center gap-1 cursor-pointer"
                  >
                    <PauseCircle className="w-3 h-3" /> Throttle
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchHaloCommand(createHaloCommand({ target: job.id, verb: 'process.kill' }))
                    }
                    className="px-2 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 flex items-center gap-1 cursor-pointer"
                  >
                    <Skull className="w-3 h-3" /> Kill
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
