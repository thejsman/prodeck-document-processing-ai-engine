/**
 * Template Creation Workflow — state handlers.
 *
 * Interactive flow that lets users generate a bespoke proposal template from
 * an existing RFP when no stored template closely matches.
 *
 * States driven by this file:
 *   analyzing_rfp       — extract RFP requirements and stream a draft template
 *   review_template     — pause; accept approval or revision instructions
 *   generating_template — re-generate with revision notes from user
 *   name_template       — pause; capture the name the user wants to give it
 *   saving_template     — write the YAML file to disk
 *
 * All handlers share the same HandlerContext / HandlerResult contract as the
 * proposal-generation handlers so the orchestrator dispatch table is uniform.
 */

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { HandlerContext, HandlerResult } from './proposal-generation.handlers.js';
import { formatConversationForContext } from '../chat/context-builder.js';
import {
  extractRfpRequirements,
  formatRequirementMatrix,
  type RequirementMatrix,
} from '../ingestion/extract-rfp-requirements.js';
import { llmGenerateFn } from '../agent-routes.js';
import { AgentExecutor } from '../chat/agent-executor.js';

// ---------------------------------------------------------------------------
// Approval / revision detection
// ---------------------------------------------------------------------------

const APPROVAL_SIGNALS = [
  'approve',
  'approved',
  'looks good',
  'looks great',
  'perfect',
  'yes',
  'yes please',
  'go ahead',
  'save it',
  'save this',
  'that works',
  'great',
  'use this',
  'use that',
];

const REVISION_SIGNALS = [
  'revise',
  'change',
  'update',
  'modify',
  'no,',
  'not quite',
  'different',
  'add ',
  'remove ',
  'include ',
  'exclude ',
];

