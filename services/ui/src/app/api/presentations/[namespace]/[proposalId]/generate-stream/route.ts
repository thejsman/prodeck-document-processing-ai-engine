/**
 * Streaming proxy for /api/presentations/:namespace/:proposalId/generate-stream
 *
 * Next.js rewrites() buffer SSE responses, breaking streaming.
 * This Route Handler forwards the request directly to the API and
 * pipes the SSE stream back to the client without buffering.
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ namespace: string; proposalId: string }> },
) {
  const { namespace, proposalId } = await params;
  const bodyText = await req.text();
  let generationMode: string | undefined;
  try { generationMode = (JSON.parse(bodyText) as Record<string, unknown>)?.generationMode as string | undefined; } catch { /* keep undefined */ }
  const backendEndpoint = generationMode === 'classic' ? 'generate-classic-stream' : 'generate-structured-stream';
  const url = `${API_URL}/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/${backendEndpoint}`;
  console.log(`[route-handler] generate-stream → ${backendEndpoint} for`, namespace, proposalId);

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
    return NextResponse.json({ error: 'Stream request failed' }, { status: apiRes.status });
  }

  // Pipe the SSE stream directly — no buffering
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
