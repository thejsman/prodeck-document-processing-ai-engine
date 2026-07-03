import { describe, it, expect } from 'vitest';
import {
  MICROSITE_ARTIFACT,
  PROPOSAL_ARTIFACT,
  isBareArtifactRequest,
  isMicrositeRequest,
  strippedRemainder,
} from './vocabulary.js';

// ---------------------------------------------------------------------------
// Microsite vocabulary — flexible, not rigid
// ---------------------------------------------------------------------------

describe('isMicrositeRequest', () => {
  const YES = [
    'generate a microsite from the proposal',
    'make a micro-site',
    'build a mini site',
    'create a landing page',
    'I want a landing site',
    'splash page please',
    'one pager site',
    'one-pager website',
    'one page site',
    'single page site',
    'single-page website',
    'presentation site',
    'create a presentation for the client', // pre-existing behaviour
    'convert to presentation slides', // pre-existing behaviour
    'convert this to a presentation',
  ];

  for (const msg of YES) {
    it(`recognises "${msg}"`, () => {
      expect(isMicrositeRequest(msg)).toBe(true);
    });
  }

  const NO = [
    'create a proposal for Acme',
    'write a one pager', // a one-page *document*, not a site
    'draft a one-pager brief',
    'what are the requirements',
    'the budget is $50,000',
    'upload the RFP',
  ];

  for (const msg of NO) {
    it(`does not match "${msg}"`, () => {
      expect(isMicrositeRequest(msg)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Bare-request detection
// ---------------------------------------------------------------------------

describe('isBareArtifactRequest — microsite', () => {
  const BARE = [
    'microsite',
    'a microsite',
    'make a microsite',
    'create microsite',
    'i want a microsite',
    'landing page',
    'a landing page',
    'one pager site',
    'presentation',
  ];
  for (const msg of BARE) {
    it(`"${msg}" is bare`, () => {
      expect(isBareArtifactRequest(msg, MICROSITE_ARTIFACT)).toBe(true);
    });
  }

  const NOT_BARE = [
    'generate a microsite from the acme proposal',
    'microsite with a dark theme',
    'landing page for the investor pitch',
    'create a presentation about our Q3 numbers',
  ];
  for (const msg of NOT_BARE) {
    it(`"${msg}" is not bare`, () => {
      expect(isBareArtifactRequest(msg, MICROSITE_ARTIFACT)).toBe(false);
    });
  }
});

describe('isBareArtifactRequest — proposal', () => {
  it('bare "proposal" is bare', () => {
    expect(isBareArtifactRequest('proposal', PROPOSAL_ARTIFACT)).toBe(true);
  });
  it('"the proposal" is bare', () => {
    expect(isBareArtifactRequest('the proposal', PROPOSAL_ARTIFACT)).toBe(true);
  });
  it('"create a proposal for Acme" is not bare', () => {
    expect(isBareArtifactRequest('create a proposal for Acme', PROPOSAL_ARTIFACT)).toBe(false);
  });
  it('plural "list proposals" is not matched by the singular artifact', () => {
    // The bare rule intentionally targets singular "proposal" only.
    expect(PROPOSAL_ARTIFACT.test('list proposals')).toBe(false);
    expect(isBareArtifactRequest('list proposals', PROPOSAL_ARTIFACT)).toBe(false);
  });
});

describe('strippedRemainder', () => {
  it('drops fillers and the artifact, leaving real context', () => {
    expect(strippedRemainder('make a microsite for acme', MICROSITE_ARTIFACT)).toBe('acme');
  });
  it('returns empty for a bare request', () => {
    expect(strippedRemainder('make a microsite', MICROSITE_ARTIFACT)).toBe('');
  });
});
