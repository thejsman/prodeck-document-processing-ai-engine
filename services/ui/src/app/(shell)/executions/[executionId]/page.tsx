'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { fetchExecutionTrace } from '@/lib/api'
import type { ExecutionTrace, TraceStep } from '@/lib/api'
import { useTraceStore, useLiveSteps } from '@/core/execution/trace-store'
import { getTransportMode } from '@/core/execution/execution-transport'
import { useExecutionStore } from '@/core/execution/execution-store'
import { ExecutionSummaryCard } from '@/components/execution-trace/ExecutionSummaryCard'
import { ExecutionTimeline } from '@/components/execution-trace/ExecutionTimeline'
import { ExecutionStepDetailPanel } from '@/components/execution-trace/ExecutionStepDetailPanel'

// ── Skeleton ──────────────────────────────────────────────────────

function TraceSkeleton() {
  return (
    <div className="container">
      <div className="trace-skeleton-header" />
      <div className="trace-skeleton-card" />
      <div className="trace-skeleton-steps">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="trace-skeleton-step" />
        ))}
      </div>
    </div>
  )
}

// ── Live badge ────────────────────────────────────────────────────

function LiveBadge() {
  return (
    <span className="trace-live-badge" aria-label="Live execution updates active">
      <span className="trace-live-dot" aria-hidden="true" />
      Live execution
    </span>
  )
}

function TransportWarning({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="trace-transport-warning">
      <span>Live updates unavailable</span>
      <button className="btn btn-sm" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────

export default function ExecutionTracePage() {
  const { executionId } = useParams<{ executionId: string }>()
  const router = useRouter()
  const { apiKey } = useAuth()

  const [trace, setTrace] = useState<ExecutionTrace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)

  // Live trace state from store
  const liveTrace = useTraceStore((s) => s.traces[executionId])
  const liveSteps = useLiveSteps(executionId)
  const isLive = liveTrace?.live === true

  // Effective steps — live store wins over REST snapshot
  const steps: TraceStep[] = liveSteps.length > 0 ? liveSteps : (trace?.steps ?? [])

  // Derive selected step from current steps so it reflects live updates
  const selectedStep = selectedStepId
    ? (steps.find((s) => s.id === selectedStepId) ?? null)
    : null

  // ── Initial REST fetch ──────────────────────────────────────────

  const loadTrace = useCallback(() => {
    if (!executionId || !apiKey) return
    setLoading(true)
    fetchExecutionTrace(apiKey, executionId)
      .then((t) => {
        setTrace(t)
        const shouldGoLive = t.status === 'RUNNING' || t.status === 'PENDING'
        useTraceStore.getState().setInitialTrace(executionId, t.steps, shouldGoLive)
      })
      .catch(() => {
        // The REST trace endpoint may not exist yet for in-progress executions —
        // they stream steps via SSE into the client store. If we find the execution
        // there, synthesise a minimal trace and enter live mode instead of 404-ing.
        const stored = useExecutionStore.getState().executions[executionId]
        if (stored) {
          const statusMap: Record<string, ExecutionTrace['status']> = {
            running: 'RUNNING', queued: 'PENDING',
            completed: 'COMPLETED', failed: 'FAILED',
          }
          const synthetic: ExecutionTrace = {
            executionId: stored.id,
            status: statusMap[stored.status] ?? 'RUNNING',
            type: stored.type,
            steps: [],
          }
          setTrace(synthetic)
          const shouldGoLive = stored.status === 'running' || stored.status === 'queued'
          useTraceStore.getState().setInitialTrace(executionId, [], shouldGoLive)
        } else {
          setError('Execution not found')
        }
      })
      .finally(() => setLoading(false))
  }, [executionId, apiKey])

  useEffect(() => {
    loadTrace()
  }, [loadTrace])

  // ── Re-fetch metadata when execution completes ──────────────────

  const prevLiveRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (prevLiveRef.current === true && !isLive) {
      // Execution just finished — re-fetch REST trace for final metadata
      if (apiKey && executionId) {
        fetchExecutionTrace(apiKey, executionId)
          .then(setTrace)
          .catch(() => {}) // silent — live steps are still displayed
      }
    }
    prevLiveRef.current = isLive
  }, [isLive, apiKey, executionId])

  // ── Auto-scroll timeline to newest step ────────────────────────

  const timelineBottomRef = useRef<HTMLDivElement>(null)
  const prevStepCountRef = useRef(0)

  useEffect(() => {
    if (!isLive) return
    if (steps.length > prevStepCountRef.current) {
      timelineBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    prevStepCountRef.current = steps.length
  }, [steps.length, isLive])

  // ── Handlers ───────────────────────────────────────────────────

  function toggleStep(id: string) {
    setSelectedStepId((prev) => (prev === id ? null : id))
  }

  // ── Render ─────────────────────────────────────────────────────

  if (loading) return <TraceSkeleton />

  if (error || !trace) {
    return (
      <div className="container">
        <button className="btn btn-sm" onClick={() => router.back()}>
          ← Back
        </button>
        <div className="trace-error-state">
          <p>Failed to load execution trace.</p>
          {error && <p className="muted">{error}</p>}
        </div>
      </div>
    )
  }

  const transportWarning = isLive && getTransportMode() === 'polling'

  return (
    <div className="container">
      <div className="trace-page-header">
        <button className="btn btn-sm" onClick={() => router.back()}>
          ← Back
        </button>
        <div className="trace-page-heading">
          <div className="trace-page-title-row">
            <h1 className="trace-page-title">Execution Trace</h1>
            {isLive && <LiveBadge />}
          </div>
          <span className="trace-page-id">{executionId}</span>
        </div>
      </div>

      {trace.status === 'FAILED' && (
        <div className="trace-failure-banner">
          This execution failed — inspect the steps below for details.
        </div>
      )}

      {transportWarning && <TransportWarning onRefresh={loadTrace} />}

      <ExecutionSummaryCard trace={trace} />

      {steps.length === 0 && isLive ? (
        <div className="trace-empty-state trace-empty-state--live">
          <span className="trace-live-dot trace-live-dot--lg" aria-hidden="true" />
          <p>Waiting for first step…</p>
        </div>
      ) : steps.length === 0 ? (
        <div className="trace-empty-state">
          <p>Trace not available</p>
        </div>
      ) : (
        <div className={`trace-layout${selectedStep ? ' trace-layout--has-panel' : ''}`}>
          <ExecutionTimeline
            steps={steps}
            selectedStepId={selectedStepId}
            onSelectStep={toggleStep}
          />
          {/* Sentinel for auto-scroll */}
          <div ref={timelineBottomRef} />
          {selectedStep && (
            <ExecutionStepDetailPanel
              step={selectedStep}
              onClose={() => setSelectedStepId(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
