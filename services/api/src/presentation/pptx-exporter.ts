/**
 * pptx-exporter.ts — LayoutAST → PowerPoint (.pptx) Buffer.
 *
 * One slide per section. Styled with plugin token colors and fonts.
 * Uses pptxgenjs — returns a Node Buffer ready for HTTP streaming.
 */

import { createRequire } from 'module';
// Use createRequire to load the CJS build of pptxgenjs from an ESM context.
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PptxGen = _require('pptxgenjs') as any;

// ── Minimal type mirrors ────────────────────────────────────────────────────

interface PluginTokens {
  bg: string; surface?: string; text: string; textMuted: string; textSubtle?: string;
  accent: string; heroFont: string; bodyFont: string; heroWeight: number; dark: boolean;
  border: string;
}

interface LayoutSection {
  id: string;
  heading: string;
  sectionType: string;
  content: Record<string, unknown>;
  image: { url: string | null };
}

interface LayoutAST {
  proposalId?: string;
  meta: { title: string; client: string; date?: string };
  brand: { companyName: string; tagline: string; primaryColor: string };
  plugin: string;
  sections: LayoutSection[];
  customTokens?: Partial<PluginTokens>;
  customDesignSystem?: Record<string, unknown>;
  brief?: Record<string, unknown>;
}

// ── Color helpers ───────────────────────────────────────────────────────────

function hex(color: string): string {
  const c = (color ?? '#1a1a2e').replace('#', '').trim();
  if (c.length === 3) return c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  return c.slice(0, 6).padEnd(6, '0');
}

function lighten(color: string, amount: number): string {
  const c = hex(color);
  const r = parseInt(c.slice(0,2), 16);
  const g = parseInt(c.slice(2,4), 16);
  const b = parseInt(c.slice(4,6), 16);
  const lr = Math.round(r + (255 - r) * amount).toString(16).padStart(2, '0');
  const lg = Math.round(g + (255 - g) * amount).toString(16).padStart(2, '0');
  const lb = Math.round(b + (255 - b) * amount).toString(16).padStart(2, '0');
  return lr + lg + lb;
}

// ── Slide dimensions (LAYOUT_WIDE 16:9 = 10"×5.625") ───────────────────────
const W = 10;
const H = 5.625;

// ── Token resolver ──────────────────────────────────────────────────────────

function resolveTokens(plugin: string, primaryColor: string, custom?: Partial<PluginTokens>): PluginTokens {
  const base: Record<string, PluginTokens> = {
    obsidian: {
      bg: '#0d0d1a', text: '#f0f0ff', textMuted: '#a0a0c0', textSubtle: '#6060a0',
      accent: primaryColor || '#7c6bff', heroFont: 'Inter', bodyFont: 'Inter',
      heroWeight: 700, dark: true, border: '#2a2a4a',
    },
    ivory: {
      bg: '#fafaf7', text: '#1a1a1a', textMuted: '#555550', textSubtle: '#888880',
      accent: primaryColor || '#c07a30', heroFont: 'Playfair Display', bodyFont: 'Source Serif 4',
      heroWeight: 700, dark: false, border: '#e5e4df',
    },
    cobalt: {
      bg: '#0a1628', text: '#e8f0fe', textMuted: '#8ab4f8', textSubtle: '#5080c0',
      accent: primaryColor || '#4285f4', heroFont: 'Space Grotesk', bodyFont: 'DM Sans',
      heroWeight: 700, dark: true, border: '#1a2e50',
    },
    sage: {
      bg: '#f8faf6', text: '#1c2b1a', textMuted: '#4a6645', textSubtle: '#7a9675',
      accent: primaryColor || '#3d7a3a', heroFont: 'Lora', bodyFont: 'Nunito',
      heroWeight: 700, dark: false, border: '#d8e8d4',
    },
  };
  const t = base[plugin] ?? base.cobalt;
  return custom ? { ...t, ...custom } : t;
}

