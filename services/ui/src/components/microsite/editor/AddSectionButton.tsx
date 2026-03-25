'use client';

import { useState, useRef, useEffect } from 'react';
import { useEditContext } from './EditContext';
import type { LayoutAST } from '../../../types/presentation';

const ACCENT = '#6366f1';

const SECTION_TYPES = [
  { id: 'benefits',     label: 'Benefits',     icon: '⬡', desc: 'Key features grid' },
  { id: 'challenge',    label: 'Challenge',     icon: '⚡', desc: 'Problem / pain points' },
  { id: 'approach',     label: 'Approach',      icon: '◈', desc: 'Your methodology' },
  { id: 'deliverables', label: 'Deliverables',  icon: '📦', desc: 'What you deliver' },
  { id: 'timeline',     label: 'Timeline',      icon: '📅', desc: 'Project phases' },
  { id: 'pricing',      label: 'Pricing',       icon: '💰', desc: 'Pricing table' },
  { id: 'whyus',        label: 'Why Us',        icon: '⭐', desc: 'Differentiators' },
  { id: 'nextsteps',    label: 'Next Steps',    icon: '→',  desc: 'Call to action' },
  { id: 'testimonials', label: 'Testimonials',  icon: '💬', desc: 'Social proof' },
  { id: 'stats',        label: 'Stats',         icon: '📊', desc: 'Key metrics' },
  { id: 'generic',      label: 'Text Block',    icon: '≡',  desc: 'Custom text section' },
];

function getDefaultContent(sectionType: string): Record<string, unknown> {
  switch (sectionType) {
    case 'benefits':
      return {
        eyebrow: 'BENEFITS',
        headline: 'Why This Works',
        items: [
          { title: 'Benefit One', description: 'Description of this benefit and why it matters.', iconHint: 'strategy' },
          { title: 'Benefit Two', description: 'Description of this benefit and why it matters.', iconHint: 'digital' },
          { title: 'Benefit Three', description: 'Description of this benefit and why it matters.', iconHint: 'launch' },
        ],
      };
    case 'challenge':
      return {
        eyebrow: 'THE CHALLENGE',
        headline: 'The Problem We Solve',
        body: 'Describe the challenge or problem your client is facing here.',
        bullets: ['Key challenge point one', 'Key challenge point two', 'Key challenge point three'],
      };
    case 'approach':
      return {
        eyebrow: 'OUR APPROACH',
        headline: 'How We Work',
        subheadline: 'A proven methodology tailored to your needs.',
        pillars: [
          { name: 'Discovery', description: 'Understanding your needs and goals.', iconHint: 'research' },
          { name: 'Strategy', description: 'Building the right plan of action.', iconHint: 'strategy' },
          { name: 'Execution', description: 'Delivering results with precision.', iconHint: 'launch' },
        ],
      };
    case 'deliverables':
      return {
        eyebrow: 'DELIVERABLES',
        headline: 'What You Get',
        items: [
          { name: 'Deliverable One', detail: 'Description of this deliverable.', iconHint: 'document' },
          { name: 'Deliverable Two', detail: 'Description of this deliverable.', iconHint: 'digital' },
          { name: 'Deliverable Three', detail: 'Description of this deliverable.', iconHint: 'content' },
        ],
      };
    case 'timeline':
      return {
        eyebrow: 'TIMELINE',
        headline: 'Project Phases',
        subheadline: 'A clear path from kickoff to delivery.',
        phases: [
          { label: 'Phase 1', duration: '2 weeks', name: 'Discovery', description: 'Research and planning.' },
          { label: 'Phase 2', duration: '4 weeks', name: 'Development', description: 'Core work and execution.' },
          { label: 'Phase 3', duration: '2 weeks', name: 'Launch', description: 'Delivery and handover.' },
        ],
      };
    case 'pricing':
      return {
        eyebrow: 'INVESTMENT',
        headline: 'Transparent Pricing',
        subheadline: 'Everything included, no surprises.',
        rows: [['Service Item', 'Description', '$0,000']],
        totalLabel: 'Total Investment',
        cta: 'Get Started',
      };
    case 'stats':
      return {
        eyebrow: 'BY THE NUMBERS',
        headline: 'Results That Matter',
        stats: [
          { value: '95%', label: 'Client Satisfaction' },
          { value: '50+', label: 'Projects Delivered' },
          { value: '3×', label: 'Average ROI' },
        ],
      };
    case 'testimonials':
      return {
        eyebrow: 'TESTIMONIALS',
        headline: 'What Our Clients Say',
        items: [
          { quote: 'This exceeded our expectations in every way.', name: 'Jane Smith', title: 'CEO', company: 'Acme Corp' },
        ],
      };
    case 'whyus':
      return {
        eyebrow: 'WHY US',
        headline: 'The Difference',
        body: 'Here is why we are the right partner for you.',
        reasons: [
          { title: 'Experienced Team', body: 'Years of proven expertise in the field.' },
          { title: 'Proven Process', body: 'A methodology that delivers consistent results.' },
          { title: 'Client Focus', body: 'Your success is our success.' },
        ],
      };
    case 'nextsteps':
      return {
        eyebrow: 'NEXT STEPS',
        headline: 'Ready to Get Started?',
        subheadline: "Let's build something great together.",
        ctaLabel: 'Get Started',
        steps: ['Schedule a call', 'Review the proposal', 'Sign the contract'],
      };
    case 'generic':
    default:
      return {
        heading: 'New Section',
        body: 'Add your content here. Click any text to edit it inline.',
        subheading: 'Subheading',
      };
  }
}

