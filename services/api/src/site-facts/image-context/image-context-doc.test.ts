import { describe, it, expect } from 'vitest';
import { buildImageContextDoc } from './image-context-doc.service.js';
import type { ImageAsset } from './types.js';

function asset(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    url: 'https://example.com/logo.png',
    alt: 'Example Co logo',
    width: 200,
    height: 80,
    role: 'logo',
    description: 'Company wordmark logo in dark green.',
    ...overrides,
  };
}

describe('buildImageContextDoc', () => {
  it('reports no images found when the list is empty', () => {
    const doc = buildImageContextDoc('https://example.com/', []);
    expect(doc).toContain('No usable images were found');
  });

  it('renders an inventory table and per-image descriptions', () => {
    const doc = buildImageContextDoc('https://example.com/', [
      asset(),
      asset({ url: 'https://example.com/hero.jpg', role: 'content', alt: '', description: 'Photo of a construction crew on site.' }),
    ]);
    expect(doc).toContain('## Image Inventory');
    expect(doc).toContain('| logo | 200×80 | Example Co logo | https://example.com/logo.png |');
    expect(doc).toContain('| content | 200×80 | (none) | https://example.com/hero.jpg |');
    expect(doc).toContain('## Descriptions');
    expect(doc).toContain('**https://example.com/logo.png**: Company wordmark logo in dark green.');
    expect(doc).toContain('**https://example.com/hero.jpg**: Photo of a construction crew on site.');
  });

  it('marks images with no successful caption', () => {
    const doc = buildImageContextDoc('https://example.com/', [asset({ description: null })]);
    expect(doc).toContain('(captioning failed for this image)');
  });

  it('escapes pipe characters in alt text so the table stays well-formed', () => {
    const doc = buildImageContextDoc('https://example.com/', [asset({ alt: 'a | b' })]);
    expect(doc).toContain('a \\| b');
  });
});
