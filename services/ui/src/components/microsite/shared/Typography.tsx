'use client';

import React from 'react';
import type { PluginTokens } from '../../../types/presentation';

/**
 * Convert inline markup to safe HTML.
 * Handles: **bold**, _italic_, [c=#xxx]color[/c], \n → <br/>
 */
export function inlineMarkdownToHtml(text: string): string {
  // Step 1: escape HTML entities (except we must not escape our own color tags)
  // Pull out [c=...] spans first, replace with placeholders, then escape, then restore.
  const colorSpans: string[] = [];
  const withPlaceholders = text.replace(
    /\[c=(#[0-9a-fA-F]{3,8}|[a-z]+)]\((.+?)\[\/c\]|\[c=(#[0-9a-fA-F]{3,8}|[a-z]+)\](.+?)\[\/c\]/gs,
    (_, c1, t1, c2, t2) => {
      const color = c1 ?? c2;
      const inner = t1 ?? t2;
      const idx = colorSpans.length;
      colorSpans.push(`<span style="color:${color};-webkit-text-fill-color:${color}">${inner}</span>`);
      return `\x00${idx}\x00`;
    },
  );
  let html = withPlaceholders
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/_(.+?)_/gs, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
  // Step 2: restore color spans
  html = html.replace(/\x00(\d+)\x00/g, (_, i) => colorSpans[parseInt(i)] ?? '');
  return html;
}

export function hasMarkdown(text: string): boolean {
  return /\*\*|_[^_]|<br|\[c=/.test(text);
}

/**
 * Spread onto any JSX element whose only child is a text field that may contain color/bold/italic markup.
 * Always returns { children } (never dangerouslySetInnerHTML on the outer element) so that
 * Editable.cloneElement can safely inject its own children without conflict.
 */
export function rt(value: string | undefined | null): { children: React.ReactNode } {
  const v = value ?? '';
  return {
    children: hasMarkdown(v)
      ? React.createElement('span', { dangerouslySetInnerHTML: { __html: inlineMarkdownToHtml(v) } })
      : v,
  };
}

/** Renders a string that may contain inline markup as a React element with dangerouslySetInnerHTML. */
function RichChild({
  children,
  tag: Tag,
  style,
}: {
  children: React.ReactNode;
  tag: keyof React.JSX.IntrinsicElements;
  style?: React.CSSProperties;
}) {
  // Plain string — fast path
  if (typeof children === 'string') {
    if (hasMarkdown(children)) {
      return <Tag style={style} dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(children) }} />;
    }
    return <Tag style={style}>{children}</Tag>;
  }
  // Mixed children array (e.g. string + <TypingCursor/>) — process each string item inline
  const childArray = React.Children.toArray(children);
  const hasAnyMarkdown = childArray.some((c) => typeof c === 'string' && hasMarkdown(c));
  if (hasAnyMarkdown) {
    return (
      <Tag style={style}>
        {childArray.map((child, i) =>
          typeof child === 'string' && hasMarkdown(child) ? (
            <span key={i} dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(child) }} />
          ) : (
            child
          ),
        )}
      </Tag>
    );
  }
  return <Tag style={style}>{children}</Tag>;
}

interface TypoProps {
  children: React.ReactNode;
  tokens: PluginTokens;
  style?: React.CSSProperties;
  gradient?: boolean;
}

export function Display({ children, tokens, style, gradient }: TypoProps) {
  const isGradient = gradient && !!tokens.gradientText;
  const computedStyle: React.CSSProperties = {
    fontFamily: `'${tokens.heroFont}', serif`,
    fontWeight: tokens.heroWeight,
    fontStyle: tokens.heroStyle,
    fontSize: 'calc(clamp(1.5rem, 5cqi, 3rem) * var(--ms-title-scale, 1))',
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    margin: 0,
    ...(isGradient
      ? {
          backgroundImage: tokens.gradientText,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          color: 'transparent',
        }
      : { color: tokens.text }),
    ...style,
  };
  return (
    <RichChild tag="h1" style={computedStyle}>
      {children}
    </RichChild>
  );
}

export function Headline({ children, tokens, style, gradient }: TypoProps) {
  const isGradient = gradient && !!tokens.gradientText;
  const computedStyle: React.CSSProperties = {
    fontFamily: `'${tokens.heroFont}', serif`,
    fontWeight: tokens.heroWeight,
    fontSize: 'calc(clamp(1.1rem, 3cqi, 1.9rem) * var(--ms-title-scale, 1))',
    lineHeight: 1.1,
    margin: 0,
    ...(isGradient
      ? {
          backgroundImage: tokens.gradientText,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          color: 'transparent',
        }
      : { color: tokens.text }),
    ...style,
  };
  return (
    <RichChild tag="h2" style={computedStyle}>
      {children}
    </RichChild>
  );
}

export function Label({ children, tokens, style }: TypoProps) {
  const computedStyle: React.CSSProperties = {
    fontFamily: `'${tokens.bodyFont}', sans-serif`,
    fontSize: 'calc(0.65rem * var(--ms-content-scale, 1))',
    fontWeight: 600,
    letterSpacing: tokens.labelTracking,
    textTransform: 'uppercase' as const,
    color: tokens.accent,
    margin: 0,
    ...style,
  };
  return (
    <RichChild tag="span" style={computedStyle}>
      {children}
    </RichChild>
  );
}

export function SubHeadline({ children, tokens, style }: TypoProps) {
  const computedStyle: React.CSSProperties = {
    fontFamily: `'${tokens.bodyFont}', sans-serif`,
    fontWeight: 600,
    fontSize: 'calc(clamp(0.8rem, 1.8cqi, 1rem) * var(--ms-title-scale, 1))',
    lineHeight: 1.3,
    color: tokens.text,
    margin: 0,
    ...style,
  };
  return (
    <RichChild tag="h3" style={computedStyle}>
      {children}
    </RichChild>
  );
}

export function Body({ children, tokens, style }: TypoProps) {
  const computedStyle: React.CSSProperties = {
    fontFamily: `'${tokens.bodyFont}', sans-serif`,
    fontWeight: 300,
    lineHeight: 1.85,
    color: tokens.textMuted,
    fontSize: 'calc(0.875rem * var(--ms-content-scale, 1))',
    margin: 0,
    ...style,
  };
  return (
    <RichChild tag="p" style={computedStyle}>
      {children}
    </RichChild>
  );
}