interface Props {
  afterIndex: number;
}

export function AddSectionButton({ afterIndex }: Props) {
  const ctx = useEditContext();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!ctx) return null;

  function handleAdd(sectionType: string) {
    if (!ctx) return;
    const id = `section-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newSection: LayoutAST['sections'][number] = {
      id,
      heading: SECTION_TYPES.find(t => t.id === sectionType)?.label ?? 'New Section',
      sectionType: sectionType as LayoutAST['sections'][number]['sectionType'],
      content: getDefaultContent(sectionType) as unknown as LayoutAST['sections'][number]['content'],
      image: { source: 'gradient', query: sectionType, url: null, fallback: 'gradient-mesh' },
      editable: true,
      version: 1,
    };
    ctx.addSection(afterIndex, newSection);
    setOpen(false);
  }

  const visible = hovered || open;

  return (
    <div
      ref={panelRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        height: 20,
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Divider line */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height: 1,
        background: visible ? `${ACCENT}55` : 'transparent',
        transition: 'background 0.2s',
      }} />

      {/* + button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Insert section here"
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: `1.5px solid ${visible ? ACCENT : 'transparent'}`,
          background: visible ? '#fff' : 'transparent',
          color: ACCENT,
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: visible ? '0 2px 10px rgba(99,102,241,0.3)' : 'none',
          transition: 'all 0.2s',
          zIndex: 1,
          lineHeight: 1,
          fontFamily: 'system-ui',
        }}
      >+</button>

      {/* Section type picker panel */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30000,
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          border: '1px solid #e2e8f0',
          padding: '12px',
          width: 380,
        }}>
          <div style={{ marginBottom: 10 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Insert Section</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>Choose a section type</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            {SECTION_TYPES.map(st => (
              <button
                key={st.id}
                onClick={() => handleAdd(st.id)}
                style={{
                  padding: '10px 6px',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = '#eff0ff';
                  (e.currentTarget as HTMLElement).style.borderColor = ACCENT;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = '#f8fafc';
                  (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0';
                }}
              >
                <div style={{ fontSize: 20, marginBottom: 3 }}>{st.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', lineHeight: 1.3 }}>{st.label}</div>
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, lineHeight: 1.2 }}>{st.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