// ── Shared slide helpers ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function accentBar(pptx: any, slide: any, t: PluginTokens): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.07,
    fill: { color: hex(t.accent) },
    line: { color: hex(t.accent), width: 0 },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eyebrowText(slide: any, text: string, t: PluginTokens, y = 0.2): void {
  slide.addText(text.toUpperCase(), {
    x: 0.45, y, w: W - 0.9, h: 0.28,
    fontSize: 9, color: hex(t.accent), bold: true, fontFace: t.bodyFont,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function headlineText(slide: any, text: string, t: PluginTokens, y = 0.5, size = 24): void {
  slide.addText(text, {
    x: 0.45, y, w: W - 0.9, h: 0.85,
    fontSize: size, color: hex(t.text), bold: true, fontFace: t.heroFont, wrap: true,
  });
}

// ── Cover slide ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addCoverSlide(pptx: any, ast: LayoutAST, t: PluginTokens): void {
  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };

  // Left accent panel
  const panelW = W * 0.36;
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: panelW, h: H,
    fill: { color: hex(t.accent) },
    line: { color: hex(t.accent), width: 0 },
  });

  // Company name in left panel
  slide.addText(ast.brand.companyName || 'Company', {
    x: 0.2, y: H / 2 - 0.9, w: panelW - 0.25, h: 0.45,
    fontSize: 14, color: 'FFFFFF', bold: true, fontFace: t.bodyFont, align: 'left',
  });

  // Tagline in left panel
  if (ast.brand.tagline) {
    slide.addText(ast.brand.tagline, {
      x: 0.2, y: H / 2 - 0.35, w: panelW - 0.25, h: 0.45,
      fontSize: 10, color: 'FFFFFFB3', fontFace: t.bodyFont, align: 'left', wrap: true,
    });
  }

  // Date at bottom of left panel
  if (ast.meta?.date) {
    const dateStr = new Date(ast.meta.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    slide.addText(dateStr, {
      x: 0.2, y: H - 0.5, w: panelW - 0.25, h: 0.35,
      fontSize: 9, color: 'FFFFFF80', fontFace: t.bodyFont, align: 'left',
    });
  }

  // Title in right area
  const rightX = panelW + 0.4;
  const rightW = W * 0.64 - 0.55;
  slide.addText(ast.meta?.title || 'Proposal', {
    x: rightX, y: 0.8, w: rightW, h: 2.4,
    fontSize: 30, color: hex(t.text), bold: true, fontFace: t.heroFont, align: 'left', wrap: true,
  });

  // Engagement summary below title
  const summary = String(ast.brief?.engagementSummary ?? '');
  if (summary) {
    slide.addText(summary, {
      x: rightX, y: 3.4, w: rightW, h: 1.5,
      fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'left', wrap: true,
    });
  }
}

// ── Hero slide ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addHeroSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };

  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);

  if (c.headline) {
    slide.addText(String(c.headline), {
      x: 0.45, y: 0.5, w: W * 0.7, h: 1.0,
      fontSize: 28, color: hex(t.text), bold: true, fontFace: t.heroFont, align: 'left', wrap: true,
    });
  }

  if (c.subheadline) {
    slide.addText(String(c.subheadline), {
      x: 0.45, y: 1.5, w: W * 0.65, h: 0.5,
      fontSize: 14, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'left', wrap: true,
    });
  }

  if (c.body) {
    slide.addText(String(c.body), {
      x: 0.45, y: 2.1, w: W * 0.65, h: 2.0,
      fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'left', wrap: true,
    });
  }

  if (c.ctaPrimary) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.45, y: 4.5, w: 2.2, h: 0.4,
      fill: { color: hex(t.accent) },
      line: { color: hex(t.accent), width: 0 },
    });
    slide.addText(String(c.ctaPrimary), {
      x: 0.45, y: 4.5, w: 2.2, h: 0.4,
      fontSize: 11, color: 'FFFFFF', bold: true, fontFace: t.bodyFont, align: 'center',
    });
  }
}

