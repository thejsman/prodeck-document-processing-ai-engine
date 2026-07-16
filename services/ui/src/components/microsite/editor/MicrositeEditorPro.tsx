'use client';

/**
 * MicrositeEditorPro — fresh editor with three focused features:
 *   1. Per-section HTML Regenerate
 *   2. Natural language HTML edit via inline AI prompt
 *   3. Save HTML (download + server persist)
 *
 * Layout: left sidebar (section list + controls) + right canvas (full Microsite preview).
 * Visual tokens match MicrositeEditor — no logic or feature code is shared with it.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshCw, Download, Check, ArrowLeft, Loader2, Save, Sparkles, Undo2, Redo2, PanelLeft, HelpCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useHelp } from '@/lib/help/help-store';
import {
  regenerateSection,
  editSectionHtml,
  saveMicrositeAst,
  publishMicrosite,
} from '@/lib/api';
import { MicrositePro as Microsite } from '../MicrositePro';
import { DesignAgentPanelPro } from './DesignAgentPanelPro';
import type { LayoutAST, LayoutSection } from '@/types/presentation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Canvas-affecting state — changing this re-renders the microsite preview. */
interface SectionHtmlState {
  html: string;
}

/** UI-only state — changing this NEVER re-renders the microsite canvas. */
interface SectionUiState {
  regenerating: boolean;
  regenError: string | null;
  aiEditing: boolean;
  saving: boolean;
  savedAt: number | null;
}


