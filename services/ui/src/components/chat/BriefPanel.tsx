'use client';

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, FileText, MessageSquare } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useBrief } from '@/hooks/useBrief';
import { BriefField, FIELD_LABELS } from './BriefField';
import type { RequirementKey, RequirementField } from '@/lib/api';

const TIER1_KEYS: RequirementKey[] = ['clientName', 'clientIndustry', 'projectType'];
const TIER2_KEYS: RequirementKey[] = ['budget', 'timeline', 'keyObjectives', 'contactName'];
const TIER3_KEYS: RequirementKey[] = ['technicalStack', 'constraints', 'deliverables', 'teamSize', 'stakeholders'];

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
  onGenerateProposal?: () => void;
}

export function BriefPanel({ namespace, apiKey, onAskField, onGenerateProposal }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { context, readiness, updateField, confirm, canGenerate, blockingField } = useBrief(namespace, apiKey);

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
        <div style={{ padding: '0 16px 16px' }}>

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
                    {src.fieldsExtracted.length} fields
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Generate button */}
          <div style={{ paddingTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <button
                className={`btn btn-sm${canGenerate ? ' btn-primary' : ''}`}
                disabled={!canGenerate}
                onClick={() => canGenerate && onGenerateProposal?.()}
                style={{
                  opacity: canGenerate ? 1 : 0.5,
                  cursor: canGenerate ? 'pointer' : 'not-allowed',
                  height: 32,
                  padding: '0 14px',
                  fontSize: 13,
                }}
                title={!canGenerate && blockingField ? `Fill in ${FIELD_LABELS[blockingField as RequirementKey] ?? blockingField} before generating` : undefined}
              >
                Generate Proposal ▶
              </button>
            </div>
            {!canGenerate && blockingField && (
              <span style={{ fontSize: 12, color: 'var(--warning, #f59e0b)' }}>
                ⚠ {FIELD_LABELS[blockingField as RequirementKey] ?? blockingField} missing
              </span>
            )}
            {readiness && (
              <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                Tier 1: {3 - (readiness.tier1.missingFields.length)}/3
                {readiness.tier2.missingFields.length > 0 && (
                  <span style={{ marginLeft: 4 }}>· {readiness.tier2.missingFields.length} Tier 2 missing</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
