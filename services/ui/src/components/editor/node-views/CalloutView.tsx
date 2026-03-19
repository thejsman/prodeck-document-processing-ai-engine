'use client';

import { useState } from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { CalloutTone } from '@/lib/editor/block-types';

const TONE_CONFIG: Record<CalloutTone, { icon: string; label: string }> = {
  info: { icon: 'ℹ', label: 'Info' },
  warning: { icon: '⚠', label: 'Warning' },
  success: { icon: '✓', label: 'Success' },
};

const TONE_OPTIONS: CalloutTone[] = ['info', 'warning', 'success'];

export function CalloutView({ node, updateAttributes, selected }: NodeViewProps) {
  const tone = (node.attrs.tone as CalloutTone) || 'info';
  const text = (node.attrs.text as string) || '';
  const [showToneMenu, setShowToneMenu] = useState(false);
  const config = TONE_CONFIG[tone];

  return (
    <NodeViewWrapper className={`callout-block callout-block--${tone}`} data-drag-handle="">
      <div className="callout-block__header">
        <button
          className="callout-block__tone-btn"
          onClick={() => setShowToneMenu(!showToneMenu)}
          title="Change callout type"
          type="button"
        >
          {config.icon} {config.label}
        </button>
        {showToneMenu && (
          <div className="callout-block__tone-menu">
            {TONE_OPTIONS.map((t) => (
              <button
                key={t}
                className={`callout-block__tone-option${t === tone ? ' active' : ''}`}
                onClick={() => {
                  updateAttributes({ tone: t });
                  setShowToneMenu(false);
                }}
                type="button"
              >
                {TONE_CONFIG[t].icon} {TONE_CONFIG[t].label}
              </button>
            ))}
          </div>
        )}
      </div>
      <textarea
        className={`callout-block__textarea${selected ? ' selected' : ''}`}
        value={text}
        onChange={(e) => updateAttributes({ text: e.target.value })}
        placeholder="Type callout text..."
        rows={2}
      />
    </NodeViewWrapper>
  );
}
