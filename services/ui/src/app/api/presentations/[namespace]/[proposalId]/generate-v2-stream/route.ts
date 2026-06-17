/**
 * Streaming proxy for /api/presentations/:namespace/:proposalId/generate-v2-stream
 *
 * Next.js rewrites() buffer SSE responses, breaking streaming.
 * This Route Handler pipes the SSE stream directly to the client without buffering.
 * If the upstream connection drops (e.g. API server restart in dev), it emits a
 * proper SSE error event so the client can show a readable message instead of
 * a raw "network error".
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export const maxDuration = 600; // 10 minutes — prevents Vercel/edge timeout

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ namespace: string; proposalId: string }> },
) {
  const { namespace, proposalId } = await params;
  const bodyText = await req.text();
  const url = `${API_URL}/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/generate-v2-stream`;

  const authHeader = req.headers.get('authorization') ?? '';

  const apiRes = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { authorization: authHeader } : {}),
    },
    body: bodyText,
  });

  if (!apiRes.ok || !apiRes.body) {
    return NextResponse.json({ error: 'V2 stream request failed' }, { status: apiRes.status });
  }

  // Wrap the upstream body in a TransformStream so we can catch abrupt disconnects
  // and emit a proper SSE error event rather than closing the connection silently.
  const upstream = apiRes.body;
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  void (async () => {
    const reader = upstream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.close();
    } catch {
      const errEvent = `data: ${JSON.stringify({ type: 'error', message: 'Server disconnected — please try again' })}\n\n`;
      try { await writer.write(new TextEncoder().encode(errEvent)); } catch { /* client gone */ }
      try { await writer.close(); } catch { /* already closed */ }
    }
  })();

  return new NextResponse(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
