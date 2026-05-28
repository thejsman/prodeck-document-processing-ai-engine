import { NextRequest, NextResponse } from 'next/server';

/**
 * Maps host `{subdomain}.{MICROSITE_ROOT_DOMAIN}` to `/sites/{subdomain}`.
 * - Strips port for local dev (`localtest.me:3001` etc.)
 * - Passes through the apex (`yourdomain.com`) and `www.yourdomain.com`
 * - Falls through when MICROSITE_ROOT_DOMAIN is unset (feature disabled)
 */
export function middleware(req: NextRequest) {
  const root = process.env.MICROSITE_ROOT_DOMAIN;
  if (!root) return NextResponse.next();

  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (host === root || host === `www.${root}`) return NextResponse.next();
  if (!host.endsWith(`.${root}`)) return NextResponse.next();

  // Take only the leftmost label as the subdomain.
  const sub = host.slice(0, host.length - root.length - 1).split('.').pop()!;
  if (!sub) return NextResponse.next();

  // Microsite is a single page — collapse any incoming path so deep links on
  // the subdomain (e.g. `/section-foo`) still resolve to the microsite root.
  const url = req.nextUrl.clone();
  url.pathname = `/sites/${sub}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    // Skip Next.js internals, API routes, and static assets — everything else
    // is a candidate for subdomain rewriting.
    '/((?!_next/|api/|favicon|robots|sitemap).*)',
  ],
};
