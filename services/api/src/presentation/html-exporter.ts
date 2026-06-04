/**
 * html-exporter.ts — Pure function: LayoutAST → self-contained HTML string.
 *
 * No I/O, no React, no external runtime dependencies.
 * All CSS is injected as `:root` custom properties resolved from plugin tokens.
 * Google Fonts are embedded as <link> tags.
 * Scroll animations use a 20-line vanilla JS observer.
 */

// ── Minimal type definitions (mirrors services/ui/src/types/presentation.ts) ──

interface PluginTokens {
  bg: string; surface: string; surfaceAlt: string; surfaceCard: string;
  text: string; textMuted: string; textSubtle: string;
  accent: string; accentDim: string; accentRgb: string;
  glowColor: string; border: string; borderSubtle: string;
  heroFont: string; bodyFont: string;
  heroWeight: number; heroStyle: string; labelTracking: string;
  dark: boolean; noiseOpacity: number;
  gradientHero: string; gradientText: string; meshGradient: string;
  cardShadow: string; cardShadowHover: string;
  borderRadius?: string; buttonStyle?: string; density?: string; iconBg?: string;
}

interface LayoutSection {
  id: string;
  heading: string;
  sectionType: string;
  content: Record<string, unknown>;
  image: { source: string; query: string; url: string | null; fallback: string };
  editable: boolean;
  version: number;
}

interface LayoutAST {
  proposalId: string;
  generatedAt: string;
  meta: { title: string; client: string; date: string; author: string };
  brief: Record<string, unknown>;
  brand: { companyName: string; primaryColor: string; [k: string]: unknown };
  plugin: string;
  sections: LayoutSection[];
  customTokens?: Partial<PluginTokens>;
  customFonts?: { family: string; url: string }[];
  [k: string]: unknown;
}

// ── Token sets (copy from pluginRegistry to avoid importing the UI package) ──

