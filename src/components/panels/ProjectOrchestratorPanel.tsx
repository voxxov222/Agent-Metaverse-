import { useState } from 'react';
import { GitBranch, CheckCircle2, Clock, AlertTriangle, Play } from 'lucide-react';
import type { AgentProfile, ProjectRecord } from '../../types/os';

interface ProjectOrchestratorPanelProps {
  projects: ProjectRecord[];
  agents: AgentProfile[];
  isOffline: boolean;
  onCreateProject: (objective: string) => Promise<void>;
  onApproveTask: (projectId: string, taskId: string) => Promise<void>;
}

export function ProjectOrchestratorPanel({
  projects,
  agents,
  isOffline,
  onCreateProject,
  onApproveTask,
}: ProjectOrchestratorPanelProps) {
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id ?? '');

  const activeProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0];

  async function handleLaunch(e: React.FormEvent) {
    e.preventDefault();
    if (!objective.trim() || busy) return;
    setError(null);
    if (isOffline) {
      setError('Cannot plan live AI project while offline. Reconnect to dispatch.');
      return;
    }
    setBusy(true);
    try {
      await onCreateProject(objective.trim());
      setObjective('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Project launch failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Objective Delegation Form */}
      <form onSubmit={handleLaunch} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
        <label htmlFor="project-objective-input" className="block text-xs font-medium text-slate-300">
          Delegate Autonomous Multi-Agent Project
        </label>
        <div className="flex gap-2">
          <input
            id="project-objective-input"
            type="text"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="e.g. Compare open-source PostgreSQL pooling tools and draft an architecture spec"
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
          />
          <button
            type="submit"
            disabled={busy || !objective.trim()}
            className="px-3.5 py-2 rounded-lg bg-cyan-500 text-slate-950 font-semibold text-xs hover:bg-cyan-400 disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{busy ? 'Planning...' : 'Launch Team'}</span>
          </button>
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
      </form>

      {/* Project Selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 vca-scroll">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedProjectId(p.id)}
            className={`px-3 py-1.5 rounded-md text-xs border shrink-0 transition-colors cursor-pointer ${
              p.id === activeProject?.id
                ? 'bg-slate-800 border-cyan-400/60 text-cyan-200'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
            }`}
          >
            {p.title} · {p.status}
          </button>
        ))}
      </div>

      {/* Active Project Board & DAG */}
      {activeProject ? (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-4 pr-1">
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-slate-100">{activeProject.title}</span>
              <span className="font-mono text-cyan-300 uppercase">{activeProject.status}</span>
            </div>
            <p className="text-slate-300">{activeProject.objective}</p>
            <div className="flex flex-wrap gap-3 pt-1 text-slate-400">
              {activeProject.milestones.map((m) => (
                <span key={m.id} className="flex items-center gap-1">
                  <CheckCircle2 className={`w-3.5 h-3.5 ${m.completed ? 'text-emerald-400' : 'text-slate-600'}`} />
                  <span>{m.title}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Interactive SVG Task Dependency Flow Diagram */}
          <div className="border border-slate-800 bg-[#0A0F1C] rounded-lg p-3">
            <div className="flex items-center gap-2 text-xs text-slate-300 mb-2">
              <GitBranch className="w-3.5 h-3.5 text-violet-400" />
              <span>Task Dependency Execution Graph</span>
            </div>
            <svg viewBox="0 0 640 130" className="w-full h-28" role="img" aria-label="Task dependency graph">
              {activeProject.tasks.map((task, idx) => {
                const x = 20 + idx * 150;
                const y = 35 + (idx % 2) * 28;
                const fill =
                  task.status === 'completed'
                    ? '#065F46'
                    : task.status === 'in-progress'
                      ? '#1E3A8A'
                      : task.status === 'awaiting-approval'
                        ? '#78350F'
                        : '#1E293B';
                const stroke =
                  task.status === 'completed'
                    ? '#10B981'
                    : task.status === 'in-progress'
                      ? '#38BDF8'
                      : '#475569';
                return (
                  <g key={task.id}>
                    {task.dependsOn.map((depId) => {
                      const depIdx = activeProject.tasks.findIndex((t) => t.id === depId);
                      if (depIdx < 0) return null;
                      const dx = 20 + depIdx * 150 + 115;
                      const dy = 35 + (depIdx % 2) * 28 + 20;
                      return (
                        <line
                          key={depId}
                          x1={dx}
                          y1={dy}
                          x2={x}
                          y2={y + 20}
                          stroke="#38BDF8"
                          strokeOpacity="0.45"
                          strokeWidth="1.5"
                        />
                      );
                    })}
                    <rect x={x} y={y} width="115" height="42" rx="6" fill={fill} stroke={stroke} strokeWidth="1.2" />
                    <text x={x + 8} y={y + 17} fill="#E2E8F0" fontSize="9.5" fontFamily="Plus Jakarta Sans">
                      {task.title.slice(0, 17)}
                    </text>
                    <text x={x + 8} y={y + 32} fill="#94A3B8" fontSize="8.5" fontFamily="JetBrains Mono">
                      {task.status}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Task List */}
          <div className="space-y-2">
            {activeProject.tasks.map((task) => {
              const assignee = agents.find((a) => a.id === task.assignedAgentId);
              return (
                <div key={task.id} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100">{task.title}</span>
                    <span className="font-mono text-slate-400">
                      {assignee?.name ?? task.assignedAgentId} · {task.status}
                    </span>
                  </div>
                  <p className="text-slate-300">{task.description}</p>
                  {task.output && (
                    <div className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-300 whitespace-pre-wrap">
                      {task.output}
                    </div>
                  )}
                  {task.status === 'awaiting-approval' && (
                    <button
                      type="button"
                      onClick={() => void onApproveTask(activeProject.id, task.id)}
                      className="mt-1 px-3 py-1.5 rounded bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 flex items-center gap-1.5 cursor-pointer"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Approve & Continue Execution</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {activeProject.finalReport && (
            <div className="border border-emerald-800/50 bg-emerald-950/20 rounded-lg p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                <Clock className="w-3.5 h-3.5" />
                <span>Verified Project Deliverable Report</span>
              </div>
              <pre className="whitespace-pre-wrap text-slate-200 font-sans">{activeProject.finalReport}</pre>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-slate-400 p-4 border border-slate-800 rounded-lg">
          No projects created yet. Enter an objective above to assemble an AI team.
        </div>
      )}
    </div>
  );
}
