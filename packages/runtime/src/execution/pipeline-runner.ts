import {
  type PipelineDefinition,
  type PipelineRegistry,
  type ConfigResolver,
  type MemoryRegistry,
  type PresenterRegistry,
  type ExecutionContext,
  type Logger,
} from '@ai-engine/core';
import { PipelineRunError } from '../errors/pipeline-run-error.js';

export type { ExecutionContext, Logger };

interface ExecutableExtractor {
  readonly name: string;
  extract(
    input: unknown,
    config?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}

interface ExecutableProcessor {
  readonly name: string;
  process(
    data: unknown,
    config?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}

interface ExecutableExporter {
  readonly name: string;
  export(
    data: unknown,
    config?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
}

interface ExecutablePresenter {
  readonly name: string;
  present(
    data: unknown,
    config?: Readonly<Record<string, unknown>>,
    context?: ExecutionContext,
  ): Promise<unknown>;
}

type ResolvedStep =
  | {
      readonly type: 'extract';
      readonly ref: string;
      readonly config: Readonly<Record<string, unknown>> | undefined;
      readonly plugin: ExecutableExtractor;
    }
  | {
      readonly type: 'process';
      readonly ref: string;
      readonly config: Readonly<Record<string, unknown>> | undefined;
      readonly plugin: ExecutableProcessor;
    }
  | {
      readonly type: 'export';
      readonly ref: string;
      readonly config: Readonly<Record<string, unknown>> | undefined;
      readonly plugin: ExecutableExporter;
    };

function assertExtractorExecutable(
  plugin: { readonly name: string },
  ref: string,
  stepIndex: number,
): asserts plugin is ExecutableExtractor {
  if (typeof (plugin as Record<string, unknown>).extract !== 'function') {
    throw new PipelineRunError({
      code: 'PLUGIN_NOT_EXECUTABLE',
      message: `Extractor "${ref}" does not implement extract()`,
      stepIndex,
    });
  }
}

function assertProcessorExecutable(
  plugin: { readonly name: string },
  ref: string,
  stepIndex: number,
): asserts plugin is ExecutableProcessor {
  if (typeof (plugin as Record<string, unknown>).process !== 'function') {
    throw new PipelineRunError({
      code: 'PLUGIN_NOT_EXECUTABLE',
      message: `Processor "${ref}" does not implement process()`,
      stepIndex,
    });
  }
}

function assertExporterExecutable(
  plugin: { readonly name: string },
  ref: string,
  stepIndex: number,
): asserts plugin is ExecutableExporter {
  if (typeof (plugin as Record<string, unknown>).export !== 'function') {
    throw new PipelineRunError({
      code: 'PLUGIN_NOT_EXECUTABLE',
      message: `Exporter "${ref}" does not implement export()`,
      stepIndex,
    });
  }
}

function assertPresenterExecutable(
  plugin: { readonly name: string },
  ref: string,
): asserts plugin is ExecutablePresenter {
  if (typeof (plugin as Record<string, unknown>).present !== 'function') {
    throw new PipelineRunError({
      code: 'PLUGIN_NOT_EXECUTABLE',
      message: `Presenter "${ref}" does not implement present()`,
      stepIndex: undefined,
    });
  }
}

function resolveSteps(
  pipeline: PipelineDefinition,
  registry: PipelineRegistry,
): ResolvedStep[] {
  return pipeline.steps.map((step, index): ResolvedStep => {
    switch (step.type) {
      case 'extract': {
        const plugin = registry.getExtractor(step.ref, index);
        assertExtractorExecutable(plugin, step.ref, index);
        return { type: 'extract', ref: step.ref, config: step.config, plugin };
      }
      case 'process': {
        const plugin = registry.getProcessor(step.ref, index);
        assertProcessorExecutable(plugin, step.ref, index);
        return { type: 'process', ref: step.ref, config: step.config, plugin };
      }
      case 'export': {
        const plugin = registry.getExporter(step.ref, index);
        assertExporterExecutable(plugin, step.ref, index);
        return { type: 'export', ref: step.ref, config: step.config, plugin };
      }
    }
  });
}

async function executeStep(
  step: ResolvedStep,
  data: unknown,
  index: number,
  context: ExecutionContext,
): Promise<unknown> {
  try {
    switch (step.type) {
      case 'extract': {
        const extractFn = step.plugin.extract as (
          data: unknown,
          config?: Readonly<Record<string, unknown>>,
          context?: ExecutionContext,
        ) => Promise<unknown>;
        return await extractFn.call(step.plugin, data, step.config, context);
      }
      case 'process': {
        const processFn = step.plugin.process as (
          data: unknown,
          config?: Readonly<Record<string, unknown>>,
          context?: ExecutionContext,
        ) => Promise<unknown>;
        return await processFn.call(step.plugin, data, step.config, context);
      }
      case 'export': {
        const exportFn = step.plugin.export as (
          data: unknown,
          config?: Readonly<Record<string, unknown>>,
          context?: ExecutionContext,
        ) => Promise<unknown>;
        return await exportFn.call(step.plugin, data, step.config, context);
      }
    }
  } catch (error) {
    if (error instanceof PipelineRunError) throw error;
    throw new PipelineRunError({
      code: 'STEP_EXECUTION_FAILED',
      message: `Step ${index + 1} (${step.type} "${step.ref}") failed: ${error instanceof Error ? error.message : String(error)}`,
      stepIndex: index,
    });
  }
}

export interface PipelineRunOptions {
  readonly configResolver?: ConfigResolver;
  readonly memoryRegistry?: MemoryRegistry;
  /** Optional presenter to invoke after all pipeline steps complete. */
  readonly presenterRegistry?: PresenterRegistry;
  readonly presenterName?: string;
}

export async function runPipeline(
  pipeline: PipelineDefinition,
  input: Buffer,
  registry: PipelineRegistry,
  context: ExecutionContext,
  options?: PipelineRunOptions,
): Promise<unknown> {
  const enrichedContext = options
    ? await enrichContext(context, options)
    : context;

  const steps = resolveSteps(pipeline, registry);
  enrichedContext.logger.info(
    `Pipeline "${pipeline.name}" v${pipeline.version}: ${steps.length} step(s)`,
  );

  let data: unknown = input;
  for (let i = 0; i < steps.length; i++) {
    enrichedContext.logger.info(
      `  Step ${i + 1}/${steps.length}: ${steps[i].type} "${steps[i].ref}"`,
    );
    data = await executeStep(steps[i], data, i, enrichedContext);
  }

  if (options?.presenterRegistry && options?.presenterName) {
    const presenter = options.presenterRegistry.get(options.presenterName);
    assertPresenterExecutable(presenter, options.presenterName);
    enrichedContext.logger.info(`Presenter: "${options.presenterName}"`);
    data = await presenter.present(data, undefined, enrichedContext);
  }

  return data;
}

async function enrichContext(
  context: ExecutionContext,
  options: PipelineRunOptions,
): Promise<ExecutionContext> {
  const { configResolver, memoryRegistry } = options;
  const { namespace, user } = context;

  const config = configResolver
    ? await configResolver.resolve({ namespace, userId: user })
    : context.config;

  const memory = memoryRegistry
    ? await memoryRegistry.getMemory(namespace, user)
    : context.memory;

  return { ...context, config, memory };
}
