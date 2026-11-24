import { useState } from 'react';
import { Database, Lock, Box, Trash2, Download, RefreshCw } from 'lucide-react';
import type { MemoryItem, OfflineQueuedAction } from '../../types/os';
import type { PrototypeKind } from '../../scene/environments';
import { searchMemories } from '../../utils/orchestratorLogic';

interface MemorySecurityPrototypePanelProps {
  initialTab: 'memory' | 'security' | 'prototype';
  memories: MemoryItem[];
  onAddMemory: (item: { title: string; content: string; category: MemoryItem['category']; tags: string[] }) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  vaultClaimed: boolean;
  sessionRole: string | null;
  secrets: Array<{ id: string; label: string; provider: string; maskedPreview: string }>;
  onUnlockVault: (passcode: string, role: 'Admin' | 'Operator' | 'Viewer') => Promise<void>;
  onStoreSecret: (id: string, label: string, provider: string, value: string) => Promise<void>;
  onDeleteSecret: (id: string) => Promise<void>;
  offlineQueue: OfflineQueuedAction[];
  isOffline: boolean;
  onSyncOfflineQueue: () => Promise<void>;
  prototypeKind: PrototypeKind;
  prototypeColor: string;
  prototypeMetalness: number;
  onChangePrototype: (kind: PrototypeKind, color: string, metalness: number) => void;
}

