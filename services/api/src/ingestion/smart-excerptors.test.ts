import { describe, it, expect } from 'vitest';
import { extractSmartExcerpt, splitBySections } from './smart-excerptors.js';

// ---------------------------------------------------------------------------
// splitBySections
// ---------------------------------------------------------------------------

describe('splitBySections', () => {
  it('splits on markdown headings', () => {
    const content = `## Introduction\nHello world.\n\n## Requirements\nMust do this.`;
    const sections = splitBySections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('Introduction');
    expect(sections[0].content).toContain('Hello world');
    expect(sections[1].heading).toBe('Requirements');
    expect(sections[1].content).toContain('Must do this');
  });

  it('splits on ALL-CAPS headings', () => {
    const content = `SCOPE OF WORK\nBuild a platform.\n\nTIMELINE\nQ3 delivery.`;
    const sections = splitBySections(content);
    expect(sections.length).toBeGreaterThanOrEqual(2);
    const headings = sections.map((s) => s.heading);
    expect(headings).toContain('SCOPE OF WORK');
    expect(headings).toContain('TIMELINE');
  });

  it('strips leading # from heading text', () => {
    const content = `# Project Overview\nSome intro.\n## Details\nMore details.`;
    const sections = splitBySections(content);
    expect(sections[0].heading).toBe('Project Overview');
    expect(sections[1].heading).toBe('Details');
  });

  it('filters out sections with empty content', () => {
    const content = `## Empty Section\n\n## Real Section\nActual content here.`;
    const sections = splitBySections(content);
    // Empty section is dropped
    expect(sections.every((s) => s.content.trim().length > 0)).toBe(true);
    expect(sections.some((s) => s.heading === 'Real Section')).toBe(true);
  });

  it('returns content before the first heading as (intro)', () => {
    const content = `Some preamble text.\n## Section One\nContent here.`;
    const sections = splitBySections(content);
    const intro = sections.find((s) => s.heading === '(intro)');
    expect(intro).toBeDefined();
    expect(intro?.content).toContain('Some preamble text');
  });

  it('returns empty array for blank input', () => {
    expect(splitBySections('')).toEqual([]);
    expect(splitBySections('   \n\n   ')).toEqual([]);
  });

  it('returns single section when no headings present', () => {
    const content = `This document has no headings at all. Just plain text.`;
    const sections = splitBySections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].content).toContain('Just plain text');
  });
});

// ---------------------------------------------------------------------------
// extractSmartExcerpt — routing
// ---------------------------------------------------------------------------

describe('extractSmartExcerpt — routing', () => {
  it('rfp type → rfp extractor (includes intro)', () => {
    const intro = 'Client: Acme Corp. Project overview follows.';
    const content = `${intro}\n\n## Scope of Work\nBuild the system.\n## Irrelevant\nDo not include.`;
    const excerpt = extractSmartExcerpt(content, 'rfp');
    expect(excerpt).toContain(intro.slice(0, 20));
    expect(excerpt).toContain('Scope of Work');
  });

  it('meeting_transcript type → transcript extractor (strips speaker lines)', () => {
    const content = `John Smith  0:00\nWe need to discuss the roadmap.\nJane Doe  0:10\nAgreed, let's plan Q3.`;
    const excerpt = extractSmartExcerpt(content, 'meeting_transcript');
    // Speaker names + timestamps stripped from excerpt content
    expect(excerpt).toContain('roadmap');
    expect(excerpt).toContain("let's plan Q3");
    expect(excerpt).not.toMatch(/John Smith\s+0:00/);
  });

  it('technical_spec type → spec extractor', () => {
    const content = `## Architecture\nMicroservices.\n## Requirements\nMust scale.\n## Fluff\nIrrelevant.`;
    const excerpt = extractSmartExcerpt(content, 'technical_spec');
    expect(excerpt).toContain('Architecture');
    expect(excerpt).toContain('Requirements');
  });

  it('email type → passes content through (truncated)', () => {
    const email = 'From: alice@example.com\nTo: bob@example.com\nHello Bob, please review.';
    const excerpt = extractSmartExcerpt(email, 'email');
    expect(excerpt).toContain('Hello Bob');
  });

  it('generic type → passes content through', () => {
    const content = 'Just some generic text with no special structure.';
    const excerpt = extractSmartExcerpt(content, 'generic');
    expect(excerpt).toBe(content);
  });

  it('proposal_draft type → passes content through', () => {
    const content = 'Our proposal for Acme Corp. Executive summary follows.';
    const excerpt = extractSmartExcerpt(content, 'proposal_draft');
    expect(excerpt).toContain('Executive summary');
  });
});