export interface MicrositeEditorProProps {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  onClose: () => void;
  /** Called after a successful save with the updated AST — lets callers sync local state. */
  onSaved?: (updatedAst: LayoutAST) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSectionHtml(section: LayoutSection): string {
  return ((section as unknown as Record<string, unknown>).customHtml as string | undefined) ?? '';
}

const _NAV_LABELS: Record<string, string> = {
  hero:'Home',overview:'Overview',challenge:'Challenge',problem:'Problem',
  approach:'Approach',deliverables:'Deliverables',timeline:'Timeline',
  pricing:'Pricing',whyus:'Why Us',nextsteps:'Next Steps',
  testimonials:'Testimonials',showcase:'Our Work',benefits:'Key Benefits',
  stats:'Stats',metrics:'Performance',security:'Risk & Compliance',
  techstack:'Tech Stack',testing:'Testing',faq:'FAQs',team:'Our Team',
  comparison:'How We Compare',casestudy:'Case Study',approval:'Sign Off',generic:'Details',
};

function buildNavHtml(ast: LayoutAST): string {
  const brand   = ast.brand as unknown as Record<string, unknown>;
  const cssVars = (brand?.extractedCssVariables ?? {}) as Record<string, string>;
  const bg      = cssVars['--ms-bg']      ?? '#0d1117';
  const accent  = cssVars['--ms-accent']  ?? '#4FA3E8';
  const border  = cssVars['--ms-border']  ?? 'rgba(255,255,255,0.1)';
  const rawFont = cssVars['--ms-font-body'] ?? "'sans-serif'";
  const bodyFont = rawFont.replace(/"/g, "'");
  const isDark  = cssVars['--ms-is-dark'] !== '0';
  const logoUrl  = brand?.logoUrl  as string | undefined;
  const logoText = (brand?.logoText as string | undefined) ?? (brand?.companyName as string | undefined) ?? '';
  const inactive = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.52)';

  const allSections = ast.sections ?? [];
  const typeCounts: Record<string, number> = {};
  allSections.forEach(s => { typeCounts[s.sectionType] = (typeCounts[s.sectionType] ?? 0) + 1; });

  const navSections = allSections.filter(s =>
    s.sectionType !== 'approval' && (s.sectionType as string) !== 'chart' && s.sectionType !== 'hero'
  );

  const getLabel = (s: LayoutSection): string => {
    const mapped = _NAV_LABELS[s.sectionType];
    if (mapped && typeCounts[s.sectionType] === 1) return mapped;
    if (s.heading) return s.heading.split(/\s+/).slice(0, 3).join(' ');
    return mapped ?? 'Section';
  };

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${logoText}" style="height:28px;object-fit:contain;max-width:160px">`
    : `<span style="font-family:${bodyFont},sans-serif;font-weight:700;font-size:15px;color:${accent};letter-spacing:0.12em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${logoText}</span>`;

  const linkButtons = navSections.map(s =>
    `<button class="ms-xnav-link" data-target="${s.id}" style="background:none;border:none;border-bottom:1.5px solid transparent;cursor:pointer;font-family:${bodyFont},sans-serif;font-size:11px;font-weight:600;color:${inactive};letter-spacing:0.08em;text-transform:uppercase;padding:4px 0 2px;white-space:nowrap;transition:color 0.2s;flex-shrink:0">${getLabel(s)}</button>`
  ).join('');

  const mobileButtons = navSections.map((s, i) =>
    `<button class="ms-xnav-mlink" data-target="${s.id}" style="background:rgba(255,255,255,0.04);border:1px solid ${border};border-radius:8px;cursor:pointer;text-align:center;padding:10px 8px;font-family:${bodyFont},sans-serif;font-size:10px;font-weight:600;letter-spacing:0.07em;text-transform:uppercase;color:${inactive};transition:color 0.15s,background 0.15s;display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;line-height:1.3"><span style="width:18px;height:18px;border-radius:5px;background:rgba(255,255,255,0.08);flex-shrink:0;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center">${i + 1}</span>${getLabel(s)}</button>`
  ).join('');

  // Escape values for inline JS string literals
  const jsAccent  = accent.replace(/'/g, "\\'");
  const jsBg      = bg.replace(/'/g, "\\'");
  const jsInactive = inactive.replace(/'/g, "\\'");
  const jsBorder  = border.replace(/'/g, "\\'");

  return `<div id="ms-xnav-pb" style="position:sticky;top:0;left:0;right:0;height:2px;background:${accent}20;z-index:600;pointer-events:none"><div id="ms-xnav-p" style="height:100%;width:0%;background:${accent};transition:width 0.1s linear"></div></div>
<nav id="ms-xnav" style="position:sticky;top:2px;left:0;right:0;z-index:500;padding:0 24px;height:64px;display:flex;align-items:center;justify-content:space-between;background:${bg}99;backdrop-filter:blur(16px);border-bottom:1px solid transparent;transition:background 0.3s,border-color 0.3s">
  <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">${logoHtml}</div>
  <div id="ms-xnav-links" style="display:flex;align-items:center;gap:20px;flex-shrink:0">${linkButtons}</div>
  <button id="ms-xnav-burger" style="display:none;background:none;border:1px solid transparent;border-radius:8px;cursor:pointer;padding:6px 8px;color:${inactive};flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:background 0.15s" onclick="msXNavToggle()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h16M4 16h16"/></svg></button>
</nav>
<div id="ms-xnav-mob" style="display:none;position:sticky;top:66px;left:0;right:0;z-index:499;background:${bg}f0;backdrop-filter:blur(24px);border-bottom:1px solid ${border}">
  <div style="padding:12px 16px 16px;display:grid;grid-template-columns:repeat(2,1fr);gap:6px">${mobileButtons}</div>
</div>
<script>
(function(){
  var accent='${jsAccent}',bg='${jsBg}',inactive='${jsInactive}',bdr='${jsBorder}';
  var mOpen=false;
  window.addEventListener('scroll',function(){
    var sc=document.documentElement.scrollHeight-window.innerHeight;
    var pct=sc>0?(window.scrollY/sc*100):0;
    var p=document.getElementById('ms-xnav-p');if(p)p.style.width=pct+'%';
    var nav=document.getElementById('ms-xnav');
    if(nav){nav.style.background=window.scrollY>60?bg+'cc':bg+'99';nav.style.borderBottomColor=window.scrollY>60?bdr:'transparent';}
  },{passive:true});
  function checkLayout(){
    var nav=document.getElementById('ms-xnav'),lnk=document.getElementById('ms-xnav-links'),brg=document.getElementById('ms-xnav-burger');
    if(!nav||!lnk||!brg)return;
    var narrow=nav.getBoundingClientRect().width<640;
    lnk.style.display=narrow?'none':'flex';brg.style.display=narrow?'flex':'none';
    if(!narrow){var m=document.getElementById('ms-xnav-mob');if(m)m.style.display='none';mOpen=false;}
  }
  window.addEventListener('resize',checkLayout);checkLayout();
  var vis={};
  function setActive(id){
    document.querySelectorAll('.ms-xnav-link,.ms-xnav-mlink').forEach(function(b){
      var isA=b.getAttribute('data-target')===id;
      b.style.color=isA?accent:inactive;
      if(b.classList.contains('ms-xnav-link'))b.style.borderBottomColor=isA?accent:'transparent';
      if(b.classList.contains('ms-xnav-mlink')){b.style.background=isA?accent+'18':'rgba(255,255,255,0.04)';b.style.borderColor=isA?accent+'50':bdr;}
    });
  }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){if(e.isIntersecting)vis[e.target.id]=e.intersectionRatio;else delete vis[e.target.id];});
      var best='',bestR=0;Object.keys(vis).forEach(function(k){if(vis[k]>bestR){bestR=vis[k];best=k;}});setActive(best);
    },{threshold:[0,0.1,0.3,0.5],rootMargin:'-64px 0px 0px 0px'});
    document.querySelectorAll('.ms-xnav-link,.ms-xnav-mlink').forEach(function(b){var el=document.getElementById(b.getAttribute('data-target'));if(el)io.observe(el);});
  }
  document.querySelectorAll('.ms-xnav-link,.ms-xnav-mlink').forEach(function(b){
    b.addEventListener('click',function(){
      var el=document.getElementById(b.getAttribute('data-target'));
      if(el)el.scrollIntoView({behavior:'smooth',block:'start'});
      var m=document.getElementById('ms-xnav-mob');if(m)m.style.display='none';mOpen=false;
    });
  });
  window.msXNavToggle=function(){
    mOpen=!mOpen;var m=document.getElementById('ms-xnav-mob'),brg=document.getElementById('ms-xnav-burger');
    if(m)m.style.display=mOpen?'block':'none';
    if(brg){brg.style.background=mOpen?accent+'18':'none';brg.style.borderColor=mOpen?accent:'transparent';brg.style.color=mOpen?accent:inactive;}
  };
})();
</script>`;
}

function buildFullHtml(ast: LayoutAST, sectionHtmls: string[]): string {
  const brand          = ast.brand as unknown as Record<string, unknown>;
  const googleFontsUrl = brand?.googleFontsUrl as string | undefined;
  const fontLink       = googleFontsUrl ? `<link rel="stylesheet" href="${googleFontsUrl}">` : '';
  const title          = ast.meta?.title ?? ast.brand?.companyName ?? 'Microsite';
  const navHtml        = buildNavHtml(ast);

  // Wrap each section with its id so the nav can scroll-to it
  const sectionsHtml = ast.sections
    .map((s, i) => {
      const html = sectionHtmls[i];
      if (!html) return '';
      return `<div id="${s.id}" style="scroll-margin-top:64px">${html}</div>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${fontLink}
  <style>*{box-sizing:border-box}body{margin:0;padding:0}</style>
</head>
<body>
${navHtml}
${sectionsHtml}
</body>
</html>`;
}

function triggerDownload(html: string, filename: string) {
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Design tokens — mirrors MicrositeEditor's CSS-variable-based system
// ---------------------------------------------------------------------------

const BAR_H     = 52;
const SIDEBAR_W = 272;

const tok = {
  bg:          'var(--bg, #0d1117)',
  panel:       'var(--panel, #161b22)',
  panelSoft:   'var(--panel-soft, #1c2128)',
  border:      'var(--border, #30363d)',
  text:        'var(--text, #e6edf3)',
  muted:       'var(--muted, #8b949e)',
  primary:     'var(--primary, #1f6feb)',
  primaryDim:  'rgba(31,111,235,0.15)',
  success:     'var(--success, #238636)',
  danger:      '#f85149',
  dangerDim:   'rgba(248,81,73,0.12)',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MicrositeEditorPro({
  ast,
  namespace,
  proposalId,
  onClose,
  onSaved,
}: MicrositeEditorProProps) {
  const { apiKey } = useAuth();

  // ── HTML state — keyed by section id — drives the canvas ───────────────────
  // Only updating this causes the microsite preview to re-render.
  const [sectionHtmls, setSectionHtmls] = useState<Record<string, SectionHtmlState>>(() => {
    const init: Record<string, SectionHtmlState> = {};
    for (const s of ast.sections) init[s.id] = { html: getSectionHtml(s) };
    return init;
  });

  // ── UI state — keyed by section id — never affects the canvas ──────────────
  // Typing in the prompt textarea only updates this, so the canvas stays still.
  const [sectionUi, setSectionUi] = useState<Record<string, SectionUiState>>(() => {
    const init: Record<string, SectionUiState> = {};
    for (const s of ast.sections) {
      init[s.id] = { regenerating: false, regenError: null, aiEditing: false, saving: false, savedAt: null };
    }
    return init;
  });

  // ── Active section (scroll-to + sidebar highlight) ─────────────────────────
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // ── Local AST — updated by Design AI; base for currentAst ─────────────────
  const [localAst, setLocalAst] = useState<LayoutAST>(() => ast);

  // ── Design AI panel state ──────────────────────────────────────────────────
  const [showDesignPanel, setShowDesignPanel] = useState(false);
  const [previewAst, setPreviewAst] = useState<LayoutAST | null>(null);
  const [panelInitialTab, setPanelInitialTab] = useState<'design' | 'content'>('design');
  const [panelTargetSectionId, setPanelTargetSectionId] = useState<string | undefined>(undefined);
  const [panelInstruction, setPanelInstruction] = useState('');
  const savedSnapshotRef = useRef<Record<string, string>>(
    Object.fromEntries(ast.sections.map(s => [s.id, getSectionHtml(s)])),
  );

  // Reactive per-section "last persisted" snapshot — drives per-section Save button visibility.
  // Unlike savedSnapshotRef, changes here trigger re-renders so the button appears/disappears.
  const [savedHtmls, setSavedHtmls] = useState<Record<string, string>>(
    () => Object.fromEntries(ast.sections.map(s => [s.id, getSectionHtml(s)])),
  );

  // ── Undo / Redo history ────────────────────────────────────────────────────
  interface HistoryEntry { sectionHtmls: Record<string, SectionHtmlState>; localAst: LayoutAST; }
  const historyRef = useRef<HistoryEntry[]>([{
    sectionHtmls: Object.fromEntries(ast.sections.map(s => [s.id, { html: getSectionHtml(s) }])),
    localAst: ast,
  }]);
  const histIdxRef = useRef(0);
  const [histIdx, setHistIdx] = useState(0);
  const [histLen, setHistLen] = useState(1);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    const stack = historyRef.current.slice(0, histIdxRef.current + 1);
    stack.push(entry);
    if (stack.length > 30) stack.shift();
    historyRef.current = stack;
    histIdxRef.current = stack.length - 1;
    setHistIdx(histIdxRef.current);
    setHistLen(stack.length);
  }, []);

  const handleUndo = useCallback(() => {
    if (histIdxRef.current <= 0) return;
    histIdxRef.current--;
    const snap = historyRef.current[histIdxRef.current];
    setSectionHtmls(snap.sectionHtmls);
    setLocalAst(snap.localAst);
    setHistIdx(histIdxRef.current);
  }, []);

  const handleRedo = useCallback(() => {
    if (histIdxRef.current >= historyRef.current.length - 1) return;
    histIdxRef.current++;
    const snap = historyRef.current[histIdxRef.current];
    setSectionHtmls(snap.sectionHtmls);
    setLocalAst(snap.localAst);
    setHistIdx(histIdxRef.current);
  }, []);

  // ── Derived AST — only depends on localAst + sectionHtmls, not UI state ────
  const currentAst = useMemo<LayoutAST>(() => ({
    ...localAst,
    sections: localAst.sections.map(s => {
      const html = sectionHtmls[s.id]?.html;
      if (!html) return s;
      return { ...s, customHtml: html } as LayoutSection;
    }),
  }), [localAst, sectionHtmls]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  /** Update HTML for a section — re-renders the canvas. */
  const patchHtml = useCallback((id: string, html: string) => {
    setSectionHtmls(prev => ({ ...prev, [id]: { html } }));
  }, []);

  /** Update UI state for a section — does NOT re-render the canvas. */
  const patchUi = useCallback((id: string, update: Partial<SectionUiState>) => {
    setSectionUi(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }, []);

  const scrollToSection = (sectionId: string) => {
    const el = document.querySelector(`[data-section-id="${sectionId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Feature 1: Regenerate ──────────────────────────────────────────────────
  const handleRegenerate = useCallback(async (section: LayoutSection) => {
    if (!apiKey) return;
    patchUi(section.id, { regenerating: true, regenError: null });

    const latestAst = {
      ...localAst,
      sections: localAst.sections.map(s => ({
        ...s,
        customHtml: sectionHtmls[s.id]?.html ?? getSectionHtml(s),
      })),
    };

    try {
      const { html } = await regenerateSection(apiKey, namespace, proposalId, {
        sectionId:  section.id,
        currentAst: latestAst,
      });
      patchHtml(section.id, html);
      pushHistory({
        sectionHtmls: { ...sectionHtmls, [section.id]: { html } },
        localAst,
      });
      patchUi(section.id, { regenerating: false, regenError: null });
    } catch (err) {
      patchUi(section.id, {
        regenerating: false,
        regenError:   err instanceof Error ? err.message : 'Regeneration failed',
      });
    }
  }, [apiKey, localAst, namespace, proposalId, sectionHtmls, patchHtml, patchUi, pushHistory]);

  // ── Design AI — content tab: apply prompt to all (or one) section HTML ────
  const handleContentApply = useCallback(async (
    instruction: string,
    targetSectionId?: string,
  ): Promise<{ sectionsUpdated: number }> => {
    if (!apiKey) return { sectionsUpdated: 0 };
    const targets = targetSectionId
      ? localAst.sections.filter(s => s.id === targetSectionId)
      : localAst.sections;

    // Mark each section as being AI-edited so sidebar shows spinners
    setSectionUi(prev => {
      const next = { ...prev };
      targets.forEach(s => { next[s.id] = { ...next[s.id], aiEditing: true }; });
      return next;
    });

    // Process in parallel; update each section live, collect final state for history
    const finalHtmls: Record<string, SectionHtmlState> = { ...sectionHtmls };
    let count = 0;
    await Promise.all(
      targets.map(async s => {
        const currentHtml = sectionHtmls[s.id]?.html ?? getSectionHtml(s);
        try {
          const { html } = await editSectionHtml(apiKey, namespace, proposalId, {
            sectionHtml: currentHtml,
            instruction,
          });
          setSectionHtmls(prev => ({ ...prev, [s.id]: { html } }));
          finalHtmls[s.id] = { html };
          count++;
        } finally {
          patchUi(s.id, { aiEditing: false });
        }
      }),
    );

    if (count > 0) pushHistory({ sectionHtmls: finalHtmls, localAst });
    return { sectionsUpdated: count };
  }, [apiKey, localAst, namespace, proposalId, sectionHtmls, patchUi, pushHistory]);

  // ── Feature 2b: Per-section Save ─────────────────────────────────────────
  const handleSectionSave = useCallback(async (section: LayoutSection) => {
    if (!apiKey) return;
    patchUi(section.id, { saving: true });

    const currentHtmls = localAst.sections.map(s => sectionHtmls[s.id]?.html ?? getSectionHtml(s));
    const updatedAst: LayoutAST = {
      ...localAst,
      sections: localAst.sections.map((s, i) => ({ ...s, customHtml: currentHtmls[i] } as LayoutSection)),
    };

    try {
      await saveMicrositeAst(apiKey, namespace, proposalId, updatedAst);
      await publishMicrosite(apiKey, namespace, proposalId, updatedAst).catch(() => {});
      onSaved?.(updatedAst);
      // Mark this section as persisted so the Save button disappears
      setSavedHtmls(prev => ({ ...prev, [section.id]: sectionHtmls[section.id]?.html ?? getSectionHtml(section) }));
      savedSnapshotRef.current = { ...savedSnapshotRef.current, [section.id]: sectionHtmls[section.id]?.html ?? getSectionHtml(section) };
      patchUi(section.id, { saving: false, savedAt: Date.now() });
      setTimeout(() => patchUi(section.id, { savedAt: null }), 3000);
    } catch {
      patchUi(section.id, { saving: false });
    }
  }, [apiKey, localAst, namespace, proposalId, sectionHtmls, onSaved, patchUi]);

  // ── Save All ──────────────────────────────────────────────────────────────
  const hasUnsavedChanges = useMemo(
    () => localAst.sections.some(s => (sectionHtmls[s.id]?.html ?? '') !== savedHtmls[s.id]),
    [localAst.sections, sectionHtmls, savedHtmls],
  );
  const [savingAll, setSavingAll] = useState(false);
  const [savedAllAt, setSavedAllAt] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleSaveAll = useCallback(async () => {
    if (!apiKey || savingAll) return;
    setSavingAll(true);
    const currentHtmls = localAst.sections.map(s => sectionHtmls[s.id]?.html ?? getSectionHtml(s));
    const updatedAst: LayoutAST = {
      ...localAst,
      sections: localAst.sections.map((s, i) => ({ ...s, customHtml: currentHtmls[i] } as LayoutSection)),
    };
    try {
      await saveMicrositeAst(apiKey, namespace, proposalId, updatedAst);
      await publishMicrosite(apiKey, namespace, proposalId, updatedAst).catch(() => {});
      onSaved?.(updatedAst);
      const newSaved = Object.fromEntries(localAst.sections.map((s, i) => [s.id, currentHtmls[i]]));
      setSavedHtmls(newSaved);
      savedSnapshotRef.current = newSaved;
      setSavedAllAt(Date.now());
      setTimeout(() => setSavedAllAt(null), 3000);
    } finally {
      setSavingAll(false);
    }
  }, [apiKey, savingAll, localAst, namespace, proposalId, sectionHtmls, onSaved]);

  // ── Feature 3: Download ───────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    const currentHtmls = localAst.sections.map(s => sectionHtmls[s.id]?.html ?? getSectionHtml(s));
    const fullHtml     = buildFullHtml(localAst, currentHtmls);

    // Build a meaningful filename from client name + version
    const client  = (localAst.meta?.client ?? localAst.brand?.companyName ?? '').trim();
    const version = (proposalId as string).match(/[_\-v]v?(\d+)$/i)?.[1];
    const slug    = (client || proposalId.split('::').pop() || 'microsite')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const filename = `${slug}-microsite${version ? `-v${version}` : ''}.html`;

    triggerDownload(fullHtml, filename);
  }, [localAst, proposalId, sectionHtmls]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', flexDirection: 'column', background: tok.bg, color: tok.text, fontFamily: 'inherit' }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div style={{ height: BAR_H, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: tok.panel, borderBottom: `1px solid ${tok.border}` }}>
        <button
          onClick={onClose}
          title="Back"
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 7, cursor: 'pointer', color: tok.muted }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = tok.panelSoft; (e.currentTarget as HTMLElement).style.color = tok.text; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = tok.muted; }}
        >
          <ArrowLeft size={16} />
        </button>

        <span style={{ fontSize: 14, fontWeight: 600, color: tok.text, letterSpacing: '0.01em' }}>
          Microsite Editor Pro
        </span>
        <span style={{ fontSize: 12, color: tok.muted }}>
          {localAst.sections.length} sections
        </span>

        {/* Help */}
        <button
          onClick={() => useHelp.getState().openHelp('microsite-editor-pro')}
          title="Help — microsite editor (Pro)"
          aria-label="Help — microsite editor (Pro)"
          style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', color: tok.muted }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = tok.panelSoft; (e.currentTarget as HTMLElement).style.color = tok.text; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = tok.muted; }}
        >
          <HelpCircle size={15} />
        </button>

        {/* Undo / Redo */}
        <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
          <button
            onClick={handleUndo}
            disabled={histIdx <= 0}
            title={`Undo (${histIdx} step${histIdx === 1 ? '' : 's'} back)`}
            style={{
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 6,
              cursor: histIdx <= 0 ? 'default' : 'pointer',
              color: histIdx <= 0 ? tok.border : tok.muted,
              opacity: histIdx <= 0 ? 0.4 : 1,
            }}
            onMouseEnter={e => { if (histIdx > 0) (e.currentTarget as HTMLElement).style.background = tok.panelSoft; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={handleRedo}
            disabled={histIdx >= histLen - 1}
            title={`Redo (${histLen - 1 - histIdx} step${histLen - 1 - histIdx === 1 ? '' : 's'} forward)`}
            style={{
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', borderRadius: 6,
              cursor: histIdx >= histLen - 1 ? 'default' : 'pointer',
              color: histIdx >= histLen - 1 ? tok.border : tok.muted,
              opacity: histIdx >= histLen - 1 ? 0.4 : 1,
            }}
            onMouseEnter={e => { if (histIdx < histLen - 1) (e.currentTarget as HTMLElement).style.background = tok.panelSoft; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <Redo2 size={14} />
          </button>
        </div>

        {/* Sections sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? 'Hide sections panel' : 'Show sections panel'}
          style={{
            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: sidebarOpen ? tok.primaryDim : 'transparent',
            border: `1px solid ${sidebarOpen ? tok.primary : 'transparent'}`,
            borderRadius: 7, cursor: 'pointer',
            color: sidebarOpen ? tok.primary : tok.muted,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!sidebarOpen) { (e.currentTarget as HTMLElement).style.background = tok.panelSoft; (e.currentTarget as HTMLElement).style.color = tok.text; } }}
          onMouseLeave={e => { if (!sidebarOpen) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = tok.muted; } }}
        >
          <PanelLeft size={15} />
        </button>

        <div style={{ flex: 1 }} />

        {/* Design AI button */}
        <button
          onClick={() => {
            setPanelInitialTab('design');
            setPanelTargetSectionId(undefined);
            setPanelInstruction('');
            setShowDesignPanel(v => !v);
          }}
          title="Design AI panel"
          style={{
            height: 34,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 14px',
            background: showDesignPanel ? 'rgba(139,92,246,0.15)' : 'transparent',
            border: `1px solid ${showDesignPanel ? '#7c3aed' : tok.border}`,
            borderRadius: 7,
            cursor: 'pointer',
            color: showDesignPanel ? '#a78bfa' : tok.muted,
            fontSize: 13,
            fontWeight: 600,
            transition: 'all 0.15s',
          }}
        >
          <Sparkles size={14} />
          Design AI
        </button>

        {/* Save All button — appears when any section has unsaved changes */}
        {hasUnsavedChanges && (
          <button
            onClick={handleSaveAll}
            disabled={savingAll}
            title="Save all changes to the server"
            style={{
              height: 34,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 14px',
              background: savedAllAt ? tok.success : 'rgba(35,134,54,0.15)',
              border: `1px solid ${savedAllAt ? tok.success : '#238636'}`,
              borderRadius: 7,
              cursor: savingAll ? 'default' : 'pointer',
              color: savedAllAt ? '#fff' : '#3fb950',
              fontSize: 13,
              fontWeight: 600,
              opacity: savingAll ? 0.7 : 1,
              transition: 'all 0.15s',
            }}
          >
            {savingAll
              ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              : savedAllAt
                ? <Check size={14} />
                : <Save size={14} />}
            {savingAll ? 'Saving…' : savedAllAt ? 'Saved!' : 'Save All'}
          </button>
        )}

        {/* Download HTML button — always enabled, no server save */}
        <button
          onClick={handleDownload}
          title="Download the full microsite as a single HTML file"
          style={{
            height: 34,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 14px',
            background: tok.primary,
            border: 'none',
            borderRadius: 7,
            cursor: 'pointer',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.85'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        >
          <Download size={14} />
          Download HTML
        </button>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {/* ── Body: sidebar + canvas ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left sidebar — section list ───────────────────────────────── */}
        {sidebarOpen && <div style={{ width: SIDEBAR_W, flexShrink: 0, borderRight: `1px solid ${tok.border}`, overflowY: 'auto', background: tok.panel, display: 'flex', flexDirection: 'column' }}>

          <div style={{ padding: '10px 12px 6px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: tok.muted }}>
            Sections
          </div>

          {localAst.sections.map(section => {
            const state      = sectionUi[section.id];
            const isActive   = activeSectionId === section.id;
            const hasHtml    = !!sectionHtmls[section.id]?.html;
            const isModified = (sectionHtmls[section.id]?.html ?? '') !== savedHtmls[section.id];

            return (
              <div key={section.id} style={{ borderBottom: `1px solid ${tok.border}` }}>

                {/* Section row */}
                <div
                  onClick={() => { setActiveSectionId(section.id); scrollToSection(section.id); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    cursor: 'pointer',
                    background: isActive ? `rgba(31,111,235,0.08)` : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = tok.panelSoft; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {/* Modified dot — glows amber when section has unsaved changes */}
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                    background: state?.aiEditing ? '#818cf8' : isModified ? '#f59e0b' : 'transparent',
                    border: isModified || state?.aiEditing ? 'none' : `1px solid ${tok.border}`,
                    boxShadow: state?.aiEditing ? '0 0 6px #818cf8' : isModified ? '0 0 5px rgba(245,158,11,0.5)' : 'none',
                    transition: 'all 0.2s',
                  }} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: isActive ? tok.text : tok.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {section.heading || section.sectionType}
                  </span>
                  {/* AI editing spinner — shows while this section is being processed */}
                  {state?.aiEditing
                    ? <Loader2 size={11} style={{ color: '#818cf8', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    : <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: tok.primaryDim, color: tok.primary, fontWeight: 600, flexShrink: 0 }}>
                        {section.sectionType}
                      </span>
                  }
                </div>

                {/* Section actions */}
                <div style={{ display: 'flex', gap: 4, padding: '4px 10px 8px', paddingLeft: 28 }}>
                  {/* Regenerate */}
                  <button
                    onClick={e => { e.stopPropagation(); handleRegenerate(section); }}
                    disabled={state?.regenerating}
                    title={hasHtml ? 'Regenerate this section' : 'Generate HTML for this section'}
                    style={{
                      height: 26,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '0 8px',
                      background: 'transparent',
                      border: `1px solid ${tok.border}`,
                      borderRadius: 5,
                      cursor: state?.regenerating ? 'default' : 'pointer',
                      color: tok.muted,
                      fontSize: 11,
                      opacity: state?.regenerating ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!state?.regenerating) (e.currentTarget as HTMLElement).style.background = tok.panelSoft; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {state?.regenerating
                      ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                      : <RefreshCw size={11} />}
                    {state?.regenerating ? 'Running…' : hasHtml ? 'Regen' : 'Generate'}
                  </button>

                  {/* AI Edit — opens Design AI panel targeting this section */}
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setActiveSectionId(section.id);
                      setPanelTargetSectionId(section.id);
                      setPanelInitialTab('content');
                      setPanelInstruction('');
                      setShowDesignPanel(true);
                    }}
                    title="Edit this section with AI"
                    style={{
                      height: 26,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '0 8px',
                      background: (showDesignPanel && panelTargetSectionId === section.id) ? 'rgba(139,92,246,0.15)' : 'transparent',
                      border: `1px solid ${(showDesignPanel && panelTargetSectionId === section.id) ? '#7c3aed' : tok.border}`,
                      borderRadius: 5,
                      cursor: 'pointer',
                      color: (showDesignPanel && panelTargetSectionId === section.id) ? '#a78bfa' : tok.muted,
                      fontSize: 11,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(139,92,246,0.10)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = (showDesignPanel && panelTargetSectionId === section.id) ? 'rgba(139,92,246,0.15)' : 'transparent'; }}
                  >
                    <Sparkles size={11} />
                    AI Edit
                  </button>

                  {/* Per-section Save — appears only when this section has unsaved changes */}
                  {(sectionHtmls[section.id]?.html ?? '') !== savedHtmls[section.id] && (
                    <button
                      onClick={e => { e.stopPropagation(); handleSectionSave(section); }}
                      disabled={state?.saving}
                      title="Save changes to this section"
                      style={{
                        height: 26,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '0 8px',
                        background: state?.savedAt ? tok.success : tok.primary,
                        border: 'none',
                        borderRadius: 5,
                        cursor: state?.saving ? 'default' : 'pointer',
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 600,
                        opacity: state?.saving ? 0.7 : 1,
                        transition: 'background 0.15s',
                      }}
                    >
                      {state?.saving
                        ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                        : state?.savedAt
                          ? <Check size={11} />
                          : <Save size={11} />}
                      {state?.saving ? 'Saving…' : state?.savedAt ? 'Saved!' : 'Save'}
                    </button>
                  )}
                </div>

                {/* Error */}
                {state?.regenError && (
                  <div style={{ margin: '0 10px 8px', padding: '6px 8px', borderRadius: 5, background: tok.dangerDim, color: tok.danger, fontSize: 11 }}>
                    {state.regenError}
                    <button
                      onClick={() => patchUi(section.id, { regenError: null })}
                      style={{ marginLeft: 6, background: 'none', border: 'none', color: tok.danger, cursor: 'pointer', fontSize: 10 }}
                    >✕</button>
                  </div>
                )}

              </div>
            );
          })}
        </div>}

        {/* ── Right canvas — full microsite preview ────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: tok.bg, position: 'relative' }}>
          {previewAst && (
            <div style={{
              position: 'sticky', top: 0, left: 0, right: 0, zIndex: 10,
              background: '#fef3c7', borderBottom: '1px solid #f59e0b',
              padding: '7px 16px', fontSize: 12, fontWeight: 500, color: '#92400e',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>✦ Previewing AI changes</span>
              <span style={{ color: '#a16207', fontWeight: 400 }}>Apply or Revert in the Design AI panel →</span>
            </div>
          )}
          <Microsite
            ast={previewAst ?? currentAst}
            mode="embedded"
            namespace={namespace}
            proposalId={proposalId}
          />
        </div>
      </div>

      {/* ── Design AI panel ───────────────────────────────────────────── */}
      {showDesignPanel && (
        <DesignAgentPanelPro
          ast={currentAst}
          targetSectionId={panelTargetSectionId}
          initialInstruction={panelInstruction}
          initialTab={panelInitialTab}
          onContentApply={handleContentApply}
          onClose={() => {
            setShowDesignPanel(false);
            setPanelInstruction('');
            setPanelTargetSectionId(undefined);
          }}
        />
      )}
    </div>
  );
}
