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

  // Strip port from root domain so `localtest.me:3001` compares correctly
  // against the port-stripped host header value.
  const rootHost = root.split(':')[0].toLowerCase();

  const host = (req.headers.get('host') ?? '').split(':')[0].toLowerCase();
  if (host === rootHost || host === `www.${rootHost}`) return NextResponse.next();
  if (!host.endsWith(`.${rootHost}`)) {
    // Only treat as a custom domain if it looks like a real FQDN (has at least
    // one dot and is not a loopback address). Bare `localhost` or `127.0.0.1`
    // must always fall through to the main app.
    const looksLikeExternalDomain = host.includes('.') && host !== '127.0.0.1';
    if (process.env.MICROSITE_CUSTOM_DOMAINS_ENABLED === 'true' && looksLikeExternalDomain) {
      const url = req.nextUrl.clone();
      url.pathname = `/sites/custom/${host}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  // Take only the leftmost label as the subdomain.
  const sub = host.slice(0, host.length - rootHost.length - 1).split('.').pop()!;
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
