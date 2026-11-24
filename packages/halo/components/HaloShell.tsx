import { useEffect, useState } from 'react';
import {
  AlertOctagon,
  BarChart3,
  Brain,
  Command,
  Compass,
  Cpu,
  GitBranch,
  GitFork,
  Layers,
  Mic,
  Minimize2,
  ShieldCheck,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from 'lucide-react';
import { createHaloCommand } from '../commandBus';
import { dispatchHaloCommand } from '../clientDispatch';
import { probeInputCapabilities, type InputCapabilities } from '../inputAdapters';
import { haloStore, useHaloSelector } from '../store';
import { HALO_THEMES, resolveHaloPalette } from '../themes';
import type { HaloFormFactor, HaloLayoutPresetId, HaloModuleId, HaloThemeId } from '../types';
import { AgentCommandRingModule } from './AgentCommandRingModule';
import { AutomationStudioModule } from './AutomationStudioModule';
import { EnvironmentDeckModule } from './EnvironmentDeckModule';
import { MemoryAtlasModule } from './MemoryAtlasModule';
import { MissionControlModule } from './MissionControlModule';
import { MultiverseModule } from './MultiverseModule';
import { ProcessMonitorModule } from './ProcessMonitorModule';
import { SecurityApprovalsModule } from './SecurityApprovalsModule';
import { TelemetryInsightModule } from './TelemetryInsightModule';
import { VoiceCommsModule } from './VoiceCommsModule';

interface HaloShellProps {
  callsign: string;
  avatarColor: string;
  onBroadcastCursor?: (payload: {
    callsign: string;
    color: string;
    x: number;
    y: number;
    activeModule: string;
    selectedTargetId: string | null;
    lamport: number;
  }) => void;
}

const MODULE_NAV: Array<{ id: HaloModuleId; label: string; Icon: any }> = [
  { id: 'agent-ring', label: 'Agent Ring', Icon: Users },
  { id: 'mission-control', label: 'Mission DAG', Icon: GitBranch },
  { id: 'voice-comms', label: 'Voice & Comms', Icon: Mic },
  { id: 'environment-deck', label: 'Env Deck', Icon: Compass },
  { id: 'process-monitor', label: 'Processes', Icon: Cpu },
  { id: 'memory-atlas', label: 'Memory Atlas', Icon: Brain },
  { id: 'security-approvals', label: 'Security & Approvals', Icon: ShieldCheck },
  { id: 'telemetry-insight', label: 'Telemetry & Trace', Icon: BarChart3 },
  { id: 'automation-studio', label: 'Automation', Icon: Workflow },
  { id: 'multiverse', label: 'Multiverse', Icon: GitFork },
];

export function HaloShell({ callsign, avatarColor, onBroadcastCursor }: HaloShellProps) {
  const isOpen = useHaloSelector((s) => s.isOpen);
  const activeModule = useHaloSelector((s) => s.activeModule);
  const formFactor = useHaloSelector((s) => s.formFactor);
  const layout = useHaloSelector((s) => s.layout);
  const killSwitchActive = useHaloSelector((s) => s.killSwitchActive);
  const approvals = useHaloSelector((s) => s.approvals);
  const sharedCursors = useHaloSelector((s) => s.sharedCursors);
  const panels3D = useHaloSelector((s) => s.panels3D);
  const lastResult = useHaloSelector((s) => s.lastCommandResult);
  const selectedAgentIds = useHaloSelector((s) => s.selectedAgentIds);

  const [caps, setCaps] = useState<InputCapabilities | null>(null);
  const [domeDrawerMinimized, setDomeDrawerMinimized] = useState(false);

  const palette = resolveHaloPalette(layout.themeId, layout.customPalette);
  const pendingApprovals = approvals.filter((a) => a.status === 'pending').length;
  const customModules = haloStore.getPluginModules();

  useEffect(() => {
    void probeInputCapabilities().then(setCaps);
  }, []);

  // Broadcast Shared HUD CRDT cursor updates when Shared HUD form factor is active
  useEffect(() => {
    if (!isOpen || formFactor !== 'shared' || !onBroadcastCursor) return;
    let lamport = Date.now();
    let lastSent = 0;
    const onMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastSent < 120) return;
      lastSent = now;
      lamport += 1;
      onBroadcastCursor({
        callsign,
        color: avatarColor,
        x: Number((e.clientX / Math.max(1, window.innerWidth)).toFixed(3)),
        y: Number((e.clientY / Math.max(1, window.innerHeight)).toFixed(3)),
        activeModule,
        selectedTargetId: selectedAgentIds[0] ?? null,
        lamport,
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [isOpen, formFactor, callsign, avatarColor, activeModule, selectedAgentIds, onBroadcastCursor]);

  if (!isOpen) return null;

  const isSpatial3D = formFactor === 'dome' || formFactor === 'table';

  return (
    <>
      {/* Shared HUD Multi-User CRDT Cursors Overlay */}
      {formFactor === 'shared' && (
        <div className="pointer-events-none fixed inset-0 z-40">
          {Object.values(sharedCursors).map((cur) => (
            <div
              key={cur.actorId}
              className="absolute -translate-x-1 -translate-y-1 flex items-center gap-1"
              style={{
                left: `${cur.x * 100}%`,
                top: `${cur.y * 100}%`,
              }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full border border-white"
                style={{ backgroundColor: cur.color }}
              />
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-mono text-white border"
                style={{ backgroundColor: 'rgba(6,11,22,0.9)', borderColor: cur.color }}
              >
                {cur.callsign} · {cur.activeModule}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Main HALO Shell Container (compact side/bottom spatial bar in Dome/Table mode, full glass workstation in Flat/Shared mode) */}
      <section
        aria-label="HALO Holographic Command HUD"
        className={`fixed z-30 flex flex-col rounded-2xl border shadow-2xl overflow-hidden ${
          isSpatial3D && domeDrawerMinimized
            ? 'top-16 left-4 right-4 max-h-20'
            : isSpatial3D
              ? 'top-16 right-4 bottom-24 w-[min(640px,calc(100vw-2rem))]'
              : 'top-16 left-3 right-3 bottom-4 md:left-6 md:right-6'
        }`}
        style={{
          backgroundColor: palette.bgSurface,
          borderColor: killSwitchActive ? palette.danger : palette.border,
          color: palette.textPrimary,
        }}
      >
        {/* Top Command Header */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b"
          style={{ borderColor: palette.border, backgroundColor: palette.bgPanel }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Sparkles className="w-4 h-4 shrink-0" style={{ color: palette.primary }} />
            <span className="font-display font-bold text-sm tracking-wide">HALO HUD</span>

            {/* Form Factor Switcher */}
            <div className="flex items-center gap-0.5 bg-black/40 p-0.5 rounded-lg border border-slate-800 text-[11px]">
              {(
                [
                  ['flat', 'Flat'],
                  ['dome', 'Dome 3D'],
                  ['table', 'Holo Table'],
                  ['shared', 'Shared CRDT'],
                ] as Array<[HaloFormFactor, string]>
              ).map(([ff, label]) => (
                <button
                  key={ff}
                  type="button"
                  onClick={() => {
                    haloStore.updateLayout({ formFactor: ff });
                    setDomeDrawerMinimized(false);
                  }}
                  className={`px-2 py-0.5 rounded whitespace-nowrap cursor-pointer ${
                    formFactor === ff ? 'font-semibold text-slate-950' : 'text-slate-300 hover:text-white'
                  }`}
                  style={formFactor === ff ? { backgroundColor: palette.primary } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Layout Preset Switcher */}
            <select
              aria-label="HALO Layout Preset"
              value={layout.preset}
              onChange={(e) => haloStore.updateLayout({ preset: e.target.value as HaloLayoutPresetId })}
              className="hidden sm:block bg-black/50 border border-slate-700 rounded px-2 py-0.5 text-[11px]"
            >
              <option value="ops-mode">Ops Mode</option>
              <option value="dev-mode">Dev Mode</option>
              <option value="build-mode">Build Mode</option>
              <option value="cinematic">Cinematic</option>
            </select>

            {/* Theme Switcher */}
            <select
              aria-label="HALO Theme"
              value={layout.themeId}
              onChange={(e) => haloStore.updateLayout({ themeId: e.target.value as HaloThemeId })}
              className="hidden sm:block bg-black/50 border border-slate-700 rounded px-2 py-0.5 text-[11px]"
            >
              {Object.values(HALO_THEMES).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => haloStore.setState({ paletteOpen: true })}
              className="px-2 py-1 rounded border border-slate-700 bg-black/40 text-[11px] flex items-center gap-1 cursor-pointer"
              title="Command Palette (Ctrl/Cmd+K)"
            >
              <Command className="w-3 h-3" />
              <span className="hidden md:inline">Ctrl+K</span>
            </button>

            <button
              type="button"
              onClick={() => haloStore.updateLayout({ audioEnabled: !layout.audioEnabled })}
              className="p-1.5 rounded border border-slate-700 bg-black/40 cursor-pointer"
              aria-label="Toggle Spatial Audio"
            >
              {layout.audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>

            {isSpatial3D && (
              <button
                type="button"
                onClick={() => setDomeDrawerMinimized((v) => !v)}
                className="px-2 py-1 rounded border border-slate-700 bg-black/40 text-[11px] flex items-center gap-1 cursor-pointer"
                title="Minimize/Expand HUD Drawer over 3D Dome"
              >
                <Minimize2 className="w-3 h-3" />
                <span>{domeDrawerMinimized ? 'Expand' : 'View 3D'}</span>
              </button>
            )}

            {/* Global Kill Switch Always Accessible */}
            {killSwitchActive ? (
              <button
                type="button"
                onClick={() =>
                  void dispatchHaloCommand(createHaloCommand({ target: 'kernel', verb: 'system.resume' }))
                }
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
              >
                RESUME
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void dispatchHaloCommand(
                    createHaloCommand({ target: 'kernel', verb: 'system.killswitch' }),
                  )
                }
                className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <AlertOctagon className="w-3 h-3" />
                <span>KILL SWITCH</span>
              </button>
            )}

            <button
              type="button"
              aria-label="Close HALO HUD"
              onClick={() => haloStore.setState({ isOpen: false })}
              className="p-1 rounded hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        {!(isSpatial3D && domeDrawerMinimized) && (
          <div className="flex-1 min-h-0 flex flex-col md:flex-row">
            {/* Module Sidebar */}
            <aside className="md:w-48 shrink-0 border-b md:border-b-0 md:border-r p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-y-auto" style={{ borderColor: palette.border }}>
              {MODULE_NAV.map(({ id, label, Icon }) => {
                const active = activeModule === id;
                const badge = id === 'security-approvals' && pendingApprovals > 0 ? pendingApprovals : null;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => haloStore.setState({ activeModule: id, glitchPulseAt: Date.now() })}
                    className={`px-2.5 py-2 rounded-lg text-xs flex items-center justify-between gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active ? 'font-semibold text-slate-950' : 'text-slate-300 hover:bg-white/5'
                    }`}
                    style={active ? { backgroundColor: palette.primary } : undefined}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{label}</span>
                    </span>
                    {badge !== null && (
                      <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 font-mono text-[10px] font-bold">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* 3D Panel Minimize-to-Orb Controls when in Dome mode */}
              {isSpatial3D && (
                <div className="hidden md:block pt-2 mt-2 border-t space-y-1" style={{ borderColor: palette.border }}>
                  <div className="text-[10px] font-mono uppercase opacity-70 px-1 flex items-center gap-1">
                    <Layers className="w-3 h-3" /> 3D Dome Panels
                  </div>
                  {panels3D.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        haloStore.setState((prev) => ({
                          ...prev,
                          panels3D: prev.panels3D.map((item) =>
                            item.id === p.id ? { ...item, minimized: !item.minimized } : item,
                          ),
                        }));
                      }}
                      className="w-full text-left px-2 py-1 rounded text-[10px] font-mono border border-slate-800 hover:border-slate-600 flex items-center justify-between cursor-pointer"
                    >
                      <span className="truncate">{p.title}</span>
                      <span>{p.minimized ? 'ORB' : '3D'}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Registered Plugin Modules */}
              {customModules.length > 0 && (
                <div className="hidden md:block pt-2 mt-2 border-t space-y-1" style={{ borderColor: palette.border }}>
                  <div className="text-[10px] font-mono uppercase opacity-70 px-1">Plugins</div>
                  {customModules.map((m) => (
                    <div key={m.id} className="px-2 py-1 rounded bg-black/30 text-[10px]">
                      <div className="font-semibold">{m.title}</div>
                      <div className="opacity-75 truncate">{m.renderSummary()}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Input Adapter Probes */}
              {caps && (
                <div className="hidden md:block mt-auto pt-2 border-t text-[10px] font-mono opacity-75 space-y-0.5 px-1" style={{ borderColor: palette.border }}>
                  <div>WebXR: {caps.webXrSupported ? 'Ready' : 'Desktop'}</div>
                  <div>Gamepad: {caps.gamepadSupported ? 'Armed' : 'N/A'}</div>
                  <div>Camera Gesture: {caps.webcamGestureSupported ? 'Available' : 'N/A'}</div>
                </div>
              )}
            </aside>

            {/* Active Module Workspace */}
            <main className="flex-1 min-h-0 p-3.5 overflow-hidden flex flex-col">
              <div className="flex-1 min-h-0 overflow-hidden">
                {activeModule === 'agent-ring' && <AgentCommandRingModule />}
                {activeModule === 'mission-control' && <MissionControlModule />}
                {activeModule === 'voice-comms' && <VoiceCommsModule />}
                {activeModule === 'environment-deck' && <EnvironmentDeckModule />}
                {activeModule === 'process-monitor' && <ProcessMonitorModule />}
                {activeModule === 'memory-atlas' && <MemoryAtlasModule />}
                {activeModule === 'security-approvals' && <SecurityApprovalsModule />}
                {activeModule === 'telemetry-insight' && <TelemetryInsightModule />}
                {activeModule === 'automation-studio' && <AutomationStudioModule />}
                {activeModule === 'multiverse' && <MultiverseModule />}
              </div>

              {/* Last Syscall Audit Status Footer */}
              {lastResult && (
                <div
                  className="mt-2 px-3 py-1.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 shrink-0"
                  style={{ borderColor: palette.border, backgroundColor: 'rgba(4,8,16,0.7)' }}
                >
                  <span className="truncate">
                    [{lastResult.status.toUpperCase()}] {lastResult.message}
                  </span>
                  {lastResult.auditHash && (
                    <span className="opacity-70 shrink-0">SHA256:{lastResult.auditHash.slice(0, 10)}</span>
                  )}
                </div>
              )}
            </main>
          </div>
        )}
      </section>
    </>
  );
}
