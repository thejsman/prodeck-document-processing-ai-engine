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
import { selectBestDiagram, type DiagramSelection } from './diagramDetector.js';
import { extractDesignTokens, type ExtractedDesignTokens } from './designTokenExtractor.js';
import { detectSectionLimitRequest, type SectionLimitRequest } from './lib/sectionLimitDetector.js';

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
  | 'metrics'
  | 'security'
  | 'techstack'
  | 'testing'
  | 'faq'
  | 'team'
  | 'comparison'
  | 'casestudy'
  | 'chart'
  | 'generic';

const ALL_SECTION_TYPES = new Set<string>([
  'hero','challenge','approach','deliverables','timeline','pricing',
  'whyus','nextsteps','testimonials','showcase','benefits','problem','stats',
  'metrics','security','techstack','testing','faq','team','comparison','casestudy','chart','generic',
]);

// ── Reference file design extraction types ───────────────────────────────────

interface ReferenceFile {
  readonly base64: string;      // full data URL: "data:image/png;base64,..."
  readonly mediaType: string;   // "image/png" | "image/jpeg" | "image/webp" | "application/pdf"
  readonly fileName: string;
  readonly dominantColors?: string[]; // canvas-extracted hex colors, most frequent first
}

interface ReferenceDesign {
  colors: {
    primary: string; secondary: string; accent: string;
    background: string; surface: string; text: string; textMuted: string;
  };
  typography: {
    headingFont: string; bodyFont: string;
    headingWeight: string; bodyWeight: string;
    headingStyle: 'serif' | 'sans-serif' | 'display';
    mood: 'modern' | 'classic' | 'bold' | 'minimal' | 'playful';
  };
  style: {
    borderRadius: 'sharp' | 'soft' | 'rounded';
    spacing: 'compact' | 'comfortable' | 'spacious';
    vibe: string;
  };
}

/**
 * Extract exact section count from customInstructions.
 * LLMs are unreliable at exact counting — this enforces it in code.
 * Matches: "only 3 sections", "make it 3 sections", "generate 3 sections",
 *          "3 sections only", "exactly 3 sections", "just 3 sections"
 */
function parseExplicitCount(ci: string): number | null {
  // Keyword is REQUIRED — prevents false positives from numbered layout lists like "1. Hero Section"
  const m = ci.match(/\b(?:only|make\s+it|create|generate|just|exactly|use|limit\s+to|max|maximum)\s+(\d+)\s+sections?\b/i);
  return m ? parseInt(m[1], 10) : null;
}

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
  if (/tech\s*stack|technology\s*stack|programming\s*lang|framework|tool\s*stack/i.test(h)) return 'techstack';
  if (/security|compliance|encrypt|iam|access\s*control|data\s*protect/i.test(h)) return 'security';
  if (/testing|quality\s*assurance|\bqa\b|test\s*coverage|test\s*strateg/i.test(h)) return 'testing';
  if (/\bmetric|kpi|\bperformance\b|benchmark|measure/i.test(h) && !/implementation/.test(h)) return 'metrics';
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
  midnight: 'Wired meets Verge — electric, high-contrast, tech-forward. Deep navy backgrounds, neon cyan accents. Copy is terse and punchy.',
  aurora:   'National Geographic meets Monocle — cinematic, warm, editorial. Rich amber and forest green. Prose is vivid and unhurried.',
  slate:    'Harvard Business Review meets Stripe Docs — minimal, precise, corporate. Cool gray surfaces, crisp black type. Zero decoration.',
  crimson:  'The Atlantic meets LVMH — bold, literary, premium-red. Deep burgundy with gold accents. Sentences are long and authoritative.',
  carbon:   'Wired Hardware meets Industrial Design — dark graphite, orange highlights, mechanical feel. Copy is direct and technical.',
  pearl:    'Apple meets Kinfolk — soft white, blush tones, breathing room. Generous whitespace. Prose is warm and refined.',
  neon:     'Cyberpunk meets Pitch deck — dark background, vivid magenta and lime accents. High energy, startup-bold, irreverent.',
  forest:   'Patagonia meets McKinsey Sustainability — deep greens, earthy tones, mission-driven. Prose grounds every claim in real impact.',
  gold:     'Sothebys meets Rolex — champagne and deep black, ultra-premium. Sparse, deliberate copy. Every word earns its place.',
  ocean:    'MIT Technology Review meets Salesforce — deep teal gradient, white type, data-confident. Authoritative and forward-looking.',
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
- playful/children: Baloo 2, Fredoka, Lilita One, Bubblegum Sans, Nunito, Quicksand, Comfortaa

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

function buildSectionPlanPrompt(markdown: string, plugin?: string, customInstructions?: string, referenceDesign?: ReferenceDesign | null): string {
  const character = plugin ? PLUGIN_CHARACTER[plugin] : undefined;
  const styleHint = character ? `\nDESIGN VOICE: "${plugin}" theme — ${character}\n` : '';
  // Only treat customInstructions as a structural override if it explicitly requests a section
  // count or reorder. Visual/design prompts (fonts, colors, layout style) must NOT trigger this —
  // they often contain words like "section heading" or "structured layout" that are not structural intents.
  const hasStructuralInstruction = customInstructions
    ? /\b(only|exactly|just|max|maximum|limit\s+to)\s+\d+\s+sections?|\d+\s+sections?\s+(only|total|max|please)|\bsection\s+count\b|\bgenerate\s+\d+\s+sections?|\bcreate\s+\d+\s+sections?|\bmake\s+it\s+\d+\s+sections?/i.test(customInstructions)
    : false;
  const overrideBlock = (customInstructions && hasStructuralInstruction)
    ? `⚡⚡⚡ USER STRUCTURE OVERRIDE ⚡⚡⚡\n${customInstructions}\n⚡⚡⚡ END OVERRIDE ⚡⚡⚡\n\n`
    : '';
  // Style/visual instructions go at the end as hints only — they do NOT override section count rules
  const styleHintBlock = (customInstructions && !hasStructuralInstruction)
    ? `\nSTYLE NOTES (apply to design tokens only — do NOT affect section count or structure):\n${customInstructions.slice(0, 400)}\n`
    : (customInstructions ? `\nUSER INSTRUCTIONS: ${customInstructions.slice(0, 400)}\n` : '');
  const refShortBlock = referenceDesign ? `\n${formatReferenceDesignShortBlock(referenceDesign)}\n` : '';
  return `${overrideBlock}${refShortBlock}You are a senior proposal strategist and UX director. Read this proposal markdown and design the optimal section sequence for a high-impact presentation microsite.
${styleHint}
RULES (NON-NEGOTIABLE — these cannot be overridden by style or visual instructions):
- Output a JSON array of ALL sections — target 12-13 sections, minimum 10
- You MUST include these core section types (map from proposal content or generate from brief):
  * hero (always first — map executive summary or overview)
  * problem OR challenge (the client pain point)
  * approach OR solution (the proposed methodology)
  * deliverables OR showcase (what is being delivered)
  * timeline (project phases and schedule)
  * pricing (investment and commercial terms)
  * stats (key metrics and impact numbers — generate from scattered metrics if needed)
  * benefits (value propositions)
  * whyus (credentials and differentiators)
  * testimonials (generate from context if client names or outcomes mentioned)
  * nextsteps (always last — call to action)
- Add additional sections if content supports them (generic, showcase, etc.)
- Map existing source headings to appropriate types
- For sections with no source heading, set aiGenerated: true and generate from brief
- NEVER output fewer than 10 sections
- NEVER skip a core section type listed above
${styleHintBlock}
VALID TYPES: hero, challenge, approach, deliverables, timeline, pricing, whyus, nextsteps, testimonials, showcase, benefits, problem, stats, faq, team, comparison, casestudy, chart, generic

Return ONLY valid JSON array. No markdown, no explanation, no code fences.

Format:
[
  { "type": "hero", "sourceHeading": "Executive Summary", "rationale": "Maps directly", "aiGenerated": false },
  { "type": "stats", "sourceHeading": null, "rationale": "Metrics scattered across proposal — consolidate", "aiGenerated": true }
]

PROPOSAL:
${markdown.slice(0, 8000)}`;
}

// ── Plan refinement prompt (Pass 0.5 — only runs when customInstructions present) ───

function buildPlanRefinementPrompt(plan: SectionPlan[], customInstructions: string): string {
  return `⚡⚡⚡ USER COMMAND — APPLY EXACTLY AS WRITTEN ⚡⚡⚡
${customInstructions}
⚡⚡⚡ END OF USER COMMAND ⚡⚡⚡

You are a section plan editor. Reshape the plan below to satisfy the USER COMMAND above.

CURRENT PLAN:
${JSON.stringify(plan, null, 2)}

VALID SECTION TYPES: hero, challenge, approach, deliverables, timeline, pricing, whyus, nextsteps, testimonials, showcase, benefits, problem, stats, metrics, security, techstack, testing, faq, team, comparison, casestudy, chart, generic

RULES:
- Return ONLY a valid JSON array — same format as CURRENT PLAN
- Apply the user's instructions precisely: reduce, reorder, rename, add, or remove sections as requested
- If the user says "only X sections", return exactly X items
- If the user says "only section: Y", return exactly [{ type: "Y", ... }]
- If the user says "swap X and Y" or specifies a custom order, reorder exactly as asked — do NOT enforce any default ordering
- ⚠️ CRITICAL: If the instruction is ONLY about images, colors, fonts, motion, animations, or other visual styling (e.g. "add image on hero", "remove image", "dark theme", "no animations") — return the CURRENT PLAN UNCHANGED. Do NOT add or remove sections for visual-only commands.
- Preserve sourceHeading, rationale, aiGenerated fields where possible
- Return ONLY valid JSON. No markdown, no explanation, no code fences.`;
}

// ── Command parser prompt (parses customInstructions into ParsedCommand) ────────

function buildCommandParserPrompt(customInstruction: string, currentPlugin: string): string {
  return `You are a design command parser for a presentation microsite generator.

Parse the following user instruction into a structured command JSON.

CURRENT PLUGIN: "${currentPlugin}"
VALID PLUGINS: obsidian, ivory, cobalt, sage
VALID SECTION TYPES: hero, challenge, approach, deliverables, timeline, pricing, whyus, nextsteps, testimonials, showcase, benefits, problem, stats, metrics, security, techstack, testing, faq, team, comparison, casestudy, chart, generic
VALID LAYOUT VARIANTS: split, editorial, asymmetric, card-grid, minimal, centered, type-forward

USER INSTRUCTION:
${customInstruction}

Parse into:
- designOverrides.plugin: plugin name if user says "switch to X theme" / "use X plugin" — else null
- designOverrides.sectionLayout: map of section type → layout variant for explicit per-section layout requests (e.g. {"hero": "split", "approach": "card-grid"})
- designOverrides.imageStyle: style descriptor if user specifies image style ("cinematic", "black and white", "abstract", "no images") — else null
- designOverrides.typographyScale: "dramatic" | "moderate" | "tight" — if user specifies scale, else null
- designOverrides.accentColor: hex color (#xxxxxx) if user specifies accent/primary color — else null
- contentOverrides.tone: tone override string if user specifies ("aggressive", "warmer", "authoritative") — else null
- contentOverrides.sectionsToHide: array of section types to remove/hide (e.g. ["pricing","testimonials"])
- contentOverrides.sectionsToAdd: array of section types to insert
- contentOverrides.sectionInstructions: map of section type → specific instruction for that section (e.g. {"hero": "make the headline shorter and punchier"})
- contentOverrides.globalInstruction: any global content instruction not captured above — else null

Return ONLY valid JSON. No markdown, no explanation, no code fences.

{
  "designOverrides": {
    "plugin": null,
    "sectionLayout": {},
    "imageStyle": null,
    "typographyScale": null,
    "accentColor": null
  },
  "contentOverrides": {
    "tone": null,
    "sectionsToHide": [],
    "sectionsToAdd": [],
    "sectionInstructions": {},
    "globalInstruction": null
  }
}`;
}

// ── Fast hero prompt (speculative — no brief/plan dependency) ────────────────

function buildFastHeroPrompt(
  planningMarkdown: string,
  companyName: string | undefined,
  tagline: string | undefined,
  customInstructions: string,
): string {
  return `You are generating the HERO section for a proposal microsite.
Company: ${companyName ?? 'the proposing company'}
Tagline: ${tagline ?? ''}
${customInstructions ? `\nStyle notes: ${customInstructions.slice(0, 300)}` : ''}

PROPOSAL (first 3000 chars):
${planningMarkdown.slice(0, 3000)}

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "eyebrow": "short label above headline (e.g. 'Proposal for Acme Corp')",
  "headline": "bold punchy main headline (max 8 words)",
  "subheadline": "one supporting sentence (max 20 words)",
  "body": "2-3 sentence value proposition",
  "ctaPrimary": "primary button label (e.g. 'Let's Get Started')",
  "ctaSecondary": "secondary button label (e.g. 'View Details')",
  "imageQuery": "Unsplash search query for hero background (3-5 words)",
  "theme": "light"
}`;
}

// ── Brief extraction prompt ──────────────────────────────────────────────────

