/**
 * design-editor-agent
 *
 * Applies AI-driven or deterministic edits to a LayoutAST microsite.
 *
 * Modes (auto-detected from instruction):
 *
 *   mood       — "make it glassmorphic / brutalist / luxury / cyberpunk / playful / editorial"
 *                → LLM design-system synthesis with mood-specific prompt prefix
 *                  + structural patches (hoverStyle, dividerStyle) for the mood
 *                  Falls back to deterministic token patch when no generateFn.
 *
 *   hover      — "add hover effects / cards lift / micro interactions / polish"
 *                → sets ast.hoverStyle; optionally calls LLM to harmonize token layer
 *
 *   animate    — "animate counters / add motion / stagger / scroll effects"
 *                → sets ast.sectionAnimations per section type (structural, no LLM)
 *
 *   dividers   — "add dividers / wavy / diagonal / section breaks"
 *                → sets ast.dividerStyle (structural, no LLM)
 *
 *   harmonize  — "color harmony / complementary / analogous / triadic palette"
 *                → HSL-based palette from brand.primaryColor (no LLM)
 *
 *   overlay    — "image overlay / duotone / vignette / tint"
 *                → sets imageOverlay on targeted or all sections (no LLM)
 *
 *   decorate   — "add decorations / floating orbs / dots / geometric"
 *                → sets ast.decorations (no LLM)
 *
 *   design     — "make it darker / warmer palette / bolder headlines"
 *                → synthesises customTokens via LLM design system prompt
 *
 *   content    — "rewrite the hero / make approach more urgent"
 *                → rewrites section content via LLM
 */

import type { Agent, AgentInput, AgentOutput } from '@ai-engine/core';
import { buildDesignSystemPrompt, buildFontUrls } from '@ai-engine/agent-microsite-generator';

// ── Types ─────────────────────────────────────────────────────────────────────

type EditMode = 'mood' | 'hover' | 'animate' | 'dividers' | 'harmonize' | 'overlay' | 'decorate' | 'design' | 'content';

// ── Intent classification ─────────────────────────────────────────────────────

const MOOD_KEYWORDS    = /\b(glassmorphic|brutalist|editorial|luxury|luxurious|playful|cyberpunk|neo-brutalist|neumorphic|corporate|minimalist|bold)\b/i;
const HOVER_KEYWORDS   = /\b(hover|micro.?interact|cards? lift|stats? pop|more interactive|interactiv|polish|tilt|clickable)\b/i;
const ANIMATE_KEYWORDS = /\b(animat|counter|roll.?up|roll up|count up|motion|stagger|scroll effect|wave effect|dynamic|reveal)\b/i;
const DIVIDER_KEYWORDS = /\b(divider|section break|wavy|diagonal|zigzag|flowing|sharp cut|separator)\b/i;
const HARMONY_KEYWORDS = /\b(harmoni|complementary|analogous|triadic|split.complementary|color palette|colour palette|generate palette)\b/i;
const OVERLAY_KEYWORDS = /\b(overlay|duotone|vignette|tint|darken image|image filter|image treatment|blur background)\b/i;
const DECORATE_KEYWORDS = /\b(decorat|floating|orb|sparkle|dot pattern|geometric shape|abstract|background shape)\b/i;
const DESIGN_KEYWORDS  = /\b(darker|lighter|brighter|warmer|cooler|bolder|thinner|minimal|modern|clean|elegant|vibrant|muted|contrast|palette|color|colour|font|typography|spacing|dense|spacious|rounded|sharp|shadow|glow|gradient|dark mode|light mode|theme|style|layout|grid)\b/i;
const CONTENT_KEYWORDS = /\b(rewrite|rephrase|make|change|update|improve|strengthen|shorten|expand|more urgent|more compelling|more professional|headline|body|copy|text|message|tone|voice)\b/i;

