'use client';

import type { PluginTokens } from '../../../types/presentation';
import { isCustomDiagram, parseCustomDiagramData } from '../../../lib/customDiagramRenderer';
import { OrbitalDiagram } from '../../diagrams/OrbitalDiagram';
import { PuzzleDiagram } from '../../diagrams/PuzzleDiagram';
import { StepsFlow } from '../../diagrams/StepsFlow';
import { TimelineBar } from '../../diagrams/TimelineBar';
import { DonutChart } from '../../diagrams/DonutChart';
import { BarChart } from '../../diagrams/BarChart';
import { StatGrid } from '../../diagrams/StatGrid';
import { TreeDiagram } from '../../diagrams/TreeDiagram';
import { JourneyMap } from '../../diagrams/JourneyMap';
import { ComparisonTable } from '../../diagrams/ComparisonTable';
import { MermaidChart } from '../../MermaidChart';
import { Reveal } from './Reveal';

interface Props {
  diagram: string;
  tokens: PluginTokens;
  delay?: number;
  caption?: string;
  typeId?: string;
}

const PADDED_TYPES = new Set(['orbital', 'steps-flow', 'timeline-bar', 'donut-chart', 'bar-chart', 'stat-grid', 'tree-diagram', 'journey-map', 'comparison-table']);

export function ThemedMermaid({ diagram, tokens, delay = 0, caption, typeId }: Props) {
  // Custom SVG diagrams (orbital, puzzle, steps-flow, etc.) → dedicated renderers
  if (isCustomDiagram(diagram)) {
    const data = parseCustomDiagramData(diagram);
    if (!data) return null;

    const padded = PADDED_TYPES.has(data.type);

    return (
      <Reveal delay={delay}>
        <figure
          className={`diagram-container${typeId ? ` type-${typeId}` : ''}`}
          style={{
            margin: '36px 0',
            borderRadius: 12,
            border: `1px solid ${tokens.border}`,
            background: tokens.surfaceCard,
            overflow: 'hidden',
            padding: padded ? '24px' : 0,
          }}
        >
          {data.type === 'orbital'           && <OrbitalDiagram data={data} tokens={tokens} />}
          {data.type === 'puzzle'            && <PuzzleDiagram data={data} tokens={tokens} />}
          {data.type === 'steps-flow'        && <StepsFlow data={data} tokens={tokens} />}
          {data.type === 'timeline-bar'      && <TimelineBar data={data} tokens={tokens} />}
          {data.type === 'donut-chart'       && <DonutChart data={data} tokens={tokens} />}
          {data.type === 'bar-chart'         && <BarChart data={data} tokens={tokens} />}
          {data.type === 'stat-grid'         && <StatGrid data={data} tokens={tokens} />}
          {data.type === 'tree-diagram'      && <TreeDiagram data={data} tokens={tokens} />}
          {data.type === 'journey-map'       && <JourneyMap data={data} tokens={tokens} />}
          {data.type === 'comparison-table'  && <ComparisonTable data={data} tokens={tokens} />}
          {caption && (
            <figcaption
              style={{
                marginTop: 12,
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.72rem',
                fontWeight: 500,
                letterSpacing: tokens.labelTracking,
                textTransform: 'uppercase',
                color: tokens.textSubtle,
                textAlign: 'center',
                padding: data.type === 'puzzle' ? '0 0 16px' : undefined,
              }}
            >
              {caption}
            </figcaption>
          )}
        </figure>
      </Reveal>
    );
  }

  // Mermaid diagrams → MermaidChart (SVG post-processed to width=100% for readability)
  return (
    <Reveal delay={delay}>
      <figure
        className={`diagram-container${typeId ? ` type-${typeId}` : ''}`}
        style={{
          margin: '36px 0',
          borderRadius: 12,
          border: `1px solid ${tokens.border}`,
          background: tokens.surfaceCard,
          overflow: 'hidden',
          padding: '28px 32px',
        }}
      >
        <MermaidChart chart={diagram} tokens={tokens} />
        {caption && (
          <figcaption
            style={{
              marginTop: 12,
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: '0.72rem',
              fontWeight: 500,
              letterSpacing: tokens.labelTracking,
              textTransform: 'uppercase',
              color: tokens.textSubtle,
              textAlign: 'center',
            }}
          >
            {caption}
          </figcaption>
        )}
      </figure>
    </Reveal>
  );
}
