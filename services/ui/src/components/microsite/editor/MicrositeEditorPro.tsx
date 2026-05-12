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
import { RefreshCw, Wand2, Download, Check, ArrowLeft, Loader2, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  regenerateSection,
  editSectionHtml,
  saveMicrositeAst,
  publishMicrosite,
} from '@/lib/api';
import { Microsite } from '../Microsite';
import type { LayoutAST, LayoutSection } from '@/types/presentation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SectionState {
  html: string;
  regenerating: boolean;
  regenError: string | null;
  promptOpen: boolean;
  promptValue: string;
  applying: boolean;
  applyError: string | null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'no-changes';

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

function buildFullHtml(ast: LayoutAST, sectionHtmls: string[]): string {
  const brand         = ast.brand as unknown as Record<string, unknown>;
  const googleFontsUrl = brand?.googleFontsUrl as string | undefined;
  const fontLink      = googleFontsUrl ? `<link rel="stylesheet" href="${googleFontsUrl}">` : '';
  const title         = ast.meta?.title ?? ast.brand?.companyName ?? 'Microsite';
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
${sectionHtmls.filter(Boolean).join('\n')}
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

  // ── Per-section state (keyed by section id) ────────────────────────────────
  const [sectionStates, setSectionStates] = useState<Record<string, SectionState>>(() => {
    const init: Record<string, SectionState> = {};
    for (const s of ast.sections) {
      init[s.id] = {
        html: getSectionHtml(s),
        regenerating: false,
        regenError:   null,
        promptOpen:   false,
        promptValue:  '',
        applying:     false,
        applyError:   null,
      };
    }
    return init;
  });

  // ── Active section (scroll-to + sidebar highlight) ─────────────────────────
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // ── Save state ─────────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedSnapshotRef = useRef<Record<string, string>>(
    Object.fromEntries(ast.sections.map(s => [s.id, getSectionHtml(s)])),
  );

  // ── Derived AST — updated as sections are regenerated / edited ─────────────
  const currentAst = useMemo<LayoutAST>(() => ({
    ...ast,
    sections: ast.sections.map(s => {
      const state = sectionStates[s.id];
      if (!state?.html) return s;
      return { ...s, customHtml: state.html } as LayoutSection;
    }),
  }), [ast, sectionStates]);

  const hasChanges = useMemo(
    () => ast.sections.some(s => sectionStates[s.id]?.html !== (savedSnapshotRef.current[s.id] ?? '')),
    [ast.sections, sectionStates],
  );

  // ── Helpers ────────────────────────────────────────────────────────────────
  const patch = useCallback((id: string, update: Partial<SectionState>) => {
    setSectionStates(prev => ({ ...prev, [id]: { ...prev[id], ...update } }));
  }, []);

  const scrollToSection = (sectionId: string) => {
    const el = document.querySelector(`[data-section-id="${sectionId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Feature 1: Regenerate ──────────────────────────────────────────────────
  const handleRegenerate = useCallback(async (section: LayoutSection) => {
    if (!apiKey) return;
    patch(section.id, { regenerating: true, regenError: null });

    const latestAst = {
      ...ast,
      sections: ast.sections.map(s => ({
        ...s,
        customHtml: sectionStates[s.id]?.html ?? getSectionHtml(s),
      })),
    };

    try {
      const { html } = await regenerateSection(apiKey, namespace, proposalId, {
        sectionId:  section.id,
        currentAst: latestAst,
      });
      patch(section.id, { html, regenerating: false });
    } catch (err) {
      patch(section.id, {
        regenerating: false,
        regenError:   err instanceof Error ? err.message : 'Regeneration failed',
      });
    }
  }, [apiKey, ast, namespace, proposalId, sectionStates, patch]);

  // ── Feature 2: AI Edit ────────────────────────────────────────────────────
  const handleApplyPrompt = useCallback(async (section: LayoutSection) => {
    const state = sectionStates[section.id];
    if (!apiKey || !state?.promptValue.trim()) return;
    patch(section.id, { applying: true, applyError: null });

    try {
      const { html } = await editSectionHtml(apiKey, namespace, proposalId, {
        sectionHtml: state.html,
        instruction: state.promptValue.trim(),
      });
      patch(section.id, { html, applying: false, promptOpen: false, promptValue: '' });
    } catch (err) {
      patch(section.id, {
        applying:   false,
        applyError: err instanceof Error ? err.message : 'Edit failed',
      });
    }
  }, [apiKey, namespace, proposalId, sectionStates, patch]);

  // ── Feature 3: Save ───────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!apiKey || !hasChanges || saveState === 'saving') return;
    setSaveState('saving');

    const currentHtmls  = ast.sections.map(s => sectionStates[s.id]?.html ?? getSectionHtml(s));
    const fullHtml      = buildFullHtml(ast, currentHtmls);
    const filename      = `${proposalId.split('::').pop() ?? proposalId}.html`;
    triggerDownload(fullHtml, filename);

    const updatedAst: LayoutAST = {
      ...ast,
      sections: ast.sections.map((s, i) => ({ ...s, customHtml: currentHtmls[i] } as LayoutSection)),
    };

    try {
      await saveMicrositeAst(apiKey, namespace, proposalId, updatedAst);
      await publishMicrosite(apiKey, namespace, proposalId, updatedAst).catch(() => {});
      onSaved?.(updatedAst);
    } catch { /* best-effort */ }

    savedSnapshotRef.current = Object.fromEntries(ast.sections.map((s, i) => [s.id, currentHtmls[i]]));
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 3000);
  }, [apiKey, ast, namespace, proposalId, sectionStates, hasChanges, saveState, onSaved]);

  // ── Button helpers ────────────────────────────────────────────────────────
  const saveBtnVariant = saveState === 'saving' ? 'saving'
    : saveState === 'saved'   ? 'saved'
    : !hasChanges             ? 'disabled'
    : 'default';

  const saveBtnLabel = saveState === 'saving' ? 'Saving…'
    : saveState === 'saved'   ? 'Saved!'
    : !hasChanges             ? 'No changes'
    : 'Save HTML';

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
          {ast.sections.length} sections
        </span>

        <div style={{ flex: 1 }} />

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saveBtnVariant === 'disabled' || saveBtnVariant === 'saving'}
          style={{
            height: 34,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 14px',
            background: saveBtnVariant === 'saved' ? tok.success : saveBtnVariant === 'disabled' ? 'rgba(99,110,123,0.2)' : tok.primary,
            border: 'none',
            borderRadius: 7,
            cursor: saveBtnVariant === 'disabled' || saveBtnVariant === 'saving' ? 'default' : 'pointer',
            color: saveBtnVariant === 'disabled' ? tok.muted : '#fff',
            fontSize: 13,
            fontWeight: 600,
            opacity: saveBtnVariant === 'saving' ? 0.8 : 1,
            transition: 'background 0.15s',
          }}
        >
          {saveState === 'saving' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : saveState === 'saved' ? <Check size={14} />
            : <Download size={14} />}
          {saveBtnLabel}
        </button>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      {/* ── Body: sidebar + canvas ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Left sidebar — section list ───────────────────────────────── */}
        <div style={{ width: SIDEBAR_W, flexShrink: 0, borderRight: `1px solid ${tok.border}`, overflowY: 'auto', background: tok.panel, display: 'flex', flexDirection: 'column' }}>

          <div style={{ padding: '10px 12px 6px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: tok.muted }}>
            Sections
          </div>

          {ast.sections.map(section => {
            const state    = sectionStates[section.id];
            const isActive = activeSectionId === section.id;
            const hasHtml  = !!state?.html;

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
                  <ChevronRight size={12} style={{ color: isActive ? tok.primary : tok.muted, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: isActive ? tok.text : tok.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {section.heading || section.sectionType}
                  </span>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: tok.primaryDim, color: tok.primary, fontWeight: 600, flexShrink: 0 }}>
                    {section.sectionType}
                  </span>
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

                  {/* Edit with AI */}
                  <button
                    onClick={e => { e.stopPropagation(); patch(section.id, { promptOpen: !state?.promptOpen, applyError: null }); setActiveSectionId(section.id); }}
                    disabled={state?.applying}
                    title="Edit with natural language instruction"
                    style={{
                      height: 26,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '0 8px',
                      background: state?.promptOpen ? `rgba(31,111,235,0.15)` : 'transparent',
                      border: `1px solid ${state?.promptOpen ? tok.primary : tok.border}`,
                      borderRadius: 5,
                      cursor: state?.applying ? 'default' : 'pointer',
                      color: state?.promptOpen ? tok.primary : tok.muted,
                      fontSize: 11,
                      opacity: state?.applying ? 0.6 : 1,
                    }}
                    onMouseEnter={e => { if (!state?.promptOpen) (e.currentTarget as HTMLElement).style.background = tok.panelSoft; }}
                    onMouseLeave={e => { if (!state?.promptOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <Wand2 size={11} />
                    Edit AI
                  </button>
                </div>

                {/* Error */}
                {state?.regenError && (
                  <div style={{ margin: '0 10px 8px', padding: '6px 8px', borderRadius: 5, background: tok.dangerDim, color: tok.danger, fontSize: 11 }}>
                    {state.regenError}
                    <button
                      onClick={() => patch(section.id, { regenError: null })}
                      style={{ marginLeft: 6, background: 'none', border: 'none', color: tok.danger, cursor: 'pointer', fontSize: 10 }}
                    >✕</button>
                  </div>
                )}

                {/* Inline AI prompt */}
                {state?.promptOpen && (
                  <div style={{ padding: '0 10px 10px' }}>
                    <textarea
                      value={state.promptValue}
                      onChange={e => patch(section.id, { promptValue: e.target.value })}
                      placeholder='"make the headline bigger", "change bg to dark blue"…'
                      disabled={state.applying}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleApplyPrompt(section);
                        if (e.key === 'Escape') patch(section.id, { promptOpen: false, promptValue: '', applyError: null });
                      }}
                      style={{
                        width: '100%',
                        minHeight: 64,
                        padding: '7px 8px',
                        background: tok.bg,
                        border: `1px solid ${tok.border}`,
                        borderRadius: 6,
                        color: tok.text,
                        fontSize: 12,
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    {state.applyError && (
                      <div style={{ marginTop: 4, padding: '5px 7px', borderRadius: 4, background: tok.dangerDim, color: tok.danger, fontSize: 11 }}>
                        {state.applyError}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                      <button
                        onClick={() => handleApplyPrompt(section)}
                        disabled={state.applying || !state.promptValue.trim()}
                        style={{
                          flex: 1,
                          height: 28,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          background: !state.promptValue.trim() ? 'rgba(99,110,123,0.2)' : tok.primary,
                          border: 'none',
                          borderRadius: 5,
                          cursor: state.applying || !state.promptValue.trim() ? 'default' : 'pointer',
                          color: !state.promptValue.trim() ? tok.muted : '#fff',
                          fontSize: 12,
                          fontWeight: 600,
                          opacity: state.applying ? 0.75 : 1,
                        }}
                      >
                        {state.applying ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Applying…</> : 'Apply'}
                      </button>
                      <button
                        onClick={() => patch(section.id, { promptOpen: false, promptValue: '', applyError: null })}
                        disabled={state.applying}
                        style={{ height: 28, padding: '0 10px', background: 'transparent', border: `1px solid ${tok.border}`, borderRadius: 5, cursor: 'pointer', color: tok.muted, fontSize: 12 }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Right canvas — full microsite preview ────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: tok.bg }}>
          <Microsite
            ast={currentAst}
            mode="embedded"
            namespace={namespace}
            proposalId={proposalId}
          />
        </div>
      </div>
    </div>
  );
}
