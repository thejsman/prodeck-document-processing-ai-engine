import { describe, it, expect } from 'vitest';
import { extractSlidesTag, stripSlidesTag, hasRawArtifactMarkup, resolveSlideCount, MAX_SLIDE_COUNT } from './slide-parsing.js';

const WELL_FORMED = '<slides><!DOCTYPE html><html><body>deck</body></html></slides>';
const MISSING_CLOSER = '<slides><!DOCTYPE html><html><body>deck</body></html>';
const TRUNCATED = '<slides> <!DOCTYPE html> <html> <head><style>.s1{color:red}';

describe('extractSlidesTag', () => {
  it('parses a well-formed <slides> pair', () => {
    const r = extractSlidesTag(WELL_FORMED);
    expect(r).not.toBeNull();
    expect(r!.html).toContain('<!DOCTYPE html>');
    expect(r!.html).toContain('</html>');
    expect(r!.html).not.toContain('<slides>');
  });

  it('recovers a complete deck that dropped its closing </slides> tag', () => {
    const r = extractSlidesTag(MISSING_CLOSER);
    expect(r).not.toBeNull();
    expect(r!.html).toContain('</body>');
    expect(r!.html).not.toContain('<slides>');
  });

  it('returns null for a genuinely truncated response (no closing html/body)', () => {
    expect(extractSlidesTag(TRUNCATED)).toBeNull();
  });

  it('returns null when there is no <slides> tag at all', () => {
    expect(extractSlidesTag('Just a normal chat reply.')).toBeNull();
  });
});

describe('stripSlidesTag', () => {
  it('removes a well-formed block entirely', () => {
    expect(stripSlidesTag(`intro ${WELL_FORMED} outro`)).toBe('intro  outro'.trim());
  });

  it('strips an unterminated <slides> block to end of string', () => {
    const out = stripSlidesTag(`Here you go: ${TRUNCATED}`);
    expect(out).not.toContain('<slides>');
    expect(out).not.toContain('<!DOCTYPE');
    expect(out).toBe('Here you go:');
  });
});

describe('hasRawArtifactMarkup', () => {
  it('detects each artifact marker', () => {
    expect(hasRawArtifactMarkup('<slides>x')).toBe(true);
    expect(hasRawArtifactMarkup('<!DOCTYPE html>')).toBe(true);
    expect(hasRawArtifactMarkup('<html lang="en">')).toBe(true);
    expect(hasRawArtifactMarkup('<proposal title="x">')).toBe(true);
    expect(hasRawArtifactMarkup('<document title="x">')).toBe(true);
  });

  it('does not flag ordinary chat prose', () => {
    expect(hasRawArtifactMarkup('I built a presentation for you.')).toBe(false);
  });
});

describe('resolveSlideCount', () => {
  it('resolves to no default when the message has no count', () => {
    expect(resolveSlideCount('create a ppt')).toEqual({ requested: null, resolved: null, wasCapped: false });
  });

  it('passes through an explicit count under the cap', () => {
    expect(resolveSlideCount('create an 8 slide deck')).toEqual({ requested: 8, resolved: 8, wasCapped: false });
  });

  it('clamps an explicit count above the cap and reports it was capped', () => {
    expect(resolveSlideCount('create a 30 slide deck')).toEqual({
      requested: 30,
      resolved: MAX_SLIDE_COUNT,
      wasCapped: true,
    });
  });

  it('does not clamp a count exactly at the cap', () => {
    expect(resolveSlideCount(`make a ${MAX_SLIDE_COUNT} page deck`)).toEqual({
      requested: MAX_SLIDE_COUNT,
      resolved: MAX_SLIDE_COUNT,
      wasCapped: false,
    });
  });
});
