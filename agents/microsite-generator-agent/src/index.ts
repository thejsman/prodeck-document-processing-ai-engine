/**
 * microsite-generator-agent
 *
 * Converts proposal markdown into a high-end presentation microsite.
 *
 * Three-pass AI pipeline:
 *   Pass 0: Section planning — LLM determines optimal section sequence (may add sections)
 *   Pass 1: Brief extraction — structured JSON from full proposal
 *   Pass 2: Section formatting — parallel AI calls per planned section type
 *
 * Returns:
 *   - markdown: rewritten presentation copy (backward compat)
 *   - json: LayoutAST for the new structured renderer
 *   - assets: saved file paths
 */

import type { Agent, AgentInput, AgentOutput, ToolRegistry } from '@ai-engine/core';

// ── Section type classification (mirrors UI types) ───────────────────────────

type SectionType =
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

function classifySection(heading: string): SectionType {
  const h = heading.toLowerCase();
  if (/executive\s*summary|overview/.test(h)) return 'hero';
  if (/\bproblem\b/.test(h) && !/challenge/.test(h)) return 'problem';
  if (/challenge/.test(h)) return 'challenge';
  if (/approach|solution|method|proposed/.test(h)) return 'approach';
  if (/deliverable|scope/.test(h)) return 'deliverables';
  if (/timeline|schedule|phase|implementation|plan/.test(h)) return 'timeline';
  if (/invest|pric|cost|commercial/.test(h)) return 'pricing';
  if (/why|about\s*us|credential|team|experience/.test(h)) return 'whyus';
  if (/next|step|start|action/.test(h)) return 'nextsteps';
  if (/testimonial|review|client\s*said|what.*say/.test(h)) return 'testimonials';
  if (/showcase|feature|highlight|case\s*study/.test(h)) return 'showcase';
  if (/benefit|value\s*prop|advantage|outcome/.test(h)) return 'benefits';
  if (/stat|metric|number|impact|result/.test(h)) return 'stats';
  return 'generic';
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Plugin character map (mirrors pluginRegistry.ts in UI) ───────────────────

const PLUGIN_CHARACTER: Record<string, string> = {
  obsidian: 'WSJ meets Bottega Veneta — dark, luxurious, editorial. Prose is refined and sparse.',
  ivory:    'The Economist meets Kinfolk — light, authoritative, precise. Confident ink-black clarity.',
  cobalt:   'Bloomberg meets McKinsey — executive, data-driven, commanding. No softening language.',
  sage:     'Patagonia meets IDEO — warm, human, design-thinking. Mission-led and grounded.',
};

// ── Design system synthesis prompt (Pass -1) ─────────────────────────────────

export function buildDesignSystemPrompt(brandLanguagePrompt: string, basePlugin: string, brandPrimaryColor?: string, hasImage = false): string {
  const baseCharacter = PLUGIN_CHARACTER[basePlugin] ?? '';
  const brandColorHint = brandPrimaryColor
    ? `\nBRAND ACCENT COLOR (reference only — do not copy blindly, synthesize from brief): ${brandPrimaryColor}`
    : '';
  const imageNote = hasImage
    ? `\nAN INSPIRATION IMAGE has been provided. Infer and populate ALL of the following from it:
- Layout density (tight/spacious)
- Typography style (modern/editorial/bold/minimal)
- Color behavior (muted/vibrant/monochrome)
- Component styling (sharp/rounded/glassy/flat)
- Visual hierarchy (typography-first, image-first, data-first, symmetric)
- LAYOUT PATTERNS — critical for section variant selection:
  * heroLayout: describe the hero structure ("centered", "split-image-right", "split-image-left", "minimal", "full-bleed", "asymmetric")
  * sectionLayouts: list 3-5 layout patterns observed across sections in order ("card-grid", "editorial", "split", "asymmetric", "minimal", "centered")
  * spacingStyle: "tight" | "balanced" | "generous"
  * visualHierarchy: "typography-first" | "image-first" | "data-first" | "symmetric"`
    : '';

  return `You are a senior product designer and design system expert.

Your task is to synthesize a COMPLETE design system from:
1. Base theme: "${basePlugin}" (character: ${baseCharacter})
2. User design prompt (HIGH PRIORITY — overrides theme where it conflicts)
3. ${hasImage ? 'Inspiration image (provided above)' : 'No inspiration image'}
${brandColorHint}${imageNote}

IMPORTANT BEHAVIOR:
- The user prompt has HIGH priority over theme
- The theme is a base, not a restriction
- If the user provides strong visual direction, you MUST reflect it clearly
- Avoid safe or generic design — produce a distinct design personality
- NEVER ignore explicit instructions like "no CTA", "bold hero", "editorial layout", "sharp corners"

DENSITY RULES:
- compact: tight spacing, dense information, small gaps
- comfortable: balanced (default)
- spacious: generous padding, breathing room, editorial

BORDER RADIUS RULES (for cards/components):
- "0px" = sharp/architectural/geometric
- "4px" = minimal
- "8px" = subtle (default dark themes)
- "12px" = moderate
- "16px" = generous (default light/warm themes)
- "24px"+ = very rounded / friendly

BUTTON STYLE:
- "sharp" = zero radius, solid fill, architectural
- "rounded" = 6-8px radius, standard
- "pill" = fully rounded, approachable

HERO WEIGHT rules: 300 (thin/editorial), 400 (regular), 600 (semibold), 700 (bold), 800 (extrabold), 900 (black/monumental)

FONT RULES: heroFont and bodyFont MUST be real Google Fonts.
- dark/editorial: Cormorant Garamond, Playfair Display, DM Serif Display, Libre Baskerville
- modern/bold: Syne, Space Grotesk, DM Sans, Inter, Outfit
- warm/humanist: Fraunces, Lora, Nunito Sans, Source Serif 4
- technical/data: IBM Plex Sans, Roboto Mono, JetBrains Mono

USER BRAND BRIEF:
${brandLanguagePrompt}

EXTRACTION RULES (beyond design tokens):

SECTION RULES — if user specifies what a section should contain or how it should behave, extract into sectionRules:
- "fields": array of UI elements the user wants (e.g. ["eyebrow","heading","subheading","backgroundImage","cta1"])
- "ctaTarget": section type the primary CTA scrolls to (e.g. "pricing", "nextsteps") — ONLY if user said "CTA scrolls to X" or "button links to X"
- "ctaSecondaryTarget": same for secondary CTA
- "alignment": "centered | left-aligned | right-aligned | asymmetric"
- "ctaCount": number of CTAs (0, 1, 2)
Valid field tokens: eyebrow, heading, subheading, body, backgroundImage, image, cta1, cta2, pullquote, stats, list, diagram

COLOR OVERRIDES — if user provides explicit hex color codes (#xxxxxx), map them:
- "accent: #hex" or "primary: #hex" → colorOverrides.accent
- "background: #hex" or "bg: #hex" → colorOverrides.bg
- "text: #hex" → colorOverrides.text
- Bare hex with no label → colorOverrides.accent

TOKEN OVERRIDES — if user specifies explicit design token values:
- "border-radius: Xpx", "rounded corners Xpx" → tokenOverrides.borderRadius
- "hero font size: Xpx", "headline size: Xpx" → tokenOverrides.heroFontSize
- "body font size: Xpx" → tokenOverrides.bodyFontSize
- "section padding: Xpx" or "spacing: X" → tokenOverrides.sectionPadding
If not specified, return empty objects {}.

Return ONLY valid JSON. No markdown, no explanation, no code fences.

{
  "visualStyle": "8-20 word description of the visual personality",
  "density": "compact | comfortable | spacious",
  "typography": {
    "style": "editorial serif | geometric sans | humanist | monumental | technical",
    "headingWeight": "300–900",
    "scale": "dramatic | moderate | tight"
  },
  "colorStrategy": {
    "type": "duotone | monochrome | vibrant | muted | high-contrast",
    "contrast": "extreme | high | moderate",
    "accentUsage": "sparingly | moderate | dominant"
  },
  "layoutStyle": {
    "alignment": "left-aligned | centered | asymmetric",
    "heroStyle": "full-bleed | split | minimal | type-forward",
    "sectionFlow": "editorial-breaks | continuous | card-grid"
  },
  "componentStyle": {
    "button": "sharp rectangular | rounded | pill | ghost | text-link",
    "card": "flat | elevated | bordered | glassmorphic | borderless",
    "borderRadius": "0px | 4px | 8px | 12px | 16px | 24px",
    "shadow": "none | subtle | strong | colored"
  },
  "behavior": {
    "motion": "instant | deliberate | expressive",
    "parallax": false,
    "scrollEffects": "none | fade-in | slide-up"
  },
  "customCharacter": "brand voice, 8-20 words, X meets Y format",
  "bg": "#hex",
  "text": "#hex",
  "accent": "#hex",
  "heroFont": "Google Font name",
  "bodyFont": "Google Font name",
  "heroWeight": 700,
  "heroStyle": "normal | italic",
  "labelTracking": "0.10em – 0.22em",
  "dark": true,
  "noiseOpacity": 0.025,
  "borderRadius": "0px | 4px | 8px | 12px | 16px | 24px",
  "buttonStyle": "sharp | rounded | pill",
  "layoutPatterns": {
    "heroLayout": "centered | split-image-right | split-image-left | minimal | full-bleed | asymmetric — from image or design intent",
    "sectionLayouts": ["card-grid", "editorial", "split", "centered"],
    "spacingStyle": "tight | balanced | generous",
    "visualHierarchy": "typography-first | image-first | data-first | symmetric"
  },
  "sectionRules": {
    "hero": { "fields": ["eyebrow","heading","subheading","backgroundImage","cta1"], "ctaTarget": "pricing", "ctaSecondaryTarget": null, "alignment": "centered", "ctaCount": 1 },
    "nextsteps": { "fields": ["heading","subheading","body","cta1","cta2"], "ctaTarget": null, "ctaSecondaryTarget": null, "alignment": "centered", "ctaCount": 2 }
  },
  "colorOverrides": { "bg": null, "text": null, "accent": null },
  "tokenOverrides": { "borderRadius": null, "heroFontSize": null, "bodyFontSize": null, "sectionPadding": null }
}`;
}

/** Build Google Fonts URLs for heroFont and bodyFont from raw LLM token fields */
export function buildFontUrls(rawTokens: Record<string, unknown>): { family: string; url: string }[] {
  const fonts: { family: string; url: string }[] = [];
  for (const key of ['heroFont', 'bodyFont'] as const) {
    const family = rawTokens[key];
    if (typeof family === 'string' && family.trim()) {
      const encoded = encodeURIComponent(family.trim()).replace(/%20/g, '+');
      fonts.push({
        family: family.trim(),
        url: `https://fonts.googleapis.com/css2?family=${encoded}:wght@300;400;500;600;700;800&display=swap`,
      });
    }
  }
  return fonts;
}

// ── Section plan prompt (Pass 0) ─────────────────────────────────────────────

function buildSectionPlanPrompt(markdown: string, plugin?: string, characterOverride?: string, customInstructions?: string): string {
  const character = characterOverride ?? (plugin ? PLUGIN_CHARACTER[plugin] : undefined);
  const styleHint = character ? `\nDESIGN VOICE: "${plugin}" theme — ${character}\n` : '';
  const userInstructions = customInstructions?.trim()
    ? `\n── USER INSTRUCTIONS (HIGHEST PRIORITY — read before doing anything else) ──\n${customInstructions.trim()}\n─────────────────────────────────────────────────────────────────────────────\n`
    : '';

  return `You are a senior proposal strategist and UX director.
${styleHint}${userInstructions}
## YOUR JOB

Read the proposal markdown and decide the optimal section sequence for a presentation microsite.

## STEP 1 — DETECT USER INTENT

If USER INSTRUCTIONS are present above, parse them for explicit directives FIRST:

- Section list specified? ("sections: hero, about, pricing" or "create these sections: ...") → use EXACTLY those types in EXACTLY that order
- Section count specified? ("create 10 sections", "I want 6 sections") → honour that count precisely
- Section removal? ("no CTA", "remove next steps", "skip testimonials") → remove those sections
- Section addition? ("add testimonials", "include a stats section") → add them regardless of content heuristics

USER INSTRUCTIONS OVERRIDE ALL DEFAULT RULES BELOW. Do not normalise or "improve" the user's structure.

## STEP 2 — DEFAULT CONTENT-DRIVEN PLANNING (only when user has NOT specified structure)

If no explicit structure was given, derive sections from content:

- Map each source heading to the best matching type
- Insert AI-generated sections ONLY when they meaningfully improve the narrative (do not add them mechanically):
  * "testimonials" — client names, outcomes, or case study language present
  * "stats" — numbers/metrics scattered across multiple sections worth consolidating
  * "benefits" — value propositions scattered that would land better as a focused icon list
  * "showcase" — feature lists or product descriptions worth visual spotlight treatment
  * "problem" — challenge section is generic and needs sharper reframing
- Aim for 8–12 sections; quality over quantity — do NOT pad with weak sections to hit a number
- hero always first; nextsteps last or second-to-last
- No duplicate types unless content genuinely requires it

## CONSTRAINTS TO EXTRACT

After deciding sections, fill in the constraints object:
- noCTAInHero: true if user said "no CTA", "remove CTA", "no buttons in hero", "skip CTA in hero", etc.
- noCTAEverywhere: true if user said "no CTA anywhere", "remove all CTAs", "no buttons at all", "no calls to action", etc.
- requestedSectionCount: the number if user explicitly stated a count ("10 sections", "6 sections"), otherwise null
- hasCustomStructure: true if user specified section names/order explicitly
- motion: "expressive" if user said "add motion", "animate", "transitions", "dynamic"; "deliberate" if "subtle motion", "gentle animation"; "instant" if "no animation", "static", "no transitions"; null if unspecified
- parallax: true if user said "parallax", "depth", "parallax hero", "scroll parallax"; false otherwise
- scrollEffects: "slide-up" if user said "slide in", "slide up", "entrance animation"; "fade-in" if user said "fade", "fade in"; "none" if not specified or user said "no effects"

## VALID TYPES

hero, challenge, approach, deliverables, timeline, pricing, whyus, nextsteps, testimonials, showcase, benefits, problem, stats, generic

## OUTPUT FORMAT

Return ONLY valid JSON. No markdown, no explanation, no code fences.

{
  "sections": [
    { "type": "hero", "sourceHeading": "Executive Summary", "rationale": "Maps directly", "aiGenerated": false },
    { "type": "stats", "sourceHeading": null, "rationale": "3 strong metrics buried in approach section", "aiGenerated": true }
  ],
  "constraints": {
    "noCTAInHero": false,
    "noCTAEverywhere": false,
    "requestedSectionCount": null,
    "hasCustomStructure": false,
    "motion": null,
    "parallax": false,
    "scrollEffects": null
  }
}

PROPOSAL:
${markdown.slice(0, 8000)}`;
}

// ── Brief extraction prompt ──────────────────────────────────────────────────

function buildBriefPrompt(markdown: string, brandHint?: { companyName?: string; tagline?: string }, plugin?: string, customInstructions?: string, characterOverride?: string): string {
  const hint = brandHint?.companyName
    ? `\nIMPORTANT: The proposing company is "${brandHint.companyName}"${brandHint.tagline ? ` (tagline: "${brandHint.tagline}")` : ''}. Use this exact name for "proposingCompany" and in all generated copy.\n`
    : '';
  const character = characterOverride ?? (plugin ? PLUGIN_CHARACTER[plugin] : undefined);
  const styleHint = character ? `\nDESIGN VOICE: This microsite uses a "${plugin}" theme (${character}). Let this shape the heroNarrative tone and primaryTone selection.\n` : '';
  const customHint = customInstructions ? `\nCUSTOM INSTRUCTIONS (user-specified — follow these closely when extracting the brief):\n${customInstructions}\n` : '';
  return `You are a senior proposal strategist. Extract a structured brief from this proposal. Return ONLY valid JSON. No markdown, no explanation, no code fences.
${hint}${styleHint}${customHint}
Extract this proposal into a brief:

${markdown}

Return exactly this JSON:
{
  "clientName": "string",
  "clientIndustry": "string",
  "clientChallenge": "1 sentence",
  "proposingCompany": "string — use the brand name if provided above",
  "proposingStrength": "most impressive credential, 1 sentence",
  "engagementSummary": "2 sentences max",
  "keyOutcomes": ["max 4 items"],
  "totalValue": "string",
  "duration": "string",
  "primaryTone": "authoritative or consultative or innovative or warm",
  "heroNarrative": "THE most compelling idea, 8-12 words, never starts with We/Our, present tense",
  "industryKeywords": ["3-5 keywords for image searches"]
}`;
}

// ── Section formatting prompts ───────────────────────────────────────────────

const FORBIDDEN = 'FORBIDDEN WORDS: leverage, synergy, cutting-edge, robust, seamlessly, empower, innovative solutions, transformative, holistic, best-in-class, world-class, next-level, game-changing.';
const FORBIDDEN_OPENERS = 'NEVER start a headline or sentence with: "In today\'s", "We are", "Our team", "We offer", "With our", "As a leading", "We are proud", "We believe", "Welcome to", "Introducing".';

const TONE_GUIDE: Record<string, string> = {
  authoritative: 'Short declarative sentences, no hedging, no exclamation marks. Reads like The Economist.',
  consultative: 'Collaborative language, "together", inclusive framing.',
  innovative: 'Forward-looking, energetic but precise. Avoid startup cliches.',
  warm: 'Human, direct, personal without being casual.',
};

const NARRATIVE_ANGLES = [
  'Frame everything from the cost of inaction — what does the client lose by not acting?',
  'Lead with outcomes first, process second. Every headline names a concrete result.',
  'Write from the client\'s perspective — their goals, their wins, their transformation.',
  'Use contrast and tension: before vs after, problem vs resolution, risk vs confidence.',
  'Open each section with the single most surprising or counterintuitive insight.',
  'Ground every claim in specificity — numbers, timelines, named deliverables, not vague promises.',
  'Write as if you are the client\'s most trusted advisor speaking candidly in a boardroom.',
  'Lead with momentum — every headline implies forward motion, progress, arrival.',
];

function pickAngle(): string {
  return NARRATIVE_ANGLES[Math.floor(Math.random() * NARRATIVE_ANGLES.length)];
}

// ── Variant pools — fallback when no intent is detected (randomness preserved) ─

const VARIANT_POOLS: Record<SectionType, string[]> = {
  // centered excluded from hero fallback pool — it is only allowed for minimal/clean intent
  hero:         ['split',       'type-forward', 'editorial',  'asymmetric'],
  challenge:    ['asymmetric',  'editorial',  'split',        'centered'],
  approach:     ['card-grid',   'split',      'asymmetric',   'editorial'],
  deliverables: ['card-grid',   'split',      'minimal'],
  timeline:     ['editorial',   'minimal',    'centered'],
  pricing:      ['centered',    'split',      'minimal'],
  whyus:        ['split',       'asymmetric', 'centered'],
  nextsteps:    ['centered',    'minimal',    'split'],
  testimonials: ['centered',    'editorial',  'card-grid'],
  showcase:     ['split',       'asymmetric', 'centered'],
  benefits:     ['card-grid',   'split',      'minimal'],
  problem:      ['asymmetric',  'editorial',  'centered'],
  stats:        ['centered',    'minimal',    'editorial'],
  generic:      ['centered',    'split',      'minimal'],
};

/** Random fallback — used only when no intent is detected. */
function pickVariant(type: SectionType): string {
  const pool = VARIANT_POOLS[type];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Intent-driven variant families ────────────────────────────────────────────
// Deterministic: same intent + same section type → same variant, every time.
// Each family alternates between 2 complementary variants for variety without chaos.

/** editorial intent: typography-first, generous whitespace.
 *  Alternates editorial ↔ minimal to avoid monotony. */
const EDITORIAL_VARIANTS: Record<SectionType, string> = {
  hero:         'editorial',
  challenge:    'editorial',
  approach:     'editorial',
  deliverables: 'minimal',
  timeline:     'editorial',
  pricing:      'minimal',
  whyus:        'editorial',
  nextsteps:    'minimal',
  testimonials: 'centered',
  showcase:     'editorial',
  benefits:     'minimal',
  problem:      'editorial',
  stats:        'centered',
  generic:      'editorial',
};

/** minimal intent: stripped, single-focus, clean.
 *  Alternates minimal ↔ centered for variety. */
const MINIMAL_VARIANTS: Record<SectionType, string> = {
  hero:         'centered',
  challenge:    'minimal',
  approach:     'minimal',
  deliverables: 'minimal',
  timeline:     'minimal',
  pricing:      'centered',
  whyus:        'minimal',
  nextsteps:    'centered',
  testimonials: 'minimal',
  showcase:     'minimal',
  benefits:     'minimal',
  problem:      'centered',
  stats:        'minimal',
  generic:      'minimal',
};

/** bold / high-contrast intent: dominant visuals, off-center composition.
 *  Alternates split ↔ asymmetric ↔ card-grid.
 *  Stats and pricing always stay centered — their information architecture
 *  requires symmetry regardless of visual intent. */
const BOLD_VARIANTS: Record<SectionType, string> = {
  hero:         'split',
  challenge:    'asymmetric',
  approach:     'split',
  deliverables: 'card-grid',
  timeline:     'split',
  pricing:      'centered',
  whyus:        'asymmetric',
  nextsteps:    'split',
  testimonials: 'card-grid',
  showcase:     'asymmetric',
  benefits:     'card-grid',
  problem:      'asymmetric',
  stats:        'centered',
  generic:      'split',
};

/**
 * Resolve the layout variant for a section.
 *
 * Priority (highest → lowest):
 *   1. editorial intent → EDITORIAL_VARIANTS[type]  (deterministic)
 *   2. minimal intent   → MINIMAL_VARIANTS[type]    (deterministic)
 *   3. bold intent      → BOLD_VARIANTS[type]        (deterministic)
 *   4. no strong intent → pickVariant(type)          (random from pool)
 *
 * Multiple intents: editorial wins over minimal; both win over bold.
 */
function resolveVariant(
  type: SectionType,
  isEditorial: boolean,
  isMinimal: boolean,
  isBold: boolean,
): string {
  if (isEditorial) return EDITORIAL_VARIANTS[type];
  if (isMinimal)   return MINIMAL_VARIANTS[type];
  if (isBold)      return BOLD_VARIANTS[type];
  return pickVariant(type);
}

/**
 * Hero-specific variant resolver.
 *
 * Priority (highest → lowest):
 *   1. explicit user intent (editorial, bold, premium, high-contrast)
 *   2. image layoutPatterns.heroLayout
 *   3. non-centered fallback pool (centered NEVER chosen unless minimal/clean)
 *
 * "centered" is only returned when minimal or clean intent is explicitly requested.
 */
function resolveHeroVariant(
  ci: string,
  isEditorial: boolean,
  isMinimal: boolean,
  isBold: boolean,
  layoutPatterns: Record<string, unknown> | undefined,
): string {
  const ciLower = ci.toLowerCase();

  // Detect extended intent signals not in the standard flags
  const isPremium      = /\bpremium\b|\bluxury\b|\bhigh[- ]end\b|\bprestige\b/i.test(ciLower);
  const isHighContrast = /\bhigh[- ]contrast\b|\bstrong\s+contrast\b/i.test(ciLower);
  const isClean        = /\bclean\b|\bsimple\b|\bminimalist\b/i.test(ciLower);

  // Priority 1: explicit intent
  if (isEditorial)                      return 'editorial';
  if (isHighContrast || isPremium)      return 'asymmetric';
  if (isBold)                           return 'split';
  if (isMinimal || isClean)             return 'centered';   // only valid centered path

  // Priority 2: image-derived layout pattern
  if (layoutPatterns) {
    const heroLayout = typeof layoutPatterns.heroLayout === 'string' ? layoutPatterns.heroLayout : '';
    const normalized = heroLayout ? normalizeImageLayout(heroLayout) : null;
    if (normalized && normalized !== 'centered') return normalized;
    // Allow centered from image only if explicit "minimal" or "centered" keyword in heroLayout
    if (normalized === 'centered' && /\bcentered\b|\bminimal\b/i.test(heroLayout)) return 'centered';
  }

  // Priority 3: non-centered fallback
  return pickVariant('hero');   // pool excludes centered
}

/**
 * Pre-assign layout variants for ALL sections before parallel LLM generation.
 * Runs sequentially (lightweight — no I/O) so we can enforce no-adjacent-repeat.
 * Returns an array of variant strings, one per section, in order.
 */
function preassignVariants(
  sections: Array<{ type: SectionType }>,
  isEditorial: boolean,
  isMinimal: boolean,
  isBold: boolean,
  layoutPatterns: Record<string, unknown> | undefined,
  customInstructions: string,
): string[] {
  const variants: string[] = [];
  const hasUserIntent = isEditorial || isMinimal || isBold;

  for (let i = 0; i < sections.length; i++) {
    const rawType = sections[i].type;
    // Guard: LLM may return a type not in VARIANT_POOLS — fall back to 'generic'
    const type: SectionType = (rawType in VARIANT_POOLS) ? rawType : 'generic';
    const prev = variants[i - 1];

    if (type === 'hero') {
      variants.push(resolveHeroVariant(customInstructions, isEditorial, isMinimal, isBold, layoutPatterns));
      continue;
    }

    if (hasUserIntent) {
      // Intent-driven: deterministic but check adjacent repeat
      let v = resolveVariant(type, isEditorial, isMinimal, isBold);
      if (v === prev) {
        // Pick the next option from the pool that isn't prev
        const pool = VARIANT_POOLS[type].filter(x => x !== prev);
        v = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : v;
      }
      variants.push(v);
      continue;
    }

    // Image patterns or random — exclude previous variant for variety
    const fromImage = resolveVariantFromLayoutPatterns(type, layoutPatterns, i);
    if (fromImage && fromImage !== prev) {
      variants.push(fromImage);
      continue;
    }

    // Random from pool, excluding previous variant
    const pool = VARIANT_POOLS[type].filter(x => x !== prev);
    const pick = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : VARIANT_POOLS[type][0];
    variants.push(pick);
  }

  return variants;
}

// ── Image-derived layout pattern helpers ──────────────────────────────────────

/** Map a raw image-layout description to one of our supported variant names. */
function normalizeImageLayout(raw: string): string {
  const s = raw.toLowerCase().trim();
  if (s.includes('card') || s.includes('grid')) return 'card-grid';
  if (s.includes('editorial') || s.includes('full-width') || s.includes('type-forward')) return 'editorial';
  if (s.includes('split')) return 'split';
  if (s.includes('asymmetric') || s.includes('offset')) return 'asymmetric';
  if (s.includes('minimal') || s.includes('stripped')) return 'minimal';
  return 'centered';
}

/**
 * Derive a variant from image-extracted layoutPatterns.
 * Returns null when no useful signal is available.
 *
 * - hero sections use `heroLayout` directly
 * - all other sections cycle through `sectionLayouts[]`
 */
function resolveVariantFromLayoutPatterns(
  type: SectionType,
  layoutPatterns: Record<string, unknown> | undefined,
  sectionIndex: number,
): string | null {
  if (!layoutPatterns) return null;

  if (type === 'hero') {
    const heroLayout = typeof layoutPatterns.heroLayout === 'string' ? layoutPatterns.heroLayout : '';
    return heroLayout ? normalizeImageLayout(heroLayout) : null;
  }

  const rawLayouts = Array.isArray(layoutPatterns.sectionLayouts) ? layoutPatterns.sectionLayouts : [];
  if (rawLayouts.length === 0) return null;

  // Cycle through the inferred section layouts (hero is index 0 — offset by 1 for non-hero)
  const cycleIdx = Math.max(0, sectionIndex - 1);
  const raw = String(rawLayouts[cycleIdx % rawLayouts.length] ?? '');
  return raw ? normalizeImageLayout(raw) : null;
}

/**
 * Derive a concrete mediaPosition hint from layout patterns.
 * Returns undefined when no signal is found.
 */
function deriveMediaPositionHint(
  layoutPatterns: Record<string, unknown> | undefined,
  resolvedVariant: string,
): string | undefined {
  if (!layoutPatterns) return undefined;
  const heroLayout = typeof layoutPatterns.heroLayout === 'string' ? layoutPatterns.heroLayout.toLowerCase() : '';
  const hierarchy = typeof layoutPatterns.visualHierarchy === 'string' ? layoutPatterns.visualHierarchy.toLowerCase() : '';

  if (resolvedVariant === 'split') {
    if (heroLayout.includes('image-left') || heroLayout.includes('left')) return 'left';
    if (heroLayout.includes('image-right') || heroLayout.includes('right')) return 'right';
    return 'right'; // sensible default for split
  }
  if (hierarchy.includes('image-first')) return 'background';
  if (hierarchy.includes('typography-first') || hierarchy.includes('data-first')) return 'none';
  return undefined;
}

// ── Structure enforcement (per-variant content shape rules) ──────────────────
// Injected into the system prompt so the LLM treats them as hard constraints,
// not style suggestions. Rules govern: array sizes, prose length, image usage.

function buildStructureEnforcement(variant: string, mediaPositionHint?: string): string {
  const mediaSuffix = mediaPositionHint
    ? `\n- ui.mediaPosition MUST be "${mediaPositionHint}".`
    : '';

  switch (variant) {
    case 'card-grid':
      return `\n\n━━ STRUCTURE ENFORCEMENT — card-grid ━━ MANDATORY — DO NOT DEVIATE
- Arrays (items, pillars, stats, highlights, etc.): MUST contain 4–6 entries.
- Each entry: title/name 2–5 words + description exactly 1–2 sentences, specific and concrete.
- body field: 1–2 sentences MAX — the grid carries the content, not the prose.
- NEVER write long-form body paragraphs for this variant.
- NEVER produce a single-entry array.
- diagram: null — card grids do not use flow diagrams.${mediaSuffix}`;

    case 'editorial':
      return `\n\n━━ STRUCTURE ENFORCEMENT — editorial ━━ MANDATORY — DO NOT DEVIATE
- Arrays (items, pillars, etc.): 2–3 entries MAX. Fewer, richer items.
- Each item description: 2–3 sentences, substantive and layered — depth over breadth.
- body field: 3–4 sentences — prose is the primary visual element, not decoration.
- headline: 10–16 words — typographic dominance, considered rhythm.
- subheadline (if present): 1–2 complete sentences. No fragments.
- NEVER produce icon grids or decorative arrays with more than 3 items.${mediaSuffix}`;

    case 'split':
      return `\n\n━━ STRUCTURE ENFORCEMENT — split ━━ MANDATORY — DO NOT DEVIATE
- imageQuery: MUST be vivid, specific, and scene-driven — e.g. "minimal office side-light monochrome" not "business people smiling". The image occupies 45% of the layout.
- body: 2–4 balanced sentences — neither sparse nor overloaded.
- headline: 8–12 words, confident and clear.
- Arrays: 3–5 items max. Do not overload the text panel.${mediaSuffix}`;

    case 'asymmetric':
      return `\n\n━━ STRUCTURE ENFORCEMENT — asymmetric ━━ MANDATORY — DO NOT DEVIATE
- headline: 6–10 words MAX — short, high-impact, compositionally dominant.
- body: exactly 2–3 sentences. Supports the headline; does not compete.
- Arrays: 3–4 items MAX; labels 2–4 words only — no long descriptions.
- imageQuery: dramatic and specific — image fills ~40% of the layout.${mediaSuffix}`;

    case 'minimal':
      return `\n\n━━ STRUCTURE ENFORCEMENT — minimal ━━ MANDATORY — DO NOT DEVIATE
- headline: 6–10 words MAX.
- body: 1–2 sentences ABSOLUTE MAX. Every word earns its place.
- Arrays: 2–3 items MAX. If not essential, omit them entirely.
- diagram: MUST be null.
- imageQuery: null or a single-word keyword. The layout breathes.
- NEVER add decorative or optional fields.${mediaSuffix}`;

    case 'centered':
      return `\n\n━━ STRUCTURE ENFORCEMENT — centered ━━ MANDATORY — DO NOT DEVIATE
- headline: 8–14 words, self-contained and compelling.
- body: 2–3 sentences, balanced — not sparse, not overloaded.
- Arrays: 3–5 items where the section type requires them.${mediaSuffix}`;

    case 'type-forward':
      return `\n\n━━ STRUCTURE ENFORCEMENT — type-forward ━━ MANDATORY — DO NOT DEVIATE
- headline: 12–18 words — the single most powerful statement in the section. Typography IS the layout.
- body: 1–2 sentences ONLY.
- Arrays: omit unless essential; 2–3 items max.
- imageQuery: null — no media.${mediaSuffix}`;

    default:
      return '';
  }
}

// ── Layout commitment block ────────────────────────────────────────────────────
// Forces the LLM to acknowledge the layout contract before generating content.

function buildLayoutCommitment(variant: string, mediaPositionHint?: string): string {
  // Derive a concrete mediaPosition value — no ambiguous menus here
  const mediaPosition = mediaPositionHint ?? (
    variant === 'split'                              ? 'right'      :
    variant === 'asymmetric'                         ? 'background' :
    variant === 'card-grid' || variant === 'minimal' ? 'none'       :
    variant === 'type-forward'                       ? 'none'       :
    'background'
  );
  return `\n\n━━ LAYOUT COMMITMENT ━━ MANDATORY — READ THIS BEFORE GENERATING ANYTHING
Selected Variant: ${variant}
Layout Type: ${variant}
Media Position: ${mediaPosition}

YOU MUST:
- Commit to this layout fully before generating a single field.
- Align ALL content structure, length, and formatting with "${variant}".
- Output ui.layout as "${variant}" and ui.mediaPosition as "${mediaPosition}".
- NOT fall back to a centered or generic layout.
- NOT mix multiple layout styles in this section.
- NOT ignore or reinterpret this selection.

If your output structure does not match "${variant}", it is INVALID and will be rejected.`;
}

// ── Negative examples (variant-specific bad behaviors) ────────────────────────

function buildNegativeExamples(variant: string): string {
  const specific: Record<string, string> = {
    'card-grid':  '- Writing a 3+ sentence body paragraph instead of populating the items/pillars array.\n- Producing fewer than 4 entries in the items array.\n- Including a diagram field (must be null).',
    'editorial':  '- Producing 5+ item arrays instead of 2–3 rich, long-form items.\n- Writing a short 1-sentence body instead of 3–4 sentences of substantive prose.\n- Using icon grids or decorative component arrays.',
    'split':      '- Using a vague imageQuery like "business people smiling" or "team meeting".\n- Setting mediaPosition to "none" or "background" when split requires "left" or "right".\n- Writing an imbalanced body (either too sparse or wall-of-text).',
    'asymmetric': '- Writing a 15+ word headline when 6–10 words are required.\n- Producing a long item list instead of a focused, short set (max 4).\n- Setting mediaPosition to "none" — asymmetric requires a background image.',
    'minimal':    '- Writing 4+ body sentences.\n- Including a diagram (must be null).\n- Producing arrays with 4+ items.',
    'centered':   '- Setting mediaPosition to "left" or "right" — centered has no split media.\n- Overloading with 6+ items in arrays.',
    'type-forward': '- Setting imageQuery to anything other than null.\n- Writing a headline shorter than 12 words.\n- Populating arrays with more than 2–3 items.',
  };
  const variantRules = specific[variant] ? specific[variant] + '\n' : '';
  return `\n\nINVALID BEHAVIOR — outputs matching any of these will be REJECTED:
${variantRules}- Outputting a "variant" field value other than "${variant}".
- Reverting to centered or generic layout when variant is ${variant}.`;
}

// Tail appended to every section JSON schema (variant + ui + behavior).
// variant value is LOCKED — no "stay within" text in the output field (that confuses the LLM).
function sectionMetaSchema(suggestedVariant: string, showCTA: boolean, _intentFamily: string): string {
  return `  "variant": "${suggestedVariant}",
  "ui": {
    "showCTA": ${showCTA},
    "layout": "${suggestedVariant}",
    "mediaPosition": "background | left | right | inline | none — match the structure enforcement above"
  },
  "behavior": {
    "hasParallax": false,
    "animation": "fade-up | scale | none — editorial→fade-up, bold/asymmetric→scale, minimal→none"
  }`;
}

/**
 * Translate per-section design rules (extracted from the design brief by Pass -1)
 * into hard constraints injected into the Pass 2 section prompt.
 */
function buildSectionRulesContext(type: SectionType, rules: Record<string, unknown> | null | undefined): string {
  if (!rules) return '';
  const parts: string[] = [];

  // Fields constraint
  const fields = Array.isArray(rules.fields) ? (rules.fields as string[]) : null;
  if (fields && fields.length > 0) {
    parts.push(`FIELDS: Include ONLY these elements: ${fields.join(', ')}.`);
    const wantsEyebrow = fields.some(f => /eyebrow/i.test(f));
    const wantsSubhead = fields.some(f => /subhead|subtitle/i.test(f));
    const wantsImage   = fields.some(f => /image|background/i.test(f));
    if (!wantsEyebrow) parts.push('Set eyebrow to "".');
    if (!wantsSubhead) parts.push('Set subheadline to "".');
    if (!wantsImage)   parts.push('Set imageQuery to "" — no background image.');
    // Infer CTA count from field names like cta1, cta, cta2
    const ctaFields = fields.filter(f => /^cta\d?$/i.test(f));
    if (ctaFields.length === 0) parts.push('Set ctaPrimary and ctaSecondary to "". No CTA buttons.');
    else if (ctaFields.length === 1) parts.push('Set ctaSecondary to "". Only ONE CTA button allowed.');
    // Image aspect ratio hint if specified e.g. "image(16:9)"
    const imgField = fields.find(f => /image/i.test(f));
    const aspectMatch = imgField?.match(/\(([^)]+)\)/);
    if (aspectMatch) parts.push(`Image aspect ratio: ${aspectMatch[1]}.`);
  }

  // Explicit CTA count override (overrides field-derived count)
  const ctaCount = typeof rules.ctaCount === 'number' ? rules.ctaCount : null;
  if (ctaCount !== null) {
    if (ctaCount === 0) parts.push('Set ctaPrimary and ctaSecondary to "". No CTA buttons.');
    else if (ctaCount === 1) parts.push('Set ctaSecondary to "". Only ONE CTA button.');
  }

  // CTA scroll targets
  const ctaTarget = typeof rules.ctaTarget === 'string' && rules.ctaTarget ? rules.ctaTarget : null;
  if (ctaTarget) parts.push(`Set ctaTarget to "${ctaTarget}" — primary CTA scrolls to the ${ctaTarget} section.`);
  const ctaSecTarget = typeof rules.ctaSecondaryTarget === 'string' && rules.ctaSecondaryTarget ? rules.ctaSecondaryTarget : null;
  if (ctaSecTarget) parts.push(`Set ctaSecondaryTarget to "${ctaSecTarget}" — secondary CTA scrolls to the ${ctaSecTarget} section.`);

  // Alignment
  const alignment = typeof rules.alignment === 'string' ? rules.alignment : null;
  if (alignment) parts.push(`Set ui.layout to "${alignment}". This section must be ${alignment}.`);

  if (parts.length === 0) return '';
  return `\n\n━━ SECTION DESIGN RULES — ${type.toUpperCase()} (user-specified, NON-NEGOTIABLE) ━━\n${parts.map(p => `• ${p}`).join('\n')}`;
}

export function buildSectionPrompt(
  type: SectionType,
  heading: string,
  rawBody: string,
  brief: string,
  tone: string,
  brandName?: string,
  plugin?: string,
  aiGenerated = false,
  customInstructions = '',
  characterOverride?: string,
  layoutPatterns?: Record<string, unknown>,
  sectionIndex = 0,
  preassignedVariant?: string,
  sectionRules?: Record<string, unknown> | null,
): string {
  const toneGuide = TONE_GUIDE[tone] ?? TONE_GUIDE.authoritative;
  const brandCtx = brandName ? ` The proposing company is "${brandName}" — use this name consistently in copy.` : '';
  const character = characterOverride ?? (plugin ? PLUGIN_CHARACTER[plugin] : undefined);
  const pluginCtx = character ? ` DESIGN VOICE: ${character} — let this shape word choice, sentence rhythm, and emotional register.` : '';
  const angle = pickAngle();
  const generationNote = aiGenerated
    ? ' NOTE: This section has NO source content — generate it entirely from the proposal brief and context. Make it feel native and coherent, not bolted-on.'
    : '';

  // Detect constraints from customInstructions for strict enforcement
  const ci = customInstructions.toLowerCase();
  const noCTA       = /no\s*cta|remove\s*cta|no\s*(call[\s-]to[\s-]action|buttons?)|omit\s*cta/i.test(customInstructions);
  const isMinimal   = /\bminimal\b/i.test(ci);
  const isBold      = /\bbold\b/i.test(ci) && !/not\s*bold/i.test(ci);
  const isEditorial = /\beditorial\b/i.test(ci);

  const showCTA = !(noCTA && (type === 'hero' || type === 'nextsteps'));
  const intentFamily = isEditorial ? 'editorial' : isMinimal ? 'minimal' : isBold ? 'bold' : 'default';

  // Pre-assigned variant takes highest priority (computed before parallel generation to avoid adjacent-repeat)
  // For hero: resolveHeroVariant. For others: preassigned or computed.
  const hasUserIntent = isEditorial || isMinimal || isBold;
  const suggestedVariant: string = preassignedVariant
    ? preassignedVariant
    : type === 'hero'
      ? resolveHeroVariant(customInstructions, isEditorial, isMinimal, isBold, layoutPatterns)
      : hasUserIntent
        ? resolveVariant(type, isEditorial, isMinimal, isBold)
        : (resolveVariantFromLayoutPatterns(type, layoutPatterns, sectionIndex) ?? pickVariant(type));

  if (type === 'hero') {
    console.log('[Hero Variant Fix] Final hero variant:', suggestedVariant);
  }

  const mediaPositionHint = deriveMediaPositionHint(layoutPatterns, suggestedVariant);
  const spacingStyle = typeof layoutPatterns?.spacingStyle === 'string' ? layoutPatterns.spacingStyle : null;

  const constraintRules = [
    noCTA       ? 'CONSTRAINT — NO CTA: Set ctaPrimary and ctaSecondary to empty strings "". Do NOT include action buttons or links.' : '',
    isMinimal   ? 'CONSTRAINT — MINIMAL: Reduce all UI elements. Short copy only. No diagrams. No decorative components.' : '',
    isBold      ? 'CONSTRAINT — BOLD: Maximize visual hierarchy. Use short punchy headlines (4-8 words). Prioritize impact metrics.' : '',
    isEditorial ? 'CONSTRAINT — EDITORIAL: Prioritize typography and prose over UI components. No bullet lists. No icon grids.' : '',
  ].filter(Boolean).join(' ');

  const constraintCtx = constraintRules ? `\n\nSTRICT CONSTRAINTS — YOU MUST FOLLOW THESE EXACTLY:\n${constraintRules}` : '';
  const customCtx = customInstructions ? `\n\nCUSTOM INSTRUCTIONS (follow closely): ${customInstructions}` : '';

  const mediaPositionLine = mediaPositionHint
    ? `\nMEDIA POSITION (derived from design image): "${mediaPositionHint}" — use this value for the ui.mediaPosition field.`
    : '';
  const spacingLine = spacingStyle
    ? `\nSPACING STYLE (from design image): "${spacingStyle}" — let this shape field verbosity and component density.`
    : '';

  const variantGuidance = `\n\nLAYOUT VARIANT FOR THIS SECTION: "${suggestedVariant}"
ALIGNMENT RULES:
- centered: content centered, max-width container, symmetric layout
- split: 50/50 left-right, text one side, media/stats other side
- asymmetric: text 60%, accent element 40%, off-center composition
- editorial: full-width typography-first, generous whitespace, minimal components
- card-grid: items in a grid, equal weight, no dominant element
- minimal: stripped layout, single focus, no decorative elements
- type-forward: headline dominates, body minimal, no media
Choose mediaPosition to complement the variant: background image for hero/challenge, left/right for split, none for editorial/minimal.${mediaPositionLine}${spacingLine}`;

  const layoutCommitment = buildLayoutCommitment(suggestedVariant, mediaPositionHint);
  const structureEnforcement = buildStructureEnforcement(suggestedVariant, mediaPositionHint);
  const negativeExamples = buildNegativeExamples(suggestedVariant);
  const sectionRulesCtx = buildSectionRulesContext(type, sectionRules);

  const system = `You are a senior UX copywriter for B2B proposal microsites. Write with precision and confidence. No cliches. ${FORBIDDEN} ${FORBIDDEN_OPENERS} TONE: ${toneGuide}.${brandCtx}${pluginCtx}${generationNote}${constraintCtx}${customCtx}
CREATIVE ANGLE FOR THIS GENERATION: ${angle}${variantGuidance}${layoutCommitment}${structureEnforcement}${negativeExamples}${sectionRulesCtx}
MERMAID RULES: If you include a "diagram" field, the value must be raw Mermaid syntax as a single JSON string — NO backticks, escape newlines as \\n, max 5 nodes/tasks. If you cannot make a meaningful diagram from the content, set "diagram": null.
Return ONLY valid JSON. No markdown, no explanation, no code fences.
IMPORTANT: Every response MUST include "variant", "ui", and "behavior" fields exactly as shown in the schema below. The "variant" value is LOCKED to "${suggestedVariant}" — output it exactly.`;

  const meta = sectionMetaSchema(suggestedVariant, showCTA, intentFamily);

  const sectionPrompts: Record<SectionType, string> = {
    hero: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Hero section. Return:
{
  "eyebrow": "4-8 words, e.g. 'Proposal · March 2026'",
  "headline": "8-14 words, specific, compelling",
  "subheadline": "1-2 sentences, scope + promise, max 28 words",
  "body": "2-3 sentences, why now + why us, no buzzwords",
  "ctaPrimary": "3-5 words, action verb — empty string if constraints say no CTA",
  "ctaSecondary": "3-4 words, softer option — empty string if constraints say no CTA",
  "ctaTarget": "section type to scroll to on primary CTA tap — from SECTION DESIGN RULES if specified, else null",
  "ctaSecondaryTarget": "section type to scroll to on secondary CTA tap — from SECTION DESIGN RULES if specified, else null",
  "imageQuery": "Unsplash query: mood+subject+industry e.g. 'dramatic finance architecture dark minimal'",
  ${meta}
}`,

    challenge: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Challenge section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words, the core tension",
  "body": "2-3 sentences, real stakes, what if nothing changes",
  "pullquote": "sharpest insight, 10-18 words, standalone quote",
  "imageQuery": "Unsplash query",
  "diagram": "optional graph TD showing causal chain/impact cascade (max 4 nodes). Only include if content has a clear cause→effect chain. Otherwise null.",
  ${meta}
}`,

    approach: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into an Approach section with pillars. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "subheadline": "1-2 sentences",
  "pillars": [{"iconHint": "identity|digital|content|strategy|research|launch", "name": "2-4 words", "description": "2 sentences, specific outcomes"}],
  "imageQuery": "Unsplash query",
  "diagram": "graph LR showing the methodology as a process flow. Nodes = pillar names (2-3 words each). Max 5 nodes connected with -->. Example: graph LR\\n  A[Discover] --> B[Design] --> C[Build] --> D[Launch]. Always include this field.",
  ${meta}
}`,

    deliverables: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Deliverables section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "items": [{"iconHint": "identity|document|website|content|photo|campaign|strategy", "name": "2-5 words", "detail": "1 sentence, what it enables"}],
  "imageQuery": "Unsplash query",
  ${meta}
}`,

    timeline: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Timeline section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "subheadline": "1-2 sentences",
  "phases": [{"label": "from raw data", "duration": "e.g. 2 weeks", "name": "2-4 words", "description": "1 sentence, activity + outcome"}],
  "imageQuery": "Unsplash query",
  "diagram": "gantt chart. Format: gantt\\n  title Project Schedule\\n  dateFormat YYYY-MM-DD\\n  section Phase 1\\n  PhaseName :a1, 2026-01-01, 14d\\n  section Phase 2\\n  PhaseName :a2, after a1, 14d. Always include if 2+ phases exist.",
  ${meta}
}`,

    pricing: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Pricing section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words, frame value not cost",
  "subheadline": "what the investment unlocks",
  "rows": [["Item", "Investment"], ["row data..."]],
  "totalLabel": "total line",
  "footnote": "payment/start note",
  "cta": "3-5 words",
  "imageQuery": "Unsplash query",
  ${meta}
}`,

    whyus: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Why Us section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "body": "2-3 sentences",
  "stats": [{"number": "from content", "label": "2-4 words", "context": "1 short sentence"}],
  "imageQuery": "Unsplash query",
  "diagram": "optional pie chart if stats suggest a meaningful distribution. Format: pie title Label\\n  \\"Category A\\" : 60\\n  \\"Category B\\" : 30. Only include if a clear distribution is evident. Otherwise null.",
  ${meta}
}`,

    nextsteps: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Next Steps section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "body": "2-3 sentences",
  "ctaPrimary": "3-5 words — empty string if constraints say no CTA",
  "ctaSecondary": "3-4 words — empty string if constraints say no CTA",
  "urgencyNote": "string or null",
  "imageQuery": "Unsplash query",
  ${meta}
}`,

    testimonials: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — generate plausible quotes from the proposal context, client industry, and outcomes described in the brief)'}

