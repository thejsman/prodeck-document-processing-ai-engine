import crypto from 'crypto';

export function hashPassword(password: string, subdomain: string): string {
  return crypto.scryptSync(password, subdomain, 64).toString('hex');
}

export function verifyPassword(password: string, subdomain: string, storedHash: string): boolean {
  try {
    const computed = Buffer.from(hashPassword(password, subdomain), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    if (computed.length !== stored.length) return false;
    return crypto.timingSafeEqual(computed, stored);
  } catch {
    return false;
  }
}

function accessSecret(): string {
  return process.env.MICROSITE_ACCESS_SECRET ?? 'dev-fallback-change-in-prod';
}

export function makeAccessToken(subdomain: string, passwordHash: string): string {
  return crypto.createHmac('sha256', accessSecret())
    .update(`${subdomain}:${passwordHash}`)
    .digest('hex');
}

export function verifyAccessToken(subdomain: string, passwordHash: string, token: string): boolean {
  try {
    const expected = Buffer.from(makeAccessToken(subdomain, passwordHash), 'hex');
    const provided = Buffer.from(token, 'hex');
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

export function accessCookieName(subdomain: string): string {
  return `ms_access_${subdomain.replace(/-/g, '_')}`;
}
