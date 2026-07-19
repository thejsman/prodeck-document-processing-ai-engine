import { describe, it, expect } from 'vitest';
import { planScreenshots } from './screenshot.service.js';
import type { SelectedPage } from './types.js';

describe('planScreenshots', () => {
  it('plans full pages plus crops for a full role set', () => {
    const pages: SelectedPage[] = [
      { url: 'https://example.com/', role: 'homepage' },
      { url: 'https://example.com/blog', role: 'listing' },
      { url: 'https://example.com/blog/a', role: 'detail' },
      { url: 'https://example.com/contact', role: 'form' },
    ];
    const specs = planScreenshots(pages);
    const ids = specs.map((s) => s.id);
    expect(ids).toContain('homepage-desktop');
    expect(ids).toContain('homepage-mobile');
    expect(ids).toContain('detail-desktop');
    expect(ids).toContain('crop-header');
    expect(ids).toContain('crop-form');
    // cards crop prefers the listing page when present
    expect(specs.find((s) => s.id === 'crop-cards')?.pageRole).toBe('listing');
  });

  it('degrades for a homepage-only manifest', () => {
    const specs = planScreenshots([{ url: 'https://example.com/', role: 'homepage' }]);
    const ids = specs.map((s) => s.id);
    expect(ids).not.toContain('detail-desktop');
    expect(ids).not.toContain('listing-desktop');
    expect(ids).not.toContain('crop-form');
    expect(specs.find((s) => s.id === 'crop-cards')?.pageRole).toBe('homepage');
  });

  it('uses listing full page when detail is absent', () => {
    const specs = planScreenshots([
      { url: 'https://example.com/', role: 'homepage' },
      { url: 'https://example.com/blog', role: 'listing' },
    ]);
    expect(specs.map((s) => s.id)).toContain('listing-desktop');
  });
});
