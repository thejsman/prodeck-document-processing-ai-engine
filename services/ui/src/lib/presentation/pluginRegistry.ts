import type { PluginMeta, PluginTokens } from '../../types/presentation';
import { enforceWCAGTokens } from './wcag';

// ── Plugin definitions ───────────────────────────────────────────────────────
// Design system: clean, minimal, professional — no noise, no mesh, no glows.
// Shadows are paper-light on light themes, slightly deeper on dark themes.
// gradientHero is always a simple linear top-to-bottom. meshGradient is always ''.
// labelTracking is ≤0.06em. heroStyle is always 'normal'.

const OBSIDIAN_TOKENS: PluginTokens = {
  bg: '#0c0c0c',
  surface: '#141414',
  surfaceAlt: '#1a1a1a',
  surfaceCard: '#111111',
  text: '#e8e4dc',
  textMuted: '#8a8680',
  textSubtle: '#4a4845',
  accent: '#c8a96e',
  accentDim: '#967f50',
  accentRgb: '200,169,110',
  glowColor: 'rgba(200,169,110,0.08)',
  border: '#242424',
  borderSubtle: '#1c1c1c',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'Inter',
  heroWeight: 400,
  heroStyle: 'normal',
  labelTracking: '0.06em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #1a1a1a 0%, #0c0c0c 100%)',
  gradientText: 'linear-gradient(135deg, #d4b878 0%, #c8a96e 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.45)',
};

const IVORY_TOKENS: PluginTokens = {
  bg: '#fafaf8',
  surface: '#ffffff',
  surfaceAlt: '#f4f2ed',
  surfaceCard: '#fdfdfc',
  text: '#111111',
  textMuted: '#6b6560',
  textSubtle: '#a09890',
  accent: '#111111',
  accentDim: '#3a3530',
  accentRgb: '17,17,17',
  glowColor: 'rgba(17,17,17,0.06)',
  border: '#e8e4dc',
  borderSubtle: '#f0ece4',
  heroFont: 'Playfair Display',
  bodyFont: 'Inter',
  heroWeight: 600,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #fafaf8 100%)',
  gradientText: 'linear-gradient(135deg, #111111 0%, #444444 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.09), 0 0 0 1px rgba(0,0,0,0.04)',
};

const COBALT_TOKENS: PluginTokens = {
  bg: '#09152a',
  surface: '#0e1e38',
  surfaceAlt: '#122448',
  surfaceCard: '#0b1830',
  text: '#e4ecf7',
  textMuted: '#7a9abf',
  textSubtle: '#3e5f82',
  accent: '#4fa3e8',
  accentDim: '#2d6ca8',
  accentRgb: '79,163,232',
  glowColor: 'rgba(79,163,232,0.08)',
  border: '#162e4a',
  borderSubtle: '#102438',
  heroFont: 'Plus Jakarta Sans',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #122448 0%, #09152a 100%)',
  gradientText: 'linear-gradient(135deg, #74bef5 0%, #4fa3e8 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.50)',
};

const SAGE_TOKENS: PluginTokens = {
  bg: '#f4f6f0',
  surface: '#ffffff',
  surfaceAlt: '#eaece6',
  surfaceCard: '#f8faf6',
  text: '#1e2a1c',
  textMuted: '#546050',
  textSubtle: '#8a9888',
  accent: '#3d6b38',
  accentDim: '#2e5228',
  accentRgb: '61,107,56',
  glowColor: 'rgba(61,107,56,0.08)',
  border: '#d4d8ce',
  borderSubtle: '#e4e8de',
  heroFont: 'Plus Jakarta Sans',
  bodyFont: 'DM Sans',
  heroWeight: 600,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #f4f6f0 100%)',
  gradientText: 'linear-gradient(135deg, #4d8048 0%, #3d6b38 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(30,42,28,0.07)',
  cardShadowHover: '0 4px 16px rgba(30,42,28,0.11)',
};

const MIDNIGHT_TOKENS: PluginTokens = {
  bg: '#080f1e',
  surface: '#0d1628',
  surfaceAlt: '#112036',
  surfaceCard: '#0a1220',
  text: '#deeeff',
  textMuted: '#6a9ac4',
  textSubtle: '#3a6080',
  accent: '#22d3ee',
  accentDim: '#0e9fbf',
  accentRgb: '34,211,238',
  glowColor: 'rgba(34,211,238,0.08)',
  border: '#122030',
  borderSubtle: '#0e1a28',
  heroFont: 'Space Grotesk',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #112036 0%, #080f1e 100%)',
  gradientText: 'linear-gradient(135deg, #67e8f9 0%, #22d3ee 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.55)',
};

const AURORA_TOKENS: PluginTokens = {
  bg: '#fdf9f4',
  surface: '#ffffff',
  surfaceAlt: '#f5ede0',
  surfaceCard: '#fefcf8',
  text: '#1a1208',
  textMuted: '#6b5540',
  textSubtle: '#a08868',
  accent: '#c8730a',
  accentDim: '#9e5808',
  accentRgb: '200,115,10',
  glowColor: 'rgba(200,115,10,0.08)',
  border: '#e8ddd0',
  borderSubtle: '#f0e8dc',
  heroFont: 'Lora',
  bodyFont: 'Inter',
  heroWeight: 600,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #fdf9f4 100%)',
  gradientText: 'linear-gradient(135deg, #e89020 0%, #c8730a 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(26,18,8,0.08)',
  cardShadowHover: '0 4px 16px rgba(26,18,8,0.13)',
};

const SLATE_TOKENS: PluginTokens = {
  bg: '#f5f6f8',
  surface: '#ffffff',
  surfaceAlt: '#eceef2',
  surfaceCard: '#fafbfc',
  text: '#0f1117',
  textMuted: '#5c6370',
  textSubtle: '#9098a8',
  accent: '#2563eb',
  accentDim: '#1e40af',
  accentRgb: '37,99,235',
  glowColor: 'rgba(37,99,235,0.07)',
  border: '#e0e4ec',
  borderSubtle: '#eaecf2',
  heroFont: 'Inter',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.04em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #f5f6f8 100%)',
  gradientText: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(15,17,23,0.06), 0 1px 2px rgba(15,17,23,0.04)',
  cardShadowHover: '0 4px 16px rgba(15,17,23,0.09), 0 0 0 1px rgba(37,99,235,0.08)',
};

const CRIMSON_TOKENS: PluginTokens = {
  bg: '#0e0508',
  surface: '#180910',
  surfaceAlt: '#22111a',
  surfaceCard: '#150710',
  text: '#f5e6ea',
  textMuted: '#a86878',
  textSubtle: '#6a3845',
  accent: '#c41e3a',
  accentDim: '#9b1530',
  accentRgb: '196,30,58',
  glowColor: 'rgba(196,30,58,0.08)',
  border: '#2a0f18',
  borderSubtle: '#200c14',
  heroFont: 'Playfair Display',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #22111a 0%, #0e0508 100%)',
  gradientText: 'linear-gradient(135deg, #e83a58 0%, #c41e3a 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.56)',
};

