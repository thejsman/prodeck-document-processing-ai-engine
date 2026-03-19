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
}

const ARTIFACT_ROUTES: Partial<Record<ExecutionType, string>> = {
  proposal: "/proposals",
  microsite: "/microsites",
}

export function ExecutionNotifier() {
  const router = useRouter()
  const executions = useExecutionStore((s) => s.executions)
  const prevStatusRef = useRef<Record<string, ExecutionStatus>>({})

  useEffect(() => {
    const items = Object.values(executions)

    for (const item of items) {
      const prev = prevStatusRef.current[item.id]
      const isTerminal = item.status === "completed" || item.status === "failed"
      const wasActive = prev === "running" || prev === "queued"

      if (isTerminal && wasActive) {
        if (item.status === "completed") {
          const title = COMPLETION_TITLES[item.type]
          const baseRoute = ARTIFACT_ROUTES[item.type]
          const route =
            baseRoute && item.artifactId
              ? `${baseRoute}/${item.artifactId}`
              : null

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
