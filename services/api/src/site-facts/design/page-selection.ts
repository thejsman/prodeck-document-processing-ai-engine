// services/api/src/site-facts/design/page-selection.ts
//
// Deterministic selection of a representative page subset for design
// analysis. Pure — works only on the manifest's page_urls; the 404 probe is
// returned as a candidate and verified (status === 404) at capture time.

import type { SiteManifest } from '../types.js';
import type { PageRole, SelectedPage } from './types.js';
import { MAX_DESIGN_PAGES } from './types.js';

const LISTING_SEGMENT = /^(blog|news|articles|products|shop|store|category|categories|collections|portfolio|projects|work|services|docs|resources|case-studies|team|events)$/;
const FORM_SEGMENT = /^(contact|contact-us|get-in-touch|quote|request-a-quote|demo|book|signup|sign-up|register|subscribe|apply)$/;

export const NOT_FOUND_PROBE_PATH = '/__design-404-probe__';

export function notFoundProbeUrl(siteUrl: string): string {
  return new URL(NOT_FOUND_PROBE_PATH, siteUrl).toString();
}

interface Candidate {
  url: string;
  path: string;
  segments: string[];
}

function toCandidates(pageUrls: string[]): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const raw of pageUrls) {
    try {
      const u = new URL(raw);
      u.hash = '';
      u.search = '';
      let path = u.pathname;
      if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
      const key = `${u.origin.toLowerCase()}${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ url: raw, path, segments: path.split('/').filter(Boolean) });
    } catch {
      /* unparseable manifest entry — skip */
    }
  }
  return candidates;
}

/**
 * Pick homepage / listing / detail / form / 404-probe from the crawled URL
 * list. Roles that can't be filled are simply absent — the list is never
 * padded. Fully deterministic: ties always break alphabetically.
 */
export function selectDesignPages(manifest: SiteManifest): SelectedPage[] {
  const candidates = toCandidates(manifest.page_urls);
  if (candidates.length === 0) return [];

  const taken = new Set<string>();
  const selected: SelectedPage[] = [];
  const take = (candidate: Candidate, role: PageRole) => {
    taken.add(candidate.url);
    selected.push({ url: candidate.url, role });
  };

  // homepage: root path, else shortest path (ties alphabetical)
  const byDepth = [...candidates].sort(
    (a, b) => a.segments.length - b.segments.length || a.path.localeCompare(b.path),
  );
  const homepage = byDepth.find((c) => c.segments.length === 0) ?? byDepth[0];
  take(homepage, 'homepage');

  // listing: known section segment with >=2 strictly-deeper children; else any URL with >=3 children
  const childrenOf = (parent: Candidate) =>
    candidates.filter((c) => c !== parent && c.path.startsWith(`${parent.path}/`)).length;
  const alphabetical = [...candidates].sort((a, b) => a.path.localeCompare(b.path));
  const listing =
    alphabetical.find(
      (c) => !taken.has(c.url) && c.segments.length === 1 && LISTING_SEGMENT.test(c.segments[0]) && childrenOf(c) >= 2,
    ) ?? alphabetical.find((c) => !taken.has(c.url) && childrenOf(c) >= 3);
  if (listing) take(listing, 'listing');

  // detail: first child of the listing; else deepest path overall
  const detail = listing
    ? alphabetical.find((c) => !taken.has(c.url) && c.path.startsWith(`${listing.path}/`))
    : undefined;
  const deepest = [...candidates]
    .sort((a, b) => b.segments.length - a.segments.length || a.path.localeCompare(b.path))
    .find((c) => !taken.has(c.url) && c.segments.length >= 1);
  const detailPick = detail ?? deepest;
  if (detailPick) take(detailPick, 'detail');

  // form: last path segment matches a known contact/signup name
  const form = alphabetical.find(
    (c) => !taken.has(c.url) && c.segments.length > 0 && FORM_SEGMENT.test(c.segments[c.segments.length - 1]),
  );
  if (form) take(form, 'form');

  // 404 probe (verified as a real 404 at capture time)
  selected.push({ url: notFoundProbeUrl(manifest.site_url), role: 'notfound' });

  return selected.slice(0, MAX_DESIGN_PAGES);
}
