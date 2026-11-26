export type VcaOsMode = 'native' | 'macos' | 'tiling' | 'win11' | 'chromeos' | 'deck';

export type VcaOsAppId =
  | 'agents'
  | 'terminal'
  | 'explorer'
  | 'projects'
  | 'monitor'
  | 'world3d'
  | 'agent-inspector';

export interface VcaOsWindow {
  id: string;
  appId: VcaOsAppId;
  title: string;
  workspace: number; // 1..9
  x: number; // px in desktop area
  y: number; // px in desktop area
  w: number; // px
  h: number; // px
  minimized: boolean;
  maximized: boolean;
  floating: boolean;
  zIndex: number;
  agentId?: string;
}

export interface TilingConfig {
  layout: 'bsp' | 'master-stack';
  gapsInner: number;
  gapsOuter: number;
  splitRatio: number;
  borderWidth: number;
  activeBorderColor: string;
  inactiveBorderColor: string;
}

export interface VfsNode {
  path: string;
  content: string;
  updatedAt: number;
  readOnly?: boolean;
}

export interface VcaOsStateSnapshot {
  mode: VcaOsMode;
  activeWorkspace: number;
  tilingConfig: TilingConfig;
  vfsNodes: VfsNode[];
  updatedAt: number;
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const VCA_OS_MODES: Array<{
  id: VcaOsMode;
  label: string;
  shortLabel: string;
  subtitle: string;
}> = [
  { id: 'native', label: 'YukiOS Desktop', shortLabel: 'YukiOS', subtitle: 'Plasma-inspired glass taskbar, desktop icon grid & split Start menu' },
  { id: 'tiling', label: 'Hyprland BSP', shortLabel: 'Hyprland', subtitle: 'Dynamic BSP & Master-Stack tiling across 9 workspaces' },
  { id: 'macos', label: 'macOS Shell', shortLabel: 'macOS', subtitle: 'Global menu bar, Launchpad, Dock & traffic-light chrome' },
  { id: 'win11', label: 'Windows 11', shortLabel: 'Win11', subtitle: 'Centered taskbar, Start menu & pinned agent tiles' },
  { id: 'chromeos', label: 'ChromeOS', shortLabel: 'ChromeOS', subtitle: 'Bottom shelf launcher & streamlined cloud desktop' },
  { id: 'deck', label: 'VCA Deck', shortLabel: 'Deck', subtitle: 'Console full-tile launcher for agents, rigs & 3D worlds' },
];

export const DEFAULT_TILING_CONFIG: TilingConfig = {
  layout: 'bsp',
  gapsInner: 10,
  gapsOuter: 12,
  splitRatio: 0.52,
  borderWidth: 2,
  activeBorderColor: '#22d3ee',
  inactiveBorderColor: '#334155',
};

export function getModeViewportInsets(mode: VcaOsMode): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (mode === 'macos') return { top: 32, bottom: 72, left: 0, right: 0 };
  if (mode === 'tiling') return { top: 38, bottom: 8, left: 0, right: 0 };
  if (mode === 'win11') return { top: 0, bottom: 48, left: 0, right: 0 };
  if (mode === 'chromeos') return { top: 0, bottom: 46, left: 0, right: 0 };
  if (mode === 'deck') return { top: 44, bottom: 0, left: 0, right: 0 };
  return { top: 0, bottom: 48, left: 0, right: 0 };
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_TILING_CONFIG.splitRatio;
  return Math.max(0.25, Math.min(0.75, Number(ratio.toFixed(2))));
}

/**
 * Computes deterministic non-overlapping window rectangles for Hyprland BSP
 * or Master-Stack tiling layout inside `bounds`.
 */
