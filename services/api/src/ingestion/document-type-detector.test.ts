import { describe, it, expect } from 'vitest';
import { detectDocumentType } from './document-type-detector.js';

// Helper: generate content where >4% of words are filler
function makeFillerContent(): string {
  const filler = 'um like yeah so basically you know I mean uh okay ';
  const padding = 'the project is going well we delivered all milestones on time ';
  // ~50% filler words by repeating both equally — well above the 4% threshold
  return (filler + padding).repeat(20);
}

describe('detectDocumentType', () => {
  // --- Filename rule tests ---

  it('meeting filename → meeting_transcript', () => {
    const result = detectDocumentType('LC_Grounds_meeting.txt', 'Some meeting notes here.');
    expect(result.type).toBe('meeting_transcript');
    expect(result.confidence).toBe(0.90);
    expect(result.signals.some(s => s.includes('filename'))).toBe(true);
  });

  it('transcript filename → meeting_transcript', () => {
    const result = detectDocumentType('Q1-transcript.md', 'content');
    expect(result.type).toBe('meeting_transcript');
    expect(result.confidence).toBe(0.90);
  });

  it('standup filename → meeting_transcript', () => {
    const result = detectDocumentType('daily-standup-2024.md', 'content');
    expect(result.type).toBe('meeting_transcript');
  });

  it('rfp filename → rfp', () => {
    const result = detectDocumentType('acme-rfp.md', 'Some vendor content with scope of work.');
    expect(result.type).toBe('rfp');
    expect(result.confidence).toBe(0.95);
  });

  it('solicitation filename → rfp', () => {
    const result = detectDocumentType('city-solicitation-2024.pdf', 'content');
    expect(result.type).toBe('rfp');
    expect(result.confidence).toBe(0.95);
  });

  it('technical filename → technical_spec', () => {
    const result = detectDocumentType('system-technical-design.md', 'some content');
    expect(result.type).toBe('technical_spec');
    expect(result.confidence).toBe(0.90);
  });

  it('spec filename → technical_spec', () => {
    const result = detectDocumentType('auth-spec.md', 'content');
    expect(result.type).toBe('technical_spec');
    expect(result.confidence).toBe(0.90);
  });

  it('proposal filename → proposal_draft', () => {
    const result = detectDocumentType('acme-proposal.docx', 'content');
    expect(result.type).toBe('proposal_draft');
    expect(result.confidence).toBe(0.85);
  });

  it('draft filename → proposal_draft', () => {
    const result = detectDocumentType('Q2-draft.md', 'content');
    expect(result.type).toBe('proposal_draft');
    expect(result.confidence).toBe(0.85);
  });

  // --- Content rule tests ---

  it('otter.ai footer → meeting_transcript (filename has no hint)', () => {
    const content = 'We discussed the roadmap.\n\nTranscribed by Otter.ai';
    const result = detectDocumentType('LC_Grounds_meeting.txt', content);
    // Filename rule fires first for "meeting" — still meeting_transcript with ≥0.90
    expect(result.type).toBe('meeting_transcript');
    expect(result.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('otter.ai footer in neutral filename → meeting_transcript via content rule', () => {
    const content = 'We discussed the roadmap.\n\nTranscribed by Otter.ai';
    const result = detectDocumentType('notes.txt', content);
    expect(result.type).toBe('meeting_transcript');
    expect(result.confidence).toBe(0.95);
    expect(result.signals).toContain('content: otter.ai transcript marker');
  });

  it('"transcribed by" phrase → meeting_transcript', () => {
    const content = 'This session was transcribed by our team.';
    const result = detectDocumentType('notes.txt', content);
    expect(result.type).toBe('meeting_transcript');
    expect(result.confidence).toBe(0.95);
  });

  it('high filler ratio (>4%) without filename hint → meeting_transcript', () => {
    const result = detectDocumentType('notes.txt', makeFillerContent());
    expect(result.type).toBe('meeting_transcript');
    expect(result.confidence).toBe(0.85);
    expect(result.signals.some(s => s.includes('filler ratio'))).toBe(true);
  });

  it('email headers in first 500 chars → email', () => {
    const content = 'From: john@example.com\nTo: jane@example.com\nSubject: Q1 Update\n\nHi Jane,';
    const result = detectDocumentType('email.txt', content);
    expect(result.type).toBe('email');
    expect(result.confidence).toBe(0.90);
    expect(result.signals).toContain('content: email header pattern');
  });

  it('email headers beyond 500 chars are ignored (not classified as email)', () => {
    const padding = 'x'.repeat(510);
    const content = padding + '\nFrom: john@example.com\nTo: jane@example.com\nSubject: Q1\n\nBody';
    const result = detectDocumentType('document.txt', content);
    expect(result.type).not.toBe('email');
  });

  it('RFP terminology in content → rfp', () => {
    const content = 'Please review the scope of work attached and respond by the submission deadline.';
    const result = detectDocumentType('acme-rfp.md', content);
    // filename rule fires first
    expect(result.type).toBe('rfp');
  });

  it('RFP terminology in neutral filename → rfp via content rule', () => {
    const content = 'Vendors must comply with evaluation criteria and meet the submission deadline.';
    const result = detectDocumentType('document.txt', content);
    expect(result.type).toBe('rfp');
    expect(result.confidence).toBe(0.80);
    expect(result.signals).toContain('content: RFP terminology');
  });

  it('more than 5 technical terms → technical_spec', () => {
    const content = 'The api uses an endpoint that queries a database with a schema. '
      + 'Deployment is handled via infrastructure automation with docker and kubernetes.';
    const result = detectDocumentType('document.txt', content);
    expect(result.type).toBe('technical_spec');
    expect(result.confidence).toBe(0.75);
    expect(result.signals.some(s => s.includes('technical terms'))).toBe(true);
  });

  it('exactly 5 technical terms (≤5) → NOT technical_spec', () => {
    // api, endpoint, database, schema, deployment = 5 (not > 5)
    const content = 'The api uses an endpoint that queries a database with a schema for deployment.';
    const result = detectDocumentType('document.txt', content);
    expect(result.type).not.toBe('technical_spec');
  });

  it('random business doc with no strong signals → generic', () => {
    const content = 'Our company had a productive quarter. Sales were up. Team morale is high.';
    const result = detectDocumentType('business-update.txt', content);
    expect(result.type).toBe('generic');
    expect(result.confidence).toBe(0.50);
    expect(result.signals).toContain('no strong signal — falling back to generic');
  });

  // --- Signals array population ---

  it('signals array is populated with the matched rule description', () => {
    const result = detectDocumentType('project-rfp.pdf', 'content');
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.signals[0]).toMatch(/filename match/);
  });
});
