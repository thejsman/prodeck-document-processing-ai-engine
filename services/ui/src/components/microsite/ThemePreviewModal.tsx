'use client';

import { useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { createPortal } from 'react-dom';
import type { LayoutAST, BrandConfig, PluginMeta } from '../../types/presentation';
import { Microsite } from './Microsite';
import { EditContextBlocker } from './editor/EditContext';

interface Props {
  plugin: PluginMeta;
  brand: BrandConfig;
  onClose: () => void;
  onApply: () => void;
}

// ── Mock layout AST for preview (no API call) ─────────────────────────────────

function buildMockAst(plugin: PluginMeta, brand: BrandConfig): LayoutAST {
  const now = new Date().toISOString();
  const img = {
    source: 'gradient' as const,
    query: '',
    url: null,
    fallback: 'gradient-mesh' as const,
  };

  return {
    proposalId: `preview-${plugin.id}`,
    generatedAt: now,
    meta: {
      title: `${plugin.name} Preview`,
      client: brand.companyName,
      date: now.slice(0, 10),
      author: '',
    },
    brief: {
      clientName: brand.companyName,
      clientIndustry: 'Technology',
      clientChallenge: 'Scaling operations while maintaining quality',
      proposingCompany: brand.companyName,
      proposingStrength: 'Deep expertise in design and strategy',
      engagementSummary: 'A comprehensive partnership to elevate your brand presence.',
      keyOutcomes: [
        'Accelerate time-to-market by 40%',
        'Reduce operational costs',
        'Increase customer retention',
      ],
      totalValue: '$50,000',
      duration: '12 weeks',
      primaryTone: 'consultative',
      heroNarrative: 'Transform your vision into measurable results',
      industryKeywords: ['strategy', 'design', 'innovation'],
    },
    brand,
    plugin: plugin.id,
    sections: [
      {
        id: 'preview-hero',
        heading: 'Hero',
        sectionType: 'hero',
        content: {
          eyebrow: `Theme Preview · ${plugin.name}`,
          headline: 'Transform your vision into measurable results',
          subheadline: `${plugin.character} — crafted to make your proposal impossible to ignore.`,
          body: 'Every great engagement starts with clarity. We combine sharp strategy with elegant execution to deliver outcomes that speak for themselves.',
          ctaPrimary: 'Explore the Proposal',
          ctaSecondary: 'Learn More',
          imageQuery: 'modern architecture minimal professional',
        },
        image: img,
        editable: false,
        version: 1,
      },
      {
        id: 'preview-approach',
        heading: 'Our Approach',
        sectionType: 'approach',
        content: {
          eyebrow: 'Methodology',
          headline: 'Three pillars that drive every engagement',
          subheadline: 'Our proven framework combines strategic insight, creative excellence, and rigorous execution.',
          pillars: [
            {
              iconHint: 'strategy',
              name: 'Strategic Clarity',
              description: 'We align every decision to your core objectives, ensuring focus and momentum throughout the engagement.',
            },
            {
              iconHint: 'digital',
              name: 'Creative Excellence',
              description: 'Design-thinking meets business acumen. We craft solutions that are as beautiful as they are effective.',
            },
            {
              iconHint: 'launch',
              name: 'Rigorous Execution',
              description: 'Delivery is everything. Structured processes, clear milestones, and transparent communication at every step.',
            },
          ],
          imageQuery: 'strategy consulting professional',
        },
        image: img,
        editable: false,
        version: 1,
      },
      {
        id: 'preview-nextsteps',
        heading: 'Next Steps',
        sectionType: 'nextsteps',
        content: {
          eyebrow: "Ready to begin?",
          headline: "Let's build something exceptional together",
          body: "The window to act is now. Schedule a kickoff call and we'll have your first deliverable in your hands within two weeks.",
          ctaPrimary: 'Schedule a Call',
          ctaSecondary: 'Download Proposal',
          urgencyNote: 'Capacity limited — only 2 engagement slots available this quarter.',
          imageQuery: 'partnership success professional',
        },
        image: img,
        editable: false,
        version: 1,
      },
    ],
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ThemePreviewModal({ plugin, brand, onClose, onApply }: Props) {
  const mockAst = buildMockAst(plugin, brand);

  // Lock body scroll while preview is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (typeof window === 'undefined') return null;

  return (
    <>
      {/* Fullscreen microsite preview — portalled above ThemeModal (zIndex 50001) */}
      {createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 60000, overflowY: 'auto', background: '#000' }}>
          <EditContextBlocker>
            <Microsite ast={mockAst} />
          </EditContextBlocker>
        </div>,
        document.body,
      )}

      {/* Top control bar — portalled above microsite (zIndex 100001) */}
      {createPortal(
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 52,
            zIndex: 100001,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            background: 'rgba(0,0,0,0.88)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Left: theme info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: plugin.tokens.accent,
                boxShadow: `0 0 8px ${plugin.tokens.glowColor}`,
                flexShrink: 0,
              }}
            />
            <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>
              {plugin.name}
            </span>
            <span
              style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: 11,
                fontStyle: 'italic',
                display: 'none',
              }}
              className="theme-preview-character"
            >
              {plugin.character}
            </span>
            {/* Color swatches */}
            <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
              <div
                title="Background"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: plugin.tokens.bg,
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              />
              <div
                title="Accent"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: plugin.tokens.accent,
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              />
              <div
                title="Surface"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: plugin.tokens.surface,
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              />
            </div>
            {/* Typography hint */}
            <span
              style={{
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                marginLeft: 4,
              }}
            >
              <span
                style={{
                  fontFamily: `'${plugin.tokens.heroFont}', Georgia, serif`,
                  fontWeight: plugin.tokens.heroWeight,
                  fontStyle: plugin.tokens.heroStyle as React.CSSProperties['fontStyle'],
                  fontSize: 13,
                  color: plugin.tokens.accent,
                  marginRight: 4,
                }}
              >
                Aa
              </span>
              {plugin.tokens.heroFont}
            </span>
          </div>

          {/* Right: actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginRight: 4 }}>
              Press Esc to close
            </span>
            <button
              onClick={onClose}
              style={{
                padding: '6px 16px',
                borderRadius: 100,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent',
                color: 'rgba(255,255,255,0.7)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                transition: 'border-color 0.15s, color 0.15s',
              }}
            >
              <Icon icon={X} size="sm" /> Close
            </button>
            <button
              onClick={onApply}
              style={{
                padding: '6px 20px',
                borderRadius: 100,
                border: 'none',
                background: plugin.tokens.accent,
                color: plugin.tokens.dark ? plugin.tokens.bg : '#fff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                boxShadow: `0 2px 12px ${plugin.tokens.glowColor}`,
                transition: 'opacity 0.15s',
              }}
            >
              <Icon icon={Check} size="sm" /> Apply Theme
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
