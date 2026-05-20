'use client';

import { useState, useCallback } from 'react';
import { Pencil, Trash2, FileText } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useBrief } from '@/hooks/useBrief';
import { BriefField } from './BriefField';
import type { RequirementKey, RequirementField, KnowledgeEntry } from '@/lib/api';
import type { CollectionStatus } from '@/lib/use-collection-status';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER1_KEYS: RequirementKey[] = ['clientName', 'clientIndustry', 'projectType'];
const TIER2_KEYS: RequirementKey[] = ['budget', 'timeline', 'keyObjectives', 'contactName'];
const TIER3_KEYS: RequirementKey[] = ['technicalStack', 'constraints', 'deliverables', 'teamSize', 'stakeholders'];

const KNOWLEDGE_CATEGORY_LABELS: Record<string, string> = {
  priority: 'Priority', problem: 'Problem', requirement: 'Requirement',
  opportunity: 'Opportunity', constraint: 'Constraint', metric: 'Metric',
  decision: 'Decision', action_item: 'Action', context: 'Context', preference: 'Preference',
};

const KNOWLEDGE_CATEGORY_COLORS: Record<string, string> = {
  priority: 'var(--primary)', problem: 'var(--danger,#ef4444)',
  requirement: 'var(--primary)', opportunity: 'var(--success,#22c55e)',
  constraint: 'var(--warning,#f59e0b)', metric: 'var(--muted)',
  decision: 'var(--success,#22c55e)', action_item: 'var(--warning,#f59e0b)',
  context: 'var(--muted)', preference: 'var(--muted)',
};

