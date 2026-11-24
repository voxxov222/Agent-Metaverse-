import { useMemo, useState } from 'react';
import { Copy, Pause, Play, Plus, Shield, Skull, Sparkles } from 'lucide-react';
import { NeuralNetworkView } from '../../../src/viz/NeuralNetworkView';
import type { NodeClickPayload } from '../../../src/viz/types';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { haloStore, useHaloSelector } from '../store';

export function AgentCommandRingModule() {
  const agents = useHaloSelector((s) => s.agents);
  const selectedIds = useHaloSelector((s) => s.selectedAgentIds);
  const memories = useHaloSelector((s) => s.memories);
  const traces = useHaloSelector((s) => s.traces);

  const [spawnName, setSpawnName] = useState('');
  const [spawnRole, setSpawnRole] = useState('Security Analyst');
  const [skillInput, setSkillInput] = useState('');
  const [budgetInput, setBudgetInput] = useState('50');
  const [inspectedNode, setInspectedNode] = useState<NodeClickPayload | null>(null);

  const primaryAgent = useMemo(() => {
    const firstId = selectedIds[0];
    return agents.find((a) => a.id === firstId) ?? agents[0] ?? null;
  }, [agents, selectedIds]);

  const toggleSelect = (id: string, multi: boolean) => {
    haloStore.setState((prev) => {
      if (!multi) return { ...prev, selectedAgentIds: [id] };
      const exists = prev.selectedAgentIds.includes(id);
      return {
        ...prev,
        selectedAgentIds: exists
          ? prev.selectedAgentIds.filter((x) => x !== id)
          : [...prev.selectedAgentIds, id],
      };
    });
  };

  const targetIds = selectedIds.length > 0 ? selectedIds : primaryAgent ? [primaryAgent.id] : [];

  const neuralActivity = useMemo(() => {
    if (!primaryAgent) return 'idle';
    if (primaryAgent.status === 'reasoning') return 'thinking:0.85';
    if (primaryAgent.status === 'executing') return 'tool:0.9';
    if (primaryAgent.status === 'error') return 'error@layer2';
    if (primaryAgent.status === 'awaiting-approval') return 'attention:0.6';
    return 'idle';
  }, [primaryAgent]);

  const linkedTrace = useMemo(() => {
    if (!inspectedNode?.node || !primaryAgent) return null;
    const nodeId = inspectedNode.node.id;
    const agentTraces = traces.filter((t) => t.agentId === primaryAgent.id);
    if (agentTraces.length > 0) {
      return agentTraces[nodeId % agentTraces.length];
    }
    return traces[0] ?? null;
  }, [inspectedNode, primaryAgent, traces]);

  const linkedMemory = useMemo(() => {
    if (!inspectedNode?.node || memories.length === 0) return null;
    return memories[inspectedNode.node.id % memories.length];
  }, [inspectedNode, memories]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full overflow-y-auto pr-1">
      {/* Left: Interactive Rotating SVG Command Ring + Multi-Select Actions */}
      <div className="lg:col-span-7 flex flex-col gap-3">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                Agent Command Ring ({agents.length} Units)
              </h3>
              <p className="text-[11px] text-slate-400">
                Click to focus · Shift+Click to multi-select ({targetIds.length} selected)
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => haloStore.setState({ selectedAgentIds: agents.map((a) => a.id) })}
                className="px-2 py-1 text-[11px] rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 cursor-pointer"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() => haloStore.setState({ selectedAgentIds: [] })}
                className="px-2 py-1 text-[11px] rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Ring Visualization */}
          <div className="relative flex items-center justify-center py-2">
            <svg viewBox="0 0 320 220" className="w-full max-w-md h-52">
              <circle
                cx="160"
                cy="110"
                r="78"
                fill="none"
                stroke="rgba(34,211,238,0.28)"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <circle cx="160" cy="110" r="26" fill="rgba(14,116,144,0.25)" stroke="#22d3ee" strokeWidth="1.5" />
              <text x="160" y="114" textAnchor="middle" fill="#e6edf7" fontSize="10" fontFamily="monospace">
                CORE BUS
              </text>
              {agents.map((ag, idx) => {
                const angle = (idx / Math.max(1, agents.length)) * Math.PI * 2 - Math.PI / 2;
                const x = 160 + Math.cos(angle) * 78;
                const y = 110 + Math.sin(angle) * 78;
                const selected = targetIds.includes(ag.id);
                return (
                  <g
                    key={ag.id}
                    onClick={(e) => toggleSelect(ag.id, e.shiftKey)}
                    className="cursor-pointer"
                  >
                    <line
                      x1="160"
                      y1="110"
                      x2={x}
                      y2={y}
                      stroke={selected ? ag.appearance.accentColor : 'rgba(148,163,184,0.25)'}
                      strokeWidth={selected ? 2 : 1}
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={selected ? 18 : 14}
                      fill="#0b1220"
                      stroke={ag.appearance.accentColor}
                      strokeWidth={selected ? 3 : 1.5}
                    />
                    <text x={x} y={y + 3} textAnchor="middle" fill="#f8fafc" fontSize="8.5" fontWeight="bold">
                      {ag.name.slice(0, 5)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Agent Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto mt-1">
            {agents.map((ag) => {
              const selected = targetIds.includes(ag.id);
              return (
                <button
                  key={ag.id}
                  type="button"
                  onClick={(e) => toggleSelect(ag.id, e.shiftKey)}
                  className={`text-left p-2 rounded-lg border transition-colors cursor-pointer ${
                    selected
                      ? 'bg-cyan-500/15 border-cyan-400'
                      : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-100 truncate">{ag.name}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase"
                      style={{
                        backgroundColor: `${ag.appearance.accentColor}22`,
                        color: ag.appearance.accentColor,
                      }}
                    >
                      {ag.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{ag.role}</div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1">
                    <span>{ag.metrics.tokensUsed} tok</span>
                    <span>Cap ${ag.permissions.financialSpendLimitUsd}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Spawn & Batch Syscalls */}
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2.5">
          <div className="text-xs font-semibold text-slate-200">Spawn New Agent Unit</div>
          <div className="flex flex-wrap gap-2">
            <input
              value={spawnName}
              onChange={(e) => setSpawnName(e.target.value)}
              placeholder="Agent Name (e.g. Orion-07)"
              aria-label="New agent name"
              className="flex-1 min-w-36 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
            />
            <input
              value={spawnRole}
              onChange={(e) => setSpawnRole(e.target.value)}
              placeholder="Role"
              aria-label="New agent role"
              className="flex-1 min-w-36 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100"
            />
            <button
              type="button"
              onClick={() => {
                const name = spawnName.trim() || `Unit-${agents.length + 1}`;
                void dispatchHaloCommand(
                  createHaloCommand({
                    target: 'agents',
                    verb: 'agent.spawn',
                    args: { name, role: spawnRole.trim() || 'Autonomous Specialist' },
                  }),
                );
                setSpawnName('');
              }}
              className="px-3 py-1.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Spawn Agent</span>
            </button>
          </div>

          {primaryAgent && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    targetIds.forEach((id) => {
                      void dispatchHaloCommand(createHaloCommand({ target: id, verb: 'agent.pause' }));
                    });
                  }}
                  className="px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 flex items-center gap-1 cursor-pointer"
                >
                  <Pause className="w-3 h-3" /> Pause
                </button>
                <button
                  type="button"
                  onClick={() => {
                    targetIds.forEach((id) => {
                      void dispatchHaloCommand(createHaloCommand({ target: id, verb: 'agent.resume' }));
                    });
                  }}
                  className="px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 flex items-center gap-1 cursor-pointer"
                >
                  <Play className="w-3 h-3" /> Resume
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(createHaloCommand({ target: primaryAgent.id, verb: 'agent.clone' }))
                  }
                  className="px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" /> Clone
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(
                      createHaloCommand({
                        target: primaryAgent.id,
                        verb: 'agent.permission.grant',
                        args: { permissionKey: 'codeDeploy' },
                      }),
                    )
                  }
                  className="px-2.5 py-1 rounded border border-purple-500/40 bg-purple-500/10 text-purple-200 flex items-center gap-1 cursor-pointer"
                >
                  <Shield className="w-3 h-3" /> Grant CodeDeploy (Approval)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(createHaloCommand({ target: primaryAgent.id, verb: 'agent.kill' }))
                  }
                  className="px-2.5 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 flex items-center gap-1 cursor-pointer"
                >
                  <Skull className="w-3 h-3" /> Kill (Approval)
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  placeholder="Attach skill (e.g. rust-audit)"
                  className="flex-1 min-w-32 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!skillInput.trim()) return;
                    void dispatchHaloCommand(
                      createHaloCommand({
                        target: primaryAgent.id,
                        verb: 'agent.update',
                        args: { skill: skillInput.trim() },
                      }),
                    );
                    setSkillInput('');
                  }}
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-cyan-300" /> Attach Skill
                </button>
                <input
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() =>
                    void dispatchHaloCommand(
                      createHaloCommand({
                        target: primaryAgent.id,
                        verb: 'agent.update',
                        args: { budgetUsd: Number(budgetInput) },
                      }),
                    )
                  }
                  className="px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 cursor-pointer"
                >
                  Set Budget ($)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Live Neural Core Instance for Selected Agent */}
      <div className="lg:col-span-5 flex flex-col rounded-xl border border-slate-800 bg-black/40 p-3 min-h-80">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
              Live Neural Core · {primaryAgent?.name ?? 'Core'}
            </h3>
            <p className="text-[11px] text-slate-400">
              Click any node to inspect memory or reasoning trace behind it
            </p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300">
            {neuralActivity}
          </span>
        </div>

        <div className="h-56 rounded-lg overflow-hidden border border-slate-800">
          <NeuralNetworkView
            options={{ nodeCount: 96, autoRotateSpeed: 0.25 }}
            activity={neuralActivity}
            onNodeClick={(payload) => setInspectedNode(payload.node ? payload : null)}
          />
        </div>

        <div className="mt-2.5 rounded-lg border border-slate-800 bg-slate-950/90 p-2.5 text-xs space-y-1">
          {inspectedNode?.node ? (
            <>
              <div className="font-mono text-cyan-300 font-semibold">
                Node #{inspectedNode.node.id} · Layer {inspectedNode.node.layer} (Activation{' '}
                {(inspectedNode.node.activation * 100).toFixed(0)}%)
              </div>
              {linkedTrace && (
                <div className="text-slate-300">
                  <span className="text-slate-400">Reasoning Step:</span> {linkedTrace.stage} —{' '}
                  {linkedTrace.output.slice(0, 110)}
                </div>
              )}
              {linkedMemory && (
                <div className="text-slate-400">
                  <span className="text-emerald-300">Memory Linked:</span> {linkedMemory.title}
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-400">
              Click a node in {primaryAgent?.name ?? 'the agent'}&apos;s Neural Core to inspect the underlying memory or reasoning step.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
