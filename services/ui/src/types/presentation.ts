// ── Section types ─────────────────────────────────────────────────────────────

export type SectionType =
  | 'hero'
  | 'challenge'
  | 'approach'
  | 'deliverables'
  | 'timeline'
  | 'pricing'
  | 'whyus'
  | 'nextsteps'
  | 'testimonials'
  | 'showcase'
  | 'benefits'
  | 'problem'
  | 'stats'
  | 'generic';

// ── Parsed markdown structures ───────────────────────────────────────────────

export interface ParsedSubhead {
  heading: string;
  body: string;
}

export interface ParsedSection {
  id: string;
  heading: string;
  rawBody: string;
  rawItems: string[];
  rawTable: string[][];
  subheads: ParsedSubhead[];
  detectedType: SectionType;
}

export interface ParsedProposal {
  meta: {
    title: string;
    client: string;
    date: string;
    author: string;
  };
  sections: ParsedSection[];
}

// ── Brand configuration ──────────────────────────────────────────────────────

export interface BrandConfig {
  companyName: string;
  tagline: string;
  logoUrl: string | null;
  logoText: string;
  primaryColor: string;
  secondaryColor: string;
}

// ── Plugin token schema ──────────────────────────────────────────────────────

export interface PluginTokens {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfaceCard: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentDim: string;
  accentRgb: string;
  glowColor: string;
  border: string;
  borderSubtle: string;
  heroFont: string;
  bodyFont: string;
  heroWeight: number;
  heroStyle: string;
  labelTracking: string;
  dark: boolean;
  noiseOpacity: number;
  gradientHero: string;
  gradientText: string;
  meshGradient: string;
  cardShadow: string;
  cardShadowHover: string;
  // Design control tokens (LLM-synthesized, optional)
  iconBg?: string;
  borderRadius?: string;
  buttonStyle?: string;
  density?: string;
}

export interface PluginMeta {
  id: string;
  name: string;
  description: string;
  character: string;
  tokens: PluginTokens;
  fonts: { family: string; url: string }[];
}

// ── AI brief (Pass 1 output) ────────────────────────────────────────────────

export interface AIBrief {
  clientName: string;
  clientIndustry: string;
  clientChallenge: string;
  proposingCompany: string;
  proposingStrength: string;
  engagementSummary: string;
  keyOutcomes: string[];
  totalValue: string;
  duration: string;
  primaryTone: 'authoritative' | 'consultative' | 'innovative' | 'warm';
  heroNarrative: string;
  industryKeywords: string[];
}

// ── Section content shapes (Pass 2 output) ───────────────────────────────────

export interface HeroContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  body: string;
  ctaPrimary: string;
  ctaSecondary: string;
  imageQuery: string;
  ctaTarget?: string;           // section type or slug to scroll to on primary CTA tap
  ctaSecondaryTarget?: string;  // section type or slug for secondary CTA
}

export interface ChallengeContent {
  eyebrow: string;
  headline: string;
  body: string;
  pullquote: string;
  imageQuery: string;
  diagram?: string;
}

export interface ApproachPillar {
  iconHint: string;
  name: string;
  description: string;
}

export interface ApproachContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  pillars: ApproachPillar[];
  imageQuery: string;
  diagram?: string;
}

export interface DeliverableItem {
  iconHint: string;
  name: string;
  detail: string;
}

export interface DeliverablesContent {
  eyebrow: string;
  headline: string;
  items: DeliverableItem[];
  imageQuery: string;
}

export interface TimelinePhase {
  label: string;
  duration: string;
  name: string;
  description: string;
}

export interface TimelineContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  phases: TimelinePhase[];
  imageQuery: string;
  diagram?: string;
}

export interface PricingContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  rows: string[][];
  totalLabel: string;
  footnote: string;
  cta: string;
  imageQuery: string;
}

export interface WhyUsStat {
  number: string;
  label: string;
  context: string;
}

export interface WhyUsContent {
  eyebrow: string;
  headline: string;
  body: string;
  stats: WhyUsStat[];
  imageQuery: string;
  diagram?: string;
}

export interface NextStepsContent {
  eyebrow: string;
  headline: string;
  body: string;
  ctaPrimary: string;
  ctaSecondary: string;
  urgencyNote: string | null;
  imageQuery: string;
}