const CARBON_TOKENS: PluginTokens = {
  bg: '#101214',
  surface: '#191c1f',
  surfaceAlt: '#222528',
  surfaceCard: '#151718',
  text: '#e8e9ea',
  textMuted: '#8c9098',
  textSubtle: '#50565e',
  accent: '#f97316',
  accentDim: '#c05408',
  accentRgb: '249,115,22',
  glowColor: 'rgba(249,115,22,0.08)',
  border: '#272a2d',
  borderSubtle: '#1e2124',
  heroFont: 'Space Grotesk',
  bodyFont: 'DM Sans',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #222528 0%, #101214 100%)',
  gradientText: 'linear-gradient(135deg, #fba557 0%, #f97316 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.50)',
};

const PEARL_TOKENS: PluginTokens = {
  bg: '#fdfcfb',
  surface: '#ffffff',
  surfaceAlt: '#f8f4f0',
  surfaceCard: '#fefefe',
  text: '#1a1715',
  textMuted: '#7a6d67',
  textSubtle: '#b0a49e',
  accent: '#c4956a',
  accentDim: '#9a7048',
  accentRgb: '196,149,106',
  glowColor: 'rgba(196,149,106,0.08)',
  border: '#ede8e3',
  borderSubtle: '#f3efeb',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'Inter',
  heroWeight: 400,
  heroStyle: 'normal',
  labelTracking: '0.06em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #fdfcfb 100%)',
  gradientText: 'linear-gradient(135deg, #d8a880 0%, #c4956a 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(26,23,21,0.06)',
  cardShadowHover: '0 4px 16px rgba(26,23,21,0.10), 0 0 0 1px rgba(196,149,106,0.08)',
};

const NEON_TOKENS: PluginTokens = {
  bg: '#08081a',
  surface: '#0e0e20',
  surfaceAlt: '#141430',
  surfaceCard: '#0b0b1c',
  text: '#f0f0ff',
  textMuted: '#8888cc',
  textSubtle: '#484888',
  accent: '#e11d78',
  accentDim: '#b31460',
  accentRgb: '225,29,120',
  glowColor: 'rgba(225,29,120,0.08)',
  border: '#1c1c38',
  borderSubtle: '#14142c',
  heroFont: 'Syne',
  bodyFont: 'Inter',
  heroWeight: 800,
  heroStyle: 'normal',
  labelTracking: '0.06em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #141430 0%, #08081a 100%)',
  gradientText: 'linear-gradient(135deg, #f060a8 0%, #e11d78 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.50), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.65)',
};

const FOREST_TOKENS: PluginTokens = {
  bg: '#07100a',
  surface: '#0d1a10',
  surfaceAlt: '#122016',
  surfaceCard: '#0a1510',
  text: '#e4f0e6',
  textMuted: '#6e9872',
  textSubtle: '#3a5e40',
  accent: '#22c55e',
  accentDim: '#15943f',
  accentRgb: '34,197,94',
  glowColor: 'rgba(34,197,94,0.08)',
  border: '#16281a',
  borderSubtle: '#102014',
  heroFont: 'Plus Jakarta Sans',
  bodyFont: 'DM Sans',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #122016 0%, #07100a 100%)',
  gradientText: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.55)',
};

const GOLD_TOKENS: PluginTokens = {
  bg: '#0a0900',
  surface: '#141200',
  surfaceAlt: '#1e1a00',
  surfaceCard: '#111000',
  text: '#f5eed6',
  textMuted: '#b8a870',
  textSubtle: '#786840',
  accent: '#d4a017',
  accentDim: '#a87d10',
  accentRgb: '212,160,23',
  glowColor: 'rgba(212,160,23,0.08)',
  border: '#282200',
  borderSubtle: '#201c00',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'Inter',
  heroWeight: 400,
  heroStyle: 'normal',
  labelTracking: '0.08em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #1e1a00 0%, #0a0900 100%)',
  gradientText: 'linear-gradient(135deg, #e8c840 0%, #d4a017 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.44), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.60)',
};

const OCEAN_TOKENS: PluginTokens = {
  bg: '#030c18',
  surface: '#071828',
  surfaceAlt: '#0c2238',
  surfaceCard: '#051420',
  text: '#dff2ff',
  textMuted: '#5aa0be',
  textSubtle: '#2e6080',
  accent: '#0ea5c9',
  accentDim: '#0878a0',
  accentRgb: '14,165,201',
  glowColor: 'rgba(14,165,201,0.08)',
  border: '#092838',
  borderSubtle: '#071e2e',
  heroFont: 'Plus Jakarta Sans',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #0c2238 0%, #030c18 100%)',
  gradientText: 'linear-gradient(135deg, #38c8e8 0%, #0ea5c9 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.44), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.60)',
};

const ROSE_TOKENS: PluginTokens = {
  bg: '#180810',
  surface: '#220f18',
  surfaceAlt: '#2c1422',
  surfaceCard: '#1e0c14',
  text: '#ffeef5',
  textMuted: '#c07890',
  textSubtle: '#803858',
  accent: '#e8457a',
  accentDim: '#c02258',
  accentRgb: '232,69,122',
  glowColor: 'rgba(232,69,122,0.08)',
  border: '#320f20',
  borderSubtle: '#280a18',
  heroFont: 'Playfair Display',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #2c1422 0%, #180810 100%)',
  gradientText: 'linear-gradient(135deg, #f8709a 0%, #e8457a 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.44), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.60)',
};

const CHALK_TOKENS: PluginTokens = {
  bg: '#fafaf8',
  surface: '#ffffff',
  surfaceAlt: '#f2f2ee',
  surfaceCard: '#fefefe',
  text: '#1c1c1a',
  textMuted: '#6b6b68',
  textSubtle: '#a0a09e',
  accent: '#374151',
  accentDim: '#1f2937',
  accentRgb: '55,65,81',
  glowColor: 'rgba(55,65,81,0.07)',
  border: '#e8e8e4',
  borderSubtle: '#ededeb',
  heroFont: 'Libre Baskerville',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #fafaf8 100%)',
  gradientText: 'linear-gradient(135deg, #4b5563 0%, #374151 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(28,28,26,0.07)',
  cardShadowHover: '0 4px 16px rgba(28,28,26,0.11)',
};

const DUSK_TOKENS: PluginTokens = {
  bg: '#0c0820',
  surface: '#130c2e',
  surfaceAlt: '#1a1040',
  surfaceCard: '#0f0a28',
  text: '#ede8ff',
  textMuted: '#9080cc',
  textSubtle: '#504080',
  accent: '#a855f7',
  accentDim: '#7c3aed',
  accentRgb: '168,85,247',
  glowColor: 'rgba(168,85,247,0.08)',
  border: '#1e1040',
  borderSubtle: '#180c32',
  heroFont: 'Plus Jakarta Sans',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #1a1040 0%, #0c0820 100%)',
  gradientText: 'linear-gradient(135deg, #c084fc 0%, #a855f7 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.48), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.64)',
};

const COPPER_TOKENS: PluginTokens = {
  bg: '#0d0805',
  surface: '#180f08',
  surfaceAlt: '#221508',
  surfaceCard: '#150d06',
  text: '#f5ede6',
  textMuted: '#c0988a',
  textSubtle: '#806050',
  accent: '#b87333',
  accentDim: '#8b5523',
  accentRgb: '184,115,51',
  glowColor: 'rgba(184,115,51,0.08)',
  border: '#281810',
  borderSubtle: '#1e1208',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'Inter',
  heroWeight: 400,
  heroStyle: 'normal',
  labelTracking: '0.06em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #221508 0%, #0d0805 100%)',
  gradientText: 'linear-gradient(135deg, #d49050 0%, #b87333 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.44), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.60)',
};