function classifyIntent(instruction: string): EditMode {
  if (MOOD_KEYWORDS.test(instruction))    return 'mood';
  if (HOVER_KEYWORDS.test(instruction))   return 'hover';
  if (ANIMATE_KEYWORDS.test(instruction)) return 'animate';
  if (DIVIDER_KEYWORDS.test(instruction)) return 'dividers';
  if (HARMONY_KEYWORDS.test(instruction)) return 'harmonize';
  if (OVERLAY_KEYWORDS.test(instruction)) return 'overlay';
  if (DECORATE_KEYWORDS.test(instruction)) return 'decorate';
  const designScore   = (instruction.match(DESIGN_KEYWORDS)   ?? []).length;
  const contentScore  = (instruction.match(CONTENT_KEYWORDS)  ?? []).length;
  return designScore >= contentScore ? 'design' : 'content';
}

// ── Mood presets ──────────────────────────────────────────────────────────────

type TokenPatch = Record<string, unknown>;

const MOOD_PRESETS: Record<string, TokenPatch> = {
  glassmorphic: {
    surfaceCard: 'rgba(255,255,255,0.08)',
    surface: 'rgba(255,255,255,0.05)',
    border: 'rgba(255,255,255,0.15)',
    borderSubtle: 'rgba(255,255,255,0.08)',
    cardShadow: '0 8px 32px rgba(0,0,0,0.3)',
    cardShadowHover: '0 16px 48px rgba(0,0,0,0.4)',
    noiseOpacity: 0.03,
    density: 'spacious',
  },
  brutalist: {
    borderRadius: '0px',
    heroWeight: '900',
    labelTracking: '0.22em',
    buttonStyle: 'sharp',
    density: 'compact',
    noiseOpacity: 0.01,
  },
  editorial: {
    heroStyle: 'italic',
    heroWeight: '300',
    labelTracking: '0.18em',
    density: 'spacious',
    buttonStyle: 'pill',
    noiseOpacity: 0.02,
  },
  luxury: {
    accent: '#C8A96E',
    accentDim: '#B8996E',
    heroFont: 'Cormorant Garamond',
    bodyFont: 'DM Sans',
    heroWeight: '300',
    heroStyle: 'italic',
    noiseOpacity: 0.04,
    density: 'compact',
    buttonStyle: 'pill',
    labelTracking: '0.16em',
  },
  luxurious: {
    accent: '#C8A96E',
    accentDim: '#B8996E',
    heroFont: 'Cormorant Garamond',
    bodyFont: 'DM Sans',
    heroWeight: '300',
    heroStyle: 'italic',
    noiseOpacity: 0.04,
    density: 'compact',
    buttonStyle: 'pill',
    labelTracking: '0.16em',
  },
  playful: {
    accent: '#FF6B6B',
    accentDim: '#FF8E8E',
    borderRadius: '24px',
    buttonStyle: 'pill',
    density: 'spacious',
    noiseOpacity: 0.02,
    labelTracking: '0.10em',
  },
  cyberpunk: {
    accent: '#FF2D78',
    accentDim: '#CC1F5E',
    glowColor: '#FF2D78',
    bodyFont: 'Space Grotesk',
    buttonStyle: 'sharp',
    borderRadius: '0px',
    density: 'compact',
    labelTracking: '0.14em',
  },
  minimalist: {
    noiseOpacity: 0.01,
    density: 'spacious',
    buttonStyle: 'pill',
    borderRadius: '4px',
    labelTracking: '0.12em',
    heroWeight: '300',
  },
  bold: {
    heroWeight: '900',
    labelTracking: '0.06em',
    buttonStyle: 'sharp',
    density: 'compact',
    noiseOpacity: 0.03,
  },
};

