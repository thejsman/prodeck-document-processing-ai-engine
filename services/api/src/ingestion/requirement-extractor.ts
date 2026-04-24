import type {
  DocumentType,
  ExtractionResult,
  MeetingSummary,
  RequirementKey,
  RequirementField,
} from '../chat/context.types.js';
import type { PreprocessedDocument, LLMGenerateFn } from './document-preprocessor.js';
import { z } from 'zod';

const ExtractionSchema = z.object({
  clientName: z.string().optional(),
  industry: z.string().optional(),
  projectType: z.string().optional(),
  budget: z.string().optional(),
  timeline: z.string().optional(),
  teamSize: z.number().optional(),
  technicalStack: z.array(z.string()).optional(),
  keyObjectives: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  deliverables: z.array(z.string()).optional(),
  stakeholders: z.array(z.string()).optional(),
  contactName: z.string().optional(),
});

function normalizeValue(key: RequirementKey, value: unknown) {
  if (key === 'teamSize' && typeof value === 'string') {
    const num = parseInt(value.replace(/\D/g, ''), 10);
    return isNaN(num) ? undefined : num;
  }

  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }

  return value;
}

function computeFieldConfidence(value: unknown, base: number) {
  if (Array.isArray(value) && value.length === 0) return base - 0.2;
  if (typeof value === 'string' && value.length < 3) return base - 0.2;
  return base;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_REQUIREMENT_KEYS: RequirementKey[] = [
  'clientName',
  'industry',
  'projectType',
  'budget',
  'timeline',
  'teamSize',
  'technicalStack',
  'keyObjectives',
  'constraints',
  'deliverables',
  'stakeholders',
  'contactName',
];

// Spec section 3.5 — confidence per document type (must match exactly)
const CONFIDENCE_BY_DOC_TYPE: Record<DocumentType, number> = {
  rfp: 0.85,
  technical_spec: 0.85,
  meeting_transcript: 0.6,
  email: 0.7,
  proposal_draft: 0.75,
  generic: 0.65,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJSON<T>(raw: string): T | null {
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * Extracts structured requirement fields from a preprocessed document.
 * Takes PreprocessedDocument (NOT raw content) — noise has already been removed.
 * Confidence is capped by document type per spec section 3.5.
 *
 * For meeting transcripts, runs an additional pass to produce a rich
 * MeetingSummary (agenda, priorities, MoSCoW requirements, deliverables,
 * engagement model) and promotes relevant fields into the structured layer.
 */
export async function extractRequirementsFromPreprocessed(
  preprocessed: PreprocessedDocument,
  docType: DocumentType,
  llmFn: LLMGenerateFn,
): Promise<ExtractionResult> {
  const cleanContent = preprocessed.sections
    .map((s) => `## ${s.topic}\n${s.summary}\nFacts: ${s.keyFacts.join('; ')}\nDecisions: ${s.decisions.join('; ')}`)
    .join('\n\n');

  const participantContext =
    preprocessed.participants?.map((p) => `${p.name} — ${p.role} at ${p.organization} (${p.inferredFrom})`).join('\n') ??
    'No participants identified';

  const baseConfidence = CONFIDENCE_BY_DOC_TYPE[docType];

  const prompt = `
You are an information extraction system.

Extract ONLY explicitly stated facts from the document.
DO NOT infer, guess, or assume missing values.

Return STRICT JSON only. No explanations.

Schema:
{
  "clientName": string,
  "industry": string,
  "projectType": string,
  "budget": string,
  "timeline": string,
  "teamSize": number,
  "technicalStack": string[],
  "keyObjectives": string[],
  "constraints": string[],
  "deliverables": string[],
  "stakeholders": string[],
  "contactName": string
}

Rules:
- Omit fields not present
- teamSize MUST be a number (not text)
- Arrays MUST be arrays (not comma-separated strings)
- If unsure, omit the field
- DO NOT hallucinate

Participants:
${participantContext}

Content:
${cleanContent}

Return JSON only:
`;

  let raw = '';
  try {
    raw = await llmFn(prompt);
  } catch (err) {
    console.warn('[RequirementExtractor] LLM call failed:', err);
    return { fields: {}, knowledge: [], raw: '' };
  }

  let parsed = safeParseJSON(raw);

  if (!parsed) {
    const retryPrompt = prompt + '\n\nFix your output. Return valid JSON only.';
    try {
      raw = await llmFn(retryPrompt);
    } catch {
      // ignore retry failure, fall through to empty result
    }
    parsed = safeParseJSON(raw);
  }

  const validated = ExtractionSchema.safeParse(parsed);

  const fields: ExtractionResult['fields'] = {};
  const now = new Date().toISOString();

  if (validated.success) {
    for (const [key, value] of Object.entries(validated.data)) {
      if (!VALID_REQUIREMENT_KEYS.includes(key as RequirementKey)) continue;

      const normalized = normalizeValue(key as RequirementKey, value);
      if (normalized === undefined) continue;

      fields[key as RequirementKey] = {
        value: normalized,
        confidence: computeFieldConfidence(normalized, baseConfidence),
        source: 'document',
        updatedAt: now,
      };
    }
  }

  // For meeting transcripts, run an additional pass to extract a rich
  // MeetingSummary (agenda, priorities with bullets, MoSCoW requirements,
  // agency deliverables, engagement model) and promote any missing core
  // fields from it.
  let meetingSummary: MeetingSummary | undefined;
  if (docType === 'meeting_transcript' && preprocessed.sections.length > 0) {
    meetingSummary = await extractMeetingSummary(
      preprocessed,
      cleanContent,
      participantContext,
      now,
      llmFn,
    );

    if (meetingSummary) {
      promoteMeetingSummaryFields(meetingSummary, fields, baseConfidence, now);
    }
  }

  return { fields, knowledge: [], meetingSummary, raw };
}

// ---------------------------------------------------------------------------
// Meeting summary extractor
// ---------------------------------------------------------------------------

const MeetingSummarySchema = z.object({
  clientOrganization: z
    .object({
      name: z.string(),
      industry: z.string().optional(),
      roles: z.array(z.string()).default([]),
    })
    .optional(),
  agencyOrganization: z
    .object({
      name: z.string(),
      services: z.array(z.string()).optional(),
    })
    .optional(),
  agenda: z
    .array(
      z.object({
        title: z.string(),
        keyTakeaways: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  clientPriorities: z
    .array(
      z.object({
        rank: z.number(),
        title: z.string(),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  requirementsByPriority: z
    .object({
      must: z.array(z.string()).default([]),
      should: z.array(z.string()).default([]),
      could: z.array(z.string()).default([]),
    })
    .optional(),
  agencyDeliverables: z
    .array(
      z.object({
        owner: z.string(),
        deliverable: z.string(),
        deadline: z.string().optional(),
      }),
    )
    .optional(),
  engagementModel: z
    .object({
      approach: z.string(),
      phases: z.array(z.string()).default([]),
      pricingStructure: z.string().optional(),
    })
    .optional(),
  businessMetrics: z
    .array(
      z.object({
        metric: z.string(),
        value: z.string(),
        context: z.string(),
      }),
    )
    .optional(),
});

async function extractMeetingSummary(
  preprocessed: PreprocessedDocument,
  cleanContent: string,
  participantContext: string,
  now: string,
  llmFn: LLMGenerateFn,
): Promise<MeetingSummary | undefined> {
  const existingAgenda = preprocessed.sections
    .map((s, i) => `${i + 1}. ${s.topic}`)
    .join('\n');

  const existingActionItems = preprocessed.actionItems
    .map((a) => `- ${a.owner}: ${a.action}${a.deadline ? ` (by ${a.deadline})` : ''}`)
    .join('\n') || '(none captured)';

  const prompt = `
You are producing a structured dossier from a client discovery / sales meeting.

Use the preprocessed sections below as ground truth. Do NOT invent facts that are
not present in the source material.

Return STRICT JSON matching this schema exactly:
{
  "clientOrganization": { "name": "...", "industry": "...", "roles": ["CEO", "Co-founder", ...] },
  "agencyOrganization": { "name": "...", "services": ["branding", "SEO", ...] },
  "agenda": [
    { "title": "Introductions & Context Setting", "keyTakeaways": ["...", "..."] }
  ],
  "clientPriorities": [
    { "rank": 1, "title": "Content Capture Program", "bullets": ["On-site project shoots", "Case study videos", "20-30 professional photos per project"] }
  ],
  "requirementsByPriority": {
    "must": ["specific requirement the client explicitly said they need"],
    "should": ["specific requirement the client explicitly said they want"],
    "could": ["specific requirement mentioned as nice-to-have or future"]
  },
  "agencyDeliverables": [
    { "owner": "Agency name", "deliverable": "specific thing they committed to bring back", "deadline": "within 2 weeks" }
  ],
  "engagementModel": {
    "approach": "e.g. phased crawl-walk-run, retainer plus project, etc.",
    "phases": ["Crawl: ...", "Walk: ...", "Run: ..."],
    "pricingStructure": "retainer + project blend, fixed fee per shoot, etc."
  },
  "businessMetrics": [
    { "metric": "cost per content shoot", "value": "$3,000-$3,500", "context": "previous vendor pricing" }
  ]
}

Rules for each field:
- clientOrganization: the party asking for services. "roles" lists the client-side participants' roles.
- agencyOrganization: the party offering services.
- agenda: one item per major discussion topic. Reuse the preprocessed section titles where possible. keyTakeaways are 2-5 short bullets summarizing what was decided / discovered in that topic.
- clientPriorities: one entry per explicitly ranked / numbered priority (Priority 1, Priority 2, ...). "bullets" contain the specific sub-items the client listed under that priority (e.g. deliverables, characteristics, quantities).
- requirementsByPriority: bucket every stated requirement as must / should / could. "must" = the client said they need it. "should" = they said they want it. "could" = nice-to-have, future, or briefly mentioned.
- agencyDeliverables: every item the agency committed to send or produce after the meeting.
- engagementModel: only include if the parties discussed how the work would be structured (phases, retainer, etc.). If not discussed, omit the entire field.
- businessMetrics: every concrete number (dollars, counts, percentages, traffic, headcount, timelines expressed as durations).

Omit any optional field that has no content. Return an empty object {} rather than hallucinating.

Preprocessed agenda (section titles):
${existingAgenda}

Preprocessed action items:
${existingActionItems}

Participants:
${participantContext}

Preprocessed sections:
${cleanContent}

Return JSON only:
`;

  let raw = '';
  try {
    raw = await llmFn(prompt);
  } catch (err) {
    console.warn('[RequirementExtractor] Meeting summary LLM call failed:', err);
    return undefined;
  }

  const parsed = safeParseJSON(raw);
  const validated = MeetingSummarySchema.safeParse(parsed);
  if (!validated.success) {
    console.warn('[RequirementExtractor] Meeting summary failed validation:', validated.error.errors[0]?.message);
    return undefined;
  }

  const data = validated.data;
  const summary: MeetingSummary = { updatedAt: now };

  if (data.clientOrganization) summary.clientOrganization = data.clientOrganization;
  if (data.agencyOrganization) summary.agencyOrganization = data.agencyOrganization;
  if (data.agenda?.length) summary.agenda = data.agenda;
  if (data.clientPriorities?.length) summary.clientPriorities = data.clientPriorities;
  if (data.requirementsByPriority) {
    const r = data.requirementsByPriority;
    if (r.must.length || r.should.length || r.could.length) {
      summary.requirementsByPriority = r;
    }
  }
  if (data.agencyDeliverables?.length) summary.agencyDeliverables = data.agencyDeliverables;
  if (data.engagementModel) summary.engagementModel = data.engagementModel;
  if (data.businessMetrics?.length) summary.businessMetrics = data.businessMetrics;

  return summary;
}

// ---------------------------------------------------------------------------
// Promote meeting summary fields into the structured requirement layer
// ---------------------------------------------------------------------------

function promoteField<T>(
  fields: ExtractionResult['fields'],
  key: RequirementKey,
  value: T,
  baseConfidence: number,
  now: string,
): void {
  if (fields[key]) return; // don't overwrite a value the first pass already extracted
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  if (typeof value === 'string' && value.trim() === '') return;

  fields[key] = {
    value: value as unknown,
    confidence: computeFieldConfidence(value, baseConfidence),
    source: 'document',
    updatedAt: now,
  } as RequirementField<unknown>;
}

function promoteMeetingSummaryFields(
  summary: MeetingSummary,
  fields: ExtractionResult['fields'],
  baseConfidence: number,
  now: string,
): void {
  if (summary.clientOrganization?.name) {
    promoteField(fields, 'clientName', summary.clientOrganization.name, baseConfidence, now);
  }
  if (summary.clientOrganization?.industry) {
    promoteField(fields, 'industry', summary.clientOrganization.industry, baseConfidence, now);
  }
  if (summary.clientOrganization?.roles?.length) {
    promoteField(fields, 'stakeholders', summary.clientOrganization.roles, baseConfidence, now);
  }
  if (summary.agencyDeliverables?.length) {
    promoteField(
      fields,
      'deliverables',
      summary.agencyDeliverables.map((d) => d.deliverable),
      baseConfidence,
      now,
    );
  }
  if (summary.clientPriorities?.length) {
    promoteField(
      fields,
      'keyObjectives',
      summary.clientPriorities.map((p) => p.title),
      baseConfidence,
      now,
    );
  }
}