const PLUGIN_TOKENS: Record<string, PluginTokens> = {
  obsidian: {
    bg: '#080808', surface: '#111111', surfaceAlt: '#1A1A1A', surfaceCard: '#161616',
    text: '#E8E4DC', textMuted: '#9A9590', textSubtle: '#5A5550',
    accent: '#C8A96E', accentDim: '#8B7744', accentRgb: '200,169,110',
    glowColor: 'rgba(200,169,110,0.28)', border: '#2A2520', borderSubtle: '#1E1B18',
    heroFont: 'Montserrat', bodyFont: 'Open Sans',
    heroWeight: 300, heroStyle: 'italic', labelTracking: '0.18em',
    dark: true, noiseOpacity: 0.03,
    gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 40%, #1A1510 0%, #080808 100%)',
    gradientText: 'linear-gradient(135deg, #E8C87A 0%, #C8A96E 50%, #F0D898 100%)',
    meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 30%, rgba(200,169,110,0.12) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 70%, rgba(200,169,110,0.08) 0%, transparent 55%)',
    cardShadow: '0 4px 24px rgba(0,0,0,0.5)',
    cardShadowHover: '0 8px 40px rgba(0,0,0,0.7), 0 0 20px rgba(200,169,110,0.18)',
  },
  ivory: {
    bg: '#F8F5EF', surface: '#FFFFFF', surfaceAlt: '#F0ECE4', surfaceCard: '#FAFAF7',
    text: '#1A1612', textMuted: '#6B6560', textSubtle: '#A09890',
    accent: '#1A1612', accentDim: '#3A3530', accentRgb: '26,22,18',
    glowColor: 'rgba(26,22,18,0.15)', border: '#DDD8D0', borderSubtle: '#E8E4DC',
    heroFont: 'Open Sans', bodyFont: 'Lato',
    heroWeight: 700, heroStyle: 'normal', labelTracking: '0.15em',
    dark: false, noiseOpacity: 0.025,
    gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 35%, #FFFFFF 0%, #F8F5EF 100%)',
    gradientText: 'linear-gradient(135deg, #1A1612 0%, #4A3F38 50%, #1A1612 100%)',
    meshGradient: 'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(26,22,18,0.06) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(26,22,18,0.04) 0%, transparent 55%)',
    cardShadow: '0 2px 16px rgba(26,22,18,0.08)',
    cardShadowHover: '0 8px 32px rgba(26,22,18,0.14), 0 0 0 1px rgba(26,22,18,0.1)',
  },
  cobalt: {
    bg: '#01112A', surface: '#071D3F', surfaceAlt: '#0C2650', surfaceCard: '#091E42',
    text: '#E4ECF7', textMuted: '#8AA4C8', textSubtle: '#4A6A8F',
    accent: '#4FA3E8', accentDim: '#2D6CA8', accentRgb: '79,163,232',
    glowColor: 'rgba(79,163,232,0.3)', border: '#1A3558', borderSubtle: '#122A48',
    heroFont: 'Roboto', bodyFont: 'Open Sans',
    heroWeight: 800, heroStyle: 'normal', labelTracking: '0.2em',
    dark: true, noiseOpacity: 0.035,
    gradientHero: 'radial-gradient(ellipse 80% 60% at 50% 30%, #0C2650 0%, #01112A 100%)',
    gradientText: 'linear-gradient(135deg, #7EC8F8 0%, #4FA3E8 50%, #A0D8FF 100%)',
    meshGradient: 'radial-gradient(ellipse 80% 60% at 20% 25%, rgba(79,163,232,0.15) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 80% 75%, rgba(79,163,232,0.1) 0%, transparent 55%)',
    cardShadow: '0 4px 24px rgba(0,0,0,0.6)',
    cardShadowHover: '0 8px 40px rgba(0,0,0,0.8), 0 0 24px rgba(79,163,232,0.22)',
  },
  sage: {
    bg: '#F2F0EB', surface: '#FAFAF7', surfaceAlt: '#E8E5DE', surfaceCard: '#F5F3EE',
    text: '#2A3228', textMuted: '#5A6858', textSubtle: '#8A9888',
    accent: '#4A6741', accentDim: '#3A5230', accentRgb: '74,103,65',
    glowColor: 'rgba(74,103,65,0.25)', border: '#D0CEC5', borderSubtle: '#E0DDD5',
    heroFont: 'Poppins', bodyFont: 'Lato',
    heroWeight: 300, heroStyle: 'italic', labelTracking: '0.16em',
    dark: false, noiseOpacity: 0.02,
    gradientHero: 'radial-gradient(ellipse 70% 50% at 50% 40%, #FAFAF7 0%, #F2F0EB 100%)',
    gradientText: 'linear-gradient(135deg, #5A8050 0%, #4A6741 50%, #6A9060 100%)',
    meshGradient: 'radial-gradient(ellipse 70% 50% at 20% 30%, rgba(74,103,65,0.1) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 70%, rgba(74,103,65,0.07) 0%, transparent 55%)',
    cardShadow: '0 2px 16px rgba(42,50,40,0.1)',
    cardShadowHover: '0 8px 32px rgba(42,50,40,0.18), 0 0 16px rgba(74,103,65,0.15)',
  },
};

