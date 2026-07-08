/**
 * Streaming proxy for /api/super-clients/:name/chat
 *
 * Next.js rewrites() buffer SSE responses (the whole stream is held until the
 * upstream finishes), which makes the chat's live acknowledgment, planning, and
 * progress-heartbeat events all arrive at once at the end — so the UI just shows
 * "Thinking…" for the entire generation. This Route Handler pipes the SSE stream
 * straight through without buffering (same pattern as the microsite
 * generate-v2-stream proxy). It takes precedence over the fallback rewrite.
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export const maxDuration = 600; // 10 minutes — long generations must not time out

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const bodyText = await req.text();
  const url = `${API_URL}/super-clients/${encodeURIComponent(name)}/chat`;

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
    return NextResponse.json({ error: 'Chat request failed' }, { status: apiRes.status });
  }

  // Pipe the upstream SSE body straight through; catch abrupt disconnects and
  // emit a proper SSE error event instead of a silent close.
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
