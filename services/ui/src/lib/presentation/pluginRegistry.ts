import type { PluginMeta, PluginTokens } from '../../types/presentation';
import { enforceWCAGTokens } from './wcag';

// ── Plugin definitions ───────────────────────────────────────────────────────

const OBSIDIAN_TOKENS: PluginTokens = {
  bg: '#080808',
  surface: '#111111',
  surfaceAlt: '#1A1A1A',
  surfaceCard: '#161616',
  text: '#E8E4DC',
  textMuted: '#9A9590',
  textSubtle: '#5A5550',
  accent: '#C8A96E',
  accentDim: '#8B7744',
  accentRgb: '200,169,110',
  glowColor: 'rgba(200,169,110,0.28)',
  border: '#2A2520',
  borderSubtle: '#1E1B18',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'DM Sans',
  heroWeight: 300,
  heroStyle: 'italic',
  labelTracking: '0.18em',
  dark: true,
  noiseOpacity: 0.03,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 40%, #1A1510 0%, #080808 100%)',
  gradientText: 'linear-gradient(135deg, #E8C87A 0%, #C8A96E 50%, #F0D898 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(200,169,110,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(200,169,110,0.08) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.5)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.7), 0 0 20px rgba(200,169,110,0.18)',
};

const IVORY_TOKENS: PluginTokens = {
  bg: '#F8F5EF',
  surface: '#FFFFFF',
  surfaceAlt: '#F0ECE4',
  surfaceCard: '#FAFAF7',
  text: '#1A1612',
  textMuted: '#6B6560',
  textSubtle: '#A09890',
  accent: '#1A1612',
  accentDim: '#3A3530',
  accentRgb: '26,22,18',
  glowColor: 'rgba(26,22,18,0.15)',
  border: '#DDD8D0',
  borderSubtle: '#E8E4DC',
  heroFont: 'Playfair Display',
  bodyFont: 'Libre Franklin',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.15em',
  dark: false,
  noiseOpacity: 0.025,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 35%, #FFFFFF 0%, #F8F5EF 100%)',
  gradientText: 'linear-gradient(135deg, #1A1612 0%, #4A3F38 50%, #1A1612 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(26,22,18,0.06) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(26,22,18,0.04) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(26,22,18,0.08)',
  cardShadowHover: '0 8px 32px rgba(26,22,18,0.14), 0 0 0 1px rgba(26,22,18,0.1)',
};

const COBALT_TOKENS: PluginTokens = {
  bg: '#01112A',
  surface: '#071D3F',
  surfaceAlt: '#0C2650',
  surfaceCard: '#091E42',
  text: '#E4ECF7',
  textMuted: '#8AA4C8',
  textSubtle: '#4A6A8F',
  accent: '#4FA3E8',
  accentDim: '#2D6CA8',
  accentRgb: '79,163,232',
  glowColor: 'rgba(79,163,232,0.3)',
  border: '#1A3558',
  borderSubtle: '#122A48',
  heroFont: 'Syne',
  bodyFont: 'DM Sans',
  heroWeight: 800,
  heroStyle: 'normal',
  labelTracking: '0.2em',
  dark: true,
  noiseOpacity: 0.035,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 30%, #0C2650 0%, #01112A 100%)',
  gradientText: 'linear-gradient(135deg, #7EC8F8 0%, #4FA3E8 50%, #A0D8FF 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 25%, rgba(79,163,232,0.15) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 75%, rgba(79,163,232,0.1) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.8), 0 0 24px rgba(79,163,232,0.22)',
};

const SAGE_TOKENS: PluginTokens = {
  bg: '#F2F0EB',
  surface: '#FAFAF7',
  surfaceAlt: '#E8E5DE',
  surfaceCard: '#F5F3EE',
  text: '#2A3228',
  textMuted: '#5A6858',
  textSubtle: '#8A9888',
  accent: '#4A6741',
  accentDim: '#3A5230',
  accentRgb: '74,103,65',
  glowColor: 'rgba(74,103,65,0.25)',
  border: '#D0CEC5',
  borderSubtle: '#E0DDD5',
  heroFont: 'Fraunces',
  bodyFont: 'Nunito Sans',
  heroWeight: 300,
  heroStyle: 'italic',
  labelTracking: '0.16em',
  dark: false,
  noiseOpacity: 0.02,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 40%, #FAFAF7 0%, #F2F0EB 100%)',
  gradientText: 'linear-gradient(135deg, #5A8050 0%, #4A6741 50%, #6A9060 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(74,103,65,0.1) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(74,103,65,0.07) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(42,50,40,0.1)',
  cardShadowHover: '0 8px 32px rgba(42,50,40,0.18), 0 0 16px rgba(74,103,65,0.15)',
};

const MIDNIGHT_TOKENS: PluginTokens = {
  bg: '#030d1e',
  surface: '#0a1628',
  surfaceAlt: '#0d1f35',
  surfaceCard: '#071321',
  text: '#e2f0ff',
  textMuted: '#7aa8d4',
  textSubtle: '#3a6488',
  accent: '#00d4ff',
  accentDim: '#0090cc',
  accentRgb: '0,212,255',
  glowColor: 'rgba(0,212,255,0.35)',
  border: '#0d2340',
  borderSubtle: '#0a1c30',
  heroFont: 'Space Grotesk',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.15em',
  dark: true,
  noiseOpacity: 0.04,
  gradientHero: 'radial-gradient(ellipse 90% 70% at 50% 20%, #0d1f35 0%, #030d1e 100%)',
  gradientText: 'linear-gradient(135deg, #80e8ff 0%, #00d4ff 50%, #60efff 100%)',
  meshGradient: 'radial-gradient(ellipse 90% 70% at 10% 20%, rgba(0,212,255,0.18) 0%, transparent 55%), radial-gradient(ellipse 70% 55% at 85% 80%, rgba(0,212,255,0.12) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.8), 0 0 24px rgba(0,212,255,0.28)',
};

const AURORA_TOKENS: PluginTokens = {
  bg: '#faf6f0',
  surface: '#ffffff',
  surfaceAlt: '#f0ead9',
  surfaceCard: '#faf8f4',
  text: '#1a1208',
  textMuted: '#6b5a44',
  textSubtle: '#a09070',
  accent: '#d4860a',
  accentDim: '#a85f05',
  accentRgb: '212,134,10',
  glowColor: 'rgba(212,134,10,0.2)',
  border: '#e8ddd0',
  borderSubtle: '#f0e8dc',
  heroFont: 'Lora',
  bodyFont: 'Source Serif 4',
  heroWeight: 600,
  heroStyle: 'normal',
  labelTracking: '0.14em',
  dark: false,
  noiseOpacity: 0.025,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 30%, #ffffff 0%, #faf6f0 100%)',
  gradientText: 'linear-gradient(135deg, #e8a020 0%, #d4860a 50%, #f0b040 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 25% 30%, rgba(212,134,10,0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 75% 70%, rgba(45,107,47,0.08) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(26,18,8,0.08)',
  cardShadowHover: '0 8px 32px rgba(26,18,8,0.14), 0 0 0 1px rgba(212,134,10,0.12)',
};

const SLATE_TOKENS: PluginTokens = {
  bg: '#f4f5f6',
  surface: '#ffffff',
  surfaceAlt: '#eaecee',
  surfaceCard: '#f9fafb',
  text: '#111318',
  textMuted: '#5a6070',
  textSubtle: '#9098a8',
  accent: '#2563eb',
  accentDim: '#1e40af',
  accentRgb: '37,99,235',
  glowColor: 'rgba(37,99,235,0.12)',
  border: '#dde1e7',
  borderSubtle: '#e8eaed',
  heroFont: 'Inter',
  bodyFont: 'Inter',
  heroWeight: 600,
  heroStyle: 'normal',
  labelTracking: '0.08em',
  dark: false,
  noiseOpacity: 0.01,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #f4f5f6 100%)',
  gradientText: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 50%, #1d4ed8 100%)',
  meshGradient: '',
  cardShadow: '0 1px 8px rgba(17,19,24,0.06)',
  cardShadowHover: '0 4px 20px rgba(17,19,24,0.10), 0 0 0 1px rgba(37,99,235,0.10)',
};

