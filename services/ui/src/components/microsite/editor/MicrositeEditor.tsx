'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { LayoutAST } from '../../../types/presentation';
import { EditProvider, useEditContext } from './EditContext';
import { Microsite } from '../Microsite';
import { DesignAgentPanel } from './DesignAgentPanel';
import { PublishModal } from './PublishModal';
import { ThemeModal } from '../ThemeModal';
import { ThemePreviewModal } from '../ThemePreviewModal';
import { SectionOutline } from './SectionOutline';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { resolveTokens, getPlugin, THEME_REGISTRY } from '../../../lib/presentation/pluginRegistry';
import type { PluginMeta } from '../../../types/presentation';

// Popular themes shown in quick picker (first 8)
const QUICK_THEMES = THEME_REGISTRY.slice(0, 8);

// ── Canvas — reads editedAst from context ─────────────────────────────────

function EditorCanvas({ onAiAction }: { onAiAction: (sectionId: string, instruction: string) => void }) {
  const ctx = useEditContext()!;
  const mergedTokens = ctx.ast.customTokens
    ? { ...(ctx.ast.customDesignSystem ?? {}), ...ctx.ast.customTokens }
    : undefined;
  // When the brand has extractedCssVariables (from a custom design prompt), skip
  // primaryColor so the extracted accent overrides the plugin default instead.
  const hasCssOverride = !!(ctx.ast.brand?.extractedCssVariables && Object.keys(ctx.ast.brand.extractedCssVariables).length > 0);
  const tokens = resolveTokens(
    ctx.ast.plugin,
    hasCssOverride ? '' : ctx.ast.brand.primaryColor,
    mergedTokens as Parameters<typeof resolveTokens>[2],
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: tokens.bg,
        position: 'relative',
      }}
    >
      <div style={{ position: 'relative', minHeight: '100%' }}>
        <Microsite ast={ctx.ast} mode="embedded" onSectionAiAction={onAiAction} />
      </div>
    </div>
  );
}

// ── Floating AI bar ────────────────────────────────────────────────────────

