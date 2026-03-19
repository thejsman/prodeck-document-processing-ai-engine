import { useExecutionStore } from "./execution-store"
import type { ExecutionStatus } from "./execution-types"

type BackendStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"

interface ExecutionStatusResponse {
  id: string
  status: BackendStatus
  artifactId?: string
  type?: string
}

function mapStatus(backendStatus: BackendStatus): ExecutionStatus {
  switch (backendStatus) {
    case "PENDING":
      return "queued"
    case "RUNNING":
      return "running"
    case "COMPLETED":
      return "completed"
    case "FAILED":
      return "failed"
    default:
      return "failed"
  }
}

let pollerInterval: ReturnType<typeof setInterval> | null = null
let pollerApiKey: string | null = null

async function pollOnce(): Promise<void> {
  const store = useExecutionStore.getState()
  const running = store.getRunningExecutions()

  if (running.length === 0) {
    stopExecutionPolling()
    return
  }

  await Promise.all(
    running.map(async (item) => {
      try {
        const headers: HeadersInit = { "Content-Type": "application/json" }
        if (pollerApiKey) {
          headers["Authorization"] = `Bearer ${pollerApiKey}`
        }

        const res = await fetch(`/api/ai-executions/${item.id}`, { headers })
        if (!res.ok) return

        const data = (await res.json()) as ExecutionStatusResponse
        const newStatus = mapStatus(data.status)

        if (newStatus !== item.status) {
          store.updateExecution(item.id, {
            status: newStatus,
            artifactId: data.artifactId ?? item.artifactId,
            lastUpdatedAt: Date.now(),
          })
        }
      } catch {
        // silently ignore network errors — poller will retry next tick
      }
    }),
  )
}

export function stopExecutionPolling(): void {
  if (pollerInterval !== null) {
    clearInterval(pollerInterval)
    pollerInterval = null
  }
}

export function startExecutionPolling(apiKey?: string): void {
  if (apiKey) pollerApiKey = apiKey

  if (pollerInterval !== null) return

  pollerInterval = setInterval(() => {
    pollOnce()
  }, 5000)
}
