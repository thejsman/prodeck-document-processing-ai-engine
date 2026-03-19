import { useCallback } from "react"
import { useAuth } from "@/lib/auth-context"
import { useExecutionStore } from "./execution-store"
import { startExecutionTransport } from "./execution-transport"
import type { ExecutionType } from "./execution-types"

interface TrackExecutionArgs {
  id: string
  type: ExecutionType
  title?: string
}

export function useTrackExecution(): (args: TrackExecutionArgs) => void {
  const { apiKey } = useAuth()
  const addExecution = useExecutionStore((s) => s.addExecution)

  return useCallback(
    ({ id, type, title }: TrackExecutionArgs) => {
      addExecution({ id, type, title, status: "queued" })
      // Ensure transport is running (idempotent — no-op if already connected)
      startExecutionTransport(apiKey)
    },
    [addExecution, apiKey],
  )
}
