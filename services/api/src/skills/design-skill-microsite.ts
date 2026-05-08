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

const CUSTOM_HTML_SECTION_TYPES = new Set([
  'hero', 'features', 'feature-grid', 'feature-list',
  'cta', 'overview', 'challenge', 'solution', 'approach',
  'metrics', 'stats', 'problem-solution',
]);

type Tone = (typeof TONES)[number];

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function extractTitle(markdown: string): string {
  return markdown.match(/^#\s+(.+)/m)?.[1]?.trim() ?? markdown.slice(0, 40).trim();
}

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

  const title = extractTitle(proposal);
  // XOR title hash with current millisecond timestamp so each generation picks a different tone
  const tone = TONES[(simpleHash(title) ^ (Date.now() & 0xFFFF)) % TONES.length];

  const skillBlock = [
    `⚙️ MICROSITE DESIGN SKILL — Apply the following frontend-design guidelines STRICTLY to every section:`,
    ``,
    `Selected aesthetic direction: "${tone}"`,
    `This is the committed direction. Execute it with full intentionality and precision.`,
    ``,
    `=== FRONTEND-DESIGN SKILL (every rule below is mandatory) ===`,
    SKILL_CONTENT,
    `=== END FRONTEND-DESIGN SKILL ===`,
    ``,
    `NEVER: Inter, Roboto, Arial, Space Grotesk, system-ui, or purple gradients on white backgrounds.`,
    `The one thing the viewer must remember: commit to the "${tone}" aesthetic — UNFORGETTABLY.`,
    `No two microsites should ever look the same.`,
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

async function generateSectionHtml(
  section: Record<string, unknown>,
  tone: Tone,
  cssVars: Record<string, string>,
  fallbackImageUrl: string | null,
  generateFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const sectionType = section.sectionType as string;
  const sid = String(section.id ?? 'sec').replace(/[^a-zA-Z0-9_-]/g, '-');
  const contentJson = JSON.stringify(section.content ?? {}, null, 2);
  const varsList = Object.entries(cssVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

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
    : `IMAGE: No image available. Use CSS gradients (var(--ms-gradient-hero)) for visual elements. NEVER invent external image URLs.`;

  const prompt = [
    `You are the frontend-design skill. Generate a UNIQUE, production-quality HTML section for a microsite.`,
    ``,
    `Section type: ${sectionType}`,
    `Aesthetic direction: "${tone}" — commit fully, no safe defaults`,
    ``,
    `=== CSS VARIABLES (use var() to reference — never hardcode hex) ===`,
    varsList,
    `=== END VARIABLES ===`,
    ``,
    `=== SECTION CONTENT (render ALL fields below) ===`,
    contentJson,
    `=== END CONTENT ===`,
    ``,
    imageInstruction,
    ``,
    `=== FRONTEND-DESIGN SKILL PRINCIPLES ===`,
    SKILL_CONTENT,
    `=== END PRINCIPLES ===`,
    ``,
    `REQUIREMENTS:`,
    `1. Root: <div class="ms-cv ms-cv-${sid}"> ... </div>`,
    `2. Put <style> block INSIDE the root div, scoped to .ms-cv-${sid}`,
    `3. width:100%; box-sizing:border-box; overflow:hidden; min-height:300px`,
    `4. padding: 80px 5% on the root element`,
    `5. Responsive via flexbox/grid + @media for 320px-1440px`,
    `6. Use ONLY var(--ms-*) for all colors and font families`,
    ``,
    `CREATIVE STRUCTURE — pick one and execute it boldly:`,
    `A. Asymmetric split (60/40 or 70/30) — text left, visual right (or reversed)`,
    `B. Full-bleed with large background + floating glass/frosted content`,
    `C. Diagonal clip-path background strip behind content`,
    `D. Massive display typography (6vw+) as the hero element`,
    `E. Irregular CSS grid with named areas and overlapping layers`,
    `F. Staggered columns at different vertical offsets`,
    ``,
    `NEVER: centered card grid, equal-width Bootstrap columns, generic stacked layout`,
    `NEVER: invent image URLs — use only the URL provided above or CSS gradients`,
    ``,
    `Return ONLY the HTML. Start with <div. No markdown fences, no explanation.`,
  ].join('\n');

  const raw = await generateFn(prompt);
  return raw.replace(/^```(?:html)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
}

export async function injectThemeCSS(
  layoutAST: Record<string, unknown>,
  tone: Tone,
  brandPrimaryColor: string | undefined,
  generateFn: (prompt: string) => Promise<string>,
  extraImageUrls: string[] = [],
): Promise<void> {
  if (!SKILL_CONTENT) return;

  const prompt = [
    `You are applying the frontend-design skill to generate CSS design tokens for a microsite.`,
    ``,
    `The chosen aesthetic direction is: "${tone}"`,
    `Brand primary color hint: ${brandPrimaryColor ?? 'none — choose what best fits the aesthetic'}`,
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
    `- --ms-accent-rgb: RGB numbers of --ms-accent with no # or rgba wrapper (e.g. 99,102,241)`,
    `- fontFaceDeclarations: one @keyframes ms-entrance block only`,
    `- No two generations should look the same — commit fully to the "${tone}" direction`,
  ].join('\n');

  try {
    const raw = await generateFn(prompt);
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const jsonStr = firstBrace !== -1 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;

    const parsed = JSON.parse(jsonStr) as {
      extractedCssVariables?: Record<string, string>;
      googleFontsUrl?: string;
      fontFaceDeclarations?: string;
    };

    if (!parsed.extractedCssVariables || typeof parsed.extractedCssVariables !== 'object') {
      console.warn('[design-skill-microsite] Phase 2: LLM returned unexpected shape — skipping CSS inject');
      return;
    }

    const brand = (layoutAST.brand as Record<string, unknown> | undefined) ?? {};
    layoutAST.brand = {
      ...brand,
      extractedCssVariables: parsed.extractedCssVariables,
      overrideTheme: true,
      ...(parsed.googleFontsUrl ? { googleFontsUrl: parsed.googleFontsUrl } : {}),
      ...(parsed.fontFaceDeclarations ? { fontFaceDeclarations: parsed.fontFaceDeclarations } : {}),
    };

    console.log(`[design-skill-microsite] Phase 2: injected "${tone}" CSS theme (fonts: ${
      (parsed.extractedCssVariables['--ms-font-heading'] ?? '?')} / ${
      (parsed.extractedCssVariables['--ms-font-body'] ?? '?')})`);

    // Phase 3: generate unique HTML per section in parallel
    const sections = layoutAST.sections as Record<string, unknown>[] | undefined;
    if (Array.isArray(sections)) {
      // Collect real image URLs: AST section images + caller-supplied folder scan
      const astImageUrls: string[] = sections
        .map((s) => {
          const img = s.image as Record<string, unknown> | undefined;
          const raw = img?.url as string | undefined;
          return raw ? resolveImageUrl(raw) : null;
        })
        .filter((u): u is string => u !== null);
      // Deduplicate and merge — extraImageUrls first so folder images fill gaps
      const seen = new Set<string>();
      const availableImageUrls: string[] = [...extraImageUrls, ...astImageUrls].filter((u) => {
        if (seen.has(u)) return false;
        seen.add(u);
        return true;
      });

      const targets = sections.filter(
        (s) =>
          typeof s.sectionType === 'string' &&
          CUSTOM_HTML_SECTION_TYPES.has(s.sectionType) &&
          typeof s.id === 'string',
      );
      await Promise.all(
        targets.map(async (section, idx) => {
          // Assign a fallback image cycling through available URLs so each section gets one
          const fallback = availableImageUrls.length > 0
            ? availableImageUrls[idx % availableImageUrls.length]
            : null;
          try {
            section.customHtml = await generateSectionHtml(
              section,
              tone,
              parsed.extractedCssVariables!,
              fallback,
              generateFn,
            );
            console.log(`[design-skill-microsite] Phase 3: HTML generated for "${section.sectionType as string}"`);
          } catch (err) {
            console.warn(
              `[design-skill-microsite] Phase 3: HTML failed for "${section.sectionType as string}" (non-fatal):`,
              err instanceof Error ? err.message : err,
            );
          }
        }),
      );
    }
  } catch (err) {
    console.warn('[design-skill-microsite] Phase 2 CSS generation failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}