const ARCTIC_TOKENS: PluginTokens = {
  bg: '#f2f8ff',
  surface: '#ffffff',
  surfaceAlt: '#e4f0ff',
  surfaceCard: '#f8fbff',
  text: '#0d1b2e',
  textMuted: '#3a5a80',
  textSubtle: '#6888a8',
  accent: '#1e6ec8',
  accentDim: '#1453a0',
  accentRgb: '30,110,200',
  glowColor: 'rgba(30,110,200,0.07)',
  border: '#c8dff5',
  borderSubtle: '#d8eaff',
  heroFont: 'Inter',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.04em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #f2f8ff 100%)',
  gradientText: 'linear-gradient(135deg, #3a90e8 0%, #1e6ec8 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(13,27,46,0.07)',
  cardShadowHover: '0 4px 16px rgba(13,27,46,0.12), 0 0 0 1px rgba(30,110,200,0.10)',
};

const EMBER_TOKENS: PluginTokens = {
  bg: '#0a0500',
  surface: '#160900',
  surfaceAlt: '#200d00',
  surfaceCard: '#120700',
  text: '#fff5ee',
  textMuted: '#c8806a',
  textSubtle: '#884030',
  accent: '#ea580c',
  accentDim: '#c2410c',
  accentRgb: '234,88,12',
  glowColor: 'rgba(234,88,12,0.08)',
  border: '#2a0e00',
  borderSubtle: '#200a00',
  heroFont: 'Syne',
  bodyFont: 'DM Sans',
  heroWeight: 800,
  heroStyle: 'normal',
  labelTracking: '0.06em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #200d00 0%, #0a0500 100%)',
  gradientText: 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.48), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.64)',
};

const LAVENDER_TOKENS: PluginTokens = {
  bg: '#f8f5ff',
  surface: '#ffffff',
  surfaceAlt: '#ede8ff',
  surfaceCard: '#fcfaff',
  text: '#1a1228',
  textMuted: '#5a40a0',
  textSubtle: '#9878c8',
  accent: '#7c3aed',
  accentDim: '#6d28d9',
  accentRgb: '124,58,237',
  glowColor: 'rgba(124,58,237,0.07)',
  border: '#e0d8f8',
  borderSubtle: '#ece8fc',
  heroFont: 'Plus Jakarta Sans',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.04em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #f8f5ff 100%)',
  gradientText: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(26,18,40,0.07)',
  cardShadowHover: '0 4px 16px rgba(26,18,40,0.11), 0 0 0 1px rgba(124,58,237,0.08)',
};

const STEEL_TOKENS: PluginTokens = {
  bg: '#0c1420',
  surface: '#122030',
  surfaceAlt: '#182840',
  surfaceCard: '#0f1a2a',
  text: '#c8d8e8',
  textMuted: '#6888a8',
  textSubtle: '#3c5878',
  accent: '#60a8d8',
  accentDim: '#4080b8',
  accentRgb: '96,168,216',
  glowColor: 'rgba(96,168,216,0.08)',
  border: '#1e2e42',
  borderSubtle: '#182435',
  heroFont: 'Space Grotesk',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #182840 0%, #0c1420 100%)',
  gradientText: 'linear-gradient(135deg, #90c4e8 0%, #60a8d8 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.38), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.54)',
};

const TERRA_TOKENS: PluginTokens = {
  bg: '#f7f0e8',
  surface: '#ffffff',
  surfaceAlt: '#ede4d5',
  surfaceCard: '#fbf7f2',
  text: '#2a1a0a',
  textMuted: '#7a5038',
  textSubtle: '#b08060',
  accent: '#b45309',
  accentDim: '#92400e',
  accentRgb: '180,83,9',
  glowColor: 'rgba(180,83,9,0.08)',
  border: '#ddd0bc',
  borderSubtle: '#e8ddd0',
  heroFont: 'Plus Jakarta Sans',
  bodyFont: 'DM Sans',
  heroWeight: 600,
  heroStyle: 'normal',
  labelTracking: '0.05em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #f7f0e8 100%)',
  gradientText: 'linear-gradient(135deg, #d87020 0%, #b45309 100%)',
  meshGradient: '',
  cardShadow: '0 1px 3px rgba(42,26,10,0.08)',
  cardShadowHover: '0 4px 16px rgba(42,26,10,0.13)',
};

const VOID_TOKENS: PluginTokens = {
  bg: '#000000',
  surface: '#0d0d0d',
  surfaceAlt: '#141414',
  surfaceCard: '#0a0a0a',
  text: '#f8f8f8',
  textMuted: '#888888',
  textSubtle: '#444444',
  accent: '#8b5cf6',
  accentDim: '#7c3aed',
  accentRgb: '139,92,246',
  glowColor: 'rgba(139,92,246,0.08)',
  border: '#1c1c1c',
  borderSubtle: '#161616',
  heroFont: 'Syne',
  bodyFont: 'Inter',
  heroWeight: 800,
  heroStyle: 'normal',
  labelTracking: '0.06em',
  dark: true,
  noiseOpacity: 0,
  gradientHero: 'linear-gradient(180deg, #141414 0%, #000000 100%)',
  gradientText: 'linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%)',
  meshGradient: '',
  cardShadow: '0 1px 4px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)',
  cardShadowHover: '0 4px 16px rgba(0,0,0,0.72)',
};

