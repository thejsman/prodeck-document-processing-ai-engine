'use client';

import type { ToolEvent } from '@/lib/use-sse';

// ── Phase → step mapping ────────────────────────────────────────────
// Ordered list of expected phases; we highlight the active one.

const GENERATION_STEPS = [
  { key: 'outline',   label: 'Planning structure',   phases: ['Planning proposal structure', 'Building section outline'] },
  { key: 'generate',  label: 'Writing sections',      phases: ['Preparing template', 'Generating proposal'] },
  { key: 'save',      label: 'Saving draft',          phases: ['Saved as version'] },
  { key: 'qa',        label: 'Quality check',         phases: ['Checking proposal consistency'] },
];

function resolveStep(phase: string): number {
  for (let i = 0; i < GENERATION_STEPS.length; i++) {
    if (GENERATION_STEPS[i].phases.some((p) => phase.startsWith(p))) return i;
  }
  return -1;
}

// ── Tool label prettifier ───────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  'search-documents': 'Searching knowledge base',
  'extract-section':  'Extracting RFP section',
  'generate-mermaid': 'Generating diagram',
  'save-asset':       'Saving asset',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

// ── Props ───────────────────────────────────────────────────────────

interface Props {
  phase: string;
  toolEvents: ToolEvent[];
  sectionCount: number;
  isStreaming: boolean;
}

// ── Component ───────────────────────────────────────────────────────

export function ProposalProgressBar({ phase, toolEvents, sectionCount, isStreaming }: Props) {
  const activeStep = resolveStep(phase);

  // Deduplicate tool calls: keep only last status per tool
  const toolMap = new Map<string, ToolEvent>();
  for (const ev of toolEvents) {
    toolMap.set(ev.tool, ev);
  }
  const activeTools = [...toolMap.values()].filter((ev) => ev.status === 'started');
  const completedTools = [...toolMap.values()].filter((ev) => ev.status !== 'started');

  return (
    <div className="ppb">
      {/* Step track */}
      <div className="ppb-steps">
        {GENERATION_STEPS.map((step, i) => {
          const isDone = activeStep > i || (!isStreaming && activeStep === -1 && sectionCount > 0);
          const isActive = activeStep === i && isStreaming;
          return (
            <div
              key={step.key}
              className={`ppb-step${isDone ? ' ppb-step--done' : ''}${isActive ? ' ppb-step--active' : ''}`}
            >
              <div className="ppb-step-icon">
                {isDone ? '✓' : isActive ? <span className="ppb-spinner" /> : i + 1}
              </div>
              <span className="ppb-step-label">{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Phase text */}
      {phase && isStreaming && (
        <div className="ppb-phase">{phase}…</div>
      )}

      {/* Active tool calls */}
      {activeTools.length > 0 && (
        <div className="ppb-tools">
          {activeTools.map((ev) => (
            <span key={ev.tool} className="ppb-tool ppb-tool--active">
              <span className="ppb-tool-dot" />
              {toolLabel(ev.tool)}
            </span>
          ))}
        </div>
      )}

      {/* Recently completed tools */}
      {completedTools.length > 0 && (
        <div className="ppb-tools ppb-tools--done">
          {completedTools.slice(-3).map((ev) => (
            <span key={`${ev.tool}-done`} className={`ppb-tool ppb-tool--${ev.status}`}>
              {ev.status === 'completed' ? '✓' : '✗'} {toolLabel(ev.tool)}
            </span>
          ))}
        </div>
      )}

      {/* Section count */}
      {sectionCount > 0 && (
        <div className="ppb-sections-count">
          {sectionCount} section{sectionCount !== 1 ? 's' : ''} generated
          {isStreaming && <span className="ppb-pulse" />}
        </div>
      )}
    </div>
  );
}
