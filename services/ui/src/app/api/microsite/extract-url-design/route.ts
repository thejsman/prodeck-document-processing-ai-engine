/**
 * POST /api/microsite/extract-url-design
 *
 * Proxies to the Fastify backend POST /presentations/extract-url-design.
 * The backend fetches the given URL server-side (no CORS issues), scrapes CSS,
 * and calls the LLM to return ReferenceDesign tokens.
 */

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const body = await req.text();
  const authHeader = req.headers.get('authorization') ?? '';

  try {
    const apiRes = await fetch(`${API_URL}/presentations/extract-url-design`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { authorization: authHeader } : {}),
      },
      body,
    });

    const data = await apiRes.json() as unknown;
    return NextResponse.json(data, { status: apiRes.ok ? 200 : apiRes.status });
  } catch (err) {
    console.error('[extract-url-design proxy] error:', err);
    return NextResponse.json({ error: 'proxy_error', tokens: null }, { status: 500 });
  }
}