// ── Challenge slide ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addChallengeSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };

  accentBar(pptx, slide, t);

  const eyebrow = String(c.eyebrow ?? section.heading ?? '');
  const headline = String(c.headline ?? section.heading ?? '');
  const body = String(c.body ?? c.subheadline ?? '');

  if (eyebrow && eyebrow !== headline) eyebrowText(slide, eyebrow, t, 0.2);
  if (headline) headlineText(slide, headline, t, 0.5, 24);

  if (body) {
    slide.addText(body, {
      x: 0.45, y: 1.4, w: W - 0.9, h: 1.8,
      fontSize: 12, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'left', wrap: true,
    });
  }

  // Bullet pain points
  const painPoints = c.painPoints as string[] | undefined;
  const highlights = c.highlights as string[] | undefined;
  const bullets = painPoints ?? highlights;
  if (bullets?.length) {
    bullets.slice(0, 5).forEach((pt, i) => {
      slide.addText(`• ${pt}`, {
        x: 0.45, y: (body ? 3.3 : 1.4) + i * 0.38, w: W - 0.9, h: 0.36,
        fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
      });
    });
  }

  // Pull-quote block
  if (c.pullquote) {
    const pqY = 3.3;
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.45, y: pqY, w: W - 0.9, h: 0.8,
      fill: { color: hex(t.accent) + '4D' },
      line: { color: hex(t.accent), width: 1 },
    });
    slide.addText(String(c.pullquote), {
      x: 0.65, y: pqY + 0.1, w: W - 1.3, h: 0.6,
      fontSize: 13, color: hex(t.accent), italic: true, fontFace: t.bodyFont, wrap: true,
    });
  }
}

// ── Approach slide ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addApproachSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const pillars = (c.pillars as Array<{ name: string; description: string }> | undefined) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 24);

  const cols = Math.min(Math.max(pillars.length, 1), 4);
  const colW = (W - 0.9) / cols;
  const surfaceColor = t.surface ? hex(t.surface) : lighten(t.bg, 0.08);

  pillars.slice(0, 8).forEach((p, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 0.45 + col * colW;
    const y = 1.55 + row * 1.75;

    // Card background
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: colW - 0.1, h: 1.55,
      fill: { color: surfaceColor },
      line: { color: hex(t.accent) + '44', width: 0.75 },
    });

    // Number circle
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.12, y: y + 0.12, w: 0.28, h: 0.28,
      fill: { color: hex(t.accent) },
      line: { color: hex(t.accent), width: 0 },
    });
    slide.addText(String(i + 1), {
      x: x + 0.12, y: y + 0.12, w: 0.28, h: 0.28,
      fontSize: 9, color: 'FFFFFF', bold: true, fontFace: t.bodyFont, align: 'center',
    });

    // Pillar name
    slide.addText(p.name ?? '', {
      x: x + 0.48, y: y + 0.12, w: colW - 0.62, h: 0.32,
      fontSize: 10, color: hex(t.text), bold: true, fontFace: t.bodyFont,
    });

    // Pillar description
    slide.addText(p.description ?? '', {
      x: x + 0.12, y: y + 0.5, w: colW - 0.25, h: 0.95,
      fontSize: 9, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
    });
  });
}

// ── Deliverables slide ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addDeliverablesSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const items = (c.items as Array<{ name: string; detail: string }> | undefined) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 24);

  const halfW = (W - 1.0) / 2;
  items.slice(0, 8).forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.45 + col * (halfW + 0.1);
    const y = 1.55 + row * 0.82;

    // Accent bar on left
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.04, w: 0.05, h: 0.65,
      fill: { color: hex(t.accent) }, line: { color: hex(t.accent), width: 0 },
    });

    // Item name
    slide.addText(item.name ?? '', {
      x: x + 0.14, y, w: halfW - 0.18, h: 0.32,
      fontSize: 11, color: hex(t.text), bold: true, fontFace: t.bodyFont,
    });

    // Item detail
    slide.addText(item.detail ?? '', {
      x: x + 0.14, y: y + 0.33, w: halfW - 0.18, h: 0.42,
      fontSize: 10, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
    });
  });
}

