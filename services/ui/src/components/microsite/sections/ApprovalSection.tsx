'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginTokens, ApprovalContent } from '../../../types/presentation';
import { Reveal } from '../shared/Reveal';
import { NoiseOverlay } from '../shared/NoiseOverlay';
import { InlineEditable } from '../editor/InlineEditable';

interface Props {
  content: ApprovalContent;
  tokens: PluginTokens;
  imageUrl: string | null;
  index: number;
  sectionId?: string;
  /** namespace + proposalId for submission endpoint */
  namespace?: string;
  proposalId?: string;
}

type SubmitState = 'idle' | 'submitting' | 'success' | 'error';

function FieldInput({
  label, value, onChange, required, type = 'text', tokens,
}: {
  label: string; value: string; onChange: (v: string) => void;
  required?: boolean; type?: string; tokens: PluginTokens;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontSize: '0.68rem', fontWeight: 600,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: tokens.textSubtle,
      }}>
        {label}{required && <span style={{ color: tokens.accent, marginLeft: 3 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          background: tokens.surface,
          border: `1px solid ${focused ? tokens.accent : tokens.border}`,
          borderRadius: 8,
          padding: '11px 16px',
          fontFamily: `'${tokens.bodyFont}', sans-serif`,
          fontSize: '0.92rem',
          color: tokens.text,
          outline: 'none',
          transition: 'border-color 0.2s',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function SignaturePad({ tokens, onSign }: { tokens: PluginTokens; onSign: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasSig = useRef(false);

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const src = 'touches' in e ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    drawing.current = true;
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, []);

  const draw = useCallback((e: MouseEvent | TouchEvent) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const ctx = canvas.getContext('2d')!;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = tokens.text;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    hasSig.current = true;
  }, [tokens.text]);

  const endDraw = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasSig.current) {
      onSign(canvas.toDataURL('image/png'));
    }
  }, [onSign]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', endDraw);
    return () => {
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('mousemove', draw);
      canvas.removeEventListener('mouseup', endDraw);
      canvas.removeEventListener('mouseleave', endDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove', draw);
      canvas.removeEventListener('touchend', endDraw);
    };
  }, [startDraw, draw, endDraw]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSig.current = false;
    onSign(null);
  };

  return (
    <div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 8,
      }}>
        <span style={{
          fontFamily: `'${tokens.bodyFont}', sans-serif`,
          fontSize: '0.68rem', fontWeight: 600,
          letterSpacing: '0.1em', textTransform: 'uppercase',
          color: tokens.textSubtle,
        }}>
          Signature <span style={{ color: tokens.accent }}>*</span>
        </span>
        <button
          onClick={clear}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontSize: '0.72rem', color: tokens.textSubtle,
            padding: '2px 8px',
          }}
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={560}
        height={120}
        style={{
          display: 'block',
          width: '100%',
          height: 120,
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: 8,
          cursor: 'crosshair',
          touchAction: 'none',
        }}
      />
      <p style={{
        fontFamily: `'${tokens.bodyFont}', sans-serif`,
        fontSize: '0.7rem', color: tokens.textSubtle,
        marginTop: 6, textAlign: 'center',
      }}>
        Draw your signature above with mouse or touchscreen
      </p>
    </div>
  );
}

