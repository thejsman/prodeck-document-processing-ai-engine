'use client';

import { Check } from 'lucide-react';
import type { ToolEvent } from '@/lib/use-sse';

// ── Phase → step mapping ────────────────────────────────────────────

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
  const allDone = !isStreaming && sectionCount > 0;

  // Only reveal steps up to (and including) the current active one.
  // When everything is done, show all four with checks.
  const visibleCount = allDone
    ? GENERATION_STEPS.length
    : activeStep >= 0
      ? activeStep + 1
      : 0;

  const toolMap = new Map<string, ToolEvent>();
  for (const ev of toolEvents) {
    toolMap.set(ev.tool, ev);
  }
  const activeTools = [...toolMap.values()].filter((ev) => ev.status === 'started');
  const completedTools = [...toolMap.values()].filter((ev) => ev.status !== 'started');

  if (visibleCount === 0) return null;

  return (
    <div className="ppb">
      {/* Vertical step list — steps appear one by one as generation progresses */}
      <div className="ppb-rows">
        {GENERATION_STEPS.slice(0, visibleCount).map((step, i) => {
          const isDone = allDone || activeStep > i;
          const isActive = activeStep === i && isStreaming;
          return (
            <div
              key={step.key}
              className={`ppb-row${isDone ? ' ppb-row--done' : ''}${isActive ? ' ppb-row--active' : ''}`}
            >
              <div className="ppb-row-icon">
                {isDone
                  ? <Check size={11} strokeWidth={2.5} />
                  : isActive
                    ? <span className="ppb-dots" aria-hidden="true" />
                    : null
                }
              </div>
              <div className="ppb-row-body">
                <span className="ppb-row-label">{step.label}</span>
                {isActive && phase && (
                  <span className="ppb-row-detail">{phase}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