export function computeTiledRects(
  windowIds: string[],
  bounds: { width: number; height: number },
  config: TilingConfig,
  insets = { top: 0, bottom: 0, left: 0, right: 0 },
): Record<string, PixelRect> {
  const result: Record<string, PixelRect> = {};
  if (windowIds.length === 0) return result;

  const padOut = Math.max(0, config.gapsOuter);
  const gapIn = Math.max(0, config.gapsInner);
  const ratio = clampSplitRatio(config.splitRatio);

  const area: PixelRect = {
    x: insets.left + padOut,
    y: insets.top + padOut,
    w: Math.max(160, bounds.width - insets.left - insets.right - padOut * 2),
    h: Math.max(140, bounds.height - insets.top - insets.bottom - padOut * 2),
  };

  if (windowIds.length === 1) {
    result[windowIds[0]] = { ...area };
    return result;
  }

  if (config.layout === 'master-stack') {
    const masterW = Math.round((area.w - gapIn) * ratio);
    const stackW = area.w - gapIn - masterW;
    result[windowIds[0]] = {
      x: area.x,
      y: area.y,
      w: masterW,
      h: area.h,
    };
    const stackIds = windowIds.slice(1);
    const totalGaps = gapIn * (stackIds.length - 1);
    const eachH = Math.floor((area.h - totalGaps) / stackIds.length);
    stackIds.forEach((id, idx) => {
      const y = area.y + idx * (eachH + gapIn);
      const isLast = idx === stackIds.length - 1;
      const h = isLast ? area.y + area.h - y : eachH;
      result[id] = {
        x: area.x + masterW + gapIn,
        y,
        w: stackW,
        h,
      };
    });
    return result;
  }

  // Recursive Binary Space Partitioning (BSP) matching YukiOS TilingLayoutEngine
  const bspSplit = (ids: string[], rect: PixelRect) => {
    if (ids.length === 1) {
      result[ids[0]] = rect;
      return;
    }
    const [head, ...rest] = ids;
    const splitHorizontal = rect.w >= rect.h;
    if (splitHorizontal) {
      const firstW = Math.round((rect.w - gapIn) * ratio);
      const secondW = rect.w - gapIn - firstW;
      result[head] = {
        x: rect.x,
        y: rect.y,
        w: firstW,
        h: rect.h,
      };
      bspSplit(rest, {
        x: rect.x + firstW + gapIn,
        y: rect.y,
        w: secondW,
        h: rect.h,
      });
    } else {
      const firstH = Math.round((rect.h - gapIn) * ratio);
      const secondH = rect.h - gapIn - firstH;
      result[head] = {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: firstH,
      };
      bspSplit(rest, {
        x: rect.x,
        y: rect.y + firstH + gapIn,
        w: rect.w,
        h: secondH,
      });
    }
  };

  bspSplit(windowIds, area);
  return result;
}

export function serializeTilingConf(cfg: TilingConfig): string {
  return [
    '# VCAOS Hyprland Compositor Config (Live-Reloaded on Save)',
    `layout = ${cfg.layout}`,
    `gaps_in = ${cfg.gapsInner}`,
    `gaps_out = ${cfg.gapsOuter}`,
    `split_ratio = ${clampSplitRatio(cfg.splitRatio)}`,
    `border_size = ${cfg.borderWidth}`,
    `col.active_border = ${cfg.activeBorderColor}`,
    `col.inactive_border = ${cfg.inactiveBorderColor}`,
  ].join('\n');
}

export function parseTilingConf(text: string, fallback: TilingConfig = DEFAULT_TILING_CONFIG): TilingConfig {
  const next: TilingConfig = { ...fallback };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const val = line.slice(eq + 1).trim();
    if (key === 'layout' && (val === 'bsp' || val === 'master-stack')) {
      next.layout = val;
    } else if (key === 'gaps_in') {
      const n = Number(val);
      if (Number.isFinite(n)) next.gapsInner = Math.max(0, Math.min(48, Math.round(n)));
    } else if (key === 'gaps_out') {
      const n = Number(val);
      if (Number.isFinite(n)) next.gapsOuter = Math.max(0, Math.min(64, Math.round(n)));
    } else if (key === 'split_ratio') {
      next.splitRatio = clampSplitRatio(Number(val));
    } else if (key === 'border_size') {
      const n = Number(val);
      if (Number.isFinite(n)) next.borderWidth = Math.max(1, Math.min(6, Math.round(n)));
    } else if (key === 'col.active_border' && /^#[0-9a-fA-F]{6}$/.test(val)) {
      next.activeBorderColor = val;
    } else if (key === 'col.inactive_border' && /^#[0-9a-fA-F]{6}$/.test(val)) {
      next.inactiveBorderColor = val;
    }
  }
  return next;
}

