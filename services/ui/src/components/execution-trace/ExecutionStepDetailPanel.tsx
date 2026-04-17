'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'
import type { TraceStep } from '@/lib/api'

const STATUS_BADGE: Record<string, string> = {
  completed: 'badge--ok',
  failed:    'badge--error',
  running:   'badge--running',
}

function formatDuration(step: TraceStep): string {
  if (step.endedAt == null || step.startedAt == null) return '—'
  const ms = step.endedAt - step.startedAt
  if (ms < 1_000) return `${ms}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}

interface Props {
  step: TraceStep
  onClose: () => void
}

export function ExecutionStepDetailPanel({ step, onClose }: Props) {
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div className="trace-detail-panel card">
      <div className="trace-detail-header">
        <span className="trace-detail-title">{step.name}</span>
        <button
          className="exec-drawer-close"
          onClick={onClose}
          aria-label="Close step detail"
        >
          <Icon icon={X} size="md" />
        </button>
      </div>

      <div className="trace-detail-body">
        <div className="trace-detail-meta-grid">
          <div className="trace-detail-row">
            <span className="trace-detail-label">Type</span>
            <span className="trace-detail-value">{step.type}</span>
          </div>
          <div className="trace-detail-row">
            <span className="trace-detail-label">Status</span>
            <span className={`badge ${STATUS_BADGE[step.status] ?? ''}`}>
              {step.status}
            </span>
          </div>
          <div className="trace-detail-row">
            <span className="trace-detail-label">Duration</span>
            <span className="trace-detail-value">{formatDuration(step)}</span>
          </div>
        </div>

        {step.inputSummary && (
          <div className="trace-detail-section">
            <div className="trace-detail-section-title">Input</div>
            <p className="trace-detail-text">{step.inputSummary}</p>
          </div>
        )}

        {step.outputSummary && (
          <div className="trace-detail-section">
            <div className="trace-detail-section-title">Output</div>
            <p className="trace-detail-text">{step.outputSummary}</p>
          </div>
        )}

        <div className="trace-detail-toggle">
          <button className="btn btn-sm" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
          </button>
        </div>

        {showRaw && (
          <pre className="trace-detail-raw">{JSON.stringify(step, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}
