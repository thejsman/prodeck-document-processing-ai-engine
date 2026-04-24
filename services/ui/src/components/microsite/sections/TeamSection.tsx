'use client';

import type { PluginTokens, TeamContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
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

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

// Deterministic hue offset per member so each avatar has a distinct tint
const HUE_OFFSETS = [0, 40, 80, 160, 200, 280, 320];

export function TeamSection({ content, tokens }: Props) {
  const members = content.members ?? [];
  const cols = Math.min(Math.max(members.length, 1), 4);
  const variant = (content as unknown as Record<string, unknown>).variant as string ?? 'grid';

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

      {/* Decorative orb */}
      <div style={{
        position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 300, borderRadius: '50%',
        background: `radial-gradient(ellipse, ${tokens.accent}08 0%, transparent 70%)`,
        pointerEvents: 'none', zIndex: 1,
      }} />

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
            <Headline tokens={tokens} style={{ textAlign: 'center', marginBottom: content.subheadline ? 16 : 8 }}>
              {content.headline}
            </Headline>
          </InlineEditable>
        </Reveal>

        {/* Decorative divider */}
        <Reveal delay={100}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: content.subheadline ? 20 : 52 }}>
            <div style={{ height: 1, width: 40, background: `linear-gradient(90deg, transparent, ${tokens.accent}40)` }} />
            <div style={{ width: 5, height: 5, borderRadius: '50%', background: tokens.accent }} />
            <div style={{ height: 1, width: 40, background: `linear-gradient(270deg, transparent, ${tokens.accent}40)` }} />
          </div>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={120}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline} multiline>
              <Body tokens={tokens} style={{ textAlign: 'center', marginBottom: 52, maxWidth: 600, margin: '0 auto 52px' }}>
                {content.subheadline}
              </Body>
            </InlineEditable>
          </Reveal>
        )}

        <div
          style={variant === 'list' ? {
            display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 2vw, 1rem)',
          } : {
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: 'clamp(1rem, 2.5vw, 2rem)',
            alignItems: 'stretch',
          }}
        >
          {members.map((member, i) => {
            const hue = HUE_OFFSETS[i % HUE_OFFSETS.length];
            const avatarBg = `hsl(${hue}, 60%, 35%)`;

            return (
              <Reveal key={i} delay={160 + i * 80} style={variant !== 'list' ? { height: '100%' } : undefined}>
                <InlineArrayItem arrayPath="members" index={i} total={members.length} style={variant !== 'list' ? { height: '100%' } : undefined}>
                  {variant === 'list' ? (
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', gap: 20,
                      padding: '20px 24px',
                      borderRadius: tokens.borderRadius ?? '12px',
                      border: `1px solid ${tokens.border}`,
                      background: tokens.surfaceCard,
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}>
                      {/* Avatar with initials */}
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{
                          width: 56, height: 56, borderRadius: '50%',
                          background: `linear-gradient(135deg, ${tokens.accent}50, ${avatarBg})`,
                          border: `2px solid ${tokens.accent}40`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: `0 4px 12px ${tokens.accent}25`,
                        }}>
                          <span style={{
                            fontFamily: `'${tokens.heroFont}', sans-serif`,
                            fontWeight: 700, fontSize: '1rem',
                            color: '#fff', letterSpacing: '-0.02em',
                          }}>
                            {getInitials(member.name ?? '?')}
                          </span>
                        </div>
                        <InlineIconEdit
                          fieldPath={`members.${i}.iconHint`}
                          hint={member.iconHint}
                          color={tokens.accent}
                          size={0}
                          containerStyle={{ display: 'none' }}
                        />
                      </div>

                      <div style={{ flex: 1 }}>
                        <InlineEditable field={`members.${i}.name`} label="Name" value={member.name ?? ''}>
                          <div style={{
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontWeight: 700, fontSize: '0.9rem',
                            color: tokens.text, marginBottom: 4, lineHeight: 1.3,
                          }}>{member.name}</div>
                        </InlineEditable>
                        <InlineEditable field={`members.${i}.role`} label="Role" value={member.role ?? ''}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 10px',
                            borderRadius: 100,
                            background: `${tokens.accent}14`,
                            border: `1px solid ${tokens.accent}25`,
                            fontFamily: `'${tokens.bodyFont}', sans-serif`,
                            fontSize: '0.68rem', fontWeight: 600,
                            color: tokens.accent, letterSpacing: '0.06em',
                            textTransform: 'uppercase' as const,
                            marginBottom: 10,
                          }}>{member.role}</span>
                        </InlineEditable>
                        <InlineEditable field={`members.${i}.bio`} label="Bio" value={member.bio ?? ''} multiline display="block">
                          <Body tokens={tokens} style={{ fontSize: '0.825rem', lineHeight: 1.65 }}>{member.bio}</Body>
                        </InlineEditable>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      position: 'relative',
                      padding: 'clamp(1.25rem, 2.5vw, 1.75rem)',
                      borderRadius: tokens.borderRadius ?? '16px',
                      border: `1px solid ${tokens.border}`,
                      background: `linear-gradient(145deg, ${tokens.surfaceCard}, ${tokens.surface})`,
                      boxShadow: tokens.cardShadow,
                      textAlign: 'center',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
                      height: '100%',
                    }}>
                      {/* Top gradient stripe */}
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                        background: `linear-gradient(90deg, transparent, ${tokens.accent}60, transparent)`,
                      }} />

                      {/* Avatar */}
                      <div style={{ marginBottom: 14, marginTop: 4 }}>
                        <div style={{
                          width: 72, height: 72, borderRadius: '50%',
                          background: `linear-gradient(135deg, ${tokens.accent}50, ${avatarBg})`,
                          border: `3px solid ${tokens.accent}30`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: `0 6px 20px ${tokens.accent}30`,
                          margin: '0 auto',
                        }}>
                          <span style={{
                            fontFamily: `'${tokens.heroFont}', sans-serif`,
                            fontWeight: 800, fontSize: '1.25rem',
                            color: '#fff', letterSpacing: '-0.02em',
                          }}>
                            {getInitials(member.name ?? '?')}
                          </span>
                        </div>
                        <InlineIconEdit
                          fieldPath={`members.${i}.iconHint`}
                          hint={member.iconHint}
                          color={tokens.accent}
                          size={0}
                          containerStyle={{ display: 'none' }}
                        />
                      </div>

                      <InlineEditable field={`members.${i}.name`} label="Name" value={member.name ?? ''}>
                        <div style={{
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontWeight: 700, fontSize: '0.9rem',
                          color: tokens.text, marginBottom: 6, lineHeight: 1.3,
                        }}>{member.name}</div>
                      </InlineEditable>

                      <InlineEditable field={`members.${i}.role`} label="Role" value={member.role ?? ''}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 12px',
                          borderRadius: 100,
                          background: `${tokens.accent}14`,
                          border: `1px solid ${tokens.accent}25`,
                          fontFamily: `'${tokens.bodyFont}', sans-serif`,
                          fontSize: '0.65rem', fontWeight: 600,
                          color: tokens.accent, letterSpacing: '0.08em',
                          textTransform: 'uppercase' as const,
                          marginBottom: 14,
                        }}>{member.role}</span>
                      </InlineEditable>

                      {/* Divider */}
                      <div style={{ width: 32, height: 1, background: `${tokens.accent}30`, marginBottom: 14 }} />

                      <InlineEditable field={`members.${i}.bio`} label="Bio" value={member.bio ?? ''} multiline display="block">
                        <Body tokens={tokens} style={{ fontSize: '0.82rem', lineHeight: 1.65, textAlign: 'center' }}>{member.bio}</Body>
                      </InlineEditable>
                    </div>
                  )}
                </InlineArrayItem>
              </Reveal>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
          <InlineAddItem
            arrayPath="members"
            template={{ name: 'Team Member', role: 'Role Title', bio: 'Add a short bio describing this team member\'s background and expertise.', iconHint: 'identity' }}
            label="Add member"
          />
        </div>
      </div>
    </section>
  );
}
