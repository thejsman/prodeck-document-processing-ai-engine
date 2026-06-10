import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { validateSubdomain } from '@/lib/subdomainValidation';
import { putAst } from '@/lib/micrositeStorage';
import type { LayoutAST } from '@/types/presentation';

export const dynamic = 'force-dynamic';

interface PublishRequest {
  namespace: string;
  ast: LayoutAST;
  subdomain: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  let body: PublishRequest;
  try {
    body = (await req.json()) as PublishRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { namespace, ast, subdomain, password } = body;
  if (!namespace || !ast || !subdomain) {
    return NextResponse.json({ error: 'namespace, ast, and subdomain are required' }, { status: 400 });
  }

  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    return NextResponse.json({ error: v.message }, { status: 400 });
  }

  const passwordHash = password
    ? crypto.scryptSync(password, subdomain, 64).toString('hex')
    : undefined;

  try {
    const { publishedAt } = await putAst(subdomain, ast, { namespace, passwordHash });

    // Flush ISR cache immediately so re-publishes are visible without the 60s
    // revalidate window. Safe to call even if the path hasn't been rendered yet.
    try {
      revalidatePath(`/sites/${subdomain}`);
    } catch {
      // revalidatePath may throw outside of a request context in some setups —
      // not fatal; ISR will catch up at next interval.
    }

    const root = process.env.MICROSITE_ROOT_DOMAIN ?? 'yourdomain.com';
    return NextResponse.json({
      url: `https://${subdomain}.${root}`,
      subdomain,
      namespace,
      publishedAt,
      passwordProtected: !!passwordHash,
    });
  } catch (err) {
    console.error('[publish] failed to publish microsite', err);
    return NextResponse.json(
      { error: 'Failed to publish microsite' },
      { status: 500 },
    );
  }
}
