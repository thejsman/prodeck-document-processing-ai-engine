// services/api/src/chat/client-data-handler.ts
//
// Handles the CLIENT_DATA_COLLECTION intent — the core of the smart
// client data collection module.
//
// Responsibilities:
//   1. Assess what data has been collected so far (base + industry fields)
//   2. Determine what's still missing, prioritized by importance
//   3. Generate contextual questions (not a generic form)
//   4. Process URL scraping requests
//   5. Summarize collection progress
//
// This handler is called from the response builder when the intent is
// CLIENT_DATA_COLLECTION. It never modifies the pipeline flow — it only
// produces response text and action cards.

import type { NamespaceContext, RequirementKey } from './context.types.js';
import type { ExtractionResult } from './context.types.js';
import type { ChatResponse } from './response-builder.js';
import type { ToolName } from './planner.js';
import {
  getActiveSchema,
  computeIndustryCompleteness,
  getNextQuestions,
  type IndustryField,
} from './industry-schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CollectionStatus {
  /** Base fields (the 12 RequirementKeys) */
  baseFieldsFilled: string[];
  baseFieldsMissing: string[];
  /** Industry-specific custom fields */
  industryFieldsFilled: string[];
  industryFieldsMissing: IndustryField[];
  /** Overall readiness */
  industryDetected: boolean;
  industryName: string | null;
  engagementType: string | null;
  /** Completeness scores */
  baseCompleteness: number;
  industryCompleteness: number;
  overallCompleteness: number;
  /** Whether we have enough to generate a proposal */
  proposalReady: boolean;
  /** Has branding been collected */
  hasBranding: boolean;
}

// ---------------------------------------------------------------------------
// Base field definitions (the 12 core RequirementKeys with labels)
// ---------------------------------------------------------------------------

const BASE_FIELD_LABELS: Record<RequirementKey, string> = {
  clientName: 'Client name',
  clientIndustry: 'Client industry',
  projectType: 'Project/service type',
  budget: 'Budget',
  timeline: 'Timeline',
  teamSize: 'Team size',
  technicalStack: 'Technical stack',
  keyObjectives: 'Key objectives',
  constraints: 'Constraints',
  deliverables: 'Deliverables',
  stakeholders: 'Stakeholders',
  contactName: 'Contact name',
};

const BASE_REQUIRED: RequirementKey[] = ['clientName', 'clientIndustry', 'projectType'];
const BASE_IMPORTANT: RequirementKey[] = ['budget', 'timeline', 'keyObjectives', 'contactName', 'deliverables'];

// ---------------------------------------------------------------------------
// Collection status assessment
// ---------------------------------------------------------------------------

export function assessCollectionStatus(context: NamespaceContext | null): CollectionStatus {
  const fields = context?.requirements?.fields ?? {};
  const customFields = context?.requirements?.customFields ?? {};
  const industryId = context?.industryContext?.industryId ?? null;
  const engagementType = context?.engagementType ?? null;

  // Base fields
  const allBaseKeys = Object.keys(BASE_FIELD_LABELS) as RequirementKey[];
  const baseFieldsFilled = allBaseKeys.filter(k => {
    const f = fields[k];
    return f?.value !== undefined && f?.value !== null && f?.value !== '';
  });
  const baseFieldsMissing = allBaseKeys.filter(k => !baseFieldsFilled.includes(k));

  // Industry fields
  const industryDetected = industryId !== null;
  let industryName: string | null = null;
  let industryFieldsFilled: string[] = [];
  let industryFieldsMissing: IndustryField[] = [];
  let industryCompleteness = 100;

  if (industryId) {
    const schema = getActiveSchema(industryId, engagementType);
    industryName = schema.industryModule?.name ?? null;

    // Check which custom fields are filled
    const customFieldValues: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(customFields)) {
      if (field?.value !== undefined && field?.value !== null && String(field.value) !== '') {
        customFieldValues[key] = field.value;
        industryFieldsFilled.push(key);
      }
    }

    const completeness = computeIndustryCompleteness(industryId, engagementType, customFieldValues);
    industryCompleteness = completeness.score;
    industryFieldsMissing = [
      ...completeness.missingMustHave,
      ...completeness.missingShouldHave,
      ...completeness.missingNiceToHave,
    ];
  }

  // Base completeness: required fields = 60%, important = 30%, rest = 10%
  const requiredFilled = BASE_REQUIRED.filter(k => baseFieldsFilled.includes(k)).length;
  const importantFilled = BASE_IMPORTANT.filter(k => baseFieldsFilled.includes(k)).length;
  const otherKeys = allBaseKeys.filter(k => !BASE_REQUIRED.includes(k) && !BASE_IMPORTANT.includes(k));
  const otherFilled = otherKeys.filter(k => baseFieldsFilled.includes(k)).length;

  const baseCompleteness = Math.round(
    (requiredFilled / BASE_REQUIRED.length) * 60 +
    (importantFilled / BASE_IMPORTANT.length) * 30 +
    (otherKeys.length > 0 ? (otherFilled / otherKeys.length) * 10 : 10)
  );

  // Overall: 60% base, 40% industry (if detected)
  const overallCompleteness = industryDetected
    ? Math.round(baseCompleteness * 0.6 + industryCompleteness * 0.4)
    : baseCompleteness;

  // Proposal ready: all required base fields filled
  const proposalReady = BASE_REQUIRED.every(k => baseFieldsFilled.includes(k));

  return {
    baseFieldsFilled,
    baseFieldsMissing,
    industryFieldsFilled,
    industryFieldsMissing,
    industryDetected,
    industryName,
    engagementType,
    baseCompleteness,
    industryCompleteness,
    overallCompleteness,
    proposalReady,
    hasBranding: !!context?.brandingKit,
  };
}