// ── Timeline slide ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addTimelineSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const phases = (c.phases as Array<{ label: string; name: string; duration: string; description: string }> | undefined) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 24);

  const count = Math.min(phases.length, 5);
  if (count === 0) return;

  const startX = 0.45;
  const boxAreaW = W - 0.9;
  const boxW = boxAreaW / count;
  const arrowW = 0.18;
  const cardW = boxW - arrowW - 0.08;
  const cardY = 1.55;
  const cardH = 3.4;
  const surfaceColor = t.surface ? hex(t.surface) : lighten(t.bg, 0.08);

  phases.slice(0, 5).forEach((phase, i) => {
    const x = startX + i * boxW;

    // Phase box
    slide.addShape(pptx.ShapeType.rect, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: surfaceColor },
      line: { color: hex(t.border), width: 0.5 },
    });

    // Accent top border on box
    slide.addShape(pptx.ShapeType.rect, {
      x, y: cardY, w: cardW, h: 0.05,
      fill: { color: hex(t.accent) },
      line: { color: hex(t.accent), width: 0 },
    });

    // Phase label / number
    slide.addText(phase.label || `Phase ${i + 1}`, {
      x: x + 0.1, y: cardY + 0.15, w: cardW - 0.15, h: 0.28,
      fontSize: 9, color: hex(t.accent), bold: true, fontFace: t.bodyFont, align: 'left',
    });

    // Phase name
    slide.addText(phase.name ?? '', {
      x: x + 0.1, y: cardY + 0.48, w: cardW - 0.15, h: 0.45,
      fontSize: 10, color: hex(t.text), bold: true, fontFace: t.bodyFont, wrap: true,
    });

    // Duration
    slide.addText(phase.duration ?? '', {
      x: x + 0.1, y: cardY + 0.98, w: cardW - 0.15, h: 0.28,
      fontSize: 9, color: hex(t.accent), fontFace: t.bodyFont,
    });

    // Description
    slide.addText(phase.description ?? '', {
      x: x + 0.1, y: cardY + 1.3, w: cardW - 0.15, h: 1.95,
      fontSize: 9, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
    });

    // Arrow connector between boxes
    if (i < count - 1) {
      const arrowX = x + cardW + 0.02;
      const arrowMidY = cardY + cardH / 2 - 0.025;
      slide.addShape(pptx.ShapeType.rect, {
        x: arrowX, y: arrowMidY, w: arrowW - 0.04, h: 0.05,
        fill: { color: hex(t.accent) + '88' },
        line: { color: hex(t.accent) + '88', width: 0 },
      });
    }
  });
}

