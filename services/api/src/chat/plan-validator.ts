// services/api/src/chat/plan-validator.ts
//
// Chat Pipeline Stage 6 — Plan Validator (deterministic, Zod-based).
//
// Validates the raw AgentPlan from the planner against strict structural
// rules and per-tool param schemas, then enforces business rules.
// Returns a ValidationResult — never throws.

import { z } from 'zod';
import type { AgentPlan } from './planner.js';

// ---------------------------------------------------------------------------
// Structural schema
// ---------------------------------------------------------------------------

const ToolNameEnum = z.enum([
  'generate_proposal',
  'generate_template',
  'modify_template',
  'generate_microsite',
  'edit_proposal_section',
  'search_documents',
  'list_proposals',
  'list_templates',
  'get_proposal_status',
  'set_proposal_status',
  'create_skill',
  'list_skills',
  'list_design_skills',
]);

const PlanSchema = z.object({
  intent: z.enum([
    'GENERATE_PROPOSAL',
    'MODIFY_PROPOSAL',
    'GENERATE_TEMPLATE',
    'MODIFY_TEMPLATE',
    'GENERATE_MICROSITE',
    'UPDATE_REQUIREMENTS',
    'QUERY',
    'STATUS_CHECK',
    'INGEST_GUIDANCE',
    'GREETING',
    'GENERAL_CHAT',
    'UNKNOWN',
    'CREATE_SKILL',
    'MODIFY_SKILL',
    'LIST_SKILLS',
    'LIST_DESIGN_SKILLS',
  ]),
  actions: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('ASK'), question: z.string().min(1).max(500) }),
        z.object({ type: z.literal('UPDATE_REQUIREMENTS'), data: z.record(z.unknown()) }),
        z.object({
          type: z.literal('CALL_TOOL'),
          tool: ToolNameEnum,
          params: z.record(z.unknown()),
        }),
        z.object({ type: z.literal('RESPOND'), message: z.string().min(1).max(8000) }),
      ]),
    )
    .min(1)
    .max(5),
});

// ---------------------------------------------------------------------------
// Per-tool parameter schemas
// ---------------------------------------------------------------------------

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

const TOOL_PARAM_SCHEMAS: Partial<Record<z.infer<typeof ToolNameEnum>, z.ZodTypeAny>> = {
  generate_proposal: z.object({
    client: z.string().min(1),
    projectType: z.string().min(1),
    clientIndustry: z.string().min(1),
    template: z.string().nullish(),
    skill: z.string().nullish(),
    teamSize: z.union([z.string(), z.number()]).nullish(),
    duration: z.union([z.string(), z.number()]).nullish(),
    ratePerWeek: z.union([z.string(), z.number()]).nullish(),
  }),

  generate_template: z.object({
    description: z.string().min(1),
    name: z.string().optional(),
  }),

  modify_template: z.object({
    templateName: z.string().min(1),
    instruction: z.string().min(1),
  }),

  generate_microsite: z.object({
    proposalFileName: z.string().min(1),
    companyName: z.string().optional(),
    tagline: z.string().optional(),
    primaryColor: z
      .string()
      .regex(HEX_COLOR_REGEX, 'primaryColor must be a valid hex color (e.g. #1a2b3c)')
      .optional(),
    secondaryColor: z
      .string()
      .regex(HEX_COLOR_REGEX, 'secondaryColor must be a valid hex color (e.g. #1a2b3c)')
      .optional(),
    theme: z.string().optional(),
    customInstructions: z.string().optional(),
  }),

  edit_proposal_section: z.object({
    proposalFileName: z.string().min(1),
    sectionName: z.string().min(1),
    instruction: z.string().min(1),
  }),

  search_documents: z.object({
    query: z.string().min(1),
  }),

  list_proposals: z.object({}),

  list_templates: z.object({}),

  get_proposal_status: z.object({
    proposalFileName: z.string().min(1),
  }),

  set_proposal_status: z.object({
    proposalFileName: z.string().min(1),
    status: z.string().min(1),
  }),

  create_skill: z.object({
    description: z.string().min(1),
    industries: z.array(z.string()).optional(),
    pricingModel: z.enum(['hourly', 'fixed', 'tiered', 'retainer']).optional(),
    tone: z.string().optional(),
  }),

  list_skills: z.object({}),
  list_design_skills: z.object({}),
};

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  plan?: AgentPlan;
  errors: string[];
}

// ---------------------------------------------------------------------------
// validatePlan
// ---------------------------------------------------------------------------

export function validatePlan(raw: unknown): ValidationResult {
  const planResult = PlanSchema.safeParse(raw);
  if (!planResult.success) {
    return {
      valid: false,
      errors: planResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }

  const plan = planResult.data;
  const errors: string[] = [];

  // Per-tool param validation
  for (const action of plan.actions) {
    if (action.type === 'CALL_TOOL') {
      const schema = TOOL_PARAM_SCHEMAS[action.tool];
      if (schema) {
        const paramResult = schema.safeParse(action.params);
        if (!paramResult.success) {
          errors.push(
            `Tool "${action.tool}" invalid params: ${paramResult.error.errors.map((e) => e.message).join(', ')}`,
          );
        }
      }
    }
  }

  // Business rules
  if (plan.actions.filter((a) => a.type === 'CALL_TOOL').length > 3) {
    errors.push('Max 3 tool calls per turn');
  }
  if (plan.intent === 'GREETING' && plan.actions.some((a) => a.type === 'CALL_TOOL')) {
    errors.push('GREETING should not call tools');
  }
  if (plan.intent === 'GENERAL_CHAT' && plan.actions.some((a) => a.type === 'CALL_TOOL')) {
    errors.push('GENERAL_CHAT should not call tools');
  }

  return {
    valid: errors.length === 0,
    plan: errors.length === 0 ? (plan as AgentPlan) : undefined,
    errors,
  };
}
