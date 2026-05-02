import type { PresentationPlugin, PresenterTokens, PluginManifest } from '@ai-engine/plugin-sdk';

const manifest: PluginManifest = {
  name: 'cobalt',
  displayName: 'Cobalt Executive',
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
  meshGradient:
    'radial-gradient(ellipse 80% 60% at 20% 25%, rgba(79,163,232,0.15) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 75%, rgba(79,163,232,0.1) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.8), 0 0 24px rgba(79,163,232,0.22)',
};

const plugin: PresentationPlugin = {
  manifest,
  tokens,
  fonts: [
    {
      family: 'Syne',
      url: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&display=swap',
    },
    {
      family: 'DM Sans',
      url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap',
    },
  ],
};

export default plugin;
