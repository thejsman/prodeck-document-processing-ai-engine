/**
 * pdfSlideRenderer.ts
 *
 * Builds purpose-made off-screen A4 landscape slides from Layout AST data.
 *
 * Key fixes over previous attempt:
 *   - Diagrams: extracted from live DOM (Mermaid already rendered), embedded as inline SVG
 *   - Tables: proper <table> elements (pricing rows, comparison rows)
 *   - Charts: SVG bar/line/pie/donut recreated from AST data points
 *   - Circular progress rings: SVG recreated from layer.coverage values (Testing section)
 *   - All 23 section types handled
 *   - Content chunked across pages when items exceed one slide's budget
 */

import { isSectionEmpty } from './sectionUtils';
import type { LayoutAST, LayoutSection } from '../types/presentation';

// ── Dimensions ────────────────────────────────────────────────────────────────

export const SLIDE_W_PT = 842;  // A4 landscape width in PDF points
export const SLIDE_H_PT = 595;  // A4 landscape height in PDF points
export const SLIDE_W_PX = 1200; // capture width in CSS pixels
export const SLIDE_H_PX = Math.round(SLIDE_W_PX * (SLIDE_H_PT / SLIDE_W_PT)); // ≈ 847

const PAD_X  = 72;                        // horizontal padding
const PAD_Y  = 56;                        // vertical padding
const INNER_W = SLIDE_W_PX - PAD_X * 2;  // 1056px
const INNER_H = SLIDE_H_PX - PAD_Y * 2;  // 735px
const COL_GAP = 20;

// ── Theme ─────────────────────────────────────────────────────────────────────

const C = {
  bg:           '#0d1117',
  surface:      '#161b22',
  surface2:     '#21262d',
  border:       '#30363d',
  text:         '#e6edf3',
  muted:        '#8b949e',
  accent:       '#14b8a6',
  accentDim:    'rgba(20,184,166,0.12)',
  accentBorder: 'rgba(20,184,166,0.4)',
  accentPalette: ['#14b8a6','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#10b981'],
};

const F = {
  head: 'Inter, -apple-system, sans-serif',
  mono: 'JetBrains Mono, Courier New, monospace',
};

// ── Public types (mirrors pdfGenerator exports for drop-in compatibility) ─────

export interface PDFProgress { pct: number; message: string }
export interface PDFResult {
  success: boolean;
  fileSizeMB?: number;
  pageCount?: number;
  error?: string;
}
export interface PDFOptions {
  title?: string;
  quality?: number;
  scale?: number;
  background?: string;
  onProgress?: (p: PDFProgress) => void;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateMicrositePDF(
  contentEl: HTMLElement,
  ast: LayoutAST,
  _tokens: { bg: string },
  options: PDFOptions = {},
): Promise<PDFResult> {
  const {
    title    = ast.meta?.title ?? 'Proposal',
    quality  = 0.90,
    onProgress,
  } = options;

  const emit = (pct: number, msg: string) => onProgress?.({ pct, message: msg });

  try {
    emit(3, 'Loading fonts…');
    await loadFonts();

    emit(7, 'Waiting for diagrams…');
    await waitForAllDiagrams(contentEl);

    emit(12, 'Building slides…');
    const allSlides: HTMLElement[] = [];

    // Cover slide
    allSlides.push(buildCoverSlide(ast));

    // Section slides
    const sections = (ast.sections ?? []).filter(s => !isSectionEmpty(s));
    for (const section of sections) {
      const c = (section.content ?? {}) as Record<string, unknown>;
      const diagramSVG = hasDiagram(section)
        ? extractDiagramSVG(contentEl, section.id)
        : '';
      const slides = buildSectionSlides(section, c, diagramSVG);
      allSlides.push(...slides);
    }

    emit(18, `Capturing ${allSlides.length} slides…`);

    // Mount off-screen
    const container = document.createElement('div');
    container.style.cssText = [
      'position:fixed',
      'top:-99999999px',
      'left:-99999999px',
      `width:${SLIDE_W_PX}px`,
      'pointer-events:none',
      'z-index:-9999',
      'visibility:hidden',
    ].join(';');
    allSlides.forEach(s => container.appendChild(s));
    document.body.appendChild(container);

    await waitFrames(6);
    await new Promise(r => setTimeout(r, 400));

    // Load jsPDF + html2canvas
    const jspdfMod    = await import('jspdf');
    type JsPDFCtor    = typeof import('jspdf').default;
    const JsPDF: JsPDFCtor =
      (jspdfMod as unknown as { jsPDF: JsPDFCtor }).jsPDF ?? jspdfMod.default;

    const h2cMod   = await import('html2canvas');
    const h2canvas = (h2cMod.default ?? h2cMod) as typeof import('html2canvas').default;

    const pdf = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [SLIDE_W_PT, SLIDE_H_PT], compress: true });
    pdf.setProperties({ title, creator: 'Prodeck' });

    for (let i = 0; i < allSlides.length; i++) {
      emit(18 + Math.round((i / allSlides.length) * 72), `Slide ${i + 1} / ${allSlides.length}…`);

      const slide = allSlides[i];
      slide.style.visibility = 'visible';

      const canvas = await h2canvas(slide, {
        scale:           1.5,
        width:           SLIDE_W_PX,
        height:          SLIDE_H_PX,
        useCORS:         true,
        allowTaint:      true,
        logging:         false,
        backgroundColor: C.bg,
        onclone: (_doc: Document, el: HTMLElement) => {
          el.style.visibility = 'visible';
          el.style.position   = 'relative';
          el.style.top        = '0';
          el.style.left       = '0';
        },
      });

      slide.style.visibility = 'hidden';

      const imgData = canvas.toDataURL('image/jpeg', quality);
      if (i > 0) pdf.addPage([SLIDE_W_PT, SLIDE_H_PT], 'landscape');
      pdf.addImage(imgData, 'JPEG', 0, 0, SLIDE_W_PT, SLIDE_H_PT, '', 'FAST');
    }

    document.body.removeChild(container);

    emit(93, 'Checking file size…');
    let blob = pdf.output('blob');

    if (blob.size > 5 * 1024 * 1024) {
      emit(95, 'Compressing…');
      blob = await recompress(allSlides, 0.72, JsPDF, h2canvas);
    }

    emit(98, 'Saving…');
    const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    emit(100, 'Done!');
    return { success: true, fileSizeMB: Math.round(blob.size / 1024 / 1024 * 100) / 100, pageCount: allSlides.length };

  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'PDF generation failed' };
  }
}

// ── Slide factory ─────────────────────────────────────────────────────────────

function makeSlide(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    `width:${SLIDE_W_PX}px`,
    `height:${SLIDE_H_PX}px`,
    `min-height:${SLIDE_H_PX}px`,
    `max-height:${SLIDE_H_PX}px`,
    'overflow:hidden',
    'position:relative',
    `background:${C.bg}`,
    `font-family:${F.head}`,
    'box-sizing:border-box',
    'visibility:hidden',
    'flex-shrink:0',
  ].join(';');
  return el;
}