const CRIMSON_TOKENS: PluginTokens = {
  bg: '#0f0508',
  surface: '#1a0810',
  surfaceAlt: '#25101a',
  surfaceCard: '#180912',
  text: '#f5e6ea',
  textMuted: '#b87888',
  textSubtle: '#7a4855',
  accent: '#c41e3a',
  accentDim: '#9b1530',
  accentRgb: '196,30,58',
  glowColor: 'rgba(196,30,58,0.30)',
  border: '#2d0f18',
  borderSubtle: '#240c15',
  heroFont: 'Libre Baskerville',
  bodyFont: 'Source Serif 4',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.16em',
  dark: true,
  noiseOpacity: 0.035,
  gradientHero: 'radial-gradient(ellipse 85% 65% at 50% 35%, #25101a 0%, #0f0508 100%)',
  gradientText: 'linear-gradient(135deg, #e83a58 0%, #c41e3a 50%, #d42848 100%)',
  meshGradient: 'radial-gradient(ellipse 85% 65% at 15% 20%, rgba(196,30,58,0.18) 0%, transparent 55%), radial-gradient(ellipse 65% 50% at 85% 75%, rgba(196,30,58,0.12) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.8), 0 0 24px rgba(196,30,58,0.25)',
};

const CARBON_TOKENS: PluginTokens = {
  bg: '#111214',
  surface: '#1c1e21',
  surfaceAlt: '#252830',
  surfaceCard: '#181a1d',
  text: '#e8e9ea',
  textMuted: '#8c9098',
  textSubtle: '#52565e',
  accent: '#ff6b2b',
  accentDim: '#cc4a15',
  accentRgb: '255,107,43',
  glowColor: 'rgba(255,107,43,0.28)',
  border: '#2a2d31',
  borderSubtle: '#222428',
  heroFont: 'Space Grotesk',
  bodyFont: 'DM Mono',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.12em',
  dark: true,
  noiseOpacity: 0.04,
  gradientHero: 'linear-gradient(180deg, #252830 0%, #111214 100%)',
  gradientText: 'linear-gradient(135deg, #ff9060 0%, #ff6b2b 50%, #ff8040 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(255,107,43,0.14) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(255,107,43,0.08) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.55)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.75), 0 0 20px rgba(255,107,43,0.22)',
};

const PEARL_TOKENS: PluginTokens = {
  bg: '#fdfcfb',
  surface: '#ffffff',
  surfaceAlt: '#f7f2ee',
  surfaceCard: '#fefdfb',
  text: '#1a1715',
  textMuted: '#7a6d67',
  textSubtle: '#b0a49e',
  accent: '#c4956a',
  accentDim: '#8b6249',
  accentRgb: '196,149,106',
  glowColor: 'rgba(196,149,106,0.18)',
  border: '#ede8e3',
  borderSubtle: '#f2eeea',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'Jost',
  heroWeight: 300,
  heroStyle: 'italic',
  labelTracking: '0.18em',
  dark: false,
  noiseOpacity: 0.02,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 30%, #ffffff 0%, #fdfcfb 100%)',
  gradientText: 'linear-gradient(135deg, #d8a880 0%, #c4956a 50%, #e0b888 100%)',
  meshGradient: '',
  cardShadow: '0 2px 12px rgba(26,23,21,0.06)',
  cardShadowHover: '0 6px 28px rgba(26,23,21,0.10), 0 0 0 1px rgba(196,149,106,0.12)',
};

const NEON_TOKENS: PluginTokens = {
  bg: '#080810',
  surface: '#0e0e20',
  surfaceAlt: '#141428',
  surfaceCard: '#0c0c1c',
  text: '#f0f0ff',
  textMuted: '#8888cc',
  textSubtle: '#444488',
  accent: '#ff2d78',
  accentDim: '#cc1558',
  accentRgb: '255,45,120',
  glowColor: 'rgba(255,45,120,0.40)',
  border: '#1a1a35',
  borderSubtle: '#14142a',
  heroFont: 'Syne',
  bodyFont: 'Space Grotesk',
  heroWeight: 800,
  heroStyle: 'normal',
  labelTracking: '0.2em',
  dark: true,
  noiseOpacity: 0.045,
  gradientHero: 'radial-gradient(ellipse 100% 80% at 50% 20%, #141428 0%, #080810 100%)',
  gradientText: 'linear-gradient(135deg, #ff80b0 0%, #ff2d78 40%, #39ff14 100%)',
  meshGradient: 'radial-gradient(ellipse 100% 80% at 10% 15%, rgba(255,45,120,0.22) 0%, transparent 50%), radial-gradient(ellipse 70% 60% at 85% 80%, rgba(57,255,20,0.18) 0%, transparent 48%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.65)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.85), 0 0 28px rgba(255,45,120,0.32)',
};

const FOREST_TOKENS: PluginTokens = {
  bg: '#080f0a',
  surface: '#101a12',
  surfaceAlt: '#182414',
  surfaceCard: '#0e1610',
  text: '#e8f0e9',
  textMuted: '#7a9c7e',
  textSubtle: '#456048',
  accent: '#2d7a3a',
  accentDim: '#1a5c25',
  accentRgb: '45,122,58',
  glowColor: 'rgba(45,122,58,0.28)',
  border: '#1a2e1c',
  borderSubtle: '#142618',
  heroFont: 'Fraunces',
  bodyFont: 'Nunito Sans',
  heroWeight: 400,
  heroStyle: 'normal',
  labelTracking: '0.16em',
  dark: true,
  noiseOpacity: 0.03,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 35%, #182414 0%, #080f0a 100%)',
  gradientText: 'linear-gradient(135deg, #50b060 0%, #2d7a3a 50%, #3a9048 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 15% 25%, rgba(45,122,58,0.14) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(45,122,58,0.10) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.55)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.70), 0 0 20px rgba(45,122,58,0.20)',
};

const GOLD_TOKENS: PluginTokens = {
  bg: '#0a0800',
  surface: '#140f00',
  surfaceAlt: '#1e1600',
  surfaceCard: '#110d00',
  text: '#f5eed6',
  textMuted: '#b8a878',
  textSubtle: '#786840',
  accent: '#c9a84c',
  accentDim: '#a67c2a',
  accentRgb: '201,168,76',
  glowColor: 'rgba(201,168,76,0.28)',
  border: '#2a2010',
  borderSubtle: '#221a08',
  heroFont: 'Cormorant Garamond',
  bodyFont: 'Jost',
  heroWeight: 300,
  heroStyle: 'normal',
  labelTracking: '0.22em',
  dark: true,
  noiseOpacity: 0.025,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 40%, #1e1600 0%, #0a0800 100%)',
  gradientText: 'linear-gradient(135deg, #e8c870 0%, #c9a84c 50%, #f0d888 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(201,168,76,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(201,168,76,0.08) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.75), 0 0 20px rgba(201,168,76,0.22)',
};