function buildBriefPrompt(markdown: string, brandHint?: { companyName?: string; tagline?: string }, plugin?: string, customInstructions?: string, characterOverride?: string, referenceDesign?: ReferenceDesign | null): string {
  const hint = brandHint?.companyName
    ? `\nIMPORTANT: The proposing company is "${brandHint.companyName}"${brandHint.tagline ? ` (tagline: "${brandHint.tagline}")` : ''}. Use this exact name for "proposingCompany" and in all generated copy.\n`
    : '';
  const character = characterOverride ?? (plugin ? PLUGIN_CHARACTER[plugin] : undefined);
  const styleHint = character ? `\nDESIGN VOICE: This microsite uses a "${plugin}" theme (${character}). Let this shape the heroNarrative tone and primaryTone selection.\n` : '';
  const overrideBlock = customInstructions
    ? `\n⚡ OVERRIDE DIRECTIVE — HIGHEST PRIORITY (apply before extracting any field):\n${customInstructions}\n`
    : '';
  const refShortBlock = referenceDesign ? `\n${formatReferenceDesignShortBlock(referenceDesign)}\n` : '';
  return `You are a senior proposal strategist. Extract a structured brief from this proposal. Return ONLY valid JSON. No markdown, no explanation, no code fences.
${overrideBlock}${refShortBlock}${hint}${styleHint}
Extract this proposal into a brief:

${markdown}

Return exactly this JSON — every field must use REAL data extracted from the proposal, not invented placeholders:
{
  "clientName": "exact client/company name from proposal",
  "clientIndustry": "specific industry (e.g. 'Healthcare SaaS', 'Retail Banking', not just 'Technology')",
  "clientChallenge": "the core problem in 1 specific sentence — name the exact pain, not a generic description",
  "proposingCompany": "exact proposing company name — use brand name if provided above",
  "proposingStrength": "single most impressive credential with specifics (years, %, named clients if mentioned)",
  "engagementSummary": "2 sentences — what is being built/delivered and what outcome it achieves. Include tech stack or methodology names if present.",
  "keyOutcomes": ["3-5 SPECIFIC measurable outcomes from the proposal — include numbers, percentages, timeframes where stated"],
  "totalValue": "exact total price or investment from the proposal (e.g. '$240,000', '€85k/month'). If a range, state both. Never leave empty if pricing exists.",
  "duration": "exact engagement duration from proposal (e.g. '12 weeks', '6 months', 'Q2–Q4 2026')",
  "primaryTone": "authoritative or consultative or innovative or warm",
  "heroNarrative": "THE most compelling transformation statement, 8-12 words, never starts with We/Our, present tense, names the specific result",
  "industryKeywords": ["3-5 specific keywords for image searches — include industry + visual mood"]
}`;
}

// ── Reference design extraction (Pass 0.5) ───────────────────────────────────

function buildReferenceDesignExtractionPrompt(dominantColors?: string[]): string {
  const allColors = dominantColors ?? [];

  // The first color in the list is always the background candidate (dark or light)
  // Light colors (index 0-2 when light image) or dark color (index 0 when dark image)
  // Vivid/accent colors follow
  const bgCandidate = allColors[0] ?? null;
  const accentCandidates = allColors.slice(1);

  // Detect dark image: bg candidate luminance < 60
  let isDarkImage = false;
  if (bgCandidate) {
    const h = bgCandidate.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    isDarkImage = (0.299 * r + 0.587 * g + 0.114 * b) < 60;
  }

  const colorPaletteBlock = allColors.length > 0
    ? `\nACTUAL COLORS PIXEL-SAMPLED FROM THE IMAGE — use ONLY these exact hex values:

BACKGROUND COLOR (page canvas — ${isDarkImage ? 'DARK image detected' : 'LIGHT image detected'}):
  ${bgCandidate ?? '(none)'}

BRAND / ACCENT COLORS (vivid, sorted by saturation — most vivid first):
${accentCandidates.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}

RULES — STRICTLY FOLLOW:
- "background": use the BACKGROUND COLOR above (${bgCandidate ?? 'pick darkest from accents'})
- "surface": same as background, or slightly lighter/darker variant from the list
- "primary": pick the MOST VIVID/STRIKING brand color from BRAND/ACCENT list (the neon, the hero accent, the logo color)
- "secondary": second most prominent brand color from the list
- "accent": CTA/button color — pick the brightest or most contrasting from the list
- "text": ${isDarkImage ? '"#ffffff" or brightest color for dark background' : '"#1a1a1a" or darkest for light background'}
- "textMuted": ${isDarkImage ? 'a lighter muted tone' : 'a mid-grey tone'}
- Do NOT invent hex values — ONLY use values from the lists above\n`
    : `\nSample exact hex values from the image. "primary" = the most vivid brand accent. "background" = the page canvas.\n`;

  return `You are a brand designer. Analyze the attached image.
${colorPaletteBlock}
Also identify typography from the image letterforms:
- Ultra-bold condensed all-caps → headingStyle: "display"
- Clean geometric → "sans-serif"
- Elegant with serifs → "serif"
- Name the font if recognizable, otherwise describe it (e.g. "bold condensed sans-serif")

Respond ONLY with valid JSON. No preamble, no backticks, no explanation.
{
  "colors": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "background": "#hex",
    "surface": "#hex",
    "text": "#hex",
    "textMuted": "#hex"
  },
  "typography": {
    "headingFont": "font name or style description",
    "bodyFont": "font name or style description",
    "headingWeight": "700",
    "bodyWeight": "400",
    "headingStyle": "serif | sans-serif | display",
    "mood": "modern | classic | bold | minimal | playful"
  },
  "style": {
    "borderRadius": "sharp | soft | rounded",
    "spacing": "compact | comfortable | spacious",
    "vibe": "one sentence describing the overall brand vibe"
  }
}`;
}

function formatReferenceDesignBlock(tokens: ReferenceDesign): string {
  return `## REFERENCE DESIGN TOKENS (follow closely for all sections)
Primary color: ${tokens.colors.primary}
Secondary color: ${tokens.colors.secondary}
Accent: ${tokens.colors.accent}
Background: ${tokens.colors.background}
Heading font: ${tokens.typography.headingFont} (${tokens.typography.headingStyle})
Body font: ${tokens.typography.bodyFont}
Border radius style: ${tokens.style.borderRadius}
Overall vibe: ${tokens.style.vibe}
Apply these tokens consistently across all sections.
`;
}

function formatReferenceDesignShortBlock(tokens: ReferenceDesign): string {
  return `DESIGN REFERENCE: ${tokens.style.vibe}. Primary: ${tokens.colors.primary}. Typography: ${tokens.typography.headingFont}.`;
}

/**
 * Convert extracted ReferenceDesign tokens into Microsite CSS custom property format.
 * These map 1:1 to the --ms-* vars that Microsite.tsx reads from brand.extractedCssVariables.
 */
/** Parse a hex color string like "#rrggbb" into luminance 0-255 */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length < 6) return 128;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function referenceDesignToCssVars(tokens: ReferenceDesign): Record<string, string> {
  const headingFamily = `'${tokens.typography.headingFont}', sans-serif`;
  const bodyFamily = `'${tokens.typography.bodyFont}', sans-serif`;

  // Determine if the background is light or dark to fix text contrast
  const bgLum = hexLuminance(tokens.colors.background);
  const isLightBg = bgLum > 128;

  // On a light background: use dark text. On dark: use the extracted text color.
  const textColor     = isLightBg ? '#1a1a1a' : tokens.colors.text;
  const textMuted     = isLightBg ? '#555555' : tokens.colors.textMuted;
  const borderColor   = isLightBg ? '#e0e0e0' : `${tokens.colors.text}22`;
  const surfaceColor  = isLightBg
    ? tokens.colors.surface === tokens.colors.background
      ? '#ffffff'
      : tokens.colors.surface
    : tokens.colors.surface;

  return {
    '--ms-bg':           tokens.colors.background,
    '--ms-bg2':          surfaceColor,
    '--ms-bg3':          surfaceColor,
    '--ms-surface':      surfaceColor,
    '--ms-accent':       tokens.colors.primary,
    '--ms-hero-accent':  tokens.colors.primary,
    '--ms-accent2':      tokens.colors.secondary,
    '--ms-text':         textColor,
    '--ms-text2':        textMuted,
    '--ms-text3':        textMuted,
    '--ms-border':       borderColor,
    '--ms-font-heading': headingFamily,
    '--ms-font-body':    bodyFamily,
    '--ms-r-card':       tokens.style.borderRadius === 'sharp' ? '0px' : tokens.style.borderRadius === 'soft' ? '8px' : '16px',
    // Signal light/dark mode so Microsite.tsx resolves the correct base token set
    '--ms-is-dark':      isLightBg ? '0' : '1',
  };
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
  // approach and timeline must NOT use card-grid (suppresses diagrams) or minimal (suppresses diagrams)
  approach:     ['split',       'asymmetric', 'editorial',    'centered'],
  deliverables: ['card-grid',   'split',      'minimal'],
  timeline:     ['editorial',   'split',      'centered'],
  pricing:      ['centered',    'split',      'minimal'],
  whyus:        ['split',       'asymmetric', 'centered'],
  nextsteps:    ['centered',    'minimal',    'split'],
  testimonials: ['centered',    'editorial',  'card-grid'],
  showcase:     ['split',       'asymmetric', 'centered'],
  benefits:     ['card-grid',   'split',      'minimal'],
  problem:      ['asymmetric',  'editorial',  'centered'],
  stats:        ['centered',    'minimal',    'editorial'],
  metrics:      ['centered',    'minimal',    'editorial'],
  security:     ['card-grid',   'split',      'asymmetric'],
  techstack:    ['card-grid',   'split',      'minimal'],
  testing:      ['card-grid',   'minimal',    'editorial'],
  faq:          ['centered',    'minimal',    'editorial'],
  team:         ['card-grid',   'centered',   'minimal'],
  comparison:   ['centered',    'minimal',    'editorial'],
  casestudy:    ['split',       'editorial',  'asymmetric'],
  chart:        ['centered',    'editorial',  'minimal'],
  generic:      ['centered',    'split',      'minimal'],
};

/** Random fallback — used only when no intent is detected. */
function pickVariant(type: SectionType): string {
  const pool = VARIANT_POOLS[type] ?? VARIANT_POOLS.generic;
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
  approach:     'editorial',   // editorial allows diagrams
  deliverables: 'minimal',
  timeline:     'editorial',  // editorial allows diagrams
  pricing:      'minimal',
  whyus:        'editorial',
  nextsteps:    'minimal',
  testimonials: 'centered',
  showcase:     'editorial',
  benefits:     'minimal',
  problem:      'editorial',
  stats:        'centered',
  metrics:      'centered',
  security:     'editorial',
  techstack:    'editorial',
  testing:      'editorial',
  faq:          'editorial',
  team:         'card-grid',
  comparison:   'editorial',
  casestudy:    'editorial',
  chart:        'editorial',
  generic:      'editorial',
};

/** minimal intent: stripped, single-focus, clean.
 *  Alternates minimal ↔ centered for variety. */
