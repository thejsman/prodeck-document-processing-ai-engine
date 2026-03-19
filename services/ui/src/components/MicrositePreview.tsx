'use client';

import type { PresentationSection, PresentationConfig } from '@/lib/api';

interface Props {
  sections: PresentationSection[];
  config: PresentationConfig;
}

function isPricingSection(id: string): boolean {
  return id.includes('pricing') || id.includes('investment') || id.includes('cost');
}

/**
 * Minimal markdown-to-HTML converter — no external library.
 * Handles: code fences, bold, italic, inline code, and paragraphs.
 */
function renderMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        const escaped = codeLines.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        out.push(`<pre${codeLang ? ` data-lang="${codeLang}"` : ''}><code>${escaped}</code></pre>`);
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    // Inline formatting
    let html = line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

    if (line.startsWith('### ')) {
      out.push(`<h4>${html.replace(/^###\s+/, '')}</h4>`);
    } else if (line.startsWith('## ')) {
      out.push(`<h3>${html.replace(/^##\s+/, '')}</h3>`);
    } else if (line.startsWith('# ')) {
      out.push(`<h3>${html.replace(/^#\s+/, '')}</h3>`);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      out.push(`<li>${html.replace(/^[-*]\s+/, '')}</li>`);
    } else {
      out.push(`<p>${html}</p>`);
    }
  }

  // Wrap consecutive <li> in <ul>
  const joined = out.join('\n');
  return joined.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
}

export function MicrositePreview({ sections, config }: Props) {
  const visibleSections = sections.filter((s) => {
    if (config.hiddenSections.includes(s.id)) return false;
    if (!config.showPricing && isPricingSection(s.id)) return false;
    return true;
  });

  if (visibleSections.length === 0) {
    return (
      <div className="microsite-preview" data-theme={config.theme} style={{ ['--ms-accent' as string]: config.accentColor }}>
        <div className="microsite-section">
          <p className="muted">All sections are hidden.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="microsite-preview" data-theme={config.theme} style={{ ['--ms-accent' as string]: config.accentColor }}>
      {visibleSections.map((section) => (
        <div key={section.id} className="microsite-section">
          <h2 className="microsite-section-title">{section.title}</h2>
          <div
            className="microsite-section-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
          />
        </div>
      ))}
    </div>
  );
}
