'use client';

import { useState, useEffect } from 'react';
import { FileText, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useExtractionCardStore, type ExtractionCardField } from '@/core/extraction/extraction-card-store';
import type { RequirementKey, DocumentClassification } from '@/lib/api';
import { FIELD_LABELS } from './BriefField';
import { ExtractionFieldRow } from './ExtractionFieldRow';
import { ReclassificationPicker } from './ReclassificationPicker';
import { ConflictResolver } from './ConflictResolver';
import { KnowledgeEntryList } from './KnowledgeEntryList';

interface Props {
  cardId: string;
  namespace: string;
  apiKey: string;
  onConfirm: (
    cardId: string,
    overrides?: Record<string, { value: string }>,
    resolvedConflicts?: Record<RequirementKey, string>,
  ) => Promise<void>;
  onDiscard: (cardId: string) => Promise<void>;
  onReclassify?: (cardId: string, newClassification: DocumentClassification) => Promise<void>;
  onFill?: (cardId: string, fieldKey: RequirementKey) => void;
}

// ── Field indicator by confidence ─────────────────────────────────

function FieldIndicator({ confidence, hasConflict }: { confidence: number; hasConflict?: boolean }) {
  if (hasConflict) {
    return <span style={{ color: 'var(--danger, #ef4444)', fontSize: 13 }}>⚠</span>;
  }
  if (confidence >= 0.8) {
    return <span style={{ color: 'var(--success, #22c55e)', fontSize: 13 }}>●</span>;
  }
  if (confidence >= 0.5) {
    return <span style={{ color: 'var(--warning, #f59e0b)', fontSize: 13 }}>◐</span>;
  }
  return <span style={{ color: 'var(--danger, #ef4444)', fontSize: 13 }}>◌</span>;
}

// suppress unused warning — FieldIndicator used below
void FieldIndicator;

// ── Empty / reference card ────────────────────────────────────────

function EmptyCard({ fileName, classification, onReclassify, cardId }: {
  fileName: string;
  classification: DocumentClassification;
  cardId: string;
  onReclassify?: (cardId: string, newClassification: DocumentClassification) => Promise<void>;
}) {
  const isRef = classification === 'reference_example';
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <Icon icon={FileText} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📄 <strong>{fileName}</strong>
        </span>
      </div>
      <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--muted)' }}>
        {isRef
          ? 'Stored for style reference only — no facts will be extracted from this document into the Brief.'
          : 'No Brief fields extracted — this document is classified as a Provider Asset, so its content won\'t be used as client facts.'}
        {!isRef && (
          <div style={{ marginTop: 4, color: 'var(--text)' }}>
            It's available as context for proposal generation.
          </div>
        )}
      </div>
      {onReclassify && (
        <div style={footerStyle}>
          <button className="btn btn-sm" style={btnStyle} onClick={() => onReclassify(cardId, classification)}>
            Reclassify document
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  maxWidth: 520,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--panel-soft)',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '10px 14px',
  borderTop: '1px solid var(--border)',
  flexWrap: 'wrap',
};

const btnStyle: React.CSSProperties = {
  height: 28,
  padding: '0 12px',
  fontSize: 12,
};

const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
};

// ── Main component ────────────────────────────────────────────────

