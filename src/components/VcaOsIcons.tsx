import type { VcaOsAppId } from '../utils/vcaOsEngine';

/**
 * Self-contained Papirus-inspired colorful flat-vector SVG icons
 * matching YukiOS's desktop aesthetic with zero external CDN dependencies.
 */

export function YukiLogoSvg({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="yuki-crest-grad" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7c4dff" />
          <stop offset="55%" stopColor="#4810dc" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="12" fill="url(#yuki-crest-grad)" />
      <rect x="5" y="5" width="38" height="38" rx="11" stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" />
      <path
        d="M15 14L24 25.5L33 14"
        stroke="#ffffff"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M24 25.5V35.5"
        stroke="#e0f2fe"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle cx="34.5" cy="33.5" r="2.7" fill="#38bdf8" />
    </svg>
  );
}

export function PapirusAppIcon({
  appId,
  className = 'w-10 h-10',
}: {
  appId: VcaOsAppId | 'document' | 'settings' | 'folder';
  className?: string;
}) {
  switch (appId) {
    case 'agents':
    case 'agent-inspector':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect x="5" y="7" width="38" height="34" rx="9" fill="#0ea5e9" />
          <rect x="5" y="7" width="38" height="32" rx="9" fill="#38bdf8" />
          <rect x="12" y="16" width="24" height="16" rx="5" fill="#0f172a" />
          <circle cx="19" cy="24" r="3" fill="#22d3ee" />
          <circle cx="29" cy="24" r="3" fill="#22d3ee" />
          <rect x="20" y="10" width="8" height="3" rx="1.5" fill="#e0f2fe" />
          <rect x="18" y="34" width="12" height="2.5" rx="1.25" fill="#0284c7" />
        </svg>
      );

    case 'terminal':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect x="4" y="8" width="40" height="32" rx="6" fill="#1e293b" />
          <rect x="4" y="8" width="40" height="30" rx="6" fill="#334155" />
          <rect x="7" y="12" width="34" height="23" rx="3" fill="#0f172a" />
          <path
            d="M12 18L19 23L12 28"
            stroke="#34d399"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="22" y="26.5" width="11" height="2.8" rx="1" fill="#e2e8f0" />
        </svg>
      );

    case 'explorer':
    case 'folder':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <path
            d="M5 13C5 10.7909 6.79086 9 9 9H18.5L22 13H39C41.2091 13 43 14.7909 43 17V36C43 38.2091 41.2091 40 39 40H9C6.79086 40 5 38.2091 5 36V13Z"
            fill="#3b82f6"
          />
          <rect x="5" y="16" width="38" height="23" rx="4" fill="#60a5fa" />
          <rect x="9" y="19" width="30" height="3" rx="1.5" fill="#dbeafe" opacity="0.65" />
        </svg>
      );

    case 'projects':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect x="5" y="6" width="38" height="36" rx="7" fill="#d97706" />
          <rect x="5" y="6" width="38" height="34" rx="7" fill="#f59e0b" />
          <rect x="11" y="13" width="11" height="10" rx="2.5" fill="#fffbeb" />
          <rect x="26" y="13" width="11" height="10" rx="2.5" fill="#fde68a" />
          <rect x="11" y="26" width="26" height="8" rx="2.5" fill="#fffbeb" />
        </svg>
      );

    case 'monitor':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect x="4" y="7" width="40" height="34" rx="7" fill="#be185d" />
          <rect x="4" y="7" width="40" height="32" rx="7" fill="#ec4899" />
          <rect x="8" y="12" width="32" height="22" rx="4" fill="#1e1b4b" />
          <path
            d="M11 25H16.5L20 17L24.5 29.5L28 21.5L31.5 25H37"
            stroke="#38bdf8"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case 'world3d':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect x="5" y="6" width="38" height="36" rx="9" fill="#4338ca" />
          <rect x="5" y="6" width="38" height="34" rx="9" fill="#6366f1" />
          <polygon points="24,11 36,18 24,25 12,18" fill="#a5f3fc" />
          <polygon points="12,18 24,25 24,37 12,30" fill="#38bdf8" />
          <polygon points="36,18 24,25 24,37 36,30" fill="#818cf8" />
        </svg>
      );

    case 'document':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <path
            d="M10 6H29L38 15V40C38 41.6569 36.6569 43 35 43H10C8.34315 43 7 41.6569 7 40V9C7 7.34315 8.34315 6 10 6Z"
            fill="#e2e8f0"
          />
          <path d="M29 6L38 15H31C29.8954 15 29 14.1046 29 13V6Z" fill="#94a3b8" />
          <rect x="13" y="20" width="19" height="2.6" rx="1.3" fill="#475569" />
          <rect x="13" y="26" width="19" height="2.6" rx="1.3" fill="#475569" />
          <rect x="13" y="32" width="13" height="2.6" rx="1.3" fill="#64748b" />
        </svg>
      );

    case 'settings':
      return (
        <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
          <rect x="5" y="6" width="38" height="36" rx="9" fill="#475569" />
          <rect x="5" y="6" width="38" height="34" rx="9" fill="#64748b" />
          <circle cx="24" cy="23" r="9" stroke="#f8fafc" strokeWidth="4" />
          <circle cx="24" cy="23" r="3.5" fill="#38bdf8" />
        </svg>
      );
  }
}