function FloatingAIBar({ onSubmit }: { onSubmit: (instruction: string) => void }) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit() {
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
    if (e.key === 'Escape') { setValue(''); inputRef.current?.blur(); }
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9000,
        width: 'min(520px, calc(100% - 48px))',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: focused ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(16px)',
        border: focused ? '1.5px solid #6366f1' : '1.5px solid rgba(226,232,240,0.9)',
        borderRadius: 12,
        padding: '8px 12px',
        boxShadow: focused
          ? '0 0 0 3px rgba(99,102,241,0.12), 0 8px 32px rgba(0,0,0,0.14)'
          : '0 4px 20px rgba(0,0,0,0.12)',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <span style={{ fontSize: 14, color: '#6366f1', flexShrink: 0 }}>✦</span>
      <input
        id="mse-floating-ai-input"
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Ask AI to redesign, restyle, or rewrite… (⌘K)"
        style={{
          flex: 1,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 13,
          color: '#1e293b',
          fontFamily: 'inherit',
        }}
      />
      {value.trim() && (
        <button
          onClick={handleSubmit}
          style={{
            padding: '4px 10px',
            borderRadius: 7,
            border: 'none',
            background: '#6366f1',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          →
        </button>
      )}
    </div>
  );
}

// ── Quick theme panel ──────────────────────────────────────────────────────

function QuickThemePanel({
  currentPlugin,
  onSelect,
  onBrowseAll,
  onClose,
}: {
  currentPlugin: string;
  onSelect: (id: string) => void;
  onBrowseAll: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        zIndex: 30000,
        marginTop: 6,
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
        border: '1px solid #e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        width: 320,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#1e293b' }}>
          Quick Theme Switch
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
          Click any theme to apply instantly
        </p>
      </div>

      <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {QUICK_THEMES.map(theme => {
          const isActive = theme.id === currentPlugin;
          const c = theme.previewColors;
          return (
            <button
              key={theme.id}
              title={theme.label}
              onClick={() => { onSelect(theme.id); onClose(); }}
              style={{
                borderRadius: 8,
                border: isActive ? '2px solid #6366f1' : '2px solid transparent',
                padding: 0,
                cursor: 'pointer',
                overflow: 'hidden',
                background: c.background,
                position: 'relative',
                aspectRatio: '1',
                transition: 'transform 0.1s, border-color 0.15s',
              }}
            >
              {/* Mini preview */}
              <div style={{ position: 'absolute', inset: 0, padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ height: 3, width: '60%', background: c.accent, borderRadius: 2, opacity: 0.9 }} />
                <div style={{ height: 2, width: '85%', background: c.text, borderRadius: 2, opacity: 0.3 }} />
                <div style={{ height: 2, width: '65%', background: c.text, borderRadius: 2, opacity: 0.2 }} />
                <div style={{ marginTop: 'auto', display: 'flex', gap: 2 }}>
                  <div style={{ flex: 1, height: 10, background: c.surface, borderRadius: 2, border: `1px solid ${c.border}` }} />
                  <div style={{ flex: 1, height: 10, background: c.surface, borderRadius: 2, border: `1px solid ${c.border}` }} />
                </div>
              </div>
              {/* Active check */}
              {isActive && (
                <div style={{
                  position: 'absolute', top: 3, right: 3,
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#6366f1', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 8, color: '#fff',
                }}>✓</div>
              )}
              {/* Color strip at bottom */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, display: 'flex' }}>
                <div style={{ flex: 1, background: c.accent }} />
                <div style={{ flex: 1, background: c.text, opacity: 0.4 }} />
                <div style={{ flex: 1, background: c.surface }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* Theme labels */}
      <div style={{ padding: '0 10px 6px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {QUICK_THEMES.map(theme => (
          <p
            key={theme.id}
            style={{
              margin: 0,
              fontSize: 9,
              textAlign: 'center',
              color: theme.id === currentPlugin ? '#6366f1' : '#94a3b8',
              fontWeight: theme.id === currentPlugin ? 700 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {theme.label.split(' ')[0]}
          </p>
        ))}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid #e2e8f0' }}>
        <button
          onClick={() => { onClose(); onBrowseAll(); }}
          style={{
            width: '100%',
            padding: '8px',
            borderRadius: 7,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            color: '#475569',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          Browse all {THEME_REGISTRY.length} themes →
        </button>
      </div>
    </div>
  );
}

// ── Inner editor (inside provider) ────────────────────────────────────────

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_OPTIONS: { id: Viewport; label: string; icon: string; width: string }[] = [
  { id: 'desktop', label: 'Desktop', icon: '🖥', width: '100%' },
  { id: 'tablet',  label: 'Tablet',  icon: '💻', width: '768px' },
  { id: 'mobile',  label: 'Mobile',  icon: '📱', width: '375px' },
];

interface InnerProps {
  onClose: () => void;
  onExport: (editedAst: LayoutAST) => void;
  namespace: string;
  proposalId: string;
}

function EditorInner({ onClose, onExport, namespace, proposalId }: InnerProps) {
  const ctx = useEditContext()!;
  const [showDesignPanel, setShowDesignPanel] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [previewPlugin, setPreviewPlugin] = useState<PluginMeta | null>(null);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [panelInstruction, setPanelInstruction] = useState('');
  const [panelTargetSectionId, setPanelTargetSectionId] = useState<string | undefined>(undefined);
  const [showOutline, setShowOutline] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null);
  const savedAstRef = useRef<string>(JSON.stringify(ctx.ast));
  const themeBtnRef = useRef<HTMLDivElement>(null);

  const currentTheme = THEME_REGISTRY.find(t => t.id === ctx.ast.plugin);

  // Track dirty state
  useEffect(() => {
    const current = JSON.stringify(ctx.ast);
    setIsDirty(current !== savedAstRef.current);
  }, [ctx.ast]);

  // Auto-save every 60s when dirty
  useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      onExport(ctx.ast);
      savedAstRef.current = JSON.stringify(ctx.ast);
      setIsDirty(false);
      const now = new Date();
      setLastSavedLabel(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [isDirty, ctx.ast, onExport]);

  // Warn on accidental navigation when dirty
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Use a ref so the stable handleKeyDown callback always calls the latest ctx
  // without re-attaching the listener on every render.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const showPaletteRef = useRef(showPalette);
  showPaletteRef.current = showPalette;

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    // Cmd+K — command palette
    if (e.key === 'k') { e.preventDefault(); showPaletteRef.current ? setShowPalette(false) : setShowPalette(true); return; }

    // Undo / Redo
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); ctxRef.current.undo(); return; }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); ctxRef.current.redo(); return; }

    // Section shortcuts — only when a section is active
    const activeId = ctxRef.current.activeSectionId;
    if (!activeId) return;
    const sections = ctxRef.current.ast.sections;
    const idx = sections.findIndex(s => s.id === activeId);
    if (idx === -1) return;

    // Ctrl+D — duplicate
    if (e.key === 'd') { e.preventDefault(); ctxRef.current.duplicateSection(activeId); return; }

    // Ctrl+↑ — move up
    if (e.key === 'ArrowUp' && idx > 0) { e.preventDefault(); ctxRef.current.moveArrayItem('__sections__', '__sections__', idx, idx - 1); return; }

    // Ctrl+↓ — move down
    if (e.key === 'ArrowDown' && idx < sections.length - 1) { e.preventDefault(); ctxRef.current.moveArrayItem('__sections__', '__sections__', idx, idx + 1); return; }

    // Ctrl+Delete — delete section (guard: at least 2 sections)
    if (e.key === 'Delete' && sections.length > 1) {
      e.preventDefault();
      if (confirm(`Delete "${sections[idx].sectionType}" section? This can be undone with Ctrl+Z.`)) {
        ctxRef.current.removeSection(activeId);
      }
    }
  }, []);

  // Ctrl+S save shortcut
  const handleSaveShortcut = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      onExport(ctxRef.current.ast);
      savedAstRef.current = JSON.stringify(ctxRef.current.ast);
      setIsDirty(false);
      setLastSavedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }
  }, [onExport]);

  useEffect(() => {
    document.addEventListener('keydown', handleSaveShortcut);
    return () => document.removeEventListener('keydown', handleSaveShortcut);
  }, [handleSaveShortcut]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Consume pendingSectionAI from context (set by SectionEditOverlay AI buttons)
  useEffect(() => {
    if (!ctx.pendingSectionAI) return;
    const { sectionId, instruction } = ctx.pendingSectionAI;
    setPanelInstruction(instruction);
    setPanelTargetSectionId(sectionId);
    setShowDesignPanel(true);
    ctx.clearSectionAITrigger();
  }, [ctx.pendingSectionAI, ctx]);

  const handleSectionAiAction = useCallback((sectionId: string, instruction: string) => {
    setPanelInstruction(instruction);
    setPanelTargetSectionId(sectionId);
    setShowDesignPanel(true);
  }, []);

  // Build command palette commands
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const activeId = ctx.activeSectionId;
    const sections = ctx.ast.sections;
    const idx = activeId ? sections.findIndex(s => s.id === activeId) : -1;

    const cmds: PaletteCommand[] = [
      { id: 'undo',    label: 'Undo',              icon: '↩', shortcut: 'Ctrl+Z',      action: () => ctx.undo(),  description: ctx.canUndo ? 'Revert last change' : 'Nothing to undo' },
      { id: 'redo',    label: 'Redo',              icon: '↪', shortcut: 'Ctrl+Y',      action: () => ctx.redo(),  description: ctx.canRedo ? 'Re-apply last change' : 'Nothing to redo' },
      { id: 'outline', label: 'Toggle Outline',    icon: '☰', action: () => setShowOutline(v => !v), description: 'Show/hide section navigator' },
      { id: 'design',  label: 'Open Design AI',    icon: '✦', action: () => setShowDesignPanel(true), description: 'AI-powered design editing' },
      { id: 'publish', label: 'Publish / Export',  icon: '↑', action: () => setShowPublishModal(true) },
      { id: 'save',    label: 'Save',              icon: '💾', shortcut: 'Ctrl+S',      action: () => { onExport(ctx.ast); savedAstRef.current = JSON.stringify(ctx.ast); setIsDirty(false); setLastSavedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); } },
      { id: 'theme',   label: 'Browse Themes',     icon: '🎨', action: () => setShowThemeModal(true) },
      ...VIEWPORT_OPTIONS.map(opt => ({
        id: `viewport-${opt.id}`,
        label: `Viewport: ${opt.label}`,
        icon: opt.icon,
        action: () => setViewport(opt.id),
      })),
    ];

    if (activeId && idx !== -1) {
      cmds.push(
        { id: 'duplicate', label: 'Duplicate Section',  icon: '⊕', shortcut: 'Ctrl+D',      action: () => ctx.duplicateSection(activeId), description: `Duplicate "${sections[idx].sectionType}"` },
        { id: 'move-up',   label: 'Move Section Up',    icon: '↑',  shortcut: 'Ctrl+↑',      action: () => { if (idx > 0) ctx.moveArrayItem('__sections__', '__sections__', idx, idx - 1); } },
        { id: 'move-down', label: 'Move Section Down',  icon: '↓',  shortcut: 'Ctrl+↓',      action: () => { if (idx < sections.length - 1) ctx.moveArrayItem('__sections__', '__sections__', idx, idx + 1); } },
        { id: 'delete',    label: 'Delete Section',     icon: '✕',  shortcut: 'Ctrl+Delete',  action: () => { if (sections.length > 1 && confirm(`Delete section?`)) ctx.removeSection(activeId); } },
        { id: 'lock',      label: ctx.lockedSections.has(activeId) ? 'Unlock Section' : 'Lock Section', icon: '🔒', action: () => ctx.lockedSections.has(activeId) ? ctx.unlockSection(activeId) : ctx.lockSection(activeId) },
      );
    }

    return cmds;
  }, [ctx, onExport]);

  function handleThemeSelect(id: string) {
    ctx.replaceAst({
      ...ctx.ast,
      plugin: id,
      // Clear all custom token/design overrides so the new theme renders cleanly
      customTokens: undefined,
      customDesignSystem: undefined,
      customCharacter: undefined,
      customFonts: undefined,
      // Also clear CSS variable overrides — these override tokens in Microsite.tsx
      // regardless of plugin, so they must be wiped when switching themes
      brand: {
        ...ctx.ast.brand,
        extractedCssVariables: undefined,
        googleFontsUrl: undefined,
        overrideTheme: undefined,
      },
    });
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        background: '#f1f5f9',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <style>{`
        .mse-topbar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 16px; height: 48px;
          background: #fff; border-bottom: 1px solid #e2e8f0;
          flex-shrink: 0; gap: 12px;
        }
        .mse-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .mse-right { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
        .mse-title { font-size: 12px; font-weight: 700; color: #1e293b; white-space: nowrap; }
        .mse-badge { font-size: 11px; color: #94a3b8; background: #f1f5f9; padding: 2px 8px; border-radius: 10px; white-space: nowrap; }
        .mse-viewport-toggle { display: flex; gap: 1px; background: #f1f5f9; border-radius: 7px; padding: 2px; margin-right: 4px; }
        .mse-btn-label { display: inline; }
        .mse-back-btn { padding: 5px 10px; border-radius: 6px; border: 1px solid #e2e8f0; background: #fff; font-size: 12px; font-weight: 600; cursor: pointer; color: #64748b; white-space: nowrap; }
        .mse-action-btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
        .mse-theme-btn { padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; }
        @media (max-width: 600px) {
          .mse-topbar { height: auto; padding: 6px 10px; gap: 6px; flex-wrap: wrap; }
          .mse-right { gap: 4px; }
          .mse-title { font-size: 11px; }
          .mse-badge { display: none; }
          .mse-viewport-toggle { display: none; }
          .mse-btn-label { display: none; }
          .mse-back-btn { padding: 5px 8px; font-size: 11px; }
          .mse-action-btn { padding: 5px 8px; font-size: 11px; }
          .mse-theme-btn { padding: 5px 8px; font-size: 11px; }
        }
      `}</style>

      {/* Top bar */}
      <div className="mse-topbar">
        {/* Left: back + outline toggle + title + live badge */}
        <div className="mse-left">
          <button className="mse-back-btn" onClick={onClose}>← <span className="mse-btn-label">Back</span></button>
          <button
            className="mse-back-btn"
            onClick={() => setShowOutline(v => !v)}
            title="Toggle section outline (☰)"
            style={{ background: showOutline ? '#f5f3ff' : '#fff', color: showOutline ? '#6366f1' : '#64748b' }}
          >☰</button>
          <span className="mse-title">Microsite Editor</span>
          <span className="mse-badge">Live Preview</span>
          {isDirty && (
            <span
              title="Unsaved changes — auto-saves in 60s"
              style={{
                width: 8, height: 8, borderRadius: '50%', background: '#f59e0b',
                display: 'inline-block', flexShrink: 0,
                boxShadow: '0 0 0 2px rgba(245,158,11,0.2)',
              }}
            />
          )}
          {lastSavedLabel && !isDirty && (
            <span style={{ fontSize: 10, color: '#94a3b8' }}>Saved {lastSavedLabel}</span>
          )}
        </div>

        {/* Right: action buttons */}
        <div className="mse-right">

          {/* Viewport toggle */}
          <div className="mse-viewport-toggle">
            {VIEWPORT_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => setViewport(opt.id)}
                title={opt.label}
                style={{
                  width: 28, height: 26,
                  borderRadius: 5,
                  border: 'none',
                  background: viewport === opt.id ? '#fff' : 'transparent',
                  color: viewport === opt.id ? '#6366f1' : '#94a3b8',
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: viewport === opt.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s',
                }}
              >{opt.icon}</button>
            ))}
          </div>

          {/* Undo / Redo */}
          <div style={{ display: 'flex', gap: 2, marginRight: 4 }}>
            {[
              { label: '↩', title: 'Undo (Ctrl+Z)', action: () => ctx.undo(), enabled: ctx.canUndo },
              { label: '↪', title: 'Redo (Ctrl+Y)', action: () => ctx.redo(), enabled: ctx.canRedo },
            ].map(({ label, title, action, enabled }) => (
              <button
                key={label}
                onClick={action}
                disabled={!enabled}
                title={title}
                style={{
                  width: 30, height: 30, borderRadius: 6,
                  border: '1px solid #e2e8f0',
                  background: '#fff',
                  color: enabled ? '#475569' : '#cbd5e1',
                  fontSize: 14, fontWeight: 700,
                  cursor: enabled ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'color 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Theme switcher */}
          <div ref={themeBtnRef} style={{ position: 'relative' }}>
            <button
              className="mse-theme-btn"
              onClick={() => setShowThemePanel(v => !v)}
              style={{
                border: '1px solid #e2e8f0',
                background: showThemePanel ? '#f5f3ff' : '#fff',
                color: showThemePanel ? '#6366f1' : '#475569',
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 14 }}>🎨</span>
              <span className="mse-btn-label">Theme</span>
              {currentTheme && (
                <span
                  style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: currentTheme.previewColors.accent,
                    display: 'inline-block',
                    flexShrink: 0,
                    boxShadow: '0 0 0 1px #e2e8f0',
                  }}
                />
              )}
            </button>

            {showThemePanel && (
              <QuickThemePanel
                currentPlugin={ctx.ast.plugin}
                onSelect={handleThemeSelect}
                onBrowseAll={() => setShowThemeModal(true)}
                onClose={() => setShowThemePanel(false)}
              />
            )}
          </div>

          <button
            className="mse-action-btn"
            onClick={() => setShowDesignPanel(v => !v)}
            style={{
              border: '1px solid #e2e8f0',
              background: showDesignPanel ? '#6366f1' : '#fff',
              color: showDesignPanel ? '#fff' : '#475569',
            }}
          >
            ✦ <span className="mse-btn-label">Design </span>AI
          </button>
          {/* Cmd+K palette trigger */}
          <button
            className="mse-action-btn"
            onClick={() => setShowPalette(true)}
            title="Command palette (Ctrl+K)"
            style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#475569' }}
          >
            ⌕ <span className="mse-btn-label">Commands</span>
          </button>
          <button
            className="mse-action-btn"
            onClick={() => setShowPublishModal(true)}
            style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#475569' }}
          >
            ↑ <span className="mse-btn-label">Publish</span>
          </button>
          <button
            className="mse-action-btn"
            onClick={() => {
              onExport(ctx.ast);
              savedAstRef.current = JSON.stringify(ctx.ast);
              setIsDirty(false);
              setLastSavedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }}
            style={{
              border: 'none',
              background: isDirty ? '#6366f1' : '#e2e8f0',
              color: isDirty ? '#fff' : '#94a3b8',
              transition: 'background 0.2s, color 0.2s',
            }}
          >
            {isDirty ? 'Save●' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Canvas + optional outline panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

        {/* Left: Section outline */}
        {showOutline && (
          <SectionOutline onClose={() => setShowOutline(false)} />
        )}

        {/* Right: viewport-simulated canvas */}
        <div style={{
          flex: 1,
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          background: viewport !== 'desktop' ? '#e2e8f0' : '#f1f5f9',
          transition: 'background 0.2s',
          padding: viewport !== 'desktop' ? '16px 0' : 0,
          position: 'relative',
        }}>
          <div style={{
            width: VIEWPORT_OPTIONS.find(v => v.id === viewport)?.width ?? '100%',
            maxWidth: viewport === 'desktop' ? '100%' : undefined,
            height: viewport !== 'desktop' ? 'calc(100% - 0px)' : '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            boxShadow: viewport !== 'desktop' ? '0 4px 32px rgba(0,0,0,0.22)' : 'none',
            borderRadius: viewport !== 'desktop' ? 12 : 0,
            transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
            flexShrink: 0,
          }}>
            <EditorCanvas onAiAction={handleSectionAiAction} />
          </div>
        </div>
      </div>

      {/* Publish modal */}
      {showPublishModal && (
        <PublishModal
          ast={ctx.ast}
          namespace={namespace}
          proposalId={proposalId}
          onClose={() => setShowPublishModal(false)}
        />
      )}

      {/* Design AI panel */}
      {showDesignPanel && (
        <DesignAgentPanel
          ast={ctx.ast}
          namespace={namespace}
          proposalId={proposalId}
          targetSectionId={panelTargetSectionId}
          initialInstruction={panelInstruction}
          onApply={(newAst) => { ctx.replaceAst(newAst); }}
          onClose={() => {
            setShowDesignPanel(false);
            setPanelInstruction('');
            setPanelTargetSectionId(undefined);
          }}
        />
      )}

      {/* Full theme modal */}
      {showThemeModal && (
        <ThemeModal
          selectedPlugin={ctx.ast.plugin}
          onSelect={id => { if (id) { handleThemeSelect(id); setShowThemeModal(false); } }}
          onPreview={id => { try { setPreviewPlugin(getPlugin(id)); } catch { /* unknown id */ } }}
          onClose={() => setShowThemeModal(false)}
        />
      )}

      {/* Theme full preview */}
      {previewPlugin && (
        <ThemePreviewModal
          plugin={previewPlugin}
          brand={ctx.ast.brand}
          onClose={() => setPreviewPlugin(null)}
          onApply={() => {
            handleThemeSelect(previewPlugin.id);
            setPreviewPlugin(null);
            setShowThemeModal(false);
          }}
        />
      )}

      {/* Command palette */}
      {showPalette && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setShowPalette(false)}
        />
      )}
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  onClose: () => void;
  onExport?: (editedAst: LayoutAST) => void;
}

export function MicrositeEditor({ ast, namespace, proposalId, onClose, onExport }: Props) {
  const [editedAst, setEditedAst] = useState<LayoutAST>(() => JSON.parse(JSON.stringify(ast)) as LayoutAST);

  const handleExport = (ea: LayoutAST) => {
    setEditedAst(ea);
    onExport?.(ea);
  };

  return (
    <EditProvider initialAst={ast} onChange={setEditedAst}>
      <EditorInner
        onClose={onClose}
        onExport={handleExport}
        namespace={namespace}
        proposalId={proposalId}
      />
    </EditProvider>
  );
}