const SOURCE_ICONS: Record<string, string> = {
  client_source: '📄', conversation: '💬', provider_asset: '📎',
  reference_example: '🔗', background: '📚',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  namespace: string;
  apiKey: string;
  onAskField?: (question: string) => void;
  collectionStatus?: CollectionStatus | null;
  hidePanelHeading?: boolean;
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({
  label, filled, total, accent,
}: { label: string; filled: number; total: number; accent?: string }) {
  const all = filled === total;
  const some = filled > 0 && !all;
  const dotColor = accent ?? (all ? 'var(--success,#22c55e)' : some ? 'var(--warning,#f59e0b)' : 'var(--border)');
  return (
    <div className="brief-panel-section-header">
      <span className="brief-panel-section-dot" style={{ background: dotColor }} />
      <span className="brief-panel-section-label">{label}</span>
      <span className="brief-panel-section-count">{filled}/{total}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BriefSidePanel({ namespace, apiKey, onAskField, collectionStatus, hidePanelHeading }: Props) {
  const [showAllKnowledge, setShowAllKnowledge] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const { context, updateField, confirm, updateKnowledge, deleteKnowledge } = useBrief(namespace, apiKey);

  const fields = context?.requirements?.fields ?? {};

  const handleEdit = useCallback(async (key: RequirementKey, value: unknown) => {
    await updateField(key, value);
  }, [updateField]);

  const handleAsk = useCallback((question: string) => {
    onAskField?.(question);
  }, [onAskField]);

  const handleConfirm = useCallback(async (key: RequirementKey, field: RequirementField) => {
    await confirm({ [key]: { value: field.value, confidence: 1.0, source: 'user' } });
  }, [confirm]);

  const handleKnowledgeSave = useCallback(async (id: string) => {
    await updateKnowledge(id, editValue);
    setEditingId(null);
    setEditValue('');
  }, [updateKnowledge, editValue]);

  const handleKnowledgeDelete = useCallback(async (id: string) => {
    if (editingId === id) { setEditingId(null); setEditValue(''); }
    await deleteKnowledge(id);
  }, [deleteKnowledge, editingId]);

  const t1Filled = TIER1_KEYS.filter(k => fields[k]?.value).length;
  const t2Filled = TIER2_KEYS.filter(k => fields[k]?.value).length;
  const t3Filled = TIER3_KEYS.filter(k => fields[k]?.value).length;

  const allKnowledge = (context?.knowledge ?? []).filter((e: KnowledgeEntry) => !e.supersededBy);
  const sortedKnowledge = [...allKnowledge].sort((a, b) => b.importance - a.importance);
  const visibleKnowledge = showAllKnowledge ? sortedKnowledge : sortedKnowledge.slice(0, 6);

  const t1Color = t1Filled === 3 ? 'var(--success,#22c55e)' : t1Filled > 0 ? 'var(--warning,#f59e0b)' : undefined;

  return (
    <div className="brief-side-panel">

      {/* ── Panel heading ── */}
      {!hidePanelHeading && (
        <div className="brief-side-panel-heading">
          <span className="brief-side-panel-title">Brief</span>
          <span
            className="brief-side-panel-badge"
            style={{
              color: t1Color ?? 'var(--muted)',
              background: t1Color
                ? `color-mix(in srgb, ${t1Color} 12%, transparent)`
                : 'var(--panel-soft)',
            }}
          >
            {t1Filled}/3 required
          </span>
        </div>
      )}

      <div className="brief-side-panel-body">

        {/* ── Required ── */}
        <section className="brief-side-panel-section">
          <SectionHeader label="Required" filled={t1Filled} total={3} />
          <div className="brief-side-panel-fields">
            {TIER1_KEYS.map(k => (
              <BriefField
                key={k} fieldKey={k}
                field={fields[k] as RequirementField | undefined}
                onEdit={handleEdit} onAsk={handleAsk} onConfirm={handleConfirm}
              />
            ))}
          </div>
        </section>

        <div className="brief-side-panel-divider" />

        {/* ── Recommended ── */}
        <section className="brief-side-panel-section">
          <SectionHeader label="Recommended" filled={t2Filled} total={4} />
          <div className="brief-side-panel-fields">
            {TIER2_KEYS.map(k => (
              <BriefField
                key={k} fieldKey={k}
                field={fields[k] as RequirementField | undefined}
                onEdit={handleEdit} onAsk={handleAsk} onConfirm={handleConfirm}
              />
            ))}
          </div>
        </section>

        <div className="brief-side-panel-divider" />

        {/* ── Optional ── */}
        <section className="brief-side-panel-section">
          <SectionHeader label="Optional" filled={t3Filled} total={5} />
          <div className="brief-side-panel-fields">
            {TIER3_KEYS.map(k => (
              <BriefField
                key={k} fieldKey={k}
                field={fields[k] as RequirementField | undefined}
                onEdit={handleEdit} onAsk={handleAsk} onConfirm={handleConfirm}
              />
            ))}
          </div>
        </section>

        {/* ── Knowledge ── */}
        {allKnowledge.length > 0 && (
          <>
            <div className="brief-side-panel-divider" />
            <section className="brief-side-panel-section">
              <div className="brief-side-panel-section-header">
                <span className="brief-panel-section-dot" style={{ background: 'var(--primary)' }} />
                <span className="brief-panel-section-label">Knowledge</span>
                <span className="brief-panel-section-count">{allKnowledge.length}</span>
              </div>
              <div className="brief-knowledge-list">
                {visibleKnowledge.map((entry: KnowledgeEntry) => (
                  <div key={entry.id} className="brief-field-card">
                    <div className="brief-field-header">
                      <span
                        className="brief-field-dot"
                        style={{ background: KNOWLEDGE_CATEGORY_COLORS[entry.category] ?? 'var(--muted)' }}
                      />
                      <span className="brief-field-label">
                        {KNOWLEDGE_CATEGORY_LABELS[entry.category] ?? entry.category}
                      </span>
                      {editingId !== entry.id && (
                        <div className="brief-field-actions">
                          <button
                            onClick={() => { setEditingId(entry.id); setEditValue(entry.content); }}
                            title="Edit" className="brief-knowledge-icon-btn"
                          ><Icon icon={Pencil} size="sm" /></button>
                          <button
                            onClick={() => handleKnowledgeDelete(entry.id)}
                            title="Delete" className="brief-knowledge-icon-btn"
                          ><Icon icon={Trash2} size="sm" /></button>
                        </div>
                      )}
                    </div>
                    {editingId === entry.id ? (
                      <div className="brief-field-edit-body">
                        <textarea
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          rows={3}
                          className="brief-field-textarea"
                        />
                        <div className="brief-field-edit-actions">
                          <button
                            onClick={() => handleKnowledgeSave(entry.id)}
                            disabled={!editValue.trim()}
                            className="brief-knowledge-save-btn"
                          >Save</button>
                          <button
                            onClick={() => { setEditingId(null); setEditValue(''); }}
                            className="brief-knowledge-cancel-btn"
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="brief-field-value-row">
                        <span className="brief-knowledge-content">{entry.content}</span>
                      </div>
                    )}
                  </div>
                ))}
                {allKnowledge.length > 6 && (
                  <button className="brief-knowledge-show-more" onClick={() => setShowAllKnowledge(v => !v)}>
                    {showAllKnowledge ? 'Show fewer' : `+${allKnowledge.length - 6} more`}
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {/* ── Sources ── */}
        {(context?.sources ?? []).length > 0 && (
          <>
            <div className="brief-side-panel-divider" />
            <section className="brief-side-panel-section">
              <div className="brief-side-panel-section-header">
                <span className="brief-panel-section-dot" style={{ background: 'var(--muted)' }} />
                <span className="brief-panel-section-label">Sources</span>
                <span className="brief-panel-section-count">{context!.sources.length}</span>
              </div>
              <div className="brief-sources-list">
                {context!.sources.map((src, i) => (
                  <div key={i} className="brief-source-row">
                    <span className="brief-source-icon">
                      {SOURCE_ICONS[src.classification ?? ''] ?? <Icon icon={FileText} size="sm" />}
                    </span>
                    <span className="brief-source-name">{src.fileName}</span>
                    <span className="brief-source-meta">
                      {[
                        src.fieldsExtracted.length > 0 ? `${src.fieldsExtracted.length}f` : null,
                        src.knowledgeEntriesCreated > 0 ? `${src.knowledgeEntriesCreated}k` : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ── Industry (from collection) ── */}
        {collectionStatus?.industryDetected && (
          <>
            <div className="brief-side-panel-divider" />
            <section className="brief-side-panel-section">
              <div className="brief-side-panel-section-header">
                <span className="brief-panel-section-dot" style={{ background: 'var(--primary)' }} />
                <span className="brief-panel-section-label">{collectionStatus.industryName} Fields</span>
                <span className="brief-panel-section-count">{collectionStatus.industryCompleteness}%</span>
              </div>
              <div className="brief-side-panel-fields">
                {collectionStatus.industryFieldsFilled.map(k => (
                  <div key={k} className="brief-collection-field brief-collection-field--filled">
                    <span className="brief-collection-dot brief-collection-dot--filled" />
                    <span>{k}</span>
                  </div>
                ))}
                {collectionStatus.industryFieldsMissing.map((field) => (
                  <div key={field.key} className="brief-collection-field">
                    <span className="brief-collection-dot" />
                    <span>{field.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* ── Branding ── */}
        {collectionStatus?.hasBranding && collectionStatus.brandingKit && (
          <>
            <div className="brief-side-panel-divider" />
            <section className="brief-side-panel-section">
              <div className="brief-side-panel-section-header">
                <span className="brief-panel-section-dot" style={{ background: 'var(--muted)' }} />
                <span className="brief-panel-section-label">Branding</span>
              </div>
              {collectionStatus.brandingKit.colors.length > 0 && (
                <div className="brief-branding-colors">
                  {collectionStatus.brandingKit.colors.slice(0, 6).map((c, i) => (
                    <span key={i} className="brief-branding-swatch" style={{ background: c.hex }} title={c.hex} />
                  ))}
                </div>
              )}
              {collectionStatus.brandingKit.typography.length > 0 && (
                <div className="brief-branding-fonts">
                  {collectionStatus.brandingKit.typography.map((t, i) => (
                    <span key={i} className="brief-branding-font">{t.fontFamily}</span>
                  ))}
                </div>
              )}
              {collectionStatus.brandingKit.visualTone && (
                <span className="brief-branding-tone">Tone: {collectionStatus.brandingKit.visualTone}</span>
              )}
            </section>
          </>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