// Rich LLM-ready prompt prefixes for each mood — used to drive full design-system generation
const MOOD_LLM_PROMPTS: Record<string, string> = {
  glassmorphic: 'Apply a glassmorphic aesthetic: dark semi-transparent surfaces with frosted-glass blur, rgba backgrounds with low opacity (0.06–0.12), white hairline borders at 10–18% opacity, soft colored glows on accent elements, dark bg (#0a0a12 or similar), high contrast text, subtle noise texture. Components should feel like glass panels floating in space.',
  brutalist: 'Apply a brutalist aesthetic: pure black (#000) or stark white (#fff) background, 0px border radius everywhere, heroWeight 900, thick visible borders (2–3px solid), extreme contrast (black on white or white on black), all-caps labels with wide tracking (0.20em+), no decorative shadows. Raw, confrontational, architectural.',
  editorial: 'Apply an editorial aesthetic: off-white or light grey background (#f8f6f1 or similar), thin serif headline font (Cormorant Garamond or Playfair Display) at weight 300–400, wide generous spacing, accent used very sparingly, muted warm tone, magazine-quality refinement. Feels like a premium design journal.',
  luxury: 'Apply a luxury aesthetic: deep dark background (#0d0b08 or near-black warm tone), warm gold accent (#C8A96E), Cormorant Garamond or DM Serif Display for headlines at weight 300 italic, tight density, subtle noise texture, pill-shaped buttons, label tracking 0.14em. Feels like a high-end fashion or luxury hospitality brand.',
  luxurious: 'Apply a luxurious aesthetic: deep dark background (#0d0b08 or near-black warm tone), warm gold accent (#C8A96E), Cormorant Garamond or DM Serif Display for headlines at weight 300 italic, tight density, subtle noise texture, pill-shaped buttons, label tracking 0.14em. Feels like a high-end fashion or luxury hospitality brand.',
  playful: 'Apply a playful aesthetic: bright warm background or light (#fff or off-white), coral/teal/vibrant accent color, very rounded components (border-radius 20–28px), pill buttons, Nunito or Fraunces headline font, generous spacious padding, friendly humanist feel. Colors are punchy but not garish.',
  cyberpunk: 'Apply a cyberpunk aesthetic: very dark near-black background (#050510), neon hot-pink or electric-cyan accent (#FF2D78 or #00FFD1), Space Grotesk or JetBrains Mono for body, Syne or Space Grotesk for headlines at weight 700–800, 0px border radius, sharp rectangular buttons, colored glow effects on accents, dense layout. Feels like near-future tech noir.',
  minimalist: 'Apply a minimalist aesthetic: pure white or near-white background, single neutral accent (warm grey or very muted blue), thin font weights (300–400), maximal whitespace, no decorative elements, 4–8px border radius, text-link style buttons. Clarity and negative space above all else.',
  bold: 'Apply a bold monumental aesthetic: very dark background, heavy heroWeight 900, large dramatic font scale, high contrast accent, compact density, sharp 0–4px border radius, strong visual presence. Feels like a powerful brand statement.',
};

// Mood → structural AST patches applied ON TOP of LLM token result
const MOOD_STRUCTURAL: Record<string, Record<string, unknown>> = {
  glassmorphic: { hoverStyle: 'glow', dividerStyle: 'curve' },
  brutalist:    { hoverStyle: 'none', dividerStyle: 'diagonal' },
  editorial:    { hoverStyle: 'subtle', dividerStyle: 'none' },
  luxury:       { hoverStyle: 'lift', dividerStyle: 'wave' },
  luxurious:    { hoverStyle: 'lift', dividerStyle: 'wave' },
  playful:      { hoverStyle: 'lift', dividerStyle: 'curve' },
  cyberpunk:    { hoverStyle: 'glow', dividerStyle: 'zigzag' },
  minimalist:   { hoverStyle: 'subtle', dividerStyle: 'none' },
  bold:         { hoverStyle: 'lift', dividerStyle: 'diagonal' },
};

function detectMood(instruction: string): string {
  const lower = instruction.toLowerCase();
  const order = ['glassmorphic', 'brutalist', 'editorial', 'luxurious', 'luxury', 'playful', 'cyberpunk', 'minimalist', 'bold'];
  for (const mood of order) {
    if (lower.includes(mood)) return mood;
  }
  return 'editorial';
}

