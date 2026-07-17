import { describe, it, expect } from 'vitest';
import {
  findSectionBounds,
  extractSectionBlocks,
  buildReflowPrompt,
  closeDanglingTag,
  buildIssueFixPrompt,
  type SlideIssue,
} from './slide-fit.js';

const deck = [
  '<!DOCTYPE html><html><head><title>t</title></head><body>',
  '<section data-section-id="slide-1" id="slide-1"><h1>One</h1></section>',
  '<section data-section-id="slide-2" id="slide-2"><div><section data-section-id="inner"><p>nested</p></section></div></section>',
  '<section data-section-id="slide-3" id="slide-3"><p>Three</p></section>',
  '</body></html>',
].join('\n');

describe('findSectionBounds', () => {
  it('returns the exact bounds of a simple section', () => {
    const b = findSectionBounds(deck, 'slide-1');
    expect(b).not.toBeNull();
    expect(deck.slice(b!.start, b!.end)).toBe(
      '<section data-section-id="slide-1" id="slide-1"><h1>One</h1></section>',
    );
  });

  it('handles nested <section> elements without truncating the outer block', () => {
    const b = findSectionBounds(deck, 'slide-2');
    expect(b).not.toBeNull();
    const slice = deck.slice(b!.start, b!.end);
    expect(slice.startsWith('<section data-section-id="slide-2"')).toBe(true);
    expect(slice.endsWith('</section>')).toBe(true);
    expect(slice).toContain('nested');
    // Must include BOTH closing tags (inner + outer)
    expect(slice.match(/<\/section>/g)).toHaveLength(2);
  });

  it('returns null for an unknown id', () => {
    expect(findSectionBounds(deck, 'slide-99')).toBeNull();
  });

  it('returns null for an unterminated section', () => {
    expect(findSectionBounds('<section data-section-id="x"><p>no close', 'x')).toBeNull();
  });

  it('escapes regex metacharacters in ids', () => {
    const html = '<section data-section-id="slide-1.2"><p>a</p></section>';
    const b = findSectionBounds(html, 'slide-1.2');
    expect(b).not.toBeNull();
    // "." must not match "slide-1x2" style ids
    expect(findSectionBounds('<section data-section-id="slide-1x2"><p>a</p></section>', 'slide-1.2')).toBeNull();
  });
});

describe('extractSectionBlocks', () => {
  it('extracts sections and strips markdown fences and prose', () => {
    const reply = [
      'Here is the reflowed page:',
      '```html',
      '<section data-section-id="slide-2" id="slide-2"><p>a</p></section>',
      '<section data-section-id="slide-2-2" id="slide-2-2"><p>b</p></section>',
      '```',
      'The content now fits.',
    ].join('\n');
    const out = extractSectionBlocks(reply);
    expect(out).not.toBeNull();
    expect(out!.startsWith('<section')).toBe(true);
    expect(out!.endsWith('</section>')).toBe(true);
    expect(out).toContain('slide-2-2');
    expect(out).not.toContain('```');
    expect(out).not.toContain('Here is');
  });

  it('rejects replies without sections or without data-section-id', () => {
    expect(extractSectionBlocks('sorry, cannot do that')).toBeNull();
    expect(extractSectionBlocks('<section id="x"><p>a</p></section>')).toBeNull();
  });

  it('rejects replies smuggling document-level tags', () => {
    expect(
      extractSectionBlocks('<section data-section-id="s"><body><p>a</p></body></section>'),
    ).toBeNull();
  });
});

describe('buildReflowPrompt', () => {
  it('names the section id, overflow amount, and derived page ids', () => {
    const p = buildReflowPrompt('slide-4', 230, '<section data-section-id="slide-4">x</section>');
    expect(p).toContain('~230px');
    expect(p).toContain('"slide-4"');
    expect(p).toContain('"slide-4-2"');
    expect(p).toContain('540×960');
    expect(p).toContain('<section data-section-id="slide-4">x</section>');
  });

  it('defaults to the portrait canvas and template', () => {
    const p = buildReflowPrompt('slide-1', 50, '<section data-section-id="slide-1">x</section>');
    expect(p).toContain('9:16');
    expect(p).toContain('540×960 CSS px (9:16 portrait)');
    expect(p).toContain('aspect-ratio:9/16');
    expect(p).toContain('max-width:540px');
    expect(p).toContain('margin:0 auto 12px');
  });

  it('describes the landscape canvas and template for landscape decks', () => {
    const p = buildReflowPrompt('slide-1', 50, '<section data-section-id="slide-1">x</section>', 'landscape');
    expect(p).toContain('16:9');
    expect(p).toContain('1280×720 CSS px (16:9 landscape)');
    expect(p).toContain('aspect-ratio:16/9');
    expect(p).toContain('margin:0 0 12px');
    expect(p).not.toContain('max-width:540px');
    expect(p).not.toContain('9:16');
  });
});

