import { X, Bell, ShieldCheck, AlertTriangle, Radio } from 'lucide-react';
import type { JarvisOrbState, JarvisToast } from '../types/os';
import { JARVIS_ORB_COLORS } from '../utils/jarvisOperationsLogic';

interface JarvisOrbHudProps {
  orbState: JarvisOrbState;
  orbLabel: string;
  deckOpen: boolean;
  hiddenByFullHud: boolean;
  drawerOpen: boolean;
  toasts: JarvisToast[];
  onToggleDeck: () => void;
  onDismissToast: (id: string) => void;
}

export function JarvisOrbHud({
  orbState,
  orbLabel,
  deckOpen,
  hiddenByFullHud,
  drawerOpen,
  toasts,
  onToggleDeck,
  onDismissToast,
}: JarvisOrbHudProps) {
  if (hiddenByFullHud) return null;

  const visual = JARVIS_ORB_COLORS[orbState] ?? JARVIS_ORB_COLORS.idle;

  return (
    <>
      {/* Stark Top-Right HUD Notification Toasts */}
      {toasts.length > 0 && (
        <div
          aria-label="JARVIS HUD Notifications"
          className={`fixed top-16 z-40 flex flex-col gap-2 w-[min(340px,calc(100vw-2rem))] pointer-events-none transition-all ${
            drawerOpen ? 'right-[min(544px,calc(100vw-1rem))] hidden lg:flex' : 'right-4'
          }`}
        >
          {toasts.slice(0, 3).map((t) => {
            const borderCol =
              t.severity === 'error'
                ? 'border-rose-400/80'
                : t.severity === 'warning'
                  ? 'border-amber-400/80'
                  : t.severity === 'success'
                    ? 'border-emerald-400/80'
                    : 'border-[#00d2ff]/80';

            return (
              <div
                key={t.id}
                role="status"
                className={`pointer-events-auto rounded-xl bg-[#0a192f]/95 border ${borderCol} px-3.5 py-2.5 shadow-[0_8px_28px_rgba(0,210,255,0.22)] flex items-start gap-2.5`}
              >
                <div className="mt-0.5 shrink-0">
                  {t.severity === 'error' || t.severity === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-300" />
                  ) : t.severity === 'success' ? (
                    <ShieldCheck className="w-4 h-4 text-[#64ffda]" />
                  ) : (
                    <Bell className="w-4 h-4 text-[#00d2ff]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold tracking-wider uppercase text-[#00d2ff] truncate">
                    {t.title}
                  </div>
                  <div className="text-xs text-slate-200 leading-snug mt-0.5">{t.message}</div>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss notification"
                  onClick={() => onDismissToast(t.id)}
                  className="p-0.5 rounded text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating 5-State JARVIS Arc-Reactor Orb */}
      <div className="fixed bottom-20 left-4 z-20 hidden sm:flex items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleDeck}
          aria-label="Toggle JARVIS Command Center"
          title={visual.tooltip}
          className="group flex items-center gap-2.5 rounded-full bg-[#0a192f]/95 border px-2 py-1.5 pr-3.5 shadow-[0_0_24px_rgba(0,210,255,0.25)] transition-transform hover:scale-[1.03] cursor-pointer"
          style={{
            borderColor: deckOpen ? '#64ffda' : visual.inner,
            boxShadow: `0 0 22px ${visual.inner}55`,
          }}
        >
          <span
            className="relative w-10 h-10 rounded-full overflow-hidden shrink-0 border-2 flex items-center justify-center bg-[#040c18]"
            style={{ borderColor: visual.outer }}
          >
            <img
              src="/assets/jarvis/jarvis.png"
              alt="JARVIS Arc Reactor Core"
              className="w-full h-full object-cover scale-125"
            />
          </span>
          <div className="text-left leading-tight">
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-slate-100">
              <span>JARVIS</span>
              <Radio className="w-3 h-3" style={{ color: visual.inner }} />
            </div>
            <div className="text-[10px] font-mono tracking-wide" style={{ color: visual.inner }}>
              {orbLabel || visual.label}
            </div>
          </div>
        </button>
      </div>
    </>
  );
}
