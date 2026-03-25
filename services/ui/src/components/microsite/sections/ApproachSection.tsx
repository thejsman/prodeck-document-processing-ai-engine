"use client";

import type { PluginTokens, ApproachContent } from "../../../types/presentation";
import { Reveal } from "../shared/Reveal";
import { NoiseOverlay } from "../shared/NoiseOverlay";
import { Headline, Body, Label } from "../shared/Typography";
import { getSectionGradient } from "../../../lib/presentation/pluginRegistry";
import { ThemedMermaid } from "../shared/ThemedMermaid";
import { InlineEditable } from "../editor/InlineEditable";
import { InlineArrayItem, InlineAddItem } from "../editor/InlineArrayControls";
import { InlineIconEdit } from "../editor/InlineIconEdit";
import { ProcessSteps } from "../shared/ProcessSteps";

interface Props {
  content: ApproachContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function ApproachSection({ content, tokens, index }: Props) {
  const pillars = content.pillars ?? [];

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

      <div
        style={{
          position: "absolute", right: "-3%", top: "5%",
          fontFamily: `'${tokens.heroFont}', serif`,
          fontSize: "clamp(8rem, 18vw, 16rem)",
          fontWeight: tokens.heroWeight,
          color: tokens.text, opacity: 0.02, lineHeight: 1,
          pointerEvents: "none", zIndex: 1,
        }}
      >
        {String(index + 1).padStart(2, "0")}
      </div>

      <div style={{ position: "relative", zIndex: 5, maxWidth: 960, margin: "0 auto" }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ""}>
            <Label tokens={tokens} style={{ display: "block", marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ""}>
            <Headline tokens={tokens} style={{ marginBottom: 12 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={160}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ""} multiline>
              <Body tokens={tokens} style={{ maxWidth: 640, marginBottom: 48 }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        {/* Pillar cards */}
        <div
          className="ms-grid-auto"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "clamp(1.5rem, 3vw, 2rem)",
          }}
        >
          {pillars.map((pillar, pi) => (
            <Reveal key={pi} delay={240 + pi * 80}>
              <InlineArrayItem arrayPath="pillars" index={pi} total={pillars.length}>
                <div
                  style={{
                    padding: tokens.density === "compact" ? "20px 18px" : tokens.density === "spacious" ? "40px 36px" : "32px 28px",
                    borderRadius: parseInt(tokens.borderRadius ?? "8") || 8,
                    border: `1px solid ${tokens.border}`,
                    background: tokens.surfaceCard,
                    height: "100%",
                  }}
                >
                  <InlineIconEdit
                    fieldPath={`pillars.${pi}.iconHint`}
                    hint={pillar.iconHint}
                    color={tokens.accent}
                    size={28}
                    containerStyle={{ marginBottom: 16, display: 'inline-flex' }}
                  />
                  <InlineEditable field={`pillars.${pi}.name`} label="Pillar Name" value={pillar.name ?? ""}>
                    <h3
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 600, fontSize: "1.05rem",
                        color: tokens.text, margin: "0 0 10px",
                      }}
                    >
                      {pillar.name}
                    </h3>
                  </InlineEditable>
                  <InlineEditable field={`pillars.${pi}.description`} label="Description" value={pillar.description ?? ""} multiline>
                    <Body tokens={tokens} style={{ fontSize: "0.9rem" }}>
                      {pillar.description}
                    </Body>
                  </InlineEditable>
                </div>
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

        {pillars.length > 1 && (
          <ProcessSteps
            steps={pillars.map((p, i) => ({ number: String(i + 1), title: p.name, description: p.description }))}
            tokens={tokens}
            heading="How We Work"
            baseDelay={240 + pillars.length * 80}
          />
        )}

        {content.diagram && (
          <ThemedMermaid
            diagram={content.diagram}
            tokens={tokens}
            delay={240 + pillars.length * 80 + 80}
            caption="Methodology overview"
          />
        )}
      </div>
    </section>
  );
}
