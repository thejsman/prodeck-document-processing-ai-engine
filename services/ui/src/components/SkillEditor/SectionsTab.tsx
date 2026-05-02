'use client';

import { useState } from 'react';
import type { SectionDefinitionApi, AssetInfoApi } from '@/lib/api';
import { AIAssistBlock } from './AIAssistBlock';

interface SectionsTabProps {
  sections: SectionDefinitionApi[];
  assets: AssetInfoApi[];
  onChange: (sections: SectionDefinitionApi[]) => void;
  onAIAssist: (instruction: string) => Promise<void>;
}

function fieldStyle(): React.CSSProperties {
  return {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '5px 8px',
    color: 'var(--text)',
    fontSize: 12,
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
  };
}

function newSection(order: number): SectionDefinitionApi {
  return {
    id: `section-${order}`,
    title: '',
    order,
    required: true,
    promptHint: '',
    useRagContext: false,
  };
}

function SectionCard({
  section,
  index,
  total,
  assets,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  section: SectionDefinitionApi;
  index: number;
  total: number;
  assets: AssetInfoApi[];
  onUpdate: (s: SectionDefinitionApi) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const upd = (patch: Partial<SectionDefinitionApi>) => onUpdate({ ...section, ...patch });

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      marginBottom: 10,
      background: 'var(--panel)',
    }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 12px',
        gap: 8,
        cursor: 'pointer',
        userSelect: 'none',
      }} onClick={() => setExpanded((v) => !v)}>
        <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 20 }}>{index + 1}.</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          {section.title || <span style={{ color: 'var(--muted)', fontStyle: 'italic' }}>Untitled Section</span>}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); upd({ required: !section.required }); }}
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: section.required ? 'var(--primary)' : 'transparent',
            color: section.required ? '#fff' : 'var(--muted)',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {section.required ? '● Required' : '○ Optional'}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={index === 0} style={{ background: 'none', border: 'none', cursor: index === 0 ? 'not-allowed' : 'pointer', color: 'var(--muted)', fontSize: 14, padding: '0 3px' }}>↑</button>
        <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={index === total - 1} style={{ background: 'none', border: 'none', cursor: index === total - 1 ? 'not-allowed' : 'pointer', color: 'var(--muted)', fontSize: 14, padding: '0 3px' }}>↓</button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger, #e53e3e)', fontSize: 14, padding: '0 3px' }}>🗑</button>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: '0 12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Title</label>
              <input value={section.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Section Title" style={fieldStyle()} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>ID (kebab-case)</label>
              <input value={section.id} onChange={(e) => upd({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="section-id" style={fieldStyle()} />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Prompt Hint</label>
            <textarea
              value={section.promptHint}
              onChange={(e) => upd({ promptHint: e.target.value })}
              placeholder="Instructions for the AI when generating this section"
              rows={2}
              style={{ ...fieldStyle(), resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Max Words</label>
              <input
                type="number"
                value={section.maxWords ?? ''}
                onChange={(e) => upd({ maxWords: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="—"
                style={fieldStyle()}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Asset Ref</label>
              <select value={section.assetRef ?? ''} onChange={(e) => upd({ assetRef: e.target.value || undefined })} style={fieldStyle()}>
                <option value="">None</option>
                {assets.map((a) => <option key={a.fileName} value={a.fileName}>{a.fileName}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={section.useRagContext}
                  onChange={(e) => upd({ useRagContext: e.target.checked })}
                />
                Use Documents
              </label>
            </div>
          </div>

          {section.useRagContext && (
            <div>
              <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>RAG Query (optional)</label>
              <input
                value={section.ragQuery ?? ''}
                onChange={(e) => upd({ ragQuery: e.target.value || undefined })}
                placeholder="Custom search query for document retrieval"
                style={fieldStyle()}
              />
            </div>
          )}

          {/* Condition */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Condition (optional)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 6, alignItems: 'center' }}>
              <input
                value={section.condition?.field ?? ''}
                onChange={(e) => upd({ condition: e.target.value ? { field: e.target.value, operator: section.condition?.operator ?? 'contains', value: section.condition?.value } : undefined })}
                placeholder="Field (e.g. constraints)"
                style={fieldStyle()}
              />
              <select
                value={section.condition?.operator ?? 'contains'}
                disabled={!section.condition?.field}
                onChange={(e) => upd({ condition: section.condition ? { ...section.condition, operator: e.target.value as 'exists' | 'equals' | 'contains' } : undefined })}
                style={{ ...fieldStyle(), width: 'auto', padding: '5px 6px' }}
              >
                <option value="contains">contains</option>
                <option value="equals">equals</option>
                <option value="exists">exists</option>
              </select>
              <input
                value={section.condition?.value ?? ''}
                disabled={!section.condition?.field || section.condition?.operator === 'exists'}
                onChange={(e) => upd({ condition: section.condition ? { ...section.condition, value: e.target.value } : undefined })}
                placeholder="value"
                style={fieldStyle()}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SectionsTab({ sections, assets, onChange, onAIAssist }: SectionsTabProps) {
  const addSection = () => {
    const order = sections.length + 1;
    onChange([...sections, newSection(order)]);
  };

  const updateSection = (index: number, updated: SectionDefinitionApi) => {
    const next = [...sections];
    next[index] = updated;
    onChange(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const deleteSection = (index: number) => {
    onChange(sections.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })));
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const next = [...sections];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const moveDown = (index: number) => {
    if (index === sections.length - 1) return;
    const next = [...sections];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Drag to reorder. Toggle required/optional per section.</p>
        <button
          onClick={addSection}
          style={{
            background: 'var(--primary)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          + Add Section
        </button>
      </div>

      {sections.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '32px 0' }}>
          No sections yet. Click &quot;+ Add Section&quot; or use AI Assist below.
        </p>
      ) : (
        sections.map((s, i) => (
          <SectionCard
            key={s.id + i}
            section={s}
            index={i}
            total={sections.length}
            assets={assets}
            onUpdate={(updated) => updateSection(i, updated)}
            onDelete={() => deleteSection(i)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
          />
        ))
      )}

      <AIAssistBlock
        placeholder={`e.g. "Add a security architecture section after technical approach, focused on zero-trust"`}
        onApply={onAIAssist}
      />
    </div>
  );
}
