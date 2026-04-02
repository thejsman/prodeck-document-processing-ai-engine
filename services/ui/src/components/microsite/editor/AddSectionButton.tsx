'use client';

import { useState, useRef, useEffect } from 'react';
import { useEditContext } from './EditContext';
import type { LayoutAST } from '../../../types/presentation';

const ACCENT = '#6366f1';

// ── All supported section types, grouped by category ─────────────────────────

const SECTION_GROUPS: Array<{
  label: string;
  types: Array<{ id: string; label: string; icon: string; desc: string }>;
}> = [
  {
    label: 'Core',
    types: [
      { id: 'hero',       label: 'Hero',        icon: '🏠', desc: 'Page header / intro' },
      { id: 'nextsteps',  label: 'Next Steps',  icon: '→',  desc: 'Call to action' },
    ],
  },
  {
    label: 'Problem & Solution',
    types: [
      { id: 'problem',    label: 'Problem',     icon: '🔴', desc: 'Pain point statement' },
      { id: 'challenge',  label: 'Challenge',   icon: '⚡', desc: 'Challenge framing' },
      { id: 'approach',   label: 'Approach',    icon: '◈',  desc: 'Your methodology' },
    ],
  },
  {
    label: 'Delivery',
    types: [
      { id: 'deliverables', label: 'Deliverables', icon: '📦', desc: 'What you deliver' },
      { id: 'timeline',     label: 'Timeline',     icon: '📅', desc: 'Project phases' },
      { id: 'showcase',     label: 'Showcase',     icon: '🌟', desc: 'Features / highlights' },
    ],
  },
  {
    label: 'Value',
    types: [
      { id: 'benefits', label: 'Benefits', icon: '⬡',  desc: 'Key value grid' },
      { id: 'stats',    label: 'Stats',    icon: '📊', desc: 'Key metrics' },
      { id: 'metrics',  label: 'Metrics',  icon: '📈', desc: 'KPIs and data' },
      { id: 'pricing',  label: 'Pricing',  icon: '💰', desc: 'Pricing table' },
    ],
  },
  {
    label: 'Proof',
    types: [
      { id: 'testimonials', label: 'Testimonials', icon: '💬', desc: 'Social proof' },
      { id: 'casestudy',    label: 'Case Study',   icon: '📖', desc: 'Client success story' },
      { id: 'comparison',   label: 'Comparison',   icon: '⚖️', desc: 'Us vs them table' },
    ],
  },
  {
    label: 'Technical',
    types: [
      { id: 'techstack', label: 'Tech Stack', icon: '⚙️', desc: 'Tools & technologies' },
      { id: 'security',  label: 'Security',   icon: '🔒', desc: 'Trust & compliance' },
      { id: 'testing',   label: 'Testing',    icon: '✅', desc: 'QA & validation' },
      { id: 'chart',     label: 'Chart',      icon: '📉', desc: 'Data visualisation' },
    ],
  },
  {
    label: 'People',
    types: [
      { id: 'team',  label: 'Team',    icon: '👥', desc: 'Team members' },
      { id: 'whyus', label: 'Why Us',  icon: '⭐', desc: 'Differentiators' },
    ],
  },
  {
    label: 'Content',
    types: [
      { id: 'faq',     label: 'FAQ',        icon: '❓', desc: 'Frequently asked questions' },
      { id: 'generic', label: 'Text Block', icon: '≡',  desc: 'Custom text section' },
    ],
  },
];

// Flat list for search filtering
const ALL_TYPES = SECTION_GROUPS.flatMap(g => g.types);

// ── Default content per section type ─────────────────────────────────────────

