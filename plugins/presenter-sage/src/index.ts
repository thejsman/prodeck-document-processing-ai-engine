import type { PresentationPlugin, PresenterTokens, PluginManifest } from '@ai-engine/plugin-sdk';

const manifest: PluginManifest = {
  name: 'sage',
  displayName: 'Sage Organic',
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
  meshGradient:
    'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(74,103,65,0.1) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(74,103,65,0.07) 0%, transparent 55%)',
  cardShadow: '0 2px 16px rgba(42,50,40,0.1)',
  cardShadowHover: '0 8px 32px rgba(42,50,40,0.18), 0 0 16px rgba(74,103,65,0.15)',
};

const plugin: PresentationPlugin = {
  manifest,
  tokens,
  fonts: [
    {
      family: 'Fraunces',
      url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap',
    },
    {
      family: 'Nunito Sans',
      url: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500;600&display=swap',
    },
  ],
};

export default plugin;
