'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import ReactMarkdown from 'react-markdown';

const BlockEditor = dynamic(
  () =>
    import('./editor/BlockEditor').then((m) => m.BlockEditor),
  { ssr: false },
);

interface Props {
  title: string;
  content: string;
  failed: boolean;
  locked: boolean;
  expanded: boolean;
  isRegenerating: boolean;
  isFinalized: boolean;
  isSaving: boolean;
  onToggle: () => void;
  onRegenerate: () => void;
  onToggleLock: () => void;
  onSave: (title: string, newContent: string) => void;
  onImproveWithAI: () => void;
}

export function SectionCard({
  title,
  content,
  failed,
  locked,
  expanded,
  isRegenerating,
  isFinalized,
  isSaving,
  onToggle,
  onRegenerate,
  onToggleLock,
  onSave,
  onImproveWithAI,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  function handleDoubleClick() {
    if (isFinalized || isRegenerating || isSaving) return;
    setEditContent(content);
    setEditing(true);
    setHasUnsavedChanges(false);
  }

  function handleSave() {
    onSave(title, editContent);
    setEditing(false);
    setHasUnsavedChanges(false);
  }

  function handleCancel() {
    setEditing(false);
    setEditContent('');
    setHasUnsavedChanges(false);
  }

  function handleEditorUpdate(markdown: string) {
    setEditContent(markdown);
    setHasUnsavedChanges(true);
  }

  return (
    <div
      className={`section-card${failed ? ' section-card--failed' : ''}${
        locked ? ' section-card--locked' : ''
      }${!expanded ? ' section-card--collapsed' : ''}${
        editing ? ' section-card--editing' : ''
      }`}
    >
      <div className="section-header" onClick={onToggle}>
        <div className="section-header-left">
          <span
            className={`section-toggle${expanded ? ' section-toggle--open' : ''}`}
          >
            &#9656;
          </span>
          <span className="section-title">{title}</span>
          {failed ? (
            <span className="badge badge--error">Failed</span>
          ) : locked ? (
            <span className="badge badge--locked">Locked</span>
          ) : editing ? (
            <span className="badge badge--editing">Editing</span>
          ) : (
            !isRegenerating && (
              <span className="badge badge--ok">OK</span>
            )
          )}
        </div>
        <div className="section-header-right">
          {isRegenerating ? (
            <span className="spinner" />
          ) : (
            <>
              {!isFinalized && (
                <button
                  className="btn btn-sm lock-btn"
                  title={locked ? 'Unlock section' : 'Lock section'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLock();
                  }}
                >
                  {locked ? 'Unlock' : 'Lock'}
                </button>
              )}
              <button
                className="btn btn-sm section-ai-btn"
                title="Rewrite section with AI instructions"
                disabled={locked || isFinalized}
                onClick={(e) => {
                  e.stopPropagation();
                  onImproveWithAI();
                }}
              >
                Improve with AI
              </button>
              <button
                className="btn btn-sm section-regen-btn"
                title="Regenerates the entire proposal (locked sections are preserved)"
                disabled={locked || isFinalized}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm('Regenerate the entire proposal? All unlocked sections will be rewritten. Locked sections are preserved.')) return;
                  onRegenerate();
                }}
              >
                Regenerate Proposal
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="section-content">
          {editing ? (
            <div className="section-edit">
              <BlockEditor
                content={editContent}
                onUpdate={handleEditorUpdate}
                editable
                onSave={handleSave}
                onCancel={handleCancel}
              />
              <div className="section-edit-actions">
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={handleCancel}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                {hasUnsavedChanges && (
                  <span className="section-edit-status">
                    Edited &middot; Unsaved changes
                  </span>
                )}
                <span className="section-edit-hint">
                  Ctrl+S to save, Esc to cancel, type &apos;/&apos; for commands
                </span>
              </div>
            </div>
          ) : (
            <div
              className="prose"
              onDoubleClick={handleDoubleClick}
              title={isFinalized ? undefined : 'Double-click to edit'}
              style={{ cursor: isFinalized ? 'default' : 'text' }}
            >
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