function slideWrap(content: string): string {
  return `<div style='padding:${PAD_Y}px ${PAD_X}px;height:100%;box-sizing:border-box;display:flex;flex-direction:column'>${content}</div>`;
}

// ── Section router ────────────────────────────────────────────────────────────

function buildSectionSlides(
  section: LayoutSection,
  c: Record<string, unknown>,
  diagramSVG: string,
): HTMLElement[] {
  const t = section.sectionType;
  if (t === 'hero')         return [buildHeroSlide(c)];
  if (t === 'challenge')    return buildChallengeSlides(c, diagramSVG);
  if (t === 'problem')      return buildProblemSlides(c);
  if (t === 'approach')     return buildApproachSlides(c, diagramSVG);
  if (t === 'deliverables') return buildDeliverablesSlides(c);
  if (t === 'timeline')     return buildTimelineSlides(c, diagramSVG);
  if (t === 'pricing')      return [buildPricingSlide(c)];
  if (t === 'whyus')        return [buildWhyUsSlide(c, diagramSVG)];
  if (t === 'stats')        return [buildStatsSlide(c)];
  if (t === 'metrics')      return [buildMetricsSlide(c)];
  if (t === 'nextsteps')    return [buildNextStepsSlide(c)];
  if (t === 'testimonials') return buildTestimonialsSlides(c);
  if (t === 'benefits')     return buildBenefitsSlides(c);
  if (t === 'security')     return buildSecuritySlides(c, diagramSVG);
  if (t === 'techstack')    return buildTechStackSlides(c, diagramSVG);
  if (t === 'testing')      return [buildTestingSlide(c, diagramSVG)];
  if (t === 'faq')          return buildFaqSlides(c);
  if (t === 'team')         return buildTeamSlides(c);
  if (t === 'comparison')   return [buildComparisonSlide(c)];
  if (t === 'casestudy')    return [buildCaseStudySlide(c)];
  if (t === 'chart')        return [buildChartSlide(c)];
  if (t === 'showcase')     return [buildShowcaseSlide(c)];
  return [buildGenericSlide(c, diagramSVG)];
}

// ── Cover slide ───────────────────────────────────────────────────────────────

function buildCoverSlide(ast: LayoutAST): HTMLElement {
  const slide    = makeSlide();
  const brief    = (ast.brief ?? {}) as Record<string, unknown>;
  const brand    = (ast.brand ?? {}) as Record<string, unknown>;
  const meta     = (ast.meta  ?? {}) as Record<string, unknown>;
  const title    = trunc(String(meta.title ?? brief.heroNarrative ?? 'Proposal'), 100);
  const client   = String(brief.clientName ?? '');
  const company  = String(brand.companyName ?? brief.proposingCompany ?? '');
  const outcomes = (brief.keyOutcomes ?? []) as string[];
  const summary  = String(brief.engagementSummary ?? '');

  slide.innerHTML = slideWrap(`
    <div style='flex:1;display:flex;flex-direction:column;justify-content:center'>
      ${client ? eyebrow(`Proposal for ${client}`) : ''}
      <h1 style='font-size:52px;font-weight:800;line-height:1.1;letter-spacing:-0.03em;color:${C.text};margin:0 0 20px;font-family:${F.head}'>${title}</h1>
      ${summary ? `<p style='font-size:15px;line-height:1.75;color:${C.muted};margin:0 0 28px;max-width:640px;font-family:${F.mono}'>${trunc(summary,200)}</p>` : ''}
      <div style='display:flex;flex-direction:column;gap:10px;margin-bottom:36px'>
        ${outcomes.slice(0,4).map(o=>`
          <div style='display:inline-flex;align-items:center;gap:8px;background:${C.accentDim};border:1px solid ${C.accentBorder};border-radius:100px;padding:6px 16px;font-size:13px;color:${C.accent};font-family:${F.mono};width:fit-content'>
            ✓ ${trunc(String(o),90)}
          </div>`).join('')}
      </div>
      ${company ? `<p style='font-size:12px;color:${C.muted};font-family:${F.mono};margin:0;opacity:0.5'>${company} · ${new Date().toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</p>` : ''}
    </div>
    <div style='position:absolute;top:-200px;right:-200px;width:700px;height:700px;border-radius:50%;border:1px solid ${C.accent};opacity:0.05;pointer-events:none'></div>
  `);
  return slide;
}

// ── Hero slide ────────────────────────────────────────────────────────────────

function buildHeroSlide(c: Record<string, unknown>): HTMLElement {
  const slide    = makeSlide();
  const outcomes = (c.keyOutcomes ?? []) as string[];

  slide.innerHTML = slideWrap(`
    <div style='flex:1;display:flex;flex-direction:column;justify-content:center'>
      ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
      ${c.headline ? `<h1 style='font-size:48px;font-weight:800;line-height:1.1;letter-spacing:-0.03em;color:${C.text};margin:0 0 16px;font-family:${F.head}'>${trunc(String(c.headline),90)}</h1>` : ''}
      ${c.subheadline ? body(String(c.subheadline)) : (c.body ? body(String(c.body)) : '')}
      ${outcomes.length ? `
        <div style='display:flex;flex-direction:column;gap:8px;margin-bottom:24px'>
          ${outcomes.slice(0,3).map(o=>`<div style='display:inline-flex;align-items:center;gap:8px;background:${C.accentDim};border:1px solid ${C.accentBorder};border-radius:100px;padding:5px 14px;font-size:13px;color:${C.accent};font-family:${F.mono};width:fit-content'>✓ ${trunc(String(o),80)}</div>`).join('')}
        </div>` : ''}
      <div style='display:flex;gap:12px;flex-wrap:wrap'>
        ${c.ctaPrimary ? `<div style='background:${C.accent};color:#000;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;font-family:${F.head}'>${String(c.ctaPrimary)}</div>` : ''}
        ${c.ctaSecondary ? `<div style='border:1.5px solid ${C.border};color:${C.text};padding:11px 22px;border-radius:8px;font-size:13px;font-weight:500;font-family:${F.head}'>${String(c.ctaSecondary)}</div>` : ''}
      </div>
    </div>
  `);
  return slide;
}

// ── Challenge slides ──────────────────────────────────────────────────────────

function buildChallengeSlides(c: Record<string, unknown>, svg: string): HTMLElement[] {
  const slide = makeSlide();
  const hasDiag = !!svg;

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    ${c.body ? body(String(c.body)) : ''}
    ${c.pullquote ? `<div style='border-left:3px solid ${C.accent};padding:14px 20px;margin:16px 0;border-radius:0 8px 8px 0;background:${C.accentDim}'><p style='font-size:15px;font-style:italic;color:${C.text};margin:0;line-height:1.6;font-family:${F.mono}'>${trunc(String(c.pullquote),160)}</p></div>` : ''}
    ${hasDiag ? diagramEl(svg, 'Impact chain') : ''}
  `);
  return [slide];
}

// ── Problem slides ────────────────────────────────────────────────────────────

function buildProblemSlides(c: Record<string, unknown>): HTMLElement[] {
  const points = (c.painPoints ?? []) as string[];
  const chunks  = chunkArray(points, 8);
  return chunks.map((chunk, ci) => {
    const slide = makeSlide();
    slide.innerHTML = slideWrap(`
      ${ci === 0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow ?? c.headline ?? ''))}
      ${ci === 0 && c.headline ? h2(String(c.headline)) : ''}
      ${ci === 0 && c.body ? body(String(c.body)) : ''}
      <div style='display:flex;flex-direction:column;gap:10px;margin-top:${ci===0?'16px':'8px'}'>
        ${chunk.map(p=>`
          <div style='display:flex;align-items:flex-start;gap:12px;background:${C.surface};border:1px solid ${C.border};border-radius:8px;padding:14px 16px'>
            <span style='color:#ef4444;font-size:16px;line-height:1;flex-shrink:0;margin-top:1px'>✗</span>
            <span style='font-size:13px;color:${C.text};line-height:1.5;font-family:${F.mono}'>${trunc(String(p),120)}</span>
          </div>`).join('')}
      </div>
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── Approach slides ───────────────────────────────────────────────────────────

