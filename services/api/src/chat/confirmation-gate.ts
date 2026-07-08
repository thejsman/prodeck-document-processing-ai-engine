// services/api/src/chat/confirmation-gate.ts
//
// Chat Pipeline Stage 4.5 — Confirmation Gate (pure, deterministic, no LLM
// except for fallback template generation).
//
// Runs after Readiness Check (Stage 4) and before Planner (Stage 5).
// Only active for GENERATE_PROPOSAL intent. Ensures the user has explicitly
// confirmed extracted entities and a template choice before generation runs.
//
// Gate order (sequential — each must pass before the next is checked):
//   1. confirm_entities  — clientName / industry from documents need user OK
//   2. confirm_template  — user must choose / approve the template to use

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { GenerateFn } from '@ai-engine/planner';
import type { Intent } from './intents.js';
import type { NamespaceContext, RequirementKey, SelectedTemplate } from './context.types.js';
import { recommendTemplate } from '../templates/template-recommendation.service.js';
import type { ProposalTemplate } from '../templates/template-types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EntityToConfirm {
  field: RequirementKey;
  value: string;
  source: 'document' | 'inferred';
  confidence: number;
}

export interface OptionalFieldToFill {
  field: RequirementKey;
  question: string;
}

export interface ConfirmEntitiesRequest {
  kind: 'confirm_entities';
  entities: EntityToConfirm[];
  optionalFields: OptionalFieldToFill[];
}

export interface ConfirmTemplateRequest {
  kind: 'confirm_template';
  templateId: string;
  templateName: string;
  confidence: number;
  reasoning: string;
  sections: string[];
}

export interface ApproveGeneratedTemplateRequest {
  kind: 'approve_generated_template';
  templateSlug: string;
  templateName: string;
  sections: string[];
  viewLink: string;
}

/** Raised when a big-generation intent (proposal / microsite) was recognised
 *  with low confidence and the system wants to confirm before generating. */
export interface ConfirmGenerationRequest {
  kind: 'confirm_generation';
  targetIntent: Intent;
}

export type ConfirmationRequest =
  | ConfirmEntitiesRequest
  | ConfirmTemplateRequest
  | ApproveGeneratedTemplateRequest
  | ConfirmGenerationRequest;

/** Build a confirm-generation request for an uncertain big-generation intent. */
export function buildGenerationConfirmation(targetIntent: Intent): ConfirmGenerationRequest {
  return { kind: 'confirm_generation', targetIntent };
}

export type ConfirmationGateResult =
  | { confirmed: true }
  | { confirmed: false; request: ConfirmationRequest };

// ---------------------------------------------------------------------------
// Optional-field questions (mirrors readiness-engine optional specs)
// ---------------------------------------------------------------------------

const OPTIONAL_FIELD_QUESTIONS: Partial<Record<RequirementKey, string>> = {
  projectType: 'What type of project is this? (e.g. website build, SaaS platform, migration)',
  budget: 'Do you have a rough budget range? (e.g. $50k–$100k)',
  timeline: 'What is the expected timeline? (e.g. 3 months, Q3 2026)',
};

// Entity fields that require user confirmation when sourced from documents
const ENTITY_FIELDS_TO_CONFIRM: RequirementKey[] = ['clientName', 'clientIndustry'];

// ---------------------------------------------------------------------------
// Template YAML helpers (mirrors tool-handlers.ts)
// ---------------------------------------------------------------------------

interface TemplateSectionDraft {
  title: string;
  query: string;
  instruction: string;
}

interface TemplateDraft {
  name: string;
  description: string;
  sections: TemplateSectionDraft[];
}

function buildTemplateYaml(draft: TemplateDraft): string {
  const doc = {
    name: draft.name,
    version: '1.0',
    description: draft.description.trim(),
    sections: draft.sections.map((s) => ({
      title: s.title,
      query: s.query.trim(),
      instruction: s.instruction.trim(),
    })),
  };
  return yaml.dump(doc, { lineWidth: 120, quotingType: '"', forceQuotes: false });
}

