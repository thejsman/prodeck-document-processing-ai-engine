'use client';

import { useState } from 'react';
import type { LayoutAST } from '../../../types/presentation';
import { EditProvider, useEditContext } from './EditContext';
import { EditPanel } from './EditPanel';
import { Microsite } from '../Microsite';
import { DesignAgentPanel } from './DesignAgentPanel';
import { PublishModal } from './PublishModal';
import { resolveTokens } from '../../../lib/presentation/pluginRegistry';

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
        // Match canvas bg to the theme so no bleed-through on dark designs
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

// ── Inner editor (inside provider) ────────────────────────────────────────

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              color: '#64748b',
            }}
          >
            ← Back
          </button>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>
            Microsite Editor
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8', background: '#f1f5f9', padding: '2px 8px', borderRadius: 10 }}>
            Live Preview
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowDesignPanel((v) => !v)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: showDesignPanel ? '#6366f1' : '#fff',
              color: showDesignPanel ? '#fff' : '#475569',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ✦ Design AI
          </button>
          <button
            onClick={() => setShowPublishModal(true)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #e2e8f0',
              background: '#fff',
              color: '#475569',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ↑ Publish
          </button>
          <button
            onClick={() => onExport(ctx.ast)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: '#6366f1',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Two-column workspace */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: canvas */}
        <div style={{ flex: '1 1 0', overflow: 'hidden', position: 'relative' }}>
          <EditorCanvas />
        </div>

        {/* Divider */}
        <div style={{ width: 1, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Right: edit panel */}
        <div
          style={{
            width: 300,
            flexShrink: 0,
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <EditPanel ast={ctx.ast} />
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

      {/* Design AI panel (slide-in from right edge) */}
      {showDesignPanel && (
        <DesignAgentPanel
          ast={ctx.ast}
          namespace={namespace}
          proposalId={proposalId}
          onApply={(newAst) => {
            ctx.replaceAst(newAst);
          }}
          onClose={() => setShowDesignPanel(false)}
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
  /** Called when user clicks Save — receives the fully-edited AST */
  onExport?: (editedAst: LayoutAST) => void;
}

export function MicrositeEditor({ ast, namespace, proposalId, onClose, onExport }: Props) {
  const [editedAst, setEditedAst] = useState<LayoutAST>(() => JSON.parse(JSON.stringify(ast)) as LayoutAST);

  const handleExport = (ea: LayoutAST) => {
    setEditedAst(ea);
    onExport?.(ea);
  };

  return (
    <EditProvider
      initialAst={ast}
      onChange={setEditedAst}
    >
      <EditorInner
        onClose={onClose}
        onExport={handleExport}
        namespace={namespace}
        proposalId={proposalId}
      />
    </EditProvider>
  );
}
