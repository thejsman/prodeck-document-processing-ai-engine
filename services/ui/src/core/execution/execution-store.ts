import { create } from "zustand"
import type { ExecutionItem } from "./execution-types"

// ── History policy ────────────────────────────────────────────────
const HISTORY_LIMIT = 10
const COMPLETED_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

function pruneExecutions(
  executions: Record<string, ExecutionItem>,
): Record<string, ExecutionItem> {
  const now = Date.now()
  const all = Object.values(executions)

  const active = all.filter(
    (e) => e.status === "queued" || e.status === "running",
  )

  const completed = all
    .filter(
      (e) =>
        e.status === "completed" &&
        (e.completedAt ? now - e.completedAt <= COMPLETED_MAX_AGE_MS : true),
    )
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, HISTORY_LIMIT)

  const failed = all
    .filter((e) => e.status === "failed")
    .sort((a, b) => (b.failedAt ?? 0) - (a.failedAt ?? 0))
    .slice(0, HISTORY_LIMIT)

  const retained = [...active, ...completed, ...failed]
  return Object.fromEntries(retained.map((e) => [e.id, e]))
}

// ── Store interface ───────────────────────────────────────────────
interface ExecutionStore {
  executions: Record<string, ExecutionItem>
  isDrawerOpen: boolean

  // Mutations
  addExecution: (item: ExecutionItem) => void
  updateExecution: (id: string, partial: Partial<ExecutionItem>) => void
  removeExecution: (id: string) => void
  openDrawer: () => void
  closeDrawer: () => void

  // Selectors — running
  getRunningExecutions: () => ExecutionItem[]
  getRunningList: () => ExecutionItem[]
  getRunningCount: () => number
  hasRunningExecutions: () => boolean

  // Selectors — categorised
  getActiveExecutions: () => ExecutionItem[]
  getCompletedExecutions: (limit?: number) => ExecutionItem[]
  getFailedExecutions: (limit?: number) => ExecutionItem[]
}

// ── Store ─────────────────────────────────────────────────────────
export const useExecutionStore = create<ExecutionStore>((set, get) => ({
  executions: {},
  isDrawerOpen: false,

  // ── Mutations ─────────────────────────────────────────────────

  addExecution: (item) => {
    set((state) => {
      if (state.executions[item.id]) return state
      return { executions: { ...state.executions, [item.id]: item } }
    })
  },

  updateExecution: (id, partial) => {
    set((state) => {
      const existing = state.executions[id]
      if (!existing) return state

      const now = Date.now()

      // Status regression guard — terminal statuses are sticky
      const existingIsTerminal =
        existing.status === "completed" || existing.status === "failed"
      const finalStatus =
        partial.status !== undefined && !existingIsTerminal
          ? partial.status
          : existing.status

      const merged: ExecutionItem = { ...existing, ...partial, status: finalStatus }

      // Auto-stamp terminal transitions
      if (finalStatus === "completed" && existing.status !== "completed" && !merged.completedAt) {
        merged.completedAt = now
      }
      if (finalStatus === "failed" && existing.status !== "failed" && !merged.failedAt) {
        merged.failedAt = now
      }

      const updated = { ...state.executions, [id]: merged }
      return { executions: pruneExecutions(updated) }
    })
  },

  removeExecution: (id) => {
    set((state) => {
      const { [id]: _removed, ...rest } = state.executions
      return { executions: rest }
    })
  },

  openDrawer: () => set({ isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),

  // ── Running selectors ─────────────────────────────────────────

  getRunningExecutions: () => {
    const { executions } = get()
    return Object.values(executions).filter(
      (e) => e.status === "queued" || e.status === "running",
    )
  },

  getRunningList: () => {
    const { executions } = get()
    return Object.values(executions).filter(
      (e) => e.status === "queued" || e.status === "running",
    )
  },

  getRunningCount: () => {
    const { executions } = get()
    return Object.values(executions).filter(
      (e) => e.status === "queued" || e.status === "running",
    ).length
  },

  hasRunningExecutions: () => {
    const { executions } = get()
    return Object.values(executions).some(
      (e) => e.status === "queued" || e.status === "running",
    )
  },

  // ── Categorised selectors ─────────────────────────────────────

  getActiveExecutions: () => {
    const { executions } = get()
    return Object.values(executions)
      .filter((e) => e.status === "queued" || e.status === "running")
      .sort((a, b) => (b.lastUpdatedAt ?? 0) - (a.lastUpdatedAt ?? 0))
  },

  getCompletedExecutions: (limit = HISTORY_LIMIT) => {
    const { executions } = get()
    return Object.values(executions)
      .filter((e) => e.status === "completed")
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, limit)
  },

  getFailedExecutions: (limit = HISTORY_LIMIT) => {
    const { executions } = get()
    return Object.values(executions)
      .filter((e) => e.status === "failed")
      .sort((a, b) => (b.failedAt ?? 0) - (a.failedAt ?? 0))
      .slice(0, limit)
  },
}))
