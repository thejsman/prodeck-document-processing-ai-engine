import React from 'react'
import type { TraceStep } from '@/lib/api'
import { GitBranch, Zap, Wrench, LayoutGrid, Circle, type LucideProps } from 'lucide-react'
import { Icon } from '@/components/ui/Icon'

const STEP_ICON_MAP: Record<string, React.FC<LucideProps>> = {
  planner: GitBranch,
  agent:   Zap,
  tool:    Wrench,
  layout:  LayoutGrid,
}

const STEP_TYPE_LABELS: Record<string, string> = {
  planner: 'Planner',
  agent:   'Agent',
  tool:    'Tool',
  layout:  'Layout',
}

function formatStepDuration(step: TraceStep): string {
  if (step.status === 'running') return null as unknown as string
  if (step.endedAt == null || step.startedAt == null) return '—'
  const ms = step.endedAt - step.startedAt
  if (ms < 1_000) return `${ms}ms`
  return `${(ms / 1_000).toFixed(1)}s`
}

interface Props {
  step: TraceStep
  index: number
  isSelected: boolean
  isLast: boolean
  onClick: () => void
}

export const ExecutionStepItem = React.memo(function ExecutionStepItem({
  step,
  index,
  isSelected,
  isLast,
  onClick,
}: Props) {
  const isRunning = step.status === 'running'
  const duration = formatStepDuration(step)

  return (
    <div
      className={`trace-step${isSelected ? ' trace-step--selected' : ''}${isRunning ? ' trace-step--running' : ''}`}
      style={{ '--step-index': index } as React.CSSProperties}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
      }}
    >
      <div className="trace-step-indicator">
        <div className={`trace-step-icon trace-step-icon--${step.type}${isRunning ? ' trace-step-icon--spinning' : ''}`}>
          {isRunning ? (
            <span className="trace-step-spinner" aria-hidden="true" />
          ) : (
            <Icon icon={STEP_ICON_MAP[step.type] ?? Circle} size="sm" />
          )}
        </div>
        {!isLast && <div className="trace-step-connector" />}
      </div>

      <div className="trace-step-body">
        <div className="trace-step-header-row">
          <span className="trace-step-name">{step.name}</span>
          <div className="trace-step-meta">
            {duration != null && (
              <span className="trace-step-duration">{duration}</span>
            )}
            <span
              className={`trace-step-dot trace-step-dot--${step.status}`}
              aria-label={step.status}
            />
          </div>
        </div>
        <div className="trace-step-type-label">
          {STEP_TYPE_LABELS[step.type] ?? step.type}
        </div>
        {isRunning && (
          <div className="trace-step-progress" aria-hidden="true">
            <div className="trace-step-progress-bar" />
          </div>
        )}
      </div>
    </div>
  )
})
