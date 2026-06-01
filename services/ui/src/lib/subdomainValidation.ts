const FORMAT = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

const RESERVED = new Set([
  'www', 'api', 'admin', 'app', 'mail', 'email', 'ftp', 'sftp', 'ssh',
  'dev', 'staging', 'prod', 'production', 'test', 'demo', 'beta', 'alpha',
  'dashboard', 'portal', 'login', 'auth', 'oauth', 'status', 'health',
  'static', 'assets', 'media', 'cdn', 's3', 'files', 'docs', 'help',
  'support', 'blog', 'shop', 'store', 'pay', 'billing', 'account',
  'careers', 'jobs', 'press', 'legal', 'privacy', 'terms',
]);

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'reserved'; message: string };

export function validateSubdomain(value: string): ValidationResult {
  if (value.length < 3) {
    return { ok: false, reason: 'invalid', message: 'Must be at least 3 characters' };
  }
  if (value.length > 63) {
    return { ok: false, reason: 'invalid', message: 'Must be 63 characters or fewer' };
  }
  if (!FORMAT.test(value)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Only lowercase letters, numbers, and hyphens — no leading or trailing hyphens',
    };
  }
  if (RESERVED.has(value)) {
    return { ok: false, reason: 'reserved', message: `"${value}" is a reserved name` };
  }
  return { ok: true };
}

export function sanitizeSubdomainInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);
}