const OCEAN_TOKENS: PluginTokens = {
  bg: '#020d18',
  surface: '#061828',
  surfaceAlt: '#0c2438',
  surfaceCard: '#041220',
  text: '#dff2ff',
  textMuted: '#6aaac8',
  textSubtle: '#356880',
  accent: '#0ea5c9',
  accentDim: '#0077a8',
  accentRgb: '14,165,201',
  glowColor: 'rgba(14,165,201,0.32)',
  border: '#0a2a3d',
  borderSubtle: '#082235',
  heroFont: 'Syne',
  bodyFont: 'Inter',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0.14em',
  dark: true,
  noiseOpacity: 0.035,
  gradientHero: 'radial-gradient(ellipse 85% 65% at 50% 25%, #0c2438 0%, #020d18 100%)',
  gradientText: 'linear-gradient(135deg, #40c8e8 0%, #0ea5c9 50%, #38d4f8 100%)',
  meshGradient: 'radial-gradient(ellipse 85% 65% at 15% 20%, rgba(14,165,201,0.18) 0%, transparent 55%), radial-gradient(ellipse 65% 50% at 85% 75%, rgba(14,165,201,0.12) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.80), 0 0 24px rgba(14,165,201,0.25)',
};

const ROSE_TOKENS: PluginTokens = {
  bg: '#1a0810', surface: '#240f18', surfaceAlt: '#2e1420', surfaceCard: '#200d15',
  text: '#ffeef5', textMuted: '#c888a0', textSubtle: '#884460',
  accent: '#e8457a', accentDim: '#c02258', accentRgb: '232,69,122',
  glowColor: 'rgba(232,69,122,0.38)', border: '#350f20', borderSubtle: '#2809018',
  heroFont: 'Playfair Display', bodyFont: 'Jost',
  heroWeight: 700, heroStyle: 'normal', labelTracking: '0.16em',
  dark: true, noiseOpacity: 0.035,
  gradientHero: 'radial-gradient(ellipse 85% 65% at 50% 35%, #2e1420 0%, #1a0810 100%)',
  gradientText: 'linear-gradient(135deg, #ff80a8 0%, #e8457a 50%, #ff6090 100%)',
  meshGradient: 'radial-gradient(ellipse 85% 65% at 15% 20%, rgba(232,69,122,0.20) 0%, transparent 55%), radial-gradient(ellipse 65% 50% at 85% 75%, rgba(232,69,122,0.14) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)', cardShadowHover: '0 8px 40px rgba(0,0,0,0.8), 0 0 24px rgba(232,69,122,0.28)',
};

const CHALK_TOKENS: PluginTokens = {
  bg: '#fafaf8', surface: '#ffffff', surfaceAlt: '#f2f2f0', surfaceCard: '#fdfdfb',
  text: '#1c1c1a', textMuted: '#6b6b68', textSubtle: '#a0a09e',
  accent: '#4b5563', accentDim: '#374151', accentRgb: '75,85,99',
  glowColor: 'rgba(75,85,99,0.12)', border: '#e5e5e2', borderSubtle: '#ececea',
  heroFont: 'Libre Baskerville', bodyFont: 'Nunito Sans',
  heroWeight: 700, heroStyle: 'normal', labelTracking: '0.14em',
  dark: false, noiseOpacity: 0.015,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #fafaf8 100%)',
  gradientText: 'linear-gradient(135deg, #374151 0%, #4b5563 50%, #1c1c1a 100%)',
  meshGradient: '',
  cardShadow: '0 2px 12px rgba(28,28,26,0.07)', cardShadowHover: '0 6px 24px rgba(28,28,26,0.12), 0 0 0 1px rgba(75,85,99,0.10)',
};

const DUSK_TOKENS: PluginTokens = {
  bg: '#0d0820', surface: '#140d2e', surfaceAlt: '#1c1240', surfaceCard: '#100a28',
  text: '#ede8ff', textMuted: '#9888cc', textSubtle: '#584880',
  accent: '#a855f7', accentDim: '#7c3aed', accentRgb: '168,85,247',
  glowColor: 'rgba(168,85,247,0.38)', border: '#1f1445', borderSubtle: '#180f38',
  heroFont: 'Cormorant Garamond', bodyFont: 'DM Sans',
  heroWeight: 300, heroStyle: 'italic', labelTracking: '0.18em',
  dark: true, noiseOpacity: 0.03,
  gradientHero: 'radial-gradient(ellipse 90% 70% at 50% 30%, #1c1240 0%, #0d0820 100%)',
  gradientText: 'linear-gradient(135deg, #c880ff 0%, #a855f7 50%, #d0a0ff 100%)',
  meshGradient: 'radial-gradient(ellipse 90% 70% at 10% 20%, rgba(168,85,247,0.20) 0%, transparent 55%), radial-gradient(ellipse 70% 55% at 85% 78%, rgba(168,85,247,0.14) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.65)', cardShadowHover: '0 8px 40px rgba(0,0,0,0.85), 0 0 28px rgba(168,85,247,0.30)',
};

const COPPER_TOKENS: PluginTokens = {
  bg: '#0d0805', surface: '#180f08', surfaceAlt: '#221508', surfaceCard: '#150d06',
  text: '#f5ede6', textMuted: '#c8a090', textSubtle: '#886050',
  accent: '#b87333', accentDim: '#8b5523', accentRgb: '184,115,51',
  glowColor: 'rgba(184,115,51,0.28)', border: '#2a1a10', borderSubtle: '#201408',
  heroFont: 'Fraunces', bodyFont: 'Source Serif 4',
  heroWeight: 300, heroStyle: 'italic', labelTracking: '0.18em',
  dark: true, noiseOpacity: 0.03,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 40%, #221508 0%, #0d0805 100%)',
  gradientText: 'linear-gradient(135deg, #d49050 0%, #b87333 50%, #e0a860 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(184,115,51,0.14) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(184,115,51,0.10) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)', cardShadowHover: '0 8px 40px rgba(0,0,0,0.78), 0 0 20px rgba(184,115,51,0.22)',
};

const ARCTIC_TOKENS: PluginTokens = {
  bg: '#f0f7ff', surface: '#ffffff', surfaceAlt: '#e4f0ff', surfaceCard: '#f8fbff',
  text: '#0d1b2e', textMuted: '#3a5a80', textSubtle: '#7090b0',
  accent: '#1e6ec8', accentDim: '#1453a0', accentRgb: '30,110,200',
  glowColor: 'rgba(30,110,200,0.14)', border: '#c8dff5', borderSubtle: '#d8eaff',
  heroFont: 'Inter', bodyFont: 'Inter',
  heroWeight: 600, heroStyle: 'normal', labelTracking: '0.08em',
  dark: false, noiseOpacity: 0.01,
  gradientHero: 'linear-gradient(180deg, #ffffff 0%, #f0f7ff 100%)',
  gradientText: 'linear-gradient(135deg, #3a90e8 0%, #1e6ec8 50%, #1453a0 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(30,110,200,0.08) 0%, transparent 60%)',
  cardShadow: '0 1px 8px rgba(13,27,46,0.08)', cardShadowHover: '0 4px 20px rgba(13,27,46,0.14), 0 0 0 1px rgba(30,110,200,0.14)',
};

const EMBER_TOKENS: PluginTokens = {
  bg: '#0a0300', surface: '#160700', surfaceAlt: '#200a00', surfaceCard: '#120500',
  text: '#fff5ee', textMuted: '#cc8870', textSubtle: '#884430',
  accent: '#ff4500', accentDim: '#cc2200', accentRgb: '255,69,0',
  glowColor: 'rgba(255,69,0,0.40)', border: '#2a0a00', borderSubtle: '#200800',
  heroFont: 'Syne', bodyFont: 'DM Sans',
  heroWeight: 800, heroStyle: 'normal', labelTracking: '0.2em',
  dark: true, noiseOpacity: 0.045,
  gradientHero: 'radial-gradient(ellipse 90% 70% at 50% 25%, #200a00 0%, #0a0300 100%)',
  gradientText: 'linear-gradient(135deg, #ff8040 0%, #ff4500 50%, #ff6020 100%)',
  meshGradient: 'radial-gradient(ellipse 90% 70% at 10% 15%, rgba(255,69,0,0.24) 0%, transparent 50%), radial-gradient(ellipse 70% 55% at 85% 80%, rgba(255,69,0,0.16) 0%, transparent 48%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.65)', cardShadowHover: '0 8px 40px rgba(0,0,0,0.85), 0 0 28px rgba(255,69,0,0.32)',
};