// ── Pricing slide ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addPricingSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const rows = (c.rows as string[][] | undefined) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 22);

  if (rows.length > 0) {
    const tableData = rows.map((row, i) =>
      row.map(cell => ({
        text: cell ?? '',
        options: {
          fontSize: i === 0 ? 10 : 10, bold: i === 0,
          color: i === 0 ? hex(t.text) : hex(t.textMuted),
          fontFace: t.bodyFont, align: 'left',
        },
      }))
    );

    try {
      slide.addTable(tableData, {
        x: 0.45, y: 1.4, w: W - 0.9, rowH: 0.34,
        border: { type: 'solid', color: hex(t.border), pt: 0.5 },
        fill: { color: lighten(t.bg, 0.05) },
      });
    } catch {
      rows.slice(0, 8).forEach((row, i) => {
        slide.addText(row.join('  |  '), {
          x: 0.45, y: 1.4 + i * 0.34, w: W - 0.9, h: 0.32,
          fontSize: 10, bold: i === 0,
          color: i === 0 ? hex(t.text) : hex(t.textMuted), fontFace: t.bodyFont,
        });
      });
    }
  }

  const yBase = Math.min(rows.length, 8) * 0.34 + 1.4;
  if (c.totalLabel) {
    slide.addText(String(c.totalLabel), {
      x: 0.45, y: yBase + 0.12, w: W - 0.9, h: 0.35,
      fontSize: 13, color: hex(t.accent), bold: true, fontFace: t.bodyFont,
    });
  }
  if (c.footnote) {
    slide.addText(String(c.footnote), {
      x: 0.45, y: yBase + 0.52, w: W - 0.9, h: 0.35,
      fontSize: 9, color: hex(t.textSubtle ?? t.textMuted), fontFace: t.bodyFont, wrap: true,
    });
  }
}

// ── Stats slide ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addStatsSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const stats = (c.stats as Array<{ number: string; label: string; context?: string }> | undefined) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 24);

  const count = Math.min(stats.length, 4);
  const colW = (W - 0.9) / Math.max(count, 1);
  const surfaceColor = t.surface ? hex(t.surface) : lighten(t.bg, 0.06);

  stats.slice(0, 4).forEach((stat, i) => {
    const x = 0.45 + i * colW;
    const y = 1.55;

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: colW - 0.12, h: 2.7,
      fill: { color: surfaceColor },
      line: { color: hex(t.accent) + '44', width: 0.75 },
    });
    slide.addText(stat.number ?? '', {
      x: x + 0.1, y: y + 0.35, w: colW - 0.3, h: 1.0,
      fontSize: 36, color: hex(t.accent), bold: true, fontFace: t.heroFont, align: 'center',
    });
    slide.addText(stat.label ?? '', {
      x: x + 0.1, y: y + 1.45, w: colW - 0.3, h: 0.5,
      fontSize: 10, color: hex(t.text), bold: true, fontFace: t.bodyFont, align: 'center', wrap: true,
    });
    if (stat.context) {
      slide.addText(stat.context, {
        x: x + 0.1, y: y + 2.0, w: colW - 0.3, h: 0.55,
        fontSize: 9, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'center', wrap: true,
      });
    }
  });
}

// ── Testimonials slide ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addTestimonialsSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const items = (c.items as Array<{ quote: string; name: string; title: string; company: string }> | undefined) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 24);

  const count = Math.min(items.length, 3);
  const colW = (W - 0.9) / Math.max(count, 1);
  const surfaceColor = t.surface ? hex(t.surface) : lighten(t.bg, 0.05);

  items.slice(0, 3).forEach((item, i) => {
    const x = 0.45 + i * colW;
    const y = 1.55;

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: colW - 0.12, h: 3.2,
      fill: { color: surfaceColor },
      line: { color: hex(t.border), width: 0.5 },
    });
    slide.addText('"', {
      x: x + 0.15, y: y + 0.1, w: 0.5, h: 0.55,
      fontSize: 30, color: hex(t.accent), bold: true, fontFace: t.heroFont,
    });
    slide.addText(item.quote ?? '', {
      x: x + 0.15, y: y + 0.65, w: colW - 0.35, h: 1.7,
      fontSize: 10, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true, italic: true,
    });
    slide.addText(`— ${item.name}${item.title ? `, ${item.title}` : ''}`, {
      x: x + 0.15, y: y + 2.48, w: colW - 0.35, h: 0.36,
      fontSize: 9, color: hex(t.text), bold: true, fontFace: t.bodyFont,
    });
    if (item.company) {
      slide.addText(item.company, {
        x: x + 0.15, y: y + 2.82, w: colW - 0.35, h: 0.28,
        fontSize: 9, color: hex(t.textSubtle ?? t.textMuted), fontFace: t.bodyFont,
      });
    }
  });
}

