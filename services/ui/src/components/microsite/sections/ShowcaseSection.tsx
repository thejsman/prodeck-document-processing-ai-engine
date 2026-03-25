"use client";

import type {
  PluginTokens,
  ShowcaseContent,
} from "../../../types/presentation";
import { Reveal } from "../shared/Reveal";
import { NoiseOverlay } from "../shared/NoiseOverlay";
import { Headline, Label, Body } from "../shared/Typography";
import { InlineEditable } from "../editor/InlineEditable";
import { InlineArrayItem, InlineAddItem } from "../editor/InlineArrayControls";

interface Props {
  content: ShowcaseContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function ShowcaseSection({ content, tokens, index, sectionId }: Props) {
  const highlights = content.highlights ?? [];
  // Alternate visual side based on section index
  const visualLeft = index % 2 === 0;

  const visual = (
    <div
      style={{
        flex: "0 0 clamp(280px, 45%, 520px)",
        borderRadius: 20,
        overflow: "hidden",
        position: "relative",
        minHeight: 360,
        background: tokens.meshGradient
          ? tokens.meshGradient + `, ${tokens.surfaceAlt}`
          : `radial-gradient(ellipse 80% 80% at 50% 50%, ${tokens.accent}20 0%, ${tokens.surfaceAlt} 100%)`,
        border: `1px solid ${tokens.border}`,
      }}
    >
      {/* Floating pills */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          padding: 28,
          alignContent: "flex-end",
        }}
      >
        {highlights.map((pill, i) => (
          <span
            key={i}
            style={{
              padding: "6px 14px",
              borderRadius: 100,
              border: `1px solid ${tokens.accent}60`,
              background: `${tokens.accent}15`,
              backdropFilter: "blur(8px)",
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontSize: "0.75rem",
              fontWeight: 500,
              color: tokens.accent,
              letterSpacing: "0.05em",
            }}
          >
            {pill}
          </span>
        ))}
      </div>

      {/* Decorative orb */}
      <div
        style={{
          position: "absolute",
          top: "15%",
          left: "20%",
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${tokens.accent}30 0%, transparent 70%)`,
          filter: "blur(40px)",
          pointerEvents: "none",
        }}
      />
    </div>
  );

  const text = (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Reveal>
        <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
          <Label tokens={tokens} style={{ display: "block", marginBottom: 14 }}>
            {content.eyebrow}
          </Label>
        </InlineEditable>
      </Reveal>
      <Reveal delay={80}>
        <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
          <Headline tokens={tokens} style={{ marginBottom: 14 }}>
            {content.headline}
          </Headline>
        </InlineEditable>
      </Reveal>
      <Reveal delay={160}>
        <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
          <p
            style={{
              fontFamily: `'${tokens.bodyFont}', sans-serif`,
              fontWeight: 500,
              fontSize: "1.1rem",
              color: tokens.text,
              lineHeight: 1.5,
              marginBottom: 18,
            }}
          >
            {content.subheadline}
          </p>
        </InlineEditable>
      </Reveal>
      <Reveal delay={220}>
        <InlineEditable field="body" label="Body" value={content.body ?? ''} multiline>
          <Body tokens={tokens} style={{ marginBottom: 36 }}>
            {content.body}
          </Body>
        </InlineEditable>
      </Reveal>
      {/* Highlights as vertical list with accent line */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {highlights.map((h, i) => (
          <Reveal key={i} delay={280 + i * 60}>
            <InlineArrayItem arrayPath="highlights" index={i} total={highlights.length}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 3,
                    height: 20,
                    borderRadius: 2,
                    background: tokens.accent,
                    flexShrink: 0,
                  }}
                />
                <InlineEditable field={`highlights.${i}`} label="Highlight" value={h ?? ''}>
                  <span
                    style={{
                      fontFamily: `'${tokens.bodyFont}', sans-serif`,
                      fontSize: "0.9rem",
                      fontWeight: 500,
                      color: tokens.text,
                    }}
                  >
                    {h}
                  </span>
                </InlineEditable>
              </div>
            </InlineArrayItem>
          </Reveal>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <InlineAddItem
          arrayPath="highlights"
          template="New highlight…"
          label="Add highlight"
        />
      </div>
    </div>
  );

  return (
    <section
      style={{
        position: "relative",
        padding: "clamp(4rem, 8vw, 7rem) 2rem",
        background: `linear-gradient(180deg, ${tokens.bg} 0%, ${tokens.surfaceAlt} 50%, ${tokens.bg} 100%)`,
        overflow: "hidden",
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div
        style={{
          position: "relative",
          zIndex: 5,
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <div
          className="ms-split"
          style={{
            display: "flex",
            flexDirection: visualLeft ? "row" : "row-reverse",
            gap: "clamp(2rem, 5vw, 5rem)",
            alignItems: "center",
          }}
        >
          <Reveal delay={visualLeft ? 0 : 80}>{visual}</Reveal>
          {text}
        </div>
      </div>
    </section>
  );
}