function detectReviewSignal(msg: string): 'APPROVED' | 'REVISE' | null {
  const lower = msg.toLowerCase().trim();
  for (const s of APPROVAL_SIGNALS) {
    if (lower === s || lower.startsWith(s + ' ') || lower.startsWith(s + ',')) {
      return 'APPROVED';
    }
  }
  for (const s of REVISION_SIGNALS) {
    if (lower.includes(s)) {
      return 'REVISE';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template YAML builder from LLM JSON output
// ---------------------------------------------------------------------------

/**
 * Escape a multiline string for safe YAML block literal (| style).
 * Returns the string with leading/trailing whitespace normalised.
 */
function yamlLiteral(value: string): string {
  return value.trim().replace(/\r\n/g, '\n');
}

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

/**
 * Convert a TemplateDraft to a YAML string that matches the existing
 * template format expected by @ai-engine/plugin-proposal-generator.
 */
function buildTemplateYaml(draft: TemplateDraft, version = '1.0'): string {
  const lines: string[] = [
    `name: ${draft.name}`,
    `version: "${version}"`,
    `description: >`,
    `  ${yamlLiteral(draft.description)}`,
    ``,
    `sections:`,
  ];

  for (const section of draft.sections) {
    lines.push(`  - title: ${section.title}`);
    lines.push(`    query: >-`);
    for (const line of yamlLiteral(section.query).split('\n')) {
      lines.push(`      ${line}`);
    }
    lines.push(`    instruction: >-`);
    for (const line of yamlLiteral(section.instruction).split('\n')) {
      lines.push(`      ${line}`);
    }
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// LLM prompt for template generation
// ---------------------------------------------------------------------------

function buildGenerationPrompt(
  matrixSummary: string,
  revisionNotes: string | undefined,
): string {
  const revisionBlock = revisionNotes
    ? [
        '',
        '## Revision instructions from user',
        revisionNotes,
      ].join('\n')
    : '';

  return [
    'You are a proposal architect. Your task is to design a reusable proposal template',
    'structure tailored to the RFP requirements below.',
    '',
    'The template must be output as a single JSON object with this exact shape:',
    '```json',
    '{',
    '  "name": "<human-readable template name>",',
    '  "description": "<one-sentence description of when to use this template>",',
    '  "sections": [',
    '    {',
    '      "title": "<section heading>",',
    '      "query": "<vector-store query to retrieve relevant content for this section>",',
    '      "instruction": "<LLM instruction for writing this section>"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    'Requirements:',
    '- Include 6–10 sections covering all major RFP requirements.',
    '- Section titles should be professional and proposal-appropriate.',
    '- Each query should be a specific search phrase (used for RAG retrieval).',
    '- Each instruction should be a clear, imperative writing directive.',
    '- Output ONLY the JSON block — no explanation, no markdown prose before or after.',
    '',
    '## RFP Requirement Matrix',
    matrixSummary,
    revisionBlock,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Parse JSON template draft from LLM output
// ---------------------------------------------------------------------------

function parseTemplateDraft(raw: string): TemplateDraft | null {
  // Extract JSON from the LLM output (may be wrapped in ```json ... ```)
  const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/) ??
    raw.match(/(\{[\s\S]*\})/);
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
// Format draft for user display
// ---------------------------------------------------------------------------

function formatDraftForDisplay(draft: TemplateDraft): string {
  const lines = [
    `**Proposed template: ${draft.name}**`,
    '',
    `_${draft.description}_`,
    '',
    '**Sections:**',
  ];
  draft.sections.forEach((s, i) => {
    lines.push(`${i + 1}. **${s.title}**`);
    lines.push(`   _${s.instruction}_`);
  });
  lines.push('');
  lines.push('---');
  lines.push('Does this look right? Say **"approve"** to save it or describe any changes you\'d like.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// analyzing_rfp
// ---------------------------------------------------------------------------

/**
 * Extract RFP requirements from the namespace vector store, run the LLM to
 * produce a draft template structure, stream it to the user, and signal
 * DRAFT_READY when done.
 */
export async function handleAnalyzingRfp(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, namespace, instance, onPhase, onChunk } = ctx;

  onPhase('Extracting RFP requirements');

  let matrix: RequirementMatrix;
  try {
    matrix = await extractRfpRequirements(workdir, namespace);
  } catch {
    return {
      message:
        'Unable to extract RFP requirements. Please make sure an RFP document has been uploaded and indexed.',
    };
  }

  instance.context.requirementMatrix = matrix;
  const matrixSummary = formatRequirementMatrix(matrix);

  onPhase('Generating template structure');

  const prompt = buildGenerationPrompt(matrixSummary, undefined);

  const executor = new AgentExecutor(llmGenerateFn);
  let rawOutput = '';

  for await (const event of executor.runStreaming({
    prompt,
    namespace,
    tools: [],
    systemPrompt: ctx.conversationContext?.systemPrompt,
    priorContext: ctx.conversationContext
      ? formatConversationForContext(ctx.conversationContext.conversationWindow)
      : undefined,
  })) {
    if (event.type === 'token') {
      onChunk(event.text);
      rawOutput += event.text;
    } else if (event.type === 'final') {
      if (!rawOutput) rawOutput = event.result.text ?? '';
    }
  }

  const draft = parseTemplateDraft(rawOutput);

  if (!draft) {
    // LLM didn't return parseable JSON — surface what we got and stop
    return {
      message:
        'I was unable to generate a structured template. Please try again or describe the sections you need.',
    };
  }

  instance.context.templateDraft = draft;

  const displayMessage = formatDraftForDisplay(draft);

  return {
    message: displayMessage,
    stateSignal: 'DRAFT_READY',
  };
}

// ---------------------------------------------------------------------------
// review_template (input state)
// ---------------------------------------------------------------------------

/**
 * Parse the user's response: approve the draft or capture revision notes
 * and signal REVISE so the generating_template state re-runs the LLM.
 */
export async function handleReviewTemplate(ctx: HandlerContext): Promise<HandlerResult> {
  const { instance, incomingMessage } = ctx;
  const draft = instance.context.templateDraft as TemplateDraft | undefined;

  if (!draft) {
    return {
      message: 'No template draft found. Let\'s start over — say "create template" to begin.',
    };
  }

  // First time entering this state (no user message yet) — already displayed draft
  if (!incomingMessage.trim()) {
    return {
      message: formatDraftForDisplay(draft),
    };
  }

  const signal = detectReviewSignal(incomingMessage);

  if (signal === 'APPROVED') {
    return {
      message:
        'Great! What would you like to name this template? (e.g. "Enterprise Security Proposal", "Cloud Migration Bid")',
      stateSignal: 'APPROVED',
    };
  }

  if (signal === 'REVISE') {
    instance.context.revisionNotes = incomingMessage;
    return {
      message: 'Got it — revising the template with your feedback…',
      stateSignal: 'REVISE',
    };
  }

  // Ambiguous — ask for clarification
  return {
    message:
      'Say **"approve"** if the template looks good, or describe what you\'d like to change.',
  };
}

// ---------------------------------------------------------------------------
// generating_template (re-generation with revision notes)
// ---------------------------------------------------------------------------

/**
 * Re-run the LLM with the original requirement matrix plus the user's
 * revision notes to produce an updated draft.
 */
export async function handleGeneratingTemplate(ctx: HandlerContext): Promise<HandlerResult> {
  const { namespace, instance, onPhase, onChunk } = ctx;

  onPhase('Revising template structure');

  const matrix = (instance.context.requirementMatrix ?? {}) as RequirementMatrix;
  const matrixSummary = formatRequirementMatrix(matrix);
  const revisionNotes = (instance.context.revisionNotes as string | undefined) ?? '';

  const prompt = buildGenerationPrompt(matrixSummary, revisionNotes);

  const executor = new AgentExecutor(llmGenerateFn);
  let rawOutput = '';

  for await (const event of executor.runStreaming({
    prompt,
    namespace,
    tools: [],
    systemPrompt: ctx.conversationContext?.systemPrompt,
    priorContext: ctx.conversationContext
      ? formatConversationForContext(ctx.conversationContext.conversationWindow)
      : undefined,
  })) {
    if (event.type === 'token') {
      onChunk(event.text);
      rawOutput += event.text;
    } else if (event.type === 'final') {
      if (!rawOutput) rawOutput = event.result.text ?? '';
    }
  }

  const draft = parseTemplateDraft(rawOutput);

  if (!draft) {
    return {
      message:
        'Revision failed to produce a valid structure. Please describe the changes again or say "approve" to keep the current draft.',
    };
  }

  instance.context.templateDraft = draft;
  instance.context.revisionNotes = undefined;

  return {
    message: formatDraftForDisplay(draft),
    stateSignal: 'DRAFT_READY',
  };
}

// ---------------------------------------------------------------------------
// name_template (input state)
// ---------------------------------------------------------------------------

/**
 * Capture the template name from the user's message.
 * Converts it to a URL-safe slug and signals NAMED.
 */
export async function handleNameTemplate(ctx: HandlerContext): Promise<HandlerResult> {
  const { instance, incomingMessage } = ctx;

  const rawName = incomingMessage.trim();

  if (!rawName) {
    return {
      message:
        'Please provide a name for the template (e.g. "Enterprise Security Proposal").',
    };
  }

  // Build slug: lowercase, replace non-alphanumeric with hyphens, collapse runs
  const slug = rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    return {
      message: 'That name could not be converted to a valid identifier. Please try a different name.',
    };
  }

  instance.context.templateSlug = slug;
  instance.context.templateDisplayName = rawName;

  // Update the draft name so the saved YAML reflects what the user typed
  const draft = instance.context.templateDraft as TemplateDraft | undefined;
  if (draft) {
    draft.name = rawName;
    instance.context.templateDraft = draft;
  }

  return {
    message: `Saving template as **"${rawName}"** (${slug}.yaml)…`,
    stateSignal: 'NAMED',
  };
}

// ---------------------------------------------------------------------------
// saving_template (tool state)
// ---------------------------------------------------------------------------

/**
 * Serialise the approved draft to YAML and write it to the templates directory.
 * On success signals DONE and surfaces a link to the Proposals page.
 */
export async function handleSavingTemplate(ctx: HandlerContext): Promise<HandlerResult> {
  const { workdir, instance, onPhase } = ctx;

  onPhase('Saving template');

  const draft = instance.context.templateDraft as TemplateDraft | undefined;
  const slug = (instance.context.templateSlug as string | undefined) ?? 'custom-template';

  if (!draft) {
    return {
      message: 'No template draft found — unable to save. Please start over.',
      stateSignal: 'DONE',
    };
  }

  const templateDir = path.join(workdir, 'data', 'templates');
  await mkdir(templateDir, { recursive: true });

  const yamlContent = buildTemplateYaml(draft);
  const filePath = path.join(templateDir, `${slug}.yaml`);

  await writeFile(filePath, yamlContent, 'utf-8');

  instance.context.savedTemplatePath = filePath;

  return {
    message: [
      `✓ Template **"${draft.name}"** saved successfully.`,
      '',
      'You can now select it in the Proposals page when generating a new proposal.',
      'Say **"Create a proposal"** to start using it.',
    ].join('\n'),
    stateSignal: 'DONE',
    actions: {
      viewProposalsUrl: '/proposals',
    },
  };
}
