'use client'

import { useRouter } from 'next/navigation'
import type { ExecutionTrace } from '@/lib/api'

const ARTIFACT_ROUTES: Record<string, string> = {
  PROPOSAL:  '/proposals',
  MICROSITE: '/microsites',
  RFP:       '/rfp',
  DIAGRAM:   '/diagrams',
  ANALYSIS:  '/analyses',
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  COMPLETED: 'badge--ok',
  FAILED:    'badge--error',
  RUNNING:   'badge--running',
  PENDING:   '',
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`
}

function formatTokens(n: number): string {
  return n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)
}

export function ExecutionSummaryCard({ trace }: { trace: ExecutionTrace }) {
  const router = useRouter()

  const artifactRoute =
    trace.artifactId && trace.type
      ? `${ARTIFACT_ROUTES[trace.type.toUpperCase()] ?? ''}/${trace.artifactId}`
      : null

  return (
    <div className="card trace-summary">
      <div className="trace-summary-top">
        <div className="trace-summary-left">
          <span className={`badge ${STATUS_BADGE_CLASS[trace.status] ?? ''}`}>
            {trace.status}
          </span>
          {trace.model && (
            <span className="trace-summary-model">{trace.model}</span>
          )}
        </div>
        {artifactRoute && (
          <button className="btn btn-sm" onClick={() => router.push(artifactRoute)}>
            Open Artifact
          </button>
        )}
      </div>

      <div className="metadata-bar">
        {trace.durationMs != null && (
          <span>
            <strong>Duration</strong> {formatDuration(trace.durationMs)}
          </span>
        )}
        {trace.tokens != null && (
          <span>
            <strong>Tokens</strong> {formatTokens(trace.tokens)}
          </span>
        )}
        {trace.cost != null && (
          <span>
            <strong>Cost</strong> ${trace.cost.toFixed(2)}
          </span>
        )}
        <span>
          <strong>Steps</strong> {trace.steps.length}
        </span>
      </div>
    </div>
  )
}
