import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

const SKILL_CONTENT = (() => {
  for (const p of [
    join(__dir, 'frontend-design.md'),
    join(__dir, '..', 'skills', 'frontend-design.md'),
    join(__dir, '..', 'src', 'skills', 'frontend-design.md'),
  ]) {
    try { return readFileSync(p, 'utf-8'); } catch { /* try next */ }
  }
  console.warn('[design-skill-microsite] frontend-design.md not found — CSS generation will be skipped');
  return '';
})();

const TONES = [
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

export type Tone = (typeof TONES)[number];

// Maps client industry keywords to appropriate tones, preventing random dark/neon
// themes from being applied to family recreation, healthcare, or other warm-context brands.
const INDUSTRY_TONE_MAP: Array<{ keywords: string[]; tones: Tone[] }> = [
  {
    keywords: ['playground', 'trampoline', 'indoor recreation', 'recreation', 'family', 'park', 'bounce', 'leisure', 'entertainment center', 'amusement'],
    tones: ['playful/toy-like', 'playful/toy-like', 'playful/toy-like', 'editorial/magazine'],
  },
  {
    keywords: ['healthcare', 'medical', 'clinic', 'hospital', 'wellness', 'health'],
    tones: ['soft/pastel', 'organic/natural', 'brutally minimal'],
  },
  {
    keywords: ['luxury', 'premium', 'high-end', 'fashion', 'jewellery', 'jewelry', 'yacht', 'hospitality', 'hotel', 'real estate'],
    tones: ['luxury/refined', 'art deco/geometric', 'brutally minimal'],
  },
  {
    keywords: ['saas', 'software', 'technology', 'platform', 'api', 'cloud', 'machine learning', 'data engineering'],
    tones: ['brutally minimal', 'retro-futuristic', 'art deco/geometric', 'industrial/utilitarian'],
  },
  {
    keywords: ['consulting', 'advisory', 'strategy', 'professional services', 'management consulting'],
    tones: ['editorial/magazine', 'luxury/refined', 'brutally minimal'],
  },
  {
    keywords: ['marketing', 'digital agency', 'creative agency', 'branding', 'advertising', 'seo agency'],
    tones: ['editorial/magazine', 'brutally minimal', 'maximalist chaos'],
  },
];

function selectToneForIndustry(clientIndustry: string): Tone | null {
  if (!clientIndustry) return null;
  const lower = clientIndustry.toLowerCase();
  for (const entry of INDUSTRY_TONE_MAP) {
    if (entry.keywords.some(k => lower.includes(k))) {
      return entry.tones[Math.floor(Math.random() * entry.tones.length)];
    }
  }
  return null;
}

export const CUSTOM_HTML_SECTION_TYPES = new Set([
  'hero', 'features', 'feature-grid', 'feature-list',
  'cta', 'overview', 'challenge', 'solution', 'approach',
  'metrics', 'stats', 'problem-solution',
  // Every section type gets LLM-generated HTML — no predefined React component fallbacks
  'timeline', 'deliverables', 'pricing', 'whyus', 'nextsteps',
  'generic', 'testimonials', 'showcase', 'benefits', 'casestudy',
  'team', 'comparison', 'security', 'techstack', 'testing', 'faq',
  'approval', 'chart',
]);



export function applyDesignSkill(
  agentName: string,
  metadata: Record<string, unknown>,
): { metadata: Record<string, unknown>; tone: Tone } {
  const defaultTone: Tone = 'luxury/refined';

  if (agentName !== 'microsite-generator-agent') {
    return { metadata, tone: defaultTone };
  }

  const proposal = (metadata.proposalMarkdown as string | undefined) ?? '';
  if (!proposal) {
    return { metadata, tone: defaultTone };
  }

  // Industry-aware tone selection: pick a contextually appropriate tone when clientIndustry
  // is known, otherwise fall back to a fully random selection.
  const clientIndustry = (metadata.clientIndustry as string | undefined) ?? '';
  const tone = selectToneForIndustry(clientIndustry) ?? TONES[Math.floor(Math.random() * TONES.length)];

  // Keep customInstructions lean — full skill content goes to Phase 2 (CSS) and Phase 3 (HTML)
  // only. Sending 900 tokens here would repeat them for every Pass 2 section (8-15×).
  const skillBlock = [
    `⚙️ FRONTEND-DESIGN SKILL — aesthetic direction: "${tone}"`,
    `Commit fully to this direction in every section: typography, spacing, color, voice.`,
    `NEVER: Inter, Roboto, Arial, Space Grotesk, or safe centered card grids.`,
    `SECTION PLANNING: Aim for 8–14 sections for comprehensive proposals. Each sectionType MUST be unique — never assign the same type to two sections. Prefer named types (challenge, approach, deliverables, timeline, pricing, whyus, nextsteps) over generic. Consolidate: all timeline/schedule content → one timeline section, all scope/deliverables → one deliverables section.`,
  ].join('\n');

  const existingInstructions = metadata.customInstructions as string | undefined;

  const designBrief =
    (metadata.designBrief as string | undefined) ??
    `Aesthetic direction: ${tone}. Apply frontend-design skill — ` +
      `distinctive typography (never Inter/Roboto/Arial/Space Grotesk), ` +
      `bold committed color palette, intentional spatial composition.`;

  return {
    metadata: {
      ...metadata,
      customInstructions: existingInstructions
        ? `${existingInstructions}\n\n${skillBlock}`
        : skillBlock,
      designBrief,
    },
    tone,
  };
}

function resolveImageUrl(rawUrl: string): string {
  return rawUrl.startsWith('/presentation-images/') ? `/api${rawUrl}` : rawUrl;
}

const LAYOUT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

interface HeroProposalMeta {
  clientName?: string;
  preparedBy?: string;
  date?: string;
  version?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Finds the character index of the closing </div> that matches the FIRST opening <div>
 * in `html`, by counting nesting depth. Robust against any extra content the LLM appends
 * after the root element (extra divs, comment bars, orphan tags, etc.).
 */
function findRootClosingDiv(html: string): number {
  let depth = 0;
  let pos = 0;

  while (pos < html.length) {
    // Search for the next opening <div or closing </div from current position
    const openRe = /<div[\s>]/g;
    openRe.lastIndex = pos;
    const closeRe = /<\/div>/g;
    closeRe.lastIndex = pos;

    const openMatch  = openRe.exec(html);
    const closeMatch = closeRe.exec(html);

    if (!closeMatch) break;

    if (openMatch && openMatch.index < closeMatch.index) {
      depth++;
      pos = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      if (depth === 0) return closeMatch.index;
      pos = closeMatch.index + 6; // len('</div>')
    }
  }
  return -1;
}

/**
 * Injects a deterministic 4-column metadata strip at the bottom of the hero HTML.
 * Post-generation injection — 100% reliable regardless of what the LLM generates.
 */
function injectHeroMetadataStrip(html: string, meta: HeroProposalMeta): string {
  const col = (label: string, value: string) =>
    `<div>` +
    `<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;line-height:1.2;margin-bottom:3px;color:var(--ink-soft,var(--text-mid,var(--muted,rgba(0,0,0,0.45))))">${label}</div>` +
    `<div style="font-size:13px;font-weight:600;line-height:1.3;color:var(--ink,var(--text-dark,var(--text,#1a1205)))">${esc(value)}</div>` +
    `</div>`;

  const strip =
    `<div class="ms-hero-meta" style="` +
    `position:absolute;bottom:0;left:0;right:0;` +
    `padding:14px 5%;` +
    `border-top:1px solid rgba(0,0,0,0.15);` +
    `display:flex;align-items:flex-end;justify-content:space-between;gap:12px;` +
    `box-sizing:border-box;font-family:inherit;` +
    `color:var(--ink,var(--text-dark,var(--text,var(--ms-text,#1a1205))));">` +
    `<style>` +
    `@media(max-width:600px){` +
    `.ms-hero-meta{flex-wrap:wrap;gap:10px}` +
    `.ms-hero-meta .ms-hero-meta-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px 20px}` +
    `.ms-hero-meta .ms-hero-scroll{display:none}` +
    `}` +
    `</style>` +
    `<div class="ms-hero-meta-cols" style="display:flex;gap:clamp(16px,3vw,48px)">` +
    col('CLIENT',      meta.clientName  || '—') +
    col('PREPARED BY', meta.preparedBy  || '—') +
    col('DATE',        meta.date        || '—') +
    col('VERSION',     meta.version     || 'v1') +
    `</div>` +
    `<div class="ms-hero-scroll" style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:9px;letter-spacing:.14em;text-transform:uppercase;opacity:.4" aria-hidden="true">SCROLL</div>` +
    `</div>`;

  // Add position:relative to the root div so the absolute-positioned strip works
  let result = html.replace(
    /^(<div\b[^>]*?)(style="([^"]*)")?(\s*>)/,
    (_m, pre, styleAttr, styleVal, close) => {
      const existing = styleVal ?? '';
      if (existing.includes('position:relative') || existing.includes('position: relative')) return _m;
      const newStyle = `position:relative;${existing}`;
      return styleAttr ? `${pre}style="${newStyle}"${close}` : `${pre} style="${newStyle}"${close}`;
    },
  );

  // Remove overflow:hidden from the root class CSS — it clips the absolute-positioned strip.
  // Replace with overflow:clip (clips paint without creating a scroll container).
  result = result.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/,
    (_m, open, css, close) => {
      const fixed = css.replace(/overflow\s*:\s*hidden/g, 'overflow:clip');
      return open + fixed + close;
    },
  );

  // Add padding-bottom to the root so strip doesn't overlap hero content
  result = result.replace(
    /^(<div\b[^>]*?style=")([^"]*)(")/,
    (_m, pre, styleVal, close) => {
      if (styleVal.includes('padding-bottom')) return _m;
      return `${pre}padding-bottom:70px;${styleVal}${close}`;
    },
  );

  // Find the root div's matching closing tag (not just the last </div> in the string)
  const rootClosePos = findRootClosingDiv(result);
  if (rootClosePos === -1) return result + strip;
  return result.slice(0, rootClosePos) + strip + result.slice(rootClosePos);
}

