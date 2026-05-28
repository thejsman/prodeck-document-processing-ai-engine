'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Pencil, Trash2, X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useBriefContext } from '@/lib/brief-context';
import { BriefField } from './BriefField';
import type { RequirementKey, RequirementField, KnowledgeEntry } from '@/lib/api';

const TIER1_KEYS: RequirementKey[] = ['clientName', 'clientIndustry', 'projectType'];
const TIER2_KEYS: RequirementKey[] = ['budget', 'timeline', 'keyObjectives', 'contactName'];
const TIER3_KEYS: RequirementKey[] = ['technicalStack', 'constraints', 'deliverables', 'teamSize', 'stakeholders'];

const KNOWLEDGE_CATEGORY_LABELS: Record<string, string> = {
  priority: 'Priority',
  problem: 'Problem',
  requirement: 'Requirement',
  opportunity: 'Opportunity',
  constraint: 'Constraint',
  metric: 'Metric',
  decision: 'Decision',
  action_item: 'Action',
  context: 'Context',
  preference: 'Preference',
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

type TabKey = 'tier1' | 'tier2' | 'tier3';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'tier1', label: 'Required' },
  { key: 'tier2', label: 'Recommended' },
  { key: 'tier3', label: 'Optional' },
];

interface Props {
  namespace: string;
  apiKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAskField?: (question: string) => void;
}