Generate a Testimonials section. Create 2-3 realistic quotes that reflect the client relationship, industry, and outcomes described in the brief. Quotes should feel authentic — specific, not generic. Names and companies should be plausible but clearly fictional (not real companies). Return:
{
  "eyebrow": "4-8 words e.g. 'Client Voices'",
  "headline": "8-12 words",
  "items": [
    {
      "quote": "1-2 sentences, specific outcome or experience, no cliches, reads like a real person said it",
      "name": "First Last",
      "title": "Job Title",
      "company": "Company Name"
    }
  ],
  ${meta}
}`,

    showcase: `${system}

Brief: ${brief}
Raw content: ${rawBody}

Transform into a Showcase section — a visual feature spotlight. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-14 words, a bold capability statement",
  "subheadline": "1-2 sentences, what this makes possible",
  "body": "2-3 sentences, the 'so what' — impact and differentiation",
  "highlights": ["3-5 short feature pills, 3-6 words each, noun phrases"],
  "imageQuery": "Unsplash query for a striking visual that represents this feature",
  ${meta}
}`,

    benefits: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — derive 4-6 benefits from the brief outcomes, engagement summary, and proposing strength)'}

Transform into a Benefits section — a focused icon list of value propositions. Return:
{
  "eyebrow": "4-8 words e.g. 'What You Gain'",
  "headline": "8-12 words",
  "items": [
    {
      "iconHint": "identity|digital|content|strategy|research|launch|document|website|photo|campaign",
      "title": "2-5 words, the benefit",
      "description": "1-2 sentences, concrete and specific — what does the client actually get?"
    }
  ],
  ${meta}
}`,

    problem: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — derive the sharpest possible problem statement from the clientChallenge and clientIndustry in the brief)'}

