'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, FileText, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useBrief } from '@/hooks/useBrief';
import { BriefField, FIELD_LABELS } from './BriefField';
import type { RequirementKey, RequirementField, KnowledgeEntry } from '@/lib/api';

const TIER1_KEYS: RequirementKey[] = ['clientName', 'clientIndustry', 'projectType'];
const TIER2_KEYS: RequirementKey[] = ['budget', 'timeline', 'keyObjectives', 'contactName'];
const TIER3_KEYS: RequirementKey[] = ['technicalStack', 'constraints', 'deliverables', 'teamSize', 'stakeholders'];

const KNOWLEDGE_CATEGORY_LABELS: Record<string, string> = {
  priority: 'Priority', problem: 'Problem', requirement: 'Requirement',
  opportunity: 'Opportunity', constraint: 'Constraint', metric: 'Metric',
  decision: 'Decision', action_item: 'Action', context: 'Context', preference: 'Preference',
};

const KNOWLEDGE_CATEGORY_COLORS: Record<string, string> = {
  priority: 'var(--primary)',
  problem: 'var(--danger, #ef4444)',
  requirement: 'var(--primary)',
  opportunity: 'var(--success, #22c55e)',
  constraint: 'var(--warning, #f59e0b)',
  metric: 'var(--muted)',
  decision: 'var(--success, #22c55e)',
  action_item: 'var(--warning, #f59e0b)',
  context: 'var(--muted)',
  preference: 'var(--muted)',
};

const SOURCE_ICONS: Record<string, string> = {
  client_source: '📄',
  conversation: '💬',
  provider_asset: '📎',
  reference_example: '🔗',
  background: '📚',
};

interface Props {
  namespace: string;
  apiKey: string;
  onAskField?: (question: string) => void;
}