const LAVENDER_TOKENS: PluginTokens = {
  bg: '#f8f5ff', surface: '#ffffff', surfaceAlt: '#eee8ff', surfaceCard: '#fbf9ff',
  text: '#1a1228', textMuted: '#6048a0', textSubtle: '#9878c8',
  accent: '#7c3aed', accentDim: '#6d28d9', accentRgb: '124,58,237',
  glowColor: 'rgba(124,58,237,0.14)', border: '#e0d8f8', borderSubtle: '#ece8fc',
  heroFont: 'Lora', bodyFont: 'Libre Franklin',
  heroWeight: 600, heroStyle: 'italic', labelTracking: '0.14em',
  dark: false, noiseOpacity: 0.02,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 30%, #ffffff 0%, #f8f5ff 100%)',
  gradientText: 'linear-gradient(135deg, #9060ff 0%, #7c3aed 50%, #a060ff 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 25% 30%, rgba(124,58,237,0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 75% 70%, rgba(124,58,237,0.07) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(26,18,40,0.08)', cardShadowHover: '0 8px 32px rgba(26,18,40,0.14), 0 0 0 1px rgba(124,58,237,0.14)',
};

const STEEL_TOKENS: PluginTokens = {
  bg: '#0c1420', surface: '#132030', surfaceAlt: '#1a2c40', surfaceCard: '#102038',
  text: '#ccd8e8', textMuted: '#7898b8', textSubtle: '#405870',
  accent: '#7ba7d4', accentDim: '#5a88b5', accentRgb: '123,167,212',
  glowColor: 'rgba(123,167,212,0.24)', border: '#1e2e42', borderSubtle: '#182538',
  heroFont: 'Space Grotesk', bodyFont: 'Inter',
  heroWeight: 700, heroStyle: 'normal', labelTracking: '0.15em',
  dark: true, noiseOpacity: 0.035,
  gradientHero: 'linear-gradient(180deg, #1a2c40 0%, #0c1420 100%)',
  gradientText: 'linear-gradient(135deg, #a0c8e8 0%, #7ba7d4 50%, #90b8e0 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 25%, rgba(123,167,212,0.14) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 80% 75%, rgba(123,167,212,0.10) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.55)', cardShadowHover: '0 8px 40px rgba(0,0,0,0.70), 0 0 20px rgba(123,167,212,0.20)',
};

const TERRA_TOKENS: PluginTokens = {
  bg: '#f7f0e8', surface: '#ffffff', surfaceAlt: '#ede4d8', surfaceCard: '#faf6f0',
  text: '#2a1a0a', textMuted: '#7a5038', textSubtle: '#b08060',
  accent: '#c4621a', accentDim: '#a0481a', accentRgb: '196,98,26',
  glowColor: 'rgba(196,98,26,0.18)', border: '#ddd0c0', borderSubtle: '#e8ddd0',
  heroFont: 'Fraunces', bodyFont: 'Nunito Sans',
  heroWeight: 400, heroStyle: 'italic', labelTracking: '0.14em',
  dark: false, noiseOpacity: 0.025,
  gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 35%, #ffffff 0%, #f7f0e8 100%)',
  gradientText: 'linear-gradient(135deg, #e07830 0%, #c4621a 50%, #d87030 100%)',
  meshGradient: 'radial-gradient(ellipse 70% 50% at 25% 30%, rgba(196,98,26,0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 75% 70%, rgba(196,98,26,0.07) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(42,26,10,0.10)', cardShadowHover: '0 8px 32px rgba(42,26,10,0.16), 0 0 0 1px rgba(196,98,26,0.14)',
};

const VOID_TOKENS: PluginTokens = {
  bg: '#000000', surface: '#0a0a0a', surfaceAlt: '#111111', surfaceCard: '#080808',
  text: '#ffffff', textMuted: '#888888', textSubtle: '#444444',
  accent: '#8b5cf6', accentDim: '#7c3aed', accentRgb: '139,92,246',
  glowColor: 'rgba(139,92,246,0.35)', border: '#1a1a1a', borderSubtle: '#141414',
  heroFont: 'Syne', bodyFont: 'DM Mono',
  heroWeight: 800, heroStyle: 'normal', labelTracking: '0.2em',
  dark: true, noiseOpacity: 0.04,
  gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 30%, #111111 0%, #000000 100%)',
  gradientText: 'linear-gradient(135deg, #b080ff 0%, #8b5cf6 50%, #c0a0ff 100%)',
  meshGradient: 'radial-gradient(ellipse 80% 60% at 15% 20%, rgba(139,92,246,0.18) 0%, transparent 55%), radial-gradient(ellipse 60% 50% at 85% 75%, rgba(139,92,246,0.12) 0%, transparent 50%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.70)', cardShadowHover: '0 8px 40px rgba(0,0,0,0.90), 0 0 28px rgba(139,92,246,0.30)',
};

// ── Plugin registry ──────────────────────────────────────────────────────────

