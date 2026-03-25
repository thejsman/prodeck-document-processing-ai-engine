'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { LayoutAST } from '../../../types/presentation';
import { EditProvider, useEditContext } from './EditContext';
import { Microsite } from '../Microsite';
import { DesignAgentPanel } from './DesignAgentPanel';
import { PublishModal } from './PublishModal';
import { ThemeModal } from '../ThemeModal';
import { resolveTokens } from '../../../lib/presentation/pluginRegistry';
import { THEME_REGISTRY } from '../../../lib/presentation/pluginRegistry';

// Popular themes shown in quick picker (first 8)
const QUICK_THEMES = THEME_REGISTRY.slice(0, 8);

// ── Canvas — reads editedAst from context ─────────────────────────────────

function EditorCanvas() {
  const ctx = useEditContext()!;
  const mergedTokens = ctx.ast.customTokens
    ? { ...(ctx.ast.customDesignSystem ?? {}), ...ctx.ast.customTokens }
    : undefined;
  const tokens = resolveTokens(
    ctx.ast.plugin,
    ctx.ast.brand.primaryColor,
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
        <Microsite ast={ctx.ast} mode="embedded" />
      </div>
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
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const themeBtnRef = useRef<HTMLDivElement>(null);

  const currentTheme = THEME_REGISTRY.find(t => t.id === ctx.ast.plugin);

  // Keyboard shortcuts: Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); ctx.undo(); }
    if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); ctx.redo(); }
  }, [ctx]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  function handleThemeSelect(id: string) {
    ctx.replaceAst({
      ...ctx.ast,
      plugin: id,
      // Clear any custom token overrides so the new theme applies cleanly
      customTokens: undefined,
      customDesignSystem: undefined,
      customCharacter: undefined,
      customFonts: undefined,
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
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          height: 48,
          background: '#fff',
          borderBottom: '1px solid #e2e8f0',
          flexShrink: 0,
          gap: 12,
        }}
      >
        {/* Left: back + title + live badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0',
              background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#64748b',
            }}
          >
            ← Back
          </button>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Microsite Editor</span>
          <span style={{ fontSize: 11, color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 10 }}>
            Live Preview
          </span>
        </div>

        {/* Right: action buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>

          {/* Viewport toggle */}
          <div style={{ display: 'flex', gap: 1, background: '#f1f5f9', borderRadius: 7, padding: 2, marginRight: 4 }}>
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
              onClick={() => setShowThemePanel(v => !v)}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: showThemePanel ? '#f5f3ff' : '#fff',
                color: showThemePanel ? '#6366f1' : '#475569',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 14 }}>🎨</span>
              <span>Theme</span>
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
            onClick={() => setShowDesignPanel(v => !v)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0',
              background: showDesignPanel ? '#6366f1' : '#fff',
              color: showDesignPanel ? '#fff' : '#475569',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ✦ Design AI
          </button>
          <button
            onClick={() => setShowPublishModal(true)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid #e2e8f0',
              background: '#fff', color: '#475569', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ↑ Publish
          </button>
          <button
            onClick={() => onExport(ctx.ast)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: 'none',
              background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Canvas with viewport simulation */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        display: 'flex',
        justifyContent: 'center',
        background: viewport !== 'desktop' ? '#e2e8f0' : '#f1f5f9',
        transition: 'background 0.2s',
        padding: viewport !== 'desktop' ? '16px 0' : 0,
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
          <EditorCanvas />
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
          onApply={(newAst) => { ctx.replaceAst(newAst); }}
          onClose={() => setShowDesignPanel(false)}
        />
      )}

      {/* Full theme modal */}
      {showThemeModal && (
        <ThemeModal
          selectedPlugin={ctx.ast.plugin}
          onSelect={id => { if (id) { handleThemeSelect(id); setShowThemeModal(false); } }}
          onPreview={() => {}}
          onClose={() => setShowThemeModal(false)}
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
