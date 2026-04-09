import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/proxy-image?url=<encoded-url>
 *
 * Server-side image proxy — fetches any external image URL and streams it back
 * to the browser. Used by pdfSlideRenderer to bypass CORS restrictions on
 * third-party image hosts (Azure Blob, DALL-E, Unsplash, etc.).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  // Only proxy http(s) URLs — no file:// or other schemes
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return NextResponse.json({ error: 'Unsupported protocol' }, { status: 400 });
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Prodeck-PDF/1.0)' },
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Fetch failed' },
      { status: 502 },
    );
  }
}
