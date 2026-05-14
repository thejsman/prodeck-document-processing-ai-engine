/**
 * structured-microsite-generator.ts
 *
 * Single-pass structured generation: one LLM call produces a complete AST
 * (all sections with content fields) instead of running the multi-step agent
 * pipeline (Plan → Brief → 4×batch → CSS → HTML per section).
 *
 * Output is an AST compatible with site-ast.json — no customHtml, sections
 * render via the existing typed React components. This makes the result fully
 * editable in the editor, section-by-section, without any extra work.
 *
 * Expected generation time: 15–25 s for a 9-section microsite.
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructuredSection {
  id: string;
  sectionType: string;
  heading: string;
  content: Record<string, unknown>;
  image: { source: string; query: string; url: string | null };
  customHtml?: string;
}

export interface StructuredAST {
  proposalId: string;
  generatedAt: string;
  meta: { title?: string; client?: string; author?: string; date?: string };
  brand: { companyName: string; tagline?: string; primaryColor?: string; logoUrl?: string | null };
  brief: {
    clientName: string;
    clientIndustry: string;
    proposingCompany: string;
    primaryTone: string;
    engagementSummary: string;
    keyOutcomes: string[];
    totalValue?: string;
    duration?: string;
  };
  behavior?: { parallax?: boolean; sectionAnimations?: Record<string, string> };
  sections: StructuredSection[];
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are a proposal microsite content generator. Your job is to read an entire proposal document and produce a complete structured JSON AST for a microsite — in one response.

CONTENT RULES (non-negotiable):
- Use the proposal's OWN language for headlines — scan the Executive Summary for strong verbatim phrases
- NEVER fabricate numbers, percentages, metrics, or figures not in the proposal
- Every major heading (##) in the proposal MUST become a section
- Extract stats only from values you can directly count in the document
- Primary tone must match the proposal's voice (authoritative, consultative, warm, etc.)

SECTION MAPPING:
- Executive Summary / Introduction → sectionType: "overview"
- Client Background / Current State / Challenges → sectionType: "challenge"
- Scope of Work / Deliverables → sectionType: "deliverables"
- Approach / Methodology / Strategy → sectionType: "approach"
- Project Timeline / Phases → sectionType: "timeline"
- Investment / Pricing / Budget → sectionType: "pricing"
- Why Choose Us / Credentials → sectionType: "whyus"
- Next Steps / Terms / CTA → sectionType: "nextsteps"
- Any other section → sectionType: "generic"
- Always start with sectionType: "hero" (synthesised from proposal)

OUTPUT FORMAT: Return ONLY valid JSON matching this schema exactly. No markdown fences, no explanation.

{
  "meta": { "title": "string", "client": "string", "date": "string" },
  "brand": { "companyName": "proposing company name", "tagline": "optional", "primaryColor": "#hex — choose warm/light for recreation/family, dark/minimal for tech/SaaS" },
  "brief": {
    "clientName": "company receiving the proposal",
    "clientIndustry": "specific industry",
    "proposingCompany": "company writing the proposal",
    "primaryTone": "authoritative|consultative|innovative|warm",
    "engagementSummary": "2 sentences — what is being built and what outcome is achieved",
    "keyOutcomes": ["3-5 outcomes EXACTLY as stated in the proposal"],
    "totalValue": "exact price if stated",
    "duration": "exact duration if stated"
  },
  "sections": [
    {
      "sectionType": "hero",
      "heading": "Hero",
      "content": {
        "eyebrow": "4-8 words e.g. 'Proposal · 2026'",
        "headline": "8-14 words using the proposal's strongest outcome phrase verbatim",
        "subheadline": "1-2 sentences from the proposal's engagement summary",
        "body": "2-3 sentences on scope and why now",
        "ctaPrimary": "3-5 word action label",
        "ctaSecondary": "3-4 word softer option",
        "imageQuery": "photo search term for hero background",
        "variant": "split"
      }
    },
    {
      "sectionType": "overview",
      "heading": "Executive Summary",
      "content": {
        "eyebrow": "Project Overview",
        "headline": "8-14 words",
        "subheadline": "1-2 sentences",
        "body": "3-5 sentences with specific details from the proposal",
        "highlights": [
          { "value": "extract from proposal e.g. '12 Weeks'", "label": "Delivery Timeline" },
          { "value": "exact price", "label": "Total Investment" },
          { "value": "number of phases/workstreams", "label": "Workstreams" }
        ],
        "imageQuery": "photo search term",
        "variant": "editorial"
      }
    },
    {
      "sectionType": "challenge",
      "heading": "Our Understanding",
      "content": {
        "eyebrow": "The Challenge",
        "headline": "8-12 words — specific client pain",
        "body": "3-5 sentences with exact details from the proposal",
        "pullquote": "10-18 word sharp insight from the proposal",
        "highlights": [
          { "title": "exact pain metric from proposal", "subtitle": "2-sentence context" }
        ],
        "imageQuery": "photo search term",
        "variant": "split"
      }
    },
    {
      "sectionType": "deliverables",
      "heading": "Scope of Work",
      "content": {
        "eyebrow": "What We Deliver",
        "headline": "8-12 words",
        "items": [
          {
            "iconHint": "icon keyword e.g. content|website|document|strategy|launch|photo|campaign",
            "name": "Workstream name EXACTLY as in proposal",
            "detail": "2-3 sentence description of deliverables in this workstream"
          }
        ],
        "imageQuery": "photo search term",
        "variant": "card-grid"
      }
    },
    {
      "sectionType": "approach",
      "heading": "Our Approach",
      "content": {
        "eyebrow": "Methodology",
        "headline": "8-12 words",
        "subheadline": "1-2 sentences on approach and methodology",
        "pillars": [
          {
            "iconHint": "icon keyword e.g. strategy|research|launch|content|identity|digital",
            "name": "Phase/pillar name EXACTLY as in proposal",
            "description": "2-3 sentences of detail on this phase or pillar"
          }
        ],
        "imageQuery": "photo search term",
        "variant": "editorial"
      }
    },
    {
      "sectionType": "timeline",
      "heading": "Project Timeline",
      "content": {
        "eyebrow": "Timeline",
        "headline": "8-12 words stating exact phase count",
        "subheadline": "1 sentence with total duration",
        "summary": [
          { "number": "exact from proposal", "label": "Total Duration" },
          { "number": "count of phases", "label": "Phases" }
        ],
        "phases": [
          {
            "name": "Phase name EXACTLY as in proposal",
            "label": "short label e.g. Phase 1 or Crawl",
            "duration": "exact duration from proposal",
            "description": "1-2 sentence overview of what happens in this phase",
            "outcomes": ["key outcome 1", "key outcome 2"],
            "deliverables": ["deliverable 1", "deliverable 2"]
          }
        ],
        "imageQuery": "photo search term",
        "variant": "timeline"
      }
    },
    {
      "sectionType": "pricing",
      "heading": "Investment",
      "content": {
        "eyebrow": "Investment",
        "headline": "8-12 words",
        "subheadline": "2-3 sentences linking investment to outcomes",
        "rows": [
          ["Line item name EXACTLY as in proposal", "What this covers in 1 sentence", "Exact price from proposal"],
          ["Next line item", "What it covers", "Price"]
        ],
        "totalLabel": "Total Investment: $X (exact from proposal or omit if not stated)",
        "footnote": "any payment terms, notes, or conditions from the proposal",
        "cta": "3-5 word action label",
        "imageQuery": "photo search term",
        "variant": "table"
      }
    },
    {
      "sectionType": "whyus",
      "heading": "Why Choose Us",
      "content": {
        "eyebrow": "Why Us",
        "headline": "8-12 words",
        "body": "3-4 sentences on credentials",
        "stats": [
          { "number": "non-financial metric from proposal", "label": "2-4 words", "context": "1-2 sentences" }
        ],
        "imageQuery": "photo search term",
        "variant": "editorial"
      }
    },
    {
      "sectionType": "nextsteps",
      "heading": "Next Steps",
      "content": {
        "eyebrow": "Get Started",
        "headline": "8-12 words",
        "body": "1-2 sentences CTA",
        "steps": [
          { "stepNumber": "1", "title": "step name", "description": "1-2 sentences" }
        ],
        "ctaPrimary": "action label",
        "imageQuery": "photo search term",
        "variant": "centered"
      }
    }
  ]
}

Add or remove sections based on what is actually in the proposal. Include ALL major proposal sections. Omit sections with no content in the proposal.`;
}

function buildUserPrompt(
  proposalMarkdown: string,
  brandHint: { companyName?: string; industry?: string; clientName?: string; primaryColor?: string },
  proposalId: string,
): string {
  return [
    `Generate a complete microsite AST for this proposal. Return ONLY valid JSON.`,
    ``,
    `PROPOSAL ID: ${proposalId}`,
    brandHint.clientName ? `CLIENT: ${brandHint.clientName}` : '',
    brandHint.industry   ? `INDUSTRY: ${brandHint.industry}` : '',
    brandHint.companyName ? `PROPOSING COMPANY: ${brandHint.companyName}` : '',
    brandHint.primaryColor ? `PRIMARY COLOR HINT: ${brandHint.primaryColor}` : '',
    ``,
    `PROPOSAL DOCUMENT:`,
    `---`,
    proposalMarkdown,
    `---`,
    ``,
    `Return the complete JSON AST now. Start with { and end with }. No preamble.`,
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateStructuredMicrosite(
  proposalMarkdown: string,
  brandHint: { companyName?: string; industry?: string; clientName?: string; primaryColor?: string },
  proposalId: string,
  apiKey: string,
  model: string,
): Promise<StructuredAST> {
  const t0 = Date.now();

  const _systemPrompt = buildSystemPrompt();
  const _userPrompt   = buildUserPrompt(proposalMarkdown, brandHint, proposalId);
  console.log(`[microsite-gen] Phase 1 system prompt (${_systemPrompt.length}c):\n${_systemPrompt.slice(0, 500)}...\n`);
  console.log(`[microsite-gen] Phase 1 user prompt (${_userPrompt.length}c):\n${_userPrompt.slice(0, 500)}...\n`);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system: _systemPrompt,
      messages: [{ role: 'user', content: _userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const raw  = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace  = cleaned.lastIndexOf('}');
  const jsonStr    = firstBrace !== -1 && lastBrace > firstBrace
    ? cleaned.slice(firstBrace, lastBrace + 1)
    : cleaned;

  const parsed = JSON.parse(jsonStr) as {
    meta?: Record<string, unknown>;
    brand?: Record<string, unknown>;
    brief?: Record<string, unknown>;
    sections?: Array<{ sectionType?: string; heading?: string; content?: Record<string, unknown>; id?: string }>;
  };

  // Normalise sections — add ids and image stubs
  const sections: StructuredSection[] = (parsed.sections ?? []).map((s, i) => ({
    id:          s.id ?? `${s.sectionType ?? 'section'}-${i}`,
    sectionType: s.sectionType ?? 'generic',
    heading:     s.heading ?? '',
    content:     s.content ?? {},
    image:       { source: 'gradient', query: (s.content?.imageQuery as string | undefined) ?? '', url: null },
  }));

  const ast: StructuredAST = {
    proposalId,
    generatedAt: new Date().toISOString(),
    meta:    (parsed.meta   ?? {}) as StructuredAST['meta'],
    brand:   (parsed.brand  ?? { companyName: brandHint.companyName ?? '' }) as StructuredAST['brand'],
    brief:   (parsed.brief  ?? {
      clientName: brandHint.clientName ?? '',
      clientIndustry: brandHint.industry ?? '',
      proposingCompany: brandHint.companyName ?? '',
      primaryTone: 'consultative',
      engagementSummary: '',
      keyOutcomes: [],
    }) as StructuredAST['brief'],
    sections,
  };

  console.log(`[structured-gen] Done — ${sections.length} sections, elapsed=${Date.now() - t0}ms`);
  return ast;
}

/**
 * Assign unique UUIDs to any section missing an id.
 * Called before streaming so each section event has a stable id.
 */
export function assignSectionIds(sections: StructuredSection[]): StructuredSection[] {
  const seen = new Map<string, number>();
  return sections.map(s => {
    const base  = s.sectionType;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...s, id: count === 0 ? base : `${base}-${count}` };
  });
}
