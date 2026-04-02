import type { PresentationPlugin, PresenterTokens, PluginManifest } from '@ai-engine/plugin-sdk';

const manifest: PluginManifest = {
  name: 'markdown',
  displayName: 'Markdown Presenter',
  version: '0.1.0',
  sdkVersion: '0.1',
  type: 'presenter',
  entry: './dist/index.js',
  capabilities: {
    presentation: {
      sectionTypes: [
        'hero', 'challenge', 'approach', 'deliverables', 'timeline',
        'pricing', 'whyus', 'nextsteps', 'testimonials', 'showcase',
        'benefits', 'problem', 'stats', 'metrics', 'security',
        'techstack', 'testing', 'generic',
      ],
      supportsCustomTokens: false,
      imageSourceTypes: [],
    },
  },
};

const tokens: PresenterTokens = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F8FA',
  surfaceCard: '#FFFFFF',
  text: '#1F2328',
  textMuted: '#656D76',
  textSubtle: '#9198A1',
  accent: '#0969DA',
  accentDim: '#218BFF',
  accentRgb: '9,105,218',
  glowColor: 'rgba(9,105,218,0.15)',
  border: '#D0D7DE',
  borderSubtle: '#EAEEF2',
  heroFont: 'system-ui',
  bodyFont: 'system-ui',
  heroWeight: 700,
  heroStyle: 'normal',
  labelTracking: '0em',
  dark: false,
  noiseOpacity: 0,
  gradientHero: 'none',
  gradientText: 'none',
  meshGradient: 'none',
  cardShadow: '0 1px 3px rgba(31,35,40,0.1)',
  cardShadowHover: '0 4px 12px rgba(31,35,40,0.15)',
};

const plugin: PresentationPlugin = {
  manifest,
  tokens,
  fonts: [],
};

export default plugin;
