// services/api/src/skills/skill-generator.ts
// AI-driven skill generation. Uses injected GenerateFn — no direct LLM access.

import type { GenerateFn } from '@ai-engine/planner';
import type { GeneratedSkill, SectionDefinition, PricingDefaults, MicrositeDefaults } from './skill.types.js';
import { GeneratedSkillSchema } from './skill.validator.js';

const MAX_PROPOSAL_CONTEXT = 8000;

function safeParseJSON<T>(raw: string): T | null {
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function parseAndValidateSkill(raw: string): GeneratedSkill {
  const parsed = safeParseJSON<unknown>(raw);
  if (!parsed) throw new Error('Failed to parse generated skill JSON');
  const result = GeneratedSkillSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Generated skill validation failed: ${result.error.message}`);
  return result.data as GeneratedSkill;
}

// ---------------------------------------------------------------------------
// Full generation from description
// ---------------------------------------------------------------------------

export async function generateSkillFromDescription(
  description: string,
  generateFn: GenerateFn,
): Promise<GeneratedSkill> {
  const prompt = `Generate a complete proposal skill based on this description:
"${description}"

Return a JSON object with EXACTLY these fields (no extra text, no markdown outside the JSON):
{
  "displayName": "Human readable name",
  "description": "1-2 sentence summary",
  "industries": ["industry1", "industry2"],
  "projectTypes": ["saas", "platform"],
  "tags": ["tag1", "tag2"],
  "toneDescription": "confident, technical, ROI-focused",
  "instructions": "## Identity\\nYou are writing...\\n\\n## Writing Rules\\n- Rule 1\\n- Rule 2\\n\\n## Industry Context\\n...",
  "sections": [
    {
      "id": "exec-summary",
      "title": "Executive Summary",
      "order": 1,
      "required": true,
      "promptHint": "Lead with the business problem. Keep under 500 words.",
      "maxWords": 500,
      "useRagContext": true,
      "ragQuery": null,
      "assetRef": null,
      "condition": null
    }
  ],
  "pricingDefaults": {
    "model": "tiered",
    "rates": { "senior": 250, "mid": 175, "junior": 125 },
    "tiers": [
      { "name": "MVP", "description": "Core features", "priceRange": "$40k-60k", "features": ["Feature 1", "Feature 2"], "duration": "8-10 weeks" }
    ],
    "discounts": ["10% annual commitment"],
    "currency": "USD"
  },
  "micrositeDefaults": {
    "theme": "Obsidian Luxury",
    "primaryColor": "#1a3a5c",
    "secondaryColor": "#c8a96e"
  },
  "suggestedAssets": [
    { "fileName": "compliance-framework.md", "description": "Compliance boilerplate", "content": "# Compliance\\n..." }
  ]
}

Rules:
- Include 5-9 sections covering the proposal structure needed for this skill
- Instructions should be 200-400 words covering identity, writing rules, industry context, and anti-patterns
- Make all content specific to the described use case, not generic
- Section IDs must be kebab-case (lowercase letters, numbers, hyphens only)`;

  const raw = await generateFn(prompt);
  return parseAndValidateSkill(raw);
}

// ---------------------------------------------------------------------------
// Generation from existing proposal
// ---------------------------------------------------------------------------

export async function generateSkillFromProposal(
  proposalContent: string,
  generateFn: GenerateFn,
): Promise<GeneratedSkill> {
  const truncated = proposalContent.length > MAX_PROPOSAL_CONTEXT
    ? proposalContent.slice(0, MAX_PROPOSAL_CONTEXT) + '\n\n[...truncated for context length...]'
    : proposalContent;

  const prompt = `Analyze this proposal and reverse-engineer a reusable skill from it.
Extract the section structure, writing tone, pricing model, compliance patterns, and reusable boilerplate.
The skill should be general enough to apply to similar clients in the same industry, but specific enough
to capture the expertise shown in this proposal.

Proposal:
---
${truncated}
---

Return a JSON object with EXACTLY these fields (no extra text):
{
  "displayName": "Name based on the proposal's industry/focus",
  "description": "1-2 sentence summary of what this skill is for",
  "industries": ["detected industry"],
  "projectTypes": ["detected project type"],
  "tags": ["relevant", "tags"],
  "toneDescription": "detected tone from the proposal",
  "instructions": "## Identity\\n...\\n\\n## Writing Rules\\n...\\n\\n## Industry Context\\n...",
  "sections": [
    {
      "id": "section-id",
      "title": "Section Title",
      "order": 1,
      "required": true,
      "promptHint": "Inferred from section content",
      "maxWords": null,
      "useRagContext": true,
      "ragQuery": null,
      "assetRef": null,
      "condition": null
    }
  ],
  "pricingDefaults": null,
  "micrositeDefaults": { "theme": "Obsidian Luxury", "primaryColor": "#1a1a1a" },
  "suggestedAssets": []
}`;

  const raw = await generateFn(prompt);
  return parseAndValidateSkill(raw);
}

// ---------------------------------------------------------------------------
// Per-tab AI assist
// ---------------------------------------------------------------------------

export async function applyTabAssist(
  tab: 'overview' | 'sections' | 'instructions' | 'pricing' | 'branding',
  currentContent: unknown,
  instruction: string,
  generateFn: GenerateFn,
): Promise<Partial<GeneratedSkill>> {
  let prompt: string;

  switch (tab) {
    case 'overview':
      prompt = `You are modifying the overview fields of a proposal skill.
Current overview: ${JSON.stringify(currentContent, null, 2)}
Instruction: "${instruction}"

Return ONLY a JSON object with any of these fields you are modifying:
{ "displayName": "...", "description": "...", "industries": [...], "projectTypes": [...], "tags": [...], "toneDescription": "..." }`;
      break;

    case 'sections':
      prompt = `You are modifying the sections list of a proposal skill.
Current sections: ${JSON.stringify(currentContent, null, 2)}
Instruction: "${instruction}"

Return ONLY a JSON object: { "sections": [ ...full updated sections list... ] }
Each section must have: id (kebab-case), title, order (integer), required (bool), promptHint, useRagContext (bool).
Optional: maxWords, minWords, assetRef, ragQuery, condition.`;
      break;

    case 'instructions':
      prompt = `You are modifying the writing instructions (markdown) for a proposal skill.
Current instructions:
---
${currentContent}
---
Instruction: "${instruction}"

Return ONLY a JSON object: { "instructions": "...full updated markdown instructions..." }`;
      break;

    case 'pricing':
      prompt = `You are modifying the pricing defaults for a proposal skill.
Current pricing: ${JSON.stringify(currentContent, null, 2)}
Instruction: "${instruction}"

Return ONLY a JSON object: { "pricingDefaults": { "model": "hourly|fixed|tiered|retainer", "rates": {...}, "tiers": [...], "discounts": [...], "currency": "USD" } }`;
      break;

    case 'branding':
      prompt = `You are modifying the microsite/branding defaults for a proposal skill.
Current branding: ${JSON.stringify(currentContent, null, 2)}
Instruction: "${instruction}"

Return ONLY a JSON object: { "micrositeDefaults": { "theme": "...", "primaryColor": "#rrggbb", "secondaryColor": "#rrggbb", "tagline": "..." } }`;
      break;
  }

  const raw = await generateFn(prompt);
  const parsed = safeParseJSON<Partial<GeneratedSkill>>(raw);
  if (!parsed) throw new Error('Failed to parse tab assist response');

  // Validate the returned partial against what we expect per tab
  if (tab === 'sections' && parsed.sections) {
    // Normalize null fields to undefined so they pass validation
    parsed.sections = (parsed.sections as SectionDefinition[]).map((s) => ({
      ...s,
      maxWords: s.maxWords ?? undefined,
      minWords: s.minWords ?? undefined,
      assetRef: s.assetRef ?? undefined,
      ragQuery: s.ragQuery ?? undefined,
      condition: s.condition ?? undefined,
      useRagContext: s.useRagContext ?? false,
    }));
  }

  if (tab === 'pricing' && parsed.pricingDefaults) {
    const pd = parsed.pricingDefaults as PricingDefaults;
    if (!pd.currency) pd.currency = 'USD';
  }

  if (tab === 'branding' && parsed.micrositeDefaults) {
    const md = parsed.micrositeDefaults as MicrositeDefaults;
    // Validate hex colors — reset if invalid
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    if (md.primaryColor && !hexRe.test(md.primaryColor)) delete md.primaryColor;
    if (md.secondaryColor && !hexRe.test(md.secondaryColor)) delete md.secondaryColor;
  }

  return parsed;
}