export function BriefPanel({ namespace, apiKey, open, onOpenChange, onAskField }: Props) {
  const modalOpen = open;
  const setModalOpen = onOpenChange;
  const [activeTab, setActiveTab] = useState<TabKey>('tier1');
  const [showAllKnowledge, setShowAllKnowledge] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const { context, updateField, confirm, updateKnowledge, deleteKnowledge } = useBriefContext();

  const fields = context?.requirements?.fields ?? {};

  // Close on Escape
  useEffect(() => {
    if (!modalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setModalOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  // Focus modal on open
  useEffect(() => {
    if (modalOpen) containerRef.current?.focus();
  }, [modalOpen]);

  const handleEdit = useCallback(
    async (key: RequirementKey, value: unknown) => {
      await updateField(key, value);
    },
    [updateField],
  );

  const handleAsk = useCallback(
    (question: string) => {
      onAskField?.(question);
      setModalOpen(false);
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

  const handleKnowledgeSave = useCallback(
    async (id: string) => {
      await updateKnowledge(id, editValue);
      setEditingId(null);
      setEditValue('');
    },
    [updateKnowledge, editValue],
  );

  const handleKnowledgeCancel = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const handleKnowledgeDelete = useCallback(
    async (id: string) => {
      if (editingId === id) {
        setEditingId(null);
        setEditValue('');
      }
      await deleteKnowledge(id);
    },
    [deleteKnowledge, editingId],
  );

  const tier1Count = TIER1_KEYS.filter((k) => fields[k]?.value).length;
  const tier2Count = TIER2_KEYS.filter((k) => fields[k]?.value).length;
  const tier3Count = TIER3_KEYS.filter((k) => fields[k]?.value).length;

  const completenessColor =
    tier1Count === 3 ? 'var(--success, #22c55e)' : tier1Count > 0 ? 'var(--warning, #f59e0b)' : 'var(--muted)';

  // Per-tab fill counts for tab labels
  const tabCounts: Record<TabKey, { filled: number; total: number }> = {
    tier1: { filled: tier1Count, total: TIER1_KEYS.length },
    tier2: { filled: tier2Count, total: TIER2_KEYS.length },
    tier3: { filled: tier3Count, total: TIER3_KEYS.length },
  };

  const allKnowledgeEntries = (context?.knowledge ?? []).filter((e: KnowledgeEntry) => !e.supersededBy);
  const sortedKnowledge = [...allKnowledgeEntries].sort(
    (a: KnowledgeEntry, b: KnowledgeEntry) => b.importance - a.importance,
  );
  const visibleKnowledge = showAllKnowledge ? sortedKnowledge : sortedKnowledge.slice(0, 5);

  const modal =
    modalOpen && typeof window !== 'undefined'
      ? createPortal(
          <div className="generate-proposal-overlay" style={{ zIndex: 50000 }} onClick={() => setModalOpen(false)}>
            <div
              ref={containerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Brief context"
              tabIndex={-1}
              className="generate-proposal-modal"
              style={{ maxWidth: 600, height: 'min(660px, 85vh)', outline: 'none' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ── Header ────────────────────────────────────────── */}
              <div className="generate-proposal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3>Brief</h3>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: completenessColor,
                      background:
                        tier1Count === 3
                          ? 'color-mix(in srgb, var(--success, #22c55e) 12%, transparent)'
                          : tier1Count > 0
                            ? 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)'
                            : 'color-mix(in srgb, var(--muted) 12%, transparent)',
                      padding: '2px 8px',
                      borderRadius: 20,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {tier1Count}/3 Required
                  </span>
                </div>
                <button className="chat-v2-panel-toggle" aria-label="Close" onClick={() => setModalOpen(false)}>
                  <Icon icon={X} size="sm" />
                </button>
              </div>

              {/* ── Tab bar ───────────────────────────────────────── */}
              <div
                style={{
                  height: 44,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'stretch',
                  padding: '0 20px',
                  borderBottom: '1px solid var(--color-border)',
                  gap: 4,
                }}
              >
                {TABS.map(({ key, label }) => {
                  const active = activeTab === key;
                  const { filled, total } = tabCounts[key];
                  const allFilled = filled === total;
                  const someFilled = filled > 0 && !allFilled;
                  const dotColor = allFilled
                    ? 'var(--success, #22c55e)'
                    : someFilled
                      ? 'var(--warning, #f59e0b)'
                      : 'var(--muted)';
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      style={{
                        padding: '0 14px',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 13,
                        fontWeight: active ? 600 : 400,
                        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
                        borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
                        marginBottom: -1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'color 0.15s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>{label}</span>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: dotColor,
                          flexShrink: 0,
                        }}
                      />
                    </button>
                  );
                })}
              </div>

              {/* ── Body — scrollable ─────────────────────────────── */}
              <div className="generate-proposal-body">
                {/* Tier 1 tab */}
                {activeTab === 'tier1' && (
                  <div>
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
                )}

                {/* Tier 2 tab */}
                {activeTab === 'tier2' && (
                  <div>
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
                )}

                {/* Tier 3 tab — fields + Knowledge + Sources */}
                {activeTab === 'tier3' && (
                  <div>
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

                    {/* Knowledge */}
                    {allKnowledgeEntries.length > 0 && (
                      <div style={{ marginTop: 20 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--muted)',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            marginBottom: 8,
                            paddingTop: 4,
                          }}
                        >
                          Knowledge ({allKnowledgeEntries.length})
                        </div>
                        <div
                          style={{
                            maxHeight: showAllKnowledge ? 280 : 'none',
                            overflowY: showAllKnowledge ? 'auto' : 'visible',
                          }}
                        >
                          {visibleKnowledge.map((entry: KnowledgeEntry) => (
                            <div
                              key={entry.id}
                              style={{
                                display: 'flex',
                                gap: 8,
                                padding: '5px 0',
                                borderBottom: '1px solid var(--border)',
                                alignItems: 'flex-start',
                              }}
                            >
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: KNOWLEDGE_CATEGORY_COLORS[entry.category] ?? 'var(--muted)',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                  paddingTop: 1,
                                  minWidth: 72,
                                }}
                              >
                                {KNOWLEDGE_CATEGORY_LABELS[entry.category] ?? entry.category}
                              </span>
                              {editingId === entry.id ? (
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <textarea
                                    autoFocus
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    rows={3}
                                    style={{
                                      fontSize: 12,
                                      width: '100%',
                                      resize: 'vertical',
                                      padding: '4px 6px',
                                      border: '1px solid var(--primary)',
                                      borderRadius: 4,
                                      background: 'var(--panel-soft)',
                                      color: 'var(--text)',
                                    }}
                                  />
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      onClick={() => handleKnowledgeSave(entry.id)}
                                      disabled={editValue.trim() === ''}
                                      style={{
                                        fontSize: 11,
                                        padding: '2px 8px',
                                        cursor: 'pointer',
                                        background: 'var(--primary)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 3,
                                      }}
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={handleKnowledgeCancel}
                                      style={{
                                        fontSize: 11,
                                        padding: '2px 8px',
                                        cursor: 'pointer',
                                        background: 'none',
                                        border: '1px solid var(--border)',
                                        borderRadius: 3,
                                        color: 'var(--text)',
                                      }}
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
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: 2,
                                      color: 'var(--muted)',
                                      lineHeight: 1,
                                    }}
                                  >
                                    <Icon icon={Pencil} size="sm" />
                                  </button>
                                  <button
                                    onClick={() => handleKnowledgeDelete(entry.id)}
                                    title="Delete"
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: 2,
                                      color: 'var(--muted)',
                                      lineHeight: 1,
                                    }}
                                  >
                                    <Icon icon={Trash2} size="sm" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {allKnowledgeEntries.length > 5 && (
                          <button
                            onClick={() => setShowAllKnowledge((v) => !v)}
                            style={{
                              fontSize: 11,
                              color: 'var(--primary)',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '4px 0',
                              marginTop: 2,
                            }}
                          >
                            {showAllKnowledge ? 'Show fewer' : `Show all (${allKnowledgeEntries.length})`}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Source pool */}
                    {(context?.sources ?? []).length > 0 && (
                      <div style={{ marginTop: 20 }}>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: 'var(--muted)',
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            marginBottom: 8,
                            paddingTop: 4,
                          }}
                        >
                          Source Pool
                        </div>
                        {context!.sources.map((src, i) => (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '4px 0',
                              fontSize: 12,
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            <span style={{ flexShrink: 0 }}>
                              {SOURCE_ICONS[src.classification ?? ''] ?? <Icon icon={FileText} size="sm" />}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: 'var(--text)',
                              }}
                            >
                              {src.fileName}
                            </span>
                            <span style={{ flexShrink: 0, color: 'var(--muted)', fontSize: 11 }}>
                              {[
                                src.fieldsExtracted.length > 0 ? `${src.fieldsExtracted.length} fields` : null,
                                src.knowledgeEntriesCreated > 0 ? `${src.knowledgeEntriesCreated} knowledge` : null,
                              ]
                                .filter(Boolean)
                                .join(' · ') || '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>,
          document.body,
        )
      : null;

  return <>{modal}</>;
}