describe('closeDanglingTag', () => {
  it('strips a dangling unterminated open tag at the end', () => {
    const truncated = '<div>hello</div><div style="color:#b8956a;">3</div';
    expect(closeDanglingTag(truncated)).toBe('<div>hello</div><div style="color:#b8956a;">3');
  });

  it('strips a dangling unterminated closing tag at the end', () => {
    expect(closeDanglingTag('<p>text</p></div')).toBe('<p>text</p>');
  });

  it('leaves well-formed HTML unchanged', () => {
    const html = '<!DOCTYPE html><html><body><p>hi</p></body></html>';
    expect(closeDanglingTag(html)).toBe(html);
  });

  it('leaves plain text with no trailing tag unchanged', () => {
    expect(closeDanglingTag('<p>done</p>\n')).toBe('<p>done</p>\n');
  });

  it('handles an empty string', () => {
    expect(closeDanglingTag('')).toBe('');
  });
});

describe('buildIssueFixPrompt', () => {
  const sectionHtml = '<section data-section-id="slide-3" id="slide-3"><p>x</p></section>';

  it('defers to buildReflowPrompt verbatim for kind "overflow"', () => {
    const issue: SlideIssue = { id: 'slide-3', kind: 'overflow', detail: 'unused', overflowPx: 42 };
    expect(buildIssueFixPrompt(issue, sectionHtml, 'landscape')).toBe(
      buildReflowPrompt('slide-3', 42, sectionHtml, 'landscape'),
    );
  });

  it('describes an overlap defect and includes the detail text', () => {
    const issue: SlideIssue = {
      id: 'slide-3',
      kind: 'overlap',
      detail: 'two text blocks overlap ("Heading" and "Subheading")',
    };
    const p = buildIssueFixPrompt(issue, sectionHtml, 'landscape');
    expect(p).toContain('visually overlap');
    expect(p).toContain('two text blocks overlap ("Heading" and "Subheading")');
    expect(p).toContain('No two elements holding readable text may overlap');
    expect(p).toContain('"slide-3"');
    expect(p).toContain(sectionHtml);
  });

  it('describes a legibility defect', () => {
    const issue: SlideIssue = { id: 'slide-3', kind: 'legibility', detail: 'text "Foo" renders at 9px, below the 11px minimum' };
    const p = buildIssueFixPrompt(issue, sectionHtml, 'portrait');
    expect(p).toContain('below the legibility floor');
    expect(p).toContain('9px, below the 11px minimum');
    expect(p).toContain('540×960 CSS px (9:16 portrait)');
  });

  it('describes a contrast defect and asks for explicit scoped colors', () => {
    const issue: SlideIssue = {
      id: 'slide-3',
      kind: 'contrast',
      detail: 'text "AV Program Report" (color rgb(255, 255, 255)) is nearly invisible against its background (rgb(255, 255, 255)) — contrast ratio 1.00:1',
    };
    const p = buildIssueFixPrompt(issue, sectionHtml, 'landscape');
    expect(p).toContain('nearly invisible against its own background');
    expect(p).toContain('contrast ratio 1.00:1');
    expect(p).toContain('reusing a CSS class name');
    expect(p).toContain('do not rely on any shared/global rule for either property');
  });

  it('describes an under-fill defect and asks to fill the full canvas', () => {
    const issue: SlideIssue = {
      id: 'slide-8',
      kind: 'underfill',
      detail: 'content fills only the top 67% of the page, leaving the bottom 33% blank',
    };
    const p = buildIssueFixPrompt(issue, sectionHtml, 'landscape');
    expect(p).toContain('under-filled');
    expect(p).toContain('leaving the bottom 33% blank');
    expect(p).toContain('height:100%');
    expect(p).toContain('90–98%'); // range target to damp oscillation
    expect(p).toContain('never padded');
  });

  it('describes a broken-markup defect and asks for a clean rewrite', () => {
    const issue: SlideIssue = { id: 'slide-3', kind: 'brokenMarkup', detail: 'visible text reads like raw code: "html{overflow-x:hidden!important;}"' };
    const p = buildIssueFixPrompt(issue, sectionHtml, 'landscape');
    expect(p).toContain('markup is corrupted');
    expect(p).toContain('rewrite it from scratch as clean, well-formed HTML');
    expect(p).toContain('html{overflow-x:hidden!important;}');
  });

  it('always asks to HTML-escape literal angle brackets/ampersands', () => {
    const issue: SlideIssue = { id: 'slide-3', kind: 'overlap', detail: 'x' };
    expect(buildIssueFixPrompt(issue, sectionHtml, 'landscape')).toContain('&lt;, &gt;, &amp;');
  });
});
