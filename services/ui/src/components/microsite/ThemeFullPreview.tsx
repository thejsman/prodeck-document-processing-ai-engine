'use client';

import { useEffect, useCallback, useState } from 'react';
import type { ThemeDefinition } from '../../lib/presentation/pluginRegistry';

// ── Standardized live preview — same layout for every theme ──────────────────

function ThemeLivePreview({ theme }: { theme: ThemeDefinition }) {
  const c = theme.previewColors;
  const hf = `'${theme.fontPairing.heading}', Georgia, serif`;
  const bf = `'${theme.fontPairing.body}', system-ui, sans-serif`;

  return (
    <div style={{ fontFamily: bf, background: c.background, minHeight: '100%' }}>

      {/* 1 — HERO */}
      <div style={{
        padding: '48px 40px 40px',
        background: `radial-gradient(ellipse 90% 70% at 40% 50%, ${c.surface} 0%, ${c.background} 100%)`,
        borderBottom: `1px solid ${c.border}`,
        display: 'flex', gap: 32, alignItems: 'center',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: c.accent, marginBottom: 14,
            padding: '3px 10px', border: `1px solid ${c.accent}44`, borderRadius: 100,
          }}>
            Strategic Proposal · 2026
          </div>
          <h1 style={{ fontFamily: hf, fontSize: 30, fontWeight: 700, color: c.text, margin: '0 0 14px', lineHeight: 1.2 }}>
            Transforming Compliance with Modern Architecture
          </h1>
          <p style={{ fontSize: 15, color: c.text, opacity: 0.65, margin: '0 0 24px', lineHeight: 1.65, maxWidth: 420 }}>
            A cloud-native platform for real-time regulatory monitoring across distributed enterprise environments.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button style={{
              padding: '10px 22px', background: c.accent, color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}>View Proposal</button>
            <button style={{
              padding: '10px 22px', background: 'transparent', color: c.text,
              border: `1px solid ${c.border}`, borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}>Learn More</button>
          </div>
        </div>
        {/* Abstract accent shape */}
        <div style={{
          width: 200, height: 120, flexShrink: 0, borderRadius: 12,
          background: `linear-gradient(135deg, ${c.accent}44 0%, ${c.accent}22 60%, ${c.surface} 100%)`,
          border: `1px solid ${c.accent}33`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: `${c.accent}55`, border: `3px solid ${c.accent}88` }} />
        </div>
      </div>

      {/* 2 — STATS ROW */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${c.border}` }}>
        {[['100%', 'Compliance'], ['95%', 'Deployment Speed'], ['99%', 'Accuracy']].map(([num, label], i) => (
          <div key={i} style={{
            flex: 1, padding: '22px 20px', textAlign: 'center',
            background: c.surface,
            borderRight: i < 2 ? `1px solid ${c.border}` : 'none',
          }}>
            <div style={{ fontFamily: hf, fontSize: 28, fontWeight: 700, color: c.accent, marginBottom: 6, lineHeight: 1 }}>{num}</div>
            <div style={{ fontSize: 12, color: c.text, opacity: 0.55, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 3 — CARDS ROW */}
      <div style={{ padding: '32px 40px', background: c.background, borderBottom: `1px solid ${c.border}` }}>
        <div style={{ height: 3, width: 36, background: c.accent, borderRadius: 3, marginBottom: 10, opacity: 0.8 }} />
        <h2 style={{ fontFamily: hf, fontSize: 20, fontWeight: 700, color: c.text, margin: '0 0 20px' }}>
          Technology Foundation
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {[
            ['Microservices', 'Independent services deployed at scale with isolated failure domains and autonomous release cycles.'],
            ['API Gateway', 'Unified entry point for all client interactions with rate limiting, auth, and observability built in.'],
            ['Event Streaming', 'Real-time data pipelines using Kafka for guaranteed delivery across distributed system boundaries.'],
          ].map(([title, body], i) => (
            <div key={i} style={{
              padding: '20px 18px', background: c.surface,
              border: `1px solid ${c.border}`, borderRadius: 8,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6, background: `${c.accent}28`,
                marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: 12, height: 12, borderRadius: 3, background: c.accent }} />
              </div>
              <div style={{ fontFamily: hf, fontSize: 14, fontWeight: 700, color: c.text, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 12, color: c.text, opacity: 0.55, lineHeight: 1.6 }}>{body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 4 — TIMELINE */}
      <div style={{ padding: '32px 40px', background: c.surface, borderBottom: `1px solid ${c.border}` }}>
        <h2 style={{ fontFamily: hf, fontSize: 20, fontWeight: 700, color: c.text, margin: '0 0 24px' }}>
          Delivery Timeline
        </h2>
        <div style={{ display: 'flex', gap: 0, position: 'relative' }}>
          {/* connector line */}
          <div style={{ position: 'absolute', top: 14, left: 14, right: 14, height: 2, background: c.border, zIndex: 0 }} />
          {[['01', 'Discovery', 'Weeks 1–3 · Audit, stakeholder interviews, architecture review'], ['02', 'Development', 'Weeks 4–10 · Sprint delivery, integration, security hardening'], ['03', 'Launch', 'Weeks 11–12 · Staging validation, go-live, hypercare']].map(([num, name, desc], i) => (
            <div key={i} style={{ flex: 1, position: 'relative', zIndex: 1, paddingTop: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: i === 0 ? c.accent : c.surface,
                border: `2px solid ${i === 0 ? c.accent : c.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: i === 0 ? '#fff' : c.text,
                marginBottom: 10,
              }}>{num}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: c.text, marginBottom: 4 }}>{name}</div>
              <div style={{ fontSize: 11, color: c.text, opacity: 0.5, lineHeight: 1.5, paddingRight: 16 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 5 — CTA BLOCK */}
      <div style={{
        padding: '40px 40px', background: c.accent, textAlign: 'center',
      }}>
        <h2 style={{
          fontFamily: hf, fontSize: 24, fontWeight: 700,
          color: '#fff', margin: '0 0 12px', lineHeight: 1.2,
        }}>
          Ready to Eliminate the Compliance Gap?
        </h2>
        <p style={{ color: '#ffffff99', margin: '0 0 24px', fontSize: 14 }}>
          Let&apos;s build the architecture your compliance team can trust.
        </p>
        <button style={{
          padding: '12px 28px', background: '#fff', color: c.accent,
          border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>
          Schedule a Review
        </button>
      </div>
    </div>
  );
}

// ── ThemeFullPreview — standalone fullscreen overlay ─────────────────────────

interface Props {
  theme: ThemeDefinition;
  allThemes: ThemeDefinition[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ThemeFullPreview({ theme, allThemes, onSelect, onClose }: Props) {
  const [currentId, setCurrentId] = useState(theme.id);
  const current = allThemes.find(t => t.id === currentId) ?? theme;

  // Sync when parent passes a new theme
  useEffect(() => { setCurrentId(theme.id); }, [theme.id]);

  const cycle = useCallback((dir: 1 | -1) => {
    const idx = allThemes.findIndex(t => t.id === currentId);
    const next = (idx + dir + allThemes.length) % allThemes.length;
    setCurrentId(allThemes[next].id);
  }, [currentId, allThemes]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') cycle(1);
      if (e.key === 'ArrowLeft') cycle(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, cycle]);

  const c = current.previewColors;
  const idx = allThemes.findIndex(t => t.id === currentId);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar */}
      <div style={{
        height: 52, flexShrink: 0,
        background: '#18181b', borderBottom: '1px solid #2a2a2e',
        display: 'flex', alignItems: 'center', gap: 10, padding: '0 20px',
      }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, flex: 1 }}>
          {current.label}
        </span>
        <button
          onClick={() => { onSelect(current.id); onClose(); }}
          style={{
            padding: '6px 16px', background: 'var(--color-primary)',
            color: '#fff', border: 'none', borderRadius: 6,
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Select this theme
        </button>
        <button onClick={() => cycle(-1)} title="Previous (←)" style={navBtn}>←</button>
        <button onClick={() => cycle(1)} title="Next (→)" style={navBtn}>→</button>
        <button onClick={onClose} title="Close (Esc)" style={{ ...navBtn, fontWeight: 700 }}>✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left metadata panel (30%) */}
        <div style={{
          width: '30%', flexShrink: 0,
          background: '#111113', color: '#e8e8e8',
          overflowY: 'auto', padding: '28px 24px',
          borderRight: '1px solid #222',
        }}>
          {/* Category badge */}
          <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: 100,
            background: '#ffffff14', color: '#aaa',
            fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 14,
          }}>
            {current.category}
          </span>

          <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: c.accent, lineHeight: 1.2 }}>
            {current.label}
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: '#aaa', lineHeight: 1.5 }}>
            {current.description}
          </p>

          {/* Character voice */}
          <div style={{ marginBottom: 24, padding: '12px 14px', background: '#ffffff08', borderRadius: 8, borderLeft: '3px solid #ffffff25' }}>
            <p style={{ margin: '0 0 5px', fontSize: 10, fontWeight: 600, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Voice &amp; Character</p>
            <p style={{ margin: 0, fontSize: 12, color: '#bbb', lineHeight: 1.65, fontStyle: 'italic' }}>
              &ldquo;{current.character}&rdquo;
            </p>
          </div>

          {/* Color swatches */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Color Palette</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { label: 'BG',       color: c.background },
                { label: 'Surface',  color: c.surface },
                { label: 'Text',     color: c.text },
                { label: 'Accent',   color: c.accent },
                { label: 'Accent 2', color: c.accent2 },
              ].map(({ label, color }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div
                    title={color}
                    style={{
                      width: 34, height: 34, borderRadius: '50%', background: color,
                      border: '2px solid rgba(255,255,255,0.12)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                      cursor: 'default',
                    }}
                  />
                  <span style={{ fontSize: 9, color: '#666', textAlign: 'center' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Font pairing */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, color: '#666', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Font Pairing</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { role: 'Heading', family: current.fontPairing.heading, fallback: 'Georgia, serif', weight: 700 },
                { role: 'Body',    family: current.fontPairing.body,    fallback: 'system-ui, sans-serif', weight: 400 },
              ].map(({ role, family, fallback, weight }) => (
                <div key={role} style={{ padding: '8px 12px', background: '#ffffff08', borderRadius: 6 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 10, color: '#555' }}>{role}</p>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: weight, color: '#ddd', fontFamily: `'${family}', ${fallback}` }}>
                    {family}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Select button (secondary) */}
          <button
            onClick={() => { onSelect(current.id); onClose(); }}
            style={{
              width: '100%', padding: '10px 0',
              background: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              marginBottom: 16,
            }}
          >
            Select this theme
          </button>

          <p style={{ margin: 0, fontSize: 11, color: '#444', textAlign: 'center' }}>
            {idx + 1} / {allThemes.length} · ← → to cycle · Esc to close
          </p>
        </div>

        {/* Right: live preview (70%) */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ThemeLivePreview theme={current} />
        </div>
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  background: 'none', border: '1px solid #333', color: '#aaa',
  borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: 14,
};