// ── Color harmony (HSL math — no LLM) ────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const lum = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = lum > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: hue = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: hue = ((b - r) / d + 2) / 6; break;
      case b: hue = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(hue * 360), Math.round(sat * 100), Math.round(lum * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const hNorm = ((h % 360) + 360) % 360;
  const sNorm = s / 100, lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => {
    const k = (n + hNorm / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

type HarmonyStrategy = 'complementary' | 'analogous' | 'triadic' | 'split-complementary';

function detectHarmonyStrategy(instruction: string): HarmonyStrategy {
  const lower = instruction.toLowerCase();
  if (lower.includes('analogous')) return 'analogous';
  if (lower.includes('triadic'))   return 'triadic';
  if (lower.includes('split'))     return 'split-complementary';
  return 'complementary';
}

function buildHarmonyPalette(primaryHex: string, strategy: HarmonyStrategy): TokenPatch {
  try {
    const [h, s, l] = hexToHsl(primaryHex);
    let accentHue: number;
    let glowHue: number;
    switch (strategy) {
      case 'analogous':          accentHue = h + 30;  glowHue = h - 30;  break;
      case 'triadic':            accentHue = h + 120; glowHue = h + 240; break;
      case 'split-complementary': accentHue = h + 150; glowHue = h + 210; break;
      default:                   accentHue = h + 180; glowHue = h + 180; break; // complementary
    }
    const accent    = hslToHex(accentHue, Math.min(s + 5, 100), Math.max(l - 5, 20));
    const accentDim = hslToHex(accentHue, Math.max(s - 15, 20), Math.min(l + 10, 80));
    const glowColor = hslToHex(glowHue, Math.min(s + 10, 100), Math.max(l - 10, 20));
    return { accent, accentDim, glowColor };
  } catch {
    return {};
  }
}

// ── Color derivation helper ───────────────────────────────────────────────────

/**
 * Shift a hex color's lightness by `amount` percentage points (+/- 0–100).
 * Positive = lighter, negative = darker.
 */
function deriveColor(hex: string, amount: number): string {
  try {
    const [h, s, l] = hexToHsl(hex);
    const newL = Math.max(0, Math.min(100, l + amount));
    return hslToHex(h, s, newL);
  } catch {
    return hex;
  }
}

// ── Overlay style builder ─────────────────────────────────────────────────────

type OverlayType = 'gradient' | 'duotone' | 'vignette' | 'tint';

function detectOverlayType(instruction: string): OverlayType {
  const lower = instruction.toLowerCase();
  if (lower.includes('duotone')) return 'duotone';
  if (lower.includes('vignette')) return 'vignette';
  if (lower.includes('tint')) return 'tint';
  return 'gradient';
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class DesignEditorAgent implements Agent {
  readonly name = 'design-editor-agent';
  readonly description =
    'Apply AI-driven design or content edits to a presentation microsite AST.';

  async run(input: AgentInput): Promise<AgentOutput> {
    const meta = input.metadata ?? {};
    const ast = meta['currentAst'] as Record<string, unknown> | undefined;
    const instruction = (meta['instruction'] as string | undefined)?.trim() ?? '';
    const targetSectionId = meta['targetSectionId'] as string | undefined;

    if (!ast || !instruction) {
      return {
        markdown: 'Missing currentAst or instruction.',
        json: { ast: ast ?? null, mode: null, changed: [] },
      };
    }

    const generateFn = meta['generateFn'] as
      | ((prompt: string) => Promise<string>)
      | undefined;

    const mode = classifyIntent(instruction);

    // Fully deterministic modes (structural-only — no visual token changes)
    switch (mode) {
      case 'animate':   return this.applyAnimateEdit(ast);
      case 'dividers':  return this.applyDividersEdit(ast, instruction);
      case 'harmonize': return this.applyHarmonizeEdit(ast, instruction);
      case 'overlay':   return this.applyOverlayEdit(ast, instruction, targetSectionId);
      case 'decorate':  return this.applyDecorateEdit(ast, instruction);
    }

    // Visual modes — use LLM when generateFn is available for rich token synthesis
    if (!generateFn) {
      // Fallback: deterministic patches only
      if (mode === 'mood')  return this.applyMoodEditFallback(ast, instruction);
      if (mode === 'hover') return this.applyHoverEdit(ast, instruction);
      return {
        markdown: 'No generateFn provided — cannot call LLM.',
        json: { ast, mode, changed: [] },
      };
    }

    if (mode === 'mood')    return this.applyMoodEdit(ast, instruction, generateFn);
    if (mode === 'hover')   return this.applyHoverEdit(ast, instruction);
    if (mode === 'design')  return this.applyDesignEdit(ast, instruction, generateFn);
    return this.applyContentEdit(ast, instruction, targetSectionId, generateFn);
  }

  // ── Mood mode (LLM-driven) ────────────────────────────────────────────────

  private async applyMoodEdit(
    ast: Record<string, unknown>,
    instruction: string,
    generateFn: (prompt: string) => Promise<string>,
  ): Promise<AgentOutput> {
    const mood = detectMood(instruction);
    const moodPromptPrefix = MOOD_LLM_PROMPTS[mood] ?? MOOD_LLM_PROMPTS['editorial'];
    const structural = MOOD_STRUCTURAL[mood] ?? {};

    // Combine mood description with the original instruction for LLM
    const enrichedInstruction = `${moodPromptPrefix}\n\nUser instruction: "${instruction}"`;

    // Call the shared LLM design-system path
    const llmResult = await this.applyDesignEdit(ast, enrichedInstruction, generateFn, 'mood');

    // Overlay structural patches (hoverStyle, dividerStyle) on top of LLM output
    const llmJson = llmResult.json as Record<string, unknown>;
    const llmAst = (llmJson['ast'] as Record<string, unknown>) ?? ast;
    const patchedAst = {
      ...llmAst,
      ...structural,
      customCharacter: `${mood} aesthetic — ${instruction}`,
    };

    const changed = [...((llmJson['changed'] as string[]) ?? []), ...Object.keys(structural)];
    return {
      markdown: llmResult.markdown,
      json: { ast: patchedAst, mode: 'mood', changed },
    };
  }

  // ── Mood fallback (deterministic — when no LLM available) ─────────────────

  private applyMoodEditFallback(ast: Record<string, unknown>, instruction: string): AgentOutput {
    const mood = detectMood(instruction);
    const preset = MOOD_PRESETS[mood] ?? MOOD_PRESETS['editorial'];
    const structural = MOOD_STRUCTURAL[mood] ?? {};
    const patchedAst = {
      ...ast,
      ...structural,
      customTokens: { ...(ast['customTokens'] as Record<string, unknown> | undefined ?? {}), ...preset },
      customCharacter: `${mood} aesthetic — ${instruction}`,
    };
    return {
      markdown: `Mood applied: "${mood}". Updated design tokens for ${Object.keys(preset).join(', ')}.`,
      json: { ast: patchedAst, mode: 'mood', changed: ['customTokens', 'customCharacter', ...Object.keys(structural)] },
    };
  }

  // ── Hover mode ────────────────────────────────────────────────────────────

  private applyHoverEdit(ast: Record<string, unknown>, instruction: string): AgentOutput {
    const lower = instruction.toLowerCase();
    let hoverStyle: string;
    if (lower.includes('tilt'))   hoverStyle = 'tilt';
    else if (lower.includes('glow')) hoverStyle = 'glow';
    else if (lower.includes('subtle')) hoverStyle = 'subtle';
    else if (lower.includes('none') || lower.includes('off')) hoverStyle = 'none';
    else hoverStyle = 'lift';

    const patchedAst = { ...ast, hoverStyle };
    return {
      markdown: `Hover style set to "${hoverStyle}". Cards, stats, and testimonials will use this interaction.`,
      json: { ast: patchedAst, mode: 'hover', changed: ['hoverStyle'] },
    };
  }

  // ── Animate mode ──────────────────────────────────────────────────────────

  private applyAnimateEdit(ast: Record<string, unknown>): AgentOutput {
    const sections = (ast['sections'] as Array<Record<string, unknown>> | undefined) ?? [];
    const sectionAnimations: Record<string, string> = {};
    for (const section of sections) {
      const id = section['id'] as string;
      const type = section['sectionType'] as string;
      switch (type) {
        case 'stats': case 'metrics': case 'whyus':
          sectionAnimations[id] = 'counterRollup'; break;
        case 'benefits': case 'techstack': case 'deliverables': case 'security':
          sectionAnimations[id] = 'staggerWave'; break;
        case 'challenge': case 'approach': case 'problem':
          sectionAnimations[id] = 'slideLeft'; break;
        case 'hero':
          sectionAnimations[id] = 'scale'; break;
        default:
          sectionAnimations[id] = 'fadeUp';
      }
    }
    const patchedAst = {
      ...ast,
      sectionAnimations,
      behavior: { ...(ast['behavior'] as Record<string, unknown> | undefined ?? {}), scrollEffects: 'fade-in', motion: 'deliberate' },
    };
    return {
      markdown: `Animation profiles assigned to ${sections.length} sections. Stats sections will roll up counters; grid sections will stagger wave.`,
      json: { ast: patchedAst, mode: 'animate', changed: ['sectionAnimations', 'behavior'] },
    };
  }

  // ── Dividers mode ─────────────────────────────────────────────────────────

  private applyDividersEdit(ast: Record<string, unknown>, instruction: string): AgentOutput {
    const lower = instruction.toLowerCase();
    let dividerStyle: string;
    if (lower.includes('wave') || lower.includes('wavy')) dividerStyle = 'wave';
    else if (lower.includes('diagonal'))  dividerStyle = 'diagonal';
    else if (lower.includes('curve'))     dividerStyle = 'curve';
    else if (lower.includes('zigzag'))    dividerStyle = 'zigzag';
    else if (lower.includes('none') || lower.includes('off')) dividerStyle = 'none';
    else dividerStyle = 'wave';

    const patchedAst = { ...ast, dividerStyle };
    return {
      markdown: `Section dividers set to "${dividerStyle}". SVG shapes will be rendered between sections.`,
      json: { ast: patchedAst, mode: 'dividers', changed: ['dividerStyle'] },
    };
  }

  // ── Harmonize mode ────────────────────────────────────────────────────────

  private applyHarmonizeEdit(ast: Record<string, unknown>, instruction: string): AgentOutput {
    const brand = ast['brand'] as Record<string, unknown> | undefined;
    const primaryColor = brand?.['primaryColor'] as string | undefined;
    if (!primaryColor) {
      return {
        markdown: 'No brand primaryColor found — cannot generate harmony palette.',
        json: { ast, mode: 'harmonize', changed: [] },
      };
    }
    const strategy = detectHarmonyStrategy(instruction);
    const palette = buildHarmonyPalette(primaryColor, strategy);
    const patchedAst = {
      ...ast,
      customTokens: { ...(ast['customTokens'] as Record<string, unknown> | undefined ?? {}), ...palette },
    };
    return {
      markdown: `Color harmony applied (${strategy}) from base color ${primaryColor}. Updated accent, accentDim, glowColor.`,
      json: { ast: patchedAst, mode: 'harmonize', changed: ['customTokens'] },
    };
  }

  // ── Overlay mode ──────────────────────────────────────────────────────────

  private applyOverlayEdit(
    ast: Record<string, unknown>,
    instruction: string,
    targetSectionId: string | undefined,
  ): AgentOutput {
    const type = detectOverlayType(instruction);
    const brand = ast['brand'] as Record<string, unknown> | undefined;
    const accentColor = brand?.['primaryColor'] as string | undefined ?? '#000000';
    const overlay = { type, color: accentColor, opacity: type === 'vignette' ? 0.5 : 0.35 };

    const sections = (ast['sections'] as Array<Record<string, unknown>> | undefined) ?? [];
    const patchedSections = sections.map((s) => {
      const hasImage = !!(s['image'] as Record<string, unknown> | undefined)?.['url'];
      if (!hasImage) return s;
      if (targetSectionId && s['id'] !== targetSectionId) return s;
      return { ...s, imageOverlay: overlay };
    });

    const changed = patchedSections.filter(s => s['imageOverlay']).map(s => s['id'] as string);
    const patchedAst = { ...ast, sections: patchedSections };
    return {
      markdown: `Image overlay "${type}" applied to ${changed.length} section(s)${targetSectionId ? ` (section: ${targetSectionId})` : ''}.`,
      json: { ast: patchedAst, mode: 'overlay', changed },
    };
  }

  // ── Decorate mode ─────────────────────────────────────────────────────────

  private applyDecorateEdit(ast: Record<string, unknown>, instruction: string): AgentOutput {
    const lower = instruction.toLowerCase();
    let style: string;
    if (lower.includes('orb'))      style = 'orbs';
    else if (lower.includes('dot')) style = 'dots';
    else if (lower.includes('grid')) style = 'grid';
    else if (lower.includes('geometric') || lower.includes('triangle') || lower.includes('shape')) style = 'geometric';
    else if (lower.includes('none') || lower.includes('off')) style = 'none';
    else style = 'orbs';

    const patchedAst = {
      ...ast,
      decorations: { style, opacity: 0.12 },
    };
    return {
      markdown: `Decorative elements set to "${style}" with opacity 12%. Will be applied to all sections.`,
      json: { ast: patchedAst, mode: 'decorate', changed: ['decorations'] },
    };
  }

  // ── Design mode (LLM) ─────────────────────────────────────────────────────

  private async applyDesignEdit(
    ast: Record<string, unknown>,
    instruction: string,
    generateFn: (prompt: string) => Promise<string>,
    modeOverride?: string,
  ): Promise<AgentOutput> {
    const plugin = (ast['plugin'] as string | undefined) ?? 'obsidian';
    const brand = ast['brand'] as Record<string, unknown> | undefined;
    const primaryColor = brand?.['primaryColor'] as string | undefined;

    const prompt = buildDesignSystemPrompt(instruction, plugin, primaryColor);

    let rawJson: string;
    try {
      rawJson = await generateFn(prompt);
    } catch (err) {
      return {
        markdown: `LLM call failed: ${String(err)}`,
        json: { ast, mode: modeOverride ?? 'design', changed: [] },
      };
    }

    let designSystem: Record<string, unknown>;
    try {
      const cleaned = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      designSystem = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return {
        markdown: `Failed to parse design system response.`,
        json: { ast, mode: modeOverride ?? 'design', changed: [] },
      };
    }

    const tokenFields = [
      // Core colors
      'bg', 'text', 'accent', 'dark',
      // Surface tones (LLM may provide these directly)
      'surface', 'surfaceAlt', 'surfaceCard', 'accentDim', 'glowColor',
      'textMuted', 'textSubtle', 'border', 'borderSubtle',
      // Typography
      'heroFont', 'bodyFont', 'heroWeight', 'heroStyle', 'labelTracking',
      // Component control
      'noiseOpacity', 'borderRadius', 'buttonStyle', 'density',
      // Gradient/shadow hints (optional)
      'cardShadow', 'cardShadowHover', 'gradientHero', 'gradientText', 'meshGradient',
    ];
    const newTokens: Record<string, unknown> = {};
    for (const field of tokenFields) {
      if (designSystem[field] !== undefined) newTokens[field] = designSystem[field];
    }

    // Derive surface tokens from bg/accent when LLM didn't return them explicitly.
    // This ensures a full token repaint rather than partial override.
    const bgHex = typeof newTokens['bg'] === 'string' ? newTokens['bg'] : null;
    const accentHex = typeof newTokens['accent'] === 'string' ? newTokens['accent'] : null;
    const isDark = typeof newTokens['dark'] === 'boolean' ? newTokens['dark'] : null;
    if (bgHex && isDark !== null) {
      if (!newTokens['surface'])     newTokens['surface']     = deriveColor(bgHex, isDark ? 10 : -4);
      if (!newTokens['surfaceAlt'])  newTokens['surfaceAlt']  = deriveColor(bgHex, isDark ? 7 : -3);
      if (!newTokens['surfaceCard']) newTokens['surfaceCard'] = deriveColor(bgHex, isDark ? 14 : -6);
      if (!newTokens['border'])      newTokens['border']      = deriveColor(bgHex, isDark ? 20 : -12);
      if (!newTokens['borderSubtle'])newTokens['borderSubtle']= deriveColor(bgHex, isDark ? 12 : -8);
      if (!newTokens['textMuted'])   newTokens['textMuted']   = isDark ? deriveColor('#ffffff', -35) : deriveColor('#000000', 50);
      if (!newTokens['textSubtle'])  newTokens['textSubtle']  = isDark ? deriveColor('#ffffff', -55) : deriveColor('#000000', 65);
    }
    if (accentHex) {
      if (!newTokens['accentDim'])  newTokens['accentDim']  = deriveColor(accentHex, isDark ? 15 : -10);
      if (!newTokens['glowColor'])  newTokens['glowColor']  = accentHex;
    }

    const newFonts = buildFontUrls(designSystem);
    const changed: string[] = [];
    if (Object.keys(newTokens).length > 0) changed.push('customTokens');
    if (newFonts.length > 0) changed.push('customFonts');
    if (designSystem['customCharacter']) changed.push('customCharacter');
    if (designSystem['behavior']) changed.push('behavior');

    const patchedAst = {
      ...ast,
      customTokens: { ...(ast['customTokens'] as Record<string, unknown> | undefined ?? {}), ...newTokens },
      ...(newFonts.length > 0 ? { customFonts: newFonts } : {}),
      ...(designSystem['customCharacter'] ? { customCharacter: designSystem['customCharacter'] } : {}),
      ...(designSystem['behavior'] ? { behavior: designSystem['behavior'] } : {}),
    };

    const effectiveMode = modeOverride ?? 'design';
    const summary = changed.length > 0
      ? `Design updated: ${changed.join(', ')}. New style: "${String(designSystem['visualStyle'] ?? 'updated')}".`
      : 'No design changes detected.';

    return {
      markdown: summary,
      json: { ast: patchedAst, mode: effectiveMode, changed },
    };
  }

  // ── Content mode (LLM) ────────────────────────────────────────────────────

  private async applyContentEdit(
    ast: Record<string, unknown>,
    instruction: string,
    targetSectionId: string | undefined,
    generateFn: (prompt: string) => Promise<string>,
  ): Promise<AgentOutput> {
    const sections = ast['sections'] as Array<Record<string, unknown>> | undefined;
    if (!sections?.length) {
      return { markdown: 'No sections in AST.', json: { ast, mode: 'content', changed: [] } };
    }

    const targetSection = targetSectionId
      ? sections.find((s) => s['id'] === targetSectionId)
      : sections[0];

    if (!targetSection) {
      return {
        markdown: `Section "${targetSectionId}" not found.`,
        json: { ast, mode: 'content', changed: [] },
      };
    }

    const sectionType = targetSection['sectionType'] as string ?? 'generic';
    const currentContent = JSON.stringify(targetSection['content'] ?? {}, null, 2);

    const prompt = `You are an expert copywriter editing a microsite section.

SECTION TYPE: ${sectionType}
CURRENT CONTENT (JSON):
${currentContent}

EDIT INSTRUCTION: ${instruction}

Return ONLY the updated content as valid JSON matching exactly the same field structure as the current content.
Do not add or remove fields. Only update the text values.
No markdown, no explanation, no code fences.`;

    let rawJson: string;
    try {
      rawJson = await generateFn(prompt);
    } catch (err) {
      return {
        markdown: `LLM call failed: ${String(err)}`,
        json: { ast, mode: 'content', changed: [] },
      };
    }

    let newContent: Record<string, unknown>;
    try {
      const cleaned = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      newContent = JSON.parse(cleaned) as Record<string, unknown>;
    } catch {
      return {
        markdown: 'Failed to parse content response.',
        json: { ast, mode: 'content', changed: [] },
      };
    }

    const patchedSections = sections.map((s) =>
      s['id'] === targetSection['id'] ? { ...s, content: newContent } : s,
    );

    const patchedAst = { ...ast, sections: patchedSections };
    const sectionLabel = (targetSection['heading'] as string | undefined) ?? sectionType;

    return {
      markdown: `Section "${sectionLabel}" content updated per instruction: "${instruction}".`,
      json: {
        ast: patchedAst,
        mode: 'content',
        changed: [targetSection['id'] as string ?? sectionType],
      },
    };
  }
}

export default new DesignEditorAgent();
