import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const domain = new URL(req.url).searchParams.get('domain')?.trim().toLowerCase() ?? '';
  if (!domain) return NextResponse.json({ hasCert: false }, { status: 400 });

  const certManagerUrl = process.env.CERT_MANAGER_URL;
  if (!certManagerUrl) {
    // cert-manager not configured — assume cert is ready (user manages TLS externally)
    return NextResponse.json({ hasCert: true, unmanaged: true });
  }

  try {
    const res = await fetch(`${certManagerUrl}/status?domain=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return NextResponse.json({ hasCert: false });
    const data = (await res.json()) as { hasCert: boolean };
    return NextResponse.json({ hasCert: data.hasCert ?? false });
  } catch {
    return NextResponse.json({ hasCert: false });
  }
}