function buildApproachSlides(c: Record<string, unknown>, svg: string): HTMLElement[] {
  const pillars = (c.pillars ?? []) as Array<Record<string, unknown>>;
  const perPage  = 4;
  const chunks   = chunkArray(pillars, perPage);
  const slides: HTMLElement[] = [];

  chunks.forEach((chunk, ci) => {
    const slide   = makeSlide();
    const isFirst = ci === 0;
    const showDiag = isFirst && !!svg;
    slide.innerHTML = slideWrap(`
      ${isFirst ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow ?? c.headline ?? ''))}
      ${isFirst && c.headline ? h2(String(c.headline)) : ''}
      ${isFirst && c.subheadline ? body(String(c.subheadline)) : ''}
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;flex:1'>
        ${chunk.map((p:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-top:3px solid ${C.accent};border-radius:10px;padding:18px'>
            <div style='font-size:14px;font-weight:700;color:${C.text};margin-bottom:8px;font-family:${F.head}'>${trunc(String(p.name??''),50)}</div>
            <div style='font-size:12px;color:${C.muted};line-height:1.6;font-family:${F.mono}'>${trunc(String(p.description??''),120)}</div>
          </div>`).join('')}
      </div>
      ${showDiag ? diagramEl(svg, 'Methodology overview') : ''}
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    slides.push(slide);
  });

  if (slides.length === 0) {
    const slide = makeSlide();
    slide.innerHTML = slideWrap(`
      ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
      ${c.headline ? h2(String(c.headline)) : ''}
      ${c.subheadline ? body(String(c.subheadline)) : ''}
      ${svg ? diagramEl(svg, 'Methodology overview') : ''}
    `);
    slides.push(slide);
  }
  return slides;
}

// ── Deliverables slides ───────────────────────────────────────────────────────

