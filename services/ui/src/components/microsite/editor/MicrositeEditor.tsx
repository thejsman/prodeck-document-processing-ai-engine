'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { EditProvider, useEditContext, EditContextBlocker } from './EditContext';
import { Microsite } from '../Microsite';
import { DesignAgentPanel } from './DesignAgentPanel';
import { PublishModal } from './PublishModal';
import { ThemeModal } from '../ThemeModal';
import { ThemePreviewModal } from '../ThemePreviewModal';
import { SectionOutline } from './SectionOutline';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { TypographyPicker } from './TypographyPicker';
import { ColorPaletteEditor } from './ColorPaletteEditor';
import { resolveTokens, getPlugin, THEME_REGISTRY } from '../../../lib/presentation/pluginRegistry';
import type { LayoutAST, PluginMeta } from '../../../types/presentation';

// Popular themes shown in quick picker (first 8)
const QUICK_THEMES = THEME_REGISTRY.slice(0, 8);

// ── SVG icon primitives ────────────────────────────────────────────────────
const Icon = {
  back: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  ),
  outline: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="18" y2="18" />
    </svg>
  ),
  undo: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  ),
  redo: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  ),
  desktop: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  tablet: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  ),
  mobile: (
    <svg
      width="14"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  ),
  theme: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  ),
  ai: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
    </svg>
  ),
  publish: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  save: (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  type: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
  palette: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  ),
  history: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.95" />
    </svg>
  ),
  eye: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ),
};

// ── Canvas — reads editedAst from context ─────────────────────────────────

