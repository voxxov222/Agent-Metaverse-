import { useMemo, useState } from 'react';
import { GitBranch, Plus, RefreshCw, Scissors, ShieldAlert, XCircle } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { haloStore, useHaloSelector } from '../store';

export function MissionControlModule() {
  const projects = useHaloSelector((s) => s.projects);
  const agents = useHaloSelector((s) => s.agents);
  const selectedTaskId = useHaloSelector((s) => s.selectedTaskId);
  const telemetry = useHaloSelector((s) => s.telemetry);

  const [nlObjective, setNlObjective] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskAgentId, setNewTaskAgentId] = useState('');
  const [newTaskApproval, setNewTaskApproval] = useState(false);
  const [depSourceId, setDepSourceId] = useState('');
  const [planningBusy, setPlanningBusy] = useState(false);

  const activeProject = projects[0] ?? null;
  const tasks = activeProject?.tasks ?? [];
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? tasks[0] ?? null;

  // Compute DAG topological depth for layered left-to-right visualization + critical path length
  const dagLayout = useMemo(() => {
    const depth = new Map<string, number>();
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const getDepth = (id: string, seen = new Set<string>()): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const t = taskById.get(id);
      if (!t || t.dependsOn.length === 0) {
        depth.set(id, 0);
        return 0;
      }
      const d = 1 + Math.max(...t.dependsOn.map((dep) => getDepth(dep, new Set(seen))));
      depth.set(id, d);
      return d;
    };
    tasks.forEach((t) => getDepth(t.id));

    const columns = new Map<number, typeof tasks>();
    tasks.forEach((t) => {
      const col = depth.get(t.id) ?? 0;
      const arr = columns.get(col) ?? [];
      arr.push(t);
      columns.set(col, arr);
    });

    const positions = new Map<string, { x: number; y: number }>();
    let maxCol = 0;
    for (const [col, colTasks] of columns.entries()) {
      maxCol = Math.max(maxCol, col);
      colTasks.forEach((t, rowIdx) => {
        positions.set(t.id, {
          x: 82 + col * 172,
          y: 44 + rowIdx * 62,
        });
      });
    }

    const totalEtaMinutes = tasks
      .filter((t) => t.status !== 'completed')
      .reduce((acc, t) => acc + (t.estimatedMinutes || 2), 0);

    return { positions, maxCol, totalEtaMinutes };
  }, [tasks]);

  async function submitObjective() {
    if (!nlObjective.trim() || planningBusy) return;
    setPlanningBusy(true);
    try {
      await dispatchHaloCommand(
        createHaloCommand({
          target: 'projects',
          verb: 'project.plan',
          args: { objective: nlObjective.trim() },
        }),
      );
      setNlObjective('');
    } finally {
      setPlanningBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1">
      {/* NL Objective Box & Metrics */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            <span>Mission Control DAG · {activeProject?.title ?? 'No Active Mission'}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-300">
            <span>ETA: {dagLayout.totalEtaMinutes}m</span>
            <span>
              Budget Burn: ${(telemetry?.estimatedApiCostUsd ?? 0).toFixed(4)} / $
              {telemetry?.monthlyBudgetUsd ?? 500}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={nlObjective}
            onChange={(e) => setNlObjective(e.target.value)}
            placeholder="Natural-language mission objective (auto-decomposes into DAG)..."
            className="flex-1 min-w-52 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
          />
          <button
            type="button"
            disabled={planningBusy}
            onClick={() => void submitObjective()}
            className="px-3 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {planningBusy ? 'Planning...' : 'Launch Mission'}
          </button>
        </div>
      </div>

      {/* Interactive SVG Task Graph */}
      <div className="rounded-xl border border-slate-800 bg-black/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-slate-400">
            Click a task node to inspect/reassign · Critical path highlighted
          </span>
          <span className="text-[11px] font-mono text-slate-400">{tasks.length} Tasks</span>
        </div>

        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${Math.max(520, (dagLayout.maxCol + 1) * 185)} ${Math.max(180, tasks.length * 42)}`}
            className="w-full min-h-44"
          >
            {/* Dependency Edges */}
            {tasks.map((t) =>
              t.dependsOn.map((depId) => {
                const from = dagLayout.positions.get(depId);
                const to = dagLayout.positions.get(t.id);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${depId}->${t.id}`}
                    x1={from.x + 71}
                    y1={from.y}
                    x2={to.x - 71}
                    y2={to.y}
                    stroke={t.priority === 'critical' ? '#f59e0b' : '#38bdf8'}
                    strokeWidth={t.priority === 'critical' ? 2.2 : 1.4}
                    strokeOpacity={0.75}
                  />
                );
              }),
            )}

            {/* Task Nodes */}
            {tasks.map((t) => {
              const pos = dagLayout.positions.get(t.id);
              if (!pos) return null;
              const isSelected = selectedTask?.id === t.id;
              const color =
                t.status === 'completed'
                  ? '#10b981'
                  : t.status === 'failed'
                    ? '#ef4444'
                    : t.status === 'awaiting-approval'
                      ? '#f59e0b'
                      : '#22d3ee';
              const assignee = agents.find((a) => a.id === t.assignedAgentId)?.name ?? t.assignedAgentId;

              return (
                <g
                  key={t.id}
                  onClick={() => haloStore.setState({ selectedTaskId: t.id })}
                  className="cursor-pointer"
                >
                  <rect
                    x={pos.x - 71}
                    y={pos.y - 22}
                    width="142"
                    height="44"
                    rx="7"
                    fill={isSelected ? 'rgba(34,211,238,0.16)' : '#0b1220'}
                    stroke={color}
                    strokeWidth={isSelected ? 2.4 : 1.3}
                  />
                  <text x={pos.x} y={pos.y - 5} textAnchor="middle" fill="#f1f5f9" fontSize="9.5" fontWeight="bold">
                    {t.title.slice(0, 22)}
                  </text>
                  <text x={pos.x} y={pos.y + 11} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace">
                    {assignee.slice(0, 10)} · {t.status}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Add Task + Task Action Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="text-xs font-semibold text-slate-200">Create / Assign Task Node</div>
          <input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder="Task title (e.g. Deploy Sandbox Firewall)"
            aria-label="New task title"
            className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs"
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Assign task agent"
              value={newTaskAgentId || agents[0]?.id || ''}
              onChange={(e) => setNewTaskAgentId(e.target.value)}
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5"
            >
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.role})
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-amber-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newTaskApproval}
                onChange={(e) => setNewTaskApproval(e.target.checked)}
              />
              Approval Gate
            </label>
            <button
              type="button"
              onClick={() => {
                if (!newTaskTitle.trim()) return;
                void dispatchHaloCommand(
                  createHaloCommand({
                    target: 'projects',
                    verb: 'task.create',
                    args: {
                      title: newTaskTitle.trim(),
                      agentId: newTaskAgentId || agents[0]?.id,
                      requiresApproval: newTaskApproval,
                    },
                  }),
                );
                setNewTaskTitle('');
              }}
              className="px-3 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Assign Task
            </button>
          </div>
          {/* Quick risky action trigger for approval workflow verification */}
          <button
            type="button"
            onClick={() =>
              void dispatchHaloCommand(
                createHaloCommand({
                  target: newTaskAgentId || agents[0]?.id || 'agent-aegis',
                  verb: 'net.egress',
                  args: { endpoint: 'https://registry.npmjs.org', reason: 'Fetch module spec' },
                }),
              )
            }
            className="w-full px-2.5 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Queue Risky External Egress Syscall (Needs Approval)</span>
          </button>
        </div>

        {/* Selected Task Inspector */}
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2 text-xs">
          <div className="font-semibold text-slate-200">
            Task Inspector: {selectedTask?.title ?? 'Select a task'}
          </div>
          {selectedTask && (
            <>
              <div className="text-[11px] text-slate-400">{selectedTask.description}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Reassign selected task"
                  value={selectedTask.assignedAgentId}
                  onChange={(e) =>
                    void dispatchHaloCommand(
                      createHaloCommand({
                        target: selectedTask.id,
                        verb: 'task.assign',
                        args: { agentId: e.target.value },
                      }),
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs"
                >
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      Assign: {ag.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(createHaloCommand({ target: selectedTask.id, verb: 'task.split' }))
                  }
                  className="px-2 py-1 rounded border border-slate-700 bg-slate-900 flex items-center gap-1 cursor-pointer"
                >
                  <Scissors className="w-3 h-3" /> Split
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(createHaloCommand({ target: selectedTask.id, verb: 'task.retry' }))
                  }
                  className="px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Retry
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(createHaloCommand({ target: selectedTask.id, verb: 'task.cancel' }))
                  }
                  className="px-2 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 flex items-center gap-1 cursor-pointer"
                >
                  <XCircle className="w-3 h-3" /> Cancel
                </button>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={depSourceId}
                  onChange={(e) => setDepSourceId(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]"
                >
                  <option value="">Link upstream dependency...</option>
                  {tasks
                    .filter((other) => other.id !== selectedTask.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        Depends on: {other.title}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={!depSourceId}
                  onClick={() => {
                    if (!depSourceId) return;
                    void dispatchHaloCommand(
                      createHaloCommand({
                        target: selectedTask.id,
                        verb: 'task.dependency.add',
                        args: { dependsOnId: depSourceId },
                      }),
                    );
                    setDepSourceId('');
                  }}
                  className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 text-[11px] disabled:opacity-40 cursor-pointer"
                >
                  Add Edge
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