function buildDeliverablesSlides(c: Record<string, unknown>): HTMLElement[] {
  const items  = (c.items ?? []) as Array<Record<string, unknown>>;
  const chunks = chunkArray(items, 6);
  return chunks.map((chunk, ci) => {
    const slide = makeSlide();
    slide.innerHTML = slideWrap(`
      ${ci===0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${ci===0 && c.headline ? h2(String(c.headline)) : ''}
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px;flex:1'>
        ${chunk.map((it:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:8px'>
            <div style='font-size:13px;font-weight:700;color:${C.text};font-family:${F.head}'>${trunc(String(it.name??''),50)}</div>
            <div style='font-size:12px;color:${C.muted};line-height:1.5;font-family:${F.mono}'>${trunc(String(it.detail??''),100)}</div>
          </div>`).join('')}
      </div>
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── Timeline slides ───────────────────────────────────────────────────────────

function buildTimelineSlides(c: Record<string, unknown>, svg: string): HTMLElement[] {
  const phases = (c.phases ?? []) as Array<Record<string, unknown>>;
  const perPage = 5;
  const chunks  = chunkArray(phases, perPage);
  const slides: HTMLElement[] = [];

  chunks.forEach((chunk, ci) => {
    const slide   = makeSlide();
    const isFirst = ci === 0;
    const showDiag = isFirst && !!svg;
    slide.innerHTML = slideWrap(`
      ${isFirst ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${isFirst && c.headline ? h2(String(c.headline)) : ''}
      ${isFirst && c.subheadline ? body(String(c.subheadline)) : ''}
      <div style='position:relative;flex:1;margin-top:16px'>
        <div style='position:absolute;left:15px;top:0;bottom:0;width:2px;background:${C.accentBorder}'></div>
        <div style='display:flex;flex-direction:column;gap:16px;padding-left:44px'>
          ${chunk.map((ph:Record<string,unknown>, idx:number)=>{
            const gi = ci * perPage + idx;
            return `
              <div style='position:relative'>
                <div style='position:absolute;left:-44px;top:2px;width:32px;height:32px;border-radius:50%;background:${C.accent};color:#000;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:${F.mono};box-shadow:0 0 0 4px ${C.bg}'>${gi+1}</div>
                <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:16px 18px'>
                  <div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:6px'>
                    <span style='font-size:14px;font-weight:700;color:${C.text};font-family:${F.head}'>${trunc(String(ph.name??''),40)}</span>
                    ${ph.duration ? `<span style='font-size:11px;color:${C.accent};background:${C.accentDim};border:1px solid ${C.accentBorder};border-radius:20px;padding:2px 10px;font-family:${F.mono};font-weight:600'>${ph.duration}</span>` : ''}
                  </div>
                  ${ph.label ? `<div style='font-size:10px;color:${C.accent};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;font-family:${F.mono}'>${ph.label}</div>` : ''}
                  ${ph.description ? `<div style='font-size:12px;color:${C.muted};line-height:1.5;font-family:${F.mono}'>${trunc(String(ph.description),120)}</div>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
      ${showDiag ? diagramEl(svg, 'Project schedule') : ''}
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    slides.push(slide);
  });
  return slides;
}

// ── Pricing slide — proper <table> ────────────────────────────────────────────

function buildPricingSlide(c: Record<string, unknown>): HTMLElement {
  const slide = makeSlide();
  const rows  = (c.rows ?? []) as string[][];
  const hasHeader = rows.length > 0;
  const headerRow = hasHeader ? rows[0] : [];
  const dataRows  = hasHeader ? rows.slice(1) : [];

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    ${c.subheadline ? body(String(c.subheadline)) : ''}
    <div style='flex:1;overflow:hidden'>
      <table style='width:100%;border-collapse:collapse;margin-top:8px'>
        ${headerRow.length ? `
          <thead>
            <tr style='background:${C.surface2}'>
              ${headerRow.map((h:string)=>`<th style='padding:12px 14px;text-align:left;font-size:12px;font-weight:700;color:${C.text};border-bottom:2px solid ${C.accent};font-family:${F.head};white-space:nowrap'>${h}</th>`).join('')}
            </tr>
          </thead>` : ''}
        <tbody>
          ${dataRows.map((row:string[], ri:number)=>`
            <tr style='background:${ri%2===0?C.surface:C.bg};border-bottom:1px solid ${C.border}'>
              ${row.map((cell:string, ci:number)=>`<td style='padding:11px 14px;font-size:13px;color:${ci===0?C.muted:C.text};font-family:${ci===0?F.mono:F.head};font-weight:${ci===0?400:500}'>${cell}</td>`).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${c.totalLabel ? `
      <div style='margin-top:16px;padding:16px;background:${C.surface};border:1px solid ${C.accentBorder};border-radius:10px;display:flex;align-items:center;justify-content:space-between'>
        <span style='font-size:14px;color:${C.muted};font-family:${F.mono}'>Total Investment</span>
        <span style='font-size:32px;font-weight:800;color:${C.accent};font-family:${F.head};letter-spacing:-0.03em'>${c.totalLabel}</span>
      </div>` : ''}
    ${c.footnote ? `<p style='font-size:11px;color:${C.muted};margin-top:10px;font-family:${F.mono}'>${trunc(String(c.footnote),160)}</p>` : ''}
    ${c.cta ? `<div style='margin-top:14px;display:inline-block;background:${C.accent};color:#000;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:700;font-family:${F.head}'>${c.cta}</div>` : ''}
  `);
  return slide;
}

// ── WhyUs slide ───────────────────────────────────────────────────────────────

function buildWhyUsSlide(c: Record<string, unknown>, svg: string): HTMLElement {
  const slide = makeSlide();
  const stats = (c.stats ?? []) as Array<Record<string, unknown>>;

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    ${c.body ? body(String(c.body)) : ''}
    ${stats.length ? `
      <div style='display:grid;grid-template-columns:repeat(${Math.min(stats.length,3)},1fr);gap:14px;margin-top:16px'>
        ${stats.slice(0,3).map((s:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-top:3px solid ${C.accent};border-radius:10px;padding:18px;text-align:center'>
            <div style='font-size:36px;font-weight:800;color:${C.accent};font-family:${F.head};letter-spacing:-0.03em;line-height:1'>${s.number??''}</div>
            <div style='font-size:11px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:0.08em;margin:8px 0 4px;font-family:${F.mono}'>${trunc(String(s.label??''),30)}</div>
            <div style='font-size:11px;color:${C.muted};font-family:${F.mono};line-height:1.4'>${trunc(String(s.context??''),60)}</div>
          </div>`).join('')}
      </div>` : ''}
    ${svg ? diagramEl(svg) : ''}
  `);
  return slide;
}

// ── Stats slide ───────────────────────────────────────────────────────────────

function buildStatsSlide(c: Record<string, unknown>): HTMLElement {
  const slide = makeSlide();
  const stats = (c.stats ?? []) as Array<Record<string, unknown>>;
  const cols  = Math.min(stats.length || 1, 3);

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    <div style='flex:1;display:grid;grid-template-columns:repeat(${cols},1fr);gap:20px;align-content:center;margin-top:24px'>
      ${stats.slice(0,6).map((s:Record<string,unknown>, i:number)=>`
        <div style='text-align:center;padding:24px;background:${C.surface};border:1px solid ${C.border};border-radius:12px;${i>0?`border-left:1px solid ${C.border}`:''}>
          <div style='font-size:56px;font-weight:800;color:${C.accent};line-height:1;letter-spacing:-0.05em;font-family:${F.head}'>${s.number??''}</div>
          <div style='font-size:11px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:0.1em;margin:10px 0 6px;font-family:${F.mono}'>${trunc(String(s.label??''),30)}</div>
          <div style='font-size:12px;color:${C.muted};font-family:${F.mono};line-height:1.5'>${trunc(String(s.context??''),80)}</div>
        </div>`).join('')}
    </div>
  `);
  return slide;
}

// ── Metrics slide ─────────────────────────────────────────────────────────────

function buildMetricsSlide(c: Record<string, unknown>): HTMLElement {
  const slide      = makeSlide();
  const stats      = (c.stats ?? []) as Array<Record<string, unknown>>;
  const strategies = (c.strategies ?? []) as string[];
  const cols       = Math.min(stats.length || 1, 3);

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    <div style='display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px;margin-top:16px'>
      ${stats.slice(0,6).map((s:Record<string,unknown>)=>`
        <div style='text-align:center;padding:20px;background:${C.surface};border:1px solid ${C.border};border-radius:10px'>
          <div style='font-size:44px;font-weight:800;color:${C.accent};line-height:1;font-family:${F.head}'>${s.number??''}</div>
          <div style='font-size:11px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:0.08em;margin:8px 0 4px;font-family:${F.mono}'>${trunc(String(s.label??''),30)}</div>
          <div style='font-size:11px;color:${C.muted};font-family:${F.mono}'>${trunc(String(s.context??''),60)}</div>
        </div>`).join('')}
    </div>
    ${strategies.length ? `
      <div style='margin-top:20px'>
        <div style='font-size:12px;font-weight:700;color:${C.text};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;font-family:${F.mono}'>Scaling Strategies</div>
        <div style='display:flex;flex-direction:column;gap:8px'>
          ${strategies.slice(0,5).map((s:string)=>`
            <div style='display:flex;align-items:flex-start;gap:10px'>
              <div style='width:6px;height:6px;border-radius:50%;background:${C.accent};flex-shrink:0;margin-top:5px'></div>
              <span style='font-size:13px;color:${C.muted};font-family:${F.mono};line-height:1.5'>${trunc(String(s),120)}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}
  `);
  return slide;
}

// ── NextSteps slide ───────────────────────────────────────────────────────────

function buildNextStepsSlide(c: Record<string, unknown>): HTMLElement {
  const slide = makeSlide();
  slide.innerHTML = slideWrap(`
    <div style='flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center'>
      ${c.urgencyNote ? `<div style='display:inline-block;background:${C.accentDim};border:1px solid ${C.accentBorder};border-radius:20px;padding:6px 20px;font-size:12px;font-weight:600;color:${C.accent};margin-bottom:20px;letter-spacing:0.08em;font-family:${F.mono};text-transform:uppercase'>${c.urgencyNote}</div>` : (c.eyebrow ? eyebrow(String(c.eyebrow)) : '')}
      ${c.headline ? `<h1 style='font-size:44px;font-weight:800;letter-spacing:-0.03em;color:${C.text};margin:0 0 20px;max-width:680px;line-height:1.15;font-family:${F.head}'>${trunc(String(c.headline),80)}</h1>` : ''}
      ${c.body ? `<p style='font-size:16px;color:${C.muted};margin:0 0 36px;max-width:520px;line-height:1.7;font-family:${F.mono}'>${trunc(String(c.body),180)}</p>` : ''}
      <div style='display:flex;gap:14px;justify-content:center'>
        ${c.ctaPrimary ? `<div style='background:${C.accent};color:#000;padding:14px 36px;border-radius:10px;font-size:15px;font-weight:700;font-family:${F.head}'>${c.ctaPrimary}</div>` : ''}
        ${c.ctaSecondary ? `<div style='border:1.5px solid ${C.border};color:${C.text};padding:13px 28px;border-radius:10px;font-size:14px;font-weight:500;font-family:${F.head}'>${c.ctaSecondary}</div>` : ''}
      </div>
    </div>
  `);
  return slide;
}

// ── Testimonials slides ───────────────────────────────────────────────────────

function buildTestimonialsSlides(c: Record<string, unknown>): HTMLElement[] {
  const items  = (c.items ?? []) as Array<Record<string, unknown>>;
  const chunks = chunkArray(items, 2);
  return chunks.map((chunk, ci) => {
    const slide = makeSlide();
    slide.innerHTML = slideWrap(`
      ${ci===0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${ci===0 && c.headline ? h2(String(c.headline)) : ''}
      <div style='display:grid;grid-template-columns:repeat(${chunk.length},1fr);gap:16px;flex:1;margin-top:16px'>
        ${chunk.map((q:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:24px;display:flex;flex-direction:column'>
            <div style='font-size:36px;color:${C.accent};font-weight:800;line-height:1;margin-bottom:12px;font-family:${F.head}'>"</div>
            <p style='font-size:13px;color:${C.muted};line-height:1.7;margin:0 0 16px;font-style:italic;font-family:${F.mono};flex:1'>${trunc(String(q.quote??''),200)}</p>
            <div style='border-top:1px solid ${C.border};padding-top:14px;display:flex;align-items:center;gap:12px'>
              <div style='width:36px;height:36px;border-radius:50%;background:${C.accentDim};border:1px solid ${C.accentBorder};display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:${C.accent};font-family:${F.head};flex-shrink:0'>${String(q.name??'?')[0].toUpperCase()}</div>
              <div>
                <div style='font-size:13px;font-weight:600;color:${C.text};font-family:${F.head}'>${q.name??''}</div>
                <div style='font-size:11px;color:${C.muted};font-family:${F.mono};margin-top:1px'>${q.title??''} · ${q.company??''}</div>
              </div>
            </div>
          </div>`).join('')}
      </div>
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── Benefits slides ───────────────────────────────────────────────────────────

function buildBenefitsSlides(c: Record<string, unknown>): HTMLElement[] {
  const items  = (c.items ?? []) as Array<Record<string, unknown>>;
  const chunks = chunkArray(items, 6);
  return chunks.map((chunk, ci) => {
    const slide = makeSlide();
    slide.innerHTML = slideWrap(`
      ${ci===0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${ci===0 && c.headline ? h2(String(c.headline)) : ''}
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;margin-top:16px'>
        ${chunk.map((it:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-top:3px solid ${C.accent};border-radius:10px;padding:18px'>
            <div style='font-size:13px;font-weight:700;color:${C.text};margin-bottom:8px;font-family:${F.head}'>${trunc(String(it.title??''),50)}</div>
            <div style='font-size:12px;color:${C.muted};line-height:1.5;font-family:${F.mono}'>${trunc(String(it.description??''),100)}</div>
          </div>`).join('')}
      </div>
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── Security slides ───────────────────────────────────────────────────────────

function buildSecuritySlides(c: Record<string, unknown>, svg: string): HTMLElement[] {
  const items  = (c.items ?? []) as Array<Record<string, unknown>>;
  const chunks = chunkArray(items, 4);
  return chunks.map((chunk, ci) => {
    const slide   = makeSlide();
    const showDiag = ci === 0 && !!svg;
    slide.innerHTML = slideWrap(`
      ${ci===0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${ci===0 && c.headline ? h2(String(c.headline)) : ''}
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px'>
        ${chunk.map((it:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:16px'>
            <div style='font-size:13px;font-weight:700;color:${C.text};margin-bottom:6px;font-family:${F.head}'>${trunc(String(it.name??''),50)}</div>
            <div style='font-size:12px;color:${C.muted};line-height:1.5;font-family:${F.mono}'>${trunc(String(it.description??''),100)}</div>
          </div>`).join('')}
      </div>
      ${showDiag ? diagramEl(svg, 'Security architecture') : ''}
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── TechStack slides ──────────────────────────────────────────────────────────

function buildTechStackSlides(c: Record<string, unknown>, svg: string): HTMLElement[] {
  const cats   = (c.categories ?? []) as Array<Record<string, unknown>>;
  const chunks = chunkArray(cats, 4);
  return chunks.map((chunk, ci) => {
    const slide   = makeSlide();
    const showDiag = ci === 0 && !!svg;
    slide.innerHTML = slideWrap(`
      ${ci===0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${ci===0 && c.headline ? h2(String(c.headline)) : ''}
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px'>
        ${chunk.map((cat:Record<string,unknown>)=>{
          const techItems = (cat.items ?? []) as string[];
          return `
            <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:16px'>
              <div style='font-size:13px;font-weight:700;color:${C.text};margin-bottom:10px;font-family:${F.head}'>${trunc(String(cat.name??''),40)}</div>
              <div style='display:flex;flex-direction:column;gap:6px'>
                ${techItems.slice(0,6).map((t:string)=>`
                  <div style='display:flex;align-items:center;gap:8px'>
                    <div style='width:5px;height:5px;border-radius:50%;background:${C.accent};flex-shrink:0'></div>
                    <span style='font-size:12px;color:${C.muted};font-family:${F.mono}'>${trunc(String(t),50)}</span>
                  </div>`).join('')}
              </div>
            </div>`;
        }).join('')}
      </div>
      ${showDiag ? diagramEl(svg, 'Technology stack') : ''}
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── Testing slide — SVG circular progress rings ───────────────────────────────

function buildTestingSlide(c: Record<string, unknown>, svg: string): HTMLElement {
  const slide  = makeSlide();
  const layers = ((c.layers ?? []) as Array<Record<string, unknown>>)
    .sort((a, b) => Number(a.level ?? 0) - Number(b.level ?? 0));
  const additional = (c.additionalInfo ?? []) as Array<Record<string, unknown>>;

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    <div style='display:flex;flex-wrap:wrap;gap:24px;justify-content:center;margin-top:20px'>
      ${layers.slice(0,4).map((l:Record<string,unknown>)=>{
        const val = parseFloat(String(l.coverage??'0')) || 0;
        return `
          <div style='display:flex;flex-direction:column;align-items:center;gap:10px'>
            ${svgCircularProgress(val, 130, 10)}
            <div style='font-size:13px;font-weight:700;color:${C.text};text-align:center;font-family:${F.head}'>${trunc(String(l.name??''),30)}</div>
            ${l.description ? `<div style='font-size:11px;color:${C.muted};text-align:center;max-width:130px;font-family:${F.mono}'>${trunc(String(l.description),60)}</div>` : ''}
          </div>`;
      }).join('')}
    </div>
    ${svg ? diagramEl(svg, 'Testing pyramid') : ''}
    ${additional.length ? `
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px'>
        ${additional.slice(0,4).map((a:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-radius:8px;padding:14px'>
            <div style='font-size:12px;font-weight:700;color:${C.text};margin-bottom:6px;font-family:${F.head}'>${trunc(String(a.heading??''),40)}</div>
            <div style='font-size:11px;color:${C.muted};line-height:1.5;font-family:${F.mono}'>${trunc(String(a.body??''),100)}</div>
          </div>`).join('')}
      </div>` : ''}
  `);
  return slide;
}

// ── FAQ slides ────────────────────────────────────────────────────────────────

function buildFaqSlides(c: Record<string, unknown>): HTMLElement[] {
  const items  = (c.items ?? []) as Array<Record<string, unknown>>;
  const chunks = chunkArray(items, 5);
  return chunks.map((chunk, ci) => {
    const slide = makeSlide();
    slide.innerHTML = slideWrap(`
      ${ci===0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${ci===0 && c.headline ? h2(String(c.headline)) : ''}
      ${ci===0 && c.subheadline ? body(String(c.subheadline)) : ''}
      <div style='display:flex;flex-direction:column;gap:12px;margin-top:16px;flex:1'>
        ${chunk.map((q:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:16px 18px'>
            <div style='font-size:14px;font-weight:700;color:${C.text};margin-bottom:8px;font-family:${F.head}'>${trunc(String(q.question??''),80)}</div>
            <div style='font-size:12px;color:${C.muted};line-height:1.6;font-family:${F.mono}'>${trunc(String(q.answer??''),200)}</div>
          </div>`).join('')}
      </div>
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── Team slides ───────────────────────────────────────────────────────────────

function buildTeamSlides(c: Record<string, unknown>): HTMLElement[] {
  const members = (c.members ?? []) as Array<Record<string, unknown>>;
  const chunks  = chunkArray(members, 4);
  return chunks.map((chunk, ci) => {
    const slide = makeSlide();
    slide.innerHTML = slideWrap(`
      ${ci===0 ? (c.eyebrow ? eyebrow(String(c.eyebrow)) : '') : contHeader(String(c.eyebrow??c.headline??''))}
      ${ci===0 && c.headline ? h2(String(c.headline)) : ''}
      ${ci===0 && c.subheadline ? body(String(c.subheadline)) : ''}
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;margin-top:16px'>
        ${chunk.map((m:Record<string,unknown>)=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:18px;display:flex;gap:14px;align-items:flex-start'>
            <div style='width:52px;height:52px;border-radius:50%;background:${C.accentDim};border:2px solid ${C.accentBorder};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:${C.accent};font-family:${F.head};flex-shrink:0'>${String(m.name??'?')[0].toUpperCase()}</div>
            <div>
              <div style='font-size:14px;font-weight:700;color:${C.text};font-family:${F.head}'>${trunc(String(m.name??''),30)}</div>
              <div style='font-size:12px;color:${C.accent};margin:3px 0 8px;font-family:${F.mono}'>${trunc(String(m.role??''),40)}</div>
              <div style='font-size:11px;color:${C.muted};line-height:1.5;font-family:${F.mono}'>${trunc(String(m.bio??''),100)}</div>
            </div>
          </div>`).join('')}
      </div>
      ${chunks.length>1 ? pageInd(ci+1,chunks.length) : ''}
    `);
    return slide;
  });
}

// ── Comparison slide — proper <table> ────────────────────────────────────────

function buildComparisonSlide(c: Record<string, unknown>): HTMLElement {
  const slide   = makeSlide();
  const rows    = (c.rows ?? []) as Array<Record<string, unknown>>;
  const usLabel = String(c.usLabel ?? 'Us');
  const thLabel = String(c.themLabel ?? 'Them');

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    ${c.subheadline ? body(String(c.subheadline)) : ''}
    <div style='flex:1;overflow:hidden;margin-top:16px'>
      <table style='width:100%;border-collapse:collapse'>
        <thead>
          <tr>
            <th style='padding:12px 14px;text-align:left;font-size:12px;font-weight:700;color:${C.muted};border-bottom:2px solid ${C.border};font-family:${F.mono};width:50%'>Feature</th>
            <th style='padding:12px 14px;text-align:center;font-size:12px;font-weight:700;color:${C.accent};border-bottom:2px solid ${C.accent};background:${C.accentDim};font-family:${F.mono};width:25%'>${usLabel}</th>
            <th style='padding:12px 14px;text-align:center;font-size:12px;font-weight:700;color:${C.muted};border-bottom:2px solid ${C.border};font-family:${F.mono};width:25%'>${thLabel}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r:Record<string,unknown>, ri:number)=>`
            <tr style='background:${ri%2===0?C.surface:C.bg};border-bottom:1px solid ${C.border}'>
              <td style='padding:11px 14px;font-size:13px;color:${C.text};font-family:${F.mono}'>${trunc(String(r.feature??''),60)}</td>
              <td style='padding:11px 14px;text-align:center;background:${C.accentDim}'>${cellIcon(String(r.us??''))}</td>
              <td style='padding:11px 14px;text-align:center'>${cellIcon(String(r.them??''))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `);
  return slide;
}

// ── CaseStudy slide ───────────────────────────────────────────────────────────

function buildCaseStudySlide(c: Record<string, unknown>): HTMLElement {
  const slide   = makeSlide();
  const metrics = (c.metrics ?? []) as Array<Record<string, unknown>>;
  const steps   = [
    { icon: '⚡', label: 'Challenge', content: c.challenge },
    { icon: '💡', label: 'Solution',  content: c.solution  },
    { icon: '🎯', label: 'Outcome',   content: c.outcome   },
  ].filter(s => s.content);

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    <div style='display:grid;grid-template-columns:${metrics.length?'1fr 1fr':'1fr'};gap:20px;flex:1;margin-top:16px'>
      <div style='display:flex;flex-direction:column;gap:16px;position:relative'>
        ${steps.map(s=>`
          <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:16px 18px;display:flex;gap:12px;align-items:flex-start'>
            <span style='font-size:20px;flex-shrink:0;line-height:1;margin-top:1px'>${s.icon}</span>
            <div>
              <div style='font-size:11px;font-weight:700;color:${C.accent};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;font-family:${F.mono}'>${s.label}</div>
              <div style='font-size:13px;color:${C.muted};line-height:1.6;font-family:${F.mono}'>${trunc(String(s.content??''),150)}</div>
            </div>
          </div>`).join('')}
      </div>
      ${metrics.length ? `
        <div style='background:${C.surface};border:1px solid ${C.border};border-radius:10px;padding:20px'>
          <div style='font-size:11px;font-weight:700;color:${C.accent};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px;font-family:${F.mono}'>Results</div>
          <div style='display:flex;flex-direction:column;gap:14px'>
            ${metrics.map((m:Record<string,unknown>)=>`
              <div style='border-bottom:1px solid ${C.border};padding-bottom:14px;last-child:{border:none}'>
                <div style='font-size:32px;font-weight:800;color:${C.accent};font-family:${F.head};letter-spacing:-0.03em;line-height:1'>${m.value??''}</div>
                <div style='font-size:12px;color:${C.muted};margin-top:4px;font-family:${F.mono}'>${trunc(String(m.label??''),50)}</div>
              </div>`).join('')}
          </div>
        </div>` : ''}
    </div>
  `);
  return slide;
}

// ── Chart slide — recreate SVG from data ──────────────────────────────────────

function buildChartSlide(c: Record<string, unknown>): HTMLElement {
  const slide     = makeSlide();
  const data      = (c.data ?? []) as Array<Record<string, unknown>>;
  const chartType = String(c.chartType ?? 'bar');
  const unit      = String(c.unit ?? '');

  let chartSVG = '';
  if (chartType === 'bar' || chartType === 'line') {
    chartSVG = svgBarChart(data, unit, chartType === 'line');
  } else if (chartType === 'pie' || chartType === 'donut') {
    chartSVG = svgPieChart(data, chartType === 'donut');
  }

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    ${c.body ? body(String(c.body)) : ''}
    <div style='flex:1;display:flex;align-items:center;justify-content:center;margin-top:16px'>
      <div style='background:${C.surface};border:1px solid ${C.border};border-radius:12px;padding:20px;width:100%'>
        ${chartSVG}
      </div>
    </div>
  `);
  return slide;
}

// ── Showcase slide ────────────────────────────────────────────────────────────

function buildShowcaseSlide(c: Record<string, unknown>): HTMLElement {
  const slide      = makeSlide();
  const highlights = (c.highlights ?? []) as string[];

  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    ${c.subheadline ? body(String(c.subheadline)) : ''}
    ${c.body ? body(String(c.body)) : ''}
    ${highlights.length ? `
      <div style='display:flex;flex-direction:column;gap:10px;margin-top:16px'>
        ${highlights.slice(0,6).map((h:string)=>`
          <div style='display:flex;align-items:center;gap:12px;padding:12px 16px;background:${C.surface};border:1px solid ${C.border};border-left:3px solid ${C.accent};border-radius:0 8px 8px 0'>
            <div style='width:6px;height:6px;border-radius:50%;background:${C.accent};flex-shrink:0'></div>
            <span style='font-size:13px;color:${C.text};font-family:${F.mono};line-height:1.4'>${trunc(String(h),100)}</span>
          </div>`).join('')}
      </div>` : ''}
  `);
  return slide;
}

// ── Generic slide ─────────────────────────────────────────────────────────────

function buildGenericSlide(c: Record<string, unknown>, svg: string): HTMLElement {
  const slide = makeSlide();
  slide.innerHTML = slideWrap(`
    ${c.eyebrow ? eyebrow(String(c.eyebrow)) : ''}
    ${c.headline ? h2(String(c.headline)) : ''}
    ${c.body ? body(String(c.body)) : ''}
    ${svg ? diagramEl(svg) : ''}
  `);
  return slide;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function svgCircularProgress(value: number, size: number, stroke: number): string {
  const r      = (size - stroke) / 2;
  const circ   = 2 * Math.PI * r;
  const offset = circ - (Math.min(Math.max(value, 0), 100) / 100) * circ;
  const cx     = size / 2;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style='display:block'>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${C.border}" stroke-width="${stroke}"/>
      <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${C.accent}" stroke-width="${stroke}"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
        stroke-linecap="round" transform="rotate(-90 ${cx} ${cx})"/>
      <text x="${cx}" y="${cx+7}" text-anchor="middle" fill="${C.accent}"
        font-size="20" font-weight="700" font-family="${F.head}">${Math.round(value)}%</text>
    </svg>`;
}

function svgBarChart(
  data: Array<Record<string, unknown>>,
  unit: string,
  isLine: boolean,
): string {
  const W   = INNER_W;
  const H   = 280;
  const pad = { top: 20, right: 20, bottom: 50, left: 40 };
  const iW  = W - pad.left - pad.right;
  const iH  = H - pad.top - pad.bottom;

  if (data.length === 0) return '';
  const vals   = data.map(d => Number(d.value ?? 0));
  const maxVal = Math.max(...vals, 1);
  const barW   = Math.floor(iW / data.length) - 6;
  const accent = C.accentPalette;

  const items = data.map((d, i) => {
    const x  = pad.left + i * (iW / data.length) + (iW / data.length - barW) / 2;
    const bH = Math.floor((vals[i] / maxVal) * iH);
    const y  = pad.top + iH - bH;
    const cx = x + barW / 2;
    const cl = accent[i % accent.length];
    return { x, y, bH, cx, label: String(d.label ?? ''), val: vals[i], color: String(d.color ?? cl) };
  });

  const bars = items.map(it => `
    <rect x="${it.x}" y="${it.y}" width="${barW}" height="${it.bH}" fill="${it.color}" rx="3"/>
    <text x="${it.cx}" y="${it.y - 4}" text-anchor="middle" fill="${C.text}" font-size="10" font-family="${F.mono}">${it.val}${unit}</text>
    <text x="${it.cx}" y="${H - pad.bottom + 14}" text-anchor="middle" fill="${C.muted}" font-size="10" font-family="${F.mono}">${trunc(it.label, 12)}</text>
  `).join('');

  const linePath = isLine
    ? `<polyline points="${items.map(it=>`${it.cx},${it.y}`).join(' ')}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-linejoin="round"/>`
      + items.map(it=>`<circle cx="${it.cx}" cy="${it.y}" r="4" fill="${C.accent}"/>`).join('')
    : '';

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${H-pad.bottom}" stroke="${C.border}" stroke-width="1"/>
    <line x1="${pad.left}" y1="${H-pad.bottom}" x2="${W-pad.right}" y2="${H-pad.bottom}" stroke="${C.border}" stroke-width="1"/>
    ${isLine ? '' : bars}
    ${linePath}
    ${isLine ? bars.replace(/<rect[^/]*/g,'') : ''}
  </svg>`;
}

function svgPieChart(data: Array<Record<string, unknown>>, isDonut: boolean): string {
  const W  = INNER_W;
  const H  = 280;
  const cx = W / 2;
  const cy = H / 2;
  const r  = Math.min(cx, cy) - 30;
  const dr = isDonut ? r * 0.55 : 0;

  const total = data.reduce((s, d) => s + Number(d.value ?? 0), 0) || 1;
  let angle = -Math.PI / 2;
  const palette = C.accentPalette;

  const slices = data.map((d, i) => {
    const val    = Number(d.value ?? 0);
    const sweep  = (val / total) * 2 * Math.PI;
    const x1     = cx + r * Math.cos(angle);
    const y1     = cy + r * Math.sin(angle);
    angle += sweep;
    const x2     = cx + r * Math.cos(angle);
    const y2     = cy + r * Math.sin(angle);
    const lf     = sweep > Math.PI ? 1 : 0;
    const color  = String(d.color ?? palette[i % palette.length]);
    const midA   = angle - sweep / 2;
    const lx     = cx + (r + 16) * Math.cos(midA);
    const ly     = cy + (r + 16) * Math.sin(midA);
    return { x1, y1, x2, y2, lf, color, label: String(d.label ?? ''), pct: Math.round(val/total*100), lx, ly };
  });

  const paths = slices.map(s => {
    if (isDonut) {
      const ix1 = cx + dr * Math.cos(Math.atan2(s.y1 - cy, s.x1 - cx) + (2*Math.PI*Number(data[0].value??0)/total));
      return `<path d="M ${cx + dr * Math.cos(Math.atan2(s.y1-cy,s.x1-cx))} ${cy + dr * Math.sin(Math.atan2(s.y1-cy,s.x1-cx))} L ${s.x1} ${s.y1} A ${r} ${r} 0 ${s.lf} 1 ${s.x2} ${s.y2} L ${cx + dr * Math.cos(Math.atan2(s.y2-cy,s.x2-cx))} ${cy + dr * Math.sin(Math.atan2(s.y2-cy,s.x2-cx))} A ${dr} ${dr} 0 ${s.lf} 0 ${cx + dr * Math.cos(Math.atan2(s.y1-cy,s.x1-cx))} ${cy + dr * Math.sin(Math.atan2(s.y1-cy,s.x1-cx))} Z" fill="${s.color}"/>`;
      void ix1;
    }
    return `<path d="M ${cx} ${cy} L ${s.x1} ${s.y1} A ${r} ${r} 0 ${s.lf} 1 ${s.x2} ${s.y2} Z" fill="${s.color}"/>`;
  }).join('');

  const legend = slices.map((s, i) => `
    <g transform="translate(${W - 160}, ${30 + i * 22})">
      <rect width="12" height="12" rx="3" fill="${s.color}"/>
      <text x="18" y="10" fill="${C.muted}" font-size="11" font-family="${F.mono}">${trunc(s.label,16)} (${s.pct}%)</text>
    </g>`).join('');

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${paths}
    ${isDonut ? `<circle cx="${cx}" cy="${cy}" r="${dr}" fill="${C.bg}"/>` : ''}
    ${legend}
  </svg>`;
}

// ── HTML element helpers ──────────────────────────────────────────────────────

function eyebrow(text: string): string {
  return `<div style='font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${C.accent};margin-bottom:14px;font-family:${F.mono}'>${text}</div>`;
}

function h2(text: string): string {
  return `<h2 style='font-size:36px;font-weight:700;line-height:1.15;letter-spacing:-0.025em;color:${C.text};margin:0 0 14px;font-family:${F.head}'>${trunc(text, 90)}</h2>`;
}

function body(text: string): string {
  return `<p style='font-size:14px;line-height:1.75;color:${C.muted};margin:0 0 18px;font-family:${F.mono}'>${trunc(text, 280)}</p>`;
}

function contHeader(label: string): string {
  return `<div style='font-size:11px;font-weight:600;color:${C.accent};text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px;font-family:${F.mono};opacity:0.7'>${trunc(label,50)} · continued</div>`;
}

function pageInd(cur: number, total: number): string {
  return `<div style='text-align:right;margin-top:10px;font-size:11px;color:${C.muted};opacity:0.4;font-family:${F.mono}'>${cur} / ${total}</div>`;
}

function diagramEl(svgHtml: string, caption?: string): string {
  if (!svgHtml) return '';
  return `
    <div style='border:1px solid ${C.accentBorder};border-radius:10px;padding:16px;background:${C.surface};margin-top:16px;overflow:hidden;max-height:320px'>
      <div style='display:flex;align-items:center;justify-content:center;max-height:280px;overflow:hidden'>${svgHtml}</div>
      ${caption ? `<p style='font-size:11px;color:${C.muted};text-align:center;margin:8px 0 0;font-family:${F.mono}'>${caption}</p>` : ''}
    </div>`;
}

function cellIcon(val: string): string {
  if (!val) return `<span style='color:${C.muted};font-family:${F.mono};font-size:13px'>—</span>`;
  const lower = val.toLowerCase();
  if (lower === '✓' || lower === 'yes' || lower === 'true' || lower.includes('check')) {
    return `<span style='color:#10b981;font-size:16px'>✓</span>`;
  }
  if (lower === '✗' || lower === 'no' || lower === 'false' || lower.includes('cross')) {
    return `<span style='color:#ef4444;font-size:16px'>✗</span>`;
  }
  return `<span style='font-size:12px;color:${C.text};font-family:${F.mono}'>${val}</span>`;
}

// ── Diagram extraction from live DOM ─────────────────────────────────────────

function hasDiagram(section: LayoutSection): boolean {
  const c = (section.content ?? {}) as Record<string, unknown>;
  return typeof c.diagram === 'string' && c.diagram.trim().length > 0;
}

function extractDiagramSVG(contentEl: HTMLElement, sectionId: string): string {
  try {
    const sel = `[data-section-id="${CSS.escape(sectionId)}"] .diagram-container svg`;
    const svg = contentEl.querySelector(sel);
    if (!svg) return '';
    const clone = svg.cloneNode(true) as SVGElement;
    // Make SVG responsive
    clone.setAttribute('width', '100%');
    clone.removeAttribute('height');
    clone.style.maxWidth  = '100%';
    clone.style.maxHeight = '260px';
    clone.style.display   = 'block';
    return clone.outerHTML;
  } catch {
    return '';
  }
}

async function waitForAllDiagrams(contentEl: HTMLElement, timeout = 8000): Promise<void> {
  const containers = Array.from(contentEl.querySelectorAll('.diagram-container'));
  if (containers.length === 0) return;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (containers.every(c => c.querySelector('svg'))) return;
    await new Promise(r => setTimeout(r, 200));
  }
  // Timeout — proceed anyway with whatever rendered
}

// ── Utility ───────────────────────────────────────────────────────────────────

function trunc(text: string, max: number): string {
  if (!text || text.length <= max) return text ?? '';
  const cut = text.slice(0, max);
  const sp  = cut.lastIndexOf(' ');
  return (sp > max * 0.8 ? cut.slice(0, sp) : cut) + '…';
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (!arr.length) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadFonts(): Promise<void> {
  const id = 'pdf-slide-font-link';
  if (!document.getElementById(id)) {
    const link  = document.createElement('link');
    link.id     = id;
    link.rel    = 'stylesheet';
    link.href   = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }
  await new Promise(r => setTimeout(r, 900));
  await document.fonts.ready;
}

async function waitFrames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r));
}

type JsPDFCtor  = typeof import('jspdf').default;
type H2CFn      = typeof import('html2canvas').default;

async function recompress(
  slides: HTMLElement[],
  quality: number,
  JsPDF: JsPDFCtor,
  h2canvas: H2CFn,
): Promise<Blob> {
  const pdf2 = new JsPDF({ orientation: 'landscape', unit: 'pt', format: [SLIDE_W_PT, SLIDE_H_PT], compress: true });
  for (let i = 0; i < slides.length; i++) {
    const canvas = await h2canvas(slides[i], { scale: 1, width: SLIDE_W_PX, height: SLIDE_H_PX, useCORS: true, logging: false, backgroundColor: C.bg });
    const img = canvas.toDataURL('image/jpeg', quality);
    if (i > 0) pdf2.addPage([SLIDE_W_PT, SLIDE_H_PT], 'landscape');
    pdf2.addImage(img, 'JPEG', 0, 0, SLIDE_W_PT, SLIDE_H_PT, '', 'FAST');
  }
  return pdf2.output('blob');
}