Transform into a Problem section — sharper and more urgent than a challenge section. This is the 'why act now' framing. Return:
{
  "eyebrow": "4-8 words e.g. 'The Real Cost of Waiting'",
  "headline": "8-14 words, urgent and specific — name the consequence not just the problem",
  "body": "2-3 sentences, make the cost of inaction visceral and concrete",
  "painPoints": ["3-5 pain points, each 6-12 words, start with a verb or cost noun — specific, not vague"],
  "imageQuery": "Unsplash query for a tense, dramatic visual — avoid generic stock",
  ${meta}
}`,

    stats: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — derive 3-4 strong metrics from the brief: duration, outcomes, value, proposing strength)'}

Transform into a Stats section — a standalone impact metrics row. Return:
{
  "eyebrow": "4-8 words e.g. 'By The Numbers'",
  "headline": "8-12 words",
  "stats": [
    {
      "number": "specific metric e.g. '94%' or '3× faster' or '$2.4M' — from content or reasonably derived from brief",
      "label": "2-4 words",
      "context": "1 short sentence explaining what this means"
    }
  ],
  ${meta}
}`,

    generic: `${system}

Brief: ${brief}
Section heading: ${heading}
Raw content: ${rawBody}

Transform into a website section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words, compelling rewrite of '${heading}'",
  "body": "2-4 sentences, rewritten content",
  "imageQuery": "Unsplash query",
  ${meta}
}`,
  };

  return sectionPrompts[type];
}

