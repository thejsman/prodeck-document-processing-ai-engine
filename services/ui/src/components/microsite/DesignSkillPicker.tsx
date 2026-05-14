'use client';

import { useEffect, useState } from 'react';
import { listDesignSkillsApi, type DesignSkillSummaryApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const TONE_EMOJI: Record<string, string> = {
  'brutally minimal': '◻',
  'maximalist chaos': '🌀',
  'retro-futuristic': '⚡',
  'organic/natural': '🌿',
  'luxury/refined': '✦',
  'playful/toy-like': '🎨',
  'editorial/magazine': '📰',
  'brutalist/raw': '🧱',
  'art deco/geometric': '◆',
  'soft/pastel': '🌸',
  'industrial/utilitarian': '🔩',
};

interface Props {
  onSelect: (designSkillSlug: string | null) => void;
  onCancel: () => void;
}

export function DesignSkillPicker({ onSelect, onCancel }: Props) {
  const { apiKey } = useAuth();
  const [skills, setSkills] = useState<DesignSkillSummaryApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    listDesignSkillsApi(apiKey)
      .then(setSkills)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiKey]);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999,
    }}>
      <div style={{
        background: 'var(--panel, #1a1a1a)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 28,
        width: 560,
        maxWidth: '90vw',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Choose a Design Skill</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text2)' }}>
            Design Skills override the auto-selected aesthetic tone for this microsite generation.
          </p>
        </div>

        {loading ? (
          <p style={{ fontSize: 13, color: 'var(--text2)', textAlign: 'center', padding: '24px 0' }}>Loading…</p>
        ) : (
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Default option */}
            <button
              onClick={() => setSelected(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                border: '2px solid',
                borderColor: selected === null ? 'var(--primary)' : 'var(--border)',
                borderRadius: 10,
                background: selected === null ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.12s',
              }}
            >
              <span style={{ fontSize: 22 }}>🤖</span>
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Default (auto)</p>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text2)' }}>Let the system pick the best tone based on industry</p>
              </div>
            </button>

            {skills.length === 0 ? (
              <div style={{ padding: '16px 0', textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 10px' }}>No design skills yet.</p>
                <a href="/skills" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>
                  Create one in Skills → Design Skills →
                </a>
              </div>
            ) : skills.map((ds) => (
              <button
                key={ds.slug}
                onClick={() => setSelected(ds.slug)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px',
                  border: '2px solid',
                  borderColor: selected === ds.slug ? 'var(--primary)' : 'var(--border)',
                  borderRadius: 10,
                  background: selected === ds.slug ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.12s',
                }}
              >
                {/* Color swatch */}
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: ds.colorPalette.background
                    ? `linear-gradient(135deg, ${ds.colorPalette.background} 0%, ${ds.colorPalette.primary} 100%)`
                    : ds.colorPalette.primary,
                  border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                }}>
                  {TONE_EMOJI[ds.aestheticTone] ?? '✦'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ds.displayName}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
                    {ds.aestheticTone} · {ds.themeClass}
                  </p>
                  {ds.description && (
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ds.description}
                    </p>
                  )}
                </div>
                {/* Color dot */}
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: ds.colorPalette.primary, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button
            onClick={onCancel}
            style={{ padding: '8px 18px', border: '1px solid var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(selected)}
            style={{ padding: '8px 20px', border: 'none', borderRadius: 8, background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {selected ? 'Use Design Skill' : 'Generate with Default'}
          </button>
        </div>
      </div>
    </div>
  );
}