export function createDefaultVfsNodes(tilingConfig: TilingConfig = DEFAULT_TILING_CONFIG): VfsNode[] {
  const now = Date.now();
  return [
    {
      path: 'Config/vcaos/tiling.conf',
      content: serializeTilingConf(tilingConfig),
      updatedAt: now,
    },
    {
      path: 'Documents/VCAOS.md',
      content: [
        '# VCAOS // YukiOS Multi-Environment Platform',
        '',
        'Shared-state desktop switching across 6 desktop shells without losing active windows:',
        '- Hyprland BSP (Alt+1..9 workspaces, real BSP/Master-Stack engine, live tiling.conf)',
        '- macOS Shell (Menu Bar, Launchpad, Control Center, Dock)',
        '- Yuki Native, Windows 11, ChromeOS Shelf, and VCA Deck',
        '',
        'Quick CLI (`hyprctl`):',
        '  hyprctl dispatch workspace 2',
        '  hyprctl keyword layout master-stack',
        '  hyprctl keyword gaps_in 14',
        '  hyprctl dispatch mode macos',
      ].join('\n'),
      updatedAt: now,
    },
    {
      path: 'Desktop/AGENT_BRIDGE.txt',
      content: [
        'VISUAL AGENT PLATFORM BRIDGE: ACTIVE',
        'Double-click any agent inside Visual Agents Studio to open its dedicated VCAOS runtime window.',
        'Use 3D Bridge to focus agents or activate the "vcaos-nexus" 3D environment biome.',
      ].join('\n'),
      updatedAt: now,
    },
  ];
}

export interface HyprctlEvalResult {
  handled: boolean;
  output: string;
  patch?: {
    mode?: VcaOsMode;
    activeWorkspace?: number;
    tilingConfig?: TilingConfig;
    toggleFloatingFocused?: boolean;
    swapNext?: boolean;
  };
}

