import { useState } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Download,
  Lock,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import {
  decideKernelApproval,
  dispatchHaloCommand,
  verifyKernelAuditChain,
} from '../clientDispatch';
import { useHaloSelector } from '../store';

export function SecurityApprovalsModule() {
  const approvals = useHaloSelector((s) => s.approvals);
  const auditChain = useHaloSelector((s) => s.auditChain);
  const auditChainValid = useHaloSelector((s) => s.auditChainValid);
  const injectionAlerts = useHaloSelector((s) => s.injectionAlerts);
  const killSwitchActive = useHaloSelector((s) => s.killSwitchActive);
  const agents = useHaloSelector((s) => s.agents);

  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');

  function exportAuditJson() {
    const blob = new Blob([JSON.stringify({ auditChainValid, entries: auditChain }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `halo-audit-chain-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 text-xs">
      {/* Global Emergency Kill Switch Banner */}
      <div
        className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3 ${
          killSwitchActive
            ? 'bg-rose-950/80 border-rose-500 text-rose-100'
            : 'bg-black/40 border-slate-800 text-slate-200'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <AlertOctagon className={`w-5 h-5 ${killSwitchActive ? 'text-rose-400' : 'text-amber-400'}`} />
          <div>
            <div className="font-bold text-xs uppercase tracking-wider">
              {killSwitchActive
                ? 'GLOBAL KILL SWITCH ENGAGED — ALL AGENT SYSCALLS FROZEN'
                : 'Global Emergency Kill Switch & Capability Guard'}
            </div>
            <div className="text-[11px] opacity-80">
              Freezes every agent, throttles active background jobs, and revokes high-risk permissions instantaneously.
            </div>
          </div>
        </div>
        {killSwitchActive ? (
          <button
            type="button"
            onClick={() =>
              void dispatchHaloCommand(createHaloCommand({ target: 'kernel', verb: 'system.resume' }))
            }
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer"
          >
            Resume System
          </button>
        ) : (
          <button
            type="button"
            onClick={() =>
              void dispatchHaloCommand(
                createHaloCommand({ target: 'kernel', verb: 'system.killswitch' }),
              )
            }
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer"
          >
            Trigger Kill Switch
          </button>
        )}
      </div>

      {/* Pending Approvals Queue with Diff Preview */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-amber-300 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" />
            <span>Pending Human Approvals ({pendingApprovals.length})</span>
          </div>
          <button
            type="button"
            onClick={() =>
              void dispatchHaloCommand(
                createHaloCommand({
                  target: 'sandbox-shell',
                  verb: 'code.exec',
                  args: { command: 'npm test', scope: 'isolated-sandbox' },
                }),
              )
            }
            className="px-2 py-1 rounded border border-slate-700 bg-slate-900 text-[11px] hover:bg-slate-800 cursor-pointer"
          >
            Queue Sample Risky Syscall
          </button>
        </div>

        {pendingApprovals.length === 0 ? (
          <div className="text-[11px] text-slate-400 py-2">
            No pending approvals. Risky syscalls (network egress, code execution, agent kill, wallet signing, deletion) pause here for inspection.
          </div>
        ) : (
          <div className="space-y-2">
            {pendingApprovals.map((req) => (
              <div
                key={req.id}
                className="rounded-lg border border-amber-500/40 bg-slate-950 p-2.5 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-amber-200">{req.summary}</span>
                    <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">
                      {req.category}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{req.id}</span>
                </div>
                <pre className="text-[10px] font-mono bg-black/60 border border-slate-800 rounded p-2 text-cyan-200 overflow-x-auto">
                  {req.diffPreview}
                </pre>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void decideKernelApproval(req.id, 'approve-once')}
                    className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Approve Once
                  </button>
                  <button
                    type="button"
                    onClick={() => void decideKernelApproval(req.id, 'always-allow')}
                    className="px-2.5 py-1 rounded border border-cyan-500/50 bg-cyan-500/15 text-cyan-200 font-semibold cursor-pointer"
                  >
                    Always Allow (1h)
                  </button>
                  <button
                    type="button"
                    onClick={() => void decideKernelApproval(req.id, 'deny')}
                    className="px-2.5 py-1 rounded border border-rose-500/50 bg-rose-500/15 text-rose-200 flex items-center gap-1 cursor-pointer"
                  >
                    <XCircle className="w-3 h-3" /> Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Capability Matrix & Prompt Injection Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            <span>Agent Capability Matrix</span>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {agents.map((ag) => (
              <div key={ag.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-[11px]">
                <span className="font-semibold text-slate-200">{ag.name}</span>
                <div className="flex items-center gap-1.5 font-mono">
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchHaloCommand(
                        createHaloCommand({
                          target: ag.id,
                          verb: ag.permissions.webBrowse ? 'agent.permission.revoke' : 'agent.permission.grant',
                          args: { permissionKey: 'webBrowse' },
                        }),
                      )
                    }
                    className={`px-1.5 py-0.5 rounded border cursor-pointer ${
                      ag.permissions.webBrowse ? 'border-emerald-500/40 text-emerald-300' : 'border-slate-700 text-slate-500'
                    }`}
                  >
                    Web
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void dispatchHaloCommand(
                        createHaloCommand({
                          target: ag.id,
                          verb: ag.permissions.codeDeploy ? 'agent.permission.revoke' : 'agent.permission.grant',
                          args: { permissionKey: 'codeDeploy' },
                        }),
                      )
                    }
                    className={`px-1.5 py-0.5 rounded border cursor-pointer ${
                      ag.permissions.codeDeploy ? 'border-amber-500/40 text-amber-300' : 'border-slate-700 text-slate-500'
                    }`}
                  >
                    Deploy
                  </button>
                  <span className="text-slate-400">${ag.permissions.financialSpendLimitUsd}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
          <div className="font-semibold text-rose-300">Prompt-Injection & Anomaly Alerts ({injectionAlerts.length})</div>
          {injectionAlerts.length === 0 ? (
            <div className="text-[11px] text-slate-400">
              No active prompt-injection flags. Untrusted web pages fetched by Web Intelligence are scanned automatically.
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {injectionAlerts.map((al) => (
                <div key={al.id} className="p-2 rounded bg-rose-950/40 border border-rose-500/30 text-[11px]">
                  <div className="font-semibold text-rose-200">{al.source}</div>
                  <div className="text-rose-300/80 font-mono truncate">{al.detectedPattern}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tamper-Evident SHA-256 Audit Chain */}
      <div className="rounded-xl border border-slate-800 bg-black/35 p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>SHA-256 Tamper-Evident Audit Chain ({auditChain.length} entries)</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                auditChainValid ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {auditChainValid ? 'CHAIN VERIFIED' : 'CHAIN TAMPERED'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={async () => {
                const res = await verifyKernelAuditChain();
                setVerifyMsg(
                  res.valid
                    ? `Verified ${res.entriesCount} SHA-256 blocks cleanly.`
                    : `Integrity failure at seq #${res.brokenAtSeq}`,
                );
              }}
              className="px-2.5 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 cursor-pointer"
            >
              Verify Chain
            </button>
            <button
              type="button"
              onClick={exportAuditJson}
              className="px-2.5 py-1 rounded border border-slate-700 bg-slate-900 text-slate-200 flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3 h-3" /> Export JSON
            </button>
          </div>
        </div>
        {verifyMsg && <div className="text-[11px] font-mono text-emerald-300">{verifyMsg}</div>}
        <div className="max-h-40 overflow-y-auto space-y-1 font-mono text-[10px]">
          {[...auditChain].reverse().slice(0, 18).map((entry) => (
            <div key={`${entry.seq}-${entry.id}`} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-950 border border-slate-800/80">
              <span className="text-slate-300 truncate">
                #{entry.seq} [{entry.status}] {entry.actor} → {entry.verb} ({entry.target})
              </span>
              <span className="text-cyan-400/80 shrink-0">{entry.hash.slice(0, 12)}…</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