// ── Safe JSON parser (strips LLM code fences before parsing) ─────────────────

function safeParseJSON(text: string): Record<string, unknown> | null {
  try {
    const stripped = text.trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Diagram normalizer ────────────────────────────────────────────────────────

function normalizeDiagram(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;

  // 1. Strip markdown code fences
  let s = raw.trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // 2. Remove %%{init:...}%% directives — we set theme via mermaid.initialize()
  s = s.replace(/%%\s*\{[^}]*\}\s*%%\s*/g, '').trim();

  // 3. Mermaid v11: diagram-type keyword MUST be the first line.
  //    If leading %% comment lines precede the type, move them inside the diagram.
  const lines = s.split('\n');
  const commentLines: string[] = [];
  let diagramStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('%%')) {
      commentLines.push(lines[i]);
      diagramStart = i + 1;
    } else {
      break;
    }
  }
  if (commentLines.length > 0 && diagramStart < lines.length) {
    // Move comments to after the diagram type declaration line
    const rest = lines.slice(diagramStart);
    s = [rest[0], ...commentLines, ...rest.slice(1)].join('\n');
  }

  return s.length > 10 ? s : undefined;
}

// ── Markdown prompt (backward compat — existing renderer) ────────────────────

function getSectionHints(sections: { name: string; content: string }[]): string {
  return sections.map((s) => {
    const lower = s.name.toLowerCase();
    if (lower.includes('summary') || lower.includes('overview'))
      return `- **${s.name}**: Powerful one-line opener → 3-4 stat blocks → callout`;
    if (lower.includes('problem') || lower.includes('challenge') || lower.includes('gap') || lower.includes('requirement'))
      return `- **${s.name}**: ### sub-heading per pain point, 1-2 sharp sentences each`;
    if (lower.includes('solution') || lower.includes('approach'))
      return `- **${s.name}**: Key-value cards (5-6) → callout`;
    if (lower.includes('architect') || lower.includes('infrastructure') || lower.includes('integration'))
      return `- **${s.name}**: One-line intro → \`\`\`mermaid diagram → key-value cards for components`;
    if (lower.includes('benefit') || lower.includes('value'))
      return `- **${s.name}**: Stat blocks (3-4) → ### sub-headings with proof points`;
    if (lower.includes('implementation') || lower.includes('timeline') || lower.includes('delivery') || lower.includes('plan'))
      return `- **${s.name}**: Numbered steps (4-6) → \`\`\`mermaid gantt`;
    if (lower.includes('scope') || lower.includes('work'))
      return `- **${s.name}**: Key-value cards grouped under 2-3 ### sub-headings`;
    if (lower.includes('pricing') || lower.includes('cost') || lower.includes('commercial'))
      return `- **${s.name}**: Stat blocks for headline numbers → key-value breakdown`;
    if (lower.includes('risk') || lower.includes('compliance') || lower.includes('security'))
      return `- **${s.name}**: Key-value cards per risk area with mitigation`;
    if (lower.includes('next step') || lower.includes('action'))
      return `- **${s.name}**: 3-4 numbered actions → callout with urgency`;
    return `- **${s.name}**: Mix of ### sub-headings, key-value cards, and 1 callout`;
  }).join('\n');
}

