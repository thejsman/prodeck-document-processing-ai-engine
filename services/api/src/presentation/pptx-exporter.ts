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

// ── Slide helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function accentBar(pptx: any, slide: any, t: PluginTokens): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.06,
    fill: { color: hex(t.accent) },
    line: { color: hex(t.accent), width: 0 },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eyebrowText(slide: any, text: string, t: PluginTokens, y = 0.3): void {
  slide.addText(text.toUpperCase(), {
    x: 0.45, y, w: W - 0.9, h: 0.3,
    fontSize: 9, color: hex(t.accent), bold: true, fontFace: t.bodyFont,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function headlineText(slide: any, text: string, t: PluginTokens, y = 0.65, size = 20): void {
  slide.addText(text, {
    x: 0.45, y, w: W - 0.9, h: 0.8,
    fontSize: size, color: hex(t.text), bold: true, fontFace: t.heroFont, wrap: true,
  });
}

// ── Cover slide ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addCoverSlide(pptx: any, ast: LayoutAST, t: PluginTokens): void {
  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.08, h: H,
    fill: { color: hex(t.accent) }, line: { color: hex(t.accent), width: 0 },
  });

  slide.addText(ast.brand.companyName || 'Company', {
    x: 0.4, y: 0.4, w: W - 0.8, h: 0.5,
    fontSize: 13, color: hex(t.accent), bold: true, fontFace: t.bodyFont, align: 'left',
  });

  slide.addText(ast.meta?.title || 'Proposal', {
    x: 0.4, y: 1.0, w: W - 0.8, h: 2.0,
    fontSize: 36, color: hex(t.text), bold: true, fontFace: t.heroFont, align: 'left', wrap: true,
  });

  const summary = String(ast.brief?.engagementSummary ?? '');
  if (summary) {
    slide.addText(summary, {
      x: 0.4, y: 3.2, w: W * 0.7 - 0.4, h: 1.5,
      fontSize: 12, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'left', wrap: true,
    });
  }

  if (ast.meta?.date) {
    const dateStr = new Date(ast.meta.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    slide.addText(dateStr, {
      x: W - 3, y: H - 0.5, w: 2.8, h: 0.4,
      fontSize: 10, color: hex(t.textSubtle ?? t.textMuted), fontFace: t.bodyFont, align: 'right',
    });
  }
}

// ── Hero slide ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addHeroSlide(pptx: any, section: LayoutSection, t: PluginTokens): void {
  const c = section.content;
  const slide = pptx.addSlide();
  slide.background = { color: hex(t.bg) };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: H,
    fill: { color: hex(t.accent) }, line: { color: hex(t.accent), width: 0 },
  });

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.5);

  if (c.headline) {
    slide.addText(String(c.headline), {
      x: 0.4, y: 0.9, w: W * 0.65, h: 1.8,
      fontSize: 32, color: hex(t.text), bold: true, fontFace: t.heroFont, align: 'left', wrap: true,
    });
  }

  if (c.subheadline) {
    slide.addText(String(c.subheadline), {
      x: 0.4, y: 2.8, w: W * 0.6, h: 0.8,
      fontSize: 14, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'left', wrap: true,
    });
  }

  if (c.ctaPrimary) {
    slide.addText(String(c.ctaPrimary), {
      x: 0.4, y: 4.0, w: 2.4, h: 0.45,
      fontSize: 11, color: t.dark ? hex(t.bg) : 'FFFFFF', bold: true,
      fontFace: t.bodyFont, align: 'center',
      fill: { color: hex(t.accent) }, shape: pptx.ShapeType.roundRect,
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

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t);
  if (c.headline) headlineText(slide, String(c.headline), t);

  const cols = Math.min(Math.max(pillars.length, 1), 4);
  const colW = (W - 0.9) / cols;

  pillars.slice(0, 8).forEach((p, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 0.45 + col * colW;
    const y = 1.7 + row * 1.7;

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: colW - 0.1, h: 1.5,
      fill: { color: lighten(t.bg, 0.08) },
      line: { color: hex(t.border), width: 0.5 },
    });
    slide.addText(p.name ?? '', {
      x: x + 0.1, y: y + 0.12, w: colW - 0.25, h: 0.35,
      fontSize: 10, color: hex(t.accent), bold: true, fontFace: t.bodyFont,
    });
    slide.addText(p.description ?? '', {
      x: x + 0.1, y: y + 0.5, w: colW - 0.25, h: 0.9,
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

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t);
  if (c.headline) headlineText(slide, String(c.headline), t);

  const halfW = (W - 1.0) / 2;
  items.slice(0, 8).forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.45 + col * (halfW + 0.1);
    const y = 1.6 + row * 0.7;

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: 0.04, h: 0.6,
      fill: { color: hex(t.accent) }, line: { color: hex(t.accent), width: 0 },
    });
    slide.addText(item.name ?? '', {
      x: x + 0.12, y, w: halfW - 0.15, h: 0.3,
      fontSize: 10, color: hex(t.text), bold: true, fontFace: t.bodyFont,
    });
    slide.addText(item.detail ?? '', {
      x: x + 0.12, y: y + 0.3, w: halfW - 0.15, h: 0.35,
      fontSize: 9, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
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

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t);
  if (c.headline) headlineText(slide, String(c.headline), t);

  const barY = 1.8;
  const startX = 0.45;
  const barW = W - 0.9;

  slide.addShape(pptx.ShapeType.rect, {
    x: startX, y: barY, w: barW, h: 0.06,
    fill: { color: hex(t.border) }, line: { color: hex(t.border), width: 0 },
  });

  const count = Math.min(phases.length, 5);
  const segW = count > 0 ? barW / count : barW;

  phases.slice(0, 5).forEach((phase, i) => {
    const dotX = startX + i * segW + segW / 2;

    slide.addShape(pptx.ShapeType.ellipse, {
      x: dotX - 0.1, y: barY - 0.1, w: 0.2, h: 0.2,
      fill: { color: hex(t.accent) }, line: { color: hex(t.accent), width: 0 },
    });

    const cx = dotX - segW / 2 + 0.05;
    const cw = segW - 0.1;

    slide.addText(phase.label || `Phase ${i + 1}`, {
      x: cx, y: barY + 0.3, w: cw, h: 0.3,
      fontSize: 9, color: hex(t.accent), bold: true, fontFace: t.bodyFont, align: 'center',
    });
    slide.addText(phase.name ?? '', {
      x: cx, y: barY + 0.65, w: cw, h: 0.3,
      fontSize: 9, color: hex(t.text), bold: true, fontFace: t.bodyFont, align: 'center', wrap: true,
    });
    slide.addText(phase.duration ?? '', {
      x: cx, y: barY + 1.0, w: cw, h: 0.25,
      fontSize: 8, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'center',
    });
    slide.addText(phase.description ?? '', {
      x: cx, y: barY + 1.3, w: cw, h: 1.0,
      fontSize: 7.5, color: hex(t.textSubtle ?? t.textMuted), fontFace: t.bodyFont, align: 'center', wrap: true,
    });
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

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t, 0.25);
  if (c.headline) headlineText(slide, String(c.headline), t, 0.58, 18);

  if (rows.length > 0) {
    const tableData = rows.map((row, i) =>
      row.map(cell => ({
        text: cell ?? '',
        options: {
          fontSize: i === 0 ? 9 : 8, bold: i === 0,
          color: i === 0 ? hex(t.text) : hex(t.textMuted),
          fontFace: t.bodyFont, align: 'left',
        },
      }))
    );

    try {
      slide.addTable(tableData, {
        x: 0.45, y: 1.4, w: W - 0.9, rowH: 0.32,
        border: { type: 'solid', color: hex(t.border), pt: 0.5 },
        fill: { color: lighten(t.bg, 0.05) },
      });
    } catch {
      rows.slice(0, 8).forEach((row, i) => {
        slide.addText(row.join('  |  '), {
          x: 0.45, y: 1.4 + i * 0.32, w: W - 0.9, h: 0.3,
          fontSize: i === 0 ? 9 : 8, bold: i === 0,
          color: i === 0 ? hex(t.text) : hex(t.textMuted), fontFace: t.bodyFont,
        });
      });
    }
  }

  const yBase = Math.min(rows.length, 8) * 0.32 + 1.4;
  if (c.totalLabel) {
    slide.addText(String(c.totalLabel), {
      x: 0.45, y: yBase + 0.1, w: W - 0.9, h: 0.3,
      fontSize: 12, color: hex(t.accent), bold: true, fontFace: t.bodyFont,
    });
  }
  if (c.footnote) {
    slide.addText(String(c.footnote), {
      x: 0.45, y: yBase + 0.45, w: W - 0.9, h: 0.35,
      fontSize: 8, color: hex(t.textSubtle ?? t.textMuted), fontFace: t.bodyFont, wrap: true,
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

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t);
  if (c.headline) headlineText(slide, String(c.headline), t);

  const count = Math.min(stats.length, 4);
  const colW = (W - 0.9) / Math.max(count, 1);

  stats.slice(0, 4).forEach((stat, i) => {
    const x = 0.45 + i * colW;
    const y = 1.6;

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: colW - 0.12, h: 2.5,
      fill: { color: lighten(t.bg, 0.06) },
      line: { color: hex(t.accent) + '44', width: 0.5 },
    });
    slide.addText(stat.number ?? '', {
      x: x + 0.1, y: y + 0.35, w: colW - 0.3, h: 0.9,
      fontSize: 34, color: hex(t.accent), bold: true, fontFace: t.heroFont, align: 'center',
    });
    slide.addText(stat.label ?? '', {
      x: x + 0.1, y: y + 1.3, w: colW - 0.3, h: 0.5,
      fontSize: 10, color: hex(t.text), bold: true, fontFace: t.bodyFont, align: 'center', wrap: true,
    });
    if (stat.context) {
      slide.addText(stat.context, {
        x: x + 0.1, y: y + 1.85, w: colW - 0.3, h: 0.5,
        fontSize: 8, color: hex(t.textMuted), fontFace: t.bodyFont, align: 'center', wrap: true,
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

  if (c.eyebrow) eyebrowText(slide, String(c.eyebrow), t);
  if (c.headline) headlineText(slide, String(c.headline), t);

  const count = Math.min(items.length, 3);
  const colW = (W - 0.9) / Math.max(count, 1);

  items.slice(0, 3).forEach((item, i) => {
    const x = 0.45 + i * colW;
    const y = 1.6;

    slide.addShape(pptx.ShapeType.rect, {
      x, y, w: colW - 0.12, h: 3.0,
      fill: { color: lighten(t.bg, 0.05) },
      line: { color: hex(t.border), width: 0.5 },
    });
    slide.addText('"', {
      x: x + 0.15, y: y + 0.1, w: 0.5, h: 0.5,
      fontSize: 28, color: hex(t.accent), bold: true, fontFace: t.heroFont,
    });
    slide.addText(item.quote ?? '', {
      x: x + 0.15, y: y + 0.6, w: colW - 0.35, h: 1.6,
      fontSize: 9, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true, italic: true,
    });
    slide.addText(`— ${item.name}${item.title ? `, ${item.title}` : ''}`, {
      x: x + 0.15, y: y + 2.35, w: colW - 0.35, h: 0.35,
      fontSize: 8, color: hex(t.text), bold: true, fontFace: t.bodyFont,
    });
    if (item.company) {
      slide.addText(item.company, {
        x: x + 0.15, y: y + 2.68, w: colW - 0.35, h: 0.25,
        fontSize: 7.5, color: hex(t.textSubtle ?? t.textMuted), fontFace: t.bodyFont,
      });
    }
  });
}

// ── Generic slide (challenge, whyus, nextsteps, benefits, problem, generic) ──

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

  if (eyebrow) eyebrowText(slide, eyebrow, t);
  if (headline) {
    slide.addText(headline, {
      x: 0.45, y: 0.65, w: contentW, h: 1.1,
      fontSize: 22, color: hex(t.text), bold: true, fontFace: t.heroFont, wrap: true,
    });
  }
  if (body) {
    slide.addText(body, {
      x: 0.45, y: 1.9, w: contentW, h: 2.8,
      fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
    });
  }

  // Bullet items for list-type sections
  const painPoints = c.painPoints as string[] | undefined;
  const highlights = c.highlights as string[] | undefined;
  const items = painPoints ?? highlights;
  if (items?.length && !body) {
    items.slice(0, 6).forEach((pt, i) => {
      slide.addText(`• ${pt}`, {
        x: 0.45, y: 1.9 + i * 0.4, w: contentW, h: 0.38,
        fontSize: 11, color: hex(t.textMuted), fontFace: t.bodyFont, wrap: true,
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
    x: 0.5, y: H / 2 - 0.8, w: W - 1, h: 1.0,
    fontSize: 40, color: t.dark ? hex(t.bg) : 'FFFFFF',
    bold: true, fontFace: t.heroFont, align: 'center',
  });

  if (ast.brand.companyName) {
    slide.addText(ast.brand.companyName, {
      x: 0.5, y: H / 2 + 0.3, w: W - 1, h: 0.45,
      fontSize: 16, color: t.dark ? lighten(t.bg, 0.4) : 'FFFFFFCC',
      fontFace: t.bodyFont, align: 'center',
    });
  }

  if (ast.brand.tagline) {
    slide.addText(ast.brand.tagline, {
      x: 0.5, y: H / 2 + 0.85, w: W - 1, h: 0.35,
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
      case 'hero':        addHeroSlide(pptx, section, t); break;
      case 'approach':    addApproachSlide(pptx, section, t); break;
      case 'deliverables': addDeliverablesSlide(pptx, section, t); break;
      case 'timeline':    addTimelineSlide(pptx, section, t); break;
      case 'pricing':     addPricingSlide(pptx, section, t); break;
      case 'stats':       addStatsSlide(pptx, section, t); break;
      case 'testimonials': addTestimonialsSlide(pptx, section, t); break;
      default:            addGenericSlide(pptx, section, t); break;
    }
  }

  addThankYouSlide(pptx, ast, t);

  return pptx.write({ outputType: 'nodebuffer' }) as Promise<Buffer>;
}