function getDefaultContent(sectionType: string): Record<string, unknown> {
  switch (sectionType) {
    case 'hero':
      return {
        eyebrow: 'WELCOME',
        headline: 'Your Compelling Headline Here',
        subheadline: 'A clear, engaging subheadline that supports the main message.',
        ctaPrimary: 'Get Started',
        ctaSecondary: 'Learn More',
      };
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
    case 'problem':
      return {
        eyebrow: 'THE PROBLEM',
        headline: 'What\'s Holding You Back',
        body: 'Describe the core pain point or problem your audience experiences.',
        painPoints: [
          'First pain point your audience faces',
          'Second pain point causing frustration',
          'Third pain point costing time or money',
        ],
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
    case 'showcase':
      return {
        eyebrow: 'HIGHLIGHTS',
        headline: 'What Makes This Special',
        subheadline: 'A closer look at the features that set this apart.',
        body: 'Add more context about what you are showcasing and why it matters to your audience.',
        highlights: ['Feature highlight one', 'Feature highlight two', 'Feature highlight three', 'Feature highlight four'],
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
    case 'metrics':
      return {
        eyebrow: 'KEY METRICS',
        headline: 'The Numbers Behind the Results',
        stats: [
          { number: '98%', label: 'Uptime SLA', context: 'Guaranteed service availability.' },
          { number: '2×', label: 'Faster Delivery', context: 'Compared to industry average.' },
          { number: '$2M+', label: 'Cost Savings', context: 'Realised by clients in year one.' },
        ],
        strategies: ['Real-time monitoring', 'Automated alerts', 'Performance benchmarking'],
      };
    case 'testimonials':
      return {
        eyebrow: 'TESTIMONIALS',
        headline: 'What Our Clients Say',
        items: [
          { quote: 'This exceeded our expectations in every way.', name: 'Jane Smith', title: 'CEO', company: 'Acme Corp' },
        ],
      };
    case 'casestudy':
      return {
        eyebrow: 'CASE STUDY',
        headline: 'How We Delivered Results',
        challenge: 'The client was struggling with slow delivery cycles and high operational costs.',
        solution: 'We implemented a streamlined process using our proven methodology and tooling.',
        outcome: 'Delivery time was cut by 40% and costs reduced by $200k in the first year.',
        metrics: [
          { value: '40%', label: 'Faster Delivery' },
          { value: '$200k', label: 'Cost Reduction' },
          { value: '98%', label: 'Client Satisfaction' },
        ],
      };
    case 'comparison':
      return {
        eyebrow: 'WHY CHOOSE US',
        headline: 'How We Compare',
        subheadline: 'A side-by-side look at what makes us different.',
        usLabel: 'Us',
        themLabel: 'Others',
        rows: [
          { feature: 'Delivery Speed', us: '2 weeks', them: '6–8 weeks' },
          { feature: 'Dedicated Support', us: '24/7', them: 'Business hours only' },
          { feature: 'Custom Solutions', us: 'Always', them: 'Off-the-shelf only' },
          { feature: 'Transparent Pricing', us: 'Fixed fee', them: 'Hidden costs' },
        ],
      };
    case 'techstack':
      return {
        eyebrow: 'TECH STACK',
        headline: 'Built With the Right Tools',
        categories: [
          {
            iconHint: 'digital',
            name: 'Frontend',
            items: ['React', 'TypeScript', 'Tailwind CSS'],
          },
          {
            iconHint: 'tool',
            name: 'Backend',
            items: ['Node.js', 'PostgreSQL', 'Redis'],
          },
        ],
      };
    case 'security':
      return {
        eyebrow: 'SECURITY & COMPLIANCE',
        headline: 'Built with Trust at the Core',
        items: [
          { name: 'Data Encryption', description: 'All data encrypted at rest and in transit using AES-256.', iconHint: 'lock' },
          { name: 'Access Controls', description: 'Role-based access with MFA enforced across all accounts.', iconHint: 'shield' },
          { name: 'Compliance', description: 'SOC 2 Type II certified and GDPR compliant.', iconHint: 'document' },
          { name: 'Monitoring', description: '24/7 threat detection and incident response.', iconHint: 'target' },
        ],
      };
    case 'testing':
      return {
        eyebrow: 'QUALITY ASSURANCE',
        headline: 'Tested at Every Level',
        layers: [
          { level: 'Unit', name: 'Unit Testing', coverage: '95%', description: 'Every function tested in isolation.' },
          { level: 'Integration', name: 'Integration Testing', coverage: '88%', description: 'Services tested together end-to-end.' },
          { level: 'E2E', name: 'End-to-End Testing', coverage: '80%', description: 'Full user journey coverage.' },
        ],
        additionalInfo: [
          { heading: 'Automated CI/CD', body: 'All tests run automatically on every pull request.' },
          { heading: 'Performance Testing', body: 'Load tested to 10× expected peak traffic.' },
        ],
      };
    case 'faq':
      return {
        eyebrow: 'FAQ',
        headline: 'Frequently Asked Questions',
        subheadline: 'Everything you need to know before getting started.',
        items: [
          { question: 'How long does the process take?', answer: 'Most projects are completed within 4–6 weeks depending on scope and complexity.' },
          { question: 'What is included in the price?', answer: 'Everything is included — design, development, testing, and launch support.' },
          { question: 'Do you offer ongoing support?', answer: 'Yes, we offer flexible retainer and support packages post-launch.' },
          { question: 'How do we get started?', answer: 'Simply reach out via the contact form and we will schedule an intro call within 24 hours.' },
        ],
      };
    case 'team':
      return {
        eyebrow: 'THE TEAM',
        headline: 'The People Behind the Work',
        subheadline: 'Experienced professionals committed to your success.',
        members: [
          { iconHint: 'identity', name: 'Alex Johnson', role: 'Project Lead', bio: 'Experienced leader with 10+ years delivering complex projects.' },
          { iconHint: 'identity', name: 'Sam Rivera', role: 'Lead Designer', bio: 'Award-winning designer focused on user-centred experiences.' },
          { iconHint: 'identity', name: 'Jordan Lee', role: 'Technical Lead', bio: 'Full-stack engineer specialising in scalable architectures.' },
        ],
      };
    case 'chart':
      return {
        eyebrow: 'DATA & INSIGHTS',
        headline: 'The Numbers Tell the Story',
        body: 'Visual representation of key performance data.',
        chartType: 'bar',
        unit: '',
        data: [
          { label: 'Q1', value: 42 },
          { label: 'Q2', value: 67 },
          { label: 'Q3', value: 85 },
          { label: 'Q4', value: 93 },
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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  afterIndex: number;
}

export function AddSectionButton({ afterIndex }: Props) {
  const ctx = useEditContext();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    // Auto-focus search when panel opens
    setTimeout(() => searchRef.current?.focus(), 50);
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
    const meta = ALL_TYPES.find(t => t.id === sectionType);
    const newSection: LayoutAST['sections'][number] = {
      id,
      heading: meta?.label ?? 'New Section',
      sectionType: sectionType as LayoutAST['sections'][number]['sectionType'],
      content: getDefaultContent(sectionType) as unknown as LayoutAST['sections'][number]['content'],
      image: { source: 'gradient', query: sectionType, url: null, fallback: 'gradient-mesh' },
      editable: true,
      version: 1,
    };
    ctx.addSection(afterIndex, newSection);
    setOpen(false);
  }

  const lq = query.toLowerCase();
  const filteredGroups = query
    ? [{ label: 'Results', types: ALL_TYPES.filter(t => t.label.toLowerCase().includes(lq) || t.desc.toLowerCase().includes(lq)) }]
    : SECTION_GROUPS;

  const visible = hovered || open;

  return (
    <div
      ref={panelRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', height: 20, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {/* Divider line */}
      <div style={{
        position: 'absolute', left: 0, right: 0, height: 1,
        background: visible ? `${ACCENT}55` : 'transparent',
        transition: 'background 0.2s',
      }} />

      {/* + button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Insert section here"
        style={{
          width: 22, height: 22, borderRadius: '50%',
          border: `1.5px solid ${visible ? ACCENT : 'transparent'}`,
          background: visible ? '#fff' : 'transparent',
          color: ACCENT, fontSize: 14, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: visible ? '0 2px 10px rgba(99,102,241,0.3)' : 'none',
          transition: 'all 0.2s', zIndex: 1, lineHeight: 1, fontFamily: 'system-ui',
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
          width: 480,
          maxHeight: '70vh',
          overflowY: 'auto',
        }}>
          {/* Header + search */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#1e293b' }}>Insert Section</p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>{ALL_TYPES.length} section types available</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ width: 22, height: 22, borderRadius: 6, border: 'none', background: '#f1f5f9', color: '#64748b', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}
              >×</button>
            </div>
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search section types…"
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '7px 10px', borderRadius: 7,
                border: '1px solid #e2e8f0', background: '#f8fafc',
                fontSize: 12, color: '#1e293b', outline: 'none',
                fontFamily: 'system-ui',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = ACCENT)}
              onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
            />
          </div>

          {/* Grouped section grid */}
          {filteredGroups.map(group => (
            group.types.length === 0 ? null : (
              <div key={group.label} style={{ marginBottom: 14 }}>
                <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'system-ui' }}>
                  {group.label}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {group.types.map(st => (
                    <button
                      key={st.id}
                      onClick={() => handleAdd(st.id)}
                      style={{ padding: '10px 6px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', textAlign: 'center', transition: 'all 0.12s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#eff0ff'; (e.currentTarget as HTMLElement).style.borderColor = ACCENT; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; (e.currentTarget as HTMLElement).style.borderColor = '#e2e8f0'; }}
                    >
                      <div style={{ fontSize: 20, marginBottom: 3 }}>{st.icon}</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#334155', lineHeight: 1.3, fontFamily: 'system-ui' }}>{st.label}</div>
                      <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, lineHeight: 1.2, fontFamily: 'system-ui' }}>{st.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            )
          ))}

          {query && filteredGroups[0]?.types.length === 0 && (
            <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: '16px 0', fontFamily: 'system-ui' }}>
              No sections match "{query}"
            </p>
          )}
        </div>
      )}
    </div>
  );
}
