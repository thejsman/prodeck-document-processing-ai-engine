import { describe, it, expect } from 'vitest';
import { findSectionBounds, extractSectionBlocks, buildReflowPrompt } from './slide-fit.js';

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
});
