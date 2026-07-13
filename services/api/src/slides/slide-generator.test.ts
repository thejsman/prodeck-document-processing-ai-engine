import { describe, it, expect } from 'vitest';
import { validateSlideHtml, resolveSlideOrientation } from './slide-generator.js';

// A minimal but valid standalone deck. The LLM controls all visuals; validateSlideHtml
// injects the technical-frame enforcer (scroll/aspect/gap/no-word-break), nothing more.
const DECK = `<!DOCTYPE html><html><head><title>Test</title></head>
<body><div class="deck"><div class="slide">One</div><div class="slide">Two</div></div></body></html>`;

describe('validateSlideHtml — injected enforcer (technical frame only)', () => {
  it('throws on non-HTML output', () => {
    expect(() => validateSlideHtml('just some text', 'landscape')).toThrow(/valid HTML/i);
  });

  it('throws on truncated HTML (missing closing tags)', () => {
    expect(() => validateSlideHtml('<!DOCTYPE html><html><body><div class="slide">x', 'landscape')).toThrow(/truncated/i);
  });

  it('enforces an 8px inter-slide gap (not the old 12px)', () => {
    const out = validateSlideHtml(DECK, 'landscape');
    expect(out).toContain('gap:8px!important');
    expect(out).not.toContain('gap:12px');
  });

  it('locks the per-slide aspect ratio to 16/9 for landscape', () => {
    const out = validateSlideHtml(DECK, 'landscape');
    expect(out).toContain('aspect-ratio:16/9!important');
  });

  it('locks the per-slide aspect ratio to 9/16 for portrait', () => {
    const out = validateSlideHtml(DECK, 'portrait');
    expect(out).toContain('aspect-ratio:9/16!important');
  });

  it('hands the background to the LLM — no forced html/body background or theme script', () => {
    const out = validateSlideHtml(DECK, 'landscape');
    expect(out).not.toMatch(/html\{background/i);
    expect(out).not.toContain('--prodeck-bg');
    expect(out).not.toContain('prodeck-theme-apply');
  });

  it('hands slide shadows to the LLM — no forced .slide box-shadow', () => {
    const out = validateSlideHtml(DECK, 'landscape');
    expect(out).not.toMatch(/box-shadow/i);
  });

  it('keeps the functional guardrails: slide overflow:hidden, position:relative, and no word-breaking', () => {
    const out = validateSlideHtml(DECK, 'landscape');
    expect(out).toContain('overflow:hidden!important');   // contains absolute children within a slide
    expect(out).toContain('position:relative!important'); // makes in-slide absolute positioning safe
    expect(out).toContain('word-break:normal!important');
  });
});

describe('resolveSlideOrientation — trusts the actual HTML', () => {
  it('reports portrait when the HTML applies 9/16', () => {
    expect(resolveSlideOrientation('.slide{aspect-ratio:9/16}', 'landscape')).toBe('portrait');
  });
  it('reports landscape when the HTML applies 16/9', () => {
    expect(resolveSlideOrientation('.slide{aspect-ratio:16/9}', 'portrait')).toBe('landscape');
  });
  it('falls back to the requested orientation when the HTML gives no signal', () => {
    expect(resolveSlideOrientation('<div class="slide">x</div>', 'portrait')).toBe('portrait');
  });
});