// ---------------------------------------------------------------------------
// Response builders for CLIENT_DATA_COLLECTION
// ---------------------------------------------------------------------------

/**
 * Builds the response for a CLIENT_DATA_COLLECTION turn.
 * Analyzes what's been collected, what's missing, and generates
 * the most useful next question(s).
 */
export function buildClientDataResponse(
  context: NamespaceContext | null,
  extraction: ExtractionResult,
  userMessage: string,
): ChatResponse {
  const status = assessCollectionStatus(context);
  const requirementsUpdated = Object.keys(extraction.fields).length > 0;
  const lines: string[] = [];

  // --- Case 1: Brand new client, nothing collected yet ---
  if (status.baseFieldsFilled.length === 0) {
    return buildWelcomeResponse(requirementsUpdated);
  }

  // --- Case 2: User just provided data — acknowledge and ask next ---
  if (requirementsUpdated) {
    lines.push(buildAcknowledgment(extraction));
    lines.push('');
  }

  // --- Case 3: URL scraping request detected ---
  if (isUrlScrapeRequest(userMessage)) {
    const url = extractUrl(userMessage);
    if (url) {
      lines.push(`I'll scrape **${url}** to extract client data and branding. Processing...`);
      return {
        text: lines.join('\n'),
        actionCards: [{ type: 'scrape_url' as unknown as ToolName, label: 'Scraping website...', href: url } as any],
        requirementsUpdated,
        toolsCalled: [],
      };
    }
  }

  // --- Case 4: Industry just detected — announce the adaptive schema ---
  if (status.industryDetected && status.industryFieldsMissing.length > 0 && !requirementsUpdated) {
    lines.push(`I've identified this as a **${status.industryName}** client. I've tailored the data collection to include industry-specific fields that will make the proposal more relevant.`);
    lines.push('');
  }

  // --- Generate next questions ---
  const nextQuestions = getSmartQuestions(status, context);

  if (nextQuestions.length > 0) {
    // Add progress indicator
    lines.push(`**Collection progress: ${status.overallCompleteness}%**`);
    lines.push('');

    if (nextQuestions.length === 1) {
      lines.push(nextQuestions[0]!);
    } else {
      for (const q of nextQuestions) {
        lines.push(q);
      }
    }
  } else if (status.proposalReady) {
    // Everything important is collected
    lines.push(`**Collection progress: ${status.overallCompleteness}%** — Ready to generate!`);
    lines.push('');
    lines.push('I have enough information to generate a tailored proposal. You can:');
    lines.push('- Say **"generate proposal"** to create the proposal now');
    lines.push('- Upload additional files to enrich the context');
    lines.push('- Share the client\'s website URL for branding extraction');
    if (!status.hasBranding) {
      lines.push('- Providing the client\'s website URL would let me extract their branding for the microsite');
    }
  }

  return {
    text: lines.join('\n'),
    actionCards: [],
    requirementsUpdated,
    toolsCalled: [],
  };
}

// ---------------------------------------------------------------------------
// Smart question generation
// ---------------------------------------------------------------------------

function getSmartQuestions(
  status: CollectionStatus,
  context: NamespaceContext | null,
): string[] {
  const questions: string[] = [];

  // Priority 1: Missing required base fields
  const missingRequired = BASE_REQUIRED.filter(k => status.baseFieldsMissing.includes(k));
  if (missingRequired.length > 0) {
    const field = missingRequired[0]!;
    questions.push(getBaseFieldQuestion(field, context));
    return questions; // Ask one required field at a time
  }

  // Priority 2: Industry not yet detected — we need it for adaptive schema
  if (!status.industryDetected) {
    // clientIndustry is in BASE_REQUIRED, so if we're here it's filled
    // but detection failed. Ask for clarification.
    questions.push("I wasn't able to match the client's industry to a known vertical. Could you describe their business in a bit more detail? For example: SaaS, healthcare, real estate, e-commerce, etc.");
    return questions;
  }

  // Priority 3: Industry must-have fields
  const industryId = context?.industryContext?.industryId ?? null;
  const engagementType = context?.engagementType ?? null;
  const customFieldValues: Record<string, unknown> = {};
  if (context?.requirements?.customFields) {
    for (const [key, field] of Object.entries(context.requirements.customFields)) {
      if (field?.value) customFieldValues[key] = field.value;
    }
  }

  const nextIndustryQuestions = getNextQuestions(industryId, engagementType, customFieldValues, 2);
  if (nextIndustryQuestions.length > 0) {
    for (const field of nextIndustryQuestions) {
      questions.push(field.question);
    }
    return questions;
  }

  // Priority 4: Missing important base fields
  const missingImportant = BASE_IMPORTANT.filter(k => status.baseFieldsMissing.includes(k));
  if (missingImportant.length > 0) {
    const field = missingImportant[0]!;
    questions.push(getBaseFieldQuestion(field, context));
    return questions;
  }

  // Priority 5: Branding
  if (!status.hasBranding) {
    questions.push("Do you have the client's website URL? I can extract their branding (colors, fonts, logo) to personalize the proposal microsite.");
  }

  return questions;
}

