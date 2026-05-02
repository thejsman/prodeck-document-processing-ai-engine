import type { PresentationPlugin, PresenterTokens, PluginManifest } from '@ai-engine/plugin-sdk';

const manifest: PluginManifest = {
  name: 'ivory',
  displayName: 'Ivory Editorial',
  version: '1.0.0',
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
      supportsCustomTokens: true,
      imageSourceTypes: ['unsplash', 'dalle', 'gradient', 'custom-url'],
    },
  },
};

const tokens: PresenterTokens = {
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
  meshGradient:
    'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(26,22,18,0.06) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(26,22,18,0.04) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(26,22,18,0.08)',
  cardShadowHover: '0 8px 32px rgba(26,22,18,0.14), 0 0 0 1px rgba(26,22,18,0.1)',
};

const plugin: PresentationPlugin = {
  manifest,
  tokens,
  fonts: [
    {
      family: 'Playfair Display',
      url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap',
    },
    {
      family: 'Libre Franklin',
      url: 'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@300;400;500;600&display=swap',
    },
  ],
};

export default plugin;
