/**
 * Design tokens for the elderly-care coordination platform.
 *
 * Phase 1 ships the token surface only. Components land in the
 * web and mobile apps in later phases; this file is the single
 * source of truth for colors, spacing, and typography.
 *
 * Targets:
 *   - Large, legible typography (base 18px / 18sp).
 *   - High contrast (WCAG AA at minimum).
 *   - Large touch targets (>= 48x48dp).
 *   - Calm, trustworthy, warm aesthetic.
 */

export const palette = {
  // Brand
  primary: '#0F4C81', // deep, trustworthy blue
  primaryContrast: '#FFFFFF',
  accent: '#E08A3C', // warm amber for actions
  accentContrast: '#1B1B1B',

  // Surfaces
  background: '#F7F6F2', // warm off-white
  surface: '#FFFFFF',
  surfaceMuted: '#EFEDE6',

  // Text
  text: '#1B1B1B',
  textMuted: '#4A4A4A',
  textInverse: '#FFFFFF',

  // Semantic
  success: '#1F7A4D',
  warning: '#B7791F',
  danger: '#B23A48',
  info: '#1F6F8B',

  // Focus
  focusRing: '#0F4C81',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 9999,
} as const;

export const typography = {
  fontFamily: {
    sans: 'System',
    serif: 'System',
  },
  fontSize: {
    // Elevated baseline for senior-friendly UI.
    xs: 14,
    sm: 16,
    md: 18,
    lg: 20,
    xl: 24,
    '2xl': 30,
    '3xl': 36,
    '4xl': 48,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.45,
    relaxed: 1.6,
  },
  fontWeight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const controlSize = {
  // WCAG 2.5.5 target size minimum.
  minTouchTarget: 48,
} as const;

export const elevation = {
  none: 'none',
  sm: '0 1px 2px rgba(0,0,0,0.06)',
  md: '0 2px 6px rgba(0,0,0,0.08)',
  lg: '0 4px 12px rgba(0,0,0,0.10)',
} as const;
