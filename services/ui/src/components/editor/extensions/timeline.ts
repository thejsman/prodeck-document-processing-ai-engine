import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { TimelineView } from '../node-views/TimelineView';

export const Timeline = Node.create({
  name: 'timeline',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      milestones: {
        default: [
          { date: 'Week 1', title: 'Kickoff', description: 'Project initiation and setup' },
          { date: 'Week 2', title: 'Development', description: 'Core implementation' },
          { date: 'Week 3', title: 'Review', description: 'Testing and review' },
        ],
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="timeline"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'timeline' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TimelineView);
  },
});
