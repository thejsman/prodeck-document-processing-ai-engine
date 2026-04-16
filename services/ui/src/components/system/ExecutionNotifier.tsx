'use client'

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useExecutionStore } from "@/core/execution/execution-store"
import type { ExecutionStatus, ExecutionType } from "@/core/execution/execution-types"

const COMPLETION_TITLES: Record<ExecutionType, string> = {
  proposal: "Proposal generated",
  microsite: "Microsite ready",
  rfp: "RFP generated",
  diagram: "Diagram generated",
  analysis: "Analysis complete",
  ingestion: "Ingestion complete",
}

const ARTIFACT_ROUTES: Partial<Record<ExecutionType, string>> = {
  proposal: "/proposals",
  microsite: "/microsites",
}

// Fallback routes for executions without a specific artifactId (e.g. chat-triggered)
const FALLBACK_ROUTES: Partial<Record<ExecutionType, string>> = {
  proposal:  "/proposal",
  microsite: "/presentation",
}

export function ExecutionNotifier() {
  const router = useRouter()
  const executions = useExecutionStore((s) => s.executions)
  const prevStatusRef = useRef<Record<string, ExecutionStatus>>({})

  useEffect(() => {
    const items = Object.values(executions)

    for (const item of items) {
      const prev = prevStatusRef.current[item.id]
      const isNew = prev === undefined
      const isTerminal = item.status === "completed" || item.status === "failed"
      const wasActive = prev === "running" || prev === "queued"

      // Fire "We're on it!" info toast when a task first becomes active.
      // This covers the live-stream case where the execution registers while still running.
      if (isNew && (item.status === "running" || item.status === "queued")) {
        const label = item.type === "proposal"
          ? "Generating proposal…"
          : item.type === "microsite"
          ? "Generating microsite…"
          : `${COMPLETION_TITLES[item.type]}…`
        toast.info(label, {
          description: "We're on it! You'll be notified when it's ready.",
        })
      }

      // Fire completion/failure toast.
      // `|| isNew` handles the buffered case where the execution jumps straight from
      // undefined → completed in a single React flush (React 18 automatic batching).
      if (isTerminal && (wasActive || isNew)) {
        if (item.status === "completed") {
          const title = COMPLETION_TITLES[item.type]
          const baseRoute = ARTIFACT_ROUTES[item.type]
          const route =
            baseRoute && item.artifactId
              ? `${baseRoute}/${item.artifactId}`
              : FALLBACK_ROUTES[item.type] ?? null

          const traceRoute = `/executions/${item.id}`
          toast.success(title, {
            action: route
              ? { label: "Open", onClick: () => router.push(route) }
              : { label: "View trace", onClick: () => router.push(traceRoute) },
            cancel: route
              ? { label: "View trace", onClick: () => router.push(traceRoute) }
              : undefined,
          })
        } else {
          toast.error("Generation failed", {
            description: item.title,
            action: {
              label: "View trace",
              onClick: () => router.push(`/executions/${item.id}`),
            },
          })
        }
      }

      prevStatusRef.current[item.id] = item.status
    }

    // Clean up refs for executions removed from store
    for (const id of Object.keys(prevStatusRef.current)) {
      if (!executions[id]) {
        delete prevStatusRef.current[id]
      }
    }
  }, [executions, router])

  return null
}