export const PLUGINS: PluginMeta[] = [
  {
    id: 'obsidian',
    name: 'Obsidian Luxury',
    description: 'Dark editorial with refined gold accents',
    character: 'WSJ meets Bottega Veneta',
    tokens: OBSIDIAN_TOKENS,
    fonts: [
      { family: 'Cormorant Garamond', url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'DM Sans', url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'ivory',
    name: 'Ivory Editorial',
    description: 'Light magazine with confident ink black',
    character: 'The Economist meets Kinfolk',
    tokens: IVORY_TOKENS,
    fonts: [
      { family: 'Playfair Display', url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap' },
      { family: 'Libre Franklin', url: 'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'cobalt',
    name: 'Cobalt Executive',
    description: 'Deep navy with electric blue command',
    character: 'Bloomberg meets McKinsey',
    tokens: COBALT_TOKENS,
    fonts: [
      { family: 'Syne', url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap' },
      { family: 'DM Sans', url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'sage',
    name: 'Sage Organic',
    description: 'Warm earth tones with forest greens',
    character: 'Patagonia meets IDEO',
    tokens: SAGE_TOKENS,
    fonts: [
      { family: 'Fraunces', url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'Nunito Sans', url: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'midnight',
    name: 'Midnight Electric',
    description: 'Deep navy with neon cyan tech-forward energy',
    character: 'Wired meets Verge',
    tokens: MIDNIGHT_TOKENS,
    fonts: [
      { family: 'Space Grotesk', url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap' },
      { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'aurora',
    name: 'Aurora Editorial',
    description: 'Warm amber and forest green, cinematic editorial',
    character: 'National Geographic meets Monocle',
    tokens: AURORA_TOKENS,
    fonts: [
      { family: 'Lora', url: 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400;1,600&display=swap' },
      { family: 'Source Serif 4', url: 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300;400;600&display=swap' },
    ],
  },
  {
    id: 'slate',
    name: 'Slate Minimal',
    description: 'Cool gray minimal, crisp corporate precision',
    character: 'Harvard Business Review meets Stripe',
    tokens: SLATE_TOKENS,
    fonts: [
      { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap' },
    ],
  },
  {
    id: 'crimson',
    name: 'Crimson Literary',
    description: 'Deep burgundy with gold, bold and authoritative',
    character: 'The Atlantic meets LVMH',
    tokens: CRIMSON_TOKENS,
    fonts: [
      { family: 'Libre Baskerville', url: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap' },
      { family: 'Source Serif 4', url: 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300;400;600&display=swap' },
    ],
  },
  {
    id: 'carbon',
    name: 'Carbon Industrial',
    description: 'Dark graphite with orange highlights, mechanical',
    character: 'Wired Hardware meets Industrial Design',
    tokens: CARBON_TOKENS,
    fonts: [
      { family: 'Space Grotesk', url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap' },
      { family: 'DM Mono', url: 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap' },
    ],
  },
  {
    id: 'pearl',
    name: 'Pearl Refined',
    description: 'Soft white with blush tones, generous whitespace',
    character: 'Apple meets Kinfolk',
    tokens: PEARL_TOKENS,
    fonts: [
      { family: 'Cormorant Garamond', url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'Jost', url: 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'neon',
    name: 'Neon Punk',
    description: 'Dark with vivid magenta and lime, high energy',
    character: 'Cyberpunk meets Pitch deck',
    tokens: NEON_TOKENS,
    fonts: [
      { family: 'Syne', url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap' },
      { family: 'Space Grotesk', url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap' },
    ],
  },
  {
    id: 'forest',
    name: 'Forest Mission',
    description: 'Deep greens, earthy tones, mission-driven',
    character: 'Patagonia meets McKinsey Sustainability',
    tokens: FOREST_TOKENS,
    fonts: [
      { family: 'Fraunces', url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'Nunito Sans', url: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'gold',
    name: 'Gold Ultra-Premium',
    description: 'Champagne and deep black, ultra-premium luxury',
    character: 'Sothebys meets Rolex',
    tokens: GOLD_TOKENS,
    fonts: [
      { family: 'Cormorant Garamond', url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'Jost', url: 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'ocean',
    name: 'Ocean Data',
    description: 'Deep teal gradient, data-confident and forward-looking',
    character: 'MIT Technology Review meets Salesforce',
    tokens: OCEAN_TOKENS,
    fonts: [
      { family: 'Syne', url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap' },
      { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'rose',
    name: 'Rose Editorial',
    description: 'Deep rose with blush pink, bold feminine authority',
    character: 'Vogue meets Condé Nast',
    tokens: ROSE_TOKENS,
    fonts: [
      { family: 'Playfair Display', url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap' },
      { family: 'Jost', url: 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'chalk',
    name: 'Chalk Academic',
    description: 'Warm cream with graphite, clean and scholarly',
    character: 'Harvard meets The Atlantic',
    tokens: CHALK_TOKENS,
    fonts: [
      { family: 'Libre Baskerville', url: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap' },
      { family: 'Nunito Sans', url: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'dusk',
    name: 'Dusk Cinematic',
    description: 'Deep purple twilight with amber warmth',
    character: 'A24 meets Monocle',
    tokens: DUSK_TOKENS,
    fonts: [
      { family: 'Cormorant Garamond', url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'DM Sans', url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'copper',
    name: 'Copper Artisan',
    description: 'Dark espresso with rich copper, handcrafted premium',
    character: 'Hermès meets Kinfolk',
    tokens: COPPER_TOKENS,
    fonts: [
      { family: 'Fraunces', url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'Source Serif 4', url: 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300;400;600&display=swap' },
    ],
  },
  {
    id: 'arctic',
    name: 'Arctic Precision',
    description: 'Ice blue and white, ultra-clean technical authority',
    character: 'Linear meets Figma Docs',
    tokens: ARCTIC_TOKENS,
    fonts: [
      { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap' },
    ],
  },
  {
    id: 'ember',
    name: 'Ember Intensity',
    description: 'Pure black with electric red-orange, high-stakes energy',
    character: 'YCombinator meets Red Bull',
    tokens: EMBER_TOKENS,
    fonts: [
      { family: 'Syne', url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap' },
      { family: 'DM Sans', url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'lavender',
    name: 'Lavender Fields',
    description: 'Soft lavender with deep violet, romantic editorial',
    character: 'Aesop meets Letterboxd',
    tokens: LAVENDER_TOKENS,
    fonts: [
      { family: 'Lora', url: 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400;1,600&display=swap' },
      { family: 'Libre Franklin', url: 'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'steel',
    name: 'Steel Authority',
    description: 'Dark steel blue with chrome highlights, industrial command',
    character: 'Boeing meets Palantir',
    tokens: STEEL_TOKENS,
    fonts: [
      { family: 'Space Grotesk', url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap' },
      { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'terra',
    name: 'Terra Warmth',
    description: 'Terracotta and warm sand, Mediterranean vitality',
    character: 'Olive meets Massimo Bottura',
    tokens: TERRA_TOKENS,
    fonts: [
      { family: 'Fraunces', url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap' },
      { family: 'Nunito Sans', url: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600&display=swap' },
    ],
  },
  {
    id: 'void',
    name: 'Void Minimal',
    description: 'Pure black with electric violet, ultra-modern presence',
    character: 'Apple WWDC meets Nothing Phone',
    tokens: VOID_TOKENS,
    fonts: [
      { family: 'Syne', url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap' },
      { family: 'DM Mono', url: 'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap' },
    ],
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
    previewColors: { background: '#080808', surface: '#111111', text: '#E8E4DC', accent: '#C8A96E', accent2: '#8B7744', border: '#2A2520' },
    cssVariables: { '--theme-bg': '#080808', '--theme-surface': '#111111', '--theme-text': '#E8E4DC', '--theme-accent': '#C8A96E', '--theme-border': '#2A2520' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'DM Sans' },
    character: 'WSJ meets Bottega Veneta — dark, luxurious, editorial. Prose is refined and sparse.',
  },
  {
    id: 'ivory', label: 'Ivory Editorial', description: 'Light magazine with confident ink black',
    category: 'light',
    previewColors: { background: '#F8F5EF', surface: '#FFFFFF', text: '#1A1612', accent: '#1A1612', accent2: '#3A3530', border: '#DDD8D0' },
    cssVariables: { '--theme-bg': '#F8F5EF', '--theme-surface': '#FFFFFF', '--theme-text': '#1A1612', '--theme-accent': '#1A1612', '--theme-border': '#DDD8D0' },
    fontPairing: { heading: 'Playfair Display', body: 'Libre Franklin' },
    character: 'The Economist meets Kinfolk — light, authoritative, precise. Confident ink-black clarity.',
  },
  {
    id: 'cobalt', label: 'Cobalt Executive', description: 'Deep navy with electric blue command',
    category: 'dark',
    previewColors: { background: '#01112A', surface: '#071D3F', text: '#E4ECF7', accent: '#4FA3E8', accent2: '#2D6CA8', border: '#1A3558' },
    cssVariables: { '--theme-bg': '#01112A', '--theme-surface': '#071D3F', '--theme-text': '#E4ECF7', '--theme-accent': '#4FA3E8', '--theme-border': '#1A3558' },
    fontPairing: { heading: 'Syne', body: 'DM Sans' },
    character: 'Bloomberg meets McKinsey — executive, data-driven, commanding. No softening language.',
  },
  {
    id: 'sage', label: 'Sage Organic', description: 'Warm earth tones with forest greens',
    category: 'nature',
    previewColors: { background: '#F2F0EB', surface: '#FAFAF7', text: '#2A3228', accent: '#4A6741', accent2: '#3A5230', border: '#D0CEC5' },
    cssVariables: { '--theme-bg': '#F2F0EB', '--theme-surface': '#FAFAF7', '--theme-text': '#2A3228', '--theme-accent': '#4A6741', '--theme-border': '#D0CEC5' },
    fontPairing: { heading: 'Fraunces', body: 'Nunito Sans' },
    character: 'Patagonia meets IDEO — warm, human, design-thinking. Mission-led and grounded.',
  },
  {
    id: 'midnight', label: 'Midnight Electric', description: 'Deep navy with neon cyan tech-forward energy',
    category: 'dark',
    previewColors: { background: '#030d1e', surface: '#0a1628', text: '#e2f0ff', accent: '#00d4ff', accent2: '#0090cc', border: '#0d2340' },
    cssVariables: { '--theme-bg': '#030d1e', '--theme-surface': '#0a1628', '--theme-text': '#e2f0ff', '--theme-accent': '#00d4ff', '--theme-border': '#0d2340' },
    fontPairing: { heading: 'Space Grotesk', body: 'Inter' },
    character: 'Wired meets Verge — electric, high-contrast, tech-forward. Deep navy backgrounds, neon cyan accents. Copy is terse and punchy.',
  },
  {
    id: 'aurora', label: 'Aurora Editorial', description: 'Warm amber and forest green, cinematic editorial',
    category: 'light',
    previewColors: { background: '#faf6f0', surface: '#ffffff', text: '#1a1208', accent: '#d4860a', accent2: '#2d6b2f', border: '#e8ddd0' },
    cssVariables: { '--theme-bg': '#faf6f0', '--theme-surface': '#ffffff', '--theme-text': '#1a1208', '--theme-accent': '#d4860a', '--theme-border': '#e8ddd0' },
    fontPairing: { heading: 'Lora', body: 'Source Serif 4' },
    character: 'National Geographic meets Monocle — cinematic, warm, editorial. Rich amber and forest green. Prose is vivid and unhurried.',
  },
  {
    id: 'slate', label: 'Slate Minimal', description: 'Cool gray minimal, crisp corporate precision',
    category: 'minimal',
    previewColors: { background: '#f4f5f6', surface: '#ffffff', text: '#111318', accent: '#2563eb', accent2: '#1e40af', border: '#dde1e7' },
    cssVariables: { '--theme-bg': '#f4f5f6', '--theme-surface': '#ffffff', '--theme-text': '#111318', '--theme-accent': '#2563eb', '--theme-border': '#dde1e7' },
    fontPairing: { heading: 'Inter', body: 'Inter' },
    character: 'Harvard Business Review meets Stripe Docs — minimal, precise, corporate. Cool gray surfaces, crisp black type. Zero decoration.',
  },
  {
    id: 'crimson', label: 'Crimson Literary', description: 'Deep burgundy with gold, bold and authoritative',
    category: 'bold',
    previewColors: { background: '#0f0508', surface: '#1a0810', text: '#f5e6ea', accent: '#c41e3a', accent2: '#9b1530', border: '#2d0f18' },
    cssVariables: { '--theme-bg': '#0f0508', '--theme-surface': '#1a0810', '--theme-text': '#f5e6ea', '--theme-accent': '#c41e3a', '--theme-border': '#2d0f18' },
    fontPairing: { heading: 'Libre Baskerville', body: 'Source Serif 4' },
    character: 'The Atlantic meets LVMH — bold, literary, premium-red. Deep burgundy with gold accents. Sentences are long and authoritative.',
  },
  {
    id: 'carbon', label: 'Carbon Industrial', description: 'Dark graphite with orange highlights, mechanical',
    category: 'dark',
    previewColors: { background: '#111214', surface: '#1c1e21', text: '#e8e9ea', accent: '#ff6b2b', accent2: '#cc4a15', border: '#2a2d31' },
    cssVariables: { '--theme-bg': '#111214', '--theme-surface': '#1c1e21', '--theme-text': '#e8e9ea', '--theme-accent': '#ff6b2b', '--theme-border': '#2a2d31' },
    fontPairing: { heading: 'Space Grotesk', body: 'DM Mono' },
    character: 'Wired Hardware meets Industrial Design — dark graphite, orange highlights, mechanical feel. Copy is direct and technical.',
  },
  {
    id: 'pearl', label: 'Pearl Refined', description: 'Soft white with blush tones, generous whitespace',
    category: 'light',
    previewColors: { background: '#fdfcfb', surface: '#ffffff', text: '#1a1715', accent: '#c4956a', accent2: '#8b6249', border: '#ede8e3' },
    cssVariables: { '--theme-bg': '#fdfcfb', '--theme-surface': '#ffffff', '--theme-text': '#1a1715', '--theme-accent': '#c4956a', '--theme-border': '#ede8e3' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'Jost' },
    character: 'Apple meets Kinfolk — soft white, blush tones, breathing room. Generous whitespace. Prose is warm and refined.',
  },
  {
    id: 'neon', label: 'Neon Punk', description: 'Dark with vivid magenta and lime, high energy',
    category: 'bold',
    previewColors: { background: '#080810', surface: '#0e0e20', text: '#f0f0ff', accent: '#ff2d78', accent2: '#39ff14', border: '#1a1a35' },
    cssVariables: { '--theme-bg': '#080810', '--theme-surface': '#0e0e20', '--theme-text': '#f0f0ff', '--theme-accent': '#ff2d78', '--theme-border': '#1a1a35' },
    fontPairing: { heading: 'Syne', body: 'Space Grotesk' },
    character: 'Cyberpunk meets Pitch deck — dark background, vivid magenta and lime accents. High energy, startup-bold, irreverent.',
  },
  {
    id: 'forest', label: 'Forest Mission', description: 'Deep greens, earthy tones, mission-driven',
    category: 'nature',
    previewColors: { background: '#080f0a', surface: '#101a12', text: '#e8f0e9', accent: '#2d7a3a', accent2: '#1a5c25', border: '#1a2e1c' },
    cssVariables: { '--theme-bg': '#080f0a', '--theme-surface': '#101a12', '--theme-text': '#e8f0e9', '--theme-accent': '#2d7a3a', '--theme-border': '#1a2e1c' },
    fontPairing: { heading: 'Fraunces', body: 'Nunito Sans' },
    character: 'Patagonia meets McKinsey Sustainability — deep greens, earthy tones, mission-driven. Prose grounds every claim in real impact.',
  },
  {
    id: 'gold', label: 'Gold Ultra-Premium', description: 'Champagne and deep black, ultra-premium luxury',
    category: 'premium',
    previewColors: { background: '#0a0800', surface: '#140f00', text: '#f5eed6', accent: '#c9a84c', accent2: '#a67c2a', border: '#2a2010' },
    cssVariables: { '--theme-bg': '#0a0800', '--theme-surface': '#140f00', '--theme-text': '#f5eed6', '--theme-accent': '#c9a84c', '--theme-border': '#2a2010' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'Jost' },
    character: 'Sothebys meets Rolex — champagne and deep black, ultra-premium. Sparse, deliberate copy. Every word earns its place.',
  },
  {
    id: 'ocean', label: 'Ocean Data', description: 'Deep teal gradient, data-confident and forward-looking',
    category: 'dark',
    previewColors: { background: '#020d18', surface: '#061828', text: '#dff2ff', accent: '#0ea5c9', accent2: '#0077a8', border: '#0a2a3d' },
    cssVariables: { '--theme-bg': '#020d18', '--theme-surface': '#061828', '--theme-text': '#dff2ff', '--theme-accent': '#0ea5c9', '--theme-border': '#0a2a3d' },
    fontPairing: { heading: 'Syne', body: 'Inter' },
    character: 'MIT Technology Review meets Salesforce — deep teal gradient, white type, data-confident. Authoritative and forward-looking.',
  },
  {
    id: 'rose', label: 'Rose Editorial', description: 'Deep rose with blush pink, bold feminine authority',
    category: 'bold',
    previewColors: { background: '#1a0810', surface: '#240f18', text: '#ffeef5', accent: '#e8457a', accent2: '#c02258', border: '#350f20' },
    cssVariables: { '--theme-bg': '#1a0810', '--theme-surface': '#240f18', '--theme-text': '#ffeef5', '--theme-accent': '#e8457a', '--theme-border': '#350f20' },
    fontPairing: { heading: 'Playfair Display', body: 'Jost' },
    character: 'Vogue meets Condé Nast — bold feminine authority, deep rose backgrounds, blush pink accents. Prose is decisive and glamorous.',
  },
  {
    id: 'chalk', label: 'Chalk Academic', description: 'Warm cream with graphite, clean and scholarly',
    category: 'minimal',
    previewColors: { background: '#fafaf8', surface: '#ffffff', text: '#1c1c1a', accent: '#4b5563', accent2: '#374151', border: '#e5e5e2' },
    cssVariables: { '--theme-bg': '#fafaf8', '--theme-surface': '#ffffff', '--theme-text': '#1c1c1a', '--theme-accent': '#4b5563', '--theme-border': '#e5e5e2' },
    fontPairing: { heading: 'Libre Baskerville', body: 'Nunito Sans' },
    character: 'Harvard meets The Atlantic — warm cream, graphite type, scholarly restraint. Every claim is evidence-backed. Zero decoration.',
  },
  {
    id: 'dusk', label: 'Dusk Cinematic', description: 'Deep purple twilight with amber warmth',
    category: 'dark',
    previewColors: { background: '#0d0820', surface: '#140d2e', text: '#ede8ff', accent: '#a855f7', accent2: '#7c3aed', border: '#1f1445' },
    cssVariables: { '--theme-bg': '#0d0820', '--theme-surface': '#140d2e', '--theme-text': '#ede8ff', '--theme-accent': '#a855f7', '--theme-border': '#1f1445' },
    fontPairing: { heading: 'Cormorant Garamond', body: 'DM Sans' },
    character: 'A24 meets Monocle — cinematic twilight purple, soft violet glow. Atmospheric, poetic, and unhurried. Every word feels intentional.',
  },
  {
    id: 'copper', label: 'Copper Artisan', description: 'Dark espresso with rich copper, handcrafted premium',
    category: 'premium',
    previewColors: { background: '#0d0805', surface: '#180f08', text: '#f5ede6', accent: '#b87333', accent2: '#8b5523', border: '#2a1a10' },
    cssVariables: { '--theme-bg': '#0d0805', '--theme-surface': '#180f08', '--theme-text': '#f5ede6', '--theme-accent': '#b87333', '--theme-border': '#2a1a10' },
    fontPairing: { heading: 'Fraunces', body: 'Source Serif 4' },
    character: 'Hermès meets Kinfolk — dark espresso, burnished copper highlights. Artisanal, warm, and deliberately slow. Prose never rushes.',
  },
  {
    id: 'arctic', label: 'Arctic Precision', description: 'Ice blue and white, ultra-clean technical authority',
    category: 'minimal',
    previewColors: { background: '#f0f7ff', surface: '#ffffff', text: '#0d1b2e', accent: '#1e6ec8', accent2: '#1453a0', border: '#c8dff5' },
    cssVariables: { '--theme-bg': '#f0f7ff', '--theme-surface': '#ffffff', '--theme-text': '#0d1b2e', '--theme-accent': '#1e6ec8', '--theme-border': '#c8dff5' },
    fontPairing: { heading: 'Inter', body: 'Inter' },
    character: 'Linear meets Figma Docs — icy blue-white, crisp navy text, precise grid. Technical authority without decoration. Copy is sharp and exact.',
  },
  {
    id: 'ember', label: 'Ember Intensity', description: 'Pure black with electric red-orange, high-stakes energy',
    category: 'bold',
    previewColors: { background: '#0a0300', surface: '#160700', text: '#fff5ee', accent: '#ff4500', accent2: '#cc2200', border: '#2a0a00' },
    cssVariables: { '--theme-bg': '#0a0300', '--theme-surface': '#160700', '--theme-text': '#fff5ee', '--theme-accent': '#ff4500', '--theme-border': '#2a0a00' },
    fontPairing: { heading: 'Syne', body: 'DM Sans' },
    character: 'YCombinator meets Red Bull — near-black with electric red-orange. Urgency baked into every line. Copy is bold, direct, and zero-fluff.',
  },
  {
    id: 'lavender', label: 'Lavender Fields', description: 'Soft lavender with deep violet, romantic editorial',
    category: 'light',
    previewColors: { background: '#f8f5ff', surface: '#ffffff', text: '#1a1228', accent: '#7c3aed', accent2: '#6d28d9', border: '#e0d8f8' },
    cssVariables: { '--theme-bg': '#f8f5ff', '--theme-surface': '#ffffff', '--theme-text': '#1a1228', '--theme-accent': '#7c3aed', '--theme-border': '#e0d8f8' },
    fontPairing: { heading: 'Lora', body: 'Libre Franklin' },
    character: 'Aesop meets Letterboxd — soft lavender fields, deep violet accents, generous leading. Thoughtful and literary. Never loud, always felt.',
  },
  {
    id: 'steel', label: 'Steel Authority', description: 'Dark steel blue with chrome highlights, industrial command',
    category: 'dark',
    previewColors: { background: '#0c1420', surface: '#132030', text: '#ccd8e8', accent: '#7ba7d4', accent2: '#5a88b5', border: '#1e2e42' },
    cssVariables: { '--theme-bg': '#0c1420', '--theme-surface': '#132030', '--theme-text': '#ccd8e8', '--theme-accent': '#7ba7d4', '--theme-border': '#1e2e42' },
    fontPairing: { heading: 'Space Grotesk', body: 'Inter' },
    character: 'Boeing meets Palantir — dark steel, chrome-blue highlights, structured authority. Data talks louder than adjectives. Copy is compressed and factual.',
  },
  {
    id: 'terra', label: 'Terra Warmth', description: 'Terracotta and warm sand, Mediterranean vitality',
    category: 'nature',
    previewColors: { background: '#f7f0e8', surface: '#ffffff', text: '#2a1a0a', accent: '#c4621a', accent2: '#a0481a', border: '#ddd0c0' },
    cssVariables: { '--theme-bg': '#f7f0e8', '--theme-surface': '#ffffff', '--theme-text': '#2a1a0a', '--theme-accent': '#c4621a', '--theme-border': '#ddd0c0' },
    fontPairing: { heading: 'Fraunces', body: 'Nunito Sans' },
    character: 'Olive meets Massimo Bottura — warm terracotta, sandy surfaces, Mediterranean rhythm. Grounded, human, and full of life. Prose breathes.',
  },
  {
    id: 'void', label: 'Void Minimal', description: 'Pure black with electric violet, ultra-modern presence',
    category: 'dark',
    previewColors: { background: '#000000', surface: '#0a0a0a', text: '#ffffff', accent: '#8b5cf6', accent2: '#7c3aed', border: '#1a1a1a' },
    cssVariables: { '--theme-bg': '#000000', '--theme-surface': '#0a0a0a', '--theme-text': '#ffffff', '--theme-accent': '#8b5cf6', '--theme-border': '#1a1a1a' },
    fontPairing: { heading: 'Syne', body: 'DM Mono' },
    character: 'Apple WWDC meets Nothing Phone — pure black canvas, electric violet pulse. Confident silence. One idea per sentence. Minimal is the message.',
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
  // extreme contrast → less blending with bg → crisper text hierarchy
  const textBlendMuted  = contrastLevel === 'extreme' ? 0.32 : contrastLevel === 'high' ? 0.40 : 0.45;
  const textBlendSubtle = contrastLevel === 'extreme' ? 0.56 : contrastLevel === 'high' ? 0.65 : 0.68;
  const textMuted  = blendHex(text, bg, textBlendMuted,  base.textMuted);
  const textSubtle = blendHex(text, bg, textBlendSubtle, base.textSubtle);

  // ── Accent — accentUsage boosts or subdues saturation ─────────────────────
  const accentBoost   = accentUsage === 'dominant' ? 0.08 : accentUsage === 'sparingly' ? -0.06 : 0;
  const accentFinal   = accentBoost !== 0 ? shiftL(accent, accentBoost, accent) : accent;
  const accentDim     = shiftL(accentFinal, -0.15, base.accentDim);
  const accentRgb     = (() => { const rgb = hexToRgb(accentFinal); return rgb ? `${rgb[0]},${rgb[1]},${rgb[2]}` : base.accentRgb; })();

  // ── Glow — personality-driven opacity ─────────────────────────────────────
  //   editorial → whisper glow (typography carries the weight)
  //   bold      → blazing glow (accent is dominant)
  //   minimal   → near-none
  const glowOpacity = isEditorial ? 0.10 : isBold ? 0.42 : isMinimal ? 0.08 : 0.28;
  const glowColor   = `rgba(${accentRgb},${glowOpacity})`;

  // ── Borders ─────────────────────────────────────────────────────────────────
  const border       = shiftL(surfaceAlt, dark ? 0.04 : -0.04, base.border);
  const borderSubtle = blendHex(surface, surfaceAlt, 0.4, base.borderSubtle);

  // ── Hero gradient ──────────────────────────────────────────────────────────
  //   editorial → nearly flat, barely-there gradient (typography lives in clean air)
  //   bold      → dramatic angled, directional — high visual energy
  //   minimal   → solid colour, zero gradient
  //   default   → balanced radial
  const gradientHero = isEditorial
    ? `radial-gradient(ellipse 140% 100% at 50% 60%, ${surfaceAlt}44 0%, ${bg} 55%)`
    : isBold
      ? `radial-gradient(ellipse 110% 90% at 18% 12%, ${surfaceAlt} 0%, ${bg} 68%), radial-gradient(ellipse 60% 50% at 82% 82%, ${shiftL(bg, dark ? 0.06 : -0.04, bg)} 0%, transparent 55%)`
      : isMinimal
        ? bg  // solid — no gradient whatsoever
        : `radial-gradient(ellipse 80% 60% at 50% 40%, ${surfaceAlt} 0%, ${bg} 100%)`;

  // ── Gradient text ──────────────────────────────────────────────────────────
  //   editorial → solid accent (no gradient — typographic purity)
  //   bold      → wide, high-contrast spread
  //   default   → standard spread
  const accentLight = shiftL(accentFinal, 0.12, accentFinal);
  const gradientText = isEditorial
    ? `linear-gradient(135deg, ${accentFinal} 0%, ${accentFinal} 100%)`
    : isBold
      ? `linear-gradient(135deg, ${accentLight} 0%, ${accentFinal} 35%, ${shiftL(accentFinal, 0.16, accentFinal)} 100%)`
      : `linear-gradient(135deg, ${accentLight} 0%, ${accentFinal} 50%, ${shiftL(accentFinal, 0.08, accentFinal)} 100%)`;

  // ── Mesh gradient ──────────────────────────────────────────────────────────
  //   editorial / minimal → '' (falsy → components skip rendering it)
  //   bold      → large, high-opacity blobs — strong ambient colour field
  //   default   → standard soft blobs
  const meshGradient = (isEditorial || isMinimal)
    ? ''
    : isBold
      ? `radial-gradient(ellipse 110% 85% at 14% 18%, rgba(${accentRgb},0.22) 0%, transparent 52%), radial-gradient(ellipse 85% 75% at 86% 82%, rgba(${accentRgb},0.16) 0%, transparent 48%)`
      : `radial-gradient(ellipse 80% 60% at 20% 25%, rgba(${accentRgb},0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 75%, rgba(${accentRgb},0.08) 0%, transparent 55%)`;

  // ── Shadows ────────────────────────────────────────────────────────────────
  //   none / minimal   → flat, outline only
  //   colored / bold   → accent-tinted depth
  //   strong           → deep monochrome
  //   editorial        → whisper — barely lifted
  //   default          → standard depth
  let cardShadow: string;
  let cardShadowHover: string;

  if (shadowStyle === 'none' || isMinimal) {
    cardShadow      = 'none';
    cardShadowHover = `0 0 0 1px ${border}`;
  } else if (shadowStyle === 'colored' || isBold) {
    cardShadow      = dark
      ? `0 6px 32px rgba(0,0,0,0.60), 0 0 0 1px rgba(${accentRgb},0.12)`
      : `0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(${accentRgb},0.15)`;
    cardShadowHover = dark
      ? `0 12px 48px rgba(0,0,0,0.75), 0 0 28px rgba(${accentRgb},0.28)`
      : `0 12px 40px rgba(0,0,0,0.18), 0 0 20px rgba(${accentRgb},0.22)`;
  } else if (shadowStyle === 'strong') {
    cardShadow      = dark ? '0 8px 40px rgba(0,0,0,0.70)' : '0 4px 24px rgba(0,0,0,0.15)';
    cardShadowHover = dark ? '0 16px 56px rgba(0,0,0,0.85)' : '0 8px 40px rgba(0,0,0,0.22)';
  } else if (isEditorial) {
    cardShadow      = dark ? '0 1px 8px rgba(0,0,0,0.25)' : '0 1px 6px rgba(0,0,0,0.06)';
    cardShadowHover = dark ? '0 4px 20px rgba(0,0,0,0.40)' : '0 4px 16px rgba(0,0,0,0.10)';
  } else {
    cardShadow      = dark ? '0 4px 24px rgba(0,0,0,0.50)' : '0 2px 16px rgba(0,0,0,0.08)';
    cardShadowHover = dark
      ? `0 8px 40px rgba(0,0,0,0.70), 0 0 20px rgba(${accentRgb},0.18)`
      : `0 8px 32px rgba(0,0,0,0.14), 0 0 0 1px rgba(${accentRgb},0.10)`;
  }

  // ── Noise opacity — style-modulated ───────────────────────────────────────
  //   editorial → capped low (clean surface)
  //   bold      → amplified (more tactile texture)
  const baseNoise    = typeof tier1.noiseOpacity === 'number' ? tier1.noiseOpacity : base.noiseOpacity;
  const noiseOpacity = isEditorial ? Math.min(baseNoise, 0.015) : isBold ? Math.min(baseNoise * 1.5, 0.06) : baseNoise;

  return {
    bg, surface, surfaceAlt, surfaceCard,
    text, textMuted, textSubtle,
    accent: accentFinal, accentDim, accentRgb, glowColor,
    border, borderSubtle,
    heroFont:      typeof tier1.heroFont      === 'string' ? tier1.heroFont      : base.heroFont,
    bodyFont:      typeof tier1.bodyFont      === 'string' ? tier1.bodyFont      : base.bodyFont,
    // heroWeight may arrive as a number (700) or a string ("700") from the LLM — accept both.
    heroWeight:    (typeof tier1.heroWeight === 'number' ? tier1.heroWeight : (typeof tier1.heroWeight === 'string' ? Number(tier1.heroWeight) || base.heroWeight : base.heroWeight)),
    heroStyle:     typeof tier1.heroStyle     === 'string' ? tier1.heroStyle     : base.heroStyle,
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
    // This ensures deriveTokens() runs unconditionally and semantic fields
    // (visualStyle, typography.style, colorStrategy, etc.) always take effect.
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
  // Adjust text/accent colors to meet minimum contrast ratios before any
  // component uses the tokens. Hue and saturation are preserved; only
  // lightness shifts. This runs for every token set: plugins, brand
  // overrides, and LLM-synthesized designs.
  return enforceWCAGTokens(resolved);
}

/** Get gradient for a section type (fallback imagery) */
export function getSectionGradient(type: string, tokens: PluginTokens): string {
  switch (type) {
    case 'hero':        return tokens.gradientHero;
    case 'challenge':   return `radial-gradient(ellipse 70% 50% at 50% 50%, ${tokens.surfaceCard} 0%, ${tokens.bg} 100%)`;
    case 'approach':    return `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surfaceAlt} 100%)`;
    case 'pricing':     return `radial-gradient(ellipse 60% 40% at 50% 20%, ${tokens.surfaceAlt} 0%, ${tokens.bg} 100%)`;
    case 'whyus':       return `linear-gradient(180deg, ${tokens.surfaceCard} 0%, ${tokens.surface} 100%)`;
    default:            return `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surfaceAlt} 50%, ${tokens.bg} 100%)`;
  }
}