const PLUGIN_FONTS: Record<string, { family: string; url: string }[]> = {
  obsidian: [
    { family: 'Montserrat', url: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&display=swap' },
    { family: 'Open Sans', url: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&display=swap' },
  ],
  ivory: [
    { family: 'Open Sans', url: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&display=swap' },
    { family: 'Lato', url: 'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap' },
  ],
  cobalt: [
    { family: 'Roboto', url: 'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap' },
    { family: 'Open Sans', url: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700&display=swap' },
  ],
  sage: [
    { family: 'Poppins', url: 'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap' },
    { family: 'Lato', url: 'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap' },
  ],
};

// ── Token resolution ──────────────────────────────────────────────────────────

function resolveTokens(ast: LayoutAST): PluginTokens {
  const base = PLUGIN_TOKENS[ast.plugin] ?? PLUGIN_TOKENS['cobalt'];
  const brandAccent = ast.brand?.primaryColor;
  const custom = ast.customTokens ?? {};
  return {
    ...base,
    ...(brandAccent ? { accent: brandAccent } : {}),
    ...custom,
  } as PluginTokens;
}

function resolveFonts(ast: LayoutAST): { family: string; url: string }[] {
  if (ast.customFonts?.length) return ast.customFonts;
  return PLUGIN_FONTS[ast.plugin] ?? PLUGIN_FONTS['cobalt'];
}

// ── CSS generation ────────────────────────────────────────────────────────────

function tokensToRootCss(t: PluginTokens): string {
  return `
:root {
  --bg: ${t.bg};
  --surface: ${t.surface};
  --surface-alt: ${t.surfaceAlt};
  --surface-card: ${t.surfaceCard};
  --text: ${t.text};
  --text-muted: ${t.textMuted};
  --text-subtle: ${t.textSubtle};
  --accent: ${t.accent};
  --accent-dim: ${t.accentDim};
  --accent-rgb: ${t.accentRgb};
  --glow: ${t.glowColor};
  --border: ${t.border};
  --border-subtle: ${t.borderSubtle};
  --hero-font: '${t.heroFont}', Georgia, serif;
  --body-font: '${t.bodyFont}', system-ui, sans-serif;
  --hero-weight: ${t.heroWeight};
  --hero-style: ${t.heroStyle};
  --label-tracking: ${t.labelTracking};
  --gradient-hero: ${t.gradientHero};
  --gradient-text: ${t.gradientText};
  --mesh-gradient: ${t.meshGradient};
  --card-shadow: ${t.cardShadow};
  --border-radius: ${t.borderRadius ?? '8px'};
}`.trim();
}

function baseStyles(): string {
  return `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--body-font); line-height: 1.6; overflow-x: hidden; }
a { color: var(--accent); text-decoration: none; }
img { max-width: 100%; display: block; }
section { position: relative; }
.eyebrow { font-size: 0.7rem; font-weight: 700; letter-spacing: var(--label-tracking); text-transform: uppercase; color: var(--accent); margin-bottom: 0.75rem; }
.section-headline { font-family: var(--hero-font); font-weight: var(--hero-weight); font-style: var(--hero-style); font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.1; color: var(--text); }
.section-sub { font-size: 1.1rem; color: var(--text-muted); line-height: 1.6; margin-top: 1rem; }
.section-body { font-size: 1rem; color: var(--text-muted); line-height: 1.7; margin-top: 1rem; }
.container { max-width: 1100px; margin: 0 auto; padding: 0 2rem; }
.section-pad { padding: 6rem 0; }
.card { background: var(--surface-card); border: 1px solid var(--border); border-radius: var(--border-radius); padding: 1.5rem; box-shadow: var(--card-shadow); }
.btn-primary { display: inline-block; padding: 0.75rem 1.75rem; background: var(--accent); color: var(--bg); border-radius: var(--border-radius); font-weight: 700; font-size: 0.9rem; cursor: pointer; border: none; }
.btn-secondary { display: inline-block; padding: 0.75rem 1.75rem; background: transparent; color: var(--accent); border: 1px solid var(--accent); border-radius: var(--border-radius); font-weight: 600; font-size: 0.9rem; cursor: pointer; }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; }
@media (max-width: 768px) { .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; } .section-pad { padding: 4rem 0; } }
.reveal { opacity: 0; transform: translateY(28px); transition: opacity 0.6s ease, transform 0.6s ease; }
.reveal.visible { opacity: 1; transform: none; }
.img-overlay { position: absolute; inset: 0; background: linear-gradient(to right, var(--bg) 40%, transparent 100%); }
`.trim();
}

function scrollAnimScript(): string {
  return `
const els = document.querySelectorAll('.reveal');
const obs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
}, { threshold: 0.12 });
els.forEach(el => obs.observe(el));
`.trim();
}

// ── Section renderers ─────────────────────────────────────────────────────────

function esc(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHero(sec: LayoutSection): string {
  const c = sec.content as Record<string, string>;
  const imgStyle = sec.image?.url
    ? `background: url('${esc(sec.image.url)}') center/cover no-repeat; min-height: 90vh;`
    : `background: var(--gradient-hero); min-height: 90vh;`;
  return `
<section id="${esc(sec.id)}" style="${imgStyle} display:flex; align-items:center; position:relative;">
  <div class="img-overlay"></div>
  <div class="container" style="position:relative; z-index:1; padding: 6rem 2rem;">
    <div class="reveal">
      ${c.eyebrow ? `<p class="eyebrow">${esc(c.eyebrow)}</p>` : ''}
      <h1 class="section-headline" style="max-width:720px;">${esc(c.headline)}</h1>
      ${c.subheadline ? `<p class="section-sub" style="max-width:560px;">${esc(c.subheadline)}</p>` : ''}
      ${c.body ? `<p class="section-body" style="max-width:560px; margin-top:1rem;">${esc(c.body)}</p>` : ''}
      ${(c.ctaPrimary || c.ctaSecondary) ? `
      <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-top:2.5rem;">
        ${c.ctaPrimary ? `<button class="btn-primary">${esc(c.ctaPrimary)}</button>` : ''}
        ${c.ctaSecondary ? `<button class="btn-secondary">${esc(c.ctaSecondary)}</button>` : ''}
      </div>` : ''}
    </div>
  </div>
</section>`;
}

function renderTwoColumnText(sec: LayoutSection, extraContent = ''): string {
  const c = sec.content as Record<string, string>;
  const imgHtml = sec.image?.url
    ? `<img src="${esc(sec.image.url)}" alt="" style="width:100%; height:400px; object-fit:cover; border-radius:var(--border-radius);" />`
    : `<div style="width:100%; height:400px; background:var(--mesh-gradient); border-radius:var(--border-radius); border:1px solid var(--border);"></div>`;
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--surface);">
  <div class="container" style="display:grid; grid-template-columns:1fr 1fr; gap:4rem; align-items:center;">
    <div class="reveal">
      ${c.eyebrow ? `<p class="eyebrow">${esc(c.eyebrow)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline)}</h2>
      ${c.subheadline ? `<p class="section-sub">${esc(c.subheadline)}</p>` : ''}
      ${c.body ? `<p class="section-body">${esc(c.body)}</p>` : ''}
      ${c.pullquote ? `<blockquote style="border-left:3px solid var(--accent); padding-left:1rem; margin-top:1.5rem; font-style:italic; color:var(--text-muted);">${esc(c.pullquote)}</blockquote>` : ''}
      ${extraContent}
    </div>
    <div class="reveal" style="transition-delay:0.1s;">${imgHtml}</div>
  </div>
</section>`;
}

function renderApproach(sec: LayoutSection): string {
  const c = sec.content as Record<string, unknown>;
  const pillars = Array.isArray(c.pillars) ? c.pillars as Array<Record<string, string>> : [];
  const pillarsHtml = pillars.length ? `
  <div class="grid-3" style="margin-top:3rem;">
    ${pillars.map((p, i) => `
    <div class="card reveal" style="transition-delay:${i * 0.07}s;">
      <div style="font-size:1.5rem; margin-bottom:0.75rem; color:var(--accent);">◈</div>
      <h3 style="font-family:var(--hero-font); font-size:1.2rem; font-weight:600; margin-bottom:0.5rem;">${esc(p.name)}</h3>
      <p style="font-size:0.9rem; color:var(--text-muted); line-height:1.6;">${esc(p.description)}</p>
    </div>`).join('')}
  </div>` : '';
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--bg);">
  <div class="container">
    <div class="reveal" style="text-align:center; max-width:640px; margin:0 auto 0;">
      ${(c.eyebrow as string) ? `<p class="eyebrow">${esc(c.eyebrow as string)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline as string)}</h2>
      ${(c.subheadline as string) ? `<p class="section-sub">${esc(c.subheadline as string)}</p>` : ''}
    </div>
    ${pillarsHtml}
  </div>
</section>`;
}

function renderDeliverables(sec: LayoutSection): string {
  const c = sec.content as Record<string, unknown>;
  const items = Array.isArray(c.items) ? c.items as Array<Record<string, string>> : [];
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--surface);">
  <div class="container">
    <div class="reveal" style="max-width:640px; margin-bottom:3rem;">
      ${(c.eyebrow as string) ? `<p class="eyebrow">${esc(c.eyebrow as string)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline as string)}</h2>
    </div>
    <div class="grid-2">
      ${items.map((item, i) => `
      <div class="card reveal" style="display:flex; gap:1rem; transition-delay:${i * 0.06}s;">
        <div style="font-size:1.2rem; color:var(--accent); flex-shrink:0; margin-top:2px;">✦</div>
        <div>
          <h4 style="font-weight:600; margin-bottom:0.25rem;">${esc(item.title ?? item.name)}</h4>
          <p style="font-size:0.875rem; color:var(--text-muted);">${esc(item.description ?? item.detail)}</p>
          ${item.meta ? `<p style="font-size:0.75rem; color:var(--accent); margin-top:0.5rem; font-weight:600;">${esc(item.meta)}</p>` : ''}
        </div>
      </div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderTimeline(sec: LayoutSection): string {
  const c = sec.content as Record<string, unknown>;
  const phases = Array.isArray(c.phases) ? c.phases as Array<Record<string, string>> : [];
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--bg);">
  <div class="container">
    <div class="reveal" style="text-align:center; max-width:640px; margin:0 auto 3rem;">
      ${(c.eyebrow as string) ? `<p class="eyebrow">${esc(c.eyebrow as string)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline as string)}</h2>
    </div>
    <div style="position:relative; padding-left:2rem; border-left:2px solid var(--border);">
      ${phases.map((phase, i) => `
      <div class="reveal" style="margin-bottom:2.5rem; position:relative; transition-delay:${i * 0.08}s;">
        <div style="position:absolute; left:-2.55rem; top:0.2rem; width:1rem; height:1rem; border-radius:50%; background:var(--accent); border:2px solid var(--bg);"></div>
        <p style="font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--accent); margin-bottom:0.25rem;">${esc(phase.label)} ${phase.duration ? `— ${esc(phase.duration)}` : ''}</p>
        <h3 style="font-family:var(--hero-font); font-size:1.3rem; font-weight:var(--hero-weight); margin-bottom:0.5rem;">${esc(phase.name ?? phase.title)}</h3>
        <p style="font-size:0.9rem; color:var(--text-muted);">${esc(phase.description)}</p>
      </div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderPricing(sec: LayoutSection): string {
  const c = sec.content as Record<string, unknown>;
  const rows = Array.isArray(c.rows) ? c.rows as string[][] : [];
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--surface);">
  <div class="container" style="max-width:800px;">
    <div class="reveal" style="margin-bottom:2.5rem;">
      ${(c.eyebrow as string) ? `<p class="eyebrow">${esc(c.eyebrow as string)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline as string)}</h2>
      ${(c.subheadline as string) ? `<p class="section-sub">${esc(c.subheadline as string)}</p>` : ''}
    </div>
    <div class="reveal card" style="overflow:hidden;">
      <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
        ${rows.map((row, ri) => `
        <tr style="border-bottom:1px solid var(--border-subtle); ${ri === rows.length - 1 ? 'font-weight:700; background:var(--surface-alt);' : ''}">
          ${row.map((cell, ci) => `<td style="padding:0.75rem 1rem; text-align:${ci === 0 ? 'left' : 'right'}; color:${ci === row.length - 1 ? 'var(--accent)' : 'var(--text)'};">${esc(cell)}</td>`).join('')}
        </tr>`).join('')}
      </table>
    </div>
    ${(c.footnote as string) ? `<p style="font-size:0.8rem; color:var(--text-subtle); margin-top:1rem;">${esc(c.footnote as string)}</p>` : ''}
    ${(c.cta as string) ? `<div style="text-align:center; margin-top:2rem;"><button class="btn-primary">${esc(c.cta as string)}</button></div>` : ''}
  </div>
</section>`;
}

function renderStats(sec: LayoutSection): string {
  const c = sec.content as Record<string, unknown>;
  const stats = Array.isArray(c.stats) ? c.stats as Array<Record<string, string>> : [];
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--surface-alt);">
  <div class="container">
    <div class="reveal" style="text-align:center; max-width:640px; margin:0 auto 3rem;">
      ${(c.eyebrow as string) ? `<p class="eyebrow">${esc(c.eyebrow as string)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline as string)}</h2>
    </div>
    <div class="grid-${String(Math.min(4, stats.length || 3))}">
      ${stats.map((s, i) => `
      <div class="reveal" style="text-align:center; transition-delay:${i * 0.07}s;">
        <p style="font-family:var(--hero-font); font-size:clamp(2.5rem,5vw,3.5rem); font-weight:var(--hero-weight); color:var(--accent); line-height:1;">${esc(s.value ?? s.number)}</p>
        <p style="font-size:0.8rem; font-weight:700; text-transform:uppercase; letter-spacing:0.1em; color:var(--text-muted); margin-top:0.5rem;">${esc(s.label)}</p>
        ${s.description ?? s.context ? `<p style="font-size:0.8rem; color:var(--text-subtle); margin-top:0.25rem;">${esc(s.description ?? s.context)}</p>` : ''}
      </div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderTestimonials(sec: LayoutSection): string {
  const c = sec.content as Record<string, unknown>;
  const items = Array.isArray(c.items) ? c.items as Array<Record<string, string>> : [];
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--bg);">
  <div class="container">
    <div class="reveal" style="text-align:center; max-width:640px; margin:0 auto 3rem;">
      ${(c.eyebrow as string) ? `<p class="eyebrow">${esc(c.eyebrow as string)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline as string)}</h2>
    </div>
    <div class="grid-${String(items.length >= 3 ? 3 : 2)}">
      ${items.map((item, i) => `
      <div class="card reveal" style="transition-delay:${i * 0.08}s;">
        <p style="font-size:1.5rem; color:var(--accent); margin-bottom:0.75rem; font-family:Georgia, serif;">"</p>
        <p style="font-size:0.95rem; color:var(--text); line-height:1.7; font-style:italic; margin-bottom:1rem;">${esc(item.quote)}</p>
        <p style="font-weight:700; font-size:0.875rem;">${esc(item.author ?? item.name)}</p>
        <p style="font-size:0.8rem; color:var(--text-muted);">${esc(item.role ?? item.title)}${item.company ? `, ${esc(item.company)}` : ''}</p>
      </div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderBenefits(sec: LayoutSection): string {
  const c = sec.content as Record<string, unknown>;
  const items = Array.isArray(c.items) ? c.items as Array<Record<string, string>> : [];
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--surface);">
  <div class="container">
    <div class="reveal" style="max-width:640px; margin-bottom:3rem;">
      ${(c.eyebrow as string) ? `<p class="eyebrow">${esc(c.eyebrow as string)}</p>` : ''}
      <h2 class="section-headline">${esc(c.headline as string)}</h2>
    </div>
    <div class="grid-3">
      ${items.map((item, i) => `
      <div class="reveal" style="transition-delay:${i * 0.06}s;">
        <div style="width:2.5rem; height:2.5rem; border-radius:8px; background:rgba(var(--accent-rgb),0.12); display:flex; align-items:center; justify-content:center; margin-bottom:0.75rem; color:var(--accent);">✦</div>
        <h3 style="font-weight:700; margin-bottom:0.4rem;">${esc(item.title)}</h3>
        <p style="font-size:0.875rem; color:var(--text-muted); line-height:1.6;">${esc(item.description)}</p>
      </div>`).join('')}
    </div>
  </div>
</section>`;
}

function renderNextSteps(sec: LayoutSection): string {
  const c = sec.content as Record<string, string | null>;
  return `
<section id="${esc(sec.id)}" class="section-pad" style="background:var(--accent); color:var(--bg);">
  <div class="container" style="text-align:center; max-width:700px;">
    <div class="reveal">
      ${c.eyebrow ? `<p style="font-size:0.7rem; font-weight:700; letter-spacing:var(--label-tracking); text-transform:uppercase; opacity:0.7; margin-bottom:0.75rem;">${esc(c.eyebrow)}</p>` : ''}
      <h2 style="font-family:var(--hero-font); font-weight:var(--hero-weight); font-style:var(--hero-style); font-size:clamp(2rem,5vw,3rem); line-height:1.1; color:var(--bg); margin-bottom:1rem;">${esc(c.headline)}</h2>
      ${c.body ? `<p style="font-size:1.05rem; opacity:0.85; line-height:1.7; margin-bottom:2rem;">${esc(c.body)}</p>` : ''}
      ${(c.ctaPrimary || c.ctaSecondary) ? `
      <div style="display:flex; gap:1rem; justify-content:center; flex-wrap:wrap;">
        ${c.ctaPrimary ? `<button style="padding:0.875rem 2rem; background:var(--bg); color:var(--accent); border-radius:var(--border-radius); font-weight:700; border:none; cursor:pointer;">${esc(c.ctaPrimary)}</button>` : ''}
        ${c.ctaSecondary ? `<button style="padding:0.875rem 2rem; background:transparent; color:var(--bg); border:2px solid var(--bg); border-radius:var(--border-radius); font-weight:600; cursor:pointer;">${esc(c.ctaSecondary)}</button>` : ''}
      </div>` : ''}
      ${c.urgencyNote ? `<p style="font-size:0.8rem; opacity:0.65; margin-top:1.5rem;">${esc(c.urgencyNote)}</p>` : ''}
    </div>
  </div>
</section>`;
}

function renderGeneric(sec: LayoutSection): string {
  const c = sec.content as Record<string, string>;
  return renderTwoColumnText(sec);
}

function renderSection(sec: LayoutSection): string {
  switch (sec.sectionType) {
    case 'hero':         return renderHero(sec);
    case 'challenge':    return renderTwoColumnText(sec);
    case 'approach':     return renderApproach(sec);
    case 'deliverables': return renderDeliverables(sec);
    case 'timeline':     return renderTimeline(sec);
    case 'pricing':      return renderPricing(sec);
    case 'whyus':        return renderTwoColumnText(sec);
    case 'nextsteps':    return renderNextSteps(sec);
    case 'testimonials': return renderTestimonials(sec);
    case 'showcase':     return renderTwoColumnText(sec);
    case 'benefits':     return renderBenefits(sec);
    case 'problem':      return renderTwoColumnText(sec);
    case 'stats':        return renderStats(sec);
    case 'generic':
    default:             return renderGeneric(sec);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function renderMicrositeToHtml(ast: LayoutAST): string {
  const tokens = resolveTokens(ast);
  const fonts = resolveFonts(ast);

  const fontLinks = fonts
    .map(f => `  <link rel="stylesheet" href="${esc(f.url)}">`)
    .join('\n');

  const sectionsHtml = ast.sections
    .map(sec => renderSection(sec))
    .join('\n');

  const title = esc(ast.meta?.title ?? ast.brand?.companyName ?? 'Proposal');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <title>${title}</title>
${fontLinks}
  <style>
${tokensToRootCss(tokens)}
${baseStyles()}
  </style>
</head>
<body>
${sectionsHtml}
<script>
${scrollAnimScript()}
</script>
</body>
</html>`;
}
