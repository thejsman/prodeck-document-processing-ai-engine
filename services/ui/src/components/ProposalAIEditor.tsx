'use client';

import { useState } from 'react';

interface Props {
  sectionTitle: string;
  onGenerate: (instruction: string) => void;
  onCancel: () => void;
  isLoading: boolean;
}

const SUGGESTIONS = [
  'Make this section more concise',
  'Rewrite in a more persuasive tone',
  'Add implementation risks and mitigations',
  'Make it more technical and detailed',
  'Simplify for a non-technical audience',
];

export function ProposalAIEditor({
  sectionTitle,
  onGenerate,
  onCancel,
  isLoading,
}: Props) {
  const [instruction, setInstruction] = useState('');

  function handleSubmit() {
    if (!instruction.trim()) return;
    onGenerate(instruction.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      onCancel();
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="ai-editor-overlay" onClick={onCancel}>
      <div className="ai-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ai-editor-header">
          <h3>Improve with AI</h3>
          <span className="ai-editor-section-name">{sectionTitle}</span>
        </div>

        <div className="ai-editor-body">
          <label className="ai-editor-label" htmlFor="ai-instruction">
            How should this section be rewritten?
          </label>
          <textarea
            id="ai-instruction"
            className="ai-editor-textarea"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Make this section more concise"
            rows={3}
            disabled={isLoading}
            autoFocus
          />

          <div className="ai-editor-suggestions">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="ai-editor-suggestion"
                onClick={() => setInstruction(s)}
                disabled={isLoading}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="ai-editor-footer">
          {isLoading && (
            <span className="ai-editor-status">
              <span className="spinner" /> AI rewriting section...
            </span>
          )}
          <div className="ai-editor-actions">
            <button
              className="btn btn-sm"
              onClick={onCancel}
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleSubmit}
              disabled={!instruction.trim() || isLoading}
            >
              Generate
            </button>
          </div>
          <span className="ai-editor-hint">Ctrl+Enter to generate, Esc to cancel</span>
        </div>
      </div>
    </div>
  );
}
