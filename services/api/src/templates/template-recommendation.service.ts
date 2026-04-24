/**
 * Template Recommendation Engine — intelligent template selection.
 *
 * Scores available templates against RFP context using a multi-signal
 * algorithm:
 *   1. Tag match     — keyword overlap between requirements and template tags
 *   2. Industry match — detected industry vs. template industries
 *   3. Capability overlap — needed capabilities vs. template capabilities
 *
 * When no template scores above the confidence threshold, the engine
 * sets `fallbackGenerate = true` so the workflow can generate a custom
 * section structure from scratch.
 *
 * Placement: services/templates (adapter layer) because it reads from
 * the vector store via @ai-engine/runtime and uses the template registry.
 */

import path from 'node:path';
import { searchKnowledgeChunks } from '@ai-engine/runtime';
import { listTemplates } from './template-registry.js';
import type {
  ProposalTemplate,
  RecommendationContext,
  TemplateRecommendation,
} from './template-types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum confidence to recommend an existing template. */
const CONFIDENCE_THRESHOLD = 0.35;

/** Weights for the three scoring signals. */
const WEIGHTS = {
  tagMatch: 0.45,
  industryMatch: 0.25,
  capabilityMatch: 0.30,
} as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recommend the best proposal template for the given RFP context.
 *
 * @param context   - RFP requirements, detected industry, capabilities
 * @param workdir   - server working directory (for vector store + template registry)
 * @returns recommendation with template, confidence, and reasoning
 */
export async function recommendTemplate(
  context: RecommendationContext,
  workdir: string,
): Promise<TemplateRecommendation> {
  // 1. Build a semantic query from requirements
  const semanticQuery = buildSemanticQuery(context);

  // 2. Search vector store for product docs and past proposal sections
  const capabilityKeywords = await extractCapabilityKeywords(
    semanticQuery,
    workdir,
    context.namespace,
  );

  // 3. Enrich context with extracted keywords
  const enrichedCapabilities = [
    ...(context.keyCapabilities ?? []),
    ...capabilityKeywords,
  ];

  // 4. Load all available templates
  const templates = await listTemplates(workdir, context.namespace);

  if (templates.length === 0) {
    return {
      confidence: 0,
      reasoning: 'No templates available. A custom proposal structure will be generated.',
      fallbackGenerate: true,
    };
  }

  // 5. Score each template
  const scored = templates.map((template) => ({
    template,
    score: scoreTemplate(template, context, enrichedCapabilities),
  }));

  // 6. Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  // 7. Check confidence threshold
  if (best.score < CONFIDENCE_THRESHOLD) {
    const topNames = scored.slice(0, 3).map((s) => s.template.name).join(', ');
    return {
      confidence: best.score,
      reasoning:
        `No existing template is a strong match (best score: ${(best.score * 100).toFixed(0)}%). ` +
        `Closest candidates were: ${topNames}. ` +
        `A custom proposal structure will be generated tailored to the RFP requirements.`,
      fallbackGenerate: true,
    };
  }

  // 8. Build reasoning
  const reasoning = buildReasoning(best.template, best.score, context, enrichedCapabilities);

  return {
    templateId: best.template.id,
    template: best.template,
    confidence: best.score,
    reasoning,
    fallbackGenerate: false,
  };
}

// ---------------------------------------------------------------------------
// Semantic query builder
// ---------------------------------------------------------------------------

