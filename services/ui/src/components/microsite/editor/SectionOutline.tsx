'use client';

import { useEditContext } from './EditContext';

const SECTION_ICONS: Record<string, string> = {
  hero: '🏠', challenge: '⚡', approach: '🧩', deliverables: '📦',
  timeline: '📅', pricing: '💰', whyus: '⭐', nextsteps: '🚀',
  testimonials: '💬', showcase: '🖼', benefits: '✅', problem: '🔴',
  stats: '📊', metrics: '📈', security: '🔒', techstack: '🛠',
  testing: '🧪', faq: '❓', team: '👥', comparison: '⚖',
  casestudy: '📖', chart: '📉', generic: '📄',
};

export function SectionOutline({ onClose }: { onClose: () => void }) {
  const ctxRaw = useEditContext();
  if (!ctxRaw) return null;
  const ctx = ctxRaw;
  const { ast, activeSectionId, lockedSections, hiddenSections } = ctx;

  function scrollToSection(id: string) {
    ctx.selectSection(id);
    const el = document.querySelector(`[data-section-id="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        background: '#fff',
        borderRight: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 12px',
          borderBottom: '1px solid #e2e8f0',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Sections ({ast.sections.length})
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 14, padding: 2, lineHeight: 1 }}
          title="Close outline"
        >✕</button>
      </div>

      {/* Section list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {ast.sections.map((section, idx) => {
          const isActive = activeSectionId === section.id;
          const isLocked = lockedSections.has(section.id);
          const isHidden = hiddenSections.has(section.id);
          const icon = SECTION_ICONS[section.sectionType] ?? '📄';

          return (
            <div
              key={section.id}
              onClick={() => scrollToSection(section.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                cursor: 'pointer',
                background: isActive ? '#f5f3ff' : 'transparent',
                borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
                opacity: isHidden ? 0.4 : 1,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
              onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {/* Move up/down */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                <button
                  onClick={e => { e.stopPropagation(); if (idx > 0) ctx.moveArrayItem('__sections__', '__sections__', idx, idx - 1); }}
                  disabled={idx === 0}
                  style={{
                    background: 'none', border: 'none', cursor: idx === 0 ? 'not-allowed' : 'pointer',
                    color: idx === 0 ? '#e2e8f0' : '#94a3b8', fontSize: 9, padding: '1px 2px', lineHeight: 1,
                  }}
                  title="Move up"
                >▲</button>
                <button
                  onClick={e => { e.stopPropagation(); if (idx < ast.sections.length - 1) ctx.moveArrayItem('__sections__', '__sections__', idx, idx + 1); }}
                  disabled={idx === ast.sections.length - 1}
                  style={{
                    background: 'none', border: 'none', cursor: idx === ast.sections.length - 1 ? 'not-allowed' : 'pointer',
                    color: idx === ast.sections.length - 1 ? '#e2e8f0' : '#94a3b8', fontSize: 9, padding: '1px 2px', lineHeight: 1,
                  }}
                  title="Move down"
                >▼</button>
              </div>

              {/* Icon + label */}
              <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#6366f1' : '#1e293b',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {section.heading || section.sectionType}
                </div>
                <div style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {section.sectionType}
                </div>
              </div>

              {/* Action icons */}
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                {/* Lock toggle */}
                <button
                  onClick={() => isLocked ? ctx.unlockSection(section.id) : ctx.lockSection(section.id)}
                  title={isLocked ? 'Unlock section' : 'Lock section'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: isLocked ? '#6366f1' : '#cbd5e1', fontSize: 11, padding: 2,
                  }}
                >{isLocked ? '🔒' : '🔓'}</button>

                {/* Visibility toggle */}
                <button
                  onClick={() => ctx.toggleSectionVisibility(section.id)}
                  title={isHidden ? 'Show section' : 'Hide section'}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: isHidden ? '#94a3b8' : '#cbd5e1', fontSize: 11, padding: 2,
                  }}
                >{isHidden ? '👁' : '👁'}</button>

                {/* Duplicate */}
                <button
                  onClick={() => ctx.duplicateSection(section.id)}
                  title="Duplicate section"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 11, padding: 2 }}
                >⊕</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '8px 12px', borderTop: '1px solid #e2e8f0',
        fontSize: 10, color: '#94a3b8', flexShrink: 0,
      }}>
        Click to jump · ▲▼ to reorder
      </div>
    </div>
  );
}
