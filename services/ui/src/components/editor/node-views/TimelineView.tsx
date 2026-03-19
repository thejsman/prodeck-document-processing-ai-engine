'use client';

import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { TimelineItem } from '@/lib/editor/block-types';

export function TimelineView({ node, updateAttributes }: NodeViewProps) {
  const milestones = (node.attrs.milestones as TimelineItem[]) || [];

  function updateMilestone(
    index: number,
    field: keyof TimelineItem,
    value: string,
  ) {
    const updated = milestones.map((m, i) =>
      i === index ? { ...m, [field]: value } : m,
    );
    updateAttributes({ milestones: updated });
  }

  function addMilestone() {
    updateAttributes({
      milestones: [
        ...milestones,
        { date: '', title: '', description: '' },
      ],
    });
  }

  function removeMilestone(index: number) {
    updateAttributes({
      milestones: milestones.filter((_, i) => i !== index),
    });
  }

  return (
    <NodeViewWrapper className="timeline-block" data-drag-handle="">
      <div className="timeline-block__label">Timeline</div>
      <div className="timeline-block__items">
        {milestones.map((milestone, i) => (
          <div key={i} className="timeline-block__item">
            <div className="timeline-block__dot" />
            <div className="timeline-block__content">
              <div className="timeline-block__row">
                <input
                  type="text"
                  className="timeline-block__date"
                  value={milestone.date}
                  onChange={(e) => updateMilestone(i, 'date', e.target.value)}
                  placeholder="Week 1"
                />
                <input
                  type="text"
                  className="timeline-block__title"
                  value={milestone.title}
                  onChange={(e) => updateMilestone(i, 'title', e.target.value)}
                  placeholder="Milestone title"
                />
                <button
                  className="timeline-block__remove-btn"
                  onClick={() => removeMilestone(i)}
                  title="Remove milestone"
                  type="button"
                >
                  ×
                </button>
              </div>
              <input
                type="text"
                className="timeline-block__description"
                value={milestone.description}
                onChange={(e) =>
                  updateMilestone(i, 'description', e.target.value)
                }
                placeholder="Description (optional)"
              />
            </div>
          </div>
        ))}
      </div>
      <button
        className="timeline-block__add-btn"
        onClick={addMilestone}
        type="button"
      >
        + Add Milestone
      </button>
    </NodeViewWrapper>
  );
}