function buildSemanticQuery(context: RecommendationContext): string {
  const parts: string[] = [];

  const { requirementMatrix } = context;

  if (requirementMatrix.functional.length > 0) {
    parts.push(requirementMatrix.functional.slice(0, 5).join(' '));
  }
  if (requirementMatrix.compliance.length > 0) {
    parts.push(requirementMatrix.compliance.slice(0, 3).join(' '));
  }
  if (context.detectedIndustry) {
    parts.push(context.detectedIndustry);
  }
  if (context.keyCapabilities && context.keyCapabilities.length > 0) {
    parts.push(context.keyCapabilities.join(' '));
  }

  // Fallback if we have very little context
  if (parts.length === 0) {
    parts.push('proposal template requirements capabilities');
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Capability extraction from vector store
// ---------------------------------------------------------------------------

async function extractCapabilityKeywords(
  query: string,
  workdir: string,
  namespace: string,
): Promise<string[]> {
  const storageDir = path.join(workdir, 'namespaces', namespace);

  try {
    const result = await searchKnowledgeChunks({
      question: query,
      storageDir,
      namespace,
      topK: 10,
    });

    // Extract meaningful keywords from chunk text
    const allText = result.chunks.map((c) => c.text).join(' ').toLowerCase();
    return extractKeywords(allText);
  } catch {
    // Vector store unavailable — return empty (non-fatal)
    return [];
  }
}

/**
 * Extract capability-like keywords from raw text.
 * Filters for multi-word terms and technical vocabulary.
 */
function extractKeywords(text: string): string[] {
  const CAPABILITY_PATTERNS = [
    'cloud', 'migration', 'kubernetes', 'docker', 'aws', 'azure', 'gcp',
    'security', 'compliance', 'encryption', 'authentication', 'sso',
    'api', 'microservices', 'serverless', 'devops', 'ci-cd', 'ci/cd',
    'data', 'analytics', 'machine-learning', 'ai', 'etl', 'pipeline',
    'saas', 'platform', 'scalability', 'high-availability',
    'monitoring', 'logging', 'observability', 'alerting',
    'automation', 'integration', 'transformation', 'modernization',
    'mobile', 'web', 'frontend', 'backend', 'full-stack',
    'database', 'postgresql', 'mongodb', 'redis', 'elasticsearch',
    'networking', 'vpn', 'firewall', 'load-balancer',
    'agile', 'scrum', 'project-management',
    'sla', 'support', 'managed-services', 'incident-management',
    'penetration-testing', 'vulnerability', 'soc', 'siem',
  ];

  const found: string[] = [];
  for (const kw of CAPABILITY_PATTERNS) {
    if (text.includes(kw)) {
      found.push(kw);
    }
  }

  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Template scoring
// ---------------------------------------------------------------------------

function scoreTemplate(
  template: ProposalTemplate,
  context: RecommendationContext,
  enrichedCapabilities: string[],
): number {
  const tagScore = computeTagScore(template, context);
  const industryScore = computeIndustryScore(template, context);
  const capabilityScore = computeCapabilityScore(template, enrichedCapabilities);

  return (
    tagScore * WEIGHTS.tagMatch +
    industryScore * WEIGHTS.industryMatch +
    capabilityScore * WEIGHTS.capabilityMatch
  );
}

/**
 * Tag match: how many requirement keywords appear in the template tags.
 */
function computeTagScore(
  template: ProposalTemplate,
  context: RecommendationContext,
): number {
  const requirementWords = new Set<string>();

  const allRequirements = [
    ...context.requirementMatrix.functional,
    ...context.requirementMatrix.compliance,
    ...context.requirementMatrix.timeline,
    ...context.requirementMatrix.pricing,
  ];

  for (const req of allRequirements) {
    for (const word of req.toLowerCase().split(/\s+/)) {
      if (word.length > 3) requirementWords.add(word);
    }
  }

  if (requirementWords.size === 0) return 0;

  const templateTags = new Set(template.tags.map((t) => t.toLowerCase()));
  let matches = 0;

  for (const word of requirementWords) {
    for (const tag of templateTags) {
      if (word.includes(tag) || tag.includes(word)) {
        matches++;
        break;
      }
    }
  }

  return Math.min(matches / Math.max(templateTags.size, 1), 1);
}

/**
 * Industry match: exact match = 1, partial = 0.5, no match = 0.
 */
function computeIndustryScore(
  template: ProposalTemplate,
  context: RecommendationContext,
): number {
  if (!context.detectedIndustry || !template.industries?.length) return 0.3; // neutral

  const detected = context.detectedIndustry.toLowerCase();
  const industries = template.industries.map((i) => i.toLowerCase());

  if (industries.includes(detected)) return 1;
  if (industries.some((i) => detected.includes(i) || i.includes(detected))) return 0.5;

  return 0;
}

/**
 * Capability overlap: Jaccard-like similarity between needed and offered.
 */
function computeCapabilityScore(
  template: ProposalTemplate,
  enrichedCapabilities: string[],
): number {
  if (!template.capabilities?.length || enrichedCapabilities.length === 0) return 0.2; // neutral

  const needed = new Set(enrichedCapabilities.map((c) => c.toLowerCase()));
  const offered = new Set(template.capabilities.map((c) => c.toLowerCase()));

  let matches = 0;
  for (const cap of needed) {
    for (const off of offered) {
      if (cap.includes(off) || off.includes(cap)) {
        matches++;
        break;
      }
    }
  }

  const union = new Set([...needed, ...offered]).size;
  return union > 0 ? matches / union : 0;
}

// ---------------------------------------------------------------------------
// Reasoning builder
// ---------------------------------------------------------------------------

function buildReasoning(
  template: ProposalTemplate,
  score: number,
  context: RecommendationContext,
  enrichedCapabilities: string[],
): string {
  const parts: string[] = [];

  parts.push(
    `I recommend using the **${template.name}** template (${(score * 100).toFixed(0)}% match).`,
  );

  // Tag rationale
  const matchedTags = template.tags.filter((tag) => {
    const allText = [
      ...context.requirementMatrix.functional,
      ...context.requirementMatrix.compliance,
    ].join(' ').toLowerCase();
    return allText.includes(tag.toLowerCase());
  });

  if (matchedTags.length > 0) {
    parts.push(
      `It aligns with the RFP's focus on ${matchedTags.slice(0, 4).join(', ')}.`,
    );
  }

  // Industry rationale
  if (context.detectedIndustry && template.industries?.length) {
    const industryMatch = template.industries.some(
      (i) => i.toLowerCase() === context.detectedIndustry?.toLowerCase(),
    );
    if (industryMatch) {
      parts.push(`This template is designed for the ${context.detectedIndustry} industry.`);
    }
  }

  // Capability rationale
  if (template.capabilities && enrichedCapabilities.length > 0) {
    const capOverlap = template.capabilities.filter((c) =>
      enrichedCapabilities.some(
        (ec) => ec.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(ec.toLowerCase()),
      ),
    );
    if (capOverlap.length > 0) {
      parts.push(
        `It covers key capabilities: ${capOverlap.slice(0, 4).join(', ')}.`,
      );
    }
  }

  // Structure summary
  parts.push(
    `The template includes ${template.structure.length} sections: ${template.structure.slice(0, 5).join(', ')}${template.structure.length > 5 ? ', and more' : ''}.`,
  );

  return parts.join(' ');
}
