import { describe, test, expect } from 'vitest';
import { validateSubdomain, sanitizeSubdomainInput } from './subdomainValidation';

describe('validateSubdomain', () => {
  test('accepts a normal subdomain', () => {
    expect(validateSubdomain('acme')).toEqual({ ok: true });
    expect(validateSubdomain('acme-corp')).toEqual({ ok: true });
    expect(validateSubdomain('a1b2c3')).toEqual({ ok: true });
  });

  test('rejects too short', () => {
    const r = validateSubdomain('ab');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/at least 3/);
  });

  test('rejects too long', () => {
    const r = validateSubdomain('a'.repeat(64));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/63 characters or fewer/);
  });

  test('rejects leading hyphen', () => {
    const r = validateSubdomain('-acme');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid');
  });

  test('rejects trailing hyphen', () => {
    const r = validateSubdomain('acme-');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid');
  });

  test('rejects uppercase', () => {
    const r = validateSubdomain('Acme');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid');
  });

  test('rejects underscore', () => {
    const r = validateSubdomain('a_b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid');
  });

  test('rejects reserved words', () => {
    for (const word of ['www', 'api', 'admin', 'app', 'staging']) {
      const r = validateSubdomain(word);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe('reserved');
        expect(r.message).toContain(word);
      }
    }
  });

  test('accepts the boundary case of 3 characters', () => {
    expect(validateSubdomain('a1b')).toEqual({ ok: true });
  });

  test('accepts the boundary case of 63 characters', () => {
    expect(validateSubdomain('a' + 'b'.repeat(61) + 'c')).toEqual({ ok: true });
  });
});

describe('sanitizeSubdomainInput', () => {
  test('lowercases input', () => {
    expect(sanitizeSubdomainInput('ACME')).toBe('acme');
  });

  test('strips invalid characters', () => {
    expect(sanitizeSubdomainInput('a c m e!@#')).toBe('acme');
  });

  test('truncates to 63 chars', () => {
    expect(sanitizeSubdomainInput('a'.repeat(100))).toHaveLength(63);
  });

  test('keeps hyphens and digits', () => {
    expect(sanitizeSubdomainInput('Acme-Corp-123')).toBe('acme-corp-123');
  });
});
