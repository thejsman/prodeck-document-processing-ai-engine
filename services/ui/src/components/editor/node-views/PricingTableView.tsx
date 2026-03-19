'use client';

import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import type { PricingRow } from '@/lib/editor/block-types';

const HEADERS = ['Role', 'Qty', 'Rate', 'Duration', 'Total'];

export function PricingTableView({ node, updateAttributes }: NodeViewProps) {
  const rows = (node.attrs.rows as PricingRow[]) || [];

  function updateRow(index: number, field: keyof PricingRow, value: string | number) {
    const updated = rows.map((row, i) =>
      i === index ? { ...row, [field]: value } : row,
    );
    updateAttributes({ rows: updated });
  }

  function addRow() {
    updateAttributes({
      rows: [...rows, { role: '', qty: 1, rate: '', duration: '', total: '' }],
    });
  }

  function removeRow(index: number) {
    updateAttributes({ rows: rows.filter((_, i) => i !== index) });
  }

  return (
    <NodeViewWrapper className="pricing-table-block" data-drag-handle="">
      <div className="pricing-table-block__label">Pricing Table</div>
      <table className="pricing-table-block__table">
        <thead>
          <tr>
            {HEADERS.map((h) => (
              <th key={h}>{h}</th>
            ))}
            <th className="pricing-table-block__action-col" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  type="text"
                  value={row.role}
                  onChange={(e) => updateRow(i, 'role', e.target.value)}
                  placeholder="Role"
                />
              </td>
              <td>
                <input
                  type="number"
                  value={row.qty}
                  onChange={(e) =>
                    updateRow(i, 'qty', parseInt(e.target.value, 10) || 0)
                  }
                  min={0}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.rate}
                  onChange={(e) => updateRow(i, 'rate', e.target.value)}
                  placeholder="$0/hr"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.duration}
                  onChange={(e) => updateRow(i, 'duration', e.target.value)}
                  placeholder="4 weeks"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.total}
                  onChange={(e) => updateRow(i, 'total', e.target.value)}
                  placeholder="$0"
                />
              </td>
              <td>
                <button
                  className="pricing-table-block__remove-btn"
                  onClick={() => removeRow(i)}
                  title="Remove row"
                  type="button"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="pricing-table-block__add-btn"
        onClick={addRow}
        type="button"
      >
        + Add Row
      </button>
    </NodeViewWrapper>
  );
}
