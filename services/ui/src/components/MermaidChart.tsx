'use client';

import { useEffect, useRef, useState } from 'react';
import type { PluginTokens } from '../types/presentation';

interface Props {
  chart: string;
  tokens: PluginTokens;
}

function buildThemeVariables(tokens: PluginTokens) {
  return {
    primaryColor:           tokens.surfaceCard,
    primaryBorderColor:     tokens.border,
    primaryTextColor:       tokens.text,
    secondaryTextColor:     tokens.textMuted,
    secondaryColor:         tokens.surfaceAlt,
    tertiaryColor:          tokens.surface,
    tertiaryBorderColor:    tokens.borderSubtle,
    tertiaryTextColor:      tokens.textMuted,
    lineColor:              tokens.accent,
    edgeLabelBackground:    tokens.surfaceCard,
    clusterBkg:             tokens.surfaceAlt,
    clusterBorder:          tokens.border,
    titleColor:             tokens.text,
    mainBkg:                tokens.surfaceCard,
    background:             tokens.surfaceCard,
    // Gantt
    taskBkgColor:           tokens.accentDim,
    taskBorderColor:        tokens.accent,
    taskTextColor:          tokens.text,
    taskTextLightColor:     tokens.text,
    taskTextOutsideColor:   tokens.textMuted,
    taskTextClickableColor: tokens.accent,
    sectionBkgColor:        tokens.surfaceAlt,
    sectionBkgColor2:       tokens.surface,
    altSectionBkgColor:     tokens.surface,
    gridColor:              tokens.borderSubtle,
    todayLineColor:         tokens.accent,
    // Pie
    pie1: tokens.accent,
    pie2: tokens.accentDim,
    pie3: `${tokens.accent}99`,
    pie4: `${tokens.accent}66`,
    pie5: tokens.textSubtle,
    pie6: tokens.border,
    pie7: tokens.surfaceAlt,
    pieStrokeColor:         tokens.bg,
    pieOuterStrokeColor:    tokens.border,
    pieOuterStrokeWidth:    '2px',
    pieTitleTextColor:      tokens.text,
    pieSectionTextColor:    tokens.text,
    pieOpacity:             '1',
    // Typography
    fontFamily: `'${tokens.bodyFont}', system-ui, sans-serif`,
    fontSize:   '13px',
  };
}

/**
 * Renders a Mermaid diagram fully themed with PluginTokens.
 * Re-initialises mermaid whenever the token set changes (theme-switch safe).
 */
export function MermaidChart({ chart, tokens }: Props) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const lastThemeRef = useRef<string>('');

  useEffect(() => {
    if (!chart.trim()) return;
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;

        const themeVars = buildThemeVariables(tokens);
        const themeKey = JSON.stringify(themeVars);

        if (lastThemeRef.current !== themeKey) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'base',
            themeVariables: themeVars,
            flowchart: { curve: 'basis', padding: 20, htmlLabels: true, nodeSpacing: 50, rankSpacing: 60, useMaxWidth: true },
            gantt: { barHeight: 20, barGap: 8, topPadding: 50, fontSize: 13, useMaxWidth: true },
            pie: { textPosition: 0.5, useMaxWidth: true },
            sequence: {
              diagramMarginX: 50, diagramMarginY: 10,
              actorMargin: 50, width: 150, height: 65,
              boxMargin: 10, messageMargin: 35,
              mirrorActors: true, bottomMarginAdj: 2,
              useMaxWidth: true,
            },
            quadrantChart: { chartWidth: 400, chartHeight: 400, pointRadius: 5, pointLabelFontSize: 12 },
            securityLevel: 'loose',
          });
          lastThemeRef.current = themeKey;
        }

        // Normalize diagram string from agent output:
        // 1. Unescape literal \\n sequences → real newlines (agent JSON-encodes newlines)
        // 2. Strip inner quotes from node labels: A["Foo Bar"] → A[Foo Bar]
        // 3. Gantt charts must have dateFormat — inject it if missing
        let normalizedChart = chart.trim()
          .replace(/\\n/g, '\n')
          .replace(/\["([^"]*)"\]/g, '[$1]');

        if (/^gantt\b/i.test(normalizedChart) && !/dateFormat\s/i.test(normalizedChart)) {
          normalizedChart = normalizedChart.replace(/^(gantt\s*\n)/i, '$1    dateFormat YYYY-MM-DD\n');
        }

        // Pre-validate before render — catches internal Mermaid crashes early
        try {
          await mermaid.parse(normalizedChart);
        } catch {
          if (!cancelled) setError('render-failed');
          return;
        }

        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, normalizedChart);

        // Mermaid v11 may leave a hidden error div in body — clean it up
        document.getElementById(`${id}-error`)?.remove();

        if (!cancelled) {
          setSvg(rendered);
          setError('');
        }
      } catch (err) {
        console.error('[MermaidChart] render failed:', err);
        if (!cancelled) {
          setError('render-failed');
          setSvg('');
        }
        // Mermaid v11 injects error text into the DOM before throwing — remove it
        document.querySelectorAll('[id^="mermaid-"]').forEach(el => {
          if (el.textContent?.includes('Syntax error')) el.remove();
        });
      }
    })();

    return () => { cancelled = true; };
  }, [chart, tokens]);

  if (error) {
    return null;
  }

  if (!svg) {
    return null;
  }

  return (
    <div
      style={{ overflow: 'auto', display: 'flex', justifyContent: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