// ── WhyUs slide ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addWhyUsSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const stats = (c.stats as Array<{ number: string; label: string; context?: string }> | undefined) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 22);

  const hasStats = stats.length > 0;
  const displayStats = stats.slice(0, 4);
  const count = Math.min(displayStats.length, 4);
  const surfaceColor = t.surface ? hex(t.surface) : lighten(t.bg, 0.06);

  if (hasStats) {
    const colW = (W - 0.9) / Math.max(count, 1);

    displayStats.forEach((stat, i) => {
      const x = 0.45 + i * colW;
      const y = 1.45;

      // Stat card with subtle border
      slide.addShape(pptx.ShapeType.rect, {
        x, y, w: colW - 0.12, h: 2.6,
        fill: { color: surfaceColor },
        line: { color: hex(t.accent) + '44', width: 0.75 },
      });

      // Large number (hero style)
      slide.addText(stat.number ?? '', {
        x: x + 0.1, y: y + 0.25, w: colW - 0.25, h: 1.1,
        fontSize: 36, color: hex(t.accent), bold: true, fontFace: t.heroFont, align: 'center',
      });

      // Label
      slide.addText(stat.label ?? '', {
        x: x + 0.1, y: y + 1.4, w: colW - 0.25, h: 0.5,
        fontSize: 10, color: hex(t.text), bold: true, fontFace: t.bodyFont, align: 'center', wrap: true,
      });

      // Context
      if (stat.context) {
        slide.addText(stat.context, {
          x: x + 0.1, y: y + 1.96, w: colW - 0.25, h: 0.5,
          fontSize: 9, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'center', wrap: true,
        });
      }
    });
  }

  // Body text below stats (or in place of if no stats or few stats)
  const body = String(c.body ?? c.subheadline ?? '');
  if (body && (!hasStats || count < 3)) {
    const bodyY = hasStats ? 4.15 : 1.45;
    slide.addText(body, {
      x: 0.45, y: bodyY, w: W - 0.9, h: 1.1,
      fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
    });
  }

  // Bullet highlights when no stats
  if (!hasStats) {
    const highlights = c.highlights as string[] | undefined;
    if (highlights?.length) {
      highlights.slice(0, 5).forEach((pt, i) => {
        slide.addText(`• ${pt}`, {
          x: 0.45, y: 1.45 + i * 0.42, w: W - 0.9, h: 0.38,
          fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
        });
      });
    }
  }
}

// ── NextSteps slide ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addNextStepsSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };

  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 24);

  const body = String(c.body ?? c.subheadline ?? '');
  if (body) {
    slide.addText(body, {
      x: 0.45, y: 1.4, w: W - 0.9, h: 1.5,
      fontSize: 12, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
    });
  }

  // Step bullets
  const steps = c.steps as string[] | undefined;
  const highlights = c.highlights as string[] | undefined;
  const bullets = steps ?? highlights;
  if (bullets?.length) {
    bullets.slice(0, 4).forEach((step, i) => {
      slide.addText(`${i + 1}. ${step}`, {
        x: 0.45, y: (body ? 3.0 : 1.4) + i * 0.42, w: W - 0.9, h: 0.38,
        fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
      });
    });
  }

  // CTA box at bottom
  const cta = String(c.ctaPrimary ?? c.cta ?? '');
  if (cta) {
    const ctaY = 4.55;
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.45, y: ctaY, w: W - 0.9, h: 0.65,
      fill: { color: hex(t.accent) },
      line: { color: hex(t.accent), width: 0 },
    });
    slide.addText(cta, {
      x: 0.45, y: ctaY, w: W - 0.9, h: 0.65,
      fontSize: 14, color: 'FFFFFF', bold: true, fontFace: t.bodyFont, align: 'center',
    });
  }
}

