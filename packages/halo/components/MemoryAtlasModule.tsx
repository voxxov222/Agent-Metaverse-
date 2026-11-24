import { useMemo, useState } from 'react';
import { Brain, Edit3, EyeOff, Pin, Plus, Search, Trash2 } from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { useHaloSelector } from '../store';

export function MemoryAtlasModule() {
  const memories = useHaloSelector((s) => s.memories);
  const pinnedIds = useHaloSelector((s) => s.pinnedMemoryIds);
  const redactedIds = useHaloSelector((s) => s.redactedMemoryIds);
  const traces = useHaloSelector((s) => s.traces);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(memories[0]?.id ?? null);
  const [editContent, setEditContent] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return memories.filter((m) => {
      if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        m.title.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [memories, search, categoryFilter]);

  const selected = filtered.find((m) => m.id === selectedId) ?? filtered[0] ?? null;

  // Deterministic 2D embedding projection clustered by category
  const projected = useMemo(() => {
    const clusterCenter: Record<string, { x: number; y: number; color: string }> = {
      'verified-fact': { x: 95, y: 70, color: '#10b981' },
      'user-instruction': { x: 245, y: 65, color: '#22d3ee' },
      'external-research': { x: 95, y: 155, color: '#a855f7' },
      'workflow-outcome': { x: 245, y: 155, color: '#f59e0b' },
      'agent-assumption': { x: 170, y: 112, color: '#38bdf8' },
    };
    return filtered.map((m, idx) => {
      const c = clusterCenter[m.category] ?? clusterCenter['agent-assumption'];
      const angle = idx * 1.9 + m.title.length * 0.4;
      const dist = 14 + (idx % 4) * 11;
      return {
        mem: m,
        x: Math.max(20, Math.min(320, c.x + Math.cos(angle) * dist)),
        y: Math.max(20, Math.min(200, c.y + Math.sin(angle) * dist)),
        color: c.color,
      };
    });
  }, [filtered]);

  const lineageTraces = useMemo(() => {
    if (!selected) return [];
    return traces.filter((t) => t.memoryIdsUsed.includes(selected.id));
  }, [selected, traces]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 h-full overflow-y-auto pr-1 text-xs">
      {/* Left: Semantic Spatial Map & Search */}
      <div className="lg:col-span-7 space-y-2.5">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-36 flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded px-2 py-1">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search semantic memory..."
                className="flex-1 bg-transparent focus:outline-none"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
            >
              <option value="all">All Types</option>
              <option value="verified-fact">Semantic / Facts</option>
              <option value="user-instruction">Directives</option>
              <option value="external-research">Episodic Research</option>
              <option value="workflow-outcome">Procedural Outcomes</option>
            </select>
          </div>

          <svg viewBox="0 0 340 220" className="w-full h-52 rounded-lg bg-slate-950/90 border border-slate-800">
            <text x="16" y="18" fill="#10b981" fontSize="9" fontFamily="monospace">
              SEMANTIC FACTS
            </text>
            <text x="215" y="18" fill="#22d3ee" fontSize="9" fontFamily="monospace">
              DIRECTIVES
            </text>
            <text x="16" y="210" fill="#a855f7" fontSize="9" fontFamily="monospace">
              EPISODIC
            </text>
            <text x="215" y="210" fill="#f59e0b" fontSize="9" fontFamily="monospace">
              PROCEDURAL
            </text>

            {projected.map(({ mem, x, y, color }) => {
              const active = selected?.id === mem.id;
              const isPinned = pinnedIds.includes(mem.id);
              return (
                <g
                  key={mem.id}
                  onClick={() => {
                    setSelectedId(mem.id);
                    setEditContent(mem.content);
                  }}
                  className="cursor-pointer"
                >
                  <circle
                    cx={x}
                    cy={y}
                    r={active ? 9 : isPinned ? 7 : 5.5}
                    fill={color}
                    fillOpacity={redactedIds.includes(mem.id) ? 0.25 : 0.85}
                    stroke={active ? '#ffffff' : isPinned ? '#fde047' : 'none'}
                    strokeWidth={2}
                  />
                  <text x={x + 9} y={y + 3} fill="#cbd5e1" fontSize="8">
                    {mem.title.slice(0, 14)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Add Memory Note */}
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5 text-cyan-300" />
            <span>Commit Semantic Memory Node</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title"
              className="flex-1 min-w-32 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            />
            <input
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Verified knowledge or rule..."
              className="flex-[2] min-w-44 bg-slate-950 border border-slate-700 rounded px-2 py-1"
            />
            <button
              type="button"
              onClick={() => {
                if (!newTitle.trim() || !newContent.trim()) return;
                void dispatchHaloCommand(
                  createHaloCommand({
                    target: 'memory',
                    verb: 'memory.create',
                    args: { title: newTitle.trim(), content: newContent.trim(), category: 'verified-fact' },
                  }),
                );
                setNewTitle('');
                setNewContent('');
              }}
              className="px-2.5 py-1 rounded bg-cyan-500 text-slate-950 font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Store
            </button>
          </div>
        </div>
      </div>

      {/* Right: Inspector, Edit, Pin, Redact, Delete & Decision Lineage */}
      <div className="lg:col-span-5 rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2.5">
        <div className="font-semibold text-cyan-300">Memory Inspector & Decision Lineage</div>
        {selected ? (
          <>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">{selected.title}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700">
                {(selected.confidence * 100).toFixed(0)}% conf
              </span>
            </div>
            <textarea
              rows={4}
              value={editContent || selected.content}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-slate-200"
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void dispatchHaloCommand(
                    createHaloCommand({
                      target: selected.id,
                      verb: 'memory.edit',
                      args: { content: editContent || selected.content },
                    }),
                  )
                }
                className="px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 flex items-center gap-1 cursor-pointer"
              >
                <Edit3 className="w-3 h-3" /> Save Edit
              </button>
              <button
                type="button"
                onClick={() =>
                  void dispatchHaloCommand(createHaloCommand({ target: selected.id, verb: 'memory.pin' }))
                }
                className={`px-2.5 py-1 rounded border flex items-center gap-1 cursor-pointer ${
                  pinnedIds.includes(selected.id)
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
                }`}
              >
                <Pin className="w-3 h-3" /> {pinnedIds.includes(selected.id) ? 'Pinned' : 'Pin'}
              </button>
              <button
                type="button"
                onClick={() =>
                  void dispatchHaloCommand(createHaloCommand({ target: selected.id, verb: 'memory.redact' }))
                }
                className="px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200 flex items-center gap-1 cursor-pointer"
              >
                <EyeOff className="w-3 h-3" /> Redact
              </button>
              <button
                type="button"
                onClick={() =>
                  void dispatchHaloCommand(createHaloCommand({ target: selected.id, verb: 'memory.delete' }))
                }
                className="px-2.5 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" /> Delete (Approval)
              </button>
            </div>

            <div className="pt-2 border-t border-slate-800 space-y-1">
              <div className="text-[11px] font-semibold text-slate-300">Decision Lineage</div>
              {lineageTraces.length > 0 ? (
                lineageTraces.map((tr) => (
                  <div key={tr.id} className="p-2 rounded bg-slate-950 border border-slate-800 text-[11px]">
                    <div className="text-cyan-300 font-semibold">
                      {tr.agentName} · {tr.stage}
                    </div>
                    <div className="text-slate-400 truncate">{tr.output}</div>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-slate-500">No recorded decisions linked to this node yet.</div>
              )}
            </div>
          </>
        ) : (
          <div className="text-slate-400">Select a memory node from the atlas.</div>
        )}
      </div>
    </div>
  );
}
