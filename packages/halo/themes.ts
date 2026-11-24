import type { HaloThemeId, HaloThemePalette } from './types';

export const HALO_THEMES: Record<Exclude<HaloThemeId, 'custom'>, HaloThemePalette> = {
  'cyan-ops': {
    id: 'cyan-ops',
    name: 'Cyan Ops',
    primary: '#22d3ee',
    secondary: '#38bdf8',
    accent: '#10b981',
    danger: '#ef4444',
    bgSurface: 'rgba(8, 14, 26, 0.94)',
    bgPanel: 'rgba(13, 22, 38, 0.96)',
    border: 'rgba(34, 211, 238, 0.35)',
    textPrimary: '#e6edf7',
    textMuted: '#94a3b8',
    scanlineOpacity: 0.08,
  },
  'amber-terminal': {
    id: 'amber-terminal',
    name: 'Amber Terminal',
    primary: '#f59e0b',
    secondary: '#fbbf24',
    accent: '#fde047',
    danger: '#f43f5e',
    bgSurface: 'rgba(18, 13, 6, 0.95)',
    bgPanel: 'rgba(26, 18, 8, 0.97)',
    border: 'rgba(245, 158, 11, 0.4)',
    textPrimary: '#fef3c7',
    textMuted: '#d97706',
    scanlineOpacity: 0.12,
  },
  'violet-neural': {
    id: 'violet-neural',
    name: 'Violet Neural',
    primary: '#a855f7',
    secondary: '#c084fc',
    accent: '#22d3ee',
    danger: '#fb7185',
    bgSurface: 'rgba(12, 8, 26, 0.94)',
    bgPanel: 'rgba(20, 13, 40, 0.96)',
    border: 'rgba(168, 85, 247, 0.4)',
    textPrimary: '#f3e8ff',
    textMuted: '#a78bfa',
    scanlineOpacity: 0.09,
  },
  'stealth-red': {
    id: 'stealth-red',
    name: 'Stealth Red',
    primary: '#f43f5e',
    secondary: '#fb7185',
    accent: '#f59e0b',
    danger: '#ef4444',
    bgSurface: 'rgba(18, 6, 10, 0.95)',
    bgPanel: 'rgba(28, 10, 15, 0.97)',
    border: 'rgba(244, 63, 94, 0.4)',
    textPrimary: '#ffe4e6',
    textMuted: '#fda4af',
    scanlineOpacity: 0.1,
  },
  'high-contrast': {
    id: 'high-contrast',
    name: 'High Contrast',
    primary: '#ffffff',
    secondary: '#38bdf8',
    accent: '#4ade80',
    danger: '#ff4d4d',
    bgSurface: '#000000',
    bgPanel: '#09090b',
    border: '#ffffff',
    textPrimary: '#ffffff',
    textMuted: '#e4e4e7',
    scanlineOpacity: 0,
  },
};

export function resolveHaloPalette(
  themeId: HaloThemeId,
  custom?: Partial<HaloThemePalette>,
): HaloThemePalette {
  if (themeId === 'custom' && custom) {
    return {
      ...HALO_THEMES['cyan-ops'],
      ...custom,
      id: 'custom',
      name: custom.name || 'Custom Palette',
    };
  }
  return HALO_THEMES[themeId === 'custom' ? 'cyan-ops' : themeId] ?? HALO_THEMES['cyan-ops'];
}