// ── Benefits slide ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addBenefitsSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  // Benefits can come from items, highlights, or benefits array
  const rawItems = (
    (c.items as Array<{ name: string; detail: string }> | undefined) ??
    ((c.highlights as string[] | undefined)?.map(h => ({ name: h, detail: '' }))) ??
    ((c.benefits as Array<{ name: string; detail: string }> | undefined))
  ) ?? [];

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.2);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.5, 24);

  const surfaceColor = t.surface ? hex(t.surface) : lighten(t.bg, 0.06);
  const halfW = (W - 1.0) / 2;

  rawItems.slice(0, 8).forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.45 + col * (halfW + 0.1);
    const y = 1.55 + row * 0.9;

    // Card background
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: halfW, h: 0.78,
      fill: { color: surfaceColor },
      line: { color: hex(t.accent) + '44', width: 0.75 },
    });

    // Accent left bar
    slide.addShape(pptx.ShapeType.rect, {
      x, y: y + 0.06, w: 0.05, h: 0.65,
      fill: { color: hex(t.accent) }, line: { color: hex(t.accent), width: 0 },
    });

    // Benefit name
    slide.addText(item.name ?? '', {
      x: x + 0.14, y: y + 0.06, w: halfW - 0.2, h: 0.3,
      fontSize: 11, color: hex(t.text), bold: true, fontFace: t.bodyFont,
    });

    // Benefit detail
    if (item.detail) {
      slide.addText(item.detail, {
        x: x + 0.14, y: y + 0.38, w: halfW - 0.2, h: 0.35,
        fontSize: 10, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
      });
    }
  });

  // Fallback body text if no items
  if (rawItems.length === 0) {
    const body = String(c.body ?? c.subheadline ?? '');
    if (body) {
      slide.addText(body, {
        x: 0.45, y: 1.45, w: W - 0.9, h: 2.5,
        fontSize: 12, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
      });
    }
  }
}

// ── Generic slide ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addGenericSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const eyebrow = String(c.eyebrow ?? '');
  const headline = String(c.headline ?? section.heading ?? '');
  const body = String(c.body ?? c.subheadline ?? c.pullquote ?? '');
  const imageUrl = section.image?.url ?? null;

  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };
  accentBar(pptx, slide, t);

  const contentW = imageUrl ? W * 0.56 : W - 0.9;

  if (eyebrow) eyebrowText(slide, eyebrow, t, 0.2);
  if (headline) {
    slide.addText(headline, {
      x: 0.45, y: 0.5, w: contentW, h: 0.85,
      fontSize: 22, color: hex(t.text), bold: true, fontFace: t.heroFont, wrap: true,
    });
  }

  if (body) {
    slide.addText(body, {
      x: 0.45, y: 1.45, w: contentW, h: 2.5,
      fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
    });
  }

  // Bullet items for list-type sections
  const painPoints = c.painPoints as string[] | undefined;
  const highlights = c.highlights as string[] | undefined;
  const items = painPoints ?? highlights;
  if (items?.length) {
    const bulletY = body ? 4.05 : 1.45;
    items.slice(0, 6).forEach((pt, i) => {
      slide.addText(`• ${pt}`, {
        x: 0.45, y: bulletY + i * 0.38, w: contentW, h: 0.36,
        fontSize: 10, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
      });
    });
  }

  // Brief stats row if stats present
  const stats = c.stats as Array<{ number: string; label: string }> | undefined;
  if (stats?.length && !items?.length) {
    const surfaceColor = t.surface ? hex(t.surface) : lighten(t.bg, 0.06);
    const sCount = Math.min(stats.length, 4);
    const sColW = contentW / sCount;
    const sY = body ? 4.05 : 1.45;
    stats.slice(0, 4).forEach((stat, i) => {
      const sx = 0.45 + i * sColW;
      slide.addShape(pptx.ShapeType.rect, {
        x: sx, y: sY, w: sColW - 0.1, h: 0.9,
        fill: { color: surfaceColor },
        line: { color: hex(t.accent) + '44', width: 0.5 },
      });
      slide.addText(stat.number ?? '', {
        x: sx + 0.05, y: sY + 0.05, w: sColW - 0.2, h: 0.45,
        fontSize: 20, color: hex(t.accent), bold: true, fontFace: t.heroFont, align: 'center',
      });
      slide.addText(stat.label ?? '', {
        x: sx + 0.05, y: sY + 0.5, w: sColW - 0.2, h: 0.32,
        fontSize: 10, color: hex(t.text), fontFace: t.bodyFont, align: 'center', wrap: true,
      });
    });
  }

  if (imageUrl) {
    try {
      slide.addImage({ path: imageUrl, x: W * 0.6, y: 0.3, w: W * 0.38, h: H - 0.6 });
    } catch { /* non-fatal */ }
  }
}

