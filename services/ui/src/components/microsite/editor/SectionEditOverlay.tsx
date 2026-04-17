'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditContext } from './EditContext';
import type { LayoutSection } from '../../../types/presentation';
import type {
  OrbitalDiagramData, PuzzleDiagramData,
  StepsFlowData, TimelineBarData, DonutChartData, BarChartData,
  StatGridData, TreeDiagramData, JourneyMapData, ComparisonTableData,
} from '../../../lib/customDiagramRenderer';
import { CUSTOM_SVG_PREFIX, parseCustomDiagramData } from '../../../lib/customDiagramRenderer';

// ── Colour swatch presets ─────────────────────────────────────────────────────

const BG_PRESETS = [
  { label: 'Surface', value: 'var(--ms-surface)' },
  { label: 'Surface Alt', value: 'var(--ms-surface-alt)' },
  { label: 'Dark', value: '#0a0a0a' },
  { label: 'White', value: '#ffffff' },
  { label: 'Indigo', value: '#1e1b4b' },
  { label: 'Slate', value: '#0f172a' },
  { label: 'Rose', value: '#1c0a0e' },
  { label: 'Teal', value: '#042f2e' },
  { label: 'Accent tint', value: 'rgba(var(--ms-accent-rgb,99,102,241),0.08)' },
];

// ── Sections that DO support diagrams ────────────────────────────────────────
const DIAGRAM_SECTION_TYPES = new Set([
  'approach', 'challenge', 'generic', 'security',
  'techstack', 'testing', 'timeline', 'whyus',
]);

// ── Context-aware diagram template builders ───────────────────────────────────

function sanitize(s: string) { return (s ?? '').replace(/["]/g, '').slice(0, 40); }

function suggestDiagramType(sectionType: string): string {
  switch (sectionType) {
    case 'timeline': return 'gantt';
    case 'whyus': case 'metrics': case 'stats': return 'pie';
    case 'security': case 'benefits': case 'techstack': return 'mindmap';
    case 'testing': return 'orbital';
    default: return 'flowchart';
  }
}

function buildContextTemplate(section: LayoutSection, diagramType: string): string {
  const c = section.content as unknown as Record<string, unknown>;
  const hl = sanitize((c.headline as string) || section.heading || 'Overview');
  type AnyItem = Record<string, string>;

  if (diagramType === 'flowchart') {
    switch (section.sectionType) {
      case 'approach': case 'deliverables': case 'problem': {
        const key = section.sectionType === 'approach' ? 'pillars' : section.sectionType === 'deliverables' ? 'items' : 'painPoints';
        const raw = (c[key] as unknown[]) ?? [];
        const items = raw.slice(0, 5);
        if (items.length) {
          const nodes = items.map((it, i) => {
            const label = typeof it === 'string' ? sanitize(it) : sanitize((it as AnyItem).name || (it as AnyItem).title || `Item ${i}`);
            return `    N${i}["${label}"]`;
          }).join('\n');
          const arrows = items.map((_, i) => `    ROOT --> N${i}`).join('\n');
          return `flowchart TD\n    ROOT["${hl}"]\n${nodes}\n${arrows}`;
        }
        break;
      }
      case 'challenge':
        return `flowchart TD\n    A["${hl}"] --> B["Root Cause"]\n    B --> C["Business Impact"]\n    C --> D["Solution Required"]`;
      case 'nextsteps':
        return `flowchart LR\n    A["Today"] --> B["${hl}"]\n    B --> C["${sanitize((c.ctaPrimary as string) || 'Get Started')}"]\n    B --> D["${sanitize((c.ctaSecondary as string) || 'Learn More')}"]`;
      case 'showcase': case 'hero': {
        const subs = sanitize((c.subheadline as string) || 'Key benefits');
        return `flowchart TD\n    A["${hl}"] --> B["${subs}"]\n    B --> C["Outcome A"]\n    B --> D["Outcome B"]`;
      }
      default: break;
    }
    return CHART_TYPES.find(t => t.id === 'flowchart')!.template ?? '';
  }

  if (diagramType === 'gantt') {
    if (section.sectionType === 'timeline') {
      const phases = ((c.phases as AnyItem[]) ?? []).slice(0, 6);
      if (phases.length) {
        const lines = phases.map((p, i) => {
          const name = sanitize(p.name || `Phase ${i + 1}`).replace(/:/g, '');
          const dur = (p.duration || '14d').match(/(\d+)/)?.[1] ?? '14';
          return `  ${name} :p${i}, ${i === 0 ? '2025-01-01' : `after p${i - 1}`}, ${dur}d`;
        }).join('\n');
        return `gantt\n  title ${hl}\n  dateFormat YYYY-MM-DD\n  section Timeline\n${lines}`;
      }
    }
    return CHART_TYPES.find(t => t.id === 'gantt')!.template ?? '';
  }

  if (diagramType === 'mindmap') {
    switch (section.sectionType) {
      case 'security': case 'benefits': case 'deliverables': {
        const items = ((c.items as AnyItem[]) ?? []).slice(0, 6);
        if (items.length) {
          const branches = items.map(it => `      ${sanitize(it.name || it.title || 'Item')}`).join('\n');
          return `mindmap\n  root((${hl.slice(0, 18)}))\n    Topics\n${branches}`;
        }
        break;
      }
      case 'techstack': {
        const cats = ((c.categories as Array<{name: string; items: string[]}>)) ?? [];
        if (cats.length) {
          const branches = cats.slice(0, 4).map(cat => {
            const subitems = (cat.items ?? []).slice(0, 3).map(i => `        ${sanitize(i)}`).join('\n');
            return `      ${sanitize(cat.name)}\n${subitems}`;
          }).join('\n');
          return `mindmap\n  root((${hl.slice(0, 18)}))\n${branches}`;
        }
        break;
      }
      default: break;
    }
    return CHART_TYPES.find(t => t.id === 'mindmap')!.template ?? '';
  }

  if (diagramType === 'pie') {
    const statsKey = section.sectionType === 'metrics' ? 'stats' : 'stats';
    const raw = (c[statsKey] as AnyItem[]) ?? [];
    const stats = (Array.isArray(raw) ? raw : [raw]).slice(0, 6);
    if (stats.length) {
      const pieces = stats.map(s => {
        const num = parseFloat((s.number ?? '1').replace(/[^0-9.]/g, '')) || 1;
        return `  "${sanitize(s.label || 'Item')}": ${num}`;
      }).join('\n');
      return `pie title ${hl}\n${pieces}`;
    }
    return CHART_TYPES.find(t => t.id === 'pie')!.template ?? '';
  }

  if (diagramType === 'sequence') {
    if (section.sectionType === 'testing') {
      const layers = ((c.layers as AnyItem[]) ?? []).slice(0, 4);
      if (layers.length) {
        const msgs = layers.map(l => `  Tester->>${sanitize(l.name || 'Layer').replace(/[-\s]/g, '')}: Execute`).join('\n');
        return `sequenceDiagram\n  participant Tester\n${msgs}`;
      }
    }
    return CHART_TYPES.find(t => t.id === 'sequence')!.template ?? '';
  }

  return CHART_TYPES.find(t => t.id === diagramType)?.template ?? '';
}

function buildOrbitalDefault(section: LayoutSection): OrbitalDiagramData {
  const c = section.content as unknown as Record<string, unknown>;
  const hl = sanitize((c.headline as string) || section.heading || 'Core').slice(0, 22);
  type AnyItem = Record<string, string>;
  const raw: AnyItem[] = ((c.pillars || c.items) as AnyItem[]) ?? [];
  const items = raw.slice(0, 6);
  const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'] as const;
  return {
    type: 'orbital',
    center: { title: hl, subtitle: section.sectionType },
    satellites: items.length
      ? items.map((it, i) => ({
          title: sanitize(it.name || it.title || `Item ${i + 1}`).slice(0, 22),
          description: sanitize(it.description || '').slice(0, 40),
          position: positions[i % positions.length],
        }))
      : [
          { title: 'Feature A', description: 'Key capability', position: 'top-left' },
          { title: 'Feature B', description: 'Key capability', position: 'top-right' },
          { title: 'Feature C', description: 'Key capability', position: 'bottom-left' },
          { title: 'Feature D', description: 'Key capability', position: 'bottom-right' },
        ],
  };
}

function buildPuzzleDefault(section: LayoutSection): PuzzleDiagramData {
  const c = section.content as unknown as Record<string, unknown>;
  type AnyItem = Record<string, string>;
  const raw: AnyItem[] = ((c.pillars || c.items) as AnyItem[]) ?? [];
  const items = raw.slice(0, 4);
  const iconTypes = ['process', 'cloud', 'data', 'security'] as const;
  const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
  const labelSides = ['left', 'right', 'left', 'right'] as const;
  return {
    type: 'puzzle',
    backgroundStyle: 'gradient',
    pieces: items.length
      ? items.map((it, i) => ({
          title: sanitize(it.name || it.title || `Topic ${i + 1}`).slice(0, 22),
          iconType: iconTypes[i % iconTypes.length],
          position: positions[i],
          labelSide: labelSides[i],
        }))
      : [
          { title: 'Strategy', iconType: 'process', position: 'top-left', labelSide: 'left' },
          { title: 'Technology', iconType: 'cloud', position: 'top-right', labelSide: 'right' },
          { title: 'Data', iconType: 'data', position: 'bottom-left', labelSide: 'left' },
          { title: 'Security', iconType: 'security', position: 'bottom-right', labelSide: 'right' },
        ],
  };
}

// ── Default builders for new custom SVG types ─────────────────────────────────

function buildStepsFlowDefault(section: LayoutSection): StepsFlowData {
  const c = section.content as unknown as Record<string, unknown>;
  type AnyItem = Record<string, string>;
  const raw: AnyItem[] = ((c.pillars || c.items || c.steps) as AnyItem[]) ?? [];
  const items = raw.slice(0, 5);
  return {
    type: 'steps-flow',
    steps: items.length
      ? items.map(it => ({ title: sanitize(it.name || it.title || 'Step'), description: sanitize(it.description || '') }))
      : [
          { title: 'Discover', description: 'Understand requirements' },
          { title: 'Design', description: 'Create the solution' },
          { title: 'Deliver', description: 'Deploy and handover' },
        ],
  };
}

function buildTimelineBarDefault(section: LayoutSection): TimelineBarData {
  const c = section.content as unknown as Record<string, unknown>;
  type AnyItem = Record<string, string>;
  const raw: AnyItem[] = ((c.phases || c.items) as AnyItem[]) ?? [];
  const items = raw.slice(0, 6);
  let week = 0;
  return {
    type: 'timeline-bar',
    phases: items.length
      ? items.map(it => {
          const dur = parseInt((it.duration || '2').replace(/\D/g, '')) || 2;
          const phase = { name: sanitize(it.name || it.title || 'Phase'), durationWeeks: dur, startWeek: week };
          week += dur;
          return phase;
        })
      : [
          { name: 'Discovery', durationWeeks: 2, startWeek: 0 },
          { name: 'Design', durationWeeks: 3, startWeek: 2 },
          { name: 'Delivery', durationWeeks: 4, startWeek: 5 },
        ],
  };
}

function buildDonutChartDefault(): DonutChartData {
  return {
    type: 'donut-chart',
    title: 'Breakdown',
    segments: [
      { label: 'Strategy', percentage: 30 },
      { label: 'Design', percentage: 25 },
      { label: 'Development', percentage: 30 },
      { label: 'Testing', percentage: 15 },
    ],
  };
}

function buildBarChartDefault(): BarChartData {
  return {
    type: 'bar-chart',
    title: 'Comparison',
    unit: '',
    bars: [
      { label: 'Current', value: 9 },
      { label: 'Target', value: 3, highlight: true },
    ],
  };
}

function buildStatGridDefault(): StatGridData {
  return {
    type: 'stat-grid',
    stats: [
      { value: '40%', label: 'Efficiency gain', icon: 'growth', trend: 'up' },
      { value: '3x', label: 'Faster delivery', icon: 'up', trend: 'up' },
      { value: '$500K', label: 'Annual savings', icon: 'money' },
    ],
  };
}

function buildTreeDiagramDefault(section: LayoutSection): TreeDiagramData {
  const c = section.content as unknown as Record<string, unknown>;
  const hl = sanitize((c.headline as string) || section.heading || 'Structure');
  type AnyItem = Record<string, string>;
  const raw: AnyItem[] = ((c.items || c.pillars) as AnyItem[]) ?? [];
  return {
    type: 'tree-diagram',
    root: {
      title: hl,
      children: raw.slice(0, 5).length
        ? raw.slice(0, 5).map(it => ({ title: sanitize(it.name || it.title || 'Item') }))
        : [{ title: 'Branch A' }, { title: 'Branch B' }, { title: 'Branch C' }],
    },
  };
}

function buildJourneyMapDefault(): JourneyMapData {
  return {
    type: 'journey-map',
    stages: [
      { name: 'Awareness', activities: ['Research', 'Discovery'], sentiment: 'neutral' },
      { name: 'Evaluation', activities: ['Demo', 'Proposal review'], sentiment: 'positive' },
      { name: 'Onboarding', activities: ['Kickoff', 'Training', 'Go-live'], sentiment: 'positive' },
    ],
  };
}

function buildComparisonTableDefault(): ComparisonTableData {
  return {
    type: 'comparison-table',
    title: 'Comparison',
    features: ['Real-time data', 'Automated reporting', 'Custom dashboards', 'API access'],
    options: [
      { name: 'Current', values: [false, false, false, false] },
      { name: 'Proposed', values: [true, true, true, true] },
    ],
  };
}

// ── Shared input styles ───────────────────────────────────────────────────────

const INP: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #e2e8f0', fontSize: 12, boxSizing: 'border-box', marginBottom: 4 };
const LBL: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 2 };
const SECTION_HDR: React.CSSProperties = { margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' };
const CARD: React.CSSProperties = { background: '#f8fafc', borderRadius: 8, padding: '10px 12px', marginBottom: 8, position: 'relative' };

function AddBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid #6366f1', background: '#f5f3ff', color: '#6366f1', cursor: 'pointer', fontWeight: 600 }}>
      + {label}
    </button>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ position: 'absolute', top: 6, right: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1 }}>✕</button>
  );
}