export interface GenericContent {
  eyebrow: string;
  headline: string;
  body: string;
  imageQuery: string;
}

export interface TestimonialItem {
  quote: string;
  name: string;
  title: string;
  company: string;
}

export interface TestimonialsContent {
  eyebrow: string;
  headline: string;
  items: TestimonialItem[];
}

export interface ShowcaseContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  body: string;
  highlights: string[];
  imageQuery: string;
}

export interface BenefitItem {
  iconHint: string;
  title: string;
  description: string;
}

export interface BenefitsContent {
  eyebrow: string;
  headline: string;
  items: BenefitItem[];
}

export interface ProblemContent {
  eyebrow: string;
  headline: string;
  body: string;
  painPoints: string[];
  imageQuery: string;
}

export interface StatItem {
  number: string;
  label: string;
  context: string;
}

export interface StatsContent {
  eyebrow: string;
  headline: string;
  stats: StatItem[];
}

export interface MetricsContent {
  eyebrow: string;
  headline: string;
  stats: StatItem[];
  strategies?: string[];
}

export interface SecurityItem {
  iconHint: string;
  name: string;
  description: string;
}

export interface SecurityContent {
  eyebrow: string;
  headline: string;
  items: SecurityItem[];
}

export interface TechStackCategory {
  iconHint: string;
  name: string;
  items: string[];
}

export interface TechStackContent {
  eyebrow: string;
  headline: string;
  categories: TechStackCategory[];
}

export interface TestingLayer {
  level: number;
  name: string;
  coverage: string;
  description: string;
}

export interface TestingAdditionalInfo {
  heading: string;
  body: string;
}

export interface TestingContent {
  eyebrow: string;
  headline: string;
  layers: TestingLayer[];
  additionalInfo?: TestingAdditionalInfo[];
}

export type SectionContent =
  | HeroContent
  | ChallengeContent
  | ApproachContent
  | DeliverablesContent
  | TimelineContent
  | PricingContent
  | WhyUsContent
  | NextStepsContent
  | TestimonialsContent
  | ShowcaseContent
  | BenefitsContent
  | ProblemContent
  | StatsContent
  | MetricsContent
  | SecurityContent
  | TechStackContent
  | TestingContent
  | GenericContent;

// ── Layout AST ───────────────────────────────────────────────────────────────

export interface LayoutSection {
  id: string;
  heading: string;
  sectionType: SectionType;
  content: SectionContent;
  image: {
    source: 'unsplash' | 'gradient';
    query: string;
    url: string | null;
    fallback: 'gradient-mesh';
  };
  editable: boolean;
  version: number;
}

export interface LayoutAST {
  proposalId: string;
  generatedAt: string;
  meta: {
    title: string;
    client: string;
    date: string;
    author: string;
  };
  brief: AIBrief;
  brand: BrandConfig;
  plugin: string;
  sections: LayoutSection[];
  // LLM-synthesized design system (present only when brandLanguagePrompt was provided)
  customCharacter?: string;
  customTokens?: Partial<PluginTokens>;
  customFonts?: { family: string; url: string }[];
  customDesignSystem?: {
    visualStyle?: string;
    density?: string;
    typography?: { style?: string; headingWeight?: string; scale?: string };
    colorStrategy?: { type?: string; contrast?: string; accentUsage?: string };
    layoutStyle?: { alignment?: string; heroStyle?: string; sectionFlow?: string };
    componentStyle?: { button?: string; card?: string; borderRadius?: string; shadow?: string };
    behavior?: { motion?: string; parallax?: boolean; scrollEffects?: string };
  };
  // Top-level behavior driven by user prompt / design system
  behavior?: {
    motion?: 'instant' | 'deliberate' | 'expressive';
    parallax?: boolean;
    scrollEffects?: 'none' | 'fade-in' | 'slide-up';
  };
}

// ── Icon hint type ───────────────────────────────────────────────────────────

export type IconHint =
  | 'identity'
  | 'digital'
  | 'content'
  | 'strategy'
  | 'research'
  | 'launch'
  | 'document'
  | 'website'
  | 'photo'
  | 'campaign'
  | 'default';
