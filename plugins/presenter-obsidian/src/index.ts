import type { PresentationPlugin, PresenterTokens, PluginManifest } from '@ai-engine/plugin-sdk';

const manifest: PluginManifest = {
  name: 'obsidian',
  displayName: 'Obsidian Luxury',
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
  meshGradient:
    'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(200,169,110,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(200,169,110,0.08) 0%, transparent 55%)',
  cardShadow: '0 4px 24px rgba(0,0,0,0.5)',
  cardShadowHover: '0 8px 40px rgba(0,0,0,0.7), 0 0 20px rgba(200,169,110,0.18)',
};

const plugin: PresentationPlugin = {
  manifest,
  tokens,
  fonts: [
    {
      family: 'Cormorant Garamond',
      url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap',
    },
    {
      family: 'DM Sans',
      url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap',
    },
  ],
};

export default plugin;