function EditorCanvas({
  onAiAction,
  previewAst,
  aiRunning,
}: {
  onAiAction: (sectionId: string, instruction: string) => void;
  previewAst?: LayoutAST;
  aiRunning?: boolean;
}) {
  const ctx = useEditContext()!;
  const activeAst = previewAst ?? ctx.ast;
  const mergedTokens = activeAst.customTokens
    ? { ...(activeAst.customDesignSystem ?? {}), ...activeAst.customTokens }
    : undefined;
  // When the brand has extractedCssVariables (from a custom design prompt), skip
  // primaryColor so the extracted accent overrides the plugin default instead.
  const hasCssOverride = !!(
    activeAst.brand?.extractedCssVariables && Object.keys(activeAst.brand.extractedCssVariables).length > 0
  );
  const tokens = resolveTokens(
    activeAst.plugin,
    hasCssOverride ? '' : (activeAst.brand?.primaryColor ?? ''),
    mergedTokens as Parameters<typeof resolveTokens>[2],
  );

  return (
    <div
      id="ms-editor-scroll"
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: tokens.bg,
        position: 'relative',
      }}
    >
      {aiRunning && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          background: 'rgba(13,17,23,0.55)', backdropFilter: 'blur(4px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            border: '3px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600, letterSpacing: '0.04em' }}>
            ✦ AI is redesigning…
          </span>
        </div>
      )}
      {previewAst && !aiRunning && (
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            background: 'rgba(99,102,241,0.92)',
            backdropFilter: 'blur(8px)',
            color: '#fff',
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 700,
            padding: '7px 14px',
            letterSpacing: '0.04em',
          }}
        >
          ✦ Previewing AI changes — click <em>Apply</em> to keep, or <em>Revert</em> to undo
        </div>
      )}
      <div style={{ position: 'relative', minHeight: '100%' }}>
        <Microsite ast={activeAst} mode="embedded" onSectionAiAction={onAiAction} />
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
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      setValue('');
      inputRef.current?.blur();
    }
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
        onChange={(e) => setValue(e.target.value)}
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
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Quick Theme Switch</p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>Click any theme to apply instantly</p>
      </div>

      <div style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {QUICK_THEMES.map((theme) => {
          const isActive = theme.id === currentPlugin;
          const c = theme.previewColors;
          return (
            <button
              key={theme.id}
              title={theme.label}
              onClick={() => {
                onSelect(theme.id);
                onClose();
              }}
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
              <div
                style={{ position: 'absolute', inset: 0, padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <div style={{ height: 3, width: '60%', background: c.accent, borderRadius: 2, opacity: 0.9 }} />
                <div style={{ height: 2, width: '85%', background: c.text, borderRadius: 2, opacity: 0.3 }} />
                <div style={{ height: 2, width: '65%', background: c.text, borderRadius: 2, opacity: 0.2 }} />
                <div style={{ marginTop: 'auto', display: 'flex', gap: 2 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 10,
                      background: c.surface,
                      borderRadius: 2,
                      border: `1px solid ${c.border}`,
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      height: 10,
                      background: c.surface,
                      borderRadius: 2,
                      border: `1px solid ${c.border}`,
                    }}
                  />
                </div>
              </div>
              {/* Active check */}
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    top: 3,
                    right: 3,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: '#6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 8,
                    color: '#fff',
                  }}
                >
                  ✓
                </div>
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
        {QUICK_THEMES.map((theme) => (
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
          onClick={() => {
            onClose();
            onBrowseAll();
          }}
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

const VIEWPORT_OPTIONS: { id: Viewport; label: string; icon: React.ReactNode; width: string }[] = [
  { id: 'desktop', label: 'Desktop', icon: Icon.desktop, width: '100%' },
  { id: 'tablet', label: 'Tablet', icon: Icon.tablet, width: '768px' },
  { id: 'mobile', label: 'Mobile', icon: Icon.mobile, width: '375px' },
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
  const [panelInitialTab, setPanelInitialTab] = useState<'design' | 'content'>('design');
  const [showOutline, setShowOutline] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedLabel, setLastSavedLabel] = useState<string | null>(null);
  const [previewAst, setPreviewAst] = useState<LayoutAST | null>(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [showTypography, setShowTypography] = useState(false);
  const [showColorPalette, setShowColorPalette] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const savedAstRef = useRef<string>(JSON.stringify(ctx.ast));
  const themeBtnRef = useRef<HTMLDivElement>(null);
  const typoBtnRef = useRef<HTMLDivElement>(null);
  const colorBtnRef = useRef<HTMLDivElement>(null);

  const hasCssOverride = !!(ctx.ast.brand?.extractedCssVariables && Object.keys(ctx.ast.brand.extractedCssVariables).length > 0);
  const mergedTokens = ctx.ast.customTokens ? { ...(ctx.ast.customDesignSystem ?? {}), ...ctx.ast.customTokens } : undefined;
  const resolvedTokens = resolveTokens(
    ctx.ast.plugin,
    hasCssOverride ? '' : (ctx.ast.brand?.primaryColor ?? ''),
    mergedTokens as Parameters<typeof resolveTokens>[2],
  );

  const currentTheme = THEME_REGISTRY.find((t) => t.id === ctx.ast.plugin);

  // Deselect active section when Design AI panel opens
  useEffect(() => {
    if (showDesignPanel) ctx.selectSection('');
  }, [showDesignPanel]);

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
      setLastSavedLabel(
        `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`,
      );
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
    if (e.key === 'k') {
      e.preventDefault();
      showPaletteRef.current ? setShowPalette(false) : setShowPalette(true);
      return;
    }

    // Cmd+Shift+P — preview mode toggle
    if (e.key === 'p' && e.shiftKey) {
      e.preventDefault();
      setPreviewMode(v => !v);
      return;
    }

    // Undo / Redo
    if (e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      ctxRef.current.undo();
      return;
    }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
      e.preventDefault();
      ctxRef.current.redo();
      return;
    }

    // Section shortcuts — only when a section is active
    const activeId = ctxRef.current.activeSectionId;
    if (!activeId) return;
    const sections = ctxRef.current.ast.sections;
    const idx = sections.findIndex((s) => s.id === activeId);
    if (idx === -1) return;

    // Ctrl+D — duplicate
    if (e.key === 'd') {
      e.preventDefault();
      ctxRef.current.duplicateSection(activeId);
      return;
    }

    // Ctrl+↑ — move up
    if (e.key === 'ArrowUp' && idx > 0) {
      e.preventDefault();
      ctxRef.current.moveArrayItem('__sections__', '__sections__', idx, idx - 1);
      return;
    }

    // Ctrl+↓ — move down
    if (e.key === 'ArrowDown' && idx < sections.length - 1) {
      e.preventDefault();
      ctxRef.current.moveArrayItem('__sections__', '__sections__', idx, idx + 1);
      return;
    }

    // Ctrl+Delete — delete section (guard: at least 2 sections)
    if (e.key === 'Delete' && sections.length > 1) {
      e.preventDefault();
      if (confirm(`Delete "${sections[idx].sectionType}" section? This can be undone with Ctrl+Z.`)) {
        ctxRef.current.removeSection(activeId);
      }
    }
  }, []);

  // Ctrl+S save shortcut
  const handleSaveShortcut = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onExport(ctxRef.current.ast);
        savedAstRef.current = JSON.stringify(ctxRef.current.ast);
        setIsDirty(false);
        setLastSavedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      }
    },
    [onExport],
  );

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
    setPanelInitialTab('content');
    setShowDesignPanel(true);
    ctx.clearSectionAITrigger();
  }, [ctx.pendingSectionAI, ctx]);

  const handleSectionAiAction = useCallback((sectionId: string, instruction: string) => {
    setPanelInstruction(instruction);
    setPanelTargetSectionId(sectionId);
    setPanelInitialTab('content');
    setShowDesignPanel(true);
  }, []);

  // Build command palette commands
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const activeId = ctx.activeSectionId;
    const sections = ctx.ast.sections;
    const idx = activeId ? sections.findIndex((s) => s.id === activeId) : -1;

    const cmds: PaletteCommand[] = [
      {
        id: 'undo',
        label: 'Undo',
        icon: '↩',
        shortcut: 'Ctrl+Z',
        action: () => ctx.undo(),
        description: ctx.canUndo ? 'Revert last change' : 'Nothing to undo',
      },
      {
        id: 'redo',
        label: 'Redo',
        icon: '↪',
        shortcut: 'Ctrl+Y',
        action: () => ctx.redo(),
        description: ctx.canRedo ? 'Re-apply last change' : 'Nothing to redo',
      },
      {
        id: 'outline',
        label: 'Toggle Outline',
        icon: '☰',
        action: () => setShowOutline((v) => !v),
        description: 'Show/hide section navigator',
      },
      {
        id: 'design',
        label: 'Open Design AI',
        icon: '✦',
        action: () => { setPanelInitialTab('design'); setPanelTargetSectionId(undefined); setShowDesignPanel(true); },
        description: 'AI-powered design editing',
      },
      { id: 'publish', label: 'Publish / Export', icon: '↑', action: () => setShowPublishModal(true) },
      {
        id: 'save',
        label: 'Save',
        icon: '💾',
        shortcut: 'Ctrl+S',
        action: () => {
          onExport(ctx.ast);
          savedAstRef.current = JSON.stringify(ctx.ast);
          setIsDirty(false);
          setLastSavedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        },
      },
      { id: 'theme', label: 'Browse Themes', icon: '🎨', action: () => setShowThemeModal(true) },
      { id: 'typography', label: 'Typography — Font Pairs', icon: 'Aa', action: () => setShowTypography(true) },
      { id: 'colors', label: 'Edit Color Palette', icon: '🎨', action: () => setShowColorPalette(true) },
      { id: 'preview', label: previewMode ? 'Exit Preview Mode' : 'Preview Mode (hide editor UI)', icon: '👁', shortcut: 'Ctrl+Shift+P', action: () => setPreviewMode(v => !v) },
      ...VIEWPORT_OPTIONS.map((opt) => ({
        id: `viewport-${opt.id}`,
        label: `Viewport: ${opt.label}`,
        icon: opt.id === 'desktop' ? '⬜' : opt.id === 'tablet' ? '▭' : '▯',
        action: () => setViewport(opt.id),
      })),
    ];

    if (activeId && idx !== -1) {
      cmds.push(
        {
          id: 'duplicate',
          label: 'Duplicate Section',
          icon: '⊕',
          shortcut: 'Ctrl+D',
          action: () => ctx.duplicateSection(activeId),
          description: `Duplicate "${sections[idx].sectionType}"`,
        },
        {
          id: 'move-up',
          label: 'Move Section Up',
          icon: '↑',
          shortcut: 'Ctrl+↑',
          action: () => {
            if (idx > 0) ctx.moveArrayItem('__sections__', '__sections__', idx, idx - 1);
          },
        },
        {
          id: 'move-down',
          label: 'Move Section Down',
          icon: '↓',
          shortcut: 'Ctrl+↓',
          action: () => {
            if (idx < sections.length - 1) ctx.moveArrayItem('__sections__', '__sections__', idx, idx + 1);
          },
        },
        {
          id: 'delete',
          label: 'Delete Section',
          icon: '✕',
          shortcut: 'Ctrl+Delete',
          action: () => {
            if (sections.length > 1 && confirm(`Delete section?`)) ctx.removeSection(activeId);
          },
        },
        {
          id: 'lock',
          label: ctx.lockedSections.has(activeId) ? 'Unlock Section' : 'Lock Section',
          icon: '🔒',
          action: () => (ctx.lockedSections.has(activeId) ? ctx.unlockSection(activeId) : ctx.lockSection(activeId)),
        },
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
      }}
    >
      <style>{`
        .mse-bar {
          display: flex; align-items: center;
          padding: 0 16px; height: 52px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          flex-shrink: 0; gap: 0;
          user-select: none;
        }
        .mse-group { display: flex; align-items: center; gap: 2px; }
        .mse-sep { width: 1px; height: 22px; background: #e2e8f0; margin: 0 10px; flex-shrink: 0; }
        .mse-spacer { flex: 1; }

        /* Icon-only button */
        .mse-icon-btn {
          display: flex; align-items: center; justify-content: center;
          width: 34px; height: 34px; border-radius: 7px;
          border: none; background: transparent; cursor: pointer;
          color: #64748b; transition: background 0.12s, color 0.12s;
        }
        .mse-icon-btn:hover:not(:disabled) { background: #f1f5f9; color: #1e293b; }
        .mse-icon-btn:disabled { color: #cbd5e1; cursor: not-allowed; }
        .mse-icon-btn.active { background: #eef2ff; color: #6366f1; }

        /* Label button */
        .mse-label-btn {
          display: flex; align-items: center; gap: 7px;
          padding: 0 13px; height: 34px; border-radius: 7px;
          border: 1px solid #e2e8f0; background: #fff; cursor: pointer;
          font-size: 13px; font-weight: 600; color: #475569;
          white-space: nowrap; transition: background 0.12s, color 0.12s, border-color 0.12s;
        }
        .mse-label-btn:hover { background: #f8fafc; border-color: #cbd5e1; color: #1e293b; }
        .mse-label-btn.active { background: #eef2ff; border-color: #c7d2fe; color: #6366f1; }

        /* Viewport segment */
        .mse-viewport { display: flex; gap: 1px; background: #f1f5f9; border-radius: 8px; padding: 3px; }
        .mse-vp-btn {
          display: flex; align-items: center; justify-content: center;
          width: 32px; height: 28px; border-radius: 5px;
          border: none; background: transparent; cursor: pointer;
          color: #94a3b8; transition: all 0.12s;
        }
        .mse-vp-btn.active { background: #fff; color: #6366f1; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .mse-vp-btn:not(.active):hover { color: #475569; }

        /* Primary CTA */
        .mse-cta {
          display: flex; align-items: center; gap: 7px;
          padding: 0 16px; height: 34px; border-radius: 7px;
          border: none; background: #6366f1; cursor: pointer;
          font-size: 13px; font-weight: 700; color: #fff;
          white-space: nowrap; transition: background 0.15s;
        }
        .mse-cta:hover { background: #4f46e5; }
        .mse-cta.muted { background: #f1f5f9; color: #94a3b8; cursor: default; }

        /* App name */
        .mse-appname {
          font-size: 13px; font-weight: 700; color: #1e293b; letter-spacing: -0.01em;
        }
        .mse-breadcrumb { font-size: 13px; color: #94a3b8; }

        /* Save status */
        .mse-save-label { font-size: 12px; color: #94a3b8; white-space: nowrap; display: flex; align-items: center; gap: 5px; }
        .mse-save-label.dirty { color: #f59e0b; }

        @media (max-width: 700px) {
          .mse-breadcrumb { display: none; }
          .mse-hide-sm { display: none !important; }
          .mse-viewport { display: none; }
          .mse-label-btn span { display: none; }
          .mse-label-btn { padding: 0 10px; gap: 0; }
        }
      `}</style>

      {/* ── Top toolbar ───────────────────────────────────────────────────── */}
      <div className="mse-bar">
        {/* Zone 1 — Navigation */}
        <div className="mse-group">
          <button className="mse-icon-btn" onClick={onClose} title="Back">
            {Icon.back}
          </button>
          <button
            className={`mse-icon-btn${showOutline ? ' active' : ''}`}
            onClick={() => setShowOutline((v) => !v)}
            title="Section outline"
          >
            {Icon.outline}
          </button>
        </div>

        <div className="mse-sep" />

        {/* Zone 2 — App name + save state */}
        <div className="mse-group" style={{ gap: 8 }}>
          <span className="mse-appname">Editor</span>
          {isDirty ? (
            <span className="mse-save-label dirty" title="Unsaved changes — auto-saves in 60 s">
              <span
                style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }}
              />
              Unsaved
            </span>
          ) : lastSavedLabel ? (
            <span className="mse-save-label">
              <span style={{ color: '#22c55e', display: 'flex' }}>{Icon.check}</span>
              Saved {lastSavedLabel}
            </span>
          ) : (
            <span className="mse-save-label">Live Preview</span>
          )}
        </div>

        {/* Spacer — pushes right zone to the edge */}
        <div className="mse-spacer" />

        {/* Zone 3 — Viewport */}
        <div className="mse-viewport mse-hide-sm" style={{ marginRight: 8 }}>
          {VIEWPORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`mse-vp-btn${viewport === opt.id ? ' active' : ''}`}
              onClick={() => setViewport(opt.id)}
              title={opt.label}
            >
              {opt.icon}
            </button>
          ))}
        </div>

        <div className="mse-sep mse-hide-sm" />

        {/* Zone 4 — History */}
        <div className="mse-group" style={{ marginRight: 8 }}>
          <button className="mse-icon-btn" onClick={() => ctx.undo()} disabled={!ctx.canUndo} title="Undo (Ctrl+Z)">
            {Icon.undo}
          </button>
          <button className="mse-icon-btn" onClick={() => ctx.redo()} disabled={!ctx.canRedo} title="Redo (Ctrl+Y)">
            {Icon.redo}
          </button>
        </div>

        <div className="mse-sep" />

        {/* Zone 5 — Tools */}
        <div className="mse-group" style={{ gap: 6, marginLeft: 6 }}>

          {/* Preview mode toggle */}
          <button
            className={`mse-icon-btn${previewMode ? ' active' : ''}`}
            onClick={() => setPreviewMode(v => !v)}
            title={previewMode ? 'Exit preview (Ctrl+Shift+P)' : 'Preview mode — hide editor UI (Ctrl+Shift+P)'}
          >
            {previewMode ? Icon.eyeOff : Icon.eye}
          </button>

          {/* Color palette editor */}
          <div ref={colorBtnRef} style={{ position: 'relative' }}>
            <button
              className={`mse-icon-btn${showColorPalette ? ' active' : ''}`}
              onClick={() => { setShowColorPalette(v => !v); setShowTypography(false); }}
              title="Edit color palette"
            >
              {Icon.palette}
            </button>
            {showColorPalette && (
              <ColorPaletteEditor
                tokens={resolvedTokens}
                onClose={() => setShowColorPalette(false)}
              />
            )}
          </div>

          {/* Typography picker */}
          <div ref={typoBtnRef} style={{ position: 'relative' }}>
            <button
              className={`mse-icon-btn${showTypography ? ' active' : ''}`}
              onClick={() => { setShowTypography(v => !v); setShowColorPalette(false); }}
              title="Typography — font pairs"
            >
              {Icon.type}
            </button>
            {showTypography && (
              <TypographyPicker onClose={() => setShowTypography(false)} />
            )}
          </div>

          <div className="mse-sep" />

          {/* Theme */}
          <div ref={themeBtnRef} style={{ position: 'relative' }}>
            <button
              className={`mse-label-btn${showThemePanel ? ' active' : ''}`}
              onClick={() => setShowThemePanel((v) => !v)}
              title="Switch theme"
            >
              {Icon.theme}
              <span>Theme</span>
              {currentTheme && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: currentTheme.previewColors.accent,
                    display: 'inline-block',
                    flexShrink: 0,
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

          {/* Design AI */}
          <button
            className={`mse-label-btn${showDesignPanel ? ' active' : ''}`}
            onClick={() => { setPanelInitialTab('design'); setPanelTargetSectionId(undefined); setPanelInstruction(''); setShowDesignPanel((v) => !v); }}
            title="Design AI panel"
          >
            {Icon.ai}
            <span>Design AI</span>
          </button>

          {/* Publish */}
          <button className="mse-label-btn" onClick={() => setShowPublishModal(true)} title="Publish / Export">
            {Icon.publish}
            <span>Publish</span>
          </button>

          {/* Save CTA */}
          <button
            className={`mse-cta${!isDirty ? ' muted' : ''}`}
            onClick={() => {
              if (!isDirty) return;
              onExport(ctx.ast);
              savedAstRef.current = JSON.stringify(ctx.ast);
              setIsDirty(false);
              setLastSavedLabel(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }}
            title={isDirty ? 'Save changes (Ctrl+S)' : 'All changes saved'}
          >
            {isDirty ? <>{Icon.save} Save</> : <>{Icon.check} Saved</>}
          </button>
        </div>
      </div>

      {/* Canvas + optional outline panel */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', position: 'relative' }}>
        {/* Left: Section outline (hidden in preview mode) */}
        {showOutline && !previewMode && <SectionOutline onClose={() => setShowOutline(false)} />}

        {/* Right: viewport-simulated canvas */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            justifyContent: 'center',
            background: viewport !== 'desktop' ? '#e2e8f0' : '#f1f5f9',
            transition: 'background 0.2s',
            padding: viewport !== 'desktop' ? '16px 0' : 0,
            position: 'relative',
            pointerEvents: showDesignPanel ? 'none' : undefined,
          }}
        >
          <div
            style={{
              width: VIEWPORT_OPTIONS.find((v) => v.id === viewport)?.width ?? '100%',
              maxWidth: viewport === 'desktop' ? '100%' : undefined,
              height: viewport !== 'desktop' ? 'calc(100% - 0px)' : '100%',
              overflowY: 'auto',
              overflowX: 'hidden',
              boxShadow: viewport !== 'desktop' ? '0 4px 32px rgba(0,0,0,0.22)' : 'none',
              borderRadius: viewport !== 'desktop' ? 12 : 0,
              transition: 'width 0.3s cubic-bezier(0.4,0,0.2,1)',
              flexShrink: 0,
            }}
          >
            {previewMode ? (
              <div style={{ width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
                <EditContextBlocker>
                  <Microsite ast={previewAst ?? ctx.ast} mode="embedded" />
                </EditContextBlocker>
              </div>
            ) : (
              <EditorCanvas onAiAction={handleSectionAiAction} previewAst={previewAst ?? undefined} aiRunning={aiRunning} />
            )}
          </div>

          {/* Preview mode floating exit pill */}
          {previewMode && (
            <div style={{
              position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
              zIndex: 500, display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(15,23,42,0.88)', backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: 100,
              padding: '6px 16px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Preview
              </span>
              <button
                onClick={() => setPreviewMode(false)}
                style={{
                  padding: '3px 10px', borderRadius: 100,
                  border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)',
                  color: '#e2e8f0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}
              >Exit ✕</button>
            </div>
          )}
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
          initialTab={panelInitialTab}
          onApply={(newAst) => {
            setPreviewAst(null);
            setAiRunning(false);
            ctx.replaceAst(newAst);
          }}
          onPreview={(ast) => setPreviewAst(ast)}
          onRunningChange={(running) => setAiRunning(running)}
          onClose={() => {
            setPreviewAst(null);
            setAiRunning(false);
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
          onSelect={(id) => {
            if (id) {
              handleThemeSelect(id);
              setShowThemeModal(false);
            }
          }}
          onPreview={(id) => {
            try {
              setPreviewPlugin(getPlugin(id));
            } catch {
              /* unknown id */
            }
          }}
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
      {showPalette && <CommandPalette commands={paletteCommands} onClose={() => setShowPalette(false)} />}

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
      <EditorInner onClose={onClose} onExport={handleExport} namespace={namespace} proposalId={proposalId} />
    </EditProvider>
  );
}
