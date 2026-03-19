import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PricingTableView } from '../node-views/PricingTableView';

export const PricingTable = Node.create({
  name: 'pricingTable',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      rows: {
        default: [
          { role: 'Engineer', qty: 1, rate: '$200/hr', duration: '4 weeks', total: '$32,000' },
        ],
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="pricing-table"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'pricing-table' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PricingTableView);
  },
});
