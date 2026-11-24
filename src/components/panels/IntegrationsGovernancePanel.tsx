import { useState } from 'react';
import { Globe, Mail, CreditCard, Search, AlertTriangle, Check, X } from 'lucide-react';
import type {
  AgentProfile,
  FinancialRequest,
  IntegrationProvider,
  OutboundCommDraft,
} from '../../types/os';

interface IntegrationsGovernancePanelProps {
  integrations: IntegrationProvider[];
  commDrafts: OutboundCommDraft[];
  financialRequests: FinancialRequest[];
  agents: AgentProfile[];
  monthlyBudgetUsd: number;
  monthlyCommittedUsd: number;
  isOffline: boolean;
  onDraftComm: (payload: {
    channel: 'email' | 'sms' | 'voice-call';
    agentId: string;
    recipient: string;
    subject?: string;
    body: string;
  }) => Promise<void>;
  onDecideComm: (id: string, decision: 'approve' | 'reject') => Promise<void>;
  onDecideFinance: (id: string, decision: 'approve' | 'reject') => Promise<void>;
  onUpdateBudget: (budget: number) => Promise<void>;
}

export function IntegrationsGovernancePanel({
  integrations,
  commDrafts,
  financialRequests,
  agents,
  monthlyBudgetUsd,
  monthlyCommittedUsd,
  isOffline,
  onDraftComm,
  onDecideComm,
  onDecideFinance,
  onUpdateBudget,
}: IntegrationsGovernancePanelProps) {
  const [tab, setTab] = useState<'web' | 'comms' | 'finance'>('web');

  // Web Intelligence state
  const [browseUrl, setBrowseUrl] = useState('https://nodejs.org/en');
  const [browseResult, setBrowseResult] = useState<{
    status: number;
    cleanText: string;
    injectionWarning: boolean;
  } | null>(null);
  const [researchQuery, setResearchQuery] = useState('');
  const [researchResult, setResearchResult] = useState<{
    report: string;
    sources: Array<{ title: string; uri: string }>;
  } | null>(null);
  const [webBusy, setWebBusy] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);

  // Comms state
  const [channel, setChannel] = useState<'email' | 'sms' | 'voice-call'>('email');
  const [recipient, setRecipient] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [commError, setCommError] = useState<string | null>(null);

  // Budget state
  const [budgetInput, setBudgetInput] = useState(String(monthlyBudgetUsd));

  async function handleBrowse(e: React.FormEvent) {
    e.preventDefault();
    if (!browseUrl.trim() || isOffline) return;
    setWebBusy(true);
    setWebError(null);
    try {
      const res = await fetch('/api/web/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: browseUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Browse failed');
      setBrowseResult(data);
    } catch (err) {
      setWebError(err instanceof Error ? err.message : 'Unable to browse URL');
    } finally {
      setWebBusy(false);
    }
  }

  async function handleResearch(e: React.FormEvent) {
    e.preventDefault();
    if (!researchQuery.trim() || isOffline) return;
    setWebBusy(true);
    setWebError(null);
    try {
      const res = await fetch('/api/web/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: researchQuery.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Research failed');
      setResearchResult(data);
    } catch (err) {
      setWebError(err instanceof Error ? err.message : 'Web research failed');
    } finally {
      setWebBusy(false);
    }
  }

  async function handleDraftSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient.trim() || !body.trim()) return;
    setCommError(null);
    await onDraftComm({
      channel,
      agentId: agents[3]?.id ?? agents[0]?.id ?? 'agent-lyra',
      recipient: recipient.trim(),
      subject: channel === 'email' ? subject.trim() : undefined,
      body: body.trim(),
    });
    setRecipient('');
    setSubject('');
    setBody('');
  }

  return (
    <div className="flex flex-col h-full gap-3 text-xs">
      <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setTab('web')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'web' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Web Intel</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('comms')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'comms' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Mail className="w-3.5 h-3.5" />
          <span>Comms</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('finance')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'finance' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Finance</span>
        </button>
      </div>

      {tab === 'web' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          <form onSubmit={handleBrowse} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <label htmlFor="web-browse-url" className="block font-medium text-slate-200">
              Sandboxed Live URL Inspector (SSRF-Guarded)
            </label>
            <div className="flex gap-2">
              <input
                id="web-browse-url"
                type="url"
                value={browseUrl}
                onChange={(e) => setBrowseUrl(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100 font-mono"
              />
              <button
                type="submit"
                disabled={webBusy}
                className="px-3 py-1.5 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
              >
                Inspect
              </button>
            </div>
            {browseResult && (
              <div className="space-y-1.5 pt-1">
                {browseResult.injectionWarning && (
                  <div className="p-2 rounded bg-amber-950/60 border border-amber-600/60 text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Untrusted prompt-injection pattern detected and isolated from agent instructions.</span>
                  </div>
                )}
                <div className="bg-slate-950 border border-slate-800 rounded p-2 max-h-36 overflow-y-auto vca-scroll text-slate-300">
                  {browseResult.cleanText || 'Empty response text.'}
                </div>
              </div>
            )}
          </form>

          <form onSubmit={handleResearch} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <label htmlFor="web-research-query" className="block font-medium text-slate-200">
              Autonomous Open-Source & Web Research (Search Grounded)
            </label>
            <div className="flex gap-2">
              <input
                id="web-research-query"
                type="text"
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                placeholder="e.g. Best open-source PostgreSQL vector extension in 2026"
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
              />
              <button
                type="submit"
                disabled={webBusy || !researchQuery.trim()}
                className="px-3 py-1.5 rounded bg-slate-800 border border-slate-700 text-cyan-200 hover:border-cyan-400 flex items-center gap-1 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Research</span>
              </button>
            </div>
            {researchResult && (
              <div className="space-y-2 pt-1">
                <div className="bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-200 whitespace-pre-wrap">
                  {researchResult.report}
                </div>
                {researchResult.sources.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-slate-400 font-medium">Grounded Sources:</div>
                    {researchResult.sources.map((s, i) => (
                      <a
                        key={i}
                        href={s.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-cyan-300 hover:underline"
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </form>
          {webError && <p className="text-red-300">{webError}</p>}
        </div>
      )}

      {tab === 'comms' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          {/* Provider Status */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="font-medium text-slate-200">External Provider Status</div>
            {integrations.map((int) => (
              <div key={int.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-800/60 last:border-0">
                <div>
                  <div className="text-slate-200 font-medium">{int.name}</div>
                  <div className="text-[11px] text-slate-400">{int.endpointLabel}</div>
                </div>
                <span
                  className={`font-mono text-[11px] ${
                    int.status === 'connected' ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                >
                  {int.status}
                </span>
              </div>
            ))}
          </div>

          {/* Draft Comms */}
          <form onSubmit={handleDraftSubmit} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="font-medium text-slate-200">Compose Agent Communication Draft</div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['email', 'sms', 'voice-call'] as const).map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => setChannel(ch)}
                  className={`py-1.5 rounded border uppercase font-mono text-[11px] cursor-pointer ${
                    channel === ch ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
            <input
              type="text"
              required
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={channel === 'email' ? 'Recipient email address' : 'E.164 phone number'}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            {channel === 'email' && (
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject line"
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
              />
            )}
            <textarea
              required
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message or voice call script..."
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <button
              type="submit"
              className="w-full py-2 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
            >
              Queue for Approval
            </button>
          </form>

          {commError && <p className="text-amber-300">{commError}</p>}

          <div className="space-y-2">
            {commDrafts.map((d) => (
              <div key={d.id} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">
                    {d.channel.toUpperCase()} → {d.recipient}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">{d.status}</span>
                </div>
                {d.subject && <div className="text-slate-300 font-medium">{d.subject}</div>}
                <p className="text-slate-300">{d.body}</p>
                <div className="text-[11px] text-slate-400">{d.statusNote}</div>
                {d.status === 'pending-approval' && (
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCommError(null);
                        onDecideComm(d.id, 'approve').catch((e) =>
                          setCommError(e instanceof Error ? e.message : 'Dispatch blocked'),
                        );
                      }}
                      className="px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 flex items-center gap-1 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve & Dispatch</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDecideComm(d.id, 'reject')}
                      className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 flex items-center gap-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'finance' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-medium text-slate-200">Monthly Spending Cap & Commitments</span>
              <span className="font-mono text-cyan-300 tabular-nums">
                ${monthlyCommittedUsd} / ${monthlyBudgetUsd}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded overflow-hidden">
              <div
                className="h-full bg-cyan-500"
                style={{ width: `${Math.min(100, (monthlyCommittedUsd / Math.max(1, monthlyBudgetUsd)) * 100)}%` }}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <input
                type="number"
                aria-label="Monthly budget cap USD"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
              <button
                type="button"
                onClick={() => void onUpdateBudget(Number(budgetInput))}
                className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
              >
                Update Cap
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {financialRequests.map((req) => (
              <div key={req.id} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-100">
                    {req.vendor} — {req.service}
                  </span>
                  <span className="font-mono text-amber-300 tabular-nums">
                    ${req.amountUsd} / {req.billingCycle}
                  </span>
                </div>
                <p className="text-slate-300">{req.rationale}</p>
                <div className="text-[11px] text-slate-400">
                  Requested by {req.requestedByAgentName} · Status: {req.status}
                </div>
                {req.status === 'pending-approval' && (
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void onDecideFinance(req.id, 'approve')}
                      className="px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer"
                    >
                      Approve Commitment
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDecideFinance(req.id, 'reject')}
                      className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      Deny
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
