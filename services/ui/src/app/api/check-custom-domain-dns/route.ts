import dns from 'dns/promises';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const FQDN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isValidDomain(domain: string): boolean {
  return FQDN_RE.test(domain) && domain.length <= 253;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('DNS lookup timed out')), ms)),
  ]);
}

export async function GET(req: NextRequest) {
  const domain = new URL(req.url).searchParams.get('domain')?.trim().toLowerCase() ?? '';

  if (!domain || !isValidDomain(domain)) {
    return NextResponse.json({ verified: false, message: 'Invalid domain format' }, { status: 400 });
  }

  const cnameTarget = process.env.MICROSITE_CNAME_TARGET?.toLowerCase();
  const serverIp = process.env.MICROSITE_SERVER_IP;

  if (!cnameTarget && !serverIp) {
    return NextResponse.json({ verified: false, skipped: true, message: 'DNS check not configured' });
  }

  const isApex = domain.split('.').length === 2;

  try {
    if (isApex && serverIp) {
      // Root domain — check A record
      const ips = await withTimeout(dns.resolve4(domain), 4000);
      const verified = ips.includes(serverIp);
      return NextResponse.json({ verified, resolvedTo: ips, recordType: 'A' });
    }

    if (cnameTarget) {
      // Subdomain — check CNAME
      const cnames = await withTimeout(dns.resolveCname(domain), 4000);
      const normalized = cnames.map((c) => c.replace(/\.$/, '').toLowerCase());
      const verified = normalized.includes(cnameTarget);
      return NextResponse.json({ verified, resolvedTo: cnames, recordType: 'CNAME' });
    }

    // cnameTarget not set but serverIp is — fall back to A record check for subdomains too
    const ips = await withTimeout(dns.resolve4(domain), 4000);
    const verified = serverIp ? ips.includes(serverIp) : false;
    return NextResponse.json({ verified, resolvedTo: ips, recordType: 'A' });
  } catch (err) {
    const code = (err as { code?: string }).code;
    return NextResponse.json({
      verified: false,
      code,
      message: 'DNS lookup failed - check your record and try again',
    });
  }
}
