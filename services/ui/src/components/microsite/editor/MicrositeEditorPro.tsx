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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Wand2, Download, Check, ArrowLeft, Loader2, ChevronRight, Save, RotateCcw } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  regenerateSection,
  editSectionHtml,
  saveMicrositeAst,
  publishMicrosite,
} from '@/lib/api';
import { MicrositePro as Microsite } from '../MicrositePro';
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
  promptOpen: boolean;
  promptValue: string;
  applying: boolean;
  applyError: string | null;
  saving: boolean;
  savedAt: number | null;
}

type SaveState  = 'idle' | 'saving' | 'saved' | 'no-changes';
type RegenState = 'idle' | 'generating' | 'done';

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
      init[s.id] = { regenerating: false, regenError: null, promptOpen: false, promptValue: '', applying: false, applyError: null, saving: false, savedAt: null };
    }
    return init;
  });

  // ── Active section (scroll-to + sidebar highlight) ─────────────────────────
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  // ── Full-microsite regeneration state ──────────────────────────────────────
  const [regenState, setRegenState]     = useState<RegenState>('idle');
  const [pendingHtmls, setPendingHtmls] = useState<Record<string, string>>({});
  const abortRegenRef = useRef<AbortController | null>(null);

  // Cancel any in-flight generation when the editor unmounts
  useEffect(() => () => { abortRegenRef.current?.abort(); }, []);

  // ── Save state ─────────────────────────────────────────────────────────────
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const savedSnapshotRef = useRef<Record<string, string>>(
    Object.fromEntries(ast.sections.map(s => [s.id, getSectionHtml(s)])),
  );

  // Reactive per-section "last persisted" snapshot — drives per-section Save button visibility.
  // Unlike savedSnapshotRef, changes here trigger re-renders so the button appears/disappears.
  const [savedHtmls, setSavedHtmls] = useState<Record<string, string>>(
    () => Object.fromEntries(ast.sections.map(s => [s.id, getSectionHtml(s)])),
  );

  // ── Derived AST — only depends on sectionHtmls, not UI state ───────────────
  const currentAst = useMemo<LayoutAST>(() => ({
    ...ast,
    sections: ast.sections.map(s => {
      const html = sectionHtmls[s.id]?.html;
      if (!html) return s;
      return { ...s, customHtml: html } as LayoutSection;
    }),
  }), [ast, sectionHtmls]);

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
      ...ast,
      sections: ast.sections.map(s => ({
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
      patchUi(section.id, { regenerating: false, regenError: null });
    } catch (err) {
      patchUi(section.id, {
        regenerating: false,
        regenError:   err instanceof Error ? err.message : 'Regeneration failed',
      });
    }
  }, [apiKey, ast, namespace, proposalId, sectionHtmls, patchHtml, patchUi]);

  // ── Feature 2: AI Edit ────────────────────────────────────────────────────
  const handleApplyPrompt = useCallback(async (section: LayoutSection) => {
    const ui = sectionUi[section.id];
    if (!apiKey || !ui?.promptValue.trim()) return;
    patchUi(section.id, { applying: true, applyError: null });

    try {
      const { html } = await editSectionHtml(apiKey, namespace, proposalId, {
        sectionHtml: sectionHtmls[section.id]?.html ?? getSectionHtml(section),
        instruction: ui.promptValue.trim(),
      });
      patchHtml(section.id, html);
      patchUi(section.id, { applying: false, promptOpen: false, promptValue: '' });
    } catch (err) {
      patchUi(section.id, {
        applying:   false,
        applyError: err instanceof Error ? err.message : 'Edit failed',
      });
    }
  }, [apiKey, namespace, proposalId, sectionHtmls, sectionUi, patchHtml, patchUi]);

  // ── Feature 0: Full Microsite Regenerate ─────────────────────────────────
  const handleFullRegenerate = useCallback(async () => {
    if (!apiKey || regenState === 'generating') return;
    const ctrl = new AbortController();
    abortRegenRef.current = ctrl;
    setRegenState('generating');
    setPendingHtmls({});

    // Resolve the actual proposal ID — prefer ast.proposalId which is the server-side key
    const resolvedId = (ast as unknown as Record<string, unknown>).proposalId as string | undefined ?? proposalId;

    try {
      const res = await fetch(
        `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(resolvedId)}/generate-structured-stream`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({}),
          signal: ctrl.signal,
        },
      );
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: generation request failed`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';
      let receivedHtml = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          // Parse the SSE payload — skip truly malformed lines only
          let ev: Record<string, unknown>;
          try { ev = JSON.parse(line.slice(6)) as Record<string, unknown>; }
          catch { continue; }

          if (ev.type === 'error') {
            // Server-level error — propagate to outer catch, do NOT swallow
            throw new Error((ev.message as string | undefined) ?? 'Generation failed');
          }
          if (ev.type === 'section_html' && typeof ev.id === 'string' && typeof ev.customHtml === 'string') {
            receivedHtml = true;
            const sid  = ev.id as string;
            const html = ev.customHtml as string;
            // Update canvas immediately so the user sees each section render as it arrives
            patchHtml(sid, html);
            setPendingHtmls(prev => ({ ...prev, [sid]: html }));
          }
        }
      }

      if (!receivedHtml) throw new Error('Generation completed but no HTML was produced. Check the server logs.');
      setRegenState('done');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('[MicrositeEditorPro] full regen failed:', err);
        // Surface the error briefly so the user knows what went wrong
        alert(`Regeneration failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      setRegenState('idle');
      setPendingHtmls({});
    }
  }, [apiKey, ast, namespace, proposalId, regenState, patchHtml]);

  // Save all newly generated section HTMLs, overriding the existing content
  const handleSaveRegenerated = useCallback(async () => {
    if (!apiKey || Object.keys(pendingHtmls).length === 0 || saveState === 'saving') return;
    setSaveState('saving');

    // Build the final HTML map: new generation takes priority, fall back to current
    const merged = Object.fromEntries(
      ast.sections.map(s => [s.id, pendingHtmls[s.id] ?? sectionHtmls[s.id]?.html ?? getSectionHtml(s)]),
    );

    const updatedAst: LayoutAST = {
      ...ast,
      sections: ast.sections.map(s => ({ ...s, customHtml: merged[s.id] } as LayoutSection)),
    };

    try {
      await saveMicrositeAst(apiKey, namespace, proposalId, updatedAst);
      await publishMicrosite(apiKey, namespace, proposalId, updatedAst).catch(() => {});
      onSaved?.(updatedAst);
    } catch { /* best-effort */ }

    // Apply to all state slices so canvas reflects the saved result
    setSectionHtmls(Object.fromEntries(Object.entries(merged).map(([id, html]) => [id, { html }])));
    setSavedHtmls(merged);
    savedSnapshotRef.current = merged;
    setPendingHtmls({});
    setRegenState('idle');
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 3000);
  }, [apiKey, ast, namespace, proposalId, pendingHtmls, sectionHtmls, saveState, onSaved]);

  // ── Feature 2b: Per-section Save ─────────────────────────────────────────
  const handleSectionSave = useCallback(async (section: LayoutSection) => {
    if (!apiKey) return;
    patchUi(section.id, { saving: true });

    const currentHtmls = ast.sections.map(s => sectionHtmls[s.id]?.html ?? getSectionHtml(s));
    const updatedAst: LayoutAST = {
      ...ast,
      sections: ast.sections.map((s, i) => ({ ...s, customHtml: currentHtmls[i] } as LayoutSection)),
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
  }, [apiKey, ast, namespace, proposalId, sectionHtmls, onSaved, patchUi]);

  // ── Feature 3: Save ───────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    const currentHtmls = ast.sections.map(s => sectionHtmls[s.id]?.html ?? getSectionHtml(s));
    const fullHtml     = buildFullHtml(ast, currentHtmls);

    // Build a meaningful filename from client name + version
    const client  = (ast.meta?.client ?? ast.brand?.companyName ?? '').trim();
    const version = (proposalId as string).match(/[_\-v]v?(\d+)$/i)?.[1];
    const slug    = (client || proposalId.split('::').pop() || 'microsite')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const filename = `${slug}-microsite${version ? `-v${version}` : ''}.html`;

    triggerDownload(fullHtml, filename);
  }, [ast, proposalId, sectionHtmls]);

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

        {/* Full regenerate / save-changes button */}
        <button
          onClick={regenState === 'done' ? handleSaveRegenerated : handleFullRegenerate}
          disabled={regenState === 'generating'}
          title={regenState === 'done' ? 'Save the newly generated microsite' : 'Regenerate entire microsite from scratch'}
          style={{
            height: 34,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 14px',
            background: regenState === 'done'
              ? 'rgba(35,134,54,0.18)'
              : regenState === 'generating'
                ? 'rgba(99,110,123,0.15)'
                : 'transparent',
            border: `1px solid ${regenState === 'done' ? tok.success : tok.border}`,
            borderRadius: 7,
            cursor: regenState === 'generating' ? 'default' : 'pointer',
            color: regenState === 'done' ? tok.success : tok.muted,
            fontSize: 13,
            fontWeight: 600,
            opacity: regenState === 'generating' ? 0.6 : 1,
            transition: 'all 0.15s',
          }}
        >
          {regenState === 'generating'
            ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            : regenState === 'done'
              ? <Check size={14} />
              : <RotateCcw size={14} />}
          {regenState === 'generating' ? 'Generating…' : regenState === 'done' ? 'Save Changes' : 'Regenerate'}
        </button>

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
        <div style={{ width: SIDEBAR_W, flexShrink: 0, borderRight: `1px solid ${tok.border}`, overflowY: 'auto', background: tok.panel, display: 'flex', flexDirection: 'column' }}>

          <div style={{ padding: '10px 12px 6px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: tok.muted }}>
            Sections
          </div>

          {ast.sections.map(section => {
            const state    = sectionUi[section.id];
            const isActive = activeSectionId === section.id;
            const hasHtml  = !!sectionHtmls[section.id]?.html;

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
                    onClick={e => { e.stopPropagation(); patchUi(section.id, { promptOpen: !state?.promptOpen, applyError: null }); setActiveSectionId(section.id); }}
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

                {/* Inline AI prompt */}
                {state?.promptOpen && (
                  <div style={{ padding: '0 10px 10px' }}>
                    <textarea
                      value={state.promptValue}
                      onChange={e => patchUi(section.id, { promptValue: e.target.value })}
                      placeholder='"make the headline bigger", "change bg to dark blue"…'
                      disabled={state.applying}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleApplyPrompt(section);
                        if (e.key === 'Escape') patchUi(section.id, { promptOpen: false, promptValue: '', applyError: null });
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
                        onClick={() => patchUi(section.id, { promptOpen: false, promptValue: '', applyError: null })}
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
