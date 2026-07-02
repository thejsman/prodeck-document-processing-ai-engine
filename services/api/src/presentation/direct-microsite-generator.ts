/**
 * direct-microsite-generator.ts
 *
 * Single-pass microsite generation: reads the entire proposal and generates
 * a complete standalone HTML document in ONE LLM call — no multi-step AST
 * pipeline, no intermediate transformations.
 *
 * Two entry points:
 *   generateMicrositeDirectly  — non-streaming, returns full HTML string
 *   generateMicrositeStream    — streaming, calls onChunk per delta
 */

// Post-processing: replace em dashes the LLM generates despite being told not to.
// " — " (spaced) → ", "  |  bare "—" → "-"
function stripEmDashes(s: string): string {
  return s.replace(/ — /g, ', ').replace(/—/g, '-');
}

// ---------------------------------------------------------------------------
// Pre-pass: pure regex extraction — no LLM, no I/O
// ---------------------------------------------------------------------------

export interface ProposalMeta {
  sectionCount:    number;
  workstreamCount: number;
  clientName:      string;
  industry:        string;
  date:            string;
  hasPricing:      boolean;
  hasTimeline:     boolean;
  hasWhyUs:        boolean;
}

export function extractProposalMeta(markdown: string): ProposalMeta {
  return {
    sectionCount:    (markdown.match(/^## /gm) ?? []).length,
    workstreamCount: (markdown.match(/^### \d+\./gm) ?? []).length,
    clientName:      markdown.match(/(?:Client|Prepared for):\s*\*\*?(.+?)\*\*?\n/i)?.[1]?.trim() ?? '',
    industry:        markdown.match(/Industry:\s*\*\*?(.+?)\*\*?\n/i)?.[1]?.trim() ?? '',
    date:            markdown.match(/Date:\s*\*\*?(.+?)\*\*?\n/i)?.[1]?.trim() ?? '',
    hasPricing:      /^## (?:Investment|Budget|Pricing)/im.test(markdown),
    hasTimeline:     /^## (?:Project Timeline|Timeline|Phases)/im.test(markdown),
    hasWhyUs:        /^## (?:Why Choose Us|Why Us|About Us|Credentials)/im.test(markdown),
  };
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(): string {
  return `You are an expert frontend developer and designer specialising in proposal microsites. You generate complete, production-ready single-file HTML microsites directly from proposal documents.

CORE RULES:
- Read the ENTIRE proposal document before writing a single line of HTML
- Use the proposal's OWN language for headlines — scan the Executive Summary for strong outcome phrases and use them verbatim (e.g. "turn browsers into bookers")
- Every ## heading in the proposal MUST become a section in the microsite — never skip sections
- Never fabricate content, stats, or claims not present in the proposal
- Only include stats you can directly COUNT from the document (count workstreams, phases, named audiences, deliverables)
- Choose a design theme based on the client's industry context:
  · Family / recreation / parks / trampoline / playground → warm light editorial (light background, earthy or vibrant accent, approachable sans-serif fonts)
  · B2B professional services / consulting → clean editorial, neutral palette, confident typography
  · Tech / SaaS / platform → dark or minimal, geometric fonts
  · Luxury / high-end → refined serif, minimal layout, premium palette
  · NEVER use dark neon / cyberpunk / retro-futuristic for family or recreation brands
- Generate the COMPLETE HTML in ONE response — no placeholders, no TODO comments, no incomplete sections

DESIGN RULES:
- Use Google Fonts — pick distinctive fonts appropriate for the industry (never Inter, Roboto, Arial, Space Grotesk)
- Use CSS custom properties (--color-*, --font-*, etc.) on :root for all colours and spacing
- CRITICAL: Your :root block MUST define ALL of the following variable names exactly — never hardcode these values in selectors, always reference the variable:
  --color-bg (page background), --color-surface (card/section background), --color-text (body text), --color-heading (heading text), --color-accent (primary brand color), --font-heading (heading font-family with fallback), --font-body (body font-family with fallback), --radius (border-radius for cards/buttons)
- Sticky nav with smooth scroll to each section; highlight active section on scroll
- Scroll-reveal animations using IntersectionObserver (vanilla JS, no external libraries)
- All sections must have: eyebrow label + headline + body paragraph + visual element (cards / list / table / timeline)
- Body text minimum 16px; section lead paragraphs 17–18px, max-width 640px
- Mobile responsive with proper breakpoints (min 320px, up to 1440px)
- Sharp borders (border-radius: 0–4px) for corporate / professional; rounded (8–16px) for friendly / family brands
- No external JS libraries — vanilla JS only; no <script src="..."> for frameworks

CONTENT RULES:
- Hero headline: extract the strongest outcome phrase from the Executive Summary (the phrase a client would highlight)
- Hero subheadline: use the engagement summary sentence from the proposal
- Stats: ONLY use numbers you can count in the document — never invent metrics
- Scope / deliverables section: card-grid with FULL deliverable descriptions per workstream — not just titles
- Timeline: show ALL phases with milestones, ownership (Agency / Client / Joint), and approval gates if stated in proposal
- Next steps: centred layout with exactly the steps described in the proposal
- Why Choose Us: list every credential and case study mentioned
- If a section heading exists in the proposal but has minimal content, render the section anyway using what IS available
- NEVER use placeholder text like "[Information not available]"
- NEVER use em dashes (—) in any text — use a comma, colon, parentheses, or rewrite the sentence

OUTPUT FORMAT:
- Start the response IMMEDIATELY with <!DOCTYPE html> — no explanation, no preamble, no markdown fences
- The HTML must be a complete, self-contained document (all CSS inline in <style>, all JS inline in <script>)
- End with </html> — do not truncate`;
}

function buildUserPrompt(
  params: DirectMicrositeParams,
  meta: ProposalMeta,
): string {
  const { brandConfig, proposalMarkdown, designStyleOverride } = params;
  const lines = [
    `Generate a complete production-ready microsite HTML for the following proposal.`,
    ``,
    `CLIENT: ${brandConfig.clientName || meta.clientName || 'the client'}`,
    `PROPOSING COMPANY: ${brandConfig.companyName}`,
    `INDUSTRY: ${brandConfig.industry || meta.industry || 'professional services'}`,
    `PRIMARY COLOR HINT: ${brandConfig.primaryColor ?? 'choose based on industry — warm and approachable for recreation, dark and minimal for tech'}`,
    ...(designStyleOverride ? [`\nDESIGN SKILL (apply this aesthetic direction — overrides all auto-selection rules above):\n${designStyleOverride}`] : []),
    ``,
    `DOCUMENT METADATA (extracted):`,
    `  - Proposal sections (h2 headings): ${meta.sectionCount}`,
    `  - Workstreams / sub-sections: ${meta.workstreamCount}`,
    `  - Has pricing section: ${meta.hasPricing}`,
    `  - Has timeline section: ${meta.hasTimeline}`,
    `  - Has "Why Choose Us" section: ${meta.hasWhyUs}`,
    `  - Document date: ${meta.date || 'not specified'}`,
    ``,
    `PROPOSAL DOCUMENT:`,
    `---`,
    proposalMarkdown,
    `---`,
    ``,
    `Generate the complete single-file HTML microsite now. Start directly with <!DOCTYPE html> — no explanation, no preamble.`,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DirectMicrositeParams {
  proposalMarkdown: string;
  brandConfig: {
    companyName: string;
    primaryColor?: string;
    industry?: string;
    clientName?: string;
  };
  /** Optional design skill aesthetic override — overrides the system prompt's auto-selection rules */
  designStyleOverride?: string;
}

interface AnthropicStreamEvent {
  type: string;
  delta?: { type: string; text?: string };
}

// ---------------------------------------------------------------------------
// Non-streaming generation
// ---------------------------------------------------------------------------

export async function generateMicrositeDirectly(
  params: DirectMicrositeParams,
  apiKey: string,
  model: string,
): Promise<{ html: string; elapsed: number }> {
  const meta = extractProposalMeta(params.proposalMarkdown);
  const t0 = Date.now();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 32000,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt(params, meta) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const html = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  if (!html.trim()) throw new Error('Anthropic returned empty response');

  return { html: stripEmDashes(html), elapsed: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Streaming generation
// ---------------------------------------------------------------------------

export async function generateMicrositeStream(
  params: DirectMicrositeParams,
  onChunk: (chunk: string) => void,
  onDone: (result: { elapsed: number }) => void,
  apiKey: string,
  model: string,
): Promise<void> {
  const meta = extractProposalMeta(params.proposalMarkdown);
  const t0 = Date.now();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 32000,
      stream: true,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildUserPrompt(params, meta) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const event = JSON.parse(payload) as AnthropicStreamEvent;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const text = event.delta.text ?? '';
          if (text) onChunk(text);
        } else if (event.type === 'message_stop') {
          onDone({ elapsed: Date.now() - t0 });
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}
