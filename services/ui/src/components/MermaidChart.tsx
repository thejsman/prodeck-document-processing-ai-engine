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
            flowchart: { curve: 'basis', padding: 20, htmlLabels: true },
            gantt: { barHeight: 20, barGap: 8, topPadding: 50, fontSize: 13 },
            pie: { textPosition: 0.5 },
            securityLevel: 'loose',
          });
          lastThemeRef.current = themeKey;
        }

        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, chart.trim());

        // Mermaid v11 may leave a hidden error div in body — clean it up
        document.getElementById(`${id}-error`)?.remove();

        if (!cancelled) {
          setSvg(rendered);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
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
    return (
      <div
        style={{
          padding: '12px 16px',
          borderRadius: 6,
          background: tokens.surfaceAlt,
          border: `1px solid ${tokens.border}`,
          fontSize: 11,
          color: tokens.textMuted,
          fontFamily: `'${tokens.bodyFont}', sans-serif`,
        }}
      >
        Diagram unavailable
      </div>
    );
  }

  if (!svg) {
    return (
      <div
        style={{
          padding: '32px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: tokens.textSubtle,
          fontFamily: `'${tokens.bodyFont}', sans-serif`,
        }}
      >
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      style={{ overflow: 'auto', display: 'flex', justifyContent: 'center' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