function parseTemplateDraft(raw: string): TemplateDraft | null {
  const jsonMatch =
    raw.match(/```json\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1]) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).name !== 'string' ||
      !Array.isArray((parsed as Record<string, unknown>).sections)
    ) {
      return null;
    }
    return parsed as TemplateDraft;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build RecommendationContext from NamespaceContext
// ---------------------------------------------------------------------------

function buildRecommendationContext(context: NamespaceContext): Parameters<typeof recommendTemplate>[0] {
  const fields = context.requirements?.fields ?? {};
  const knowledge = context.knowledge ?? [];

  const functional = knowledge
    .filter((k) => !k.supersededBy && ['requirement', 'priority', 'action_item'].includes(k.category))
    .map((k) => k.content)
    .slice(0, 10);

  const compliance = knowledge
    .filter((k) => !k.supersededBy && k.category === 'constraint')
    .map((k) => k.content)
    .slice(0, 5);

  const timelineValue = fields.timeline?.value as string | undefined;
  const budgetValue = fields.budget?.value as string | undefined;

  return {
    requirementMatrix: {
      functional,
      compliance,
      timeline: timelineValue ? [timelineValue] : [],
      pricing: budgetValue ? [budgetValue] : [],
    },
    detectedIndustry: fields.clientIndustry?.value as string | undefined,
    keyCapabilities: [],
    namespace: context.namespace,
  };
}

// ---------------------------------------------------------------------------
// Generate a draft template for no-match scenarios
// ---------------------------------------------------------------------------

async function generateDraftTemplate(
  context: NamespaceContext,
  workdir: string,
  generateFn: GenerateFn,
): Promise<{ slug: string; name: string; sections: string[] } | null> {
  const projectType = (context.requirements?.fields?.projectType?.value as string | undefined) ?? '';
  const clientIndustry = (context.requirements?.fields?.clientIndustry?.value as string | undefined) ?? 'general';
  const clientName = (context.requirements?.fields?.clientName?.value as string | undefined) ?? '';

  // projectType drives STRUCTURE (what we're delivering); clientIndustry drives CONTENT (who the client is)
  const serviceLabel = projectType || clientIndustry;
  const displayName = `${serviceLabel.replace(/\b\w/g, (c) => c.toUpperCase())} Proposal`;
  const description = [
    `A ${serviceLabel} proposal`,
    clientName ? ` for ${clientName}` : '',
    clientIndustry && projectType ? ` (client industry: ${clientIndustry})` : '',
    '.',
  ].join('');

  const prompt = [
    'You are a proposal architect. Generate a reusable proposal template structure.',
    '',
    `Template description: ${description}`,
    ...(projectType ? [
      '',
      `PROJECT TYPE: ${projectType}`,
      'This determines the STRUCTURE — what sections to include, what deliverables to list, what expertise to emphasise.',
    ] : []),
    ...(clientIndustry && projectType ? [
      '',
      `CLIENT INDUSTRY: ${clientIndustry}`,
      'This determines the CONTENT within each section — use industry-specific terminology and examples.',
    ] : []),
    '',
    'Output a single JSON object:',
    '```json',
    '{',
    '  "name": "<human-readable template name>",',
    '  "description": "<one-sentence description of when to use this template>",',
    '  "sections": [',
    '    {',
    '      "title": "<section heading>",',
    '      "query": "<RAG search phrase for this section>",',
    '      "instruction": "<LLM writing instruction for this section>"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Requirements:',
    `- Include 6–10 sections covering the full scope of a ${serviceLabel} engagement`,
    '- Professional, proposal-appropriate section titles',
    `- Use the display name: "${displayName}"`,
    '- Output ONLY the JSON block — no explanation',
  ].join('\n');

  let raw = '';
  try {
    raw = await generateFn(prompt);
  } catch {
    return null;
  }

  const draft = parseTemplateDraft(raw);
  if (!draft) return null;

  draft.name = displayName;

  const slug = `${context.namespace}-draft-${Date.now()}`;
  const tplDir = path.join(workdir, 'data', 'templates');

  try {
    await mkdir(tplDir, { recursive: true });
    await writeFile(path.join(tplDir, `${slug}.yaml`), buildTemplateYaml(draft), 'utf-8');
  } catch {
    return null;
  }

  return {
    slug,
    name: draft.name,
    sections: draft.sections.map((s) => s.title),
  };
}

// ---------------------------------------------------------------------------
// Check if a template file exists
// ---------------------------------------------------------------------------