// ── Form: Steps Flow ──────────────────────────────────────────────────────────

function StepsFlowForm({ data, onChange }: { data: StepsFlowData; onChange: (d: StepsFlowData) => void }) {
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Steps ({data.steps.length}/6)</p>
        {data.steps.length < 6 && <AddBtn label="Add step" onClick={() => onChange({ ...data, steps: [...data.steps, { title: 'New Step', description: 'Description' }] })} />}
      </div>
      {data.steps.map((step, i) => (
        <div key={i} style={CARD}>
          <RemoveBtn onClick={() => onChange({ ...data, steps: data.steps.filter((_, idx) => idx !== i) })} />
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#64748b' }}>Step {i + 1}</p>
          <label style={LBL}>Title</label>
          <input style={INP} value={step.title} onChange={e => { const s = [...data.steps]; s[i] = { ...s[i], title: e.target.value }; onChange({ ...data, steps: s }); }} />
          <label style={LBL}>Description</label>
          <input style={INP} value={step.description} onChange={e => { const s = [...data.steps]; s[i] = { ...s[i], description: e.target.value }; onChange({ ...data, steps: s }); }} />
        </div>
      ))}
    </div>
  );
}

// ── Form: Timeline Bar ────────────────────────────────────────────────────────

function TimelineBarForm({ data, onChange }: { data: TimelineBarData; onChange: (d: TimelineBarData) => void }) {
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Phases ({data.phases.length}/8)</p>
        {data.phases.length < 8 && <AddBtn label="Add phase" onClick={() => {
          const last = data.phases[data.phases.length - 1];
          const start = last ? (last.startWeek + last.durationWeeks) : 0;
          onChange({ ...data, phases: [...data.phases, { name: 'New Phase', durationWeeks: 2, startWeek: start }] });
        }} />}
      </div>
      {data.phases.map((phase, i) => (
        <div key={i} style={CARD}>
          <RemoveBtn onClick={() => onChange({ ...data, phases: data.phases.filter((_, idx) => idx !== i) })} />
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#64748b' }}>Phase {i + 1}</p>
          <label style={LBL}>Name</label>
          <input style={INP} value={phase.name} onChange={e => { const p = [...data.phases]; p[i] = { ...p[i], name: e.target.value }; onChange({ ...data, phases: p }); }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={LBL}>Duration (weeks)</label>
              <input style={INP} type="number" min={1} value={phase.durationWeeks} onChange={e => { const p = [...data.phases]; p[i] = { ...p[i], durationWeeks: parseInt(e.target.value) || 1 }; onChange({ ...data, phases: p }); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LBL}>Start week</label>
              <input style={INP} type="number" min={0} value={phase.startWeek} onChange={e => { const p = [...data.phases]; p[i] = { ...p[i], startWeek: parseInt(e.target.value) || 0 }; onChange({ ...data, phases: p }); }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Form: Donut Chart ─────────────────────────────────────────────────────────

function DonutChartForm({ data, onChange }: { data: DonutChartData; onChange: (d: DonutChartData) => void }) {
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ ...CARD }}>
        <label style={LBL}>Chart title</label>
        <input style={INP} value={data.title ?? ''} onChange={e => onChange({ ...data, title: e.target.value })} />
        <label style={LBL}>Center label (e.g. total)</label>
        <input style={INP} value={data.total ?? ''} onChange={e => onChange({ ...data, total: e.target.value })} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Segments ({data.segments.length}/8)</p>
        {data.segments.length < 8 && <AddBtn label="Add" onClick={() => onChange({ ...data, segments: [...data.segments, { label: 'New', percentage: 10 }] })} />}
      </div>
      {data.segments.map((seg, i) => (
        <div key={i} style={CARD}>
          <RemoveBtn onClick={() => onChange({ ...data, segments: data.segments.filter((_, idx) => idx !== i) })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label style={LBL}>Label</label>
              <input style={INP} value={seg.label} onChange={e => { const s = [...data.segments]; s[i] = { ...s[i], label: e.target.value }; onChange({ ...data, segments: s }); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LBL}>%</label>
              <input style={INP} type="number" min={1} max={100} value={seg.percentage ?? ''} onChange={e => { const s = [...data.segments]; s[i] = { ...s[i], percentage: parseInt(e.target.value) || 0 }; onChange({ ...data, segments: s }); }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Form: Bar Chart ───────────────────────────────────────────────────────────

function BarChartForm({ data, onChange }: { data: BarChartData; onChange: (d: BarChartData) => void }) {
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ ...CARD }}>
        <label style={LBL}>Chart title</label>
        <input style={INP} value={data.title ?? ''} onChange={e => onChange({ ...data, title: e.target.value })} />
        <label style={LBL}>Unit (e.g. days, %)</label>
        <input style={INP} value={data.unit ?? ''} onChange={e => onChange({ ...data, unit: e.target.value })} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Bars ({data.bars.length}/8)</p>
        {data.bars.length < 8 && <AddBtn label="Add bar" onClick={() => onChange({ ...data, bars: [...data.bars, { label: 'New', value: 0 }] })} />}
      </div>
      {data.bars.map((bar, i) => (
        <div key={i} style={CARD}>
          <RemoveBtn onClick={() => onChange({ ...data, bars: data.bars.filter((_, idx) => idx !== i) })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label style={LBL}>Label</label>
              <input style={INP} value={bar.label} onChange={e => { const b = [...data.bars]; b[i] = { ...b[i], label: e.target.value }; onChange({ ...data, bars: b }); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LBL}>Value</label>
              <input style={INP} type="number" value={bar.value} onChange={e => { const b = [...data.bars]; b[i] = { ...b[i], value: parseFloat(e.target.value) || 0 }; onChange({ ...data, bars: b }); }} />
            </div>
          </div>
          <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={bar.highlight ?? false} onChange={e => { const b = [...data.bars]; b[i] = { ...b[i], highlight: e.target.checked }; onChange({ ...data, bars: b }); }} />
            Highlight (accent color)
          </label>
        </div>
      ))}
    </div>
  );
}

// ── Form: Stat Grid ───────────────────────────────────────────────────────────

const STAT_ICONS_LIST = ['growth', 'money', 'time', 'people', 'up', 'down', 'check', 'star', 'process', 'data'];

function StatGridForm({ data, onChange }: { data: StatGridData; onChange: (d: StatGridData) => void }) {
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Stats ({data.stats.length}/6)</p>
        {data.stats.length < 6 && <AddBtn label="Add stat" onClick={() => onChange({ ...data, stats: [...data.stats, { value: '0', label: 'Metric' }] })} />}
      </div>
      {data.stats.map((stat, i) => (
        <div key={i} style={CARD}>
          <RemoveBtn onClick={() => onChange({ ...data, stats: data.stats.filter((_, idx) => idx !== i) })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={LBL}>Value</label>
              <input style={INP} value={stat.value} placeholder="e.g. 40%, 3x" onChange={e => { const s = [...data.stats]; s[i] = { ...s[i], value: e.target.value }; onChange({ ...data, stats: s }); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LBL}>Icon</label>
              <select style={{ ...INP, background: '#fff' }} value={stat.icon ?? 'star'} onChange={e => { const s = [...data.stats]; s[i] = { ...s[i], icon: e.target.value }; onChange({ ...data, stats: s }); }}>
                {STAT_ICONS_LIST.map(ic => <option key={ic} value={ic}>{ic}</option>)}
              </select>
            </div>
          </div>
          <label style={LBL}>Label</label>
          <input style={INP} value={stat.label} onChange={e => { const s = [...data.stats]; s[i] = { ...s[i], label: e.target.value }; onChange({ ...data, stats: s }); }} />
          <label style={LBL}>Trend</label>
          <select style={{ ...INP, background: '#fff' }} value={stat.trend ?? 'neutral'} onChange={e => { const s = [...data.stats]; s[i] = { ...s[i], trend: e.target.value as StatGridData['stats'][0]['trend'] }; onChange({ ...data, stats: s }); }}>
            <option value="up">↑ Up</option>
            <option value="down">↓ Down</option>
            <option value="neutral">— Neutral</option>
          </select>
        </div>
      ))}
    </div>
  );
}

// ── Form: Tree Diagram ────────────────────────────────────────────────────────

function TreeDiagramForm({ data, onChange }: { data: TreeDiagramData; onChange: (d: TreeDiagramData) => void }) {
  const children = data.root.children ?? [];
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ ...CARD }}>
        <label style={LBL}>Root node title</label>
        <input style={INP} value={data.root.title} onChange={e => onChange({ ...data, root: { ...data.root, title: e.target.value } })} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Children ({children.length}/6)</p>
        {children.length < 6 && <AddBtn label="Add child" onClick={() => onChange({ ...data, root: { ...data.root, children: [...children, { title: 'New Node' }] } })} />}
      </div>
      {children.map((child, i) => (
        <div key={i} style={CARD}>
          <RemoveBtn onClick={() => onChange({ ...data, root: { ...data.root, children: children.filter((_, idx) => idx !== i) } })} />
          <label style={LBL}>Node {i + 1} title</label>
          <input style={INP} value={child.title} onChange={e => { const c = [...children]; c[i] = { ...c[i], title: e.target.value }; onChange({ ...data, root: { ...data.root, children: c } }); }} />
        </div>
      ))}
    </div>
  );
}

// ── Form: Journey Map ─────────────────────────────────────────────────────────

function JourneyMapForm({ data, onChange }: { data: JourneyMapData; onChange: (d: JourneyMapData) => void }) {
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Stages ({data.stages.length}/6)</p>
        {data.stages.length < 6 && <AddBtn label="Add stage" onClick={() => onChange({ ...data, stages: [...data.stages, { name: 'Stage', activities: ['Activity'], sentiment: 'neutral' as const }] })} />}
      </div>
      {data.stages.map((stage, i) => (
        <div key={i} style={CARD}>
          <RemoveBtn onClick={() => onChange({ ...data, stages: data.stages.filter((_, idx) => idx !== i) })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 2 }}>
              <label style={LBL}>Stage name</label>
              <input style={INP} value={stage.name} onChange={e => { const s = [...data.stages]; s[i] = { ...s[i], name: e.target.value }; onChange({ ...data, stages: s }); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={LBL}>Sentiment</label>
              <select style={{ ...INP, background: '#fff' }} value={stage.sentiment ?? 'neutral'} onChange={e => { const s = [...data.stages]; s[i] = { ...s[i], sentiment: e.target.value as JourneyMapData['stages'][0]['sentiment'] }; onChange({ ...data, stages: s }); }}>
                <option value="positive">😊 Positive</option>
                <option value="neutral">😐 Neutral</option>
                <option value="negative">😟 Negative</option>
              </select>
            </div>
          </div>
          <label style={LBL}>Activities (one per line)</label>
          <textarea
            style={{ ...INP, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }}
            value={stage.activities.join('\n')}
            onChange={e => { const s = [...data.stages]; s[i] = { ...s[i], activities: e.target.value.split('\n').filter(Boolean) }; onChange({ ...data, stages: s }); }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Form: Comparison Table ────────────────────────────────────────────────────

function ComparisonTableForm({ data, onChange }: { data: ComparisonTableData; onChange: (d: ComparisonTableData) => void }) {
  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ ...CARD }}>
        <label style={LBL}>Title (optional)</label>
        <input style={INP} value={data.title ?? ''} onChange={e => onChange({ ...data, title: e.target.value })} />
      </div>

      <p style={SECTION_HDR}>Options (columns)</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {data.options.map((opt, oi) => (
          <input key={oi} style={{ ...INP, flex: 1 }} value={opt.name} placeholder={`Option ${oi + 1}`}
            onChange={e => { const o = [...data.options]; o[oi] = { ...o[oi], name: e.target.value }; onChange({ ...data, options: o }); }} />
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={SECTION_HDR}>Features (rows)</p>
        {data.features.length < 10 && <AddBtn label="Add row" onClick={() => onChange({ ...data, features: [...data.features, 'New feature'], options: data.options.map(o => ({ ...o, values: [...o.values, false] })) })} />}
      </div>
      {data.features.map((feat, fi) => (
        <div key={fi} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <input style={{ ...INP, flex: 2, marginBottom: 0 }} value={feat} onChange={e => { const f = [...data.features]; f[fi] = e.target.value; onChange({ ...data, features: f }); }} />
          {data.options.map((opt, oi) => (
            <label key={oi} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={opt.values[fi] === true}
                onChange={e => { const o = [...data.options]; const v = [...o[oi].values]; v[fi] = e.target.checked; o[oi] = { ...o[oi], values: v }; onChange({ ...data, options: o }); }} />
              {opt.name || `Opt ${oi + 1}`}
            </label>
          ))}
          <button onClick={() => { const f = data.features.filter((_, idx) => idx !== fi); const o = data.options.map(op => ({ ...op, values: op.values.filter((_, idx) => idx !== fi) })); onChange({ ...data, features: f, options: o }); }}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Chart type templates ──────────────────────────────────────────────────────

const CHART_TYPES = [
  {
    id: 'orbital',
    label: 'Orbital',
    icon: '⊙',
    template: null,
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    icon: '⬡',
    template: null,
  },
  {
    id: 'steps-flow',
    label: 'Steps',
    icon: '→',
    template: null,
  },
  {
    id: 'timeline-bar',
    label: 'Timeline',
    icon: '▤',
    template: null,
  },
  {
    id: 'donut-chart',
    label: 'Donut',
    icon: '◉',
    template: null,
  },
  {
    id: 'bar-chart',
    label: 'Bar Chart',
    icon: '▮',
    template: null,
  },
  {
    id: 'stat-grid',
    label: 'Stats',
    icon: '⊞',
    template: null,
  },
  {
    id: 'tree-diagram',
    label: 'Tree',
    icon: '⌥',
    template: null,
  },
  {
    id: 'journey-map',
    label: 'Journey',
    icon: '⇢',
    template: null,
  },
  {
    id: 'comparison-table',
    label: 'Compare',
    icon: '⊟',
    template: null,
  },
] as Array<{ id: string; label: string; icon: string; template: string | null }>;

// ── Live diagram preview ──────────────────────────────────────────────────────

let _previewCounter = 0;

function DiagramPreview({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const idRef = useRef(`mmd-prev-${++_previewCounter}`);

  useEffect(() => {
    if (!code.trim()) { setSvg(''); setError(''); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
        const { svg: rendered } = await mermaid.render(idRef.current, code);
        if (!cancelled) { setSvg(rendered); setError(''); }
      } catch {
        if (!cancelled) { setError('Invalid syntax — check your diagram code'); setSvg(''); }
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [code]);

  if (!code.trim()) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 12, gap: 8 }}>
        <span style={{ fontSize: 32 }}>◈</span>
        <span>Select a chart type or enter code</span>
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#dc2626', fontSize: 12, gap: 6, padding: 16 }}>
        <span style={{ fontSize: 24 }}>⚠</span>
        <span style={{ textAlign: 'center' }}>{error}</span>
      </div>
    );
  }
  return (
    <div
      style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ── Diagram editor modal ──────────────────────────────────────────────────────

// ── Orbital diagram form builder ──────────────────────────────────────────────

const ORBITAL_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right'] as const;

function OrbitalForm({ data, onChange }: { data: OrbitalDiagramData; onChange: (d: OrbitalDiagramData) => void }) {
  const inp: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #e2e8f0', fontSize: 12, boxSizing: 'border-box', marginBottom: 4 };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 2 };

  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Center Node</p>
        <label style={lbl}>Title</label>
        <input style={inp} value={data.center.title} onChange={e => onChange({ ...data, center: { ...data.center, title: e.target.value } })} />
        <label style={lbl}>Subtitle</label>
        <input style={inp} value={data.center.subtitle} onChange={e => onChange({ ...data, center: { ...data.center, subtitle: e.target.value } })} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Satellites ({data.satellites.length}/6)</p>
        {data.satellites.length < 6 && (
          <button
            onClick={() => onChange({ ...data, satellites: [...data.satellites, { title: 'New Satellite', description: 'Description', position: 'right' }] })}
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, border: '1px solid #6366f1', background: '#f5f3ff', color: '#6366f1', cursor: 'pointer', fontWeight: 600 }}
          >
            + Add
          </button>
        )}
      </div>

      {data.satellites.map((sat, i) => (
        <div key={i} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', marginBottom: 8, position: 'relative' }}>
          <button
            onClick={() => onChange({ ...data, satellites: data.satellites.filter((_, idx) => idx !== i) })}
            style={{ position: 'absolute', top: 6, right: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, lineHeight: 1 }}
          >✕</button>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#64748b' }}>Satellite {i + 1}</p>
          <label style={lbl}>Title</label>
          <input style={inp} value={sat.title} onChange={e => { const s = [...data.satellites]; s[i] = { ...s[i], title: e.target.value }; onChange({ ...data, satellites: s }); }} />
          <label style={lbl}>Description</label>
          <input style={inp} value={sat.description} onChange={e => { const s = [...data.satellites]; s[i] = { ...s[i], description: e.target.value }; onChange({ ...data, satellites: s }); }} />
          <label style={lbl}>Position</label>
          <select style={{ ...inp, background: '#fff' }} value={sat.position} onChange={e => { const s = [...data.satellites]; s[i] = { ...s[i], position: e.target.value as typeof sat.position }; onChange({ ...data, satellites: s }); }}>
            {ORBITAL_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

// ── Puzzle diagram form builder ───────────────────────────────────────────────

const PUZZLE_ICON_TYPES = ['gateway', 'monitor', 'stream', 'storage', 'security', 'cloud', 'data', 'api', 'user', 'process', 'integrate', 'deploy'] as const;
const PUZZLE_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;

function PuzzleForm({ data, onChange }: { data: PuzzleDiagramData; onChange: (d: PuzzleDiagramData) => void }) {
  const inp: React.CSSProperties = { width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #e2e8f0', fontSize: 12, boxSizing: 'border-box', marginBottom: 4 };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 2 };

  // Ensure always 4 pieces, one per position
  const pieces = PUZZLE_POSITIONS.map(pos => data.pieces.find(p => p.position === pos) ?? { title: 'Piece', iconType: 'cloud' as const, position: pos, labelSide: (pos.includes('left') ? 'left' : 'right') as 'left' | 'right' });

  return (
    <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Background Style</p>
        <select style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #e2e8f0', fontSize: 12, background: '#fff' }} value={data.backgroundStyle} onChange={e => onChange({ ...data, backgroundStyle: e.target.value as PuzzleDiagramData['backgroundStyle'] })}>
          <option value="gradient">Gradient</option>
          <option value="solid">Solid</option>
          <option value="mesh">Mesh</option>
        </select>
      </div>

      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>4 Puzzle Pieces</p>

      {pieces.map((piece, i) => (
        <div key={piece.position} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'capitalize' }}>{piece.position.replace('-', ' ')}</p>
          <label style={lbl}>Title</label>
          <input style={inp} value={piece.title} onChange={e => { const updated = pieces.map((p, idx) => idx === i ? { ...p, title: e.target.value } : p); onChange({ ...data, pieces: updated }); }} />
          <label style={lbl}>Icon Type</label>
          <select style={{ ...inp, background: '#fff' }} value={piece.iconType} onChange={e => { const updated = pieces.map((p, idx) => idx === i ? { ...p, iconType: e.target.value as typeof piece.iconType } : p); onChange({ ...data, pieces: updated }); }}>
            {PUZZLE_ICON_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <label style={lbl}>Label Side</label>
          <select style={{ ...inp, background: '#fff' }} value={piece.labelSide} onChange={e => { const updated = pieces.map((p, idx) => idx === i ? { ...p, labelSide: e.target.value as 'left' | 'right' } : p); onChange({ ...data, pieces: updated }); }}>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </div>
      ))}
    </div>
  );
}

// ── Diagram editor modal ──────────────────────────────────────────────────────

export function DiagramModal({
  section,
  diagram,
  onClose,
}: {
  section: LayoutSection;
  diagram: string;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;
  const suggestedType = !diagram ? suggestDiagramType(section.sectionType) : null;

  const CUSTOM_FORM_TYPES = new Set(['orbital', 'puzzle', 'steps-flow', 'timeline-bar', 'donut-chart', 'bar-chart', 'stat-grid', 'tree-diagram', 'journey-map', 'comparison-table']);

  const [activeType, setActiveType] = useState(() => {
    if (!diagram) return suggestedType ?? 'flowchart';
    if (diagram.startsWith(CUSTOM_SVG_PREFIX)) {
      const data = parseCustomDiagramData(diagram);
      if (data?.type) return data.type;
    }
    if (diagram.startsWith('sequenceDiagram')) return 'sequence';
    if (diagram.startsWith('gantt')) return 'gantt';
    if (diagram.startsWith('pie')) return 'pie';
    if (diagram.startsWith('mindmap')) return 'mindmap';
    if (diagram.startsWith('flowchart') || diagram.startsWith('graph')) return 'flowchart';
    return 'custom';
  });

  const [value, setValue] = useState(() => {
    if (diagram) return diagram.startsWith(CUSTOM_SVG_PREFIX) ? '' : diagram;
    const type = suggestedType ?? 'flowchart';
    if (CUSTOM_FORM_TYPES.has(type)) return '';
    return buildContextTemplate(section, type);
  });

  const existingData = diagram.startsWith(CUSTOM_SVG_PREFIX) ? parseCustomDiagramData(diagram) : null;

  const [orbitalData, setOrbitalData] = useState<OrbitalDiagramData>(
    () => (existingData?.type === 'orbital' ? existingData as OrbitalDiagramData : buildOrbitalDefault(section))
  );
  const [puzzleData, setPuzzleData] = useState<PuzzleDiagramData>(
    () => (existingData?.type === 'puzzle' ? existingData as PuzzleDiagramData : buildPuzzleDefault(section))
  );
  const [stepsFlowData, setStepsFlowData] = useState<StepsFlowData>(
    () => (existingData?.type === 'steps-flow' ? existingData as StepsFlowData : buildStepsFlowDefault(section))
  );
  const [timelineBarData, setTimelineBarData] = useState<TimelineBarData>(
    () => (existingData?.type === 'timeline-bar' ? existingData as TimelineBarData : buildTimelineBarDefault(section))
  );
  const [donutChartData, setDonutChartData] = useState<DonutChartData>(
    () => (existingData?.type === 'donut-chart' ? existingData as DonutChartData : buildDonutChartDefault())
  );
  const [barChartData, setBarChartData] = useState<BarChartData>(
    () => (existingData?.type === 'bar-chart' ? existingData as BarChartData : buildBarChartDefault())
  );
  const [statGridData, setStatGridData] = useState<StatGridData>(
    () => (existingData?.type === 'stat-grid' ? existingData as StatGridData : buildStatGridDefault())
  );
  const [treeDiagramData, setTreeDiagramData] = useState<TreeDiagramData>(
    () => (existingData?.type === 'tree-diagram' ? existingData as TreeDiagramData : buildTreeDiagramDefault(section))
  );
  const [journeyMapData, setJourneyMapData] = useState<JourneyMapData>(
    () => (existingData?.type === 'journey-map' ? existingData as JourneyMapData : buildJourneyMapDefault())
  );
  const [comparisonTableData, setComparisonTableData] = useState<ComparisonTableData>(
    () => (existingData?.type === 'comparison-table' ? existingData as ComparisonTableData : buildComparisonTableDefault())
  );

  function handleTypeSelect(typeId: string) {
    setActiveType(typeId);
    if (typeId === 'orbital') { setOrbitalData(buildOrbitalDefault(section)); return; }
    if (typeId === 'puzzle') { setPuzzleData(buildPuzzleDefault(section)); return; }
    if (typeId === 'steps-flow') { setStepsFlowData(buildStepsFlowDefault(section)); return; }
    if (typeId === 'timeline-bar') { setTimelineBarData(buildTimelineBarDefault(section)); return; }
    if (typeId === 'donut-chart') { setDonutChartData(buildDonutChartDefault()); return; }
    if (typeId === 'bar-chart') { setBarChartData(buildBarChartDefault()); return; }
    if (typeId === 'stat-grid') { setStatGridData(buildStatGridDefault()); return; }
    if (typeId === 'tree-diagram') { setTreeDiagramData(buildTreeDiagramDefault(section)); return; }
    if (typeId === 'journey-map') { setJourneyMapData(buildJourneyMapDefault()); return; }
    if (typeId === 'comparison-table') { setComparisonTableData(buildComparisonTableDefault()); return; }
    const contextTemplate = buildContextTemplate(section, typeId);
    setValue(contextTemplate || (CHART_TYPES.find(t => t.id === typeId)?.template ?? ''));
  }

  function handleSave() {
    let finalValue = value;
    const customDataMap: Record<string, unknown> = {
      'orbital': orbitalData,
      'puzzle': puzzleData,
      'steps-flow': stepsFlowData,
      'timeline-bar': timelineBarData,
      'donut-chart': donutChartData,
      'bar-chart': barChartData,
      'stat-grid': statGridData,
      'tree-diagram': treeDiagramData,
      'journey-map': journeyMapData,
      'comparison-table': comparisonTableData,
    };
    if (CUSTOM_FORM_TYPES.has(activeType)) {
      finalValue = CUSTOM_SVG_PREFIX + JSON.stringify(customDataMap[activeType]);
    }
    ctx.updateField(section.id, 'diagram', finalValue);
    onClose();
  }

  function handleRemove() {
    ctx.updateField(section.id, 'diagram', '');
    onClose();
  }

  const isCustomForm = CUSTOM_FORM_TYPES.has(activeType);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 14,
          width: '100%',
          maxWidth: isCustomForm ? 560 : 900,
          height: 'min(640px, 90vh)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          transition: 'max-width 0.2s',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#1e293b' }}>Edit Diagram</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>
              {isCustomForm ? 'Fill in the form to build your diagram.' : 'Select a chart type, then customize the code. Preview updates automatically.'}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        {/* Chart type selector */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 6, flexShrink: 0, overflowX: 'auto' }}>
          {CHART_TYPES.map(t => (
            <button
              key={t.id}
              onClick={() => handleTypeSelect(t.id)}
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                border: activeType === t.id ? 'none' : '1px solid #e2e8f0',
                background: activeType === t.id ? '#6366f1' : '#f8fafc',
                color: activeType === t.id ? '#fff' : '#475569',
                fontSize: 12,
                fontWeight: activeType === t.id ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flexShrink: 0,
                transition: 'all 0.15s',
              }}
            >
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {activeType === 'orbital'          ? <OrbitalForm data={orbitalData} onChange={setOrbitalData} />
          : activeType === 'puzzle'          ? <PuzzleForm data={puzzleData} onChange={setPuzzleData} />
          : activeType === 'steps-flow'      ? <StepsFlowForm data={stepsFlowData} onChange={setStepsFlowData} />
          : activeType === 'timeline-bar'    ? <TimelineBarForm data={timelineBarData} onChange={setTimelineBarData} />
          : activeType === 'donut-chart'     ? <DonutChartForm data={donutChartData} onChange={setDonutChartData} />
          : activeType === 'bar-chart'       ? <BarChartForm data={barChartData} onChange={setBarChartData} />
          : activeType === 'stat-grid'       ? <StatGridForm data={statGridData} onChange={setStatGridData} />
          : activeType === 'tree-diagram'    ? <TreeDiagramForm data={treeDiagramData} onChange={setTreeDiagramData} />
          : activeType === 'journey-map'     ? <JourneyMapForm data={journeyMapData} onChange={setJourneyMapData} />
          : activeType === 'comparison-table'? <ComparisonTableForm data={comparisonTableData} onChange={setComparisonTableData} />
          : (
            <>
              {/* Code editor */}
              <div style={{ flex: '0 0 50%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #e2e8f0' }}>
                <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Code</span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>Mermaid syntax</span>
                </div>
                <textarea
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: 'none',
                    outline: 'none',
                    fontSize: 12,
                    fontFamily: 'Consolas, "Courier New", monospace',
                    lineHeight: 1.7,
                    resize: 'none',
                    color: '#1e293b',
                    background: '#fafafa',
                  }}
                />
              </div>

              {/* Live preview */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preview</span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>Updates automatically</span>
                </div>
                <div style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
                  <DiagramPreview code={value} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, justifyContent: 'space-between', flexShrink: 0 }}>
          <button
            onClick={handleRemove}
            style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#dc2626' }}
          >
            Remove diagram
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#64748b' }}>
              Cancel
            </button>
            <button onClick={handleSave} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Save diagram
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Icon picker ────────────────────────────────────────────────────────────────

const ICON_HINTS = [
  { hint: 'identity',  emoji: '👤', label: 'Identity' },
  { hint: 'digital',   emoji: '💻', label: 'Digital' },
  { hint: 'content',   emoji: '📄', label: 'Content' },
  { hint: 'strategy',  emoji: '⭐', label: 'Strategy' },
  { hint: 'research',  emoji: '🔍', label: 'Research' },
  { hint: 'launch',    emoji: '🚀', label: 'Launch' },
  { hint: 'document',  emoji: '📁', label: 'Document' },
  { hint: 'website',   emoji: '🌐', label: 'Website' },
  { hint: 'photo',     emoji: '🖼', label: 'Photo' },
  { hint: 'campaign',  emoji: '📢', label: 'Campaign' },
  { hint: 'default',   emoji: '⊞',  label: 'Grid' },
  { hint: 'check',     emoji: '✓',  label: 'Check' },
  { hint: 'star',      emoji: '✦',  label: 'Star' },
  { hint: 'lock',      emoji: '🔒', label: 'Lock' },
  { hint: 'bolt',      emoji: '⚡', label: 'Bolt' },
  { hint: 'target',    emoji: '🎯', label: 'Target' },
  { hint: 'chart',     emoji: '📊', label: 'Chart' },
  { hint: 'tool',      emoji: '🔧', label: 'Tool' },
  { hint: 'gem',       emoji: '💎', label: 'Gem' },
  { hint: 'trophy',    emoji: '🏆', label: 'Trophy' },
  { hint: 'shield',    emoji: '🛡',  label: 'Shield' },
  { hint: 'flag',      emoji: '🚩', label: 'Flag' },
  { hint: 'leaf',      emoji: '🌿', label: 'Leaf' },
  { hint: 'fire',      emoji: '🔥', label: 'Fire' },
];

function IconPickerPanel({
  sectionId,
  fieldPath,
  currentHint,
  onClose,
}: {
  sectionId: string;
  fieldPath: string;
  currentHint: string;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 8,
        zIndex: 25000,
        width: 280,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        border: '1px solid #e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Pick Icon
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 10, color: '#94a3b8' }}>
          Field: <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>{fieldPath}</code>
        </p>
      </div>
      <div style={{ padding: 10, display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
        {ICON_HINTS.map(({ hint, emoji, label }) => (
          <button
            key={hint}
            title={label}
            onClick={() => { ctx.updateField(sectionId, fieldPath, hint); onClose(); }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              border: currentHint === hint ? '2px solid #6366f1' : '1px solid #e2e8f0',
              background: currentHint === hint ? '#f5f3ff' : '#f8fafc',
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.1s',
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid #e2e8f0' }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Custom hint text
        </label>
        <input
          type="text"
          defaultValue={currentHint}
          placeholder="e.g. check, star, rocket…"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              ctx.updateField(sectionId, fieldPath, (e.target as HTMLInputElement).value);
              onClose();
            }
          }}
          style={{ width: '100%', padding: '5px 8px', borderRadius: 5, border: '1px solid #e2e8f0', fontSize: 12, boxSizing: 'border-box' }}
        />
      </div>
    </div>
  );
}

// ── Background picker panel ───────────────────────────────────────────────────

function BackgroundPanel({
  section,
  onClose,
}: {
  section: LayoutSection;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;
  const [tab, setTab] = useState<'image' | 'color' | 'upload'>('image');
  const [imgUrl, setImgUrl] = useState(section.image?.url ?? '');
  const [imgQuery, setImgQuery] = useState(section.image?.query ?? '');

  function applyImage() {
    ctx.updateField(section.id, '__bgColor', '');   // clear solid color override
    if (imgUrl.trim()) {
      ctx.updateField(section.id, '__imageUrl', imgUrl.trim());
      ctx.updateField(section.id, '__imageSource', 'custom');
    }
    if (imgQuery.trim()) ctx.updateField(section.id, '__imageQuery', imgQuery.trim());
    onClose();
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      ctx.updateField(section.id, '__bgColor', '');  // clear solid color override
      ctx.updateField(section.id, '__imageUrl', dataUrl);
      ctx.updateField(section.id, '__imageSource', 'custom');
      onClose();
    };
    reader.onerror = () => onClose();
    reader.readAsDataURL(file);
  }

  function resetToTheme() {
    ctx.updateField(section.id, '__bgColor', '');
    ctx.updateField(section.id, '__imageUrl', null);
    ctx.updateField(section.id, '__imageSource', 'gradient');
    onClose();
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 8,
        zIndex: 25000,
        width: 340,
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        border: '1px solid #e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0' }}>
        {(['image', 'color', 'upload'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: '10px 0',
              border: 'none',
              background: tab === t ? '#f5f3ff' : '#fff',
              color: tab === t ? '#6366f1' : '#64748b',
              fontWeight: tab === t ? 700 : 500,
              fontSize: 11,
              cursor: 'pointer',
              borderBottom: tab === t ? '2px solid #6366f1' : '2px solid transparent',
            }}
          >
            {t === 'image' ? '🔗 URL' : t === 'color' ? '🎨 Color' : '⬆ Upload'}
          </button>
        ))}
      </div>

      <div style={{ padding: 14 }}>
        {tab === 'image' ? (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Search query
            </label>
            <input
              type="text"
              value={imgQuery}
              onChange={e => setImgQuery(e.target.value)}
              placeholder="e.g. modern office collaboration"
              style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }}
            />
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Image URL
            </label>
            <input
              type="text"
              value={imgUrl}
              onChange={e => setImgUrl(e.target.value)}
              placeholder="https://images.unsplash.com/…"
              style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, marginBottom: 10, boxSizing: 'border-box' }}
            />
            {imgUrl && (
              <div style={{ borderRadius: 6, overflow: 'hidden', height: 80, marginBottom: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { ctx.updateField(section.id, '__bgColor', ''); ctx.updateField(section.id, '__imageUrl', null); ctx.updateField(section.id, '__imageSource', 'gradient'); onClose(); }}
                style={{ flex: 1, padding: '7px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#475569' }}
              >
                Use gradient
              </button>
              <button
                onClick={applyImage}
                style={{ flex: 2, padding: '7px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Apply
              </button>
            </div>
          </>
        ) : tab === 'upload' ? (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Upload image file
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '20px',
                border: '2px dashed #c7d2fe',
                borderRadius: 8,
                background: '#f5f3ff',
                cursor: 'pointer',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 24 }}>⬆</span>
              <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 600 }}>Click to upload</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>PNG, JPG, WebP, SVG</span>
              <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
            </label>
            {section.image?.url?.startsWith('data:') && (
              <div style={{ borderRadius: 6, overflow: 'hidden', height: 60 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={section.image.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
          </>
        ) : (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Custom color
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <input
                type="color"
                defaultValue="#1e293b"
                onChange={e => { ctx.updateField(section.id, '__imageUrl', null); ctx.updateField(section.id, '__bgColor', e.target.value); }}
                style={{ width: 40, height: 36, borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer', padding: 2 }}
              />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Pick any background color</span>
            </div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Presets
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {BG_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  onClick={() => { ctx.updateField(section.id, '__imageUrl', null); ctx.updateField(section.id, '__bgColor', preset.value); onClose(); }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 100,
                    border: '1px solid #e2e8f0',
                    background: '#f8fafc',
                    color: '#475569',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Reset to theme default */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #e2e8f0' }}>
        <button
          onClick={resetToTheme}
          style={{
            width: '100%', padding: '7px', borderRadius: 6,
            border: '1px solid #e2e8f0', background: '#f8fafc',
            color: '#64748b', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ↺ Reset to theme default
        </button>
      </div>
    </div>
  );
}

// ── Section layout variant definitions ───────────────────────────────────────

const SECTION_VARIANTS: Record<string, { id: string; label: string; icon: string; desc: string }[]> = {
  hero: [
    { id: 'centered',     label: 'Centered',     icon: '⊡', desc: 'Centered headline + CTA' },
    { id: 'split',        label: 'Split',        icon: '⊞', desc: 'Text left, visual right' },
    { id: 'asymmetric',   label: 'Asymmetric',   icon: '⊟', desc: 'Bold headline + aside' },
    { id: 'editorial',    label: 'Editorial',    icon: '⊠', desc: 'Magazine-style layout' },
    { id: 'card-grid',    label: 'Card Grid',    icon: '▦', desc: 'Full-width card grid' },
    { id: 'type-forward', label: 'Type Forward', icon: '⊞', desc: 'Typography-first hero' },
  ],
  approach: [
    { id: 'grid', label: 'Grid',  icon: '▦', desc: 'Cards in a responsive grid' },
    { id: 'list', label: 'List',  icon: '☰', desc: 'Rows with icon + text side-by-side' },
  ],
  benefits: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Cards in a responsive grid' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Full-width rows' },
  ],
  deliverables: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Cards in a responsive grid' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Full-width rows' },
  ],
  security: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Items in a responsive grid' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Rows with large icon + text' },
  ],
  team: [
    { id: 'grid', label: 'Grid', icon: '▦', desc: 'Centered profile cards' },
    { id: 'list', label: 'List', icon: '☰', desc: 'Avatar left, bio right' },
  ],
  timeline: [
    { id: 'vertical',   label: 'Vertical',   icon: '⬇', desc: 'Spine on left, cards right' },
    { id: 'horizontal', label: 'Horizontal', icon: '⮕', desc: 'Phases in a row' },
  ],
  faq: [
    { id: 'accordion',  label: 'Accordion',  icon: '⊟', desc: 'Collapsible Q&A rows' },
    { id: 'two-column', label: 'Two Column', icon: '⊞', desc: 'All items always visible' },
  ],
  problem: [
    { id: 'list', label: 'List', icon: '☰', desc: 'Stacked pain point rows' },
    { id: 'grid', label: 'Grid', icon: '▦', desc: '2-column pain point cards' },
  ],
};

const VARIANT_DEFAULTS: Record<string, string> = {
  hero: 'centered',
  approach: 'grid',
  benefits: 'grid',
  deliverables: 'grid',
  security: 'grid',
  team: 'grid',
  timeline: 'vertical',
  faq: 'accordion',
  problem: 'list',
};

function LayoutVariantPanel({
  section,
  onClose,
}: {
  section: LayoutSection;
  onClose: () => void;
}) {
  const ctx = useEditContext()!;
  const variants = SECTION_VARIANTS[section.sectionType];

  if (!variants) return null;

  const content = section.content as unknown as Record<string, unknown>;
  const current = (content.variant as string) ?? VARIANT_DEFAULTS[section.sectionType] ?? variants[0].id;

  return (
    <div style={{
      position: 'absolute', top: '100%', left: 8, zIndex: 25000,
      background: '#fff', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      border: '1px solid #e2e8f0', fontFamily: 'system-ui', overflow: 'hidden', width: 240,
    }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Layout
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 10, color: '#94a3b8' }}>
          {section.sectionType} section
        </p>
      </div>
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {variants.map(v => (
          <button
            key={v.id}
            onClick={() => { ctx.updateField(section.id, 'variant', v.id); onClose(); }}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              border: 'none',
              background: current === v.id ? '#f5f3ff' : 'transparent',
              color: current === v.id ? '#6366f1' : '#475569',
              fontSize: 12,
              fontWeight: current === v.id ? 700 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              textAlign: 'left',
              transition: 'background 0.1s',
            }}
          >
            <span style={{ fontSize: 15 }}>{v.icon}</span>
            <span style={{ flex: 1 }}>
              {v.label}
              <span style={{ display: 'block', fontSize: 10, color: current === v.id ? '#818cf8' : '#94a3b8', fontWeight: 400 }}>
                {v.desc}
              </span>
            </span>
            {current === v.id && <span style={{ fontSize: 10, color: '#6366f1' }}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Embed media panel ─────────────────────────────────────────────────────────

function EmbedPanel({ section, onClose }: { section: LayoutSection; onClose: () => void }) {
  const ctx = useEditContext()!;
  const [url, setUrl] = useState((section.embed?.url) ?? '');
  const [title, setTitle] = useState((section.embed?.title) ?? '');

  function detectType(u: string): string {
    if (u.match(/youtube\.com|youtu\.be/)) return 'YouTube';
    if (u.match(/loom\.com/)) return 'Loom';
    if (u.startsWith('http')) return 'Iframe';
    return '';
  }

  function handleSave() {
    if (!url.trim()) {
      // Remove embed
      const sections = ctx.ast.sections.map(sec =>
        sec.id === section.id ? { ...sec, embed: undefined } : sec
      ) as typeof ctx.ast.sections;
      ctx.replaceAst({ ...ctx.ast, sections });
    } else {
      const sections = ctx.ast.sections.map(sec =>
        sec.id === section.id ? { ...sec, embed: { url: url.trim(), title: title.trim() || undefined } } : sec
      ) as typeof ctx.ast.sections;
      ctx.replaceAst({ ...ctx.ast, sections });
    }
    onClose();
  }

  const detected = detectType(url);

  return (
    <div style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      zIndex: 25000,
      marginTop: 6,
      background: '#fff',
      borderRadius: 10,
      boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
      border: '1px solid #e2e8f0',
      padding: 14,
      width: 320,
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#1e293b' }}>📎 Embed Media</p>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: '#94a3b8' }}>Paste a YouTube, Loom, or any iframe URL</p>

      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>URL</label>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: '1px solid #e2e8f0', fontSize: 12, outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {detected && (
          <p style={{ margin: '4px 0 0', fontSize: 10, color: '#6366f1', fontWeight: 600 }}>✓ Detected: {detected}</p>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10, fontWeight: 600, color: '#64748b', display: 'block', marginBottom: 4 }}>Caption (optional)</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Video title or description"
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: '1px solid #e2e8f0', fontSize: 12, outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1, padding: '7px', borderRadius: 6, border: 'none',
            background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: 'pointer',
          }}
        >{url.trim() ? 'Embed' : 'Remove'}</button>
        <button
          onClick={onClose}
          style={{
            padding: '7px 12px', borderRadius: 6, border: '1px solid #e2e8f0',
            background: '#fff', color: '#64748b', fontSize: 11, fontWeight: 600,
            cursor: 'pointer',
          }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

interface Props {
  section: LayoutSection;
  sectionIndex: number;
  totalSections: number;
  children: React.ReactNode;
  onAiAction?: (sectionId: string, instruction: string) => void;
}

const ACCENT = '#6366f1';

type ActivePanel = 'bg' | 'diagram' | 'layout' | 'icon' | 'embed' | 'ai' | null;

export function SectionEditOverlay({ section, sectionIndex, totalSections, children, onAiAction }: Props) {
  const ctx = useEditContext();
  const [hovered, setHovered] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [showDiagramModal, setShowDiagramModal] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const togglePanel = useCallback((panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? null : panel);
  }, []);

  // Close panel when clicking outside toolbar
  useEffect(() => {
    if (!activePanel) return;
    function handleClick(e: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setActivePanel(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [activePanel]);

  // Outside editor — render children as-is
  if (!ctx) return <>{children}</>;

  const isActive = ctx.activeSectionId === section.id;
  const hasDiagram = !!(section.content as unknown as Record<string, unknown>).diagram;

  function toolbarBtn(
    label: string,
    panelId: ActivePanel,
    onClick?: () => void,
  ) {
    const active = activePanel === panelId;
    return (
      <button
        onClick={onClick ?? (() => togglePanel(panelId))}
        style={{
          padding: '4px 10px',
          borderRadius: 100,
          border: 'none',
          background: active ? ACCENT : 'rgba(255,255,255,0.9)',
          color: active ? '#fff' : '#475569',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          whiteSpace: 'nowrap',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => ctx.selectSection(section.id)}
      style={{
        position: 'relative',
        outline: isActive ? `2px solid ${ACCENT}` : hovered ? `2px solid ${ACCENT}55` : '2px solid transparent',
        outlineOffset: -2,
        transition: 'outline-color 0.15s, box-shadow 0.15s',
        cursor: 'pointer',
        boxShadow: isActive ? `inset 0 0 0 1px ${ACCENT}22` : 'none',
      }}
    >
      {children}

      {/* "Click text to edit" hint — shown below toolbar when section first becomes active */}
      {isActive && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 8,
            zIndex: 20000,
            background: 'rgba(99,102,241,0.9)',
            color: '#fff',
            fontSize: 10,
            fontWeight: 600,
            padding: '3px 9px',
            borderRadius: 100,
            pointerEvents: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.03em',
            whiteSpace: 'nowrap',
          }}
          onClick={e => e.stopPropagation()}
        >
          ✎ Click any text to edit
        </div>
      )}

      {/* Toolbar — always visible when active, visible on hover too */}
      {(hovered || isActive) && (
        <div
          ref={toolbarRef}
          style={{
            position: 'absolute',
            top: 10,
            left: 8,
            zIndex: 20000,
            display: 'flex',
            gap: 4,
            alignItems: 'center',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Section label */}
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 100,
              background: isActive ? ACCENT : 'rgba(99,102,241,0.85)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              backdropFilter: 'blur(8px)',
            }}
          >
            {section.sectionType}
          </span>

          {/* AI quick-actions — single dropdown to keep toolbar compact */}
          {onAiAction && (
            <div style={{ position: 'relative' }}>
              {toolbarBtn('✦ AI', 'ai')}
              {activePanel === ('ai') && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    background: '#fff',
                    border: `1px solid ${ACCENT}28`,
                    borderRadius: 10,
                    boxShadow: `0 8px 24px rgba(0,0,0,0.1), 0 0 0 1px ${ACCENT}10`,
                    overflow: 'hidden',
                    minWidth: 172,
                    zIndex: 20001,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                  }}
                >
                  <div style={{ padding: '7px 12px 5px', borderBottom: `1px solid ${ACCENT}18` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT, letterSpacing: '0.07em', textTransform: 'uppercase' }}>✦ AI Actions</span>
                  </div>
                  {[
                    { icon: '✎', label: 'Rewrite',       desc: 'Improve copy',              instruction: 'Rewrite this section with improved copy' },
                    { icon: '✂', label: 'Shorten',       desc: 'Make concise',              instruction: 'Make this section more concise — 3 bullet points max' },
                    { icon: '↕', label: 'Expand',        desc: 'Add more detail',           instruction: 'Expand this section with more detail and supporting evidence' },
                    { icon: '💼', label: 'C-Suite tone',  desc: 'Executive-friendly',        instruction: 'Rewrite this section for a C-suite executive audience — strategic, concise, outcome-focused' },
                    { icon: '🔥', label: 'More urgent',   desc: 'Increase urgency',          instruction: 'Rewrite this section to feel more urgent and compelling' },
                    { icon: '📊', label: 'Add stats',     desc: 'Insert data points',        instruction: 'Enhance this section by adding relevant statistics, percentages, or data points' },
                    { icon: '◈', label: 'Restyle',       desc: 'New visual treatment',      instruction: 'Restyle this section — make it more visually striking' },
                    { icon: '🌍', label: 'Simplify',      desc: 'Plain language',            instruction: 'Rewrite this section in plain, simple language anyone can understand' },
                  ].map(({ icon, label, desc, instruction }) => (
                    <button
                      key={label}
                      onClick={() => { onAiAction(section.id, instruction); setActivePanel(null); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        width: '100%',
                        padding: '7px 12px',
                        border: 'none',
                        background: 'transparent',
                        color: '#1e293b',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.1s',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${ACCENT}12`; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span style={{
                        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                        background: `${ACCENT}18`,
                        color: ACCENT, fontSize: 13,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700,
                      }}>{icon}</span>
                      <span>
                        <span style={{ display: 'block', fontWeight: 600, color: '#1e293b', fontSize: 12 }}>{label}</span>
                        <span style={{ display: 'block', fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Background button */}
          <div style={{ position: 'relative' }}>
            {toolbarBtn('🖼 Background', 'bg')}
            {activePanel === 'bg' && (
              <BackgroundPanel section={section} onClose={() => setActivePanel(null)} />
            )}
          </div>

          {/* Diagram button — only for sections that support diagrams */}
          {DIAGRAM_SECTION_TYPES.has(section.sectionType) && (
            <div style={{ position: 'relative' }}>
              {toolbarBtn(
                hasDiagram ? '◈ Diagram' : '+ Diagram',
                null,
                () => setShowDiagramModal(true),
              )}
            </div>
          )}

          {/* Embed media */}
          <div style={{ position: 'relative' }}>
            {toolbarBtn(section.embed?.url ? '📎 Embedded' : '📎 Embed', 'embed')}
            {activePanel === 'embed' && (
              <EmbedPanel section={section} onClose={() => setActivePanel(null)} />
            )}
          </div>

          {/* Layout variant — available for all sections that define variants */}
          {SECTION_VARIANTS[section.sectionType] && (
            <div style={{ position: 'relative' }}>
              {toolbarBtn('⊞ Layout', 'layout')}
              {activePanel === 'layout' && (
                <LayoutVariantPanel section={section} onClose={() => setActivePanel(null)} />
              )}
            </div>
          )}

          {/* Move up / down */}
          {sectionIndex > 0 && (
            <button
              onClick={() => ctx.moveArrayItem('__sections__', '__sections__', sectionIndex, sectionIndex - 1)}
              style={{
                padding: '4px 8px',
                borderRadius: 100,
                border: 'none',
                background: 'rgba(255,255,255,0.9)',
                color: '#475569',
                fontSize: 12,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
              title="Move section up"
            >↑</button>
          )}
          {sectionIndex < totalSections - 1 && (
            <button
              onClick={() => ctx.moveArrayItem('__sections__', '__sections__', sectionIndex, sectionIndex + 1)}
              style={{
                padding: '4px 8px',
                borderRadius: 100,
                border: 'none',
                background: 'rgba(255,255,255,0.9)',
                color: '#475569',
                fontSize: 12,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
              title="Move section down"
            >↓</button>
          )}

          {/* Duplicate section */}
          <button
            onClick={() => ctx.duplicateSection(section.id)}
            style={{
              padding: '4px 8px',
              borderRadius: 100,
              border: 'none',
              background: 'rgba(255,255,255,0.9)',
              color: '#475569',
              fontSize: 12,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              fontWeight: 700,
            }}
            title="Duplicate section (Ctrl+D)"
          >⊕</button>

          {/* Delete section */}
          {totalSections > 1 && (
            <button
              onClick={() => {
                if (confirm(`Delete "${section.sectionType}" section? This can be undone with Ctrl+Z.`)) {
                  ctx.removeSection(section.id);
                }
              }}
              style={{
                padding: '4px 8px',
                borderRadius: 100,
                border: 'none',
                background: 'rgba(254,226,226,0.95)',
                color: '#dc2626',
                fontSize: 12,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                fontWeight: 700,
              }}
              title="Delete section"
            >✕</button>
          )}
        </div>
      )}

      {/* Diagram modal */}
      {showDiagramModal && (
        <DiagramModal
          section={section}
          diagram={String((section.content as unknown as Record<string, unknown>).diagram ?? '')}
          onClose={() => setShowDiagramModal(false)}
        />
      )}
    </div>
  );
}