export function MemorySecurityPrototypePanel({
  initialTab,
  memories,
  onAddMemory,
  onDeleteMemory,
  vaultClaimed,
  sessionRole,
  secrets,
  onUnlockVault,
  onStoreSecret,
  onDeleteSecret,
  offlineQueue,
  isOffline,
  onSyncOfflineQueue,
  prototypeKind,
  prototypeColor,
  prototypeMetalness,
  onChangePrototype,
}: MemorySecurityPrototypePanelProps) {
  const [tab, setTab] = useState<'memory' | 'security' | 'prototype'>(initialTab);
  const [memQuery, setMemQuery] = useState('');
  const [memTitle, setMemTitle] = useState('');
  const [memContent, setMemContent] = useState('');
  const [memCategory, setMemCategory] = useState<MemoryItem['category']>('verified-fact');

  // Security & Vault state
  const [passcode, setPasscode] = useState('');
  const [selectedRole, setSelectedRole] = useState<'Admin' | 'Operator' | 'Viewer'>('Admin');
  const [authError, setAuthError] = useState<string | null>(null);
  const [secretProvider, setSecretProvider] = useState('int-email');
  const [secretLabel, setSecretLabel] = useState('Email Webhook Endpoint');
  const [secretValue, setSecretValue] = useState('');
  const [vaultMsg, setVaultMsg] = useState<string | null>(null);

  const visibleMemories = searchMemories(memories, memQuery, 'all');

  function exportMemories() {
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vcalabs-memories-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPrototypeSpec() {
    const spec = {
      type: 'VCALABS-3D-Prototype',
      model: prototypeKind,
      material: { color: prototypeColor, metalness: prototypeMetalness },
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prototype-${prototypeKind}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full gap-3 text-xs">
      <div className="flex items-center gap-1 p-1 bg-slate-900 rounded-lg border border-slate-800">
        <button
          type="button"
          onClick={() => setTab('memory')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'memory' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>Memory</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('security')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'security' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Security & Sync</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('prototype')}
          className={`flex-1 py-1.5 px-2 rounded-md font-medium flex items-center justify-center gap-1.5 cursor-pointer ${
            tab === 'prototype' ? 'bg-slate-800 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>3D Studio</span>
        </button>
      </div>

      {tab === 'memory' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="Search stored memories"
              value={memQuery}
              onChange={(e) => setMemQuery(e.target.value)}
              placeholder="Search memories by keyword or tag..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <button
              type="button"
              onClick={exportMemories}
              className="px-3 py-1.5 rounded bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!memTitle.trim() || !memContent.trim()) return;
              void onAddMemory({
                title: memTitle.trim(),
                content: memContent.trim(),
                category: memCategory,
                tags: ['operator-verified'],
              });
              setMemTitle('');
              setMemContent('');
            }}
            className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2"
          >
            <div className="font-medium text-slate-200">Store Adaptive Memory Record</div>
            <input
              type="text"
              required
              value={memTitle}
              onChange={(e) => setMemTitle(e.target.value)}
              placeholder="Memory title"
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <select
              aria-label="Memory category"
              value={memCategory}
              onChange={(e) => setMemCategory(e.target.value as MemoryItem['category'])}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            >
              <option value="verified-fact">Verified Fact</option>
              <option value="user-instruction">User Instruction</option>
              <option value="workflow-outcome">Workflow Outcome</option>
              <option value="external-research">External Research</option>
              <option value="agent-assumption">Agent Assumption</option>
            </select>
            <textarea
              required
              rows={2}
              value={memContent}
              onChange={(e) => setMemContent(e.target.value)}
              placeholder="Context, preference, or verified finding..."
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <button
              type="submit"
              className="w-full py-2 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
            >
              Commit to Memory Lattice
            </button>
          </form>

          <div className="space-y-2">
            {visibleMemories.map((m) => (
              <div key={m.id} className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{m.title}</span>
                  <button
                    type="button"
                    aria-label={`Delete memory ${m.title}`}
                    onClick={() => void onDeleteMemory(m.id)}
                    className="text-slate-400 hover:text-red-300 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="font-mono text-[11px] text-cyan-300">
                  {m.category} · scope: {m.scope} · confidence: {Math.round(m.confidence * 100)}%
                </div>
                <p className="text-slate-300">{m.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-3 pr-1">
          {/* Multi-Tenant Session Lock/Claim */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">Multi-Tenant Operator Auth</span>
              <span className="font-mono text-cyan-300">
                {sessionRole ? `Unlocked (${sessionRole})` : vaultClaimed ? 'Locked' : 'First-Run Setup'}
              </span>
            </div>
            <p className="text-slate-400">
              {vaultClaimed
                ? 'Enter your operator passcode to unlock AES-256-GCM vault mutations.'
                : 'Claim the initial Admin passcode (min 6 chars) to secure vault credentials.'}
            </p>
            <div className="flex gap-2">
              <select
                aria-label="Session role"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as 'Admin' | 'Operator' | 'Viewer')}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-slate-100"
              >
                <option value="Admin">Admin</option>
                <option value="Operator">Operator</option>
                <option value="Viewer">Viewer</option>
              </select>
              <input
                type="password"
                aria-label="Operator passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Min 6 characters"
                className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  setAuthError(null);
                  onUnlockVault(passcode, selectedRole)
                    .then(() => setPasscode(''))
                    .catch((e) => setAuthError(e instanceof Error ? e.message : 'Unlock failed'));
                }}
                className="px-3 py-1.5 rounded bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400 cursor-pointer"
              >
                {vaultClaimed ? 'Unlock' : 'Claim'}
              </button>
            </div>
            {authError && <p className="text-red-300">{authError}</p>}
          </div>

          {/* Encrypted Secrets Vault */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="font-medium text-slate-200">AES-256-GCM Integration Credentials Vault</div>
            <select
              aria-label="Integration provider"
              value={secretProvider}
              onChange={(e) => {
                setSecretProvider(e.target.value);
                setSecretLabel(
                  e.target.value === 'int-email'
                    ? 'Email Webhook / Relay'
                    : e.target.value === 'int-telephony'
                      ? 'Telephony Gateway'
                      : 'GitHub Scoped PAT',
                );
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            >
              <option value="int-email">Email / SMTP Relay Webhook</option>
              <option value="int-telephony">Telephony / SMS Gateway URL</option>
              <option value="int-github">GitHub Repository Token</option>
            </select>
            <input
              type="password"
              aria-label="Credential value"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="Paste integration webhook URL or scoped token..."
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-100"
            />
            <button
              type="button"
              onClick={() => {
                setVaultMsg(null);
                onStoreSecret(secretProvider, secretLabel, secretProvider, secretValue)
                  .then(() => {
                    setSecretValue('');
                    setVaultMsg('Encrypted and stored in server vault.');
                  })
                  .catch((e) => setVaultMsg(e instanceof Error ? e.message : 'Vault error'));
              }}
              className="w-full py-2 rounded bg-slate-800 hover:bg-slate-700 text-cyan-200 font-medium cursor-pointer"
            >
              Encrypt & Store Credential
            </button>
            {vaultMsg && <p className="text-slate-300">{vaultMsg}</p>}

            {secrets.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                {secrets.map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-slate-950 rounded px-2.5 py-1.5 border border-slate-800">
                    <div>
                      <span className="text-slate-200 font-medium">{s.label}</span>
                      <span className="ml-2 font-mono text-slate-400">{s.maskedPreview}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void onDeleteSecret(s.id)}
                      className="text-red-300 hover:underline cursor-pointer"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Offline-First IndexedDB Queue Status */}
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-200">Offline-First Sync Queue (IndexedDB)</span>
              <span className="font-mono text-slate-400">{offlineQueue.length} queued</span>
            </div>
            <p className="text-slate-400">
              {isOffline
                ? 'Offline active: local edits are persisted to IndexedDB and queued for reconciliation.'
                : 'Connected: local IndexedDB cache is synced with server state.'}
            </p>
            <button
              type="button"
              disabled={isOffline || offlineQueue.length === 0}
              onClick={() => void onSyncOfflineQueue()}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reconcile Queue Now</span>
            </button>
          </div>
        </div>
      )}

      {tab === 'prototype' && (
        <div className="flex-1 min-h-0 overflow-y-auto vca-scroll space-y-4 pr-1">
          <div className="border border-slate-800 bg-[#0F1524] rounded-lg p-3 space-y-3">
            <div className="font-medium text-slate-200">3D Holographic Prototype Pedestal</div>
            <p className="text-slate-400">
              Select a procedural 3D hardware prototype rendered live on the rear Holographic Pedestal inside the 3D command center.
            </p>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['orbital-relay', 'Orbital Relay'],
                  ['drone-chassis', 'Recon Drone'],
                  ['server-rack', 'Compute Rack'],
                  ['kinetic-rover', 'Kinetic Rover'],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onChangePrototype(kind, prototypeColor, prototypeMetalness)}
                  className={`py-2 px-3 rounded border text-left cursor-pointer ${
                    prototypeKind === kind
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label htmlFor="proto-color" className="block text-slate-400 mb-1">
                  Alloy Albedo
                </label>
                <input
                  id="proto-color"
                  type="color"
                  value={prototypeColor}
                  onChange={(e) => onChangePrototype(prototypeKind, e.target.value, prototypeMetalness)}
                  className="w-full h-9 bg-slate-950 border border-slate-700 rounded p-1 cursor-pointer"
                />
              </div>
              <div>
                <div className="flex justify-between text-slate-400 mb-1">
                  <label htmlFor="proto-metal">Metalness</label>
                  <span className="font-mono tabular-nums">{prototypeMetalness.toFixed(2)}</span>
                </div>
                <input
                  id="proto-metal"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={prototypeMetalness}
                  onChange={(e) => onChangePrototype(prototypeKind, prototypeColor, Number(e.target.value))}
                  className="w-full accent-cyan-400 mt-2"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={exportPrototypeSpec}
              className="w-full py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-100 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export Prototype Blueprint JSON</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
