import { useState } from 'react';
import { Activity, Maximize2, Minimize2, X } from 'lucide-react';
import type { AgentProfile } from '../../types/os';
import {
  buildSparklinePolylinePoints,
  computeAgentThroughputMetrics,
  filterAgentsForMetricsOverlay,
  type AgentSparklineHistoryMap,
} from '../../utils/agentSparklines';

interface AgentMetricsSparklineOverlayProps {
  agents: AgentProfile[];
  selectedAgentId: string | null;
  history: AgentSparklineHistoryMap;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onSelectAgent: (id: string) => void;
}

export function AgentMetricsSparklineOverlay({
  agents,
  selectedAgentId,
  history,
  expanded,
  onToggleExpand,
  onClose,
  onSelectAgent,
}: AgentMetricsSparklineOverlayProps) {
  const [filterMode, setFilterMode] = useState<'active' | 'live'>('active');

  const liveCount = agents.filter((a) => a.status !== 'idle').length;
  const visibleAgents = filterAgentsForMetricsOverlay(agents, filterMode);

  return (
    <section
      data-testid="agent-metrics-sparkline-overlay"
      aria-label="Agent Metrics Sparkline Overlay"
      className={
        expanded
          ? 'absolute inset-0 z-20 flex flex-col rounded-lg border border-cyan-500/50 bg-[#070D19] p-3 shadow-2xl'
          : 'rounded-lg border border-cyan-500/35 bg-[#080F1D] p-2.5 space-y-2 shadow-lg'
      }
    >
      {/* Overlay Header */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Activity className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="text-[11px] font-semibold text-slate-100 truncate">
            Active Agent Telemetry Overlay
          </span>
          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-[10px] font-mono text-cyan-300 shrink-0">
            {liveCount} live / {visibleAgents.length} shown
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded p-0.5">
            <button
              type="button"
              onClick={() => setFilterMode('active')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer ${
                filterMode === 'active'
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('live')}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer ${
                filterMode === 'live'
                  ? 'bg-emerald-500/20 text-emerald-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Live ({liveCount})
            </button>
          </div>

          <button
            type="button"
            aria-label={expanded ? 'Collapse Metrics Overlay' : 'Expand Metrics Overlay'}
            onClick={onToggleExpand}
            className="p-1 rounded border border-slate-800 bg-slate-950 text-slate-300 hover:text-cyan-300 hover:border-cyan-500/50 cursor-pointer"
          >
            {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>

          <button
            type="button"
            aria-label="Hide Metrics Overlay"
            onClick={onClose}
            className="p-1 rounded border border-slate-800 bg-slate-950 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Sparkline Grid */}
      <div
        className={
          expanded
            ? 'flex-1 min-h-0 overflow-y-auto vca-scroll grid grid-cols-1 gap-2 mt-2 pr-1 pb-1 content-start'
            : 'max-h-[154px] overflow-y-auto vca-scroll grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-1'
        }
      >
        {visibleAgents.length === 0 ? (
          <div className="col-span-full rounded border border-slate-800 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-400">
            No agents currently mid-turn. Dispatch a task or switch filter to Active to inspect roster baselines.
          </div>
        ) : (
          visibleAgents.map((agent) => {
            const samples = history[agent.id] ?? [];
            const derived = computeAgentThroughputMetrics(agent);
            const latestTps =
              samples.length > 0 ? samples[samples.length - 1].tokensPerSec : derived.tokensPerSec;
            const latestLat =
              samples.length > 0 ? samples[samples.length - 1].latencyMs : derived.latencyMs;

            const tpsSeries =
              samples.length > 0 ? samples.map((s) => s.tokensPerSec) : [derived.tokensPerSec, derived.tokensPerSec];
            const latSeries =
              samples.length > 0 ? samples.map((s) => s.latencyMs) : [derived.latencyMs, derived.latencyMs];

            const tpsPoints = buildSparklinePolylinePoints(tpsSeries, 100, 22, 2);
            const latPoints = buildSparklinePolylinePoints(latSeries, 100, 22, 2);
            const isSelected = agent.id === selectedAgentId;

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className={`text-left rounded-md border ${expanded ? 'p-2' : 'p-1.5'} transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 border-cyan-400/65'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className={`flex items-center justify-between gap-1.5 ${expanded ? 'mb-1.5' : 'mb-1'}`}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ backgroundColor: agent.appearance.accentColor }}
                    />
                    <span className="text-[11px] font-semibold text-slate-100 truncate">
                      {agent.name}
                    </span>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase shrink-0 ${
                      agent.status === 'idle'
                        ? 'bg-slate-800 text-slate-400'
                        : agent.status === 'error'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                    }`}
                  >
                    {agent.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  {/* Tokens/sec Mini-Sparkline */}
                  <div className="rounded bg-[#050912] border border-slate-800/80 px-1.5 py-0.5">
                    <div className="flex items-center justify-between text-[9px] font-mono tabular-nums mb-0.5">
                      <span className="text-slate-400">tok/s</span>
                      <span className="text-cyan-300 font-semibold">{latestTps.toFixed(1)}</span>
                    </div>
                    <svg
                      viewBox="0 0 100 22"
                      role="img"
                      aria-label={`${agent.name} tokens per second sparkline`}
                      className={`w-full ${expanded ? 'h-5' : 'h-4'}`}
                    >
                      <polyline
                        fill="none"
                        stroke="#22D3EE"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={tpsPoints}
                      />
                    </svg>
                  </div>

                  {/* Latency Mini-Sparkline */}
                  <div className="rounded bg-[#050912] border border-slate-800/80 px-1.5 py-0.5">
                    <div className="flex items-center justify-between text-[9px] font-mono tabular-nums mb-0.5">
                      <span className="text-slate-400">latency</span>
                      <span className="text-amber-300 font-semibold">{latestLat}ms</span>
                    </div>
                    <svg
                      viewBox="0 0 100 22"
                      role="img"
                      aria-label={`${agent.name} latency sparkline`}
                      className={`w-full ${expanded ? 'h-5' : 'h-4'}`}
                    >
                      <polyline
                        fill="none"
                        stroke="#F59E0B"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={latPoints}
                      />
                    </svg>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
