'use client'

import { useExecutionStore } from "@/core/execution/execution-store"

export function ExecutionIndicator() {
  const runningCount = useExecutionStore((s) => s.getRunningCount())
  const openDrawer = useExecutionStore((s) => s.openDrawer)

  if (runningCount === 0) return null

  return (
    <button
      className="exec-indicator"
      onClick={openDrawer}
      aria-haspopup="dialog"
    >
      <span className="exec-indicator-spinner" aria-hidden="true" />
      {runningCount} running
    </button>
  )
}
