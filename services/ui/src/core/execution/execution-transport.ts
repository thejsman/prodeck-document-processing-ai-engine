import { useExecutionStore } from "./execution-store"
import { useTraceStore } from "./trace-store"
import { startExecutionPolling, stopExecutionPolling } from "./execution-poller"
import type { ExecutionStatus, ExecutionType } from "./execution-types"
import type { TraceStep } from "@/lib/api"

// ── Config ────────────────────────────────────────────────────────

const SSE_ENDPOINT = "/api/ai-executions/stream"
const MAX_RETRIES = 5
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000
const DEV = process.env.NODE_ENV === "development"

// ── Singleton state ───────────────────────────────────────────────

let es: EventSource | null = null
let transportApiKey: string | null = null
let retryCount = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let mode: "sse" | "polling" = "sse"

export function getTransportMode(): "sse" | "polling" {
  return mode
}

// ── Status / type mapping ─────────────────────────────────────────

function mapStatus(s: string): ExecutionStatus {
  switch (s) {
    case "PENDING":   return "queued"
    case "RUNNING":   return "running"
    case "COMPLETED": return "completed"
    case "FAILED":    return "failed"
    default:          return "failed"
  }
}

function mapType(t?: string): ExecutionType {
  switch ((t ?? "").toUpperCase()) {
    case "PROPOSAL":  return "proposal"
    case "MICROSITE": return "microsite"
    case "RFP":       return "rfp"
    case "DIAGRAM":   return "diagram"
    case "ANALYSIS":  return "analysis"
    case "INGESTION": return "ingestion"
    default:          return "proposal"
  }
}

// ── SSE payload types ─────────────────────────────────────────────

interface SSEPayload {
  executionId: string
  status: string
  artifactId?: string
  type?: string
  title?: string
  message?: string
}

interface SSETracePayload {
  executionId: string
  step: TraceStep
}

// ── Event handlers ────────────────────────────────────────────────

function handleMessage(event: MessageEvent): void {
  let payload: SSEPayload
  try {
    payload = JSON.parse(event.data as string) as SSEPayload
  } catch {
    console.warn("[ExecutionTransport] failed to parse event:", event.data)
    return
  }

  if (DEV) {
    console.debug("[ExecutionTransport] event received", payload)
  }

  const { executionId, status, artifactId, type, title, message } = payload
  const store = useExecutionStore.getState()
  const frontendStatus = mapStatus(status)
  const existing = store.executions[executionId]

  if (existing) {
    store.updateExecution(executionId, {
      status: frontendStatus,
      ...(artifactId !== undefined && { artifactId }),
      ...(title !== undefined && { title }),
      ...(message !== undefined && { message }),
      lastUpdatedAt: Date.now(),
    })
  } else {
    // Auto-register executions announced by the server that weren't tracked locally
    store.addExecution({
      id: executionId,
      type: mapType(type),
      status: frontendStatus,
      artifactId,
      title,
      message,
      lastUpdatedAt: Date.now(),
    })
  }

  // Mark trace as completed when execution reaches a terminal status
  if (frontendStatus === "completed" || frontendStatus === "failed") {
    useTraceStore.getState().markTraceCompleted(executionId)
    if (DEV) {
      console.debug("[TraceLive] execution completed", executionId)
    }
  }
}

function handleTraceStep(event: MessageEvent): void {
  let payload: SSETracePayload
  try {
    payload = JSON.parse(event.data as string) as SSETracePayload
  } catch {
    console.warn("[ExecutionTransport] failed to parse trace-step event:", event.data)
    return
  }

  const { executionId, step } = payload
  const prevSteps = useTraceStore.getState().traces[executionId]?.steps
  const isUpdate = prevSteps?.some((s) => s.id === step.id) ?? false

  if (DEV) {
    console.debug(isUpdate ? "[TraceLive] step updated" : "[TraceLive] step received", {
      executionId,
      stepId: step.id,
      name: step.name,
      status: step.status,
    })
  }

  useTraceStore.getState().upsertTraceStep(executionId, step)
}

// ── Connection management ─────────────────────────────────────────

function closeES(): void {
  if (es) {
    es.onopen = null
    es.onmessage = null
    es.onerror = null
    es.removeEventListener("trace-step", handleTraceStep)
    es.close()
    es = null
  }
}

function clearTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function connect(): void {
  if (typeof window === "undefined" || !transportApiKey) return

  closeES()

  const url = `${SSE_ENDPOINT}?token=${encodeURIComponent(transportApiKey)}`

  try {
    es = new EventSource(url)
  } catch {
    console.warn("[ExecutionTransport] EventSource unavailable — falling back to polling")
    activateFallback()
    return
  }

  es.onopen = () => {
    console.log("[ExecutionTransport] connected")
    retryCount = 0
  }

  es.onmessage = handleMessage

  // Named event for trace step updates (SSE `event: trace-step`)
  es.addEventListener("trace-step", handleTraceStep)

  es.onerror = () => {
    closeES()
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  if (retryCount >= MAX_RETRIES) {
    console.warn(
      `[ExecutionTransport] SSE failed after ${MAX_RETRIES} attempts — falling back to polling`,
    )
    activateFallback()
    return
  }

  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS)
  retryCount++

  console.warn(
    `[ExecutionTransport] reconnecting in ${delay}ms (attempt ${retryCount}/${MAX_RETRIES})`,
  )

  retryTimer = setTimeout(() => {
    retryTimer = null
    connect()
  }, delay)
}

function activateFallback(): void {
  mode = "polling"
  if (transportApiKey) {
    startExecutionPolling(transportApiKey)
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Start the SSE transport (or polling fallback).
 * Idempotent — safe to call multiple times.
 */
export function startExecutionTransport(apiKey?: string): void {
  if (typeof window === "undefined") return

  if (apiKey) transportApiKey = apiKey

  // Already in polling fallback — keep polling with (possibly new) key
  if (mode === "polling") {
    if (transportApiKey) startExecutionPolling(transportApiKey)
    return
  }

  // Already have an open SSE connection
  if (es !== null) return

  connect()
}

/**
 * Tear down the transport entirely (on logout / app unmount).
 * Resets all state so the next call to startExecutionTransport() begins fresh.
 */
export function stopExecutionTransport(): void {
  closeES()
  clearTimer()
  stopExecutionPolling()
  retryCount = 0
  mode = "sse"
  transportApiKey = null
}
