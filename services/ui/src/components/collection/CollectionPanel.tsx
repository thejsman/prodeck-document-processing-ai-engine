// services/ui/src/components/collection/CollectionPanel.tsx
//
// Right panel component that shows client data collection progress.
// Displays: completeness meter, filled/missing fields, industry schema,
// branding preview, and next steps.
//
// This component reads from the useCollectionStatus hook and renders
// a live-updating progress view.

'use client';

import { useMemo } from 'react';
import { Check, Circle, AlertCircle, Globe, Palette, ChevronRight } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import type { CollectionStatus, IndustryField, BrandingKit } from '@/lib/use-collection-status';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  status: CollectionStatus | null;
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Base field labels
// ---------------------------------------------------------------------------

const BASE_LABELS: Record<string, string> = {
  clientName: 'Client name',
  clientIndustry: 'Industry',
  projectType: 'Service type',
  budget: 'Budget',
  timeline: 'Timeline',
  teamSize: 'Team size',
  technicalStack: 'Tech stack',
  keyObjectives: 'Objectives',
  constraints: 'Constraints',
  deliverables: 'Deliverables',
  stakeholders: 'Stakeholders',
  contactName: 'Contact',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollectionPanel({ status, loading }: Props) {
  if (loading && !status) {
    return (
      <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>
        Loading collection status...
      </div>
    );
  }

  if (!status) {
    return (
      <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>
        Select a namespace to see collection progress.
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Industry section */}
      {status.industryDetected && (
        <IndustrySection status={status} />
      )}

      {/* Branding */}
      {status.hasBranding && status.brandingKit && (
        <BrandingSection brandingKit={status.brandingKit} />
      )}

      {/* Next steps */}
      {status.nextQuestions.length > 0 && (
        <NextStepsSection questions={status.nextQuestions} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CompletenessSection({ status }: { status: CollectionStatus }) {
  const color = status.overallCompleteness >= 80
    ? 'var(--success, #22c55e)'
    : status.overallCompleteness >= 50
      ? 'var(--warning, #eab308)'
      : 'var(--muted)';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Collection progress</span>
        <span style={{ fontSize: 13, fontWeight: 600, color }}>{status.overallCompleteness}%</span>
      </div>
      {/* Progress bar */}
      <div style={{
        width: '100%', height: 6, borderRadius: 3,
        background: 'var(--border)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${status.overallCompleteness}%`,
          height: '100%',
          borderRadius: 3,
          background: color,
          transition: 'width 0.4s ease, background 0.4s ease',
        }} />
      </div>
      {/* Sub-scores */}
      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
        <span>Base: {status.baseCompleteness}%</span>
        {status.industryDetected && <span>Industry: {status.industryCompleteness}%</span>}
        {status.hasBranding && <span>Branding: ✓</span>}
      </div>
      {/* Ready badge */}
      {status.proposalReady && (
        <div style={{
          marginTop: 8, padding: '6px 10px', borderRadius: 6,
          background: 'var(--success-bg, rgba(34,197,94,0.1))',
          color: 'var(--success, #22c55e)',
          fontSize: 12, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon icon={Check} size="sm" />
          Ready to generate proposal
        </div>
      )}
    </div>
  );
}

function FieldsSection({
  title,
  filled,
  missing,
  labels,
}: {
  title: string;
  filled: string[];
  missing: string[];
  labels: Record<string, string>;
}) {
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filled.map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)' }}>
            <Icon icon={Check} size="sm" style={{ color: 'var(--success, #22c55e)', flexShrink: 0 }} />
            <span>{labels[key] ?? key}</span>
          </div>
        ))}
        {missing.map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
            <Icon icon={Circle} size="sm" style={{ opacity: 0.4, flexShrink: 0 }} />
            <span>{labels[key] ?? key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IndustrySection({ status }: { status: CollectionStatus }) {
  const filledIndustry = status.industryFieldsFilled;
  const missingIndustry = status.industryFieldsMissing;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
          {status.industryName} fields
        </p>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 4,
          background: 'var(--primary-bg, rgba(99,102,241,0.1))',
          color: 'var(--primary, #6366f1)',
          fontWeight: 500,
        }}>
          {status.industryCompleteness}%
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filledIndustry.map(key => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text)' }}>
            <Icon icon={Check} size="sm" style={{ color: 'var(--success, #22c55e)', flexShrink: 0 }} />
            <span>{key.replace(/_/g, ' ')}</span>
          </div>
        ))}
        {missingIndustry.map(field => (
          <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted)' }}>
            <Icon
              icon={field.priority === 'must_have' ? AlertCircle : Circle}
              size="sm"
              style={{
                opacity: field.priority === 'must_have' ? 0.8 : 0.4,
                flexShrink: 0,
                color: field.priority === 'must_have' ? 'var(--warning, #eab308)' : undefined,
              }}
            />
            <span>{field.label}</span>
            {field.priority === 'must_have' && (
              <span style={{ fontSize: 10, color: 'var(--warning, #eab308)', fontWeight: 500 }}>required</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandingSection({ brandingKit }: { brandingKit: BrandingKit }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon icon={Palette} size="sm" style={{ color: 'var(--muted)' }} />
        <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0 }}>
          Branding
        </p>
      </div>
      {/* Color swatches */}
      {brandingKit.colors.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {brandingKit.colors.slice(0, 6).map((color, i) => (
            <div
              key={i}
              title={`${color.hex} (${color.usage})`}
              style={{
                width: 28, height: 28, borderRadius: 6,
                background: color.hex,
                border: '1px solid var(--border)',
                cursor: 'default',
              }}
            />
          ))}
        </div>
      )}
      {/* Typography */}
      {brandingKit.typography.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {brandingKit.typography.map((t, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              <span style={{ fontFamily: t.fontFamily }}>{t.fontFamily}</span>
              <span style={{ opacity: 0.5 }}> ({t.usage})</span>
            </span>
          ))}
        </div>
      )}
      {/* Visual tone */}
      {brandingKit.visualTone && (
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, opacity: 0.7 }}>
          Tone: {brandingKit.visualTone}
        </div>
      )}
    </div>
  );
}

function NextStepsSection({ questions }: { questions: IndustryField[] }) {
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Next to collect
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {questions.map(q => (
          <div key={q.key} style={{
            padding: '8px 10px', borderRadius: 6,
            background: 'var(--panel-soft)',
            border: '1px solid var(--border)',
            fontSize: 12, color: 'var(--text)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Icon icon={ChevronRight} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <span>{q.label}</span>
            <span style={{
              marginLeft: 'auto', fontSize: 10, opacity: 0.5,
              color: q.priority === 'must_have' ? 'var(--warning, #eab308)' : 'var(--muted)',
            }}>
              {q.priority.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