const MINIMAL_VARIANTS: Record<SectionType, string> = {
  hero:         'centered',
  challenge:    'minimal',
  approach:     'split',      // approach needs diagrams — use split instead of minimal
  deliverables: 'minimal',
  timeline:     'centered',   // timeline needs diagrams — use centered instead of minimal
  pricing:      'centered',
  whyus:        'minimal',
  nextsteps:    'centered',
  testimonials: 'minimal',
  showcase:     'minimal',
  benefits:     'minimal',
  problem:      'centered',
  stats:        'minimal',
  metrics:      'minimal',
  security:     'minimal',
  techstack:    'minimal',
  testing:      'minimal',
  faq:          'minimal',
  team:         'minimal',
  comparison:   'minimal',
  casestudy:    'minimal',
  chart:        'minimal',
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
  metrics:      'centered',
  security:     'asymmetric',
  techstack:    'card-grid',
  testing:      'card-grid',
  faq:          'centered',
  team:         'card-grid',
  comparison:   'centered',
  casestudy:    'split',
  chart:        'centered',
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
  if (isEditorial) return EDITORIAL_VARIANTS[type] ?? EDITORIAL_VARIANTS.generic;
  if (isMinimal)   return MINIMAL_VARIANTS[type] ?? MINIMAL_VARIANTS.generic;
  if (isBold)      return BOLD_VARIANTS[type] ?? BOLD_VARIANTS.generic;
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
        const pool = (VARIANT_POOLS[type] ?? VARIANT_POOLS.generic).filter(x => x !== prev);
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
    const pool = (VARIANT_POOLS[type] ?? VARIANT_POOLS.generic).filter(x => x !== prev);
    const pick = pool.length > 0
      ? pool[Math.floor(Math.random() * pool.length)]
      : (VARIANT_POOLS[type] ?? VARIANT_POOLS.generic)[0];
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

// ── Custom SVG diagram prompt builder ─────────────────────────────────────────

function buildCustomSvgPrompt(typeId: string, _rawBody: string, _brief: string): string {
  if (typeId === 'orbital') {
    return `Extract the central system and 3-4 connected satellite systems from the content.
Return ONLY this JSON string prefixed with __CUSTOM_SVG__ (no markdown, no backticks):
__CUSTOM_SVG__{"type":"orbital","center":{"title":"Core System Name","subtitle":"What it does"},"satellites":[{"title":"System 1","description":"What it does","position":"top-left"},{"title":"System 2","description":"What it does","position":"top-right"},{"title":"System 3","description":"What it does","position":"bottom-left"}]}
Use REAL system names from the content. Max 4 satellites. Descriptions max 8 words.`;
  }
  if (typeId === 'puzzle') {
    return `Extract exactly 4 key architectural components from the content.
Return ONLY this JSON string prefixed with __CUSTOM_SVG__ (no markdown, no backticks):
__CUSTOM_SVG__{"type":"puzzle","pieces":[{"title":"Component 1","iconType":"gateway","position":"top-left","labelSide":"left"},{"title":"Component 2","iconType":"monitor","position":"top-right","labelSide":"right"},{"title":"Component 3","iconType":"stream","position":"bottom-left","labelSide":"left"},{"title":"Component 4","iconType":"storage","position":"bottom-right","labelSide":"right"}],"backgroundStyle":"gradient"}
Always 4 pieces. Choose iconType matching the component purpose. Use REAL component names from content.`;
  }
  return '';
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
  globalInstruction?: string,
  sectionInstruction?: string,
  proposalMarkdown?: string,
  diagramSelection?: DiagramSelection | null,
  referenceDesign?: ReferenceDesign | null,
): string {
  const refBlock = referenceDesign ? formatReferenceDesignBlock(referenceDesign) : '';
  const toneGuide = TONE_GUIDE[tone] ?? TONE_GUIDE.authoritative;
  const brandCtx = brandName ? ` The proposing company is "${brandName}" — use this name consistently in copy.` : '';
  const character = characterOverride ?? (plugin ? PLUGIN_CHARACTER[plugin] : undefined);
  const meta = preassignedVariant ? `"variant": "${preassignedVariant}"` : '';
  const pluginCtx = character ? ` DESIGN VOICE: ${character} — let this shape word choice, sentence rhythm, and emotional register.` : '';
  const angle = pickAngle();
  const generationNote = aiGenerated
    ? ' NOTE: This section has NO source content — generate it entirely from the proposal brief and context. Make it feel native and coherent, not bolted-on.'
    : '';
  const overridePrefix = customInstructions
    ? `⚡⚡⚡ USER OVERRIDE — READ THIS FIRST, APPLY BEFORE ALL OTHER RULES ⚡⚡⚡\n${customInstructions}\n⚡⚡⚡ END OVERRIDE ⚡⚡⚡\n\n`
    : '';
  // sectionInstruction takes priority over globalInstruction; injected at very top of system prompt
  const activeInstruction = sectionInstruction ?? globalInstruction ?? '';
  const instructionPrefix = activeInstruction
    ? `⚡⚡⚡ SECTION INSTRUCTION — HIGHEST PRIORITY — APPLY BEFORE ALL OTHER RULES ⚡⚡⚡\n${activeInstruction}\n⚡⚡⚡ END SECTION INSTRUCTION ⚡⚡⚡\n\n`
    : '';

  // Build concise diagram field instruction (replaces verbose Gamma prompt to avoid LLM confusion)
  const isCustomSvgDiagram = diagramSelection?.diagramType.isCustomSvg === true;

  let diagramBlock: string | null = null;
  if (diagramSelection) {
    if (isCustomSvgDiagram) {
      const customPrompt = buildCustomSvgPrompt(diagramSelection.diagramType.id, rawBody ?? '', brief ?? '');
      diagramBlock = `[DIAGRAM FIELD — CUSTOM SVG] For the "diagram" field only: ${customPrompt}`;
    } else {
      diagramBlock = `[DIAGRAM FIELD] For the "diagram" field only: Use ${diagramSelection.diagramType.mermaidDirective} syntax (${diagramSelection.diagramType.label}). First line MUST be exactly: ${diagramSelection.diagramType.mermaidDirective}. Node/item labels: plain text only, NO double quotes inside brackets — write A[Frontend] not A["Frontend"]. Max ${diagramSelection.diagramType.maxNodes} nodes. Return as a single JSON string with newlines escaped as \\\\n.`;
    }
  }

  const mermaidRules = diagramBlock
    ? (isCustomSvgDiagram
        ? `CUSTOM DIAGRAM: Include the "diagram" field. ${diagramBlock}`
        : `MERMAID: Include the "diagram" field. ${diagramBlock}`)
    : `MERMAID RULES: If you include a "diagram" field, the value must be raw Mermaid syntax as a single JSON string — NO backticks, escape newlines as \\n, max 5 nodes/tasks. Node labels: plain text only, NO double quotes inside brackets. If you cannot make a meaningful diagram from the content, set "diagram": null.`;

  const system = `${refBlock}${instructionPrefix}${overridePrefix}You are a senior UX copywriter for B2B proposal microsites. Write with precision and confidence. No cliches. ${FORBIDDEN} ${FORBIDDEN_OPENERS} TONE: ${toneGuide}.${brandCtx}${pluginCtx}${generationNote} CREATIVE ANGLE FOR THIS GENERATION: ${angle} ${mermaidRules} Return ONLY valid JSON. No markdown, no explanation, no code fences.`;

  const effectiveBody = rawBody?.trim() || '';
  // When effectiveBody is empty, pass the full proposal — no truncation, no data loss
  const fallbackContext = (!effectiveBody && proposalMarkdown)
    ? `\n\nFull proposal (use ALL relevant data from this to populate the section):\n${proposalMarkdown}`
    : (proposalMarkdown ? `\n\nFull proposal for additional context:\n${proposalMarkdown.slice(0, 4000)}` : '');

  const sectionPrompts: Record<SectionType, string> = {
    hero: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

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
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene matching this industry and proposal tone. Describe subject, lighting, mood, color palette. e.g. 'Dark futuristic server room corridor with blue and purple holographic data streams, dramatic cinematic lighting, 4K professional photography'",
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    challenge: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Challenge section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words, the core tension",
  "body": "2-3 sentences, real stakes, what if nothing changes",
  "pullquote": "sharpest insight, 10-18 words, standalone quote",
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  "diagram": "${diagramBlock ? 'Required — see DIAGRAM REQUIRED block above' : 'optional graph TD showing causal chain/impact cascade (max 4 nodes). Only include if content has a clear cause→effect chain. Otherwise null.'}",
  ${meta}
}`,

    approach: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into an Approach section with pillars. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "subheadline": "1-2 sentences",
  "pillars": [{"iconHint": "identity|digital|content|strategy|research|launch", "name": "2-4 words", "description": "2 sentences, specific outcomes"}],
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  "diagram": "${diagramBlock ? 'Required — see DIAGRAM REQUIRED block above' : 'graph LR showing the methodology as a process flow. Nodes = pillar names (2-3 words each). Max 5 nodes connected with -->. Example: graph LR\\n  A[Discover] --> B[Design] --> C[Build] --> D[Launch]. Always include this field.'}",
  ${meta}
}`,

    deliverables: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Deliverables section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "items": [{"iconHint": "identity|document|website|content|photo|campaign|strategy", "name": "2-5 words", "detail": "1 sentence, what it enables"}],
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    timeline: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Timeline section. Use EXACT phase names and durations from the source content. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "subheadline": "1-2 sentences",
  "phases": [{"label": "from raw data", "duration": "e.g. 2 weeks", "name": "2-4 words", "description": "1 sentence, activity + outcome"}],
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  "diagram": "${diagramBlock ? 'Required — see DIAGRAM REQUIRED block above' : 'gantt chart. Format: gantt\\n  title Project Schedule\\n  dateFormat YYYY-MM-DD\\n  section Phase 1\\n  PhaseName :a1, 2026-01-01, 14d\\n  section Phase 2\\n  PhaseName :a2, after a1, 14d. Always include if 2+ phases exist.'}",
  ${meta}
}`,

    pricing: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Pricing section. CRITICAL: Extract EVERY line item, price, cost, and amount from the source content above. Use exact figures (e.g. "$45,000", "€2,400/mo", "£180/hr"). Return:
{
  "eyebrow": "4-8 words e.g. 'Investment Overview'",
  "headline": "8-12 words, frame value not cost",
  "subheadline": "1-2 sentences, what the investment unlocks",
  "rows": [
    ["Service / Deliverable", "Investment"],
    ["Line item from proposal", "Exact price from proposal"],
    ["Second line item", "Exact price"],
    ["...more rows as needed from the proposal..."]
  ],
  "totalLabel": "Total: [exact total from proposal, e.g. '$95,000']",
  "footnote": "payment terms, start date, or notes from the proposal",
  "cta": "3-5 words",
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  ${meta}
}`,

    whyus: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Why Us section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "body": "2-3 sentences",
  "stats": [{"number": "from content", "label": "2-4 words", "context": "1 short sentence"}],
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  "diagram": "${diagramBlock ? 'Required — see DIAGRAM REQUIRED block above' : 'optional pie chart if stats suggest a meaningful distribution. Format: pie title Label\\n  \\"Category A\\" : 60\\n  \\"Category B\\" : 30. Only include if a clear distribution is evident. Otherwise null.'}",
  ${meta}
}`,

    nextsteps: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Next Steps section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "body": "2-3 sentences",
  "ctaPrimary": "3-5 words — empty string if constraints say no CTA",
  "ctaSecondary": "3-4 words — empty string if constraints say no CTA",
  "urgencyNote": "string or null",
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    testimonials: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from proposal below)'}${fallbackContext}

Generate a Testimonials section. Create 2-3 realistic quotes that reflect the client relationship, industry, and outcomes described in the brief. Quotes should feel authentic — specific, not generic. Names and companies should be plausible but clearly fictional (not real companies). Return:
{
  "eyebrow": "4-8 words e.g. 'Client Voices'",
  "headline": "8-12 words",
  "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content",
  "diagram": null,
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
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Showcase section — a visual feature spotlight. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-14 words, a bold capability statement",
  "subheadline": "1-2 sentences, what this makes possible",
  "body": "2-3 sentences, the 'so what' — impact and differentiation",
  "highlights": ["3-5 short feature pills, 3-6 words each, noun phrases"],
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene that visually represents this feature or capability. Striking, dramatic, high-detail. e.g. 'Abstract digital architecture with neon blue geometric shapes, dark background, ultra-detailed'",
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    benefits: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from proposal below)'}${fallbackContext}

Transform into a Benefits section — a focused icon list of value propositions. Return:
{
  "eyebrow": "4-8 words e.g. 'What You Gain'",
  "headline": "8-12 words",
  "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content",
  "items": [
    {
      "iconHint": "identity|digital|content|strategy|research|launch|document|website|photo|campaign",
      "title": "2-5 words, the benefit",
      "description": "1-2 sentences, concrete and specific — what does the client actually get?"
    }
  ],
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    problem: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from proposal below)'}${fallbackContext}

Transform into a Problem section — sharper and more urgent than a challenge section. This is the 'why act now' framing. Return:
{
  "eyebrow": "4-8 words e.g. 'The Real Cost of Waiting'",
  "headline": "8-14 words, urgent and specific — name the consequence not just the problem",
  "body": "2-3 sentences, make the cost of inaction visceral and concrete",
  "painPoints": ["3-5 pain points, each 6-12 words, start with a verb or cost noun — specific, not vague"],
  "imageQuery": "DALL-E 3 prompt: tense, dramatic cinematic scene conveying urgency and consequence. Dark mood, high contrast lighting. e.g. 'Crumbling concrete infrastructure with red emergency lighting, dramatic shadows, cinematic photography'",
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    stats: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from proposal below)'}${fallbackContext}

Transform into a Stats section — a standalone impact metrics row. Return:
{
  "eyebrow": "4-8 words e.g. 'By The Numbers'",
  "headline": "8-12 words",
  "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content",
  "stats": [
    {
      "number": "specific metric e.g. '94%' or '3× faster' or '$2.4M' — from content or reasonably derived from brief",
      "label": "2-4 words",
      "context": "1 short sentence explaining what this means"
    }
  ],
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    metrics: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — derive 3-4 strong KPIs from the brief outcomes, duration, and value)'}

Transform into a Metrics section — a standalone performance KPIs row with scaling strategies. Return:
{
  "eyebrow": "4-8 words e.g. 'Performance at Scale'",
  "headline": "8-12 words",
  "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content",
  "stats": [
    {
      "number": "specific metric e.g. '99.9%' or '3× faster' — from content or brief",
      "label": "2-4 words",
      "context": "1 short sentence what this means"
    }
  ],
  "strategies": ["3-5 scaling strategies, each 5-10 words, start with a verb"],
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,

    security: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — derive 3-4 security controls from the brief and industry context)'}

Transform into a Security section. Return:
{
  "eyebrow": "4-8 words e.g. 'Built for Compliance'",
  "headline": "8-12 words",
  "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content",
  "items": [
    {
      "iconHint": "identity|digital|strategy|research",
      "name": "2-5 words, the security control",
      "description": "1-2 sentences, what it protects and how"
    }
  ],
  "diagram": "${diagramBlock ? 'Required — see DIAGRAM REQUIRED block above' : 'graph TD showing security layers top-to-bottom. Example: graph TD\\n  A[Identity & Access] --> B[Encryption]\\n  B --> C[Network Security]\\n  C --> D[Compliance & Audit]. Use item names as node labels. Always include this field.'}",
  ${meta}
}`,

    techstack: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — derive categories from the brief industry and engagement context)'}

Transform into a Tech Stack section. Return:
{
  "eyebrow": "4-8 words e.g. 'Built on Modern Foundations'",
  "headline": "8-12 words",
  "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content",
  "categories": [
    {
      "iconHint": "identity|digital|content|strategy|research|launch|document|website",
      "name": "1-3 words, the category e.g. 'Frontend', 'Backend', 'Database'",
      "items": ["2-5 technology names in this category"]
    }
  ],
  "diagram": "${diagramBlock ? 'Required — see DIAGRAM REQUIRED block above' : 'graph LR showing tech stack layers left-to-right. Example: graph LR\\n  A[Frontend] --> B[Backend]\\n  B --> C[Database]\\n  C --> D[Cloud / Infra]. Use category names as node labels. Max 5 nodes. Always include this field.'}",
  ${meta}
}`,

    testing: `${system}

