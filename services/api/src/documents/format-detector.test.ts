import { describe, it, expect } from 'vitest';
import {
  parseRequestedFormat,
  detectPresentationIntent,
  detectSlideOrientation,
} from './format-detector.js';

// ---------------------------------------------------------------------------
// detectPresentationIntent — the routing decision for PRESENTATION MODE.
// Regression: "create three page slides" must be recognized as a slide request
// (it previously fell through the keyword list and produced a markdown document).
// ---------------------------------------------------------------------------

describe('detectPresentationIntent', () => {
  const presentationMessages = [
    'create three page slides',
    '3 page slides',
    'make a 5 slide deck',
    'build a pitch deck',
    'create a presentation',
    'turn this into slides',
    'write me a slideshow',
    'export this as a powerpoint',
    'export as pptx',
    'present this to the board using keynote',
  ];

  for (const msg of presentationMessages) {
    it(`treats "${msg}" as a presentation request`, () => {
      expect(detectPresentationIntent(msg)).toBe(true);
    });
  }

  const nonPresentationMessages = [
    'write a blog post',
    'create a strategy document',
    'draft a proposal',
    'write a report as pdf',
    'save as a word doc',
    'summarize the last meeting',
  ];

  for (const msg of nonPresentationMessages) {
    it(`does not treat "${msg}" as a presentation request`, () => {
      expect(detectPresentationIntent(msg)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// parseRequestedFormat — slide phrasings must still resolve to pptx, since
// detectPresentationIntent derives from this.
// ---------------------------------------------------------------------------

describe('parseRequestedFormat', () => {
  it('maps bare slide/deck phrasings to pptx', () => {
    expect(parseRequestedFormat('create three page slides')).toBe('pptx');
    expect(parseRequestedFormat('build a pitch deck')).toBe('pptx');
    expect(parseRequestedFormat('export as pptx')).toBe('pptx');
  });

  it('keeps document formats distinct from pptx', () => {
    expect(parseRequestedFormat('write a report as pdf')).toBe('pdf');
    expect(parseRequestedFormat('save as a word doc')).toBe('docx');
    expect(parseRequestedFormat('write a blog post')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Aspect-ratio requests: an explicit "16:9"/"9:16" mention is a slide request
// regardless of the noun, and 9:16 selects portrait orientation.
// ---------------------------------------------------------------------------

describe('aspect-ratio slide requests', () => {
  const aspectMessages = [
    'create a 16:9 catalog',
    'make a 9:16 deck',
    'build a 9:16 document',
    'create a 16 by 9 catalog',
    'design a 9 by 16 story',
    'give me a 9x16 layout',
  ];

  for (const msg of aspectMessages) {
    it(`treats "${msg}" as a presentation request`, () => {
      expect(detectPresentationIntent(msg)).toBe(true);
    });
  }

  it('selects portrait only for 9:16 mentions', () => {
    expect(detectSlideOrientation('make a 9:16 deck')).toBe('portrait');
    expect(detectSlideOrientation('build a 9x16 document')).toBe('portrait');
    expect(detectSlideOrientation('design a 9 by 16 story')).toBe('portrait');
  });

  it('defaults to landscape for 16:9 and for no ratio', () => {
    expect(detectSlideOrientation('create a 16:9 catalog')).toBe('landscape');
    expect(detectSlideOrientation('create a 16 by 9 catalog')).toBe('landscape');
    expect(detectSlideOrientation('create three page slides')).toBe('landscape');
    expect(detectSlideOrientation('write a blog post')).toBe('landscape');
  });
});
