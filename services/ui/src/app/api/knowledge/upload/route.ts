import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/knowledge/upload
 *
 * Buffered proxy to the Fastify backend for knowledge file uploads.
 *
 * The duplex: 'half' + ReadableStream approach causes ERR_STREAM_PREMATURE_CLOSE
 * in Fastify's multipart parser when the stream encounters backpressure or
 * timing issues during large file uploads. Buffering the full body with
 * arrayBuffer() before forwarding eliminates this class of errors entirely.
 * Since all traffic is localhost-to-localhost, the buffering adds no
 * meaningful latency.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

  const forwardHeaders = new Headers();
  const auth = req.headers.get('authorization');
  if (auth) forwardHeaders.set('authorization', auth);
  const contentType = req.headers.get('content-type');
  if (contentType) forwardHeaders.set('content-type', contentType);

  try {
    // Buffer the full body so the downstream Fastify multipart parser
    // receives a stable, complete stream rather than a piped ReadableStream.
    const body = await req.arrayBuffer();
    forwardHeaders.set('content-length', String(body.byteLength));

    const upstream = await fetch(`${apiUrl}/knowledge/upload`, {
      method: 'POST',
      headers: forwardHeaders,
      body,
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
