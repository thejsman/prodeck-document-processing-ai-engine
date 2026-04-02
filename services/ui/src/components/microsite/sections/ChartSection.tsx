'use client';

import type { PluginTokens, ChartContent, ChartDataPoint } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, Label, Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';

interface Props {
  content: ChartContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

// ── Pure SVG/CSS chart renderers ─────────────────────────────────────────────

function BarChart({ data, tokens, unit }: { data: ChartDataPoint[]; tokens: PluginTokens; unit?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  const ACCENT_PALETTE = [tokens.accent, tokens.accentDim, `${tokens.accent}aa`, `${tokens.accent}70`];

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 180, padding: '0 8px' }}>
        {data.map((d, i) => {
          const pct = (d.value / max) * 100;
          const color = d.color ?? ACCENT_PALETTE[i % ACCENT_PALETTE.length];
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.75rem', fontWeight: 700, color: tokens.text }}>
                {d.value}{unit ?? ''}
              </span>
              <div style={{ width: '100%', height: `${pct}%`, minHeight: 4, borderRadius: '6px 6px 0 0', background: color, transition: 'height 0.6s ease' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, padding: '8px 8px 0', borderTop: `1px solid ${tokens.border}` }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.7rem', color: tokens.textMuted }}>
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function PieChart({ data, tokens, donut }: { data: ChartDataPoint[]; tokens: PluginTokens; donut?: boolean }) {
  if (!data.length) return null;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const ACCENT_PALETTE = [tokens.accent, tokens.accentDim, `${tokens.accent}aa`, `${tokens.accent}60`, `${tokens.textMuted}80`];

  const SIZE = 180;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = SIZE / 2 - 10;
  const IR = donut ? R * 0.55 : 0;

  let cumulative = 0;
  const slices = data.map((d, i) => {
    const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += d.value;
    const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const ix1 = CX + IR * Math.cos(startAngle);
    const iy1 = CY + IR * Math.sin(startAngle);
    const ix2 = CX + IR * Math.cos(endAngle);
    const iy2 = CY + IR * Math.sin(endAngle);
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    const color = d.color ?? ACCENT_PALETTE[i % ACCENT_PALETTE.length];
    const path = donut
      ? `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${IR} ${IR} 0 ${large} 0 ${ix1} ${iy1} Z`
      : `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
    return { path, color, label: d.label, pct: Math.round((d.value / total) * 100) };
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 32, flexWrap: 'wrap', justifyContent: 'center' }}>
      <svg width={SIZE} height={SIZE} style={{ flexShrink: 0 }}>
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} stroke={tokens.bg} strokeWidth={2} />
        ))}
        {donut && (
          <circle cx={CX} cy={CY} r={IR - 2} fill={tokens.surfaceCard} />
        )}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.8rem', color: tokens.text }}>
              {s.label} <span style={{ color: tokens.textMuted }}>({s.pct}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data, tokens, unit }: { data: ChartDataPoint[]; tokens: PluginTokens; unit?: string }) {
  if (data.length < 2) return <BarChart data={data} tokens={tokens} unit={unit} />;
  const max = Math.max(...data.map(d => d.value), 1);
  const W = 400; const H = 160; const PAD = 24;
  const points = data.map((d, i) => ({
    x: PAD + (i / (data.length - 1)) * (W - PAD * 2),
    y: H - PAD - ((d.value / max) * (H - PAD * 2)),
    ...d,
  }));
  const poly = points.map(p => `${p.x},${p.y}`).join(' ');
  const areaPoints = `${points[0].x},${H - PAD} ${poly} ${points[points.length - 1].x},${H - PAD}`;

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W }}>
        <defs>
          <linearGradient id="line-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tokens.accent} stopOpacity="0.3" />
            <stop offset="100%" stopColor={tokens.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={PAD} y1={H - PAD - t * (H - PAD * 2)} x2={W - PAD} y2={H - PAD - t * (H - PAD * 2)}
            stroke={tokens.border} strokeWidth={0.5} />
        ))}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={tokens.border} strokeWidth={1} />
        {/* Area fill */}
        <polygon points={areaPoints} fill="url(#line-area-grad)" />
        {/* Line */}
        <polyline points={poly} fill="none" stroke={tokens.accent} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {/* Dots + labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={5} fill={tokens.bg} stroke={tokens.accent} strokeWidth={2} />
            <text x={p.x} y={H - 4} textAnchor="middle" fontSize={9} fill={tokens.textMuted} fontFamily={tokens.bodyFont}>
              {p.label}
            </text>
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize={9} fill={tokens.text} fontFamily={tokens.bodyFont} fontWeight={700}>
              {p.value}{unit ?? ''}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChartSection({ content, tokens }: Props) {
  const data = content.data ?? [];
  const chartType = content.chartType ?? 'bar';

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surface} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 900, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: content.body ? 16 : 48 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {content.body && (
          <Reveal delay={120}>
            <InlineEditable field="body" label="Body" value={content.body} multiline>
              <Body tokens={tokens} style={{ textAlign: 'center', marginBottom: 48, maxWidth: 600, margin: '0 auto 48px' }}>
                {content.body}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        <Reveal delay={160}>
          <GlassCard tokens={tokens} style={{ padding: 'clamp(1.5rem, 3vw, 2.5rem)' }}>
            {chartType === 'bar' && <BarChart data={data} tokens={tokens} unit={content.unit} />}
            {chartType === 'line' && <LineChart data={data} tokens={tokens} unit={content.unit} />}
            {(chartType === 'pie' || chartType === 'donut') && (
              <PieChart data={data} tokens={tokens} donut={chartType === 'donut'} />
            )}
          </GlassCard>
        </Reveal>

        {/* Inline data editor */}
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.map((d, i) => (
            <InlineArrayItem key={i} arrayPath="data" index={i} total={data.length}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <InlineEditable field={`data.${i}.label`} label="Label" value={d.label ?? ''}>
                  <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.8rem', color: tokens.textMuted, minWidth: 80 }}>
                    {d.label}
                  </span>
                </InlineEditable>
                <InlineEditable field={`data.${i}.value`} label="Value" value={String(d.value ?? 0)}>
                  <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.8rem', color: tokens.text, fontWeight: 600 }}>
                    {d.value}{content.unit ?? ''}
                  </span>
                </InlineEditable>
              </div>
            </InlineArrayItem>
          ))}
          <InlineAddItem
            arrayPath="data"
            template={{ label: 'Label', value: 0 }}
            label="Add data point"
          />
        </div>
      </div>
    </section>
  );
}
