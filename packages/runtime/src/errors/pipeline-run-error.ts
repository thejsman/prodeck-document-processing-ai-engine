export type PipelineRunCode =
  | 'PLUGIN_NOT_EXECUTABLE'
  | 'STEP_EXECUTION_FAILED';

export interface PipelineRunErrorDetails {
  code: PipelineRunCode;
  message: string;
  stepIndex?: number;
}

export class PipelineRunError extends Error {
  public readonly code: PipelineRunCode;
  public readonly stepIndex: number | undefined;

  constructor(details: PipelineRunErrorDetails) {
    super(details.message);
    this.name = 'PipelineRunError';
    this.code = details.code;
    this.stepIndex = details.stepIndex;
  }
}
