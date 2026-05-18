// services/api/src/chat/branding.types.ts
//
// Branding kit types for client microsite personalization.
// Stored in context.json alongside requirements and knowledge.
// The microsite generator reads this to style the one-pager.

export interface BrandColor {
  hex: string;
  usage: 'primary' | 'secondary' | 'accent' | 'background' | 'text';
  confidence: number;
}

export interface BrandTypography {
  fontFamily: string;
  usage: 'heading' | 'body' | 'accent';
  weight?: string;
  confidence: number;
}

export interface BrandingKit {
  /** Extracted or provided logo URL */
  logoUrl?: string;
  /** Color palette extracted from website or brand guidelines */
  colors: BrandColor[];
  /** Typography extracted from website CSS or brand guidelines */
  typography: BrandTypography[];
  /** Overall visual tone (e.g. "minimal", "bold", "corporate") */
  visualTone?: string;
  /** Light or dark theme preference */
  themePreference?: 'light' | 'dark' | 'auto';
  /** Corner style observed (sharp, rounded, pill) */
  cornerStyle?: 'sharp' | 'rounded' | 'pill';
  /** Source of branding data */
  source: 'website_scrape' | 'manual' | 'brand_guidelines' | 'inferred';
  /** When the branding was extracted */
  extractedAt: string;
}