export async function generateSectionHtml(
  section: Record<string, unknown>,
  tone: Tone,
  cssVars: Record<string, string>,
  fallbackImageUrl: string | null,
  generateFn: (prompt: string) => Promise<string>,
  layoutIndex: number = 0,
): Promise<string> {
  const sectionType = section.sectionType as string;
  const sid = String(section.id ?? 'sec').replace(/[^a-zA-Z0-9_-]/g, '-');
  const contentJson = JSON.stringify(section.content ?? {}, null, 2);

  // Hero-only: pull proposal metadata injected by the route handler for the bottom strip
  const heroMeta = sectionType === 'hero'
    ? (section._meta as HeroProposalMeta | undefined)
    : undefined;

  // Compact design hint from Phase 2 (accent + fonts only — ~20 tokens vs 200 for full varsList)
  const accentHint = cssVars['--ms-accent'] ?? '';
  const fontHeadingHint = cssVars['--ms-font-heading'] ?? '';
  const fontBodyHint = cssVars['--ms-font-body'] ?? '';
  const isDark = cssVars['--ms-is-dark'] !== '0';
  const designHint = [
    accentHint && `accent: ${accentHint}`,
    fontHeadingHint && `heading font: ${fontHeadingHint}`,
    fontBodyHint && `body font: ${fontBodyHint}`,
    `theme: ${isDark ? 'dark' : 'light'}`,
  ].filter(Boolean).join(', ');

  // Use section's own image URL, or fall back to a shared image from the presentation
  const imageData = section.image as Record<string, unknown> | undefined;
  const rawImageUrl = (imageData?.url as string | undefined) ?? null;
  const imageUrl = rawImageUrl
    ? resolveImageUrl(rawImageUrl)
    : fallbackImageUrl;

  const imageInstruction = imageUrl
    ? [
        `IMAGE: You MUST include this image visibly in the layout using an <img> tag:`,
        `  <img src="${imageUrl}" alt="section visual" style="width:100%;height:100%;object-fit:cover;display:block;" />`,
        `Rules for the image container:`,
        `  - Place the <img> inside a dedicated container div`,
        `  - The container MUST have an explicit height or min-height (e.g. min-height:420px)`,
        `  - Set position:relative on the container if needed`,
        `  - NEVER use background-image for this image — use an <img> tag only`,
        `  - NEVER invent or substitute any other URL`,
      ].join('\n')
    : `IMAGE: No image available. Use CSS gradients from your own design system for visual elements. NEVER invent external image URLs.`;

  const prompt = [
    `You are the frontend-design skill. Generate a UNIQUE, production-quality HTML section for a microsite.`,
    ``,
    `Section type: ${sectionType}`,
    `Aesthetic direction: "${tone}" — commit fully, no safe defaults`,
    designHint ? `Design hint (from global theme): ${designHint}` : '',
    ``,
    `DESIGN SYSTEM: Define your own CSS variables scoped to .ms-cv-${sid} in the <style> block.`,
    `Choose colors, fonts, and gradients that match the "${tone}" aesthetic.`,
    `Use these variables via var() throughout — define them on .ms-cv-${sid}, not :root.`,
    `Example: .ms-cv-${sid} { --bg: #0a0a0f; --accent: #ff4500; --font-h: 'Bebas Neue', sans-serif; }`,
    `NEVER use Inter, Roboto, Arial, Space Grotesk, or system-ui for headings.`,
    ``,
    `=== SECTION CONTENT (render ALL fields below) ===`,
    contentJson,
    `=== END CONTENT ===`,
    ``,
    imageInstruction,
    ``,
    `DESIGN PRINCIPLES (mandatory):`,
    `- Asymmetry over symmetry. Unexpected spatial rhythm. Overlapping layers.`,
    `- Scroll-trigger animations: staggered fade-up, slide-in from edges (CSS only, no JS libs).`,
    `- Typography as a design element: mix display (6vw+) with tight utility text.`,
    `- Every element intentional — no padding/margin filler, no empty decoration.`,
    ``,
    `REQUIREMENTS:`,
    `1. Root: <div class="ms-cv ms-cv-${sid}"> ... </div>`,
    `2. Put <style> block INSIDE the root div, scoped to .ms-cv-${sid}`,
    `3. width:100%; box-sizing:border-box; overflow:hidden; min-height:300px`,
    `4. padding: 80px 5% on the root element`,
    `5. Responsive via flexbox/grid + @media for 320px-1440px`,
    `6. Load any Google Fonts you choose via @import in the <style> block`,
    ``,
    `CONTENT REQUIREMENTS (mandatory — overrides visual preferences):`,
    `- Body text: minimum font-size 16px — NEVER render proposal body copy below 15px`,
    `- Section lead paragraphs: max-width 640px, font-size 17–18px for readability`,
    `- Every section MUST have: eyebrow label + headline + at least one body paragraph of ≥50 words`,
    `- Do NOT render a section as heading + list only — always precede the list with a contextual body paragraph`,
    `- Card/grid sections: each card MUST have a title AND a description of ≥2 sentences`,
    `- Timeline sections: show phase name, duration, AND owner (Agency/Client/Joint) if present in content JSON`,
    `- Deliverables sections: show bullet-point deliverables per workstream, NOT just workstream names`,
    ``,
    `LAYOUT SAFETY RULES (prevent clipping and invisible text — non-negotiable):`,
    `- NEVER use overflow:hidden on any element that contains body text or list content`,
    `- Full-width "wide" cards (cards that span all columns): NEVER use grid-template-columns on their inner content wrapper — use flex-direction:column or a single-column grid instead. Two-column grids inside full-width cards cause text to be squeezed into half-width and overflow the left edge.`,
    `- All text must have sufficient contrast against its background. NEVER place light-colored text over a light background or decorative gradient without a solid/semi-opaque background on the text container.`,
    `- Pseudo-elements (::before, ::after) used as decorative overlays MUST use pointer-events:none and z-index lower than the text content. NEVER allow a decorative layer to sit above readable text.`,
    `- When using CSS grid for staggered column layouts, the full-width element (last item or "wide" card) MUST use grid-column: 1 / -1 on the card itself AND its inner content must NOT re-introduce a multi-column grid.`,
    `- Root element padding: use padding: 80px 5% but set min-width:0 on all flex/grid children to prevent text overflow.`,
    ``,
    `ASSIGNED LAYOUT: ${LAYOUT_LETTERS[layoutIndex % LAYOUT_LETTERS.length]} — execute this structure exactly, no substitutions:`,
    `A. Asymmetric split (60/40 or 70/30) — text left, visual right (or reversed)`,
    `B. Full-bleed with large background + floating glass/frosted content`,
    `C. Diagonal clip-path background strip behind content`,
    `D. Massive display typography (6vw+) as the hero element`,
    `E. Irregular CSS grid with named areas and overlapping layers`,
    `F. Staggered columns at different vertical offsets`,
    ``,
    `NEVER: centered card grid, equal-width Bootstrap columns, generic stacked layout`,
    `NEVER: invent image URLs — use only the URL provided above or CSS gradients`,
    ...(heroMeta ? [`NEVER: add a footer bar, footer strip, metadata row, or "confidential" notice — a metadata strip will be injected automatically after your output.`] : []),
    ``,
    `Return ONLY the HTML. Start with <div. No markdown fences, no explanation.`,
  ].filter(line => line !== '').join('\n');

  const raw = await generateFn(prompt);
  const cleaned = raw.replace(/^```(?:html)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();

  // Deterministically inject the 4-column metadata strip at the bottom of the hero.
  // Post-processing guarantees the strip even if the LLM ignores or rephrases the instruction.
  if (sectionType === 'hero' && heroMeta) {
    return injectHeroMetadataStrip(cleaned, heroMeta);
  }

  return cleaned;
}

export interface CSSTheme {
  cssVars: Record<string, string>;
  googleFontsUrl?: string;
  fontFaceDeclarations?: string;
}

function buildCSSPrompt(tone: string, brandPrimaryColor: string | undefined, industryContext?: string): string {
  return [
    `You are applying the frontend-design skill to generate CSS design tokens for a microsite.`,
    ``,
    `The chosen aesthetic direction is: "${tone}"`,
    `Brand primary color hint: ${brandPrimaryColor ?? 'none — choose what best fits the aesthetic'}`,
    industryContext ? `Client industry context: ${industryContext}` : '',
    ``,
    `=== FRONTEND-DESIGN SKILL (apply strictly) ===`,
    SKILL_CONTENT,
    `=== END ===`,
    ``,
    `Generate a JSON object with EXACTLY these keys. All keys are required.`,
    `Return ONLY valid JSON — no markdown fences, no explanation, no trailing text:`,
    `{`,
    `  "extractedCssVariables": {`,
    `    "--ms-bg": "<page background color>",`,
    `    "--ms-surface": "<card/panel background>",`,
    `    "--ms-bg2": "<secondary background>",`,
    `    "--ms-bg3": "<tertiary background>",`,
    `    "--ms-accent": "<primary accent color>",`,
    `    "--ms-text": "<primary text color>",`,
    `    "--ms-text2": "<secondary text color>",`,
    `    "--ms-text3": "<muted text color>",`,
    `    "--ms-border": "<border color>",`,
    `    "--ms-gradient-hero": "<CSS gradient for hero, e.g. linear-gradient(135deg, #111 0%, #222 100%)>",`,
    `    "--ms-gradient-text": "<CSS gradient for heading text, e.g. linear-gradient(90deg, #fff 0%, #aaa 100%)>",`,
    `    "--ms-font-heading": "<display font family with fallback, e.g. 'Syne', sans-serif>",`,
    `    "--ms-font-body": "<body font family with fallback, e.g. 'DM Sans', sans-serif>",`,
    `    "--ms-r-card": "<card border radius, e.g. 12px>",`,
    `    "--ms-shadow": "<box-shadow for cards>",`,
    `    "--ms-shadow-hover": "<box-shadow on hover>",`,
    `    "--ms-is-dark": "<1 for dark theme, 0 for light>",`,
    `    "--ms-accent-rgb": "<accent as r,g,b numbers only, e.g. 99,102,241>",`,
    `    "--ms-node-glow": "<rgba for timeline node glow>",`,
    `    "--ms-accent-glow": "<rgba for CTA glow>"`,
    `  },`,
    `  "googleFontsUrl": "<Google Fonts URL for both chosen fonts, or empty string>",`,
    `  "fontFaceDeclarations": "<exactly one @keyframes block named ms-entrance for the entrance animation>"`,
    `}`,
    ``,
    `Mandatory rules:`,
    `- NEVER use Inter, Roboto, Arial, Space Grotesk, or bare system fonts for heading or body`,
    `- Choose distinctive characterful fonts that match the "${tone}" aesthetic`,
    `- Dominant colors with sharp accents — no timid evenly-distributed palettes`,
    `- DARK THEME TONES — --ms-is-dark MUST be "1" and --ms-bg MUST be dark (#0a0a0f to #1a1a2e range): retro-futuristic, luxury/refined, brutalist/raw, art deco/geometric, industrial/utilitarian, maximalist chaos, editorial/magazine`,
    `- LIGHT THEME TONES — --ms-is-dark MUST be "0" and --ms-bg MUST be light (#f0f0f0 to #ffffff range): soft/pastel, organic/natural, playful/toy-like`,
    `- brutally minimal can be dark or light — your choice, but commit to one extreme`,
    `- Current tone is "${tone}" — enforce the correct dark/light rule above with NO exceptions`,
    industryContext
      ? `- INDUSTRY CONTEXT OVERRIDE: The client industry is "${industryContext}". If it contains any of: recreation, playground, trampoline, family, park, wellness, healthcare, amusement — you MUST use a light, warm palette (--ms-bg: light warm colour, --ms-is-dark: "0") regardless of the tone above.`
      : '',
    `- --ms-accent-rgb: RGB numbers of --ms-accent with no # or rgba wrapper (e.g. 99,102,241)`,
    `- fontFaceDeclarations: one @keyframes ms-entrance block only`,
    `- No two generations should look the same — commit fully to the "${tone}" direction`,
    `- Variation seed: ${Math.floor(Math.random() * 10000)} — use this to drive unique palette and font choices. Never produce the same output twice.`,
  ].join('\n');
}

/** Phase 2 only — generate CSS tokens without touching the AST or running Phase 3.
 *  Call this in parallel with the agent so tokens are ready when sections arrive. */
export async function generateThemeCSSTokens(
  tone: string,
  brandPrimaryColor: string | undefined,
  generateFn: (prompt: string) => Promise<string>,
  clientIndustry?: string,
): Promise<CSSTheme | null> {
  if (!SKILL_CONTENT) return null;
  try {
    const raw = await generateFn(buildCSSPrompt(tone, brandPrimaryColor, clientIndustry));
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const jsonStr = firstBrace !== -1 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
    const parsed = JSON.parse(jsonStr) as { extractedCssVariables?: Record<string, string>; googleFontsUrl?: string; fontFaceDeclarations?: string };
    if (!parsed.extractedCssVariables || typeof parsed.extractedCssVariables !== 'object') return null;
    console.log(`[design-skill-microsite] CSS tokens generated for "${tone}"`);
    return { cssVars: parsed.extractedCssVariables, googleFontsUrl: parsed.googleFontsUrl, fontFaceDeclarations: parsed.fontFaceDeclarations };
  } catch (err) {
    console.warn('[design-skill-microsite] generateThemeCSSTokens failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function injectThemeCSS(
  layoutAST: Record<string, unknown>,
  tone: Tone,
  brandPrimaryColor: string | undefined,
  generateFn: (prompt: string) => Promise<string>,
  extraImageUrls: string[] = [],
  precomputedTheme?: CSSTheme,
  clientIndustry?: string,
): Promise<void> {
  if (!SKILL_CONTENT && !precomputedTheme) return;

  // Phase 2: use pre-computed theme if available, otherwise generate via LLM
  let theme: CSSTheme | null = precomputedTheme ?? null;

  if (!theme) {
    try {
      theme = await generateThemeCSSTokens(tone, brandPrimaryColor, generateFn, clientIndustry);
    } catch (err) {
      console.warn('[design-skill-microsite] Phase 2 CSS generation failed (non-fatal):', err instanceof Error ? err.message : err);
      return;
    }
  }

  if (!theme) return;

  const brand = (layoutAST.brand as Record<string, unknown> | undefined) ?? {};
  layoutAST.brand = {
    ...brand,
    extractedCssVariables: theme.cssVars,
    overrideTheme: true,
    ...(theme.googleFontsUrl ? { googleFontsUrl: theme.googleFontsUrl } : {}),
    ...(theme.fontFaceDeclarations ? { fontFaceDeclarations: theme.fontFaceDeclarations } : {}),
  };

  console.log(`[design-skill-microsite] Phase 2: injected "${tone}" CSS theme (fonts: ${
    (theme.cssVars['--ms-font-heading'] ?? '?')} / ${(theme.cssVars['--ms-font-body'] ?? '?')})`);

  // Phase 3: generate HTML for sections that don't already have customHtml (skips streamed sections)
  const sections = layoutAST.sections as Record<string, unknown>[] | undefined;
  if (Array.isArray(sections)) {
    const astImageUrls: string[] = sections
      .map((s) => { const img = s.image as Record<string, unknown> | undefined; const u = img?.url as string | undefined; return u ? resolveImageUrl(u) : null; })
      .filter((u): u is string => u !== null);
    const seen = new Set<string>();
    const availableImageUrls: string[] = [...extraImageUrls, ...astImageUrls].filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; });

    const targets = sections.filter(
      (s) =>
        typeof s.sectionType === 'string' &&
        CUSTOM_HTML_SECTION_TYPES.has(s.sectionType) &&
        typeof s.id === 'string' &&
        !s.customHtml, // skip sections already rendered during streaming
    );

    if (targets.length > 0) {
      await Promise.all(
        targets.map(async (section, idx) => {
          const fallback = availableImageUrls.length > 0 ? availableImageUrls[idx % availableImageUrls.length] : null;
          try {
            section.customHtml = await generateSectionHtml(section, tone, theme!.cssVars, fallback, generateFn, idx);
            console.log(`[design-skill-microsite] Phase 3: HTML generated for "${section.sectionType as string}"`);
          } catch (err) {
            console.warn(`[design-skill-microsite] Phase 3: HTML failed for "${section.sectionType as string}" (non-fatal):`, err instanceof Error ? err.message : err);
          }
        }),
      );
    }
  }
}
