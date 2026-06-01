// ── Motion level ──────────────────────────────────────────────────────────────
export type MotionLevel = 'none' | 'minimal' | 'standard' | 'cinematic' | 'immersive';

// ── Section types ─────────────────────────────────────────────────────────────

export type SectionType =
  | 'hero'
  | 'overview'
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
  | 'metrics'
  | 'security'
  | 'techstack'
  | 'testing'
  | 'faq'
  | 'team'
  | 'comparison'
  | 'casestudy'
  | 'approval'
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
  // Design token override fields (populated by extractDesignTokens when fullDesignPrompt is present)
  overrideTheme?: boolean;
  extractedCssVariables?: Record<string, string>;
  googleFontsUrl?: string | null;
  fontFaceDeclarations?: string;
  animationStyle?: string;
  gradientsEnabled?: boolean;
  decorativeEnabled?: boolean;
  borderRadiusStyle?: string;
  themeClass?: string;
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

export interface OverviewContent {
  eyebrow: string;
  headline: string;
  body: string;
  subheadline?: string;
  highlights: Array<{ label: string; value: string }>;
  imageQuery: string;
}

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
  diagram?: string;
}

export interface ChallengeContent {
  eyebrow: string;
  headline: string;
  body: string;
  pullquote: string;
  imageQuery: string;
  diagram?: string;
  highlights?: Array<{ title: string; subtitle?: string }>;
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
  tag?: string;
}

export interface DeliverablesContent {
  eyebrow: string;
  headline: string;
  items: DeliverableItem[];
  imageQuery: string;
  diagram?: string;
}

export interface TimelinePhase {
  label: string;
  duration: string;
  name: string;
  description: string;
  outcomes?: string[];
  deliverables?: string[];
}

export interface TimelineContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  phases: TimelinePhase[];
  imageQuery: string;
  diagram?: string;
  summary?: Array<{ number: string; label: string }>;
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

export interface NextStep {
  stepNumber: string;
  title: string;
  description: string;
}

export interface NextStepsContent {
  eyebrow: string;
  headline: string;
  body: string;
  steps?: NextStep[];
  ctaPrimary: string;
  ctaSecondary: string;
  urgencyNote: string | null;
  imageQuery: string;
  diagram?: string;
}

export interface GenericContent {
  eyebrow: string;
  headline: string;
  body: string;
  imageQuery: string;
  diagram?: string;
  highlights?: Array<{ title: string; subtitle?: string }>;
  items?: Array<{ name: string; detail?: string; iconHint?: string }>;
  pillars?: Array<{ name: string; description?: string; iconHint?: string }>;
  /** Layout variant hint from agent — overrides content-aware auto-selection */
  layout?: 'bento' | 'editorial' | 'icon-cards' | 'two-panel' | 'split' | 'timeline-steps';
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
  highlights: string[] | Array<{ title: string; subtitle?: string }>;
  imageQuery: string;
  diagram?: string;
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
  diagram?: string;
}

export interface ProblemContent {
  eyebrow: string;
  headline: string;
  body: string;
  painPoints: string[];
  imageQuery: string;
  diagram?: string;
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
  diagram?: string;
}

export interface MetricsContent {
  eyebrow: string;
  headline: string;
  stats: StatItem[];
  strategies?: string[];
  diagram?: string;
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
  diagram?: string;
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
  diagram?: string;
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
  diagram?: string;
}

// ── FAQ ──────────────────────────────────────────────────────────────────────

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqContent {
  eyebrow: string;
  headline: string;
  subheadline?: string;
  items: FaqItem[];
}

// ── Team ─────────────────────────────────────────────────────────────────────

export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  iconHint: string;
}

export interface TeamContent {
  eyebrow: string;
  headline: string;
  subheadline?: string;
  members: TeamMember[];
  imageQuery: string;
}

// ── Comparison ───────────────────────────────────────────────────────────────

export interface ComparisonRow {
  feature: string;
  us: string;
  them: string;
}

export interface ComparisonContent {
  eyebrow: string;
  headline: string;
  subheadline?: string;
  usLabel: string;
  themLabel: string;
  rows: ComparisonRow[];
  imageQuery: string;
}

// ── Case Study ───────────────────────────────────────────────────────────────

export interface CaseStudyMetric {
  value: string;
  label: string;
}

export interface CaseStudyContent {
  eyebrow: string;
  headline: string;
  challenge: string;
  solution: string;
  outcome: string;
  metrics: CaseStudyMetric[];
  imageQuery: string;
}

// ── Chart ────────────────────────────────────────────────────────────────────

export interface ApprovalContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  termsText?: string;
  ctaLabel?: string;
  imageQuery: string;
}

export type SectionContent =
  | HeroContent
  | OverviewContent
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
  | FaqContent
  | TeamContent
  | ComparisonContent
  | CaseStudyContent
  | ApprovalContent
  | GenericContent;

// ── Layout AST ───────────────────────────────────────────────────────────────

export interface LayoutSection {
  id: string;
  heading: string;
  sectionType: SectionType;
  content: SectionContent;
  image: {
    source: 'unsplash' | 'gradient' | 'custom';
    query: string;
    url: string | null;
    fallback: 'gradient-mesh';
  };
  /** Optional per-section background color override (set via inline editor) */
  bgColor?: string;
  /** Per-section title (h1/h2) font-size multiplier (0.5 – 2.0, default 1). */
  titleScale?: number;
  /** Per-section body text font-size multiplier (0.5 – 2.0, default 1). */
  contentScale?: number;
  /** Optional embedded media (YouTube, Loom, or custom iframe) */
  embed?: { url: string; title?: string };
  /** Optional image overlay effect applied on top of the background image */
  imageOverlay?: {
    type: 'gradient' | 'duotone' | 'vignette' | 'tint';
    color?: string;
    opacity?: number;
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
    motionLevel?: MotionLevel;
  };
  /** Per-section animation overrides keyed by section.id */
  sectionAnimations?: Record<string, 'fadeUp' | 'slideLeft' | 'scale' | 'staggerWave' | 'counterRollup' | 'none'>;
  /** SVG divider shape rendered between sections */
  dividerStyle?: 'none' | 'wave' | 'diagonal' | 'curve' | 'zigzag';
  /** Floating decorative element layer applied to sections */
  decorations?: {
    style: 'orbs' | 'dots' | 'grid' | 'geometric' | 'none';
    opacity?: number;
    /** Section ids to apply decorations to; omit for all sections */
    sections?: string[];
  };
  /** Hover micro-interaction tier for cards, stats, testimonials */
  hoverStyle?: 'none' | 'subtle' | 'lift' | 'glow' | 'tilt';
  /** Which generation mode produced this microsite */
  generationMode?: 'pro' | 'classic' | 'v2';
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
