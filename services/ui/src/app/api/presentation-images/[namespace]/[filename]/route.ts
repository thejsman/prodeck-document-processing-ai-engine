/**
 * Same-origin proxy for presentation images stored on the API server.
 * The PDF generator (pdfGenerator.ts) fetches images via this route to avoid
 * cross-origin CORS blocks when the UI (port 3001) requests from the API (port 3000).
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ namespace: string; filename: string }> },
) {
  const { namespace, filename } = await params;

  // Basic path traversal guard (mirrors the API-side check)
  if (
    filename.includes('..') || filename.includes('/') || filename.includes('\\') ||
    namespace.includes('..')
  ) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const upstream = `${API_URL}/presentation-images/${encodeURIComponent(namespace)}/${encodeURIComponent(filename)}`;

  try {
    const res = await fetch(upstream);
    if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: res.status });

    const blob = await res.blob();
    return new NextResponse(blob, {
      status: 200,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg' },
    });
  } catch {
    return NextResponse.json({ error: 'Upstream error' }, { status: 502 });
  }
}
