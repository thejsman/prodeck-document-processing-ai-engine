import { describe, it, expect } from 'vitest';
import { extractContactFromHrefs, extractContactInfo, resolveLinks } from './dom-extraction.js';

describe('extractContactInfo', () => {
  it('extracts emails and normalizes case', () => {
    const info = extractContactInfo('Contact us at Sales@Example.com or support@example.com for help.');
    expect(info.emails).toEqual(['sales@example.com', 'support@example.com']);
  });

  it('extracts phone numbers with at least 7 digits', () => {
    const info = extractContactInfo('Call us at (415) 555-0132 today.');
    expect(info.phones.length).toBeGreaterThan(0);
  });

  it('ignores short numeric noise as phone numbers', () => {
    const info = extractContactInfo('We have 24 offices in 12 countries.');
    expect(info.phones).toEqual([]);
  });

  it('extracts street addresses via keyword match', () => {
    const info = extractContactInfo('Visit us at 123 Main Street, Suite 400.');
    expect(info.addresses.length).toBeGreaterThan(0);
  });
});

describe('extractContactFromHrefs', () => {
  it('pulls emails and phones from mailto/tel hrefs', () => {
    const result = extractContactFromHrefs([
      { href: 'mailto:hello@example.com?subject=hi' },
      { href: 'tel:+14155550132' },
      { href: 'https://example.com/about' },
    ]);
    expect(result.emails).toEqual(['hello@example.com']);
    expect(result.phones).toEqual(['+14155550132']);
  });
});

describe('resolveLinks', () => {
  const pageUrl = 'https://example.com/about';

  it('resolves relative hrefs to absolute URLs', () => {
    const links = resolveLinks(pageUrl, [{ href: '/pricing', text: 'Pricing' }]);
    expect(links).toEqual([{ href: 'https://example.com/pricing', text: 'Pricing', internal: true }]);
  });

  it('classifies external links', () => {
    const links = resolveLinks(pageUrl, [{ href: 'https://other.com/', text: 'Other' }]);
    expect(links[0].internal).toBe(false);
  });

  it('skips mailto, tel, javascript, and fragment-only hrefs', () => {
    const links = resolveLinks(pageUrl, [
      { href: 'mailto:x@example.com', text: '' },
      { href: 'tel:12345', text: '' },
      { href: 'javascript:void(0)', text: '' },
      { href: '#section', text: '' },
    ]);
    expect(links).toEqual([]);
  });
});
