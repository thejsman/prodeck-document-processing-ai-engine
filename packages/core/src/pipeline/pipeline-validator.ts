import { PipelineValidationError } from '../errors/pipeline-validation-error.js';
import {
  PIPELINE_TOP_LEVEL_FIELDS,
  STEP_FIELDS,
  VALID_STEP_TYPES,
  type PipelineDefinition,
  type PipelineStepDefinition,
  type StepType,
} from './pipeline-schema.js';

const STEP_ORDER: Record<StepType, number> = {
  extract: 0,
  process: 1,
  export: 2,
};

export function validatePipeline(input: unknown): PipelineDefinition {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new PipelineValidationError({
      code: 'INVALID_TOP_LEVEL',
      message: 'Pipeline definition must be a non-null object',
    });
  }

  const obj = input as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!PIPELINE_TOP_LEVEL_FIELDS.has(key)) {
      throw new PipelineValidationError({
        code: 'UNKNOWN_FIELD',
        message: `Unknown top-level field: "${key}"`,
        field: key,
      });
    }
  }

  validateRequiredString(obj, 'name');
  validateRequiredString(obj, 'version');
  validateStepsField(obj);

  const steps = (obj.steps as unknown[]).map((step, index) =>
    validateStep(step, index),
  );

  validateStepOrder(steps);

  return {
    name: obj.name as string,
    version: obj.version as string,
    steps,
  };
}

function validateRequiredString(
  obj: Record<string, unknown>,
  field: string,
): void {
  if (!(field in obj)) {
    throw new PipelineValidationError({
      code: 'MISSING_FIELD',
      message: `Pipeline definition must include "${field}"`,
      field,
    });
  }
  if (typeof obj[field] !== 'string') {
    throw new PipelineValidationError({
      code: 'INVALID_FIELD_TYPE',
      message: `"${field}" must be a string`,
      field,
    });
  }
}

function validateStepsField(obj: Record<string, unknown>): void {
  if (!('steps' in obj)) {
    throw new PipelineValidationError({
      code: 'MISSING_FIELD',
      message: 'Pipeline definition must include "steps"',
      field: 'steps',
    });
  }
  if (!Array.isArray(obj.steps)) {
    throw new PipelineValidationError({
      code: 'INVALID_FIELD_TYPE',
      message: '"steps" must be an array',
      field: 'steps',
    });
  }
  if (obj.steps.length === 0) {
    throw new PipelineValidationError({
      code: 'EMPTY_STEPS',
      message: '"steps" must not be empty',
      field: 'steps',
    });
  }
}

function validateStep(
  input: unknown,
  index: number,
): PipelineStepDefinition {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new PipelineValidationError({
      code: 'INVALID_FIELD_TYPE',
      message: `Step at index ${index} must be a non-null object`,
      stepIndex: index,
    });
  }

  const step = input as Record<string, unknown>;

  for (const key of Object.keys(step)) {
    if (!STEP_FIELDS.has(key)) {
      throw new PipelineValidationError({
        code: 'UNKNOWN_FIELD',
        message: `Unknown field "${key}" in step at index ${index}`,
        stepIndex: index,
        field: key,
      });
    }
  }

  if (!('type' in step)) {
    throw new PipelineValidationError({
      code: 'MISSING_FIELD',
      message: `Step at index ${index} must include "type"`,
      stepIndex: index,
      field: 'type',
    });
  }
  if (typeof step.type !== 'string' || !VALID_STEP_TYPES.has(step.type)) {
    throw new PipelineValidationError({
      code: 'INVALID_STEP_TYPE',
      message: `Step at index ${index} has invalid type "${String(step.type)}". Must be one of: extract, process, export`,
      stepIndex: index,
      field: 'type',
    });
  }

  if (!('ref' in step)) {
    throw new PipelineValidationError({
      code: 'MISSING_FIELD',
      message: `Step at index ${index} must include "ref"`,
      stepIndex: index,
      field: 'ref',
    });
  }
  if (typeof step.ref !== 'string') {
    throw new PipelineValidationError({
      code: 'INVALID_FIELD_TYPE',
      message: `Step at index ${index} "ref" must be a string`,
      stepIndex: index,
      field: 'ref',
    });
  }
  if (step.ref.length === 0) {
    throw new PipelineValidationError({
      code: 'EMPTY_REF',
      message: `Step at index ${index} "ref" must not be empty`,
      stepIndex: index,
      field: 'ref',
    });
  }

  const result: PipelineStepDefinition = {
    type: step.type as StepType,
    ref: step.ref as string,
  };

  if ('config' in step) {
    if (
      step.config === null ||
      typeof step.config !== 'object' ||
      Array.isArray(step.config)
    ) {
      throw new PipelineValidationError({
        code: 'INVALID_CONFIG_TYPE',
        message: `Step at index ${index} "config" must be a plain object`,
        stepIndex: index,
        field: 'config',
      });
    }
    return { ...result, config: step.config as Record<string, unknown> };
  }

  return result;
}

function validateStepOrder(steps: PipelineStepDefinition[]): void {
  const exportCount = steps.filter((s) => s.type === 'export').length;

  if (exportCount === 0) {
    throw new PipelineValidationError({
      code: 'MISSING_EXPORT',
      message: 'Pipeline must include exactly one "export" step',
      field: 'steps',
    });
  }

  if (exportCount > 1) {
    let seen = 0;
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].type === 'export') {
        seen++;
        if (seen === 2) {
          throw new PipelineValidationError({
            code: 'MULTIPLE_EXPORTS',
            message: `Pipeline must include exactly one "export" step, found ${exportCount}`,
            stepIndex: i,
            field: 'type',
          });
        }
      }
    }
  }

  if (steps[steps.length - 1].type !== 'export') {
    const exportIndex = steps.findIndex((s) => s.type === 'export');
    throw new PipelineValidationError({
      code: 'EXPORT_NOT_LAST',
      message: `"export" step must be the last step, found at index ${exportIndex}`,
      stepIndex: exportIndex,
      field: 'type',
    });
  }

  for (let i = 1; i < steps.length; i++) {
    const prevOrder = STEP_ORDER[steps[i - 1].type];
    const currOrder = STEP_ORDER[steps[i].type];
    if (currOrder < prevOrder) {
      throw new PipelineValidationError({
        code: 'INVALID_STEP_ORDER',
        message: `Step at index ${i} has type "${steps[i].type}" which cannot follow "${steps[i - 1].type}". Required order: extract, process, export`,
        stepIndex: i,
        field: 'type',
      });
    }
  }
}
