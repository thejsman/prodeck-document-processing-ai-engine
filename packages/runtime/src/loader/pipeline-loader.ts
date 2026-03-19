import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import {
  validatePipeline,
  type PipelineDefinition,
} from '@ai-engine/core';

export async function loadPipelineFromFile(
  filePath: string,
): Promise<PipelineDefinition> {
  const content = await readFile(filePath, 'utf-8');
  return loadPipelineFromString(content);
}

export function loadPipelineFromString(
  yamlContent: string,
): PipelineDefinition {
  const parsed: unknown = parseYaml(yamlContent);
  return validatePipeline(parsed);
}
