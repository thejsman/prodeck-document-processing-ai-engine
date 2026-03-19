export type PipelineValidationCode =
  | 'INVALID_TOP_LEVEL'
  | 'MISSING_FIELD'
  | 'INVALID_FIELD_TYPE'
  | 'UNKNOWN_FIELD'
  | 'EMPTY_STEPS'
  | 'INVALID_STEP_TYPE'
  | 'EMPTY_REF'
  | 'INVALID_STEP_ORDER'
  | 'MISSING_EXPORT'
  | 'MULTIPLE_EXPORTS'
  | 'EXPORT_NOT_LAST'
  | 'INVALID_CONFIG_TYPE';

export interface PipelineValidationErrorDetails {
  code: PipelineValidationCode;
  message: string;
  stepIndex?: number;
  field?: string;
}

export class PipelineValidationError extends Error {
  public readonly code: PipelineValidationCode;
  public readonly stepIndex: number | undefined;
  public readonly field: string | undefined;

  constructor(details: PipelineValidationErrorDetails) {
    super(details.message);
    this.name = 'PipelineValidationError';
    this.code = details.code;
    this.stepIndex = details.stepIndex;
    this.field = details.field;
  }
}
