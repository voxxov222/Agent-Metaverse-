import { useMemo, useState } from 'react';
import { Activity, Download, Search } from 'lucide-react';
import type {
  ActivityLogEntry,
  AgentProfile,
  SystemTelemetry,
  TelemetryHistoryPoint,
} from '../../types/os';

interface TelemetryAnalyticsPanelProps {
  telemetry: SystemTelemetry | null;
  history: TelemetryHistoryPoint[];
  agents: AgentProfile[];
  logs: ActivityLogEntry[];
}

export function TelemetryAnalyticsPanel({
  telemetry,
  history,
  agents,
  logs,
}: TelemetryAnalyticsPanelProps) {
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [selectedCell, setSelectedCell] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (severityFilter !== 'all' && l.severity !== severityFilter) return false;
      if (!q) return true;
      return (
        l.agentName.toLowerCase().includes(q) ||
        l.message.toLowerCase().includes(q) ||
        l.tool.toLowerCase().includes(q) ||
        l.stage.toLowerCase().includes(q)
      );
    });
  }, [logs, search, severityFilter]);

  // Interactive Heatmap Matrix: Agents x 8 recent time slices derived from real activity logs
  const heatmapData = useMemo(() => {
    const now = Date.now();
    const bucketMs = 60_000;
    return agents.map((agent) => {
      const buckets = Array.from({ length: 8 }, (_, idx) => {
        const end = now - (7 - idx) * bucketMs;
        const start = end - bucketMs;
        const count = logs.filter(
          (l) => l.agentId === agent.id && l.timestamp >= start && l.timestamp < end,
        ).length;
        return count;
      });
      return { agent, buckets };
    });
  }, [agents, logs]);

  function exportReportJson() {
    const payload = {
      exportedAt: new Date().toISOString(),
      telemetry,
      agents: agents.map((a) => ({ id: a.id, name: a.name, role: a.role, metrics: a.metrics })),
      recentActivity: filteredLogs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vcalabs-telemetry-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const memSparkPoints = useMemo(() => {
    if (history.length < 2) return '0,40 240,40';
    return history
      .map((pt, i) => {
        const x = (i / (history.length - 1)) * 240;
        const y = 44 - (Math.min(100, pt.memPct) / 100) * 38;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [history]);

  return (
    <div className="flex flex-col h-full gap-4 overflow-y-auto vca-scroll pr-1 text-xs">
      {/* Measured Telemetry Grid */}
      <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium text-slate-200">
            <Activity className="w-4 h-4 text-cyan-400" />
            <span>Live Measured Telemetry</span>
          </div>
          <button
            type="button"
            onClick={exportReportJson}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Report</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 font-mono tabular-nums">
          <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
            <div className="text-[11px] text-slate-400 font-sans">Host CPU Load (1m)</div>
            <div className="text-base font-semibold text-slate-100 mt-0.5">
              {telemetry ? telemetry.hostCpuLoad1m.toFixed(2) : '—'}
            </div>
          </div>
          <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
            <div className="text-[11px] text-slate-400 font-sans">Host RAM Used</div>
            <div className="text-base font-semibold text-slate-100 mt-0.5">
              {telemetry ? `${telemetry.hostMemUsedMb} / ${telemetry.hostMemTotalMb} MB` : '—'}
            </div>
          </div>
          <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
            <div className="text-[11px] text-slate-400 font-sans">Measured AI Tokens</div>
            <div className="text-base font-semibold text-cyan-300 mt-0.5">
              {telemetry ? telemetry.totalTokensMeasured.toLocaleString() : '0'}
            </div>
          </div>
          <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
            <div className="text-[11px] text-slate-400 font-sans">Avg AI Latency</div>
            <div className="text-base font-semibold text-slate-100 mt-0.5">
              {telemetry ? `${telemetry.avgAiLatencyMs} ms` : '0 ms'}
            </div>
          </div>
          <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
            <div className="text-[11px] text-slate-400 font-sans">Est. Token Cost</div>
            <div className="text-base font-semibold text-amber-300 mt-0.5">
              ${telemetry ? telemetry.estimatedApiCostUsd.toFixed(5) : '0.00000'}
            </div>
          </div>
          <div className="p-2.5 rounded bg-slate-950/70 border border-slate-800/80">
            <div className="text-[11px] text-slate-400 font-sans">Active / Idle Agents</div>
            <div className="text-base font-semibold text-emerald-300 mt-0.5">
              {telemetry ? `${telemetry.activeAgents} / ${telemetry.idleAgents}` : '0 / 0'}
            </div>
          </div>
        </div>

        <div className="pt-1 flex items-center justify-between text-[11px] text-slate-400">
          <span>Source: {telemetry?.sourceLabel ?? 'Awaiting WebSocket'}</span>
          <span>Uptime: {telemetry ? `${telemetry.uptimeSeconds}s` : '0s'} · WS Clients: {telemetry?.activeWsClients ?? 0}</span>
        </div>
      </div>

      {/* Host Memory Utilization Sparkline */}
      <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-slate-200">Memory Utilization Trend (Measured)</span>
          <span className="font-mono text-slate-400 tabular-nums">{history.length} samples</span>
        </div>
        <svg viewBox="0 0 240 48" className="w-full h-14 bg-slate-950/70 rounded border border-slate-800/80">
          <polyline fill="none" stroke="#22D3EE" strokeWidth="1.8" points={memSparkPoints} />
        </svg>
      </div>

      {/* Interactive Agent Activity Heatmap */}
      <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium text-slate-200">Agent Activity Heatmap (Last 8 Minutes)</span>
          <span className="text-[11px] text-slate-400">{selectedCell ?? 'Hover or click a cell'}</span>
        </div>
        <div className="space-y-1.5">
          {heatmapData.map(({ agent, buckets }) => (
            <div key={agent.id} className="grid grid-cols-12 items-center gap-1">
              <div className="col-span-4 truncate text-slate-300">{agent.name}</div>
              <div className="col-span-8 grid grid-cols-8 gap-1">
                {buckets.map((cnt, bIdx) => {
                  const bg =
                    cnt === 0
                      ? 'bg-slate-900 border-slate-800'
                      : cnt === 1
                        ? 'bg-cyan-900/70 border-cyan-700/60'
                        : 'bg-cyan-500/80 border-cyan-300';
                  return (
                    <button
                      key={bIdx}
                      type="button"
                      aria-label={`${agent.name} minute -${7 - bIdx}: ${cnt} events`}
                      onClick={() => setSelectedCell(`${agent.name} (-${7 - bIdx}m): ${cnt} events`)}
                      className={`h-5 rounded border ${bg} transition-colors cursor-pointer`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Searchable Live Activity Feed */}
      <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-slate-200">Real-Time Activity Audit Feed</span>
          <select
            aria-label="Filter logs by severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
          >
            <option value="all">All Severities</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            aria-label="Search activity logs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by agent, tool, or message..."
            className="w-full bg-slate-950 border border-slate-700 rounded-md pl-8 pr-3 py-1.5 text-slate-100"
          />
        </div>

        <div className="max-h-56 overflow-y-auto vca-scroll space-y-1.5">
          {filteredLogs.map((l) => (
            <div key={l.id} className="p-2 rounded bg-slate-950/70 border border-slate-800/70 space-y-0.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-cyan-300">
                  {l.agentName} · {l.tool}
                </span>
                <span className="text-slate-500">{new Date(l.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-slate-200">{l.message}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
