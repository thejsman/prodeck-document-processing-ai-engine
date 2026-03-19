import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"
import type { TraceStep } from "@/lib/api"

// ── Types ──────────────────────────────────────────────────────────

const TRACE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_TRACES   = 50                   // evict oldest beyond this

export interface LiveTrace {
  executionId: string
  steps: TraceStep[]
  /** true while the execution is still running and receiving SSE updates */
  live: boolean
  /** wall-clock time the trace was last written — used for TTL eviction */
  savedAt: number
}

interface TraceStore {
  traces: Record<string, LiveTrace>

  setInitialTrace(executionId: string, steps: TraceStep[], live: boolean): void
  upsertTraceStep(executionId: string, step: TraceStep): void
  markTraceCompleted(executionId: string): void
}

// ── Helpers ────────────────────────────────────────────────────────

function sortByStartedAt(steps: TraceStep[]): TraceStep[] {
  return [...steps].sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * Drop traces older than TRACE_TTL_MS and keep only the MAX_TRACES newest.
 * Always keeps the entry being updated (identified by `keepId`).
 */
function evict(
  traces: Record<string, LiveTrace>,
  keepId: string,
): Record<string, LiveTrace> {
  const now = Date.now()
  const entries = Object.values(traces).filter(
    (t) => t.executionId === keepId || now - t.savedAt < TRACE_TTL_MS,
  )
  // Sort newest-first, keep up to MAX_TRACES
  entries.sort((a, b) => b.savedAt - a.savedAt)
  const retained = entries.slice(0, MAX_TRACES)
  return Object.fromEntries(retained.map((t) => [t.executionId, t]))
}

// ── Store ──────────────────────────────────────────────────────────

export const useTraceStore = create<TraceStore>()(
  persist(
    (set) => ({
      traces: {},

      setInitialTrace(executionId, steps, live) {
        set((state) => {
          const updated = {
            ...state.traces,
            [executionId]: {
              executionId,
              steps: sortByStartedAt(steps),
              live,
              savedAt: Date.now(),
            },
          }
          return { traces: evict(updated, executionId) }
        })
      },

      upsertTraceStep(executionId, step) {
        set((state) => {
          const existing = state.traces[executionId]
          const prev = existing?.steps ?? []
          const idx = prev.findIndex((s) => s.id === step.id)

          const next =
            idx === -1
              ? sortByStartedAt([...prev, step])
              : prev.map((s, i) => (i === idx ? { ...s, ...step } : s))

          const updated = {
            ...state.traces,
            [executionId]: {
              executionId,
              steps: next,
              live: existing?.live ?? true,
              savedAt: Date.now(),
            },
          }
          return { traces: evict(updated, executionId) }
        })
      },

      markTraceCompleted(executionId) {
        set((state) => {
          const existing = state.traces[executionId]
          if (!existing) return state
          const updated = {
            ...state.traces,
            [executionId]: { ...existing, live: false, savedAt: Date.now() },
          }
          return { traces: evict(updated, executionId) }
        })
      },
    }),
    {
      name: "ai-engine-traces",
      storage: createJSONStorage(() => localStorage),
      // Only persist completed (non-live) traces to avoid stale live flags
      partialize: (state) => ({
        traces: Object.fromEntries(
          Object.entries(state.traces).filter(([, t]) => !t.live),
        ),
      }),
    },
  ),
)

// ── Shallow selector helpers ───────────────────────────────────────

export function useLiveSteps(executionId: string): TraceStep[] {
  return useTraceStore(useShallow((s) => s.traces[executionId]?.steps ?? []))
}
