import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/knowledge/upload
 *
 * Streaming proxy to the Fastify backend for knowledge file uploads.
 *
 * Next.js 15.1's dev-server rewrite proxy buffers the entire request body and
 * enforces a 10 MB cap, which breaks large file uploads. This App Router route
 * intercepts the path before the fallback rewrite runs and streams the
 * multipart body directly to Fastify, bypassing that limit entirely.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

  const forwardHeaders = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) forwardHeaders.set('authorization', auth);
  const contentType = req.headers.get('content-type');
  if (contentType) forwardHeaders.set('content-type', contentType);
  const contentLength = req.headers.get('content-length');
  if (contentLength) forwardHeaders.set('content-length', contentLength);

  try {
    const upstream = await fetch(`${apiUrl}/knowledge/upload`, {
      method: 'POST',
      headers: forwardHeaders,
      body: req.body,
      // Required for streaming request bodies in Node.js fetch
      // @ts-ignore — duplex is not yet in the TypeScript DOM types
      duplex: 'half',
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload proxy failed' },
      { status: 502 },
    );
  }
}
