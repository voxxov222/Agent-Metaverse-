import { useState } from 'react';
import { BarChart3, Play, Sparkles } from 'lucide-react';
import { replayTraceStep } from '../clientDispatch';
import { useHaloSelector } from '../store';

export function TelemetryInsightModule() {
  const telemetry = useHaloSelector((s) => s.telemetry);
  const agents = useHaloSelector((s) => s.agents);
  const traces = useHaloSelector((s) => s.traces);

  const [selectedTraceId, setSelectedTraceId] = useState<string>(traces[0]?.id ?? '');
  const [whatIfPrompt, setWhatIfPrompt] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [replayNote, setReplayNote] = useState<string | null>(null);

  const selectedTrace = traces.find((t) => t.id === selectedTraceId) ?? traces[0] ?? null;

  const totalCompleted = agents.reduce((acc, a) => acc + a.metrics.tasksCompleted, 0);
  const totalFailed = agents.reduce((acc, a) => acc + a.metrics.tasksFailed, 0);
  const successRate =
    totalCompleted + totalFailed > 0
      ? ((totalCompleted / (totalCompleted + totalFailed)) * 100).toFixed(1)
      : '100.0';

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 text-xs">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="text-[11px] text-slate-400">API Spend</div>
          <div className="text-base font-mono font-bold text-cyan-300">
            ${(telemetry?.estimatedApiCostUsd ?? 0).toFixed(4)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="text-[11px] text-slate-400">Avg Latency</div>
          <div className="text-base font-mono font-bold text-emerald-300">
            {telemetry?.avgAiLatencyMs ?? 0} ms
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="text-[11px] text-slate-400">Task Success</div>
          <div className="text-base font-mono font-bold text-amber-300">{successRate}%</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="text-[11px] text-slate-400">AI Errors</div>
          <div className="text-base font-mono font-bold text-rose-300">
            {telemetry?.aiErrorCount ?? 0}
          </div>
        </div>
      </div>

      {/* Per-Agent Cost & Token Breakdown */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
        <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Per-Agent Token & Latency Distribution</span>
        </div>
        <div className="space-y-1.5">
          {agents.map((ag) => {
            const pct = Math.min(100, Math.max(4, Math.round((ag.metrics.tokensUsed / 2500) * 100)));
            return (
              <div key={ag.id} className="space-y-0.5">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-200">{ag.name}</span>
                  <span className="font-mono text-slate-400">
                    {ag.metrics.tokensUsed} tok · {ag.metrics.avgLatencyMs}ms · {ag.metrics.tasksCompleted} ok
                  </span>
                </div>
                <div className="h-1.5 rounded bg-slate-900 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: ag.appearance.accentColor }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trace Explorer & What-If Live Re-Run */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2.5">
        <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Trace Explorer & Live What-If Replay ({traces.length} steps)</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
          <div className="lg:col-span-5 space-y-1 max-h-48 overflow-y-auto">
            {traces.map((tr) => (
              <button
                key={tr.id}
                type="button"
                onClick={() => {
                  setSelectedTraceId(tr.id);
                  setWhatIfPrompt(tr.prompt);
                }}
                className={`w-full text-left p-2 rounded border cursor-pointer ${
                  selectedTrace?.id === tr.id
                    ? 'bg-cyan-500/15 border-cyan-400'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-slate-200 truncate">
                  {tr.agentName} · {tr.stage}
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  {tr.tokens} tok · {tr.latencyMs}ms
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-7 space-y-2">
            {selectedTrace && (
              <>
                <div className="rounded bg-slate-950 border border-slate-800 p-2 text-[11px]">
                  <div className="text-slate-400 mb-0.5">Recorded Output:</div>
                  <div className="text-slate-200 whitespace-pre-wrap">{selectedTrace.output}</div>
                </div>
                <textarea
                  rows={2}
                  value={whatIfPrompt || selectedTrace.prompt}
                  onChange={(e) => setWhatIfPrompt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-100"
                  placeholder="Edit prompt to run a What-If branch..."
                />
                <div className="flex items-center justify-between gap-2">
                  {replayNote && <span className="text-[11px] text-emerald-300 truncate">{replayNote}</span>}
                  <button
                    type="button"
                    disabled={replaying}
                    onClick={async () => {
                      setReplaying(true);
                      try {
                        const res = await replayTraceStep(
                          selectedTrace.agentId,
                          whatIfPrompt || selectedTrace.prompt,
                        );
                        setReplayNote(res.ok ? 'What-If step captured in Trace Explorer.' : res.message);
                      } finally {
                        setReplaying(false);
                      }
                    }}
                    className="ml-auto px-3 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Play className="w-3 h-3" />
                    <span>{replaying ? 'Replaying...' : 'Run What-If Branch'}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
