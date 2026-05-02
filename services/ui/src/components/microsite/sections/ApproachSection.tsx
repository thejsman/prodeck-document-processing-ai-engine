"use client";

import { useContext } from "react";
import type { PluginTokens, ApproachContent } from "../../../types/presentation";
import { Reveal } from "../shared/Reveal";
import { NoiseOverlay } from "../shared/NoiseOverlay";
import { Headline, Body, Label, rt, hasMarkdown, inlineMarkdownToHtml } from "../shared/Typography";
import { getSectionGradient } from "../../../lib/presentation/pluginRegistry";
import { InlineEditable } from "../editor/InlineEditable";
import { InlineArrayItem, InlineAddItem } from "../editor/InlineArrayControls";
import { InlineIconEdit } from "../editor/InlineIconEdit";
import { ProcessSteps } from "../shared/ProcessSteps";
import { TypewriterStateContext } from "../TypewriterSection";
import { TypingCursor } from "../TypingCursor";

interface Props {
  content: ApproachContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function ApproachSection({ content, tokens }: Props) {
  const pillars = content.pillars ?? [];
  const twCtx = useContext(TypewriterStateContext);
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'grid';

  return (
    <section
      id="approach"
      style={{
        position: "relative",
        padding: "clamp(4rem, 8vw, 7rem) 2rem",
        background: getSectionGradient("approach", tokens),
        overflow: "hidden",
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />


      <div style={{ position: "relative", zIndex: 5, maxWidth: 960, margin: "0 auto" }}>
        <Reveal>
          <span style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase' as const, color: tokens.accent, display: 'block', marginBottom: 'clamp(1rem, 2vw, 1.5rem)' }}
            {...rt(content.eyebrow ?? '')} />
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ""}>
            <Headline tokens={tokens} style={{ marginBottom: 12 }}>
              {content.headline}
              <TypingCursor visible={twCtx?.activeField === 'headline' && (twCtx?.showCursor ?? false)} />
            </Headline>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={160}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ""} multiline>
              <Body tokens={tokens} style={{ maxWidth: 640, marginBottom: 48 }}>
                {content.subheadline}
                <TypingCursor visible={twCtx?.activeField === 'subheadline' && (twCtx?.showCursor ?? false)} />
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        {/* Pillar cards — grid or list layout */}
        <div
          className={variant === 'list' ? undefined : 'ms-grid-auto'}
          style={variant === 'list' ? {
            display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 2vw, 1rem)',
          } : {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 'clamp(1.5rem, 3vw, 2rem)',
          }}
        >
          {pillars.map((pillar, pi) => (
            <Reveal key={pi} delay={240 + pi * 80}>
              <InlineArrayItem arrayPath="pillars" index={pi} total={pillars.length}>
                {variant === 'list' ? (
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 20,
                    padding: '20px 24px',
                    borderRadius: parseInt(tokens.borderRadius ?? '8') || 8,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                  }}>
                    <InlineIconEdit
                      fieldPath={`pillars.${pi}.iconHint`}
                      hint={pillar.iconHint}
                      color={tokens.accent}
                      size={28}
                      containerStyle={{ flexShrink: 0, marginTop: 2, display: 'inline-flex' }}
                    />
                    <div style={{ flex: 1 }}>
                      <InlineEditable field={`pillars.${pi}.name`} label="Pillar Name" value={pillar.name ?? ''}>
                        <h3 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 600, fontSize: '0.875rem', color: tokens.text, margin: '0 0 6px' }}
                          {...rt(pillar.name ?? '')} />
                      </InlineEditable>
                      <InlineEditable field={`pillars.${pi}.description`} label="Description" value={pillar.description ?? ''} multiline>
                        <Body tokens={tokens} style={{ fontSize: '0.825rem' }}>{pillar.description}</Body>
                      </InlineEditable>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    padding: tokens.density === 'compact' ? '20px 18px' : tokens.density === 'spacious' ? '40px 36px' : '32px 28px',
                    borderRadius: parseInt(tokens.borderRadius ?? '8') || 8,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                    height: '100%',
                  }}>
                    <InlineIconEdit
                      fieldPath={`pillars.${pi}.iconHint`}
                      hint={pillar.iconHint}
                      color={tokens.accent}
                      size={28}
                      containerStyle={{ marginBottom: 16, display: 'inline-flex' }}
                    />
                    <InlineEditable field={`pillars.${pi}.name`} label="Pillar Name" value={pillar.name ?? ''}>
                      <h3 style={{ fontFamily: `'${tokens.bodyFont}', sans-serif`, fontWeight: 600, fontSize: '0.875rem', color: tokens.text, margin: '0 0 10px' }}>
                        {hasMarkdown(pillar.name ?? '')
                          ? <span dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(pillar.name ?? '') }} />
                          : pillar.name}
                        <TypingCursor visible={twCtx?.activeField === `pillars.${pi}.name` && (twCtx?.showCursor ?? false)} />
                      </h3>
                    </InlineEditable>
                    <InlineEditable field={`pillars.${pi}.description`} label="Description" value={pillar.description ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.825rem' }}>{pillar.description}</Body>
                    </InlineEditable>
                  </div>
                )}
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="pillars"
            template={{ iconHint: 'star', name: 'New pillar', description: 'Describe this pillar…' }}
            label="Add pillar"
          />
        </div>

      </div>
    </section>
  );
}