Brief: ${brief}
Raw content: ${rawBody || '(No source content — derive testing layers from the brief engagement context)'}

Transform into a Testing & Quality section. Return:
{
  "eyebrow": "4-8 words e.g. 'Quality Built In'",
  "headline": "8-12 words",
  "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content",
  "layers": [
    {
      "level": 1,
      "name": "Layer name e.g. 'Unit Tests'",
      "coverage": "percentage or metric e.g. '90%'",
      "description": "1 sentence what this layer validates"
    }
  ],
  "additionalInfo": [
    {
      "heading": "2-4 words",
      "body": "1-2 sentences"
    }
  ],
  "diagram": "${diagramBlock ? 'Required — see DIAGRAM REQUIRED block above' : 'graph LR showing testing pyramid left-to-right. Example: graph LR\\n  A[Unit Tests] --> B[Integration]\\n  B --> C[E2E Tests]\\n  C --> D[Performance]. Use layer names as node labels. Always include this field.'}",
  ${meta}
}`,

    faq: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a FAQ section. Return:
{
  "eyebrow": "4-8 words e.g. 'Common Questions'",
  "headline": "8-12 words",
  "subheadline": "1-2 sentences or null",
  "items": [
    {
      "question": "A realistic question a prospect would ask, 8-16 words",
      "answer": "2-3 sentences, specific and reassuring — address the real concern behind the question"
    }
  ],
  ${meta}
}`,

    team: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Team section. Return:
{
  "eyebrow": "4-8 words e.g. 'Meet the Team'",
  "headline": "8-12 words",
  "subheadline": "1-2 sentences or null",
  "members": [
    {
      "name": "First Last",
      "role": "2-4 words, job title",
      "bio": "2-3 sentences, expertise and relevance to this engagement",
      "iconHint": "identity|strategy|research|digital|content|launch"
    }
  ],
  ${meta}
}`,

    comparison: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Comparison section showing our advantage vs alternatives. Return:
{
  "eyebrow": "4-8 words e.g. 'Why Choose Us'",
  "headline": "8-12 words",
  "subheadline": "1-2 sentences or null",
  "usLabel": "2-4 words, our name/label",
  "themLabel": "2-4 words, competitor label e.g. 'Others' or 'Traditional Agencies'",
  "rows": [
    {
      "feature": "3-6 words, the capability or attribute being compared",
      "us": "Short value or '✓' for yes",
      "them": "'✗' for no, or a short weaker value"
    }
  ],
  ${meta}
}`,

    casestudy: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Case Study section with a challenge-solution-outcome narrative plus metrics. Return:
{
  "eyebrow": "4-8 words e.g. 'Case Study'",
  "headline": "8-14 words, the transformation story headline",
  "challenge": "2-3 sentences describing the client's core problem and its consequences",
  "solution": "2-3 sentences describing the approach and what made it different",
  "outcome": "2-3 sentences describing measurable results and lasting impact",
  "metrics": [
    {
      "value": "specific metric e.g. '3×' or '94%' or '$2.4M'",
      "label": "2-4 words, what was achieved"
    }
  ],
  "imageQuery": "DALL-E 3 prompt: cinematic scene showing transformation, success, or breakthrough. High contrast, dramatic lighting.",
  ${meta}
}`,

    chart: `${system}

Brief: ${brief}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a Chart section. Choose the best chart type for the data: bar (comparisons), line (trends over time), pie (parts of a whole), donut (same with center label). Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words",
  "body": "1-2 sentences explaining what the chart shows or null",
  "chartType": "bar | line | pie | donut",
  "unit": "unit suffix e.g. '%' or 'k' or '$M' — or null",
  "data": [
    {
      "label": "2-4 words, the data point label",
      "value": numeric_value
    }
  ],
  ${meta}
}`,

    generic: `${system}

Brief: ${brief}
Section heading: ${heading}
Section source content: ${effectiveBody || '(derive from brief above)'}${fallbackContext}

Transform into a website section. Return:
{
  "eyebrow": "4-8 words",
  "headline": "8-12 words, compelling rewrite of '${heading}'",
  "body": "2-4 sentences, rewritten content",
  "imageQuery": "DALL-E 3 prompt: cinematic photorealistic scene relevant to this section content. Describe subject, lighting, mood. e.g. 'Modern glass office with soft directional lighting, executive collaboration, professional photography, 4K'",
  ${diagramBlock ? '"diagram": "Required — see DIAGRAM REQUIRED block above",' : ''}
  ${meta}
}`,
  };

  return sectionPrompts[type];
}

// ── Safe JSON parser (strips LLM code fences before parsing) ─────────────────

/**
 * Repair common LLM JSON mistakes: literal newlines/carriage-returns inside
 * string values (which break JSON.parse).  We walk the text character-by-character
 * tracking whether we are inside a string so we only escape control characters
 * that appear within strings, not JSON structural whitespace.
 */
function repairLiteralNewlines(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (escaped) { out += c; escaped = false; continue; }
    if (c === '\\' && inString) { out += c; escaped = true; continue; }
    if (c === '"') { inString = !inString; out += c; continue; }
    if (inString && c === '\n') { out += '\\n'; continue; }
    if (inString && c === '\r') { out += '\\r'; continue; }
    if (inString && c === '\t') { out += '\\t'; continue; }
    out += c;
  }
  return out;
}

/**
 * Nullifies the "diagram" field value in a JSON string so the rest can be parsed.
 * Handles cases where the LLM emits unescaped double quotes inside the diagram string
 * (e.g. A["Label"]) which makes the JSON structurally invalid.
 */
function stripDiagramField(json: string): string {
  // Preserve custom SVG diagram fields — only nullify standard mermaid fields with broken quotes
  if (json.includes('__CUSTOM_SVG__')) {
    return json.replace(/"diagram"\s*:\s*"(?:[^"\\]|\\.)*"/, (match) => {
      if (match.includes('__CUSTOM_SVG__')) return match;
      return '"diagram": null';
    });
  }
  return json.replace(/"diagram"\s*:\s*"(?:[^"\\]|\\.)*"/, '"diagram": null');
}

function safeParseJSON(text: string): Record<string, unknown> | null {
  const stripped = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  // Direct parse first
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch { /* fall through */ }
  // LLM added preamble/postamble text — extract JSON object from within
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const block = stripped.slice(start, end + 1);
    try {
      return JSON.parse(block) as Record<string, unknown>;
    } catch { /* fall through */ }
    // LLM emitted literal newlines inside string values — repair and retry
    try {
      return JSON.parse(repairLiteralNewlines(block)) as Record<string, unknown>;
    } catch { /* fall through */ }
    // Last resort: diagram field has unescaped quotes — nullify it and retry
    try {
      const withoutDiagram = stripDiagramField(block);
      if (withoutDiagram !== block) {
        return JSON.parse(repairLiteralNewlines(withoutDiagram)) as Record<string, unknown>;
      }
    } catch { /* fall through */ }
  }
  return null;
}

// ── Diagram normalizer ────────────────────────────────────────────────────────

function normalizeDiagram(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;

  // 0. Pass through custom SVG diagram data unchanged
  const trimmed = raw.trim();
  if (trimmed.startsWith('__CUSTOM_SVG__')) return trimmed;

  // 1. Strip markdown code fences
  let s = trimmed
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

  return `${customInstructions ? `⚡ OVERRIDE DIRECTIVE — HIGHEST PRIORITY (supersedes all rules below, including structure, sections, and tone):\n${customInstructions}\n\n` : ''}You are a world-class copywriter creating a professional presentation website.

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

SOURCE MATERIAL (use for facts only — rewrite ALL language):

${sectionBlock}

Generate the presentation website copy now:`;
}

// ── Image resolution via DALL-E 3 (falls back to loremflickr) ────────────────

/** Generate an AI image via DALL-E 3.
 *  Appends a cinematic style suffix so all images share the Gamma-style aesthetic. */
async function generateDalleImage(query: string, apiKey: string): Promise<string | null> {
  const prompt = `${query}. Cinematic photorealistic, dramatic professional lighting, ultra high quality, no text, no watermarks, no logos.`;
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1792x1024',
        quality: 'standard',
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ url?: string }> };
    return data.data?.[0]?.url ?? null;
  } catch {
    return null;
  }
}

/** Convert a free-text imageQuery into a loremflickr URL (fallback). */
function queryToFlickrUrl(query: string): string {
  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3)
    .join(',');
  const tags = keywords || 'business,professional';
  let hash = 5381;
  for (let i = 0; i < query.length; i++) hash = ((hash << 5) + hash) ^ query.charCodeAt(i);
  const lock = Math.abs(hash) % 9999;
  return `https://loremflickr.com/1200/800/${tags}?lock=${lock}`;
}

async function resolveImageUrl(query: string): Promise<string | null> {
  if (!query) return null;

  // Try DALL-E 3 first when OpenAI key is available
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const aiUrl = await generateDalleImage(query, openaiKey);
    if (aiUrl) return aiUrl;
  }

  // Fall back to loremflickr
  try {
    const url = queryToFlickrUrl(query);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok && res.url && !res.url.includes('loremflickr.com/image/flash')) {
      return res.url;
    }
    return url;
  } catch {
    return null;
  }
}

// ── Plan type ─────────────────────────────────────────────────────────────────

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

// ── Parsed command interface (output of command parser LLM pass) ──────────────

export interface ParsedCommand {
  designOverrides: {
    plugin?: string;
    sectionLayout?: Partial<Record<SectionType, string>>;
    imageStyle?: string;
    typographyScale?: string;
    accentColor?: string;
  };
  contentOverrides: {
    tone?: string;
    sectionsToHide?: SectionType[];
    sectionsToAdd?: SectionType[];
    sectionInstructions?: Partial<Record<SectionType, string>>;
    globalInstruction?: string;
  };
}

const DEFAULT_PARSED_COMMAND: ParsedCommand = {
  designOverrides: {},
  contentOverrides: {},
};

// ── Design overrides applicator ───────────────────────────────────────────────

function applyDesignOverrides(
  ast: Record<string, unknown>,
  overrides: ParsedCommand['designOverrides'],
): void {
  // Plugin swap
  if (overrides.plugin && typeof overrides.plugin === 'string') {
    ast.plugin = overrides.plugin;
  }

  // Per-section layout variants
  if (overrides.sectionLayout && Object.keys(overrides.sectionLayout).length > 0) {
    const sections = Array.isArray(ast.sections) ? (ast.sections as Array<Record<string, unknown>>) : [];
    for (const section of sections) {
      const sType = section.sectionType as SectionType;
      const variant = overrides.sectionLayout[sType];
      if (variant) {
        const content = section.content as Record<string, unknown> | undefined;
        if (content) {
          content.variant = variant;
          const ui = content.ui as Record<string, unknown> | undefined;
          if (ui) ui.layout = variant;
        }
      }
    }
  }

  // Image style — stored in customTokens for renderer consumption
  if (overrides.imageStyle && typeof overrides.imageStyle === 'string') {
    const customTokens = ast.customTokens as Record<string, unknown> | undefined;
    if (customTokens) {
      customTokens.imageStyle = overrides.imageStyle;
    } else {
      ast.customTokens = { imageStyle: overrides.imageStyle };
    }
  }

  // Typography scale
  if (overrides.typographyScale && typeof overrides.typographyScale === 'string') {
    const ds = ast.customDesignSystem as Record<string, unknown> | undefined;
    if (ds) {
      const typo = ds.typography as Record<string, unknown> | undefined;
      if (typo) {
        typo.scale = overrides.typographyScale;
      } else {
        ds.typography = { scale: overrides.typographyScale };
      }
    }
  }

  // Accent color
  if (overrides.accentColor && typeof overrides.accentColor === 'string' && overrides.accentColor.startsWith('#')) {
    const customTokens = ast.customTokens as Record<string, unknown> | undefined;
    if (customTokens) {
      customTokens.accent = overrides.accentColor;
    } else {
      ast.customTokens = { accent: overrides.accentColor };
    }
  }
}

// ── Full design prompt override builders ──────────────────────────────────────
// These are called instead of the default builders when metadata.fullDesignPrompt
// is provided and isFullOverride is true. They prepend the fullDesignPrompt at the
// top of every prompt so the LLM follows the custom design spec exactly.
// NOTE: These functions must NOT reference PLUGIN_CHARACTER, FORBIDDEN, or FORBIDDEN_OPENERS.

