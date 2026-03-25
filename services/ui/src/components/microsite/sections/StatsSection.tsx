"use client";

import type { PluginTokens, StatsContent } from "../../../types/presentation";
import { Reveal } from "../shared/Reveal";
import { NoiseOverlay } from "../shared/NoiseOverlay";
import { Label, Body } from "../shared/Typography";
import { InlineEditable } from "../editor/InlineEditable";
import { InlineArrayItem, InlineAddItem } from "../editor/InlineArrayControls";

interface Props {
  content: StatsContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function StatsSection({ content, tokens }: Props) {
  const raw = content.stats;
  const stats = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return (
    <section
      style={{
        position: "relative",
        padding: "clamp(4rem, 8vw, 6rem) 2rem",
        background: `linear-gradient(180deg, ${tokens.surfaceAlt} 0%, ${tokens.bg} 100%)`,
        overflow: "hidden",
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {tokens.meshGradient && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: tokens.meshGradient,
            opacity: 0.2,
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "relative",
          zIndex: 5,
          maxWidth: 1100,
          margin: "0 auto",
        }}
      >
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ""}>
            <Label tokens={tokens} style={{ display: "block", textAlign: "center", marginBottom: 14 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>
        <Reveal delay={60}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ""}>
            <h2
              style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: tokens.heroWeight,
                fontSize: "clamp(1.5rem, 3vw, 2.2rem)",
                lineHeight: 1.15,
                color: tokens.text,
                textAlign: "center",
                marginBottom: 56,
              }}
            >
              {content.headline}
            </h2>
          </InlineEditable>
        </Reveal>

        {/* Stats row */}
        <div
          className="ms-stats-row"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(stats.length, 1)}, minmax(0, 1fr))`,
            gap: 0,
            borderRadius: 20,
            border: `1px solid ${tokens.border}`,
            overflow: "hidden",
            background: tokens.surface,
          }}
        >
          {stats.map((stat, i) => (
            <Reveal key={i} delay={120 + i * 80}>
              <InlineArrayItem arrayPath="stats" index={i} total={stats.length}>
                <div
                  style={{
                    padding: "clamp(2rem, 4vw, 3rem) clamp(1rem, 2vw, 2rem)",
                    textAlign: "center",
                    borderRight: i < stats.length - 1 ? `1px solid ${tokens.border}` : "none",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "20%",
                      right: "20%",
                      height: 2,
                      background: `linear-gradient(90deg, transparent, ${tokens.accent}, transparent)`,
                    }}
                  />

                  <InlineEditable field={`stats.${i}.number`} label="Number" value={stat.number ?? ""}>
                    <div
                      style={{
                        fontFamily: `'${tokens.heroFont}', serif`,
                        fontWeight: tokens.heroWeight,
                        fontSize: "clamp(2.2rem, 5vw, 4rem)",
                        lineHeight: 1,
                        color: tokens.accent,
                        marginBottom: 10,
                        letterSpacing: "-0.02em",
                        wordBreak: "break-word",
                        overflowWrap: "break-word",
                      }}
                    >
                      {stat.number}
                    </div>
                  </InlineEditable>

                  <InlineEditable field={`stats.${i}.label`} label="Label" value={stat.label ?? ""}>
                    <div
                      style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 700,
                        fontSize: "0.8rem",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase" as const,
                        color: tokens.text,
                        marginBottom: 10,
                      }}
                    >
                      {stat.label}
                    </div>
                  </InlineEditable>

                  <InlineEditable field={`stats.${i}.context`} label="Context" value={stat.context ?? ""} multiline>
                    <Body tokens={tokens} style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
                      {stat.context}
                    </Body>
                  </InlineEditable>
                </div>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
          <InlineAddItem
            arrayPath="stats"
            template={{ number: '0', label: 'New stat', context: 'Context…' }}
            label="Add stat"
          />
        </div>
      </div>
    </section>
  );
}