export function ApprovalSection({ content, tokens, namespace, proposalId }: Props) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const missing: string[] = [];
  if (!name.trim()) missing.push('full name');
  if (!email.trim()) missing.push('email');
  if (!signature) missing.push('signature');
  if (!termsAccepted) missing.push('accept terms');

  const handleSubmit = async () => {
    if (missing.length > 0) return;
    setSubmitState('submitting');
    setErrorMsg('');
    try {
      const res = await fetch(
        `/api/presentations/${namespace ?? 'default'}/${proposalId ?? 'unknown'}/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, role, company, email, signature, acceptedAt: new Date().toISOString() }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      setSubmitState('success');
    } catch (err) {
      setSubmitState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    }
  };

  const termsText = content.termsText || `By approving this proposal, you confirm that you have read and agreed to the terms and conditions outlined herein. This approval constitutes a binding agreement between both parties. You acknowledge that the services, timeline, and pricing described in this proposal are accepted as presented.`;

  return (
    <section
      id="approval"
      style={{
        position: 'relative',
        padding: 'clamp(5rem, 9vw, 8rem) 2rem',
        background: tokens.bg,
        overflow: 'hidden',
      }}
    >
      <NoiseOverlay opacity={tokens.noiseOpacity} />

      {/* Accent diagonal band */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `linear-gradient(160deg, ${tokens.accent}08 0%, transparent 50%)`,
        zIndex: 0, pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 5, maxWidth: 680, margin: '0 auto' }}>

        {/* Header */}
        <Reveal>
          <span style={{
            fontFamily: `'${tokens.bodyFont}', sans-serif`,
            fontSize: '0.68rem', fontWeight: 600,
            letterSpacing: '0.14em', textTransform: 'uppercase' as const,
            color: tokens.accent, display: 'block',
            marginBottom: 'clamp(1rem, 2vw, 1.5rem)',
          }}>
            {content.eyebrow || 'Approve This Proposal'}
          </span>
        </Reveal>

        <Reveal delay={60}>
          <InlineEditable field="headline" label="Headline" value={content.headline ?? ''}>
            <h2 style={{
              fontFamily: `'${tokens.heroFont}', serif`,
              fontWeight: Number(tokens.heroWeight) || 700,
              fontSize: 'clamp(2rem, 4vw, 3rem)',
              lineHeight: 1.1, letterSpacing: '-0.02em',
              color: tokens.text,
              margin: '0 0 clamp(0.75rem, 1.5vw, 1rem)',
            }}>
              {content.headline || 'Ready to Move Forward?'}
            </h2>
          </InlineEditable>
        </Reveal>

        {content.subheadline && (
          <Reveal delay={120}>
            <InlineEditable field="subheadline" label="Subheadline" value={content.subheadline ?? ''} multiline>
              <p style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: 'clamp(0.95rem, 1.5vw, 1.05rem)',
                lineHeight: 1.8, color: tokens.textMuted,
                margin: '0 0 clamp(2.5rem, 5vw, 3.5rem)',
              }}>
                {content.subheadline}
              </p>
            </InlineEditable>
          </Reveal>
        )}

        {submitState === 'success' ? (
          <Reveal delay={100}>
            <div style={{
              padding: '40px 32px',
              borderRadius: 16,
              border: `1px solid ${tokens.accent}40`,
              background: `linear-gradient(135deg, ${tokens.accent}12, ${tokens.accent}06)`,
              textAlign: 'center',
            }}>
              {/* Checkmark */}
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: `${tokens.accent}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 20px',
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M5 13L9 17L19 7" stroke={tokens.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 style={{
                fontFamily: `'${tokens.heroFont}', serif`,
                fontWeight: 700, fontSize: '1.5rem',
                color: tokens.text, margin: '0 0 12px',
              }}>
                Proposal Approved!
              </h3>
              <p style={{
                fontFamily: `'${tokens.bodyFont}', sans-serif`,
                fontSize: '0.95rem', color: tokens.textMuted, lineHeight: 1.7, margin: 0,
              }}>
                Thank you, <strong style={{ color: tokens.text }}>{name}</strong>. A confirmation has been sent to <strong style={{ color: tokens.accent }}>{email}</strong>.
              </p>
            </div>
          </Reveal>
        ) : (
          <Reveal delay={180}>
            <div style={{
              borderRadius: 16,
              border: `1px solid ${tokens.border}`,
              background: tokens.surfaceCard,
              overflow: 'hidden',
            }}>
              {/* Respondent Details */}
              <div style={{ padding: '28px 32px 0' }}>
                <p style={{
                  fontFamily: `'${tokens.bodyFont}', sans-serif`,
                  fontSize: '0.68rem', fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                  color: tokens.textSubtle,
                  margin: '0 0 20px',
                }}>
                  Respondent Details
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <FieldInput label="Full Name" value={name} onChange={setName} required tokens={tokens} />
                  <FieldInput label="Title / Role" value={role} onChange={setRole} tokens={tokens} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                  <FieldInput label="Company" value={company} onChange={setCompany} tokens={tokens} />
                  <FieldInput label="Your Email" value={email} onChange={setEmail} required type="email" tokens={tokens} />
                </div>
              </div>

              <div style={{ height: 1, background: tokens.border }} />

              {/* Terms & Conditions */}
              <div style={{ padding: '20px 32px' }}>
                <button
                  onClick={() => setTermsOpen(v => !v)}
                  style={{
                    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: 0,
                  }}
                >
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.82rem', fontWeight: 600,
                    color: tokens.text,
                  }}>
                    Terms &amp; Conditions
                  </span>
                  <svg
                    width="16" height="16" viewBox="0 0 16 16" fill="none"
                    style={{ transform: termsOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
                  >
                    <path d="M4 6L8 10L12 6" stroke={tokens.textSubtle} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {termsOpen && (
                  <div style={{
                    marginTop: 12,
                    padding: '16px',
                    background: tokens.surface,
                    borderRadius: 8,
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.82rem', lineHeight: 1.7,
                    color: tokens.textMuted,
                    maxHeight: 160, overflowY: 'auto',
                  }}>
                    {termsText}
                  </div>
                )}

                <label style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  marginTop: 16, cursor: 'pointer',
                }}>
                  <div
                    onClick={() => setTermsAccepted(v => !v)}
                    style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
                      border: `2px solid ${termsAccepted ? tokens.accent : tokens.border}`,
                      background: termsAccepted ? tokens.accent : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {termsAccepted && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.82rem', color: tokens.textMuted, lineHeight: 1.5,
                    userSelect: 'none',
                  }}
                    onClick={() => setTermsAccepted(v => !v)}
                  >
                    I have read and agree to the terms and conditions outlined in this proposal.
                  </span>
                </label>
              </div>

              <div style={{ height: 1, background: tokens.border }} />

              {/* Signature */}
              <div style={{ padding: '20px 32px 28px' }}>
                <SignaturePad tokens={tokens} onSign={setSignature} />
              </div>

              <div style={{ height: 1, background: tokens.border }} />

              {/* Submit */}
              <div style={{ padding: '24px 32px' }}>
                {missing.length > 0 && (
                  <p style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.78rem', color: tokens.textSubtle,
                    marginBottom: 16, textAlign: 'center',
                  }}>
                    Still needed: <span style={{ color: tokens.accent }}>{missing.join(', ')}</span>
                  </p>
                )}

                {submitState === 'error' && (
                  <p style={{
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontSize: '0.82rem', color: '#e05252',
                    marginBottom: 12, textAlign: 'center',
                  }}>
                    {errorMsg}
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={missing.length > 0 || submitState === 'submitting'}
                  style={{
                    width: '100%',
                    padding: '14px 24px',
                    borderRadius: 10,
                    border: 'none',
                    cursor: missing.length > 0 ? 'not-allowed' : 'pointer',
                    background: missing.length > 0
                      ? `${tokens.accent}40`
                      : tokens.accent,
                    color: missing.length > 0 ? `${tokens.accent}80` : '#ffffff',
                    fontFamily: `'${tokens.bodyFont}', sans-serif`,
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase' as const,
                    transition: 'all 0.2s',
                  }}
                >
                  {submitState === 'submitting' ? 'Submitting…' : (content.ctaLabel || 'Approve Proposal')}
                </button>
              </div>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