function buildOverrideSectionPlanPrompt(
  markdown: string,
  fullDesignPrompt: string
): string {
  // Programmatically extract numbered sections from the design prompt's LAYOUT STRUCTURE
  const layoutMatches = fullDesignPrompt.match(/^(\d+)\.\s+(.+?)(?:\r?\n|$)/gm) ?? [];
  const layoutSections = layoutMatches.map(m => m.replace(/^\d+\.\s+/, '').trim());

  const layoutHint = layoutSections.length > 0
    ? `\nThe design specification mentions these layout sections as visual reference:\n` +
      layoutSections.map((s, i) => `  ${i + 1}. ${s}`).join('\n') +
      `\nUse these as TYPE MAPPING HINTS — map them to the appropriate section types below. Then add additional sections from the proposal to reach 12-13 total.\n`
    : '';

  return `${fullDesignPrompt}

---

You are a section planning expert. Produce a comprehensive microsite plan that follows the visual design specification above and covers the FULL proposal content.
${layoutHint}
TYPE MAPPING (choose closest match for each section name):
- Hero / Welcome / Introduction → hero
- Executive Summary / Overview / About → approach or generic
- Solution / Features / Services / What We Offer → approach or deliverables or benefits
- Timeline / Journey / Process / Steps / Schedule / Roadmap → timeline
- Highlights / Fun Facts / Proof / Results / Stats → stats
- Pricing / Packages / Investment / Cost → pricing
- Call To Action / Footer / Next Steps / Get Started / Contact → nextsteps
- Why Us / Credentials / Trust / Team / Differentiators → whyus
- Challenge / Problem / Pain Points → challenge
- Testimonials / Reviews / Client Said → testimonials
- Showcase / Case Study / Features → showcase

MANDATORY RULES:
- Output a JSON array with 12-13 sections, minimum 10 sections
- You MUST include ALL of these core types (generate content from proposal brief if no direct source):
  hero, problem OR challenge, approach, deliverables OR showcase,
  timeline, pricing, stats, benefits, whyus, testimonials, nextsteps
- Set aiGenerated: true for sections with no direct source content
- NEVER output fewer than 10 sections
- The hero is always first, nextsteps is always last
- Each section must have a unique type — do NOT repeat the same type twice

VALID TYPES: hero, challenge, approach, deliverables, timeline, pricing, whyus, nextsteps, testimonials, showcase, benefits, problem, stats, generic

Return ONLY valid JSON array. No markdown, no explanation, no code fences.

PROPOSAL:
${markdown.slice(0, 8000)}`;
}

function buildOverrideBriefPrompt(
  markdown: string,
  fullDesignPrompt: string,
  brandHint?: { companyName?: string; tagline?: string }
): string {
  const hint = brandHint?.companyName
    ? `\nThe proposing company is "${brandHint.companyName}". Use this name for proposingCompany.\n`
    : '';

  // IMPORTANT: facts (client, industry, challenge, value) come from the PROPOSAL only.
  // The design prompt ONLY influences writing style/tone — never what the facts are.
  const styleHint = `\nWRITING STYLE GUIDANCE (from the user's design specification): ${fullDesignPrompt.slice(0, 600).replace(/\n/g, ' ')}\n`;

  return `You are a senior proposal strategist. Extract a structured brief from the proposal below. Return ONLY valid JSON. No markdown, no explanation, no code fences.
${hint}${styleHint}
RULES:
- clientName, clientIndustry, clientChallenge, proposingCompany, totalValue, duration — extract EXACTLY from the proposal text. Do NOT invent or guess these.
- primaryTone — derive from the proposal's subject matter and industry (e.g. "Professional and technical" for IT, "Clinical and precise" for healthcare). Ignore the design spec for this field.
- heroNarrative — 8-12 words capturing the proposal's core value. Must NOT start with We/Our.
- industryKeywords — 3-5 keywords for professional stock image searches that match the client's actual industry.

{
  "clientName": "string — extract from proposal",
  "clientIndustry": "string — extract from proposal",
  "clientChallenge": "1 concise sentence extracted from proposal",
  "proposingCompany": "string — extract from proposal",
  "proposingStrength": "most impressive credential mentioned in the proposal, 1 sentence",
  "engagementSummary": "2 sentences summarising the engagement scope from the proposal",
  "keyOutcomes": ["max 4 concrete outcomes stated in the proposal"],
  "totalValue": "string — extract from proposal pricing section",
  "duration": "string — extract from proposal",
  "primaryTone": "derive from the proposal industry and subject matter",
  "heroNarrative": "8-12 words capturing the proposal's core value proposition",
  "industryKeywords": ["3-5 keywords matching the client's actual industry for image searches"]
}

PROPOSAL:
${markdown}`;
}