async function templateFileExists(workdir: string, slug: string): Promise<boolean> {
  const filePath = path.join(workdir, 'data', 'templates', `${slug}.yaml`);
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Gate: check entities need confirmation
// ---------------------------------------------------------------------------

function checkEntitiesNeedConfirmation(
  context: NamespaceContext,
): ConfirmEntitiesRequest | null {
  const fields = context.requirements?.fields ?? {};
  const unconfirmed: EntityToConfirm[] = [];

  for (const key of ENTITY_FIELDS_TO_CONFIRM) {
    const field = fields[key];
    if (!field?.value) continue; // missing — readiness engine handles this
    if (field.confirmedByUser) continue; // already confirmed
    if (field.source === 'user' && field.confidence >= 0.85) continue; // user stated it directly

    unconfirmed.push({
      field: key,
      value: String(field.value),
      source: field.source === 'inferred' ? 'inferred' : 'document',
      confidence: field.confidence,
    });
  }

  if (unconfirmed.length === 0) return null;

  // Collect missing optional fields to surface at the same time
  const optionalFields: OptionalFieldToFill[] = [];
  for (const [key, question] of Object.entries(OPTIONAL_FIELD_QUESTIONS)) {
    const field = fields[key as RequirementKey];
    if (!field?.value) {
      optionalFields.push({ field: key as RequirementKey, question });
    }
  }

  return { kind: 'confirm_entities', entities: unconfirmed, optionalFields };
}

// ---------------------------------------------------------------------------
// Gate: check template needs confirmation
// ---------------------------------------------------------------------------

const TEMPLATE_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function checkTemplateNeedsConfirmation(
  context: NamespaceContext,
  workdir: string,
  generateFn: GenerateFn,
): Promise<ConfirmTemplateRequest | ApproveGeneratedTemplateRequest | null> {
  // Already confirmed?
  if (context.selectedTemplate) {
    const { templateId, confirmedAt } = context.selectedTemplate;

    // Verify the template file still exists
    const exists = await templateFileExists(workdir, templateId);
    if (exists) {
      // Re-ask if confirmed more than 7 days ago
      const age = Date.now() - new Date(confirmedAt).getTime();
      if (age <= TEMPLATE_FRESHNESS_MS) {
        // Re-ask if the clientIndustry changed after the template was confirmed
        const industryUpdatedAt = context.requirements?.fields?.clientIndustry?.updatedAt;
        if (!industryUpdatedAt || industryUpdatedAt <= confirmedAt) {
          return null; // Still fresh and clientIndustry unchanged
        }
      }
    }
    // File gone, stale, or clientIndustry changed — fall through to re-recommend
  }

  // Run the recommendation engine
  const recContext = buildRecommendationContext(context);
  let recommendation;
  try {
    recommendation = await recommendTemplate(recContext, workdir);
  } catch {
    // Recommendation engine failed — skip template gate, don't block generation
    return null;
  }

  if (recommendation.fallbackGenerate || !recommendation.template) {
    // No good match — generate a custom draft
    const draft = await generateDraftTemplate(context, workdir, generateFn);
    if (!draft) return null; // Failed to generate — skip gate

    return {
      kind: 'approve_generated_template',
      templateSlug: draft.slug,
      templateName: draft.name,
      sections: draft.sections,
      viewLink: `/template?artifact=${encodeURIComponent(draft.slug + '.yaml')}&namespace=${encodeURIComponent(context.namespace)}&from=chat`,
    };
  }

  const template = recommendation.template as ProposalTemplate;
  return {
    kind: 'confirm_template',
    templateId: template.id,
    templateName: template.name,
    confidence: recommendation.confidence,
    reasoning: recommendation.reasoning,
    sections: template.structure,
  };
}

// ---------------------------------------------------------------------------
// Main gate function
// ---------------------------------------------------------------------------

export async function runConfirmationGate(
  intent: Intent,
  context: NamespaceContext | null,
  workdir: string,
  generateFn?: GenerateFn,
): Promise<ConfirmationGateResult> {
  // Gate only applies to proposal generation
  if (intent !== 'GENERATE_PROPOSAL') return { confirmed: true };
  if (!context) return { confirmed: true };

  // Step 1: entity confirmation
  const entityRequest = checkEntitiesNeedConfirmation(context);
  if (entityRequest) {
    console.log(`[confirmation-gate] halted ns=${context.namespace} kind=confirm_entities fields=${entityRequest.entities.map((e) => e.field).join(',')}`);
    return { confirmed: false, request: entityRequest };
  }

  // Step 2: template confirmation (requires workdir + generateFn for fallback generation)
  if (generateFn) {
    const templateRequest = await checkTemplateNeedsConfirmation(context, workdir, generateFn);
    if (templateRequest) {
      console.log(`[confirmation-gate] halted ns=${context.namespace} kind=${templateRequest.kind}`);
      return { confirmed: false, request: templateRequest };
    }
  }

  console.log(`[confirmation-gate] passed ns=${context.namespace} template=${context.selectedTemplate?.templateId ?? 'none'}`);
  return { confirmed: true };
}

// ---------------------------------------------------------------------------
// Apply confirmation to context (called by chat-agent when user says "yes")
// ---------------------------------------------------------------------------

export function applyEntityConfirmation(
  context: NamespaceContext,
): NamespaceContext {
  const now = new Date().toISOString();
  const updated = { ...context, requirements: { ...context.requirements, fields: { ...context.requirements.fields } } };

  for (const key of ENTITY_FIELDS_TO_CONFIRM) {
    const field = updated.requirements.fields[key];
    if (field && !field.confirmedByUser) {
      updated.requirements.fields[key] = { ...field, confirmedByUser: { at: now } };
    }
  }

  updated.version += 1;
  updated.updatedAt = now;
  return updated;
}

export function applyTemplateConfirmation(
  context: NamespaceContext,
  selected: SelectedTemplate,
): NamespaceContext {
  return {
    ...context,
    selectedTemplate: selected,
    version: context.version + 1,
    updatedAt: new Date().toISOString(),
  };
}