// ── Thank-you slide ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addThankYouSlide(pptx: any, ast: LayoutAST, t: PluginTokens): void {
  const slide = pptx.addSlide();
  slide.background = { color: hex(t.accent) };

  slide.addText('Thank You', {
    x: 0.5, y: H / 2 - 0.9, w: W - 1, h: 1.1,
    fontSize: 40, color: t.dark ? hex(t.bg) : 'FFFFFF',
    bold: true, fontFace: t.heroFont, align: 'center',
  });

  if (ast.brand.companyName) {
    slide.addText(ast.brand.companyName, {
      x: 0.5, y: H / 2 + 0.28, w: W - 1, h: 0.5,
      fontSize: 16, color: t.dark ? lighten(t.bg, 0.4) : 'FFFFFFCC',
      fontFace: t.bodyFont, align: 'center',
    });
  }

  if (ast.brand.tagline) {
    slide.addText(ast.brand.tagline, {
      x: 0.5, y: H / 2 + 0.85, w: W - 1, h: 0.38,
      fontSize: 11, color: t.dark ? lighten(t.bg, 0.25) : 'FFFFFF99',
      fontFace: t.bodyFont, align: 'center',
    });
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function renderMicrositeToPptx(ast: LayoutAST): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pptx: any = new PptxGen();
  pptx.layout = 'LAYOUT_WIDE';

  const mergedTokens = ast.customTokens
    ? { ...(ast.customDesignSystem ?? {}), ...ast.customTokens }
    : undefined;

  const t = resolveTokens(
    ast.plugin ?? 'cobalt',
    ast.brand?.primaryColor ?? '#4285f4',
    mergedTokens as Partial<PluginTokens> | undefined,
  );

  addCoverSlide(pptx, ast, t);

  for (const section of ast.sections ?? []) {
    switch (section.sectionType) {
      case 'hero':         addHeroSlide(pptx, section, t); break;
      case 'approach':     addApproachSlide(pptx, section, t); break;
      case 'deliverables': addDeliverablesSlide(pptx, section, t); break;
      case 'timeline':     addTimelineSlide(pptx, section, t); break;
      case 'pricing':      addPricingSlide(pptx, section, t); break;
      case 'stats':        addStatsSlide(pptx, section, t); break;
      case 'testimonials': addTestimonialsSlide(pptx, section, t); break;
      case 'whyus':        addWhyUsSlide(pptx, section, t); break;
      case 'nextsteps':    addNextStepsSlide(pptx, section, t); break;
      case 'benefits':     addBenefitsSlide(pptx, section, t); break;
      case 'challenge':    addChallengeSlide(pptx, section, t); break;
      case 'problem':      addChallengeSlide(pptx, section, t); break;
      case 'showcase':     addGenericSlide(pptx, section, t); break;
      default:             addGenericSlide(pptx, section, t); break;
    }
  }

  addThankYouSlide(pptx, ast, t);

  return pptx.write({ outputType: 'nodebuffer' }) as Promise<Buffer>;
}
