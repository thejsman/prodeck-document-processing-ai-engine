'use client';

import type { PluginTokens } from '../../../types/presentation';

/** Convert basic inline markdown to safe HTML. Only handles **bold**, _italic_, and • bullets. */
export function inlineMarkdownToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

export function hasMarkdown(text: string): boolean {
  return /\*\*|_[^_]|<br/.test(text);
}

interface TypoProps {
  children: React.ReactNode;
  tokens: PluginTokens;
  style?: React.CSSProperties;
  gradient?: boolean;
}

export function Display({ children, tokens, style, gradient }: TypoProps) {
  const isGradient = gradient && !!tokens.gradientText;

  return (
    <h1
      style={{
        fontFamily: `'${tokens.heroFont}', serif`,
        fontWeight: tokens.heroWeight,
        fontStyle: tokens.heroStyle,
        fontSize: 'clamp(2rem, 4.5vw, 3.5rem)',
        letterSpacing: '-0.02em',
        lineHeight: 1.05,
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
      }}
    >
      {children}
    </h1>
  );
}

export function Headline({ children, tokens, style, gradient }: TypoProps) {
  const isGradient = gradient && !!tokens.gradientText;

  return (
    <h2
      style={{
        fontFamily: `'${tokens.heroFont}', serif`,
        fontWeight: tokens.heroWeight,
        fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
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
      }}
    >
      {children}
    </h2>
  );
}

export function Label({ children, tokens, style }: TypoProps) {
  return (
    <span
      style={{
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontSize: '0.65rem',
        fontWeight: 600,
        letterSpacing: tokens.labelTracking,
        textTransform: 'uppercase' as const,
        color: tokens.accent,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function SubHeadline({ children, tokens, style }: TypoProps) {
  return (
    <h3
      style={{
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontWeight: 600,
        fontSize: 'clamp(1rem, 2vw, 1.25rem)',
        lineHeight: 1.3,
        color: tokens.text,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </h3>
  );
}

export function Body({ children, tokens, style }: TypoProps) {
  const pStyle: React.CSSProperties = {
    fontFamily: `'${tokens.bodyFont}', sans-serif`,
    fontWeight: 300,
    lineHeight: 1.85,
    color: tokens.textMuted,
    fontSize: '1rem',
    margin: 0,
    ...style,
  };

  // Parse inline markdown when children is a plain string
  if (typeof children === 'string' && hasMarkdown(children)) {
    return (
      <p
        style={pStyle}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(children) }}
      />
    );
  }

  return <p style={pStyle}>{children}</p>;
}