function buildMarkdownPrompt(
  sections: { name: string; content: string }[],
  designConfig?: Record<string, unknown>,
): string {
  const sectionBlock = sections
    .map((s) => `### ${s.name}\n${s.content}`)
    .join('\n\n---\n\n');

  const tone = (designConfig?.tone as string) || 'Professional, confident, and persuasive';
  const audience = (designConfig?.audience as string) || 'Senior decision-makers and stakeholders';
  const textDensity = (designConfig?.textDensity as string) || 'balanced';
  const outputLanguage = (designConfig?.outputLanguage as string) || 'English';
  const customInstructions = (designConfig?.customInstructions as string) || '';

  const density: Record<string, string> = {
    concise: '2-4 sentences per section. Punchy, bold statements.',
    balanced: '4-8 sentences per section. Blend narrative with bullet points.',
    detailed: '8-14 sentences per section. Rich content with examples.',
  };

  return `You are a world-class copywriter creating a professional presentation website.

## YOUR #1 JOB
Take the raw source material below and COMPLETELY REWRITE it as polished, executive-grade website copy.
- You are NOT summarizing or reformatting — you are REWRITING from scratch
- Read the source for FACTS and DATA only, then write entirely new prose
- Every sentence must sound like it was written by McKinsey or a top creative agency

## ABSOLUTE RULES
- ZERO copy-paste from source. Not even partial sentences. Rewrite EVERYTHING.
- No paragraph longer than 2 sentences
- No filler ("In today's landscape", "We are excited", "It is important to note")
- No generic language — be specific, sharp, and confident
- Use power words: deliver, accelerate, transform, eliminate, guarantee, precision
- Every heading must be compelling (not "Problem Statement" → instead "The Challenge That's Costing You Millions")
- Vary visual patterns across sections — never repeat the same pattern consecutively

AUDIENCE: ${audience} | TONE: ${tone} | LANGUAGE: ${outputLanguage}
DENSITY: ${density[textDensity] ?? density.balanced}

## VISUAL BLOCKS (the renderer auto-detects these markdown patterns)

**STAT BLOCKS** — blockquote with bold metric + label:
> **98%**
> Client satisfaction across engagements

Use 3-4 per section. Derive realistic metrics from source data.

**KEY-VALUE CARDS** — bold key + colon + one-sentence description:
- **AI Analytics:** Real-time insights from your data pipeline
- **Cloud-Native:** Scalable microservices on Kubernetes

**CALLOUT** — blockquote without bold number:
> Our methodology delivers consistent results across 50+ enterprise deployments.

Max 1 per section.

**NUMBERED STEPS** — for timelines and processes:
1. **Discovery:** 2-week deep-dive into current state

**SUB-HEADERS** — ### for visual breaks every 2-3 blocks

## SECTION APPROACH (vary patterns — never repeat)

${getSectionHints(sections)}

## DIAGRAMS
Include 2-3 \`\`\`mermaid blocks.
Types: graph TD/LR (architecture), gantt (timeline), pie (distribution).
CRITICAL: The diagram type keyword (graph, gantt, pie, etc.) MUST be the very first line — no comments or directives before it.
If you want a title comment, put it on the SECOND line: e.g. \`graph TD\n  %% Architecture\n  A --> B\`
Node labels: avoid parentheses () inside brackets []. Use only plain text in labels.
Keep simple: 5-10 nodes, short labels. No %%{init}%% directives.

## FORMAT
- # for title (compelling, not generic) + subtitle line
- ## for sections (engaging website-style headings)
- ### for sub-sections
- **Bold** key terms and metrics inline
- Output ONLY valid Markdown — no wrapping code fences

${customInstructions ? `## CUSTOM INSTRUCTIONS (follow these closely)\n${customInstructions}\n\n` : ''}SOURCE MATERIAL (use for facts only — rewrite ALL language):

${sectionBlock}

Generate the presentation website copy now:`;
}

// ── Plan types ────────────────────────────────────────────────────────────────

interface SectionPlan {
  type: SectionType;
  sourceHeading: string | null;
  rationale: string;
  aiGenerated: boolean;
}

interface SectionPlanConstraints {
  noCTAInHero: boolean;
  noCTAEverywhere: boolean;
  requestedSectionCount: number | null;
  hasCustomStructure: boolean;
  motion: 'instant' | 'deliberate' | 'expressive' | null;
  parallax: boolean;
  scrollEffects: 'none' | 'fade-in' | 'slide-up' | null;
}

// ── Agent implementation ─────────────────────────────────────────────────────

export class MicrositeGeneratorAgent implements Agent {
  readonly name = 'microsite-generator-agent';
  readonly description =
    'Converts proposal markdown into a high-end presentation microsite with structured Layout AST.';

  private async synthesizeDesignSystem(
    generateTool: { run: (input: { query: string; content: string }) => Promise<{ text?: string }> },
    brandLanguagePrompt: string,
    basePlugin: string,
    brandPrimaryColor?: string,
    brandImage?: string,
  ): Promise<{ customCharacter: string; rawTokens: Record<string, unknown> } | null> {
    try {
      const hasImage = !!brandImage?.trim();
      const imagePrefix = hasImage ? `DESIGN_IMAGE:${brandImage}\n\n` : '';
      const fullPrompt = imagePrefix + buildDesignSystemPrompt(brandLanguagePrompt, basePlugin, brandPrimaryColor, hasImage);
      const result = await generateTool.run({ query: fullPrompt, content: '' });
      // Extract JSON object even if LLM adds preamble/postamble text
      const raw = result.text ?? '';
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      const jsonStr = jsonStart !== -1 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
      const parsed = safeParseJSON(jsonStr);
      if (!parsed) return null;
      const { customCharacter, bg, text, accent } = parsed;
      if (typeof customCharacter !== 'string' || !customCharacter.trim()) return null;
      if (typeof bg !== 'string' || typeof text !== 'string' || typeof accent !== 'string') return null;
      return { customCharacter: customCharacter.trim(), rawTokens: parsed };
    } catch {
      return null;
    }
  }

  private extractSemanticDesignSystem(rawTokens: Record<string, unknown>): Record<string, unknown> | undefined {
    const pick = (key: string) => rawTokens[key];
    const visualStyle = pick('visualStyle');
    const density = pick('density');
    const typography = pick('typography');
    const colorStrategy = pick('colorStrategy');
    const layoutStyle = pick('layoutStyle');
    const componentStyle = pick('componentStyle');
    const behavior = pick('behavior');
    const layoutPatterns = pick('layoutPatterns');
    const sectionRules = pick('sectionRules');
    const colorOverrides = pick('colorOverrides');
    const tokenOverrides = pick('tokenOverrides');
    if (!visualStyle && !density && !typography && !colorStrategy && !layoutStyle && !componentStyle && !behavior && !layoutPatterns) {
      return undefined;
    }
    return { visualStyle, density, typography, colorStrategy, layoutStyle, componentStyle, behavior, layoutPatterns, sectionRules, colorOverrides, tokenOverrides };
  }

  async run(input: AgentInput): Promise<AgentOutput> {
    const meta = input.metadata ?? {};
    const proposalMarkdown = (meta.proposalMarkdown as string | undefined) ?? '';
    const namespace = input.namespace;
    const designBrief = (meta.designBrief as string | undefined) ?? '';
    // designBrief drives BOTH design synthesis (Pass -1) AND structural planning (Pass 0)
    const brandLanguagePrompt = designBrief;
    const customInstructions = designBrief;
    const designConfig: Record<string, unknown> = {
      ...((meta.designConfig as Record<string, unknown> | undefined) ?? {}),
      ...(customInstructions ? { customInstructions } : {}),
    };
    const metaBrand = (meta.brand as Record<string, unknown> | undefined) ?? {};
    const metaPlugin = (meta.plugin as string | undefined) ?? 'cobalt';
    const brandImage = (meta.brandImage as string | undefined) ?? '';

    if (!proposalMarkdown) {
      throw new Error('microsite-generator agent requires metadata.proposalMarkdown');
    }

    const tools = input.tools;
    if (!tools) {
      throw new Error('microsite-generator agent requires tools (generate-content, save-asset)');
    }

    // 1. Parse source sections from markdown headings
    const sourceSections = this.extractSections(proposalMarkdown);
    if (sourceSections.length === 0) {
      return { markdown: proposalMarkdown, assets: [] };
    }

    let generateTool;
    try { generateTool = tools.get('generate-content'); } catch { /* no tool */ }

    let layoutAST: unknown = null;
    let markdown = '';

    // Check for a pre-synthesized design system (from the style synthesis endpoint).
    // When present, Pass -1 is skipped entirely.
    const preSynthesized = (meta.preSynthesizedDesignSystem as { rawTokens?: Record<string, unknown> } | undefined)?.rawTokens;

    if (generateTool) {
      // Pass -1: Design system synthesis (skipped if preSynthesizedDesignSystem provided)
      let designSystemResult: { customCharacter: string; rawTokens: Record<string, unknown> } | null = null;
      if (preSynthesized) {
        const character = typeof preSynthesized.customCharacter === 'string' ? preSynthesized.customCharacter : 'custom-synthesized';
        designSystemResult = { customCharacter: character, rawTokens: preSynthesized };
        console.log('[microsite-agent] Using pre-synthesized design system — skipping Pass -1');
      } else {
        console.log('[microsite-agent] brandLanguagePrompt present:', !!brandLanguagePrompt.trim(), '| length:', brandLanguagePrompt.length);
        if (brandLanguagePrompt.trim()) {
          console.log('[microsite-agent] Running Pass -1: design system synthesis...');
          designSystemResult = await this.synthesizeDesignSystem(
            generateTool,
            brandLanguagePrompt,
            metaPlugin,
            metaBrand.primaryColor as string | undefined,
            brandImage || undefined,
          );
          console.log('[microsite-agent] designSystemResult:', designSystemResult ? `OK — character: "${designSystemResult.customCharacter}"` : 'NULL (synthesis failed or returned invalid JSON)');
        }
      }
      const effectiveCharacter = designSystemResult?.customCharacter;

      // Pass 0: Section planning + Pass 1: Brief extraction (parallel)
      const [planResult, briefResult, markdownResult] = await Promise.all([
        generateTool.run({ query: buildSectionPlanPrompt(proposalMarkdown, metaPlugin, effectiveCharacter, customInstructions), content: '' }).catch(() => null),
        generateTool.run({ query: buildBriefPrompt(proposalMarkdown, { companyName: metaBrand.companyName as string | undefined, tagline: metaBrand.tagline as string | undefined }, metaPlugin, customInstructions, effectiveCharacter), content: '' }).catch(() => null),
        generateTool.run({ query: buildMarkdownPrompt(sourceSections, designConfig), content: '' }).catch(() => null),
      ]);

      // Parse section plan — handles both new { sections, constraints } format and legacy [] format
      let sectionPlan: SectionPlan[] | null = null;
      let planConstraints: SectionPlanConstraints = { noCTAInHero: false, noCTAEverywhere: false, requestedSectionCount: null, hasCustomStructure: false, motion: null, parallax: false, scrollEffects: null };
      if (planResult?.text) {
        try {
          const raw = planResult.text.trim();
          const jsonStart = raw.indexOf('[') !== -1 && (raw.indexOf('{') === -1 || raw.indexOf('[') < raw.indexOf('{')) ? raw.indexOf('[') : raw.indexOf('{');
          const parsed = JSON.parse(jsonStart > 0 ? raw.slice(jsonStart) : raw);
          if (Array.isArray(parsed)) {
            // Legacy array format
            sectionPlan = parsed;
          } else if (parsed && Array.isArray(parsed.sections)) {
            // New object format
            sectionPlan = parsed.sections;
            if (parsed.constraints && typeof parsed.constraints === 'object') {
              planConstraints = {
                noCTAInHero: !!parsed.constraints.noCTAInHero,
                noCTAEverywhere: !!parsed.constraints.noCTAEverywhere,
                requestedSectionCount: typeof parsed.constraints.requestedSectionCount === 'number' ? parsed.constraints.requestedSectionCount : null,
                hasCustomStructure: !!parsed.constraints.hasCustomStructure,
                motion: (['instant', 'deliberate', 'expressive'] as const).includes(parsed.constraints.motion) ? parsed.constraints.motion : null,
                parallax: !!parsed.constraints.parallax,
                scrollEffects: (['none', 'fade-in', 'slide-up'] as const).includes(parsed.constraints.scrollEffects) ? parsed.constraints.scrollEffects : null,
              };
            }
          }
          if (!Array.isArray(sectionPlan)) sectionPlan = null;
        } catch { /* fallback to source order */ }
      }

      // Build constraint-derived additions to customInstructions for section prompts
      const heroConstraintHint = planConstraints.noCTAInHero
        ? ' USER CONSTRAINT: Do NOT include CTA buttons or action links in this hero section. Omit ctaPrimary and ctaSecondary (set them to empty strings).'
        : '';
      const effectiveHeroInstructions = customInstructions + heroConstraintHint;
      console.log('[microsite-agent] planConstraints:', JSON.stringify(planConstraints));

      // Parse brief
      let brief: Record<string, unknown> | null = null;
      if (briefResult?.text) {
        brief = safeParseJSON(briefResult.text);
      }

      // Set markdown
      const mdText = (markdownResult?.text ?? '').trim();
      markdown = mdText.length >= 50 ? mdText : this.fallbackMarkdown(sourceSections);

      // Build source section lookup map (heading → content)
      const sourceMap = new Map<string, string>();
      for (const s of sourceSections) {
        sourceMap.set(s.name.toLowerCase(), s.content);
        sourceMap.set(slugify(s.name), s.content);
      }

      // Resolve section list from plan or fallback to source order
      const resolvedSections: Array<{ type: SectionType; heading: string; rawBody: string; aiGenerated: boolean }> = [];

      if (sectionPlan && sectionPlan.length > 0) {
        for (const planned of sectionPlan) {
          const rawType = planned.type as string;
          const type: SectionType = (rawType in VARIANT_POOLS) ? (rawType as SectionType) : classifySection(rawType);
          const sourceHeading = planned.sourceHeading;
          let rawBody = '';
          let heading = sourceHeading ?? type;

          if (sourceHeading) {
            // Find best match in sourceMap
            const lower = sourceHeading.toLowerCase();
            rawBody = sourceMap.get(lower)
              ?? sourceMap.get(slugify(sourceHeading))
              ?? (() => {
                // Fuzzy fallback: partial match
                for (const [k, v] of sourceMap) {
                  if (k.includes(slugify(sourceHeading)) || slugify(sourceHeading).includes(k)) return v;
                }
                return '';
              })();
            heading = sourceHeading;
          }

          resolvedSections.push({ type, heading, rawBody, aiGenerated: planned.aiGenerated || !sourceHeading });
        }
      } else {
        // Fallback: use source sections in order
        for (const s of sourceSections) {
          resolvedSections.push({
            type: classifySection(s.name),
            heading: s.name,
            rawBody: s.content,
            aiGenerated: false,
          });
        }
      }

      // Pass 2: Format sections in parallel
      if (brief) {
        const briefStr = JSON.stringify(brief);
        const tone = (brief.primaryTone as string) || 'authoritative';
        const brandName = (metaBrand.companyName as string | undefined) || (brief.proposingCompany as string | undefined);

        const layoutPatterns = (designSystemResult?.rawTokens?.layoutPatterns as Record<string, unknown> | undefined);
        const sectionRulesMap = (designSystemResult?.rawTokens?.sectionRules as Record<string, unknown> | undefined) ?? {};

        // Apply explicit color/token overrides from design brief on top of synthesized tokens
        if (designSystemResult) {
          const colorOv = designSystemResult.rawTokens.colorOverrides as Record<string, unknown> | undefined;
          if (colorOv) {
            if (typeof colorOv.bg === 'string' && colorOv.bg.startsWith('#')) designSystemResult.rawTokens.bg = colorOv.bg;
            if (typeof colorOv.text === 'string' && colorOv.text.startsWith('#')) designSystemResult.rawTokens.text = colorOv.text;
            if (typeof colorOv.accent === 'string' && colorOv.accent.startsWith('#')) designSystemResult.rawTokens.accent = colorOv.accent;
          }
          const tokOv = designSystemResult.rawTokens.tokenOverrides as Record<string, unknown> | undefined;
          if (tokOv) {
            if (typeof tokOv.borderRadius === 'string') designSystemResult.rawTokens.borderRadius = tokOv.borderRadius;
          }
        }

        // Detect intent flags from the unified designBrief
        const ciBrief = customInstructions.toLowerCase();
        const briefIsEditorial = /\beditorial\b/i.test(ciBrief);
        const briefIsMinimal   = /\bminimal\b|\bclean\b|\bsimple\b/i.test(ciBrief);
        const briefIsBold      = /\bbold\b|\bpremium\b|\bhigh[- ]contrast\b|\bpowerful\b/i.test(ciBrief) && !/not\s*bold/i.test(ciBrief);

        // Pre-assign variants for all sections (sequential, lightweight — enforces no-adjacent-repeat)
        const preassigned = preassignVariants(
          resolvedSections,
          briefIsEditorial,
          briefIsMinimal,
          briefIsBold,
          layoutPatterns,
          customInstructions,
        );

        const seenSlugs = new Map<string, number>();
        const sectionResults = await Promise.all(
          resolvedSections.map(async (s, idx) => {
            const baseSlug = slugify(s.heading);
            const count = seenSlugs.get(baseSlug) ?? 0;
            seenSlugs.set(baseSlug, count + 1);
            const id = count === 0 ? baseSlug : `${baseSlug}-${idx}`;
            const sectionInstructions = s.type === 'hero' ? effectiveHeroInstructions : customInstructions;
            const sectionRules = (sectionRulesMap[s.type] as Record<string, unknown> | undefined) ?? null;
            const prompt = buildSectionPrompt(s.type, s.heading, s.rawBody, briefStr, tone, brandName, metaPlugin, s.aiGenerated, sectionInstructions, effectiveCharacter, layoutPatterns, idx, preassigned[idx], sectionRules);
            try {
              const result = await generateTool!.run({ query: prompt, content: '' });
              const parsed = safeParseJSON(result.text ?? '') ?? {};
              if (parsed.diagram) parsed.diagram = normalizeDiagram(parsed.diagram);
              // Force CTA off per constraints
              const shouldStripCTA = (s.type === 'hero' && (planConstraints.noCTAInHero || planConstraints.noCTAEverywhere))
                || (planConstraints.noCTAEverywhere && (s.type === 'nextsteps' || s.type === 'pricing'));
              if (shouldStripCTA) {
                parsed.ctaPrimary = '';
                parsed.ctaSecondary = '';
                parsed.cta = '';
                if (parsed.ui && typeof parsed.ui === 'object') {
                  (parsed.ui as Record<string, unknown>).showCTA = false;
                }
              }
              return { id, heading: s.heading, type: s.type, content: parsed };
            } catch {
              return {
                id,
                heading: s.heading,
                type: s.type,
                content: {
                  eyebrow: s.heading,
                  headline: s.heading,
                  body: s.rawBody.split('\n').slice(0, 3).join(' ').slice(0, 200),
                  imageQuery: `business ${s.heading.toLowerCase()} professional`,
                },
              };
            }
          }),
        );

        // Assemble Layout AST
        const resolvedCompany = (metaBrand.companyName as string | undefined) || (brief.proposingCompany as string) || '';
        layoutAST = {
          proposalId: namespace,
          generatedAt: new Date().toISOString(),
          meta: this.extractMeta(proposalMarkdown),
          brief,
          brand: {
            companyName: resolvedCompany,
            tagline: (metaBrand.tagline as string | undefined) || '',
            logoUrl: (metaBrand.logoUrl as string | null | undefined) ?? null,
            logoText: (metaBrand.logoText as string | undefined) || resolvedCompany.slice(0, 2).toUpperCase(),
            primaryColor: (metaBrand.primaryColor as string | undefined) || '',
            secondaryColor: (metaBrand.secondaryColor as string | undefined) || '',
          },
          plugin: metaPlugin,
          ...(designSystemResult ? {
            customCharacter: designSystemResult.customCharacter,
            customTokens: designSystemResult.rawTokens,
            customFonts: buildFontUrls(designSystemResult.rawTokens),
            customDesignSystem: this.extractSemanticDesignSystem(designSystemResult.rawTokens),
          } : {}),
          behavior: {
            motion: planConstraints.motion
              ?? (designSystemResult?.rawTokens?.behavior as Record<string,unknown> | undefined)?.motion as 'instant'|'deliberate'|'expressive' | undefined
              ?? 'deliberate',
            parallax: planConstraints.parallax
              || ((designSystemResult?.rawTokens?.behavior as Record<string,unknown> | undefined)?.parallax === true),
            scrollEffects: planConstraints.scrollEffects
              ?? (designSystemResult?.rawTokens?.behavior as Record<string,unknown> | undefined)?.scrollEffects as 'none'|'fade-in'|'slide-up' | undefined
              ?? 'none',
          },
          sections: sectionResults.map((sr) => {
            const query = ((sr.content as Record<string, unknown>).imageQuery as string | undefined) ?? '';
            return {
              id: sr.id,
              heading: sr.heading,
              sectionType: sr.type,
              content: sr.content,
              image: {
                // Hero sections are marked for Unsplash resolution by the API route
                source: sr.type === 'hero' && query.trim() ? ('unsplash' as const) : ('gradient' as const),
                query,
                url: null,
                fallback: 'gradient-mesh' as const,
              },
              editable: true,
              version: 1,
            };
          }),
        };
      }
    } else {
      markdown = this.fallbackMarkdown(sourceSections);
    }

    // 3. Inject diagram if needed
    let diagram: string | undefined;
    const arch = sourceSections.find((s) => s.name.toLowerCase().includes('architect'));

    if (arch?.content) {
      diagram = await this.generateDiagram(tools, arch.content);
    }
    if (diagram && !markdown.includes('```mermaid')) {
      markdown = this.injectDiagram(markdown, diagram);
    }

    // 4. Save assets
    const assets = await this.saveAssets(tools, namespace, markdown, layoutAST, diagram);

    return { markdown, json: layoutAST, assets };
  }

  private extractSections(markdown: string): { name: string; content: string }[] {
    const lines = markdown.split('\n');
    const sections: { name: string; content: string }[] = [];
    let currentName: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentName !== null) {
          const body = currentLines.join('\n').trim();
          if (body) sections.push({ name: currentName, content: body });
        }
        currentName = line.slice(3).trim();
        currentLines = [];
      } else if (currentName !== null) {
        currentLines.push(line);
      }
    }

    if (currentName !== null) {
      const body = currentLines.join('\n').trim();
      if (body) sections.push({ name: currentName, content: body });
    }

    if (sections.length === 0 && markdown.trim()) {
      sections.push({ name: 'Overview', content: markdown });
    }

    return sections;
  }

  private extractMeta(markdown: string): { title: string; client: string; date: string; author: string } {
    const meta = { title: '', client: '', date: '', author: '' };
    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    if (titleMatch) meta.title = titleMatch[1].trim();
    const forMatch = meta.title.match(/proposal\s+for\s+(.+)/i);
    if (forMatch) meta.client = forMatch[1].trim();
    const dateMatch = markdown.match(/\*\*Date\s*:\*\*\s*(.+)/i);
    if (dateMatch) meta.date = dateMatch[1].trim();
    const authorMatch = markdown.match(/\*\*(?:Prepared\s*by|Author)\s*:\*\*\s*(.+)/i);
    if (authorMatch) meta.author = authorMatch[1].trim();
    return meta;
  }

  private fallbackMarkdown(sections: { name: string; content: string }[]): string {
    const isSummary = /summary|overview/i.test(sections[0]?.name ?? '');
    const title = isSummary ? 'Proposal Presentation' : sections[0]?.name ?? 'Proposal';
    const subtitle = isSummary
      ? sections[0].content.split('\n').find((l) => l.trim().length > 20)?.trim() ?? ''
      : '';
    const body = sections
      .map((s) => {
        const first = s.content.split('\n').find((l) => l.trim().length > 30 && !/^[-*]/.test(l));
        const quote = first ? `\n> ${first.trim()}\n` : '';
        return `## ${s.name}${quote}\n${s.content}`;
      })
      .join('\n\n---\n\n');
    return `# ${title}${subtitle ? `\n${subtitle}` : ''}\n\n${body}`;
  }

  private injectDiagram(markdown: string, diagram: string): string {
    const block = `\n\n\`\`\`mermaid\n%% Solution Architecture\n${diagram}\n\`\`\`\n`;
    const match = /^(## .*(architect|solution|technical|system).*)$/im.exec(markdown);
    if (match?.index !== undefined) {
      const rest = markdown.slice(match.index + match[0].length);
      const next = rest.search(/^## /m);
      const pos = next >= 0 ? match.index + match[0].length + next : markdown.length;
      return markdown.slice(0, pos) + block + markdown.slice(pos);
    }
    return markdown + block;
  }

  private async generateDiagram(tools: ToolRegistry, content: string): Promise<string | undefined> {
    try {
      const result = await tools.get('generate-mermaid').run({
        content: `Generate an architecture diagram:\n\n${content}`,
      });
      return result.text || undefined;
    } catch {
      return undefined;
    }
  }

  private async saveAssets(
    tools: ToolRegistry,
    namespace: string,
    markdown: string,
    layoutAST: unknown,
    diagram?: string,
  ): Promise<string[]> {
    let tool;
    try { tool = tools.get('save-asset'); } catch { return []; }
    const files: string[] = [];
    const md = await tool.run({ content: markdown, metadata: { fileName: `presentations/${namespace}/index.md` } });
    if (md.files) files.push(...md.files);
    if (layoutAST) {
      const ast = await tool.run({ content: JSON.stringify(layoutAST, null, 2), metadata: { fileName: `presentations/${namespace}/site-ast.json` } });
      if (ast.files) files.push(...ast.files);
    }
    if (diagram) {
      const d = await tool.run({ content: diagram, metadata: { fileName: `presentations/${namespace}/assets/architecture.mmd` } });
      if (d.files) files.push(...d.files);
    }
    return files;
  }
}
