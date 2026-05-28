import { NextRequest, NextResponse } from 'next/server';
import { validateSubdomain } from '@/lib/subdomainValidation';
import { headAst } from '@/lib/micrositeStorage';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const subdomain = new URL(req.url).searchParams.get('subdomain')?.trim() ?? '';

  const v = validateSubdomain(subdomain);
  if (!v.ok) {
    return NextResponse.json({
      available: false,
      reason: v.reason,
      message: v.message,
    });
  }

  const head = await headAst(subdomain);
  if (head === 'taken') {
    const root = process.env.MICROSITE_ROOT_DOMAIN ?? 'yourdomain.com';
    return NextResponse.json({
      available: false,
      reason: 'taken',
      message: `${subdomain}.${root} is already in use`,
    });
  }

  // 'available' or 'error' (fail-open per spec section 7)
  return NextResponse.json({ available: true });
}
