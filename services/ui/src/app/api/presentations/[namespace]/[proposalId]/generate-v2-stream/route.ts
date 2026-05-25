/**
 * Streaming proxy for /api/presentations/:namespace/:proposalId/generate-v2-stream
 *
 * Next.js rewrites() buffer SSE responses, breaking streaming.
 * This Route Handler pipes the SSE stream directly to the client without buffering.
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

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

  return new NextResponse(apiRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
