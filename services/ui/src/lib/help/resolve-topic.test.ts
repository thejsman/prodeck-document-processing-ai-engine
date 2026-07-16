import { describe, test, expect } from 'vitest';
import { matchScore, normalizePath, resolveTopicForPath } from './resolve-topic';
import { searchTopics, searchFaqs } from './search';
import type { HelpTopic } from './help-types';

function topic(id: string, routePatterns: string[], extra: Partial<HelpTopic> = {}): HelpTopic {
  return {
    id,
    title: extra.title ?? id,
    category: 'getting-started',
    routePatterns,
    summary: extra.summary ?? '',
    sections: extra.sections ?? [],
    faqs: extra.faqs ?? [],
    related: extra.related ?? [],
    keywords: extra.keywords ?? [],
  };
}

const TOPICS: HelpTopic[] = [
  topic('getting-started', ['/']),
  topic('super-client-workspace', ['/super-client/:name', '/super-client']),
  topic('proposals', ['/proposal', '/proposals', '/proposals/:id']),
  topic('proposal-templates', ['/proposal/templates']),
  topic('microsites', ['/microsite', '/presentation']),
  topic('microsite-editor', ['/microsite-editor/:namespace/:proposalId', '/microsite-editor']),
  topic('admin', ['/admin']),
  topic('admin-memory', ['/admin/memory']),
  topic('executions', ['/executions/:id', '/executions']),
  topic('deck-orientation', [], { title: 'Slide orientation', keywords: ['16:9', '9:16', 'vertical', 'portrait'] }),
];

describe('normalizePath', () => {
  test('strips query, hash and trailing slash', () => {
    expect(normalizePath('/proposal/?x=1')).toBe('/proposal');
    expect(normalizePath('/help#topic')).toBe('/help');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});

describe('matchScore', () => {
  test('exact static match beats prefix match', () => {
    const exact = matchScore('/proposal', '/proposal')!;
    const prefix = matchScore('/proposal', '/proposal/anything')!;
    expect(exact).toBeGreaterThan(prefix);
  });

  test('dynamic segment matches any single segment', () => {
    expect(matchScore('/super-client/:name', '/super-client/acme')).not.toBeNull();
    expect(matchScore('/super-client/:name', '/super-client')).toBeNull(); // too short
  });

  test('non-matching static segment returns null', () => {
    expect(matchScore('/microsite', '/microsite-editor')).toBeNull();
  });
});

describe('resolveTopicForPath', () => {
  const r = (p: string) => resolveTopicForPath(p, TOPICS).id;

  test('dynamic client route', () => {
    expect(r('/super-client/acme')).toBe('super-client-workspace');
  });

  test('more specific route wins (templates over proposal)', () => {
    expect(r('/proposal/templates')).toBe('proposal-templates');
    expect(r('/proposal')).toBe('proposals');
  });

  test('nested admin route beats /admin', () => {
    expect(r('/admin/memory')).toBe('admin-memory');
    expect(r('/admin')).toBe('admin');
  });

  test('editor with two dynamic segments', () => {
    expect(r('/microsite-editor/ns1/p1')).toBe('microsite-editor');
  });

  test('executions dynamic id', () => {
    expect(r('/executions/abc123')).toBe('executions');
  });

  test('root and unknown routes fall back to getting-started', () => {
    expect(r('/')).toBe('getting-started');
    expect(r('/totally-unknown-route')).toBe('getting-started');
  });

  test('microsite prefix does not swallow microsite-editor', () => {
    expect(r('/microsite')).toBe('microsites');
    expect(r('/microsite-editor')).toBe('microsite-editor');
  });
});

describe('search', () => {
  test('searchTopics matches title and keywords', () => {
    expect(searchTopics('proposal', TOPICS).map((t) => t.id)).toContain('proposals');
    // concept topic found via keyword only
    expect(searchTopics('9:16', TOPICS).map((t) => t.id)).toContain('deck-orientation');
  });

  test('empty query yields no results', () => {
    expect(searchTopics('', TOPICS)).toEqual([]);
  });

  test('searchFaqs finds a matching question', () => {
    const withFaq = [
      topic('x', [], { faqs: [{ q: 'How do I publish a microsite?', a: 'Use publish.' }] }),
    ];
    const hits = searchFaqs('publish', withFaq);
    expect(hits.length).toBe(1);
    expect(hits[0].topic.id).toBe('x');
  });
});