export function evaluateHyprctlCommand(
  rawCommand: string,
  context: {
    mode: VcaOsMode;
    activeWorkspace: number;
    tilingConfig: TilingConfig;
    windows: VcaOsWindow[];
    focusedWindowId: string | null;
  },
): HyprctlEvalResult {
  const trimmed = rawCommand.trim();
  if (!trimmed.toLowerCase().startsWith('hyprctl')) {
    return { handled: false, output: '' };
  }
  const tokens = trimmed.split(/\s+/).slice(1);
  if (tokens.length === 0 || tokens[0] === 'help') {
    return {
      handled: true,
      output: [
        'VCAOS hyprctl // Hyprland Compositor IPC',
        '  hyprctl workspaces                    List active workspaces 1..9',
        '  hyprctl clients                       List open shared-state windows',
        '  hyprctl dispatch workspace <1-9>      Switch workspace',
        '  hyprctl dispatch togglefloating       Toggle floating on focused window',
        '  hyprctl dispatch swapnext             Swap focused window order',
        '  hyprctl dispatch mode <name>          Switch DE (tiling|macos|native|win11|chromeos|deck)',
        '  hyprctl keyword gaps_in <0..48>       Set inner tiling gap',
        '  hyprctl keyword gaps_out <0..64>      Set outer tiling gap',
        '  hyprctl keyword split_ratio <0.25..0.75> Set BSP split ratio',
        '  hyprctl keyword layout <bsp|master-stack> Switch tiling engine',
      ].join('\n'),
    };
  }

  const sub = tokens[0].toLowerCase();
  if (sub === 'workspaces') {
    const lines: string[] = [];
    for (let ws = 1; ws <= 9; ws++) {
      const count = context.windows.filter((w) => w.workspace === ws && !w.minimized).length;
      if (ws === context.activeWorkspace || count > 0) {
        lines.push(
          `workspace ID ${ws}${ws === context.activeWorkspace ? ' (active)' : ''} -> ${count} window(s)`,
        );
      }
    }
    return { handled: true, output: lines.join('\n') || 'No active workspaces.' };
  }

  if (sub === 'clients') {
    if (context.windows.length === 0) {
      return { handled: true, output: 'No running windows.' };
    }
    return {
      handled: true,
      output: context.windows
        .map(
          (w) =>
            `[${w.id}] "${w.title}" ws:${w.workspace} app:${w.appId} ${w.floating ? 'floating' : 'tiled'}${
              w.id === context.focusedWindowId ? ' *focused' : ''
            }`,
        )
        .join('\n'),
    };
  }

  if (sub === 'dispatch' && tokens.length >= 2) {
    const action = tokens[1].toLowerCase();
    const arg = tokens[2]?.toLowerCase();
    if (action === 'workspace') {
      const ws = Number(arg);
      if (Number.isInteger(ws) && ws >= 1 && ws <= 9) {
        return {
          handled: true,
          output: `ok -> switched to workspace ${ws}`,
          patch: { activeWorkspace: ws },
        };
      }
      return { handled: true, output: 'error: workspace must be 1..9' };
    }
    if (action === 'togglefloating') {
      return {
        handled: true,
        output: 'ok -> toggled floating state on focused window',
        patch: { toggleFloatingFocused: true },
      };
    }
    if (action === 'swapnext') {
      return {
        handled: true,
        output: 'ok -> swapped focused window in tiling tree',
        patch: { swapNext: true },
      };
    }
    if (action === 'mode') {
      const valid = VCA_OS_MODES.find((m) => m.id === arg);
      if (valid) {
        return {
          handled: true,
          output: `ok -> morphed desktop shell to "${valid.label}" (shared windows preserved)`,
          patch: { mode: valid.id },
        };
      }
      return {
        handled: true,
        output: `error: unknown mode "${arg ?? ''}". Use native|macos|tiling|win11|chromeos|deck`,
      };
    }
  }

  if (sub === 'keyword' && tokens.length >= 3) {
    const key = tokens[1].toLowerCase();
    const val = tokens[2].toLowerCase();
    const cfg = { ...context.tilingConfig };
    if (key === 'gaps_in' || key === 'gaps') {
      const n = Number(val);
      if (!Number.isFinite(n)) return { handled: true, output: 'error: numeric value expected' };
      cfg.gapsInner = Math.max(0, Math.min(48, Math.round(n)));
      return { handled: true, output: `ok -> gaps_in = ${cfg.gapsInner}`, patch: { tilingConfig: cfg } };
    }
    if (key === 'gaps_out') {
      const n = Number(val);
      if (!Number.isFinite(n)) return { handled: true, output: 'error: numeric value expected' };
      cfg.gapsOuter = Math.max(0, Math.min(64, Math.round(n)));
      return { handled: true, output: `ok -> gaps_out = ${cfg.gapsOuter}`, patch: { tilingConfig: cfg } };
    }
    if (key === 'split_ratio') {
      cfg.splitRatio = clampSplitRatio(Number(val));
      return { handled: true, output: `ok -> split_ratio = ${cfg.splitRatio}`, patch: { tilingConfig: cfg } };
    }
    if (key === 'layout' && (val === 'bsp' || val === 'master-stack')) {
      cfg.layout = val;
      return { handled: true, output: `ok -> layout = ${cfg.layout}`, patch: { tilingConfig: cfg } };
    }
  }

  return {
    handled: true,
    output: `hyprctl: unrecognized command "${trimmed}". Run "hyprctl help".`,
  };
}
