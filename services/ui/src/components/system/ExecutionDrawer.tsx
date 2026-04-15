'use client'

import { useRouter } from "next/navigation"
import { useShallow } from "zustand/react/shallow"
import { useExecutionStore } from "@/core/execution/execution-store"
import type { ExecutionItem, ExecutionType } from "@/core/execution/execution-types"

// ── Helpers ───────────────────────────────────────────────────────

const ARTIFACT_ROUTES: Partial<Record<ExecutionType, string>> = {
  proposal: "/proposals",
  microsite: "/microsites",
}

// Routes to use for active (in-progress) items that don't have an artifactId yet
const ACTIVE_ROUTES: Partial<Record<ExecutionType, string>> = {
  proposal: "/proposal",
  microsite: "/presentation",
}

const RUNNING_LABELS: Partial<Record<ExecutionType, string>> = {
  proposal:  "Generating proposal",
  microsite: "Generating microsite",
  ingestion: "Ingesting documents",
  rfp:       "Generating RFP",
  diagram:   "Generating diagram",
  analysis:  "Running analysis",
}

const QUEUED_LABELS: Partial<Record<ExecutionType, string>> = {
  ingestion: "Queued for indexing",
}

function activeStatusLabel(item: ExecutionItem): string {
  if (item.message) return item.message
  if (item.status === "running") return RUNNING_LABELS[item.type] ?? "Running"
  if (item.status === "queued") return QUEUED_LABELS[item.type] ?? "Queued"
  return item.status
}

function artifactRoute(item: ExecutionItem): string | null {
  const base = ARTIFACT_ROUTES[item.type]
  return base && item.artifactId ? `${base}/${item.artifactId}` : null
}

function formatRelativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  return hrs === 1 ? "1 hr ago" : `${hrs} hr ago`
}

// ── Sub-sections ──────────────────────────────────────────────────

function ActiveSection({
  items,
  onView,
  onOpen,
}: {
  items: ExecutionItem[]
  onView: (id: string) => void
  onOpen: (route: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="exec-drawer-section">
      <div className="exec-drawer-section-title">Active</div>
      {items.map((item) => {
        const activeRoute = ACTIVE_ROUTES[item.type] ?? null
        return (
          <div key={item.id} className="exec-drawer-item">
            <div className="exec-drawer-item-row">
              <span className="exec-drawer-spinner" aria-hidden="true" />
              <div className="exec-drawer-item-body">
                <div className="exec-drawer-item-title">
                  {item.title ?? item.type}
                </div>
                <div className="exec-drawer-item-sub">
                  {activeStatusLabel(item)}
                </div>
              </div>
              <button
                className="btn btn-sm"
                onClick={() => activeRoute ? onOpen(activeRoute) : onView(item.id)}
              >
                View
              </button>
            </div>
            <div className="exec-drawer-item-bar" aria-hidden="true" />
          </div>
        )
      })}
    </div>
  )
}

function CompletedSection({
  items,
  onOpen,
  onView,
}: {
  items: ExecutionItem[]
  onOpen: (route: string) => void
  onView: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="exec-drawer-section">
      <div className="exec-drawer-section-title">Completed</div>
      {items.map((item) => {
        const route = artifactRoute(item)
        return (
          <div key={item.id} className="exec-drawer-item">
            <div className="exec-drawer-item-row">
              <span
                className="exec-drawer-item-icon exec-drawer-item-icon--completed"
                aria-hidden="true"
              >
                ✓
              </span>
              <div className="exec-drawer-item-body">
                <div className="exec-drawer-item-title">
                  {item.title ?? item.type}
                </div>
                {item.completedAt != null && (
                  <div className="exec-drawer-item-sub">
                    {formatRelativeTime(item.completedAt)}
                  </div>
                )}
              </div>
              {route && (
                <button className="btn btn-sm" onClick={() => onOpen(route)}>
                  Open
                </button>
              )}
              <button className="btn btn-sm exec-drawer-view-btn" onClick={() => onView(item.id)}>
                View
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FailedSection({
  items,
  onView,
}: {
  items: ExecutionItem[]
  onView: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="exec-drawer-section">
      <div className="exec-drawer-section-title">Failed</div>
      {items.map((item) => (
        <div key={item.id} className="exec-drawer-item">
          <div className="exec-drawer-item-row">
            <span
              className="exec-drawer-item-icon exec-drawer-item-icon--failed"
              aria-hidden="true"
            >
              ✕
            </span>
            <div className="exec-drawer-item-body">
              <div className="exec-drawer-item-title">
                {item.title ?? item.type}
              </div>
              {item.errorMessage && (
                <div className="exec-drawer-item-sub exec-drawer-item-sub--error">
                  {item.errorMessage}
                </div>
              )}
            </div>
            <button className="btn btn-sm" onClick={() => onView(item.id)}>
              View
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Drawer ────────────────────────────────────────────────────────

export function ExecutionDrawer() {
  const router = useRouter()
  const isOpen = useExecutionStore((s) => s.isDrawerOpen)
  const closeDrawer = useExecutionStore((s) => s.closeDrawer)
  const activeList = useExecutionStore(useShallow((s) => s.getActiveExecutions()))
  const completedList = useExecutionStore(useShallow((s) => s.getCompletedExecutions()))
  const failedList = useExecutionStore(useShallow((s) => s.getFailedExecutions()))

  const isEmpty =
    activeList.length === 0 &&
    completedList.length === 0 &&
    failedList.length === 0

  function handleOpen(route: string) {
    router.push(route)
    closeDrawer()
  }

  function handleView(id: string) {
    router.push(`/executions/${id}`)
    closeDrawer()
  }

  return (
    <>
      {isOpen && (
        <div
          className="exec-drawer-backdrop"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      <div
        className={`exec-drawer${isOpen ? " exec-drawer--open" : ""}`}
        role="dialog"
        aria-label="AI Activity"
        aria-modal="true"
      >
        <div className="exec-drawer-header">
          <span className="exec-drawer-title">AI Activity</span>
          <button
            className="exec-drawer-close"
            onClick={closeDrawer}
            aria-label="Close AI Activity panel"
          >
            ✕
          </button>
        </div>

        <div className="exec-drawer-body">
          {isEmpty ? (
            <div className="exec-drawer-empty">
              <span className="exec-drawer-empty-icon" aria-hidden="true">
                ⚡
              </span>
              <span>No AI tasks yet</span>
            </div>
          ) : (
            <>
              <ActiveSection items={activeList} onView={handleView} onOpen={handleOpen} />
              <CompletedSection
                items={completedList}
                onOpen={handleOpen}
                onView={handleView}
              />
              <FailedSection items={failedList} onView={handleView} />
            </>
          )}
        </div>

        <div className="exec-drawer-footer">
          You can safely navigate while tasks run.
        </div>
      </div>
    </>
  )
}
