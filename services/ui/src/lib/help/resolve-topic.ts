import type { HelpTopic } from './help-types';

/**
 * Route → help-topic resolution. Pure and dependency-free so it can be
 * imported anywhere (including server components). The content registry
 * (`src/content/help`) binds these to the actual HELP_TOPICS list.
 */

export function normalizePath(pathname: string): string {
  if (!pathname) return '/';
  let p = pathname.split('?')[0].split('#')[0];
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

/**
 * Score a route pattern against a pathname. Returns null when it does not
 * match. Static segments must match exactly; `:name` segments match any single
 * non-empty segment. A pattern matches as a prefix (equal, or pathname starts
 * with `pattern + '/'`). Higher score = more specific match.
 */
export function matchScore(pattern: string, pathname: string): number | null {
  const pat = normalizePath(pattern);
  const path = normalizePath(pathname);
  const patSegs = pat === '/' ? [] : pat.slice(1).split('/');
  const pathSegs = path === '/' ? [] : path.slice(1).split('/');
  if (pathSegs.length < patSegs.length) return null;

  let staticMatches = 0;
  let dynamicMatches = 0;
  for (let i = 0; i < patSegs.length; i++) {
    const ps = patSegs[i];
    const seg = pathSegs[i];
    if (ps.startsWith(':')) {
      if (!seg) return null;
      dynamicMatches++;
    } else if (ps === seg) {
      staticMatches++;
    } else {
      return null;
    }
  }
  const exactBonus = pathSegs.length === patSegs.length ? 5 : 0;
  // Longer patterns win ties (more specific), hence the small depth term.
  return staticMatches * 10 + dynamicMatches + exactBonus + patSegs.length * 0.1;
}

/**
 * Pick the best-matching topic for a pathname. Falls back to `fallbackId`
 * (Getting Started) when nothing matches, and to the first topic if even that
 * is missing (should never happen once the registry is populated).
 */
export function resolveTopicForPath(
  pathname: string,
  topics: HelpTopic[],
  fallbackId = 'getting-started',
): HelpTopic {
  const path = normalizePath(pathname);
  let best: HelpTopic | null = null;
  let bestScore = -Infinity;
  let bestLen = -1;

  for (const t of topics) {
    for (const pattern of t.routePatterns) {
      const score = matchScore(pattern, path);
      if (score === null) continue;
      const len = normalizePath(pattern).length;
      if (score > bestScore || (score === bestScore && len > bestLen)) {
        best = t;
        bestScore = score;
        bestLen = len;
      }
    }
  }

  if (best) return best;
  return topics.find((t) => t.id === fallbackId) ?? topics[0];
}