// ── Shared font URLs ──────────────────────────────────────────────────────────
const FONT_INTER        = { family: 'Inter',             url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap' };
const FONT_DM_SANS      = { family: 'DM Sans',           url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap' };
const FONT_PLUS_JAKARTA = { family: 'Plus Jakarta Sans', url: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap' };
const FONT_SPACE_GROTESK = { family: 'Space Grotesk',    url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap' };
const FONT_SYNE         = { family: 'Syne',              url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap' };
const FONT_CORMORANT    = { family: 'Cormorant Garamond', url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' };
const FONT_PLAYFAIR     = { family: 'Playfair Display',  url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap' };
const FONT_LORA         = { family: 'Lora',              url: 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400;1,600&display=swap' };
const FONT_LIBRE_BASK   = { family: 'Libre Baskerville', url: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap' };

// ── Plugin registry ──────────────────────────────────────────────────────────

export const PLUGINS: PluginMeta[] = [
  {
    id: 'obsidian',
    name: 'Obsidian Luxury',
    description: 'Dark editorial with refined gold accents',
    character: 'WSJ meets Bottega Veneta',
    tokens: OBSIDIAN_TOKENS,
    fonts: [FONT_CORMORANT, FONT_INTER],
  },
  {
    id: 'ivory',
    name: 'Ivory Editorial',
    description: 'Light magazine with confident ink black',
    character: 'The Economist meets Kinfolk',
    tokens: IVORY_TOKENS,
    fonts: [FONT_PLAYFAIR, FONT_INTER],
  },
  {
    id: 'cobalt',
    name: 'Cobalt Executive',
    description: 'Deep navy with electric blue command',
    character: 'Bloomberg meets McKinsey',
    tokens: COBALT_TOKENS,
    fonts: [FONT_PLUS_JAKARTA, FONT_INTER],
  },
  {
    id: 'sage',
    name: 'Sage Organic',
    description: 'Warm earth tones with forest greens',
    character: 'Patagonia meets IDEO',
    tokens: SAGE_TOKENS,
    fonts: [FONT_PLUS_JAKARTA, FONT_DM_SANS],
  },
  {
    id: 'midnight',
    name: 'Midnight Electric',
    description: 'Deep navy with neon cyan tech-forward energy',
    character: 'Wired meets Verge',
    tokens: MIDNIGHT_TOKENS,
    fonts: [FONT_SPACE_GROTESK, FONT_INTER],
  },
  {
    id: 'aurora',
    name: 'Aurora Editorial',
    description: 'Warm amber and forest green, cinematic editorial',
    character: 'National Geographic meets Monocle',
    tokens: AURORA_TOKENS,
    fonts: [FONT_LORA, FONT_INTER],
  },
  {
    id: 'slate',
    name: 'Slate Minimal',
    description: 'Cool gray minimal, crisp corporate precision',
    character: 'Harvard Business Review meets Stripe',
    tokens: SLATE_TOKENS,
    fonts: [FONT_INTER],
  },
  {
    id: 'crimson',
    name: 'Crimson Literary',
    description: 'Deep burgundy with gold, bold and authoritative',
    character: 'The Atlantic meets LVMH',
    tokens: CRIMSON_TOKENS,
    fonts: [FONT_PLAYFAIR, FONT_INTER],
  },
  {
    id: 'carbon',
    name: 'Carbon Industrial',
    description: 'Dark graphite with orange highlights, mechanical',
    character: 'Wired Hardware meets Industrial Design',
    tokens: CARBON_TOKENS,
    fonts: [FONT_SPACE_GROTESK, FONT_DM_SANS],
  },
  {
    id: 'pearl',
    name: 'Pearl Refined',
    description: 'Soft white with blush tones, generous whitespace',
    character: 'Apple meets Kinfolk',
    tokens: PEARL_TOKENS,
    fonts: [FONT_CORMORANT, FONT_INTER],
  },
  {
    id: 'neon',
    name: 'Neon Punk',
    description: 'Dark with vivid magenta and lime, high energy',
    character: 'Cyberpunk meets Pitch deck',
    tokens: NEON_TOKENS,
    fonts: [FONT_SYNE, FONT_INTER],
  },
  {
    id: 'forest',
    name: 'Forest Mission',
    description: 'Deep greens, earthy tones, mission-driven',
    character: 'Patagonia meets McKinsey Sustainability',
    tokens: FOREST_TOKENS,
    fonts: [FONT_PLUS_JAKARTA, FONT_DM_SANS],
  },
  {
    id: 'gold',
    name: 'Gold Ultra-Premium',
    description: 'Champagne and deep black, ultra-premium luxury',
    character: 'Sothebys meets Rolex',
    tokens: GOLD_TOKENS,
    fonts: [FONT_CORMORANT, FONT_INTER],
  },
  {
    id: 'ocean',
    name: 'Ocean Data',
    description: 'Deep teal gradient, data-confident and forward-looking',
    character: 'MIT Technology Review meets Salesforce',
    tokens: OCEAN_TOKENS,
    fonts: [FONT_PLUS_JAKARTA, FONT_INTER],
  },
  {
    id: 'rose',
    name: 'Rose Editorial',
    description: 'Deep rose with blush pink, bold feminine authority',
    character: 'Vogue meets Condé Nast',
    tokens: ROSE_TOKENS,
    fonts: [FONT_PLAYFAIR, FONT_INTER],
  },
  {
    id: 'chalk',
    name: 'Chalk Academic',
    description: 'Warm cream with graphite, clean and scholarly',
    character: 'Harvard meets The Atlantic',
    tokens: CHALK_TOKENS,
    fonts: [FONT_LIBRE_BASK, FONT_INTER],
  },
  {
    id: 'dusk',
    name: 'Dusk Cinematic',
    description: 'Deep purple twilight with amber warmth',
    character: 'A24 meets Monocle',
    tokens: DUSK_TOKENS,
    fonts: [FONT_PLUS_JAKARTA, FONT_INTER],
  },
  {
    id: 'copper',
    name: 'Copper Artisan',
    description: 'Dark espresso with rich copper, handcrafted premium',
    character: 'Hermès meets Kinfolk',
    tokens: COPPER_TOKENS,
    fonts: [FONT_CORMORANT, FONT_INTER],
  },
  {
    id: 'arctic',
    name: 'Arctic Precision',
    description: 'Ice blue and white, ultra-clean technical authority',
    character: 'Linear meets Figma Docs',
    tokens: ARCTIC_TOKENS,
    fonts: [FONT_INTER],
  },
  {
    id: 'ember',
    name: 'Ember Intensity',
    description: 'Pure black with electric red-orange, high-stakes energy',
    character: 'YCombinator meets Red Bull',
    tokens: EMBER_TOKENS,
    fonts: [FONT_SYNE, FONT_DM_SANS],
  },
  {
    id: 'lavender',
    name: 'Lavender Fields',
    description: 'Soft lavender with deep violet, romantic editorial',
    character: 'Aesop meets Letterboxd',
    tokens: LAVENDER_TOKENS,
    fonts: [FONT_PLUS_JAKARTA, FONT_INTER],
  },
  {
    id: 'steel',
    name: 'Steel Authority',
    description: 'Dark steel blue with chrome highlights, industrial command',
    character: 'Boeing meets Palantir',
    tokens: STEEL_TOKENS,
    fonts: [FONT_SPACE_GROTESK, FONT_INTER],
  },
  {
    id: 'terra',
    name: 'Terra Warmth',
    description: 'Terracotta and warm sand, Mediterranean vitality',
    character: 'Olive meets Massimo Bottura',
    tokens: TERRA_TOKENS,
    fonts: [FONT_PLUS_JAKARTA, FONT_DM_SANS],
  },
  {
    id: 'void',
    name: 'Void Minimal',
    description: 'Pure black with electric violet, ultra-modern presence',
    character: 'Apple WWDC meets Nothing Phone',
    tokens: VOID_TOKENS,
    fonts: [FONT_SYNE, FONT_INTER],
  },
];

// ── Default theme IDs (shown in main grid without expanding) ──────────────────
export const DEFAULT_PLUGIN_IDS = ['obsidian', 'ivory', 'cobalt', 'sage'];

// ── Theme registry types ──────────────────────────────────────────────────────

export type ThemeCategory = 'dark' | 'light' | 'bold' | 'minimal' | 'nature' | 'premium';

export interface ThemeDefinition {
  id: string;
  label: string;
  description: string;
  category: ThemeCategory;
  previewColors: {
    background: string;
    surface: string;
    text: string;
    accent: string;
    accent2: string;
    border: string;
  };
  cssVariables: Record<string, string>;
  fontPairing: {
    heading: string;
    body: string;
  };
  character: string;
}

export const THEME_REGISTRY: ThemeDefinition[] = [
  {
    id: 'obsidian', label: 'Obsidian Luxury', description: 'Dark editorial with refined gold accents',
    category: 'dark',
    previewColors: { background: '#0c0c0c', surface: '#141414', text: '#e8e4dc', accent: '#c8a96e', accent2: '#967f50', border: '#242424' },
    cssVariables: { '--theme-bg': '#0c0c0c', '--theme-surface': '#141414', '--theme-text': '#e8e4dc', '--theme-accent': '#c8a96e', '--theme-border': '#242424' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'Inter' },
    character: 'WSJ meets Bottega Veneta — dark, luxurious, editorial. Prose is refined and sparse.',
  },
  {
    id: 'ivory', label: 'Ivory Editorial', description: 'Light magazine with confident ink black',
    category: 'light',
    previewColors: { background: '#fafaf8', surface: '#ffffff', text: '#111111', accent: '#111111', accent2: '#3a3530', border: '#e8e4dc' },
    cssVariables: { '--theme-bg': '#fafaf8', '--theme-surface': '#ffffff', '--theme-text': '#111111', '--theme-accent': '#111111', '--theme-border': '#e8e4dc' },
    fontPairing: { heading: 'Playfair Display', body: 'Inter' },
    character: 'The Economist meets Kinfolk — light, authoritative, precise. Confident ink-black clarity.',
  },
  {
    id: 'cobalt', label: 'Cobalt Executive', description: 'Deep navy with electric blue command',
    category: 'dark',
    previewColors: { background: '#09152a', surface: '#0e1e38', text: '#e4ecf7', accent: '#4fa3e8', accent2: '#2d6ca8', border: '#162e4a' },
    cssVariables: { '--theme-bg': '#09152a', '--theme-surface': '#0e1e38', '--theme-text': '#e4ecf7', '--theme-accent': '#4fa3e8', '--theme-border': '#162e4a' },
    fontPairing: { heading: 'Plus Jakarta Sans', body: 'Inter' },
    character: 'Bloomberg meets McKinsey — executive, data-driven, commanding. No softening language.',
  },
  {
    id: 'sage', label: 'Sage Organic', description: 'Warm earth tones with forest greens',
    category: 'nature',
    previewColors: { background: '#f4f6f0', surface: '#ffffff', text: '#1e2a1c', accent: '#3d6b38', accent2: '#2e5228', border: '#d4d8ce' },
    cssVariables: { '--theme-bg': '#f4f6f0', '--theme-surface': '#ffffff', '--theme-text': '#1e2a1c', '--theme-accent': '#3d6b38', '--theme-border': '#d4d8ce' },
    fontPairing: { heading: 'Plus Jakarta Sans', body: 'DM Sans' },
    character: 'Patagonia meets IDEO — warm, human, design-thinking. Mission-led and grounded.',
  },
  {
    id: 'midnight', label: 'Midnight Electric', description: 'Deep navy with neon cyan tech-forward energy',
    category: 'dark',
    previewColors: { background: '#080f1e', surface: '#0d1628', text: '#deeeff', accent: '#22d3ee', accent2: '#0e9fbf', border: '#122030' },
    cssVariables: { '--theme-bg': '#080f1e', '--theme-surface': '#0d1628', '--theme-text': '#deeeff', '--theme-accent': '#22d3ee', '--theme-border': '#122030' },
    fontPairing: { heading: 'Space Grotesk', body: 'Inter' },
    character: 'Wired meets Verge — electric, high-contrast, tech-forward. Copy is terse and punchy.',
  },
  {
    id: 'aurora', label: 'Aurora Editorial', description: 'Warm amber and forest green, cinematic editorial',
    category: 'light',
    previewColors: { background: '#fdf9f4', surface: '#ffffff', text: '#1a1208', accent: '#c8730a', accent2: '#9e5808', border: '#e8ddd0' },
    cssVariables: { '--theme-bg': '#fdf9f4', '--theme-surface': '#ffffff', '--theme-text': '#1a1208', '--theme-accent': '#c8730a', '--theme-border': '#e8ddd0' },
    fontPairing: { heading: 'Lora', body: 'Inter' },
    character: 'National Geographic meets Monocle — cinematic, warm, editorial. Prose is vivid and unhurried.',
  },
  {
    id: 'slate', label: 'Slate Minimal', description: 'Cool gray minimal, crisp corporate precision',
    category: 'minimal',
    previewColors: { background: '#f5f6f8', surface: '#ffffff', text: '#0f1117', accent: '#2563eb', accent2: '#1e40af', border: '#e0e4ec' },
    cssVariables: { '--theme-bg': '#f5f6f8', '--theme-surface': '#ffffff', '--theme-text': '#0f1117', '--theme-accent': '#2563eb', '--theme-border': '#e0e4ec' },
    fontPairing: { heading: 'Inter', body: 'Inter' },
    character: 'Harvard Business Review meets Stripe Docs — minimal, precise, corporate. Zero decoration.',
  },
  {
    id: 'crimson', label: 'Crimson Literary', description: 'Deep burgundy with gold, bold and authoritative',
    category: 'bold',
    previewColors: { background: '#0e0508', surface: '#180910', text: '#f5e6ea', accent: '#c41e3a', accent2: '#9b1530', border: '#2a0f18' },
    cssVariables: { '--theme-bg': '#0e0508', '--theme-surface': '#180910', '--theme-text': '#f5e6ea', '--theme-accent': '#c41e3a', '--theme-border': '#2a0f18' },
    fontPairing: { heading: 'Playfair Display', body: 'Inter' },
    character: 'The Atlantic meets LVMH — bold, literary, premium-red. Sentences are long and authoritative.',
  },
  {
    id: 'carbon', label: 'Carbon Industrial', description: 'Dark graphite with orange highlights, mechanical',
    category: 'dark',
    previewColors: { background: '#101214', surface: '#191c1f', text: '#e8e9ea', accent: '#f97316', accent2: '#c05408', border: '#272a2d' },
    cssVariables: { '--theme-bg': '#101214', '--theme-surface': '#191c1f', '--theme-text': '#e8e9ea', '--theme-accent': '#f97316', '--theme-border': '#272a2d' },
    fontPairing: { heading: 'Space Grotesk', body: 'DM Sans' },
    character: 'Wired Hardware meets Industrial Design — dark graphite, orange highlights. Copy is direct and technical.',
  },
  {
    id: 'pearl', label: 'Pearl Refined', description: 'Soft white with blush tones, generous whitespace',
    category: 'light',
    previewColors: { background: '#fdfcfb', surface: '#ffffff', text: '#1a1715', accent: '#c4956a', accent2: '#9a7048', border: '#ede8e3' },
    cssVariables: { '--theme-bg': '#fdfcfb', '--theme-surface': '#ffffff', '--theme-text': '#1a1715', '--theme-accent': '#c4956a', '--theme-border': '#ede8e3' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'Inter' },
    character: 'Apple meets Kinfolk — soft white, blush tones, breathing room. Prose is warm and refined.',
  },
  {
    id: 'neon', label: 'Neon Punk', description: 'Dark with vivid magenta and lime, high energy',
    category: 'bold',
    previewColors: { background: '#08081a', surface: '#0e0e20', text: '#f0f0ff', accent: '#e11d78', accent2: '#b31460', border: '#1c1c38' },
    cssVariables: { '--theme-bg': '#08081a', '--theme-surface': '#0e0e20', '--theme-text': '#f0f0ff', '--theme-accent': '#e11d78', '--theme-border': '#1c1c38' },
    fontPairing: { heading: 'Syne', body: 'Inter' },
    character: 'Cyberpunk meets Pitch deck — dark background, vivid magenta accents. High energy, startup-bold.',
  },
  {
    id: 'forest', label: 'Forest Mission', description: 'Deep greens, earthy tones, mission-driven',
    category: 'nature',
    previewColors: { background: '#07100a', surface: '#0d1a10', text: '#e4f0e6', accent: '#22c55e', accent2: '#15943f', border: '#16281a' },
    cssVariables: { '--theme-bg': '#07100a', '--theme-surface': '#0d1a10', '--theme-text': '#e4f0e6', '--theme-accent': '#22c55e', '--theme-border': '#16281a' },
    fontPairing: { heading: 'Plus Jakarta Sans', body: 'DM Sans' },
    character: 'Patagonia meets McKinsey Sustainability — deep greens, mission-driven. Prose grounds every claim in real impact.',
  },
  {
    id: 'gold', label: 'Gold Ultra-Premium', description: 'Champagne and deep black, ultra-premium luxury',
    category: 'premium',
    previewColors: { background: '#0a0900', surface: '#141200', text: '#f5eed6', accent: '#d4a017', accent2: '#a87d10', border: '#282200' },
    cssVariables: { '--theme-bg': '#0a0900', '--theme-surface': '#141200', '--theme-text': '#f5eed6', '--theme-accent': '#d4a017', '--theme-border': '#282200' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'Inter' },
    character: 'Sothebys meets Rolex — champagne and deep black, ultra-premium. Every word earns its place.',
  },
  {
    id: 'ocean', label: 'Ocean Data', description: 'Deep teal gradient, data-confident and forward-looking',
    category: 'dark',
    previewColors: { background: '#030c18', surface: '#071828', text: '#dff2ff', accent: '#0ea5c9', accent2: '#0878a0', border: '#092838' },
    cssVariables: { '--theme-bg': '#030c18', '--theme-surface': '#071828', '--theme-text': '#dff2ff', '--theme-accent': '#0ea5c9', '--theme-border': '#092838' },
    fontPairing: { heading: 'Plus Jakarta Sans', body: 'Inter' },
    character: 'MIT Technology Review meets Salesforce — deep teal, white type, data-confident.',
  },
  {
    id: 'rose', label: 'Rose Editorial', description: 'Deep rose with blush pink, bold feminine authority',
    category: 'bold',
    previewColors: { background: '#180810', surface: '#220f18', text: '#ffeef5', accent: '#e8457a', accent2: '#c02258', border: '#320f20' },
    cssVariables: { '--theme-bg': '#180810', '--theme-surface': '#220f18', '--theme-text': '#ffeef5', '--theme-accent': '#e8457a', '--theme-border': '#320f20' },
    fontPairing: { heading: 'Playfair Display', body: 'Inter' },
    character: 'Vogue meets Condé Nast — bold feminine authority, deep rose. Prose is decisive and glamorous.',
  },
  {
    id: 'chalk', label: 'Chalk Academic', description: 'Warm cream with graphite, clean and scholarly',
    category: 'minimal',
    previewColors: { background: '#fafaf8', surface: '#ffffff', text: '#1c1c1a', accent: '#374151', accent2: '#1f2937', border: '#e8e8e4' },
    cssVariables: { '--theme-bg': '#fafaf8', '--theme-surface': '#ffffff', '--theme-text': '#1c1c1a', '--theme-accent': '#374151', '--theme-border': '#e8e8e4' },
    fontPairing: { heading: 'Libre Baskerville', body: 'Inter' },
    character: 'Harvard meets The Atlantic — warm cream, graphite type, scholarly restraint. Zero decoration.',
  },
  {
    id: 'dusk', label: 'Dusk Cinematic', description: 'Deep purple twilight with amber warmth',
    category: 'dark',
    previewColors: { background: '#0c0820', surface: '#130c2e', text: '#ede8ff', accent: '#a855f7', accent2: '#7c3aed', border: '#1e1040' },
    cssVariables: { '--theme-bg': '#0c0820', '--theme-surface': '#130c2e', '--theme-text': '#ede8ff', '--theme-accent': '#a855f7', '--theme-border': '#1e1040' },
    fontPairing: { heading: 'Plus Jakarta Sans', body: 'Inter' },
    character: 'A24 meets Monocle — cinematic twilight purple. Atmospheric and intentional.',
  },
  {
    id: 'copper', label: 'Copper Artisan', description: 'Dark espresso with rich copper, handcrafted premium',
    category: 'premium',
    previewColors: { background: '#0d0805', surface: '#180f08', text: '#f5ede6', accent: '#b87333', accent2: '#8b5523', border: '#281810' },
    cssVariables: { '--theme-bg': '#0d0805', '--theme-surface': '#180f08', '--theme-text': '#f5ede6', '--theme-accent': '#b87333', '--theme-border': '#281810' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'Inter' },
    character: 'Hermès meets Kinfolk — dark espresso, burnished copper highlights. Artisanal and warm.',
  },
  {
    id: 'arctic', label: 'Arctic Precision', description: 'Ice blue and white, ultra-clean technical authority',
    category: 'minimal',
    previewColors: { background: '#f2f8ff', surface: '#ffffff', text: '#0d1b2e', accent: '#1e6ec8', accent2: '#1453a0', border: '#c8dff5' },
    cssVariables: { '--theme-bg': '#f2f8ff', '--theme-surface': '#ffffff', '--theme-text': '#0d1b2e', '--theme-accent': '#1e6ec8', '--theme-border': '#c8dff5' },
    fontPairing: { heading: 'Inter', body: 'Inter' },
    character: 'Linear meets Figma Docs — icy blue-white, crisp navy text. Technical authority without decoration.',
  },
  {
    id: 'ember', label: 'Ember Intensity', description: 'Pure black with electric red-orange, high-stakes energy',
    category: 'bold',
    previewColors: { background: '#0a0500', surface: '#160900', text: '#fff5ee', accent: '#ea580c', accent2: '#c2410c', border: '#2a0e00' },
    cssVariables: { '--theme-bg': '#0a0500', '--theme-surface': '#160900', '--theme-text': '#fff5ee', '--theme-accent': '#ea580c', '--theme-border': '#2a0e00' },
    fontPairing: { heading: 'Syne', body: 'DM Sans' },
    character: 'YCombinator meets Red Bull — near-black with electric orange. Urgency baked into every line.',
  },
  {
    id: 'lavender', label: 'Lavender Fields', description: 'Soft lavender with deep violet, romantic editorial',
    category: 'light',
    previewColors: { background: '#f8f5ff', surface: '#ffffff', text: '#1a1228', accent: '#7c3aed', accent2: '#6d28d9', border: '#e0d8f8' },
    cssVariables: { '--theme-bg': '#f8f5ff', '--theme-surface': '#ffffff', '--theme-text': '#1a1228', '--theme-accent': '#7c3aed', '--theme-border': '#e0d8f8' },
    fontPairing: { heading: 'Plus Jakarta Sans', body: 'Inter' },
    character: 'Aesop meets Letterboxd — soft lavender fields, deep violet accents. Thoughtful and literary.',
  },
  {
    id: 'steel', label: 'Steel Authority', description: 'Dark steel blue with chrome highlights, industrial command',
    category: 'dark',
    previewColors: { background: '#0c1420', surface: '#122030', text: '#c8d8e8', accent: '#60a8d8', accent2: '#4080b8', border: '#1e2e42' },
    cssVariables: { '--theme-bg': '#0c1420', '--theme-surface': '#122030', '--theme-text': '#c8d8e8', '--theme-accent': '#60a8d8', '--theme-border': '#1e2e42' },
    fontPairing: { heading: 'Space Grotesk', body: 'Inter' },
    character: 'Boeing meets Palantir — dark steel, chrome-blue highlights. Data talks louder than adjectives.',
  },
  {
    id: 'terra', label: 'Terra Warmth', description: 'Terracotta and warm sand, Mediterranean vitality',
    category: 'nature',
    previewColors: { background: '#f7f0e8', surface: '#ffffff', text: '#2a1a0a', accent: '#b45309', accent2: '#92400e', border: '#ddd0bc' },
    cssVariables: { '--theme-bg': '#f7f0e8', '--theme-surface': '#ffffff', '--theme-text': '#2a1a0a', '--theme-accent': '#b45309', '--theme-border': '#ddd0bc' },
    fontPairing: { heading: 'Plus Jakarta Sans', body: 'DM Sans' },
    character: 'Olive meets Massimo Bottura — warm terracotta, sandy surfaces. Grounded and full of life.',
  },
  {
    id: 'void', label: 'Void Minimal', description: 'Pure black with electric violet, ultra-modern presence',
    category: 'dark',
    previewColors: { background: '#000000', surface: '#0d0d0d', text: '#f8f8f8', accent: '#8b5cf6', accent2: '#7c3aed', border: '#1c1c1c' },
    cssVariables: { '--theme-bg': '#000000', '--theme-surface': '#0d0d0d', '--theme-text': '#f8f8f8', '--theme-accent': '#8b5cf6', '--theme-border': '#1c1c1c' },
    fontPairing: { heading: 'Syne', body: 'Inter' },
    character: 'Apple WWDC meets Nothing Phone — pure black canvas, electric violet pulse. Minimal is the message.',
  },
];

export function getPlugin(id: string): PluginMeta {
  return PLUGINS.find((p) => p.id === id) ?? PLUGINS[0];
}

/**
 * Fetch the live plugin list from the API.
 * Falls back to the static PLUGINS array on error.
 */
export async function fetchPluginsFromApi(apiKey: string): Promise<PluginMeta[]> {
  try {
    const res = await fetch('/api/plugins', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return PLUGINS;
    const data = (await res.json()) as { plugins?: unknown[] };
    if (!Array.isArray(data.plugins) || data.plugins.length === 0) return PLUGINS;

    return (data.plugins as Array<{
      id: string;
      manifest: { displayName: string; [k: string]: unknown };
      tokens: PluginTokens;
      fonts: { family: string; url: string }[];
    }>).map(p => ({
      id: p.id,
      name: p.manifest.displayName ?? p.id,
      description: String((p.manifest as Record<string, unknown>).description ?? ''),
      character: String((p.manifest as Record<string, unknown>).character ?? ''),
      tokens: p.tokens,
      fonts: p.fonts ?? [],
    }));
  } catch {
    return PLUGINS;
  }
}

/** Apply brand primaryColor as accent override */
export function applyBrandOverride(tokens: PluginTokens, brandPrimary: string): PluginTokens {
  if (!brandPrimary) return tokens;
  return { ...tokens, accent: brandPrimary };
}

// ── Color utilities (pure math, no deps) ─────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    if (isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } catch { return null; }
}

/** CSS named colors → hex. Allows LLM responses like "blue" to pass validation. */
const CSS_COLOR_NAMES: Record<string, string> = {
  red: '#ef4444', crimson: '#dc2626', rose: '#f43f5e', pink: '#ec4899',
  orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', gold: '#ca8a04',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', lime: '#84cc16',
  blue: '#3b82f6', indigo: '#6366f1', sky: '#0ea5e9', cyan: '#06b6d4',
  violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef', magenta: '#e879f9',
  white: '#ffffff', black: '#000000', dark: '#0f172a', light: '#f8fafc',
  grey: '#6b7280', gray: '#6b7280', silver: '#94a3b8', slate: '#475569',
  navy: '#1e3a5f', coral: '#f87171', turquoise: '#2dd4bf', lavender: '#c4b5fd',
  maroon: '#7f1d1d', olive: '#4d7c0f', brown: '#92400e',
};

/**
 * Resolve a color string to a valid hex value.
 * Accepts #hex strings and CSS named colors (returned by LLMs).
 * Returns null if the value can't be resolved.
 */
function resolveColor(value: string): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,6}$/.test(v) && hexToRgb(v)) return v;
  return CSS_COLOR_NAMES[v] ?? null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function shiftL(hex: string, delta: number, fallback: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  const [h, s, l] = rgbToHsl(...rgb);
  const [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, l + delta)));
  return rgbToHex(r, g, b);
}

function blendHex(hexA: string, hexB: string, t: number, fallback: string): string {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  if (!a || !b) return fallback;
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

/**
 * Derive a full PluginTokens set from LLM-synthesized tier-1 fields.
 *
 * Two-layer resolution:
 *   Layer 1 — Concrete hex/font/weight values from tier1 (bg, text, accent, etc.)
 *   Layer 2 — Semantic design system signals (visualStyle, typography.style,
 *             colorStrategy, componentStyle) actively shape computed tokens
 *             (gradients, shadows, glow, noise, mesh) to create VISUAL
 *             distinctiveness between editorial / bold / minimal personalities.
 *
 * Any parse failure falls back to the corresponding base token.
 */
export function deriveTokens(base: PluginTokens, tier1: Partial<PluginTokens>): PluginTokens {
  // ── Layer 1: concrete base values ─────────────────────────────────────────
  const bg     = (typeof tier1.bg     === 'string' && hexToRgb(tier1.bg))     ? tier1.bg     : base.bg;
  const text   = (typeof tier1.text   === 'string' && hexToRgb(tier1.text))   ? tier1.text   : base.text;
  const accent = (typeof tier1.accent === 'string' && hexToRgb(tier1.accent)) ? tier1.accent : base.accent;
  const dark   = typeof tier1.dark === 'boolean' ? tier1.dark : base.dark;

  // ── Layer 2: semantic design system signals ────────────────────────────────
  // tier1 is typed as Partial<PluginTokens> but at runtime contains the full
  // LLM rawTokens object which includes extra semantic fields.
  const ds             = tier1 as Record<string, unknown>;
  const dsTypography   = ds.typography   as Record<string, unknown> | undefined;
  const dsColor        = ds.colorStrategy as Record<string, unknown> | undefined;
  const dsComponent    = ds.componentStyle as Record<string, unknown> | undefined;

  const visualStyle     = typeof ds.visualStyle          === 'string' ? ds.visualStyle.toLowerCase()          : '';
  const typographyStyle = typeof dsTypography?.style     === 'string' ? dsTypography.style.toLowerCase()      : '';
  const contrastLevel   = typeof dsColor?.contrast       === 'string' ? dsColor.contrast.toLowerCase()        : 'moderate';
  const accentUsage     = typeof dsColor?.accentUsage    === 'string' ? dsColor.accentUsage.toLowerCase()     : 'moderate';
  const shadowStyle     = typeof dsComponent?.shadow     === 'string' ? dsComponent.shadow.toLowerCase()      : 'subtle';
  const dsDensity       = typeof tier1.density           === 'string' ? tier1.density                         : 'comfortable';

  // Intent flags — drive the computed-token switches below
  const isEditorial = typographyStyle.includes('editorial') || typographyStyle.includes('serif') || visualStyle.includes('editorial');
  const isBold      = visualStyle.includes('bold') || visualStyle.includes('monumental') || contrastLevel === 'extreme';
  const isMinimal   = (dsDensity === 'compact' && shadowStyle === 'none') || visualStyle.includes('minimal');

  // ── Surface colors ─────────────────────────────────────────────────────────
  const surface     = shiftL(bg, dark ? 0.04 : -0.03, base.surface);
  const surfaceAlt  = shiftL(bg, dark ? 0.08 : -0.06, base.surfaceAlt);
  const surfaceCard = blendHex(bg, surface, 0.5, base.surfaceCard);

  // ── Text colors — contrast-aware ──────────────────────────────────────────
  const textBlendMuted  = contrastLevel === 'extreme' ? 0.32 : contrastLevel === 'high' ? 0.40 : 0.45;
  const textBlendSubtle = contrastLevel === 'extreme' ? 0.56 : contrastLevel === 'high' ? 0.65 : 0.68;
  const textMuted  = blendHex(text, bg, textBlendMuted,  base.textMuted);
  const textSubtle = blendHex(text, bg, textBlendSubtle, base.textSubtle);

  // ── Accent — accentUsage boosts or subdues saturation ─────────────────────
  const accentBoost   = accentUsage === 'dominant' ? 0.08 : accentUsage === 'sparingly' ? -0.06 : 0;
  const accentFinal   = accentBoost !== 0 ? shiftL(accent, accentBoost, accent) : accent;
  const accentDim     = shiftL(accentFinal, -0.15, base.accentDim);
  const accentRgb     = (() => { const rgb = hexToRgb(accentFinal); return rgb ? `${rgb[0]},${rgb[1]},${rgb[2]}` : base.accentRgb; })();

  // ── Glow — always low opacity for clean design ─────────────────────────────
  const glowOpacity = isEditorial ? 0.07 : isBold ? 0.12 : isMinimal ? 0.05 : 0.08;
  const glowColor   = `rgba(${accentRgb},${glowOpacity})`;

  // ── Borders ─────────────────────────────────────────────────────────────────
  const border       = shiftL(surfaceAlt, dark ? 0.04 : -0.04, base.border);
  const borderSubtle = blendHex(surface, surfaceAlt, 0.4, base.borderSubtle);

  // ── Hero gradient — always a simple linear, no radial blobs ───────────────
  const gradientHero = `linear-gradient(180deg, ${surfaceAlt} 0%, ${bg} 100%)`;

  // ── Gradient text — simple 2-stop ─────────────────────────────────────────
  const accentLight  = shiftL(accentFinal, 0.10, accentFinal);
  const gradientText = `linear-gradient(135deg, ${accentLight} 0%, ${accentFinal} 100%)`;

  // ── Mesh gradient — always empty for clean design ─────────────────────────
  const meshGradient = '';

  // ── Shadows — clean, no colored glows ─────────────────────────────────────
  let cardShadow: string;
  let cardShadowHover: string;

  if (shadowStyle === 'none' || isMinimal) {
    cardShadow      = 'none';
    cardShadowHover = `0 0 0 1px ${border}`;
  } else if (isEditorial) {
    cardShadow      = dark
      ? '0 1px 4px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.04)'
      : '0 1px 3px rgba(0,0,0,0.06)';
    cardShadowHover = dark
      ? '0 4px 16px rgba(0,0,0,0.44)'
      : '0 4px 16px rgba(0,0,0,0.10)';
  } else {
    cardShadow      = dark
      ? '0 1px 4px rgba(0,0,0,0.34), 0 0 0 1px rgba(255,255,255,0.04)'
      : '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)';
    cardShadowHover = dark
      ? '0 4px 16px rgba(0,0,0,0.52)'
      : '0 4px 16px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)';
  }

  // ── Noise opacity — always 0 for clean design ──────────────────────────────
  const noiseOpacity = 0;

  return {
    bg, surface, surfaceAlt, surfaceCard,
    text, textMuted, textSubtle,
    accent: accentFinal, accentDim, accentRgb, glowColor,
    border, borderSubtle,
    heroFont:      typeof tier1.heroFont      === 'string' ? tier1.heroFont      : base.heroFont,
    bodyFont:      typeof tier1.bodyFont      === 'string' ? tier1.bodyFont      : base.bodyFont,
    heroWeight:    (typeof tier1.heroWeight === 'number' ? tier1.heroWeight : (typeof tier1.heroWeight === 'string' ? Number(tier1.heroWeight) || base.heroWeight : base.heroWeight)),
    heroStyle:     'normal',
    labelTracking: typeof tier1.labelTracking === 'string' ? tier1.labelTracking : base.labelTracking,
    dark,
    noiseOpacity,
    gradientHero, gradientText, meshGradient,
    cardShadow, cardShadowHover,
    ...(typeof tier1.borderRadius === 'string' ? { borderRadius: tier1.borderRadius } : {}),
    ...(typeof tier1.buttonStyle  === 'string' ? { buttonStyle:  tier1.buttonStyle  } : {}),
    ...(typeof tier1.density      === 'string' ? { density:      tier1.density      } : {}),
  };
}

/**
 * Single token resolution point for the renderer.
 * Applies brand override first, then LLM-generated tokens if present.
 *
 * Gate hardened: if customTokens is provided at all, deriveTokens() always runs.
 * Any missing/invalid hex colors are supplemented from the base theme so the
 * LLM's semantic fields (visualStyle, typography, componentStyle, etc.) still
 * drive the computed tokens even when color fields are absent or malformed.
 */
export function resolveTokens(
  pluginId: string,
  brandPrimaryColor: string,
  customTokens?: Partial<PluginTokens>,
): PluginTokens {
  const base = getPlugin(pluginId).tokens;
  const withBrand = applyBrandOverride(base, brandPrimaryColor);

  let resolved: PluginTokens;
  if (!customTokens) {
    resolved = withBrand;
  } else {
    // Validate hex colors, fall back to base theme values when invalid.
    const enriched: Partial<PluginTokens> = {
      ...customTokens,
      bg:    (typeof customTokens.bg     === 'string' ? resolveColor(customTokens.bg)     : null) ?? withBrand.bg,
      text:  (typeof customTokens.text   === 'string' ? resolveColor(customTokens.text)   : null) ?? withBrand.text,
      accent:(typeof customTokens.accent === 'string' ? resolveColor(customTokens.accent) : null) ?? withBrand.accent,
      dark:  typeof customTokens.dark === 'boolean' ? customTokens.dark : withBrand.dark,
    };
    resolved = deriveTokens(withBrand, enriched);
  }

  // ── WCAG 2.1 AA enforcement ──────────────────────────────────────────────
  return enforceWCAGTokens(resolved);
}

/** Get gradient for a section type (fallback imagery) */
export function getSectionGradient(type: string, tokens: PluginTokens): string {
  switch (type) {
    case 'hero':        return tokens.gradientHero;
    case 'challenge':   return `linear-gradient(180deg, ${tokens.surfaceCard} 0%, ${tokens.bg} 100%)`;
    case 'approach':    return `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surfaceAlt} 100%)`;
    case 'pricing':     return `linear-gradient(180deg, ${tokens.surfaceAlt} 0%, ${tokens.bg} 100%)`;
    case 'whyus':       return `linear-gradient(180deg, ${tokens.surfaceCard} 0%, ${tokens.surface} 100%)`;
    default:            return `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surfaceAlt} 50%, ${tokens.bg} 100%)`;
  }
}