export function ExtractionConfirmationCard({
  cardId,
  onConfirm,
  onDiscard,
  onReclassify,
  onFill,
}: Props) {
  const card = useExtractionCardStore((s) => s.cards[cardId]);
  const updateCardState = useExtractionCardStore((s) => s.updateCardState);

  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [resolvingConflicts, setResolvingConflicts] = useState(false);
  const [resolvedConflicts, setResolvedConflicts] = useState<Record<RequirementKey, string> | undefined>();

  // TTL expiry timer
  useEffect(() => {
    if (!card || card.cardState !== 'pending') return;
    const msUntilExpiry = new Date(card.expiresAt).getTime() - Date.now();
    if (msUntilExpiry <= 0) {
      updateCardState(cardId, 'expired');
      return;
    }
    const timer = setTimeout(() => updateCardState(cardId, 'expired'), msUntilExpiry);
    return () => clearTimeout(timer);
  }, [card?.expiresAt, card?.cardState, cardId, updateCardState]);

  if (!card) return null;

  const { fileName, classification, extractedFields, knowledgeEntryCount, cardState, confirmedSummary } = card;

  // ── Collapsed states ───────────────────────────────────────────

  if (cardState === 'confirmed') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 13, color: 'var(--muted)', background: 'var(--panel-soft)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <Icon icon={CheckCircle} size="sm" style={{ color: 'var(--success, #22c55e)', flexShrink: 0 }} />
        <span>
          <strong>{fileName}</strong> confirmed
          {confirmedSummary && ` — ${confirmedSummary.fieldsWritten} field${confirmedSummary.fieldsWritten !== 1 ? 's' : ''} added to Brief`}
        </span>
      </div>
    );
  }

  if (cardState === 'discarded') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 13, color: 'var(--muted)', background: 'var(--panel-soft)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <Icon icon={XCircle} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <span>⊘ <strong>{fileName}</strong> discarded</span>
      </div>
    );
  }

  if (cardState === 'expired') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontSize: 13, color: 'var(--muted)', background: 'var(--panel-soft)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <Icon icon={Clock} size="sm" style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0 }} />
        <span>⏱ <strong>{fileName}</strong> expired — re-upload to extract again</span>
      </div>
    );
  }

  // ── Empty / reference classification ─────────────────────────

  if (classification === 'provider_asset' || classification === 'reference_example') {
    return (
      <EmptyCard
        fileName={fileName}
        classification={classification}
        cardId={cardId}
        onReclassify={onReclassify}
      />
    );
  }

  // ── Reclassify panel (full-card replacement) ──────────────────

  if (reclassifying) {
    return (
      <ReclassificationPicker
        fileName={fileName}
        currentClassification={classification}
        onConfirm={async (newClassification) => {
          if (onReclassify) await onReclassify(cardId, newClassification);
          setReclassifying(false);
        }}
        onCancel={() => setReclassifying(false)}
      />
    );
  }

  // ── Conflict resolver (full-card replacement) ─────────────────

  const conflictRecords = extractedFields
    .filter((f) => f.conflict)
    .map((f) => f.conflict!);

  if (resolvingConflicts && conflictRecords.length > 0) {
    return (
      <ConflictResolver
        conflicts={conflictRecords}
        onResolved={(resolutions) => {
          setResolvedConflicts(resolutions);
          setResolvingConflicts(false);
        }}
        onCancel={() => setResolvingConflicts(false)}
      />
    );
  }

  // ── Standard card (pending state) ────────────────────────────

  const highConfFields = extractedFields.filter((f) => f.confidence >= 0.8 && !f.conflict);
  const lowConfFields = extractedFields.filter((f) => f.confidence < 0.8 && !f.conflict);
  const conflictFields = extractedFields.filter((f) => f.conflict);
  const hasUnresolvedConflicts = conflictFields.length > 0 && !resolvedConflicts;

  function startEdit() {
    const init: Record<string, string> = {};
    for (const f of extractedFields) {
      init[f.key] = Array.isArray(f.value) ? (f.value as unknown[]).join(', ') : String(f.value ?? '');
    }
    setEditFields(init);
    setEditing(true);
  }

  async function handleConfirmAll() {
    setConfirming(true);
    try {
      const overrides = editing
        ? Object.fromEntries(
            Object.entries(editFields).map(([k, v]) => [k, { value: v }]),
          ) as Record<string, { value: string }>
        : undefined;
      await onConfirm(cardId, overrides, resolvedConflicts);
    } finally {
      setConfirming(false);
    }
  }

  async function handleDiscard() {
    setDiscarding(true);
    try {
      await onDiscard(cardId);
    } finally {
      setDiscarding(false);
    }
  }

  function renderFieldRow(f: ExtractionCardField) {
    return (
      <ExtractionFieldRow
        key={f.key}
        fieldKey={f.key}
        value={f.value}
        confidence={f.confidence}
        conflict={f.conflict}
        isEditing={editing}
        editValue={editFields[f.key] ?? String(f.value ?? '')}
        onEditChange={(key, val) => setEditFields((prev) => ({ ...prev, [key]: val }))}
        onFill={onFill ? (key) => onFill(cardId, key) : undefined}
        onResolve={conflictFields.length > 0 ? () => setResolvingConflicts(true) : undefined}
      />
    );
  }

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <Icon icon={FileText} size="sm" style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📄 <strong>{fileName}</strong>
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          Here's what I extracted:
        </div>

        {/* Conflict fields */}
        {conflictFields.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, fontSize: 12, color: 'var(--danger, #ef4444)' }}>
              <Icon icon={AlertTriangle} size="xs" />
              <span>
                {resolvedConflicts
                  ? `${conflictFields.length} conflict${conflictFields.length !== 1 ? 's' : ''} resolved ✓`
                  : `${conflictFields.length} conflict${conflictFields.length !== 1 ? 's' : ''} found — resolve before confirming`}
              </span>
            </div>
            {conflictFields.map(renderFieldRow)}
          </div>
        )}

        {/* High-confidence fields */}
        {highConfFields.map(renderFieldRow)}

        {/* Low-confidence collapsible section */}
        {lowConfFields.length > 0 && (
          <details style={{ marginTop: 4 }}>
            <summary style={{ fontSize: 12, color: 'var(--muted)', cursor: 'pointer', padding: '4px 0' }}>
              Less certain — review these ({lowConfFields.length})
            </summary>
            <div style={{ paddingTop: 4 }}>
              {lowConfFields.map(renderFieldRow)}
            </div>
          </details>
        )}

        {/* Knowledge entries */}
        <KnowledgeEntryList count={knowledgeEntryCount} />
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <button
          className="btn btn-sm btn-primary"
          style={btnPrimaryStyle}
          onClick={handleConfirmAll}
          disabled={confirming || hasUnresolvedConflicts}
          title={hasUnresolvedConflicts ? 'Resolve conflicts before confirming' : undefined}
        >
          {confirming ? 'Confirming…' : editing ? 'Save & Confirm' : 'Confirm all'}
        </button>

        {!editing && (
          <button className="btn btn-sm" style={btnStyle} onClick={startEdit}>
            Edit before confirming
          </button>
        )}
        {editing && (
          <button className="btn btn-sm" style={btnStyle} onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}

        {conflictFields.length > 0 && !resolvedConflicts && (
          <button
            className="btn btn-sm"
            style={{ ...btnStyle, color: 'var(--danger, #ef4444)', borderColor: 'var(--danger, #ef4444)' }}
            onClick={() => setResolvingConflicts(true)}
          >
            Resolve conflicts
          </button>
        )}

        {onReclassify && (
          <button className="btn btn-sm" style={btnStyle} onClick={() => setReclassifying(true)}>
            Reclassify document
          </button>
        )}

        <button
          className="btn btn-sm"
          style={{ ...btnStyle, color: 'var(--muted)', marginLeft: 'auto' }}
          onClick={handleDiscard}
          disabled={discarding}
        >
          {discarding ? 'Discarding…' : 'Discard'}
        </button>
      </div>
    </div>
  );
}
