/**
 * Streaming proxy for POST /api/chat/message
 *
 * Next.js rewrites() buffer SSE responses, breaking streaming. When the chat
 * pipeline runs a long tool (e.g. proposal generation via Python), the entire
 * SSE event stream accumulates in the proxy buffer and only reaches the browser
 * after the stream closes — too late for in-flight UI updates.
 *
 * This Route Handler takes precedence over the fallback rewrite and pipes the
 * response body directly to the client, preserving incremental SSE delivery.
 * Non-streaming (JSON) responses are forwarded as-is.
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const authHeader = req.headers.get('authorization') ?? '';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${API_URL}/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `API unreachable: ${message}` }, { status: 502 });
  }

  // SSE stream — pipe body directly so events reach the client incrementally.
  if (apiRes.headers.get('content-type')?.includes('text/event-stream')) {
    if (!apiRes.body) {
      return NextResponse.json({ error: 'Empty stream response' }, { status: 502 });
    }
    return new NextResponse(apiRes.body, {
      status: apiRes.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // JSON / error response — pass through with original status.
  const text = await apiRes.text();
  return new NextResponse(text, {
    status: apiRes.status,
    headers: { 'Content-Type': apiRes.headers.get('content-type') ?? 'application/json' },
  });
}
