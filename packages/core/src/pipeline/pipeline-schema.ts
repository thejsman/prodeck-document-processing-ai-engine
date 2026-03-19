export const STEP_TYPES = ['extract', 'process', 'export'] as const;
export type StepType = (typeof STEP_TYPES)[number];
export const VALID_STEP_TYPES: ReadonlySet<string> = new Set(STEP_TYPES);

export const PIPELINE_TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'version',
  'steps',
]);

export const STEP_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'ref',
  'config',
]);

export interface PipelineStepDefinition {
  readonly type: StepType;
  readonly ref: string;
  readonly config?: Readonly<Record<string, unknown>>;
}

export interface PipelineDefinition {
  readonly name: string;
  readonly version: string;
  readonly steps: readonly PipelineStepDefinition[];
}