function buildOverrideSectionPrompt(
  type: SectionType,
  heading: string,
  rawBody: string,
  brief: string,
  fullDesignPrompt: string,
  brandName?: string,
  aiGenerated = false,
  diagramSelection?: DiagramSelection | null
): string {
  const brandCtx = brandName
    ? `The proposing company is "${brandName}" — use this name consistently.`
    : '';

  const generationNote = aiGenerated
    ? 'NOTE: This section has NO source content — generate it entirely from the proposal brief and the design specification above.'
    : '';

  let diagramBlock = 'Set "diagram": null for this section.';
  if (diagramSelection) {
    diagramBlock = `DIAGRAM REQUIREMENT: Generate a diagram field using type: ${diagramSelection.diagramType.id}
${diagramSelection.diagramType.isCustomSvg
  ? 'Output: __CUSTOM_SVG__ followed immediately by valid JSON for this diagram type'
  : 'Output: raw Mermaid syntax only, no backticks, escape newlines as \\\\n'
}
If content is insufficient for this diagram, set diagram to null.`;
  }

  const sectionSchemas: Record<string, string> = {
    hero: `{ "eyebrow": "4-8 words", "headline": "8-14 words", "subheadline": "1-2 sentences max 28 words", "body": "2-3 sentences", "ctaPrimary": "3-5 words", "ctaSecondary": "3-4 words", "imageQuery": "Unsplash search query that matches the VISUAL STYLE and THEME described in the design specification above — reflect the exact mood, colors, subject matter, and aesthetic (e.g. for a child-friendly colorful design: 'colorful playful children learning illustration' not 'business team meeting')", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    challenge: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "body": "2-3 sentences", "pullquote": "10-18 words sharpest insight", "imageQuery": "Unsplash query matching the visual theme and mood from the design specification above", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    approach: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "subheadline": "1-2 sentences", "pillars": [{"iconHint": "string", "name": "2-4 words", "description": "2 sentences"}], "imageQuery": "Unsplash query matching the visual theme and mood from the design specification above", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    deliverables: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "items": [{"iconHint": "string", "name": "2-5 words", "detail": "1 sentence"}], "imageQuery": "Unsplash query matching the visual theme and mood from the design specification above", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    timeline: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "subheadline": "1-2 sentences", "phases": [{"label": "string", "duration": "string", "name": "2-4 words", "description": "1 sentence"}], "imageQuery": "Unsplash query matching the visual theme and mood from the design specification above", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    pricing: `CRITICAL: Extract EVERY line item, price, cost, and amount from the source content. Use exact figures (e.g. '$45,000', '€2,400/mo', '£180/hr'). Never return an empty rows array — if you see any pricing data in the source, include it.
{ "eyebrow": "4-8 words", "headline": "8-12 words", "subheadline": "1-2 sentences", "rows": [["Service / Deliverable", "Investment"], ["Line item from proposal", "Exact price from proposal"], ["...more rows as needed from the proposal..."]], "totalLabel": "Total: [exact total from proposal]", "footnote": "payment terms or notes from the proposal", "cta": "3-5 words", "imageQuery": "Unsplash query matching the visual theme and mood from the design specification above", "diagram": null }`,
    whyus: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "body": "2-3 sentences", "stats": [{"number": "string", "label": "2-4 words", "context": "1 sentence"}], "imageQuery": "Unsplash query matching the visual theme and mood from the design specification above", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    nextsteps: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "body": "2-3 sentences", "ctaPrimary": "3-5 words", "ctaSecondary": "3-4 words", "urgencyNote": "string or null", "imageQuery": "Unsplash query matching the visual theme and mood from the design specification above", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    testimonials: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content", "items": [{"quote": "1-2 sentences", "name": "string", "title": "string", "company": "string"}], "diagram": null }`,
    showcase: `{ "eyebrow": "4-8 words", "headline": "8-14 words", "subheadline": "1-2 sentences", "body": "2-3 sentences", "highlights": ["3-5 short feature pills"], "imageQuery": "Unsplash query", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    benefits: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content", "items": [{"iconHint": "string", "title": "2-5 words", "description": "1-2 sentences"}], "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    problem: `{ "eyebrow": "4-8 words", "headline": "8-14 words", "body": "2-3 sentences", "painPoints": ["3-5 items 6-12 words each"], "imageQuery": "Unsplash query", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    stats: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "imageQuery": "Unsplash search query: 3-5 words describing the visual mood and subject matching this section content", "stats": [{"number": "string", "label": "2-4 words", "context": "1 sentence"}], "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
    generic: `{ "eyebrow": "4-8 words", "headline": "8-12 words", "body": "2-4 sentences", "imageQuery": "Unsplash query", "diagram": "Mermaid or custom SVG diagram — see DIAGRAM REQUIREMENT above. If no diagram, set null." }`,
  };

  const schema = sectionSchemas[type] ?? sectionSchemas.generic;

  return `${fullDesignPrompt}

---

CRITICAL INSTRUCTION: Follow the design specification above EXACTLY and STRICTLY.
Every word, phrase, tone, style, and personality in the specification above must be reflected in your output.
DO NOT use default professional/corporate tone. OVERRIDE all defaults.

${brandCtx}
${generationNote}
${diagramBlock}

Generate content for the "${heading}" section (type: ${type}).

Brief context: ${brief}
Source content: ${rawBody || '(No source — generate from brief and design specification above)'}

Return ONLY valid JSON matching this shape. No markdown, no explanation, no code fences:
${schema}`;
}

function buildOverrideMarkdownPrompt(
  sections: Array<{ name: string; content: string }>,
  fullDesignPrompt: string,
  designConfig?: Record<string, unknown>
): string {
  const sectionBlock = sections
    .map(s => `### ${s.name}\n${s.content}`)
    .join('\n\n---\n\n');

  const outputLanguage = (designConfig?.outputLanguage as string) || 'English';

  return `${fullDesignPrompt}

---

CRITICAL: Follow the design specification above EXACTLY for ALL copy.
Every sentence must reflect the personality, tone, voice, and style described above.
Override all default corporate/professional tone.
Output language: ${outputLanguage}

Rewrite this proposal content as polished microsite copy matching the design specification:

${sectionBlock}

Generate microsite copy following the design specification strictly:`;
}

// ── Required section enforcement ─────────────────────────────────────────────

const REQUIRED_SECTION_TYPES = [
  'hero', 'problem', 'challenge', 'approach', 'deliverables',
  'timeline', 'pricing', 'stats', 'benefits', 'whyus',
  'testimonials', 'nextsteps',
] as const;

function ensureRequiredSections(plan: SectionPlan[]): SectionPlan[] {
  const presentTypes = new Set(plan.map(s => s.type));
  const additions: SectionPlan[] = [];

  for (const required of REQUIRED_SECTION_TYPES) {
    const hasEquivalent =
      presentTypes.has(required as SectionType) ||
      (required === 'problem' && presentTypes.has('challenge' as SectionType)) ||
      (required === 'challenge' && presentTypes.has('problem' as SectionType)) ||
      (required === 'deliverables' && presentTypes.has('showcase' as SectionType));

    if (!hasEquivalent) {
      additions.push({
        type: required as SectionType,
        sourceHeading: null,
        rationale: 'Required section — generated from proposal brief',
        aiGenerated: true,
      });
    }
  }

  if (additions.length === 0) return plan;

  const nextstepsIdx = plan.findIndex(s => s.type === 'nextsteps');
  if (nextstepsIdx >= 0) {
    return [
      ...plan.slice(0, nextstepsIdx),
      ...additions,
      ...plan.slice(nextstepsIdx),
    ];
  }
  return [...plan, ...additions];
}

// Preferred substitute types when a duplicate is found, in priority order
const DEDUP_SUBSTITUTES: SectionType[] = [
  'showcase', 'benefits', 'deliverables', 'approach', 'problem', 'challenge',
];

/** Rename duplicate section types so no two sections share the same type.
 *  'hero' and 'nextsteps' are also deduplicated (keep first only).
 *  Extra generic sections get renamed to unused types from DEDUP_SUBSTITUTES.
 */
function deduplicateSectionTypes(plan: SectionPlan[]): SectionPlan[] {
  const seenTypes = new Set<string>();
  const usedTypes = new Set(plan.map(s => s.type));

  return plan.map(section => {
    if (!seenTypes.has(section.type)) {
      seenTypes.add(section.type);
      return section;
    }
    // Duplicate found — find first substitute not already in the plan
    const alt = DEDUP_SUBSTITUTES.find(t => !usedTypes.has(t));
    if (alt) {
      usedTypes.add(alt);
      return { ...section, type: alt };
    }
    // No substitute available — keep as-is (will render as generic)
    return section;
  });
}

// ── Agent implementation ─────────────────────────────────────────────────────

export class MicrositeGeneratorAgent implements Agent {
  readonly name = 'microsite-generator-agent';
  readonly description =
    'Converts proposal markdown into a high-end presentation microsite with structured Layout AST.';

  private async extractReferenceDesign(
    generateTool: { run: (input: { query: string; content: string }) => Promise<{ text?: string }> },
    referenceFile: ReferenceFile,
  ): Promise<ReferenceDesign | null> {
    try {
      if (referenceFile.mediaType === 'application/pdf') {
        console.warn('[microsite-agent] Pass 0.5: PDF reference files cannot be analyzed visually — skipping design extraction');
        return null;
      }
      const colors = referenceFile.dominantColors ?? [];
      if (colors.length) {
        console.log(`[microsite-agent] Pass 0.5: canvas-extracted colors — bg:${colors[0]} brand:[${colors.slice(1).join(', ')}]`);
      }

      // ── Fast path: deterministic role assignment from canvas-extracted hex codes ──
      // This avoids adding a 6th concurrent Python/LLM subprocess during warmup, which
      // was throttling the brief, section-plan, and hero calls and causing timeouts.
      // Canvas extraction already pixel-samples the image and sorts by saturation, so
      // we can assign roles directly without a Claude call.
      if (colors.length >= 2) {
        const bg    = colors[0];
        const bgLum = hexLuminance(bg);
        const isDark = bgLum < 128;

        // Canvas ordering differs by image type:
        //   Dark  image: [darkBg, vivid0, vivid1, vivid2, brand0, ...]
        //   Light image: [light0, light1, light2, vivid0, vivid1, brand0, ...]
        // For light images colors[1..2] are more light backgrounds, not brand accents.
        // The first vivid/brand accent starts at index 3 for light, index 1 for dark.
        const brandStart = isDark ? 1 : 3;

        // Among the next 4 positions, pick the one with the most hue contrast against
        // the background. This ensures brand accents (e.g. magenta on cream) rank above
        // same-family vivid colors (e.g. gold on cream) even if gold has higher saturation.
        const hexHue = (hex: string): number => {
          const h = hex.replace('#', '');
          if (h.length < 6) return 0;
          const r = parseInt(h.slice(0,2),16)/255;
          const g = parseInt(h.slice(2,4),16)/255;
          const b = parseInt(h.slice(4,6),16)/255;
          const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
          if (d === 0) return 0;
          let hue = max===r ? 60*((g-b)/d%6) : max===g ? 60*((b-r)/d+2) : 60*((r-g)/d+4);
          return (hue+360)%360;
        };
        const hueDist = (h1: number, h2: number) => { const d=Math.abs(h1-h2); return Math.min(d,360-d); };
        const bgHue = hexHue(bg);

        // Collect up to 4 vivid candidates starting at brandStart
        const candidates = colors.slice(brandStart, brandStart + 4).filter(Boolean);
        // Sort by hue distance from bg descending — most contrasting hue = primary brand accent
        const sorted = [...candidates].sort((a,b) => hueDist(hexHue(b),bgHue) - hueDist(hexHue(a),bgHue));

        const primary   = sorted[0]                ?? colors[brandStart] ?? colors[1];
        const secondary = candidates.find(c => c !== primary) ?? primary;
        const accent    = candidates.find(c => c !== primary && c !== secondary) ?? primary;
        const surface   = bg;

        console.log(`[microsite-agent] Pass 0.5: hue contrast sort — bgHue=${bgHue.toFixed(0)}° candidates=${candidates.map(c=>`${c}(${hueDist(hexHue(c),bgHue).toFixed(0)}°)`).join(',')}`);

        const text      = isDark ? '#ffffff' : '#1a1a1a';
        const textMuted = isDark ? '#a0a0a0' : '#555555';

        const tokens: ReferenceDesign = {
          colors: { primary, secondary, accent, background: bg, surface, text, textMuted },
          typography: {
            headingFont: 'sans-serif',
            bodyFont: 'sans-serif',
            headingWeight: '700',
            bodyWeight: '400',
            headingStyle: 'sans-serif',
            mood: isDark ? 'bold' : 'modern',
          },
          style: {
            borderRadius: 'soft',
            spacing: 'comfortable',
            vibe: `${isDark ? 'Dark' : 'Light'} brand palette — primary ${primary}`,
          },
        };
        console.log(`[microsite-agent] Pass 0.5: design tokens assigned — primary=${primary}, bg=${bg}, dark=${isDark}`);
        return tokens;
      }

      // ── Slow path: no canvas colors — fall back to LLM call with 15 s timeout ──
      const prompt = `DESIGN_IMAGE:${referenceFile.base64}\n\n${buildReferenceDesignExtractionPrompt()}`;
      const result = await Promise.race([
        generateTool.run({ query: prompt, content: '' }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
      ]);
      if (!result) {
        console.warn('[microsite-agent] Pass 0.5: design extraction timed out — continuing without reference tokens');
        return null;
      }
      const raw = (result as { text?: string }).text ?? '';
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      const jsonStr = jsonStart !== -1 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
      const parsed = safeParseJSON(jsonStr) as ReferenceDesign | null;
      if (!parsed?.colors?.primary || !parsed?.typography?.headingFont || !parsed?.style?.vibe) {
        console.warn('[microsite-agent] Pass 0.5: design extraction returned invalid JSON — continuing without reference tokens');
        return null;
      }
      console.log(`[microsite-agent] Pass 0.5: design extraction complete — vibe="${parsed.style.vibe}", primary=${parsed.colors.primary}, bg=${parsed.colors.background}`);
      return parsed;
    } catch (err) {
      console.warn('[microsite-agent] Pass 0.5: design extraction failed —', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

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
    const pdfFriendly = !!(meta.pdfFriendly as boolean | undefined);
    const rawInstructions = ((meta.customInstructions as string | undefined) ?? input.prompt ?? '').trim();
    const pdfConstraints = pdfFriendly
      ? '\n\nPDF SLIDE CONSTRAINTS (enforce strictly — this microsite will be captured as a PDF where each section must fit in a single 720px-tall slide): ' +
        'Maximum 4 bullet/list items per section. ' +
        'Maximum 1 sentence (under 80 characters) per item description — no multi-sentence descriptions on cards or list items. ' +
        'Maximum 2 sentences for section body/intro text. ' +
        'Timeline: maximum 4 phases. ' +
        'Stats, metrics, features, benefits: maximum 4 items. ' +
        'FAQ: maximum 4 questions. ' +
        'No nested lists. ' +
        'Keep all headlines under 8 words. ' +
        'Prefer 2-column grid layouts over 3-column. ' +
        'Omit decorative sub-labels and long captions. ' +
        'CRITICAL diagram rule: ONLY include a diagram in a section when that section contains ONLY body text with NO card grid, NO stat grid, and NO list items. If a section already has cards, stats, pillars, features, benefits, or any item array, set diagram to empty string — do NOT add a diagram to that section. Diagrams stacked below card grids make sections too tall for a single PDF slide.'
      : '';
    const customInstructions = (rawInstructions || 'Generate a comprehensive microsite using all content from the document. Include as many sections as the content supports — aim for 12 or more. Map all source headings to the most specific section type available (techstack, security, testing, metrics, approach, timeline, etc.). Use diagrams in approach, timeline, security, techstack, and testing sections.') + pdfConstraints;
    if (pdfFriendly) console.log('[microsite-agent] PDF FRIENDLY MODE — constraints injected into customInstructions');
    const fullDesignPrompt = (meta.fullDesignPrompt as string | undefined) ?? '';
    const isFullOverride = fullDesignPrompt.trim().length > 100;
    if (isFullOverride) {
      console.log('[MicrositeAgent] FULL OVERRIDE MODE ACTIVE — fullDesignPrompt length:', fullDesignPrompt.length);
    }
    let extractedTokens: ExtractedDesignTokens | null = null;
    if (isFullOverride) {
      extractedTokens = extractDesignTokens(fullDesignPrompt);
      console.log('[DesignTokenExtractor] fonts:', extractedTokens.typography.fonts);
      console.log('[DesignTokenExtractor] backgrounds:', extractedTokens.colors.backgrounds);
      console.log('[DesignTokenExtractor] accents:', extractedTokens.colors.accents);
      console.log('[DesignTokenExtractor] googleFontsUrl:', extractedTokens.googleFontsUrl);
    }
    const designConfig: Record<string, unknown> = {
      ...((meta.designConfig as Record<string, unknown> | undefined) ?? {}),
      ...(customInstructions ? { customInstructions } : {}),
    };
    const metaBrand = (meta.brand as Record<string, unknown> | undefined) ?? {};
    let metaPlugin = (meta.plugin as string | undefined) ?? 'cobalt';
    const brandImage = (meta.brandImage as string | undefined) ?? '';
    const brandLanguagePrompt = (meta.designBrief as string | undefined) ?? '';
    const referenceFile = (meta.referenceFile as ReferenceFile | undefined) ?? null;
    const urlReferenceDesign = (meta.urlReferenceDesign as ReferenceDesign | undefined) ?? null;
    console.log(`[microsite-agent] referenceFile: ${referenceFile ? `fileName=${referenceFile.fileName}, mediaType=${referenceFile.mediaType}, dominantColors=${referenceFile.dominantColors?.length ?? 0}` : 'NOT attached'}`);
    console.log(`[microsite-agent] urlReferenceDesign: ${urlReferenceDesign ? `vibe="${urlReferenceDesign.style.vibe}", primary=${urlReferenceDesign.colors.primary}` : 'NOT provided'}`);

    if (!proposalMarkdown) {
      throw new Error('microsite-generator agent requires metadata.proposalMarkdown');
    }

    const tools = input.tools;
    if (!tools) {
      throw new Error('microsite-generator agent requires tools (generate-content, save-asset)');
    }

    // 1. Parse source sections from markdown headings
    console.log(`[microsite-agent] proposalMarkdown received: ${proposalMarkdown.length} chars`);
    const sourceSections = this.extractSections(proposalMarkdown);
    console.log(`[microsite-agent] extractSections: ${sourceSections.length} sections → [${sourceSections.map(s => s.name).join(', ')}]`);
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
      // ── PARALLEL WARM-UP: Pass -1 + CommandParser + Pass 1 all fire simultaneously ──
      // Pass 0 (section planning) must wait for CommandParser (plugin override),
      // but Pass -1 (design tokens) and Pass 1 (brief) are fully independent — run them now.
      console.log('[microsite-agent] Starting parallel warm-up: Pass -1 + CommandParser + Pass 1...');

      // Pass 0 planning markdown — 2000 chars per section (enough to identify structure)
      const planningMarkdown = sourceSections.map(s => `## ${s.name}\n${s.content.slice(0, 2000)}`).join('\n\n');

      // Define streaming callbacks early — hero .then() fires before Promise.all resolves
      const onSectionComplete = meta.onSectionComplete as ((data: Record<string, unknown>) => void) | undefined;
      const onPlanReady = meta.onPlanReady as ((data: Record<string, unknown>) => void) | undefined;

      // Section results array declared here so hero .then() can push into it immediately
      const sectionResults: Array<{ id: string; heading: string; type: string; content: Record<string, unknown>; diagramMeta: unknown }> = [];
      let heroAlreadyStreamed = false;

      // Start hero generation BEFORE the warm-up — streams SSE as soon as it resolves (~3-5s)
      // Key: NOT inside Promise.all — that would block until the slowest member (~15s Pass -1)
      const heroPromise = generateTool.run({
        query: buildFastHeroPrompt(
          planningMarkdown,
          metaBrand.companyName as string | undefined,
          metaBrand.tagline as string | undefined,
          rawInstructions,
        ),
        content: '',
      }).then(result => {
        if (!result?.text || !onSectionComplete) return result;
        try {
          const heroContent = safeParseJSON(result.text) ?? {};
          const hc = heroContent as Record<string, unknown>;
          if (hc.headline || hc.eyebrow) {
            if (hc.diagram) hc.diagram = normalizeDiagram(hc.diagram);
            onSectionComplete({ id: 'hero', heading: 'Hero', sectionType: 'hero', content: hc, index: 0 });
            sectionResults.push({ id: 'hero', heading: 'Hero', type: 'hero', content: hc, diagramMeta: null });
            heroAlreadyStreamed = true;
            console.log('[microsite-agent] Speculative hero streamed immediately ✓');
          }
        } catch { /* ignore — Pass 2 will generate hero normally */ }
        return result;
      }).catch(() => null);

      const [designSystemRaw, cmdRaw, briefResult, planResult, referenceDesign] = await Promise.all([
        // Pass -1: Design system synthesis
        (async () => {
          if (preSynthesized) {
            console.log('[microsite-agent] Using pre-synthesized design system — skipping Pass -1');
            return preSynthesized;
          }
          if (!brandLanguagePrompt.trim()) return null;
          console.log('[microsite-agent] Pass -1: design system synthesis...');
          const r = await this.synthesizeDesignSystem(generateTool, brandLanguagePrompt, metaPlugin, metaBrand.primaryColor as string | undefined, brandImage || undefined);
          console.log('[microsite-agent] Pass -1 done:', r ? `character="${r.customCharacter}"` : 'NULL');
          return r;
        })(),

        // CommandParser: structured intent extraction
        (async () => {
          if (!customInstructions) return null;
          try {
            const r = await generateTool.run({ query: buildCommandParserPrompt(customInstructions, metaPlugin), content: '' });
            return r?.text ?? null;
          } catch { return null; }
        })(),

        // Pass 1: Brief extraction — full document (no truncation — all data must reach the LLM)
        generateTool.run({
          query: isFullOverride
            ? buildOverrideBriefPrompt(proposalMarkdown, fullDesignPrompt, { companyName: metaBrand.companyName as string, tagline: metaBrand.tagline as string })
            : buildBriefPrompt(proposalMarkdown, { companyName: metaBrand.companyName as string | undefined, tagline: metaBrand.tagline as string | undefined }, metaPlugin, customInstructions, undefined, urlReferenceDesign),
          content: '',
        }).catch(() => null),

        // Pass 0: Section planning — runs in parallel with Pass -1 and Pass 1 (no dependency on them)
        Promise.race([
          generateTool.run({
            query: isFullOverride
              ? buildOverrideSectionPlanPrompt(planningMarkdown, fullDesignPrompt)
              : buildSectionPlanPrompt(planningMarkdown, metaPlugin, customInstructions, urlReferenceDesign),
            content: '',
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 60_000)),
        ]).catch(() => null),

        // Pass 0.5: Reference design extraction — runs in parallel, zero impact on hero speed
        referenceFile
          ? this.extractReferenceDesign(generateTool, referenceFile)
          : Promise.resolve(null),
      ]);

      // Await hero — it started before the warm-up so it's almost certainly already done
      await heroPromise;

      // Merge file-based and URL-based reference design tokens — file attachment takes priority
      const finalReferenceDesign: ReferenceDesign | null = referenceDesign ?? urlReferenceDesign;

      // Resolve design system result
      let designSystemResult: { customCharacter: string; rawTokens: Record<string, unknown> } | null = null;
      if (preSynthesized) {
        const character = typeof preSynthesized.customCharacter === 'string' ? preSynthesized.customCharacter : 'custom-synthesized';
        designSystemResult = { customCharacter: character, rawTokens: preSynthesized };
      } else if (designSystemRaw && typeof (designSystemRaw as { customCharacter?: unknown }).customCharacter === 'string') {
        designSystemResult = designSystemRaw as { customCharacter: string; rawTokens: Record<string, unknown> };
      }
      const effectiveCharacter = designSystemResult?.customCharacter;

      // Apply CommandParser result (plugin override affects Pass 0 prompt)
      let parsedCommand: ParsedCommand = DEFAULT_PARSED_COMMAND;
      if (cmdRaw) {
        try {
          const raw = (cmdRaw as string).trim();
          const jsonStart = raw.indexOf('{');
          const jsonEnd = raw.lastIndexOf('}');
          const jsonStr = jsonStart !== -1 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
          const parsed = safeParseJSON(jsonStr);
          if (parsed && typeof parsed.designOverrides === 'object' && typeof parsed.contentOverrides === 'object') {
            parsedCommand = parsed as unknown as ParsedCommand;
            if (typeof parsedCommand.designOverrides.plugin === 'string' && parsedCommand.designOverrides.plugin) {
              metaPlugin = parsedCommand.designOverrides.plugin;
              console.log('[microsite-agent] Command parser: plugin overridden to', metaPlugin);
            }
          }
        } catch { /* keep defaults */ }
      }

      // Section limit detection — runs before Pass 0 to inform trimming after plan is parsed
      const combinedPromptText = [fullDesignPrompt, customInstructions].filter(Boolean).join('\n');
      const sectionLimitRequest: SectionLimitRequest = detectSectionLimitRequest(combinedPromptText);
      console.log('[SectionLimitDetector]', JSON.stringify(sectionLimitRequest));


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

      // Pass 0.5: LLM refines the plan — only for structural instructions (section count/reorder).
      // Skip for visual/design-only prompts to prevent LLM from inflating section count.
      const isStructuralInstruction = customInstructions
        ? /\b(only|exactly|just|max|maximum|limit\s+to)\s+\d+\s+sections?|\d+\s+sections?\s+(only|total|max|please)|\bsection\s+count\b|\bgenerate\s+\d+\s+sections?|\bcreate\s+\d+\s+sections?|\bmake\s+it\s+\d+\s+sections?/i.test(customInstructions)
        : false;
      if (customInstructions && sectionPlan && isStructuralInstruction) {
        try {
          const refineResult = await generateTool.run({
            query: buildPlanRefinementPrompt(sectionPlan, customInstructions),
            content: '',
          });
          if (refineResult?.text) {
            const refined = JSON.parse(refineResult.text.trim());
            if (Array.isArray(refined) && refined.length > 0) {
              sectionPlan = refined as SectionPlan[];
            }
          }
        } catch { /* keep original plan if refinement fails */ }
      }


      // Deduplicate FIRST (before required-section additions claim all substitute types),
      // then add missing required sections — unless the user explicitly requested a specific count/list.
      // Using sectionLimitRequest.hasLimit (not isFullOverride) so that visual-only prompts and
      // fullDesignPrompt mode without explicit counts both get the full required-section expansion.
      if (sectionPlan) {
        sectionPlan = deduplicateSectionTypes(sectionPlan);
        if (!sectionLimitRequest.hasLimit) {
          sectionPlan = ensureRequiredSections(sectionPlan);
          console.log('[MicrositeAgent] After ensureRequiredSections:', sectionPlan.length, 'sections');
        }
      }

      // Code-level constraint fallback: apply regex overrides on top of LLM-parsed planConstraints
      // This guarantees constraint enforcement even when the LLM misses keywords
      if (customInstructions) {
        const ci = customInstructions;
        if (!planConstraints.noCTAEverywhere && /no\s*cta\s*(anywhere|everywhere|at\s*all)|remove\s*all\s*(cta|buttons?|calls?\s*to\s*action)|no\s*(buttons?|calls?\s*to\s*action)\s*(anywhere|at\s*all)/i.test(ci)) {
          planConstraints = { ...planConstraints, noCTAEverywhere: true, noCTAInHero: true };
        } else if (!planConstraints.noCTAInHero && /no\s*cta|remove\s*cta|no\s*(buttons?|calls?\s*to\s*action)|without\s*cta|omit\s*cta|skip\s*cta/i.test(ci)) {
          planConstraints = { ...planConstraints, noCTAInHero: true };
        }
        if (!planConstraints.motion) {
          if (/\banimate\b|\btransitions?\b|\bdynamic\b|\bmotion\b/i.test(ci)) planConstraints = { ...planConstraints, motion: 'expressive' };
          else if (/subtle\s*motion|gentle\s*animat/i.test(ci)) planConstraints = { ...planConstraints, motion: 'deliberate' };
          else if (/no\s*animat|static\b|no\s*motion/i.test(ci)) planConstraints = { ...planConstraints, motion: 'instant' };
        }
        if (!planConstraints.parallax && /\bparallax\b/i.test(ci)) {
          planConstraints = { ...planConstraints, parallax: true };
        }
        // Hard-trim section plan to exact count — LLMs are unreliable at counting
        if (sectionPlan) {
          const count = parseExplicitCount(ci);
          if (count && count > 0 && sectionPlan.length > count) {
            sectionPlan = sectionPlan.slice(0, count);
          }
        }
      }

      // Apply section limit request (from detectSectionLimitRequest) after ensureRequiredSections
      if (sectionLimitRequest.hasLimit && sectionPlan) {
        if (sectionLimitRequest.limitType === 'count' && sectionLimitRequest.requestedCount) {
          const count = sectionLimitRequest.requestedCount;
          const hero = sectionPlan.filter(s => s.type === 'hero');
          const last = sectionPlan.filter(s => s.type === 'nextsteps');
          const middle = sectionPlan.filter(s => s.type !== 'hero' && s.type !== 'nextsteps');
          const trimmed = [
            ...hero,
            ...middle.slice(0, Math.max(0, count - hero.length - last.length)),
            ...last,
          ];
          sectionPlan = trimmed.slice(0, count);
          console.log('[SectionLimitDetector] Trimmed to', sectionPlan.length, 'sections per user request');
        }
        if (sectionLimitRequest.limitType === 'explicit-list' && sectionLimitRequest.requestedSections) {
          sectionPlan = sectionPlan.filter(s =>
            sectionLimitRequest.requestedSections!.some(r =>
              s.type.includes(r) || r.includes(s.type)
            )
          );
        }
        if (sectionLimitRequest.limitType === 'exclude-list' && sectionLimitRequest.requestedSections) {
          sectionPlan = sectionPlan.filter(s =>
            !sectionLimitRequest.requestedSections!.includes(s.type)
          );
        }
      }

      // Parse brief
      let brief: Record<string, unknown> | null = null;
      if (briefResult?.text) {
        brief = safeParseJSON(briefResult.text);
        console.log('[microsite-agent] brief parse:', brief ? `OK — client="${brief.clientName}", company="${brief.proposingCompany}"` : `FAILED — raw (first 200): ${briefResult.text.slice(0, 200)}`);
      } else {
        console.log('[microsite-agent] brief parse: SKIPPED — briefResult has no text, using fallback brief');
      }
      // Fallback brief so Pass 2 always runs even if Pass 1 LLM call failed
      if (!brief) {
        brief = {
          clientName: meta.clientName ?? 'Client',
          proposingCompany: meta.proposingCompany ?? 'Us',
          primaryTone: 'authoritative',
          industry: '',
          coreProblem: '',
          proposedSolution: '',
          keyBenefits: [],
        };
      }

      // Markdown is backward-compat only — derive from source sections, no extra LLM call.
      // The structured Layout AST (json output) is what the UI renders; markdown is unused in the UI.
      markdown = this.fallbackMarkdown(sourceSections);

      // Hard-trim markdown sections to explicit count — LLMs ignore section count instructions
      if (customInstructions) {
        const mdCount = parseExplicitCount(customInstructions);
        if (mdCount && mdCount > 0) {
          // Split on ## headings, preserve everything before the first ## as the title block
          const parts = markdown.split(/\n(?=## )/);
          const titleBlock = parts[0]; // everything before first ## section
          const sectionBlocks = parts.slice(1);
          if (sectionBlocks.length > mdCount) {
            markdown = [titleBlock, ...sectionBlocks.slice(0, mdCount)].join('\n');
          }
        }
      }

      // Build source section lookup map (heading → content)
      const sourceMap = new Map<string, string>();
      for (const s of sourceSections) {
        sourceMap.set(s.name.toLowerCase(), s.content);
        sourceMap.set(slugify(s.name), s.content);
      }

      console.log('[microsite-agent] sectionPlan:', sectionPlan ? sectionPlan.map(p => `${p.type}←"${p.sourceHeading ?? 'AI'}" ${p.aiGenerated ? '(ai)' : ''}`).join(', ') : 'NULL — falling back to source order');

      // Resolve section list from plan or fallback to source order
      const resolvedSections: Array<{ type: SectionType; heading: string; rawBody: string; aiGenerated: boolean }> = [];

      const KNOWN_SECTION_TYPES = new Set<string>(['hero','challenge','approach','deliverables','timeline','pricing','whyus','nextsteps','testimonials','showcase','benefits','problem','stats','metrics','security','techstack','testing','faq','team','comparison','casestudy','chart','generic']);
      if (sectionPlan && sectionPlan.length > 0) {
        for (const planned of sectionPlan) {
          const rawType = planned.type as string;
          const type = (KNOWN_SECTION_TYPES.has(rawType) ? rawType : 'generic') as SectionType;
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

          // Pricing fallback: if rawBody is empty, scan all source sections for price data
          if (!rawBody && type === 'pricing') {
            const pricePattern = /\$|£|€|USD|GBP|EUR|\d[\d,]+(\.\d+)?\s*(k|K|M|mn|million|thousand)?\/?(mo|month|yr|year|hour|hr|day)|total|invest|cost|fee|rate|price|package|tier/i;
            const pricingSections = sourceSections.filter(s => pricePattern.test(s.content) || pricePattern.test(s.name));
            if (pricingSections.length > 0) {
              rawBody = pricingSections.map(s => `## ${s.name}\n${s.content}`).join('\n\n');
            }
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

      // Hard cap: never generate more than 14 sections regardless of planning result or fallback
      const MAX_SECTIONS = 14;
      if (resolvedSections.length > MAX_SECTIONS) {
        const originalCount = resolvedSections.length;
        resolvedSections.splice(MAX_SECTIONS);
        console.log(`[microsite-agent] Section count capped at ${MAX_SECTIONS} (was ${originalCount})`);
      }
      // Also honour any explicit user count (if lower than the cap)
      if (customInstructions) {
        const explicitCount = parseExplicitCount(customInstructions);
        if (explicitCount && explicitCount > 0 && explicitCount < MAX_SECTIONS && resolvedSections.length > explicitCount) {
          resolvedSections.splice(explicitCount);
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

        // Hero sections may receive the same instructions as other sections
        const effectiveHeroInstructions = customInstructions;

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
        // Filter out sections hidden by the parsed command; preserve original index for preassigned variant lookup
        const sectionsToHide = parsedCommand.contentOverrides.sectionsToHide ?? [];
        const pass2GlobalInstruction = parsedCommand.contentOverrides.globalInstruction ?? undefined;
        const pass2SectionInstructions = parsedCommand.contentOverrides.sectionInstructions ?? {};
        const pass2Sections = resolvedSections
          .map((s, originalIdx) => ({ ...s, originalIdx }))
          .filter(s => sectionsToHide.length === 0 || !sectionsToHide.includes(s.type));

        // Notify caller of final section plan before generation starts
        onPlanReady?.({
          totalSections: pass2Sections.length,
          sectionTypes: pass2Sections.map(s => s.type),
          ...(finalReferenceDesign ? { referenceCssVars: referenceDesignToCssVars(finalReferenceDesign) } : {}),
        });

        // Skip hero in Pass 2 if already streamed by speculative call (heroAlreadyStreamed set in .then() above)
        const pass2SectionsFiltered = heroAlreadyStreamed
          ? pass2Sections.filter(s => s.type !== 'hero')
          : pass2Sections;

        // Process sections in batches of 3 for faster progressive streaming
        const BATCH_SIZE = 3;

        for (let batchStart = 0; batchStart < pass2SectionsFiltered.length; batchStart += BATCH_SIZE) {
          const batch = pass2SectionsFiltered.slice(batchStart, batchStart + BATCH_SIZE);
          const batchOutputs = await Promise.all(
            batch.map(async (s, batchIdx) => {
              // Offset by 1 when hero is already at position 0 — prevents non-hero sections
              // from getting index:0 and displacing the hero to position 2 or 3
              const heroOffset = heroAlreadyStreamed ? 1 : 0;
              const idx = (batchStart + batchIdx) + heroOffset;
              const baseSlug = slugify(s.heading);
              const count = seenSlugs.get(baseSlug) ?? 0;
              seenSlugs.set(baseSlug, count + 1);
              const id = count === 0 ? baseSlug : `${baseSlug}-${idx}`;
              const sectionInstructions = s.type === 'hero' ? effectiveHeroInstructions : customInstructions;
              const sectionRules = (sectionRulesMap[s.type] as Record<string, unknown> | undefined) ?? null;
              const pass2SectionInstruction = pass2SectionInstructions[s.type] ?? undefined;
              const diagramSel = selectBestDiagram(s.rawBody, s.heading, s.type);
              console.log(`[diagram-detector] ${s.type} "${s.heading}": ${diagramSel ? `${diagramSel.diagramType.id} score=${diagramSel.score} conf=${diagramSel.confidence}` : 'null'}`);
              const prompt = isFullOverride
                ? buildOverrideSectionPrompt(s.type, s.heading, s.rawBody ?? '', briefStr, fullDesignPrompt, brandName, s.aiGenerated ?? false, diagramSel)
                : buildSectionPrompt(s.type, s.heading, s.rawBody, briefStr, tone, brandName, metaPlugin, s.aiGenerated, sectionInstructions, effectiveCharacter, layoutPatterns, s.originalIdx, preassigned[s.originalIdx], sectionRules, pass2GlobalInstruction, pass2SectionInstruction, proposalMarkdown, diagramSel, finalReferenceDesign);
              try {
                const timeoutMs = 90_000;
                const result = await Promise.race([
                  generateTool!.run({ query: prompt, content: '' }),
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Section "${s.type}" timed out after ${timeoutMs}ms`)), timeoutMs)),
                ]);
                const parsed = safeParseJSON(result.text ?? '') ?? {};
                if (!parsed.headline && !parsed.eyebrow) {
                  console.warn(`[microsite-agent] Section "${s.type}" (${s.heading}) parsed to empty — raw (first 300): ${(result.text ?? '').slice(0, 300)}`);
                }
                if (parsed.diagram) parsed.diagram = normalizeDiagram(parsed.diagram);
                // CODE-LEVEL enforcement: when pdfFriendly, strip diagram from any section that has item arrays
                // (LLM ignores prompt constraints; this is the reliable fix)
                if (pdfFriendly && parsed.diagram) {
                  const ITEM_FIELDS = ['pillars','items','stats','features','benefits','steps','phases','technologies','layers','metrics','comparisons','deliverables','questions','rows','testimonials'];
                  const hasItems = ITEM_FIELDS.some(f => Array.isArray((parsed as Record<string,unknown>)[f]) && ((parsed as Record<string,unknown>)[f] as unknown[]).length > 0);
                  if (hasItems) {
                    (parsed as Record<string,unknown>).diagram = '';
                    console.log(`[microsite-agent] PDF FRIENDLY: stripped diagram from "${s.type}" section (has item array)`);
                  }
                }
                onSectionComplete?.({ id, heading: s.heading, sectionType: s.type, content: parsed, index: idx });
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
                const diagramMeta = diagramSel ? {
                  typeId: diagramSel.diagramType.id,
                  typeLabel: diagramSel.diagramType.label,
                  category: diagramSel.diagramType.category,
                  confidence: diagramSel.confidence,
                  matchedKeywords: diagramSel.matchedKeywords,
                  score: diagramSel.score,
                  isCustomSvg: diagramSel.diagramType.isCustomSvg ?? false,
                } : null;
                return { id, heading: s.heading, type: s.type, content: parsed, diagramMeta };
              } catch (err) {
                console.error(`[microsite-agent] Section "${s.type}" (${s.heading}) FAILED:`, err instanceof Error ? err.message : String(err));
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
                  diagramMeta: null,
                };
              }
            })
          );
          sectionResults.push(...batchOutputs);
          console.log(`[microsite-agent] Batch ${Math.floor(batchStart / BATCH_SIZE) + 1} complete — ${sectionResults.length}/${pass2Sections.length} sections done`);
        }

        // Resolve image URLs in parallel (loremflickr.com — free, keyword-based)
        const imageUrls = await Promise.all(
          sectionResults.map((sr) =>
            resolveImageUrl((sr.content as Record<string, unknown>).imageQuery as string || '')
          )
        );

        // Assemble Layout AST
        const resolvedCompany = (metaBrand.companyName as string | undefined) || (brief.proposingCompany as string) || '';
        layoutAST = {
          proposalId: namespace,
          generatedAt: new Date().toISOString(),
          generationMode: isFullOverride ? 'full-design-prompt-override' : 'default',
          fullDesignPromptUsed: isFullOverride,
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
              ?? (designSystemResult?.rawTokens?.behavior as Record<string, unknown> | undefined)?.motion as 'instant' | 'deliberate' | 'expressive' | undefined
              ?? 'deliberate',
            parallax: planConstraints.parallax
              || ((designSystemResult?.rawTokens?.behavior as Record<string, unknown> | undefined)?.parallax === true),
            scrollEffects: planConstraints.scrollEffects
              ?? (designSystemResult?.rawTokens?.behavior as Record<string, unknown> | undefined)?.scrollEffects as 'none' | 'fade-in' | 'slide-up' | undefined
              ?? 'none',
          },
          sections: sectionResults.map((sr, i) => {
            let imageQuery = ((sr.content as Record<string, unknown>).imageQuery as string | undefined) ?? '';
            // Code-level: "remove image from section:<type>" or "no image on <type>" clears imageQuery
            if (customInstructions) {
              const ciLow = customInstructions.toLowerCase();
              const noImagePatterns = [
                /no\s+image\s+(?:on|in|for|from)?\s*(?:section\s*:?\s*)?(\w+)/i,
                /remove\s+image\s+(?:from\s+)?(?:section\s*:?\s*)?(\w+)/i,
              ];
              for (const pat of noImagePatterns) {
                const m = ciLow.match(pat);
                if (m && sr.type.startsWith(m[1].replace(/s$/, ''))) {
                  imageQuery = '';
                }
              }
              // "no image" globally
              if (/\bno\s+images?\b|\bwithout\s+images?\b|\bremove\s+(?:all\s+)?images?\b/i.test(ciLow)) {
                imageQuery = '';
              }
            }
            const hasImage = imageQuery.trim().length > 0;
            return {
              id: sr.id,
              heading: sr.heading,
              sectionType: sr.type,
              content: sr.content,
              diagramMeta: (sr as { diagramMeta?: unknown }).diagramMeta ?? null,
              image: {
                source: (hasImage ? 'loremflickr' : 'gradient') as 'loremflickr' | 'gradient',
                query: imageQuery,
                url: hasImage ? (imageUrls[i] ?? null) : null,
                fallback: 'gradient-mesh' as const,
              },
              editable: true,
              version: 1,
            };
          }),
        };
        // Apply design overrides from parsed command (plugin swap, section layouts, image style, typography, accent color)
        if (layoutAST) {
          applyDesignOverrides(layoutAST as Record<string, unknown>, parsedCommand.designOverrides);
        }
        // Merge extracted design tokens into brand when fullDesignPrompt was provided
        if (extractedTokens && layoutAST) {
          const ast = layoutAST as Record<string, unknown>;
          const existingBrand = (ast.brand as Record<string, unknown>) ?? {};
          // Override primaryColor and secondaryColor from extracted accent colors so all
          // downstream consumers (DALL-E prompts, logo, editor) use the prompt's colors.
          const extractedPrimary = extractedTokens.colors.accents[0];
          const extractedSecondary = extractedTokens.colors.accents[1] ?? extractedPrimary;
          ast.brand = {
            ...existingBrand,
            ...(extractedPrimary ? { primaryColor: extractedPrimary } : {}),
            ...(extractedSecondary ? { secondaryColor: extractedSecondary } : {}),
            overrideTheme: true,
            extractedCssVariables: extractedTokens.cssVariables,
            googleFontsUrl: extractedTokens.googleFontsUrl,
            fontFaceDeclarations: extractedTokens.fontFaceDeclarations,
            animationStyle: extractedTokens.components.animationStyle,
            gradientsEnabled: extractedTokens.components.gradients,
            decorativeEnabled: extractedTokens.components.decorativeElements,
            borderRadiusStyle: extractedTokens.components.borderRadius,
            themeClass: extractedTokens.themeClass,
          };
        }

        // Apply reference design tokens to brand when Pass 0.5 (file or URL) extracted them
        // and no full design prompt (extractedTokens) was provided.
        if (finalReferenceDesign && !extractedTokens && layoutAST) {
          const ast = layoutAST as Record<string, unknown>;
          const existingBrand = (ast.brand as Record<string, unknown>) ?? {};
          const cssVars = referenceDesignToCssVars(finalReferenceDesign);
          const tokenSource = referenceDesign ? 'file attachment' : 'reference URL';
          ast.brand = {
            ...existingBrand,
            primaryColor: finalReferenceDesign.colors.primary,
            secondaryColor: finalReferenceDesign.colors.secondary,
            overrideTheme: true,
            extractedCssVariables: cssVars,
          };
          console.log(`[microsite-agent] Pass 0.5: applied reference design (${tokenSource}) to brand — primary=${finalReferenceDesign.colors.primary}, bg=${finalReferenceDesign.colors.background}`);
        }

        // Section count validation
        if (layoutAST && typeof layoutAST === 'object') {
          const astObj = layoutAST as Record<string, unknown>;
          if (Array.isArray(astObj.sections)) {
            const count = astObj.sections.length;
            console.log('[MicrositeAgent] Section count:', count);
            console.log('[MicrositeAgent] Sections:', astObj.sections.map((s: any) => s.sectionType).join(', '));
            const withDiagram = astObj.sections.filter((s: any) => s.content?.diagram).length;
            const withImage = astObj.sections.filter((s: any) => s.content?.imageQuery).length;
            console.log('[MicrositeAgent] With diagram:', withDiagram, '/', count);
            console.log('[MicrositeAgent] With imageQuery:', withImage, '/', count);
            if (count < 8 && !sectionLimitRequest.hasLimit) {
              console.warn('[MicrositeAgent] WARNING: Only', count, 'sections generated without user limit. Expected 10+.');
            }
          }
        }
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
    // Try heading levels in descending priority until we get ≥3 sections
    const tryExtract = (prefix: RegExp): { name: string; content: string }[] => {
      const lines = markdown.split('\n');
      const sections: { name: string; content: string }[] = [];
      let currentName: string | null = null;
      let currentLines: string[] = [];

      for (const line of lines) {
        const m = line.match(prefix);
        if (m) {
          if (currentName !== null) {
            const body = currentLines.join('\n').trim();
            if (body) sections.push({ name: currentName, content: body });
          }
          currentName = m[1].trim();
          currentLines = [];
        } else if (currentName !== null) {
          currentLines.push(line);
        }
      }
      if (currentName !== null) {
        const body = currentLines.join('\n').trim();
        if (body) sections.push({ name: currentName, content: body });
      }
      return sections;
    };

    // 1. Try ## (h2) — standard proposals
    let sections = tryExtract(/^## (.+)$/);
    // If h2 sections exist but are very few (≤ 3), enrich with h3 sub-sections so the
    // Pass 0 plan LLM has more specific headings to assign rather than mapping everything
    // to a single generic "Executive Summary" or "Technical Requirements".
    if (sections.length >= 2 && sections.length <= 3) {
      const h3sub = tryExtract(/^### (.+)$/);
      if (h3sub.length >= 2) {
        // Merge: keep h2 sections AND add h3 sub-sections (deduplicating by name)
        const names = new Set(sections.map(s => s.name.toLowerCase()));
        const extras = h3sub.filter(s => !names.has(s.name.toLowerCase()));
        return [...sections, ...extras];
      }
    }
    if (sections.length >= 2) return sections;

    // 2. Try ### (h3) — proposals that use h3 as primary sections
    const h3 = tryExtract(/^### (.+)$/);
    if (h3.length >= 2) return h3;

    // 3. Try # (h1) but skip the first one (document title), use remaining h1s
    const h1All = tryExtract(/^# (.+)$/);
    if (h1All.length >= 3) return h1All.slice(1); // skip title
    if (h1All.length === 2) return h1All;

    // 4. Try **Bold heading:** or **Bold heading** pseudo-headings (common in Word/paste)
    const boldSections: { name: string; content: string }[] = [];
    const boldLines = markdown.split('\n');
    let boldName: string | null = null;
    let boldBody: string[] = [];
    for (const line of boldLines) {
      const bm = line.match(/^\*\*([^*]{3,60})\*\*[:\s]*$/);
      if (bm) {
        if (boldName !== null) {
          const b = boldBody.join('\n').trim();
          if (b) boldSections.push({ name: boldName, content: b });
        }
        boldName = bm[1].trim();
        boldBody = [];
      } else if (boldName !== null) {
        boldBody.push(line);
      }
    }
    if (boldName !== null) {
      const b = boldBody.join('\n').trim();
      if (b) boldSections.push({ name: boldName, content: b });
    }
    if (boldSections.length >= 2) return boldSections;

    // 5. Any h2 or h3 we found (even 1)
    if (sections.length > 0) return sections;
    if (h3.length > 0) return h3;

    // 6. Fallback: split on blank-line-separated paragraphs as sections
    const paras = markdown.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 40);
    if (paras.length >= 2) {
      return paras.slice(0, 10).map((p, i) => ({
        name: p.split('\n')[0].replace(/^[#*\s]+/, '').slice(0, 60) || `Section ${i + 1}`,
        content: p,
      }));
    }

    // 7. Last resort: whole document as Overview
    if (markdown.trim()) {
      return [{ name: 'Overview', content: markdown }];
    }
    return [];
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
