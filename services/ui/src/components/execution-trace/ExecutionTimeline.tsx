import React from 'react'
import type { TraceStep } from '@/lib/api'
import { ExecutionStepItem } from './ExecutionStepItem'

interface Props {
  steps: TraceStep[]
  selectedStepId: string | null
  onSelectStep: (id: string) => void
}

export const ExecutionTimeline = React.memo(function ExecutionTimeline({
  steps,
  selectedStepId,
  onSelectStep,
}: Props) {
  return (
    <div className="trace-timeline card">
      {steps.map((step, index) => (
        <ExecutionStepItem
          key={step.id}
          step={step}
          index={index}
          isSelected={step.id === selectedStepId}
          isLast={index === steps.length - 1}
          onClick={() => onSelectStep(step.id)}
        />
      ))}
      {/* TODO: virtualize when steps.length > 50 */}
    </div>
  )
})
