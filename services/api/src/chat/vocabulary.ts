// services/api/src/chat/vocabulary.ts
//
// Domain vocabulary + "bare request" detection for the Chat V2 pipeline.
//
// SINGLE SOURCE OF TRUTH for the many ways a user can refer to a microsite.
// A microsite is a one-page presentation website — but users say "landing
// page", "one pager site", "mini-site", "splash page", etc. Keeping the
// vocabulary here (instead of a rigid regex buried in the classifier) means
// teaching the system a new synonym is a one-line change that every consumer
// (intent classifier, clarification gate) picks up automatically.
//
// Pure module: no I/O, no LLM, deterministic (Golden Rule #4).

// ---------------------------------------------------------------------------
// Microsite vocabulary
// ---------------------------------------------------------------------------

/**
 * Noun phrases that mean "microsite". Extend this list to add a synonym.
 *
 * NOTE: web-context is required for the "one pager"/"one page"/"single page"
 * variants (they must be followed by site/page/website). A bare "one pager"
 * on its own is a one-page *document* (handled by GENERATE_DOCUMENT), so we
 * deliberately do NOT match it here.
 */
export const MICROSITE_NOUN_TERMS: RegExp[] = [
  /\bmicro[\s-]?site\b/i,
  /\bmini[\s-]?site\b/i,
  /\blanding\s+(page|site)\b/i,
  /\blanding[\s-]?page\b/i, // "landingpage" / "landing-page" (no space)
  /\bsplash\s+page\b/i,
  /\bone[\s-]?pager\s+(site|page|website)\b/i, // "one pager site", "one-pager page"
  /\bone[\s-]?page\s+(site|website|micro[\s-]?site|presentation)\b/i, // "one page site"
  /\bsingle[\s-]?page\s+(site|website)\b/i,
  /\bpresentation\s+(site|micro[\s-]?site|page)\b/i,
  // Clearly-web page synonyms. Deliberately compound ("web page", "sales page")
  // — bare "website"/"page"/"brochure" are too broad (a print brochure, "check
  // their website") and are left to the LLM classifier to route.
  /\bweb\s*page\b/i,
  /\bsales\s+page\b/i,
  /\bproduct\s+page\b/i,
  /\bexplainer\s+page\b/i,
  /\bpresentation\b/i, // pre-existing behaviour: "create a presentation" → microsite
];

/** Verb phrases that request microsite generation ("convert to a presentation"). */
export const MICROSITE_VERB_TERMS: RegExp[] = [
  /\bconvert\s+to\s+(a\s+)?present/i,
];

const MICROSITE_ALL: RegExp[] = [...MICROSITE_NOUN_TERMS, ...MICROSITE_VERB_TERMS];

/** True when the message refers to a microsite by any known term or synonym. */
export function isMicrositeRequest(message: string): boolean {
  return MICROSITE_ALL.some((re) => re.test(message));
}

/**
 * Combined noun matcher, used for bare-request detection. Only the noun terms
 * participate — a verb phrase like "convert to a presentation" is never "bare".
 */
export const MICROSITE_ARTIFACT = new RegExp(
  MICROSITE_NOUN_TERMS.map((re) => re.source).join('|'),
  'i',
);

// ---------------------------------------------------------------------------
// Other artifact matchers
// ---------------------------------------------------------------------------

/** Matches the bare word "proposal" (singular — plural leans towards "list proposals"). */
export const PROPOSAL_ARTIFACT = /\bproposal\b/i;

// ---------------------------------------------------------------------------
// "Bare request" detection
// ---------------------------------------------------------------------------

// Verbs / articles / fillers that carry no requirement context. Stripped when
// deciding whether a message is "bare" — i.e. essentially just the artifact
// noun with no specifics ("microsite", "make a microsite", "landing page").
const FILLER_TOKENS = new Set<string>([
  'a', 'an', 'the', 'please', 'pls', 'can', 'could', 'would', 'will', 'you',
  'i', 'id', 'we', 'want', 'wanna', 'wish', 'need', 'make', 'create', 'generate',
  'build', 'do', 'produce', 'write', 'draft', 'start', 'begin', 'new', 'some',
  'me', 'my', 'to', 'for', 'us', 'let', 'lets', 'kindly', 'like', 'give', 'get',
  'help', 'with', 'this', 'that', 'one', 'gen', 'just', 'now', 'up', 'set',
  'of', 'and', 'ok', 'okay', 'pls',
]);

/**
 * Removes the artifact phrase and all filler tokens, returning the meaningful
 * remainder. An empty remainder means the message was "bare".
 */
export function strippedRemainder(message: string, artifact: RegExp): string {
  const withoutArtifact = message.toLowerCase().replace(artifact, ' ');
  return withoutArtifact
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !FILLER_TOKENS.has(t))
    .join(' ');
}

/**
 * True when the message names the artifact but supplies no actionable context
 * ("microsite", "a microsite", "make a landing page"). Requests that carry
 * specifics ("...with a dark theme from the acme proposal") are NOT bare and
 * should proceed straight to generation.
 */
export function isBareArtifactRequest(message: string, artifact: RegExp): boolean {
  return artifact.test(message) && strippedRemainder(message, artifact).length === 0;
}