// ---------------------------------------------------------------------------
// RFP extractor — targeted section selection
// ---------------------------------------------------------------------------

describe('extractSmartExcerpt — rfp targeted sections', () => {
  it('includes "requirements" section', () => {
    const content = [
      '## Background\nSome intro.',
      '## Requirements\nVendors must support SSO.',
      '## Legal Boilerplate\nThis is noise.',
    ].join('\n\n');
    const excerpt = extractSmartExcerpt(content, 'rfp');
    expect(excerpt).toContain('Requirements');
    expect(excerpt).toContain('Vendors must support SSO');
  });

  it('includes "budget" section', () => {
    const content = [
      '## Introduction\nSome intro.',
      '## Budget\nNot to exceed $500,000.',
      '## Appendix\nForms to fill out.',
    ].join('\n\n');
    const excerpt = extractSmartExcerpt(content, 'rfp');
    expect(excerpt).toContain('Not to exceed $500,000');
  });

  it('includes "timeline" section', () => {
    const content = [
      '## Overview\nShort overview.',
      '## Timeline\nDelivery by Q4 2025.',
      '## Random\nUnrelated text.',
    ].join('\n\n');
    const excerpt = extractSmartExcerpt(content, 'rfp');
    expect(excerpt).toContain('Delivery by Q4 2025');
  });

  it('always includes the first 2500 chars of content', () => {
    // Pad intro to be long enough to verify
    const intro = 'Client intro: '.repeat(100); // ~1400 chars
    const content = intro + '\n\n## Requirements\nSpec here.\n\n## Fluff\nNoise.';
    const excerpt = extractSmartExcerpt(content, 'rfp');
    expect(excerpt.startsWith(intro.slice(0, 50))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transcript extractor — speaker turn stripping
// ---------------------------------------------------------------------------

describe('extractSmartExcerpt — transcript speaker stripping', () => {
  it('filters out very short turns (≤20 chars)', () => {
    const content = `John Smith  0:00\nOk.\nJane Doe  0:05\nThis is a longer and meaningful turn.`;
    const excerpt = extractSmartExcerpt(content, 'meeting_transcript');
    expect(excerpt).not.toContain('Ok.');
    expect(excerpt).toContain('longer and meaningful');
  });

  it('preserves meaningful turn content', () => {
    const content = `Alice Brown  1:30\nThe main deliverable is the analytics dashboard due by end of Q3.`;
    const excerpt = extractSmartExcerpt(content, 'meeting_transcript');
    expect(excerpt).toContain('analytics dashboard');
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

describe('extractSmartExcerpt — truncation', () => {
  it('truncates content exceeding MAX_EXCERPT_CHARS (32000)', () => {
    const longContent = 'x'.repeat(40000);
    const excerpt = extractSmartExcerpt(longContent, 'generic');
    expect(excerpt.length).toBeLessThanOrEqual(32000);
  });

  it('does not truncate content within limit', () => {
    const shortContent = 'Short content that fits easily.';
    const excerpt = extractSmartExcerpt(shortContent, 'generic');
    expect(excerpt).toBe(shortContent);
  });
});
