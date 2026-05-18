// services/api/src/skills/design-skill.types.ts
// TypeScript interfaces for standalone Design Skills.

export const AESTHETIC_TONES = [
  'brutally minimal',
  'maximalist chaos',
  'retro-futuristic',
  'organic/natural',
  'luxury/refined',
  'playful/toy-like',
  'editorial/magazine',
  'brutalist/raw',
  'art deco/geometric',
  'soft/pastel',
  'industrial/utilitarian',
] as const;

export type AestheticTone = (typeof AESTHETIC_TONES)[number];

export const APPROVED_HEADING_FONTS = [
  'Bebas Neue',
  'Syne',
  'Raleway',
  'Montserrat',
  'Poppins',
  'DM Serif Display',
  'Playfair Display',
  'Space Mono',
  'Barlow Condensed',
  'Oswald',
  'Cormorant Garamond',
  'Abril Fatface',
  'Bree Serif',
] as const;

export const APPROVED_BODY_FONTS = [
  'DM Sans',
  'Inter',
  'Lato',
  'Open Sans',
  'Source Sans 3',
  'Nunito',
  'Work Sans',
  'IBM Plex Sans',
  'Karla',
  'Jost',
] as const;

export interface DesignSkill {
  slug: string
  displayName: string
  description: string
  aestheticTone: AestheticTone
  colorPalette: {
    primary: string
    secondary?: string
    background?: string
  }
  typography: {
    headingFont: string
    bodyFont: string
    headingStyle: 'bold' | 'playful' | 'editorial' | 'minimal' | 'strong'
  }
  animations: 'none' | 'minimal' | 'smooth' | 'playful' | 'bounce'
  customInstructions: string
  themeClass: 'dark' | 'light' | 'colorful'
  createdAt: string
  updatedAt: string
}

export interface DesignSkillSummary {
  slug: string
  displayName: string
  description: string
  aestheticTone: AestheticTone
  themeClass: 'dark' | 'light' | 'colorful'
  colorPalette: { primary: string; secondary?: string; background?: string }
  updatedAt: string
}

export interface CreateDesignSkillInput {
  slug?: string
  displayName: string
  description?: string
  aestheticTone?: AestheticTone
  colorPalette?: { primary?: string; secondary?: string; background?: string }
  typography?: { headingFont?: string; bodyFont?: string; headingStyle?: DesignSkill['typography']['headingStyle'] }
  animations?: DesignSkill['animations']
  customInstructions?: string
  themeClass?: DesignSkill['themeClass']
}
