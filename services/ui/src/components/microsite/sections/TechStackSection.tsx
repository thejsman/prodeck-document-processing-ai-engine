'use client';

import type { PluginTokens, TechStackContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, SubHeadline, Label } from '../shared/Typography';
import { getSectionGradient } from '../../../lib/presentation/pluginRegistry';
import { inlineMarkdownToHtml, hasMarkdown } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { InlineIconEdit } from '../editor/InlineIconEdit';

interface Props {
  content: TechStackContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function TechStackSection({ content, tokens }: Props) {
  const categories = content.categories ?? [];

  return (
    <section
      id="techstack"
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: getSectionGradient('techstack', tokens),
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 960, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ marginBottom: 48 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'clamp(1.5rem, 3vw, 2rem)',
          }}
        >
          {categories.map((category, ci) => (
            <Reveal key={ci} variant="scale" delay={160 + ci * 100}>
              <InlineArrayItem arrayPath="categories" index={ci} total={categories.length}>
                <GlassCard tokens={tokens}>
                  <div style={{ marginBottom: 16 }}>
                    <InlineIconEdit
                      fieldPath={`categories.${ci}.iconHint`}
                      hint={category.iconHint}
                      color={tokens.accent}
                      size={48}
                      containerStyle={{ display: 'inline-flex' }}
                    />
                  </div>

                  <InlineEditable field={`categories.${ci}.name`} label="Category Name" value={category.name ?? ''}>
                    <SubHeadline tokens={tokens} style={{ marginBottom: 16 }}>
                      {category.name}
                    </SubHeadline>
                  </InlineEditable>

                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    {(category.items ?? []).map((item, ii) => (
                      <InlineArrayItem key={ii} arrayPath={`categories.${ci}.items`} index={ii} total={(category.items ?? []).length}>
                        <li
                          style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.9rem',
                            fontWeight: 300,
                            color: tokens.textMuted,
                            lineHeight: 1.6,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              background: tokens.accent,
                              flexShrink: 0,
                            }}
                          />
                          <InlineEditable field={`categories.${ci}.items.${ii}`} label="Item" value={item ?? ''}>
                            {typeof item === 'string' && hasMarkdown(item)
                              ? <span dangerouslySetInnerHTML={{ __html: inlineMarkdownToHtml(item) }} />
                              : item}
                          </InlineEditable>
                        </li>
                      </InlineArrayItem>
                    ))}
                  </ul>
                  <div style={{ marginTop: 6 }}>
                    <InlineAddItem
                      arrayPath={`categories.${ci}.items`}
                      template="New technology"
                      label="Add tech"
                    />
                  </div>
                </GlassCard>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="categories"
            template={{ iconHint: 'code', name: 'New category', items: ['Technology 1'] }}
            label="Add category"
          />
        </div>

      </div>

      <style>{`
        @media (max-width: 640px) {
          #techstack > div:last-child > div:nth-child(3) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
