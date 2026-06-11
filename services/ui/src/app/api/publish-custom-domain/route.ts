import crypto from 'crypto';
import dns from 'dns/promises';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { putCustomDomainAst } from '@/lib/customDomainStorage';
import type { LayoutAST } from '@/types/presentation';

export const dynamic = 'force-dynamic';

const FQDN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function isValidDomain(domain: string): boolean {
  return FQDN_RE.test(domain) && domain.length <= 253;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function verifyDns(domain: string): Promise<boolean> {
  const cnameTarget = process.env.MICROSITE_CNAME_TARGET?.toLowerCase();
  const serverIp = process.env.MICROSITE_SERVER_IP;
  if (!cnameTarget && !serverIp) return true; // not configured — skip check

  const isApex = domain.split('.').length === 2;
  try {
    if (isApex && serverIp) {
      const ips = await withTimeout(dns.resolve4(domain), 4000);
      return ips.includes(serverIp);
    }
    if (cnameTarget) {
      const cnames = await withTimeout(dns.resolveCname(domain), 4000);
      return cnames.map(c => c.replace(/\.$/, '').toLowerCase()).includes(cnameTarget);
    }
    return true;
  } catch {
    return false;
  }
}

interface PublishCustomDomainRequest {
  namespace: string;
  ast: LayoutAST;
  domain: string;
  password?: string;
  skipDnsCheck?: boolean;
}

export async function POST(req: NextRequest) {
  let body: PublishCustomDomainRequest;
  try {
    body = (await req.json()) as PublishCustomDomainRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { namespace, ast, domain: rawDomain, password, skipDnsCheck } = body;
  const domain = rawDomain?.trim().toLowerCase() ?? '';

  if (!namespace || !ast || !domain) {
    return NextResponse.json({ error: 'namespace, ast, and domain are required' }, { status: 400 });
  }

  if (!isValidDomain(domain)) {
    return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 });
  }

  if (!skipDnsCheck) {
    const dnsOk = await verifyDns(domain);
    if (!dnsOk) {
      return NextResponse.json(
        { error: 'DNS verification failed — ensure your DNS record points to this server before publishing' },
        { status: 422 },
      );
    }
  }

  const passwordHash = password
    ? crypto.scryptSync(password, domain, 64).toString('hex')
    : undefined;

  try {
    const { publishedAt } = await putCustomDomainAst(domain, ast, { namespace, passwordHash });

    try {
      revalidatePath(`/sites/custom/${domain}`);
    } catch {
      // non-fatal
    }

    // Fire-and-forget SSL provisioning via cert-manager sidecar
    const certManagerUrl = process.env.CERT_MANAGER_URL;
    if (certManagerUrl) {
      const email = process.env.CERTBOT_EMAIL ?? '';
      fetch(`${certManagerUrl}/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, email }),
      }).catch(err => console.error('[publish-custom-domain] cert-manager provision error:', err));
    }

    return NextResponse.json({
      url: `https://${domain}`,
      domain,
      namespace,
      publishedAt,
      passwordProtected: !!passwordHash,
      sslPending: !!certManagerUrl,
    });
  } catch (err) {
    console.error('[publish-custom-domain] failed:', err);
    return NextResponse.json({ error: 'Failed to publish to custom domain' }, { status: 500 });
  }
}
