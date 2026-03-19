export type ExecutionType =
  | "proposal"
  | "microsite"
  | "rfp"
  | "diagram"
  | "analysis"

export type ExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"

export type ExecutionItem = {
  id: string
  type: ExecutionType
  status: ExecutionStatus
  title?: string
  artifactId?: string
  message?: string        // live status message streamed from transport
  lastUpdatedAt?: number
  completedAt?: number
  failedAt?: number
  errorMessage?: string
}
