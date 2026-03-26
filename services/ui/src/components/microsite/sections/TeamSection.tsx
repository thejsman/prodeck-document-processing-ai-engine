'use client';

import type { PluginTokens, TeamContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { GlassCard } from '../shared/GlassCard';
import { Headline, Label, Body } from '../shared/Typography';
import { InlineEditable } from '../editor/InlineEditable';
import { InlineArrayItem, InlineAddItem } from '../editor/InlineArrayControls';
import { InlineIconEdit } from '../editor/InlineIconEdit';

interface Props {
  content: TeamContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
}

export function TeamSection({ content, tokens }: Props) {
  const members = content.members ?? [];
  const cols = Math.min(members.length, 4);

  return (
    <section
      style={{
        position: 'relative',
        padding: 'clamp(4rem, 8vw, 7rem) 2rem',
        background: `linear-gradient(180deg, ${tokens.surface} 0%, ${tokens.bg} 100%)`,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 1100, margin: '0 auto' }}>
        <Reveal>
          <InlineEditable field="eyebrow" label="Eyebrow" value={content.eyebrow ?? ''}>
            <Label tokens={tokens} style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
              {content.eyebrow}
            </Label>
          </InlineEditable>
        </Reveal>

        <Reveal delay={80}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: content.subheadline ? 16 : 56 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={120}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
              <Body tokens={tokens} style={{ textAlign: 'center', marginBottom: 56, maxWidth: 600, margin: '0 auto 56px' }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        <div
          className="ms-grid-3"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.max(cols, 1)}, 1fr)`,
            gap: 'clamp(1rem, 2.5vw, 2rem)',
          }}
        >
          {members.map((member, i) => (
            <Reveal key={i} delay={160 + i * 80}>
              <InlineArrayItem arrayPath="members" index={i} total={members.length}>
                <GlassCard tokens={tokens} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  {/* Avatar with icon */}
                  <InlineIconEdit
                    fieldPath={`members.${i}.iconHint`}
                    hint={member.iconHint}
                    color={tokens.accent}
                    size={28}
                    containerStyle={{
                      width: 72, height: 72, borderRadius: '50%',
                      background: `linear-gradient(135deg, ${tokens.accent}30, ${tokens.accent}60)`,
                      border: `2px solid ${tokens.accent}50`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  />

                  <div style={{ flex: 1, width: '100%' }}>
                    <InlineEditable field={`members.${i}.name`} label="Name" value={member.name ?? ''}>
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 700, fontSize: '1rem', color: tokens.text, marginBottom: 4,
                      }}>
                        {member.name}
                      </div>
                    </InlineEditable>

                    <InlineEditable field={`members.${i}.role`} label="Role" value={member.role ?? ''}>
                      <div style={{
                        fontFamily: `'${tokens.bodyFont}', sans-serif`,
                        fontWeight: 500, fontSize: '0.8rem',
                        color: tokens.accent, marginBottom: 12,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>
                        {member.role}
                      </div>
                    </InlineEditable>

                    <InlineEditable field={`members.${i}.bio`} label="Bio" value={member.bio ?? ''} multiline>
                      <Body tokens={tokens} style={{ fontSize: '0.875rem', lineHeight: 1.65 }}>
                        {member.bio}
                      </Body>
                    </InlineEditable>
                  </div>
                </GlassCard>
              </InlineArrayItem>
            </Reveal>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <InlineAddItem
            arrayPath="members"
            template={{ name: 'Team Member', role: 'Role Title', bio: 'Brief bio…', iconHint: 'identity' }}
            label="Add member"
          />
        </div>
      </div>
    </section>
  );
}