export function BriefPanel({ namespace, apiKey, onAskField }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showAllKnowledge, setShowAllKnowledge] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const { context, updateField, confirm, updateKnowledge, deleteKnowledge } = useBrief(namespace, apiKey);

  const fields = context?.requirements?.fields ?? {};

  const handleEdit = useCallback(
    async (key: RequirementKey, value: unknown) => {
      await updateField(key, value);
    },
    [updateField],
  );

  const handleAsk = useCallback(
    (question: string) => {
      onAskField?.(question);
    },
    [onAskField],
  );

  const handleConfirm = useCallback(
    async (key: RequirementKey, field: RequirementField) => {
      await confirm({ [key]: { value: field.value, confidence: 1.0, source: 'user' } });
    },
    [confirm],
  );

  const handleKnowledgeEditStart = useCallback((entry: KnowledgeEntry) => {
    setEditingId(entry.id);
    setEditValue(entry.content);
  }, []);

  const handleKnowledgeSave = useCallback(async (id: string) => {
    await updateKnowledge(id, editValue);
    setEditingId(null);
    setEditValue('');
  }, [updateKnowledge, editValue]);

  const handleKnowledgeCancel = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const handleKnowledgeDelete = useCallback(async (id: string) => {
    if (editingId === id) { setEditingId(null); setEditValue(''); }
    await deleteKnowledge(id);
  }, [deleteKnowledge, editingId]);

  // Collapsed strip — show filled Tier 1 fields inline
  const filledTier1 = TIER1_KEYS
    .map((k) => fields[k])
    .filter(Boolean)
    .map((f) => {
      const v = f!.value;
      return Array.isArray(v) ? v.join(', ') : String(v);
    });
  const tier1Count = TIER1_KEYS.filter((k) => fields[k]?.value).length;

  const completenessColor = tier1Count === 3
    ? 'var(--success, #22c55e)'
    : tier1Count > 0
    ? 'var(--warning, #f59e0b)'
    : 'var(--muted)';

  const panelStyle: React.CSSProperties = {
    borderBottom: '1px solid var(--border)',
    background: 'var(--panel-soft)',
    fontSize: 13,
    flexShrink: 0,
  };

  const collapsedRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 16px',
    cursor: 'pointer',
    userSelect: 'none',
  };

  return (
    <div style={panelStyle}>
      {/* Collapsed strip */}
      <div style={collapsedRow} onClick={() => setExpanded((v) => !v)}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
          Brief
        </span>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
          {filledTier1.length > 0 ? (
            filledTier1.map((v, i) => (
              <span key={i} style={{ color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
                {i > 0 && <span style={{ color: 'var(--muted)', marginRight: 6 }}>·</span>}
                {v}
              </span>
            ))
          ) : (
            <span style={{ color: 'var(--muted)' }}>No context yet</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: completenessColor, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {tier1Count}/3 Tier 1
        </span>
        <Icon icon={expanded ? ChevronUp : ChevronDown} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
      </div>

      {/* Expanded view */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'min(52vh, 480px)' }}>

          {/* Scrollable fields + knowledge + sources */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 8px', scrollbarWidth: 'thin' }}>

            {/* Tier 1 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, paddingTop: 8 }}>
                Tier 1 — Required
              </div>
              {TIER1_KEYS.map((k) => (
                <BriefField
                  key={k}
                  fieldKey={k}
                  field={fields[k] as RequirementField | undefined}
                  onEdit={handleEdit}
                  onAsk={handleAsk}
                  onConfirm={handleConfirm}
                />
              ))}
            </div>

            {/* Tier 2 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, paddingTop: 8 }}>
                Tier 2 — Recommended
              </div>
              {TIER2_KEYS.map((k) => (
                <BriefField
                  key={k}
                  fieldKey={k}
                  field={fields[k] as RequirementField | undefined}
                  onEdit={handleEdit}
                  onAsk={handleAsk}
                  onConfirm={handleConfirm}
                />
              ))}
            </div>

            {/* Tier 3 */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, paddingTop: 8 }}>
                Tier 3 — Enrichment
              </div>
              {TIER3_KEYS.map((k) => (
                <BriefField
                  key={k}
                  fieldKey={k}
                  field={fields[k] as RequirementField | undefined}
                  onEdit={handleEdit}
                  onAsk={handleAsk}
                  onConfirm={handleConfirm}
                />
              ))}
            </div>

            {/* Knowledge */}
            {(() => {
              const allEntries = (context?.knowledge ?? []).filter((e: KnowledgeEntry) => !e.supersededBy);
              if (allEntries.length === 0) return null;
              const sorted = [...allEntries].sort((a: KnowledgeEntry, b: KnowledgeEntry) => b.importance - a.importance);
              const visible = showAllKnowledge ? sorted : sorted.slice(0, 5);
              return (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, paddingTop: 8 }}>
                    Knowledge ({allEntries.length})
                  </div>
                  {visible.map((entry: KnowledgeEntry) => (
                    <div key={entry.id} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                      <span style={{
                        flexShrink: 0, fontSize: 10, fontWeight: 600,
                        color: KNOWLEDGE_CATEGORY_COLORS[entry.category] ?? 'var(--muted)',
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        paddingTop: 1, minWidth: 72,
                      }}>
                        {KNOWLEDGE_CATEGORY_LABELS[entry.category] ?? entry.category}
                      </span>
                      {editingId === entry.id ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <textarea
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            rows={3}
                            style={{ fontSize: 12, width: '100%', resize: 'vertical', padding: '4px 6px', border: '1px solid var(--primary)', borderRadius: 4, background: 'var(--input-bg, var(--panel-soft))', color: 'var(--text)' }}
                          />
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              onClick={() => handleKnowledgeSave(entry.id)}
                              disabled={editValue.trim() === ''}
                              style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 3 }}
                            >
                              Save
                            </button>
                            <button
                              onClick={handleKnowledgeCancel}
                              style={{ fontSize: 11, padding: '2px 8px', cursor: 'pointer', background: 'none', border: '1px solid var(--border)', borderRadius: 3, color: 'var(--text)' }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, flex: 1 }}>
                          {entry.content}
                        </span>
                      )}
                      {editingId !== entry.id && (
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: 1 }}>
                          <button
                            onClick={() => handleKnowledgeEditStart(entry)}
                            title="Edit"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', lineHeight: 1 }}
                          >
                            <Icon icon={Pencil} size="sm" />
                          </button>
                          <button
                            onClick={() => handleKnowledgeDelete(entry.id)}
                            title="Delete"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', lineHeight: 1 }}
                          >
                            <Icon icon={Trash2} size="sm" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {allEntries.length > 5 && (
                    <button
                      onClick={() => setShowAllKnowledge((v) => !v)}
                      style={{ fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginTop: 2 }}
                    >
                      {showAllKnowledge ? 'Show fewer' : `Show all (${allEntries.length})`}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Source pool */}
            {(context?.sources ?? []).length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, paddingTop: 4 }}>
                  Source Pool
                </div>
                {context!.sources.map((src, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                    <span style={{ flexShrink: 0 }}>
                      {SOURCE_ICONS[src.classification ?? ''] ?? <Icon icon={FileText} size="sm" />}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                      {src.fileName}
                    </span>
                    <span style={{ flexShrink: 0, color: 'var(--muted)', fontSize: 11 }}>
                      {[
                        src.fieldsExtracted.length > 0 ? `${src.fieldsExtracted.length} fields` : null,
                        src.knowledgeEntriesCreated > 0 ? `${src.knowledgeEntriesCreated} knowledge` : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}

          </div>


        </div>
      )}
    </div>
  );
}
