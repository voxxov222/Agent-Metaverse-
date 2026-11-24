import { useMemo, useState } from 'react';
import { Play, Plus, Save, Workflow } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { useHaloSelector } from '../store';
import { compileWorkflowToDag } from '../workflowCompiler';
import type { WorkflowDefinition, WorkflowNode } from '../types';

export function AutomationStudioModule() {
  const workflows = useHaloSelector((s) => s.workflows);
  const agents = useHaloSelector((s) => s.agents);

  const [draft, setDraft] = useState<WorkflowDefinition>(() => {
    if (workflows[0]) return JSON.parse(JSON.stringify(workflows[0]));
    return {
      id: `wf-${Date.now().toString(36)}`,
      name: 'New Autonomous Pipeline',
      version: 1,
      schedule: 'manual',
      nodes: [
        { id: 'n1', kind: 'trigger', label: 'Operator Trigger', config: {}, x: 40, y: 70 },
        { id: 'n2', kind: 'agent', label: 'Execute Diagnostic', agentId: agents[0]?.id, config: {}, x: 220, y: 70 },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      compiledTasks: [],
      updatedAt: Date.now(),
    };
  });

  const [newNodeKind, setNewNodeKind] = useState<WorkflowNode['kind']>('tool');
  const [newNodeLabel, setNewNodeLabel] = useState('Run Verification');
  const [connectFrom, setConnectFrom] = useState(draft.nodes[draft.nodes.length - 1]?.id ?? 'n1');

  const compiled = useMemo(() => compileWorkflowToDag(draft, agents), [draft, agents]);

  function addNode() {
    const id = `n-${Date.now().toString(36).slice(-4)}`;
    const x = 40 + (draft.nodes.length % 4) * 145;
    const y = 65 + Math.floor(draft.nodes.length / 4) * 75;
    const nextNode: WorkflowNode = {
      id,
      kind: newNodeKind,
      label: newNodeLabel.trim() || `${newNodeKind} step`,
      agentId: agents[0]?.id,
      config: { requiresApproval: newNodeKind === 'approval' },
      x,
      y,
    };
    const nextEdges = connectFrom
      ? [...draft.edges, { id: `e-${Date.now().toString(36)}`, source: connectFrom, target: id }]
      : draft.edges;
    setDraft((prev) => ({
      ...prev,
      version: prev.version + 1,
      nodes: [...prev.nodes, nextNode],
      edges: nextEdges,
    }));
    setConnectFrom(id);
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 text-xs">
      {/* Header & Controls */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="w-4 h-4 text-cyan-300" />
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs font-semibold text-slate-100"
          />
          <span className="font-mono text-[11px] text-slate-400">v{draft.version}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() =>
              void dispatchHaloCommand(
                createHaloCommand({
                  target: draft.id,
                  verb: 'workflow.save',
                  args: { workflow: draft },
                }),
              )
            }
            className="px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <Save className="w-3 h-3" /> Save
          </button>
          <button
            type="button"
            disabled={compiled.errors.length > 0}
            onClick={() =>
              void dispatchHaloCommand(
                createHaloCommand({
                  target: draft.id,
                  verb: 'workflow.run',
                  args: { workflow: draft },
                }),
              )
            }
            className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold flex items-center gap-1 disabled:opacity-40 cursor-pointer"
          >
            <Play className="w-3 h-3" /> Compile & Run DAG
          </button>
        </div>
      </div>

      {/* Visual Node Graph Canvas */}
      <div className="rounded-xl border border-slate-800 bg-black/40 p-3">
        <svg viewBox="0 0 640 190" className="w-full h-44 bg-slate-950/90 rounded border border-slate-800">
          {draft.edges.map((e) => {
            const s = draft.nodes.find((n) => n.id === e.source);
            const t = draft.nodes.find((n) => n.id === e.target);
            if (!s || !t) return null;
            return (
              <line
                key={e.id}
                x1={s.x + 56}
                y1={s.y}
                x2={t.x - 56}
                y2={t.y}
                stroke="#38bdf8"
                strokeWidth="1.6"
              />
            );
          })}
          {draft.nodes.map((n) => {
            const color =
              n.kind === 'approval'
                ? '#f59e0b'
                : n.kind === 'trigger'
                  ? '#10b981'
                  : n.kind === 'condition'
                    ? '#a855f7'
                    : '#22d3ee';
            return (
              <g key={n.id}>
                <rect
                  x={n.x - 56}
                  y={n.y - 20}
                  width="112"
                  height="40"
                  rx="6"
                  fill="#0b1220"
                  stroke={color}
                  strokeWidth="1.5"
                />
                <text x={n.x} y={n.y - 4} textAnchor="middle" fill="#f1f5f9" fontSize="9" fontWeight="bold">
                  {n.label.slice(0, 16)}
                </text>
                <text x={n.x} y={n.y + 10} textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace">
                  {n.kind.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Add Node + Compiled DAG Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="font-semibold text-slate-200">Add Workflow Node</div>
          <div className="flex flex-wrap gap-2">
            <select
              value={newNodeKind}
              onChange={(e) => setNewNodeKind(e.target.value as WorkflowNode['kind'])}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              <option value="trigger">Trigger</option>
              <option value="agent">Agent Step</option>
              <option value="tool">Tool Step</option>
              <option value="condition">Condition</option>
              <option value="loop">Loop</option>
              <option value="approval">Approval Gate</option>
            </select>
            <input
              value={newNodeLabel}
              onChange={(e) => setNewNodeLabel(e.target.value)}
              className="flex-1 min-w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            />
            <select
              value={connectFrom}
              onChange={(e) => setConnectFrom(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              {draft.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  From: {n.label.slice(0, 14)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addNode}
              className="px-2.5 py-1 rounded bg-cyan-500 text-slate-950 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-1.5">
          <div className="font-semibold text-cyan-300">
            Compiled ProjectTask[] DAG ({compiled.tasks.length} tasks)
          </div>
          {compiled.errors.length > 0 && (
            <div className="text-rose-400 font-mono">{compiled.errors.join(' ')}</div>
          )}
          <div className="space-y-1 max-h-28 overflow-y-auto font-mono text-[10px]">
            {compiled.tasks.map((t, i) => (
              <div key={t.id} className="px-2 py-1 rounded bg-slate-950 border border-slate-800 text-slate-300">
                {i + 1}. {t.title} {t.requiresApproval ? '[APPROVAL GATE]' : ''} · deps: {t.dependsOn.length}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