function getBaseFieldQuestion(field: RequirementKey, context: NamespaceContext | null): string {
  const clientName = context?.requirements?.fields?.clientName?.value as string | undefined;
  const nameRef = clientName ? ` for ${clientName}` : '';

  const contextualQuestions: Record<string, string> = {
    clientName: 'What is the client or company name?',
    clientIndustry: `What industry is ${clientName ?? 'the client'} in? (e.g. healthcare, SaaS, real estate, e-commerce, legal, manufacturing)`,
    projectType: `What service are we proposing${nameRef}? (e.g. web development, digital marketing, consulting, implementation)`,
    budget: `Do you have a rough budget range${nameRef}?`,
    timeline: `What's the expected project timeline${nameRef}?`,
    keyObjectives: `What are the key objectives or goals${nameRef}?`,
    contactName: `Who is the primary contact or decision-maker${nameRef}?`,
    deliverables: `What deliverables are expected${nameRef}?`,
    teamSize: `How large is the team involved${nameRef}?`,
    technicalStack: `Is there a preferred or existing technical stack${nameRef}?`,
    constraints: `Are there any constraints or limitations we should know about${nameRef}?`,
    stakeholders: `Who are the key stakeholders${nameRef}?`,
  };

  return contextualQuestions[field] ?? `What is the ${BASE_FIELD_LABELS[field]?.toLowerCase()}?`;
}

// ---------------------------------------------------------------------------
// Acknowledgment builder
// ---------------------------------------------------------------------------

function buildAcknowledgment(extraction: ExtractionResult): string {
  const fields = Object.entries(extraction.fields);
  if (fields.length === 0) return "Got it, I've noted that.";

  if (fields.length === 1) {
    const [key, field] = fields[0]!;
    const label = BASE_FIELD_LABELS[key as RequirementKey] ?? key;
    return `Got it — **${label}** set to "${field?.value}".`;
  }

  const updates = fields
    .map(([key, field]) => {
      const label = BASE_FIELD_LABELS[key as RequirementKey] ?? key;
      return `**${label}**: ${field?.value}`;
    })
    .join(', ');

  return `Updated: ${updates}.`;
}

// ---------------------------------------------------------------------------
// Welcome response (first interaction with a new client)
// ---------------------------------------------------------------------------

function buildWelcomeResponse(requirementsUpdated: boolean): ChatResponse {
  return {
    text: [
      "Let's build the client profile for this proposal. I'll collect the information needed to generate a tailored, effective proposal.",
      '',
      'You can provide data in any of these ways:',
      '- **Upload files** — meeting transcripts, RFPs, briefs, or any client documents',
      '- **Share a URL** — paste the client\'s website and I\'ll extract their info and branding',
      '- **Tell me directly** — just type or paste client details in the chat',
      '',
      "To start, **what is the client or company name?**",
    ].join('\n'),
    actionCards: [],
    requirementsUpdated,
    toolsCalled: [],
  };
}

// ---------------------------------------------------------------------------
// URL detection helpers
// ---------------------------------------------------------------------------

function isUrlScrapeRequest(message: string): boolean {
  return /https?:\/\/[^\s]+/i.test(message) || /\b(scrape|check|visit|look\s+at|extract\s+from)\b.*\b(website|url|site|page)\b/i.test(message);
}

function extractUrl(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s,)>"']+/i);
  return match?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Progress summary (for the right panel / status check)
// ---------------------------------------------------------------------------

export function buildProgressSummary(context: NamespaceContext | null): {
  status: CollectionStatus;
  summary: string;
} {
  const status = assessCollectionStatus(context);

  const lines: string[] = [];
  lines.push(`Overall completeness: ${status.overallCompleteness}%`);
  lines.push(`Base fields: ${status.baseFieldsFilled.length}/12`);

  if (status.industryDetected) {
    lines.push(`Industry: ${status.industryName}`);
    lines.push(`Industry fields: ${status.industryCompleteness}%`);
  }

  if (status.hasBranding) {
    lines.push('Branding: collected');
  }

  if (status.proposalReady) {
    lines.push('Status: Ready to generate proposal');
  } else {
    const missing = BASE_REQUIRED.filter(k => status.baseFieldsMissing.includes(k));
    lines.push(`Blocking: ${missing.map(k => BASE_FIELD_LABELS[k]).join(', ')}`);
  }

  return { status, summary: lines.join('\n') };
}
