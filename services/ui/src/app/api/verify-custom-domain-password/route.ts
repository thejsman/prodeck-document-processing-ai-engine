import { NextRequest, NextResponse } from 'next/server';
import { getCustomDomainAst } from '@/lib/customDomainStorage';
import { verifyPassword, makeAccessToken, accessCookieName } from '@/lib/micrositeAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { domain?: string; password?: string };
  try {
    body = (await req.json()) as { domain?: string; password?: string };
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const { domain, password } = body;
  if (!domain || !password) return NextResponse.json({ valid: false });

  const record = await getCustomDomainAst(domain).catch(() => null);
  if (!record?.passwordHash) return NextResponse.json({ valid: false });

  const valid = verifyPassword(password, domain, record.passwordHash);
  if (!valid) return NextResponse.json({ valid: false });

  const token = makeAccessToken(domain, record.passwordHash);
  const res = NextResponse.json({ valid: true });
  res.cookies.set(accessCookieName(domain), token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
