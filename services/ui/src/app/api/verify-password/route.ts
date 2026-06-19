import { NextRequest, NextResponse } from 'next/server';
import { getAst } from '@/lib/micrositeStorage';
import { verifyPassword, makeAccessToken, accessCookieName } from '@/lib/micrositeAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { subdomain?: string; password?: string };
  try {
    body = (await req.json()) as { subdomain?: string; password?: string };
  } catch {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const { subdomain, password } = body;
  if (!subdomain || !password) return NextResponse.json({ valid: false });

  const record = await getAst(subdomain).catch(() => null);
  if (!record?.passwordHash) return NextResponse.json({ valid: false });

  const valid = verifyPassword(password, subdomain, record.passwordHash);
  if (!valid) return NextResponse.json({ valid: false });

  const token = makeAccessToken(subdomain, record.passwordHash);
  const res = NextResponse.json({ valid: true });
  res.cookies.set(accessCookieName(subdomain), token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
