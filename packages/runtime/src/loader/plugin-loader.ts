import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type PipelineRegistry,
  type Extractor,
  type Processor,
  type Exporter,
} from '@ai-engine/core';
import { PluginLoaderError } from '../errors/plugin-loader-error.js';

const CURRENT_PLUGIN_API_MAJOR_VERSION = 0;

const VALID_PLUGIN_TYPES: ReadonlySet<string> = new Set([
  'extractor',
  'processor',
  'exporter',
]);

type PluginManifestType = 'extractor' | 'processor' | 'exporter';

export interface PluginManifest {
  readonly name: string;
  readonly type: PluginManifestType;
  readonly apiVersion: string;
  readonly entry: string;
}

interface ValidatedPlugin {
  readonly manifest: PluginManifest;
  readonly instance: Extractor | Processor | Exporter;
}

export async function loadPlugins(
  pluginDirs: readonly string[],
  registry: PipelineRegistry,
): Promise<void> {
  const validated: ValidatedPlugin[] = [];
  const seenNames = new Set<string>();

  for (const dir of pluginDirs) {
    const plugin = await loadAndValidatePlugin(dir, seenNames);
    validated.push(plugin);
  }

  for (const { manifest, instance } of validated) {
    registerPlugin(manifest.type, instance, registry);
  }
}

async function loadAndValidatePlugin(
  pluginDir: string,
  seenNames: Set<string>,
): Promise<ValidatedPlugin> {
  const manifest = await readAndValidateManifest(pluginDir);

  if (seenNames.has(manifest.name)) {
    throw new PluginLoaderError({
      code: 'DUPLICATE_PLUGIN_NAME',
      message: `Plugin name "${manifest.name}" is already used by another plugin in this batch`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }
  seenNames.add(manifest.name);

  await assertPackageJsonExists(pluginDir, manifest.name);

  const instance = await importAndValidateEntry(pluginDir, manifest);

  return { manifest, instance };
}

async function readAndValidateManifest(
  pluginDir: string,
): Promise<PluginManifest> {
  const manifestPath = path.join(pluginDir, 'plugin.json');

  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf-8');
  } catch {
    throw new PluginLoaderError({
      code: 'FILE_NOT_FOUND',
      message: `Plugin manifest not found: ${manifestPath}`,
      pluginPath: pluginDir,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PluginLoaderError({
      code: 'MANIFEST_READ_ERROR',
      message: `Plugin manifest is not valid JSON: ${manifestPath}`,
      pluginPath: pluginDir,
    });
  }

  return validateManifest(parsed, pluginDir);
}

function validateManifest(
  parsed: unknown,
  pluginDir: string,
): PluginManifest {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PluginLoaderError({
      code: 'MANIFEST_INVALID',
      message: 'Plugin manifest must be a JSON object',
      pluginPath: pluginDir,
    });
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    throw new PluginLoaderError({
      code: 'MANIFEST_INVALID',
      message: 'Plugin manifest "name" must be a non-empty string',
      pluginPath: pluginDir,
    });
  }

  const pluginName = obj.name;

  if (typeof obj.type !== 'string' || !VALID_PLUGIN_TYPES.has(obj.type)) {
    throw new PluginLoaderError({
      code: 'MANIFEST_INVALID',
      message: `Plugin manifest "type" must be one of: extractor, processor, exporter. Got: "${String(obj.type)}"`,
      pluginPath: pluginDir,
      pluginName,
    });
  }

  if (typeof obj.apiVersion !== 'string' || obj.apiVersion.length === 0) {
    throw new PluginLoaderError({
      code: 'MANIFEST_INVALID',
      message: 'Plugin manifest "apiVersion" must be a non-empty string',
      pluginPath: pluginDir,
      pluginName,
    });
  }

  if (typeof obj.entry !== 'string' || obj.entry.length === 0) {
    throw new PluginLoaderError({
      code: 'MANIFEST_INVALID',
      message: 'Plugin manifest "entry" must be a non-empty string',
      pluginPath: pluginDir,
      pluginName,
    });
  }

  validateApiVersion(obj.apiVersion, pluginDir, pluginName);

  return {
    name: pluginName,
    type: obj.type as PluginManifestType,
    apiVersion: obj.apiVersion,
    entry: obj.entry,
  };
}

function validateApiVersion(
  apiVersion: string,
  pluginDir: string,
  pluginName: string,
): void {
  const dotIndex = apiVersion.indexOf('.');
  const majorStr = dotIndex === -1 ? apiVersion : apiVersion.substring(0, dotIndex);
  const major = Number(majorStr);

  if (!Number.isInteger(major) || major < 0) {
    throw new PluginLoaderError({
      code: 'API_VERSION_MISMATCH',
      message: `Plugin "${pluginName}" has unparseable apiVersion: "${apiVersion}"`,
      pluginPath: pluginDir,
      pluginName,
    });
  }

  if (major !== CURRENT_PLUGIN_API_MAJOR_VERSION) {
    throw new PluginLoaderError({
      code: 'API_VERSION_MISMATCH',
      message: `Plugin "${pluginName}" requires API major version ${major} but current is ${CURRENT_PLUGIN_API_MAJOR_VERSION}`,
      pluginPath: pluginDir,
      pluginName,
    });
  }
}

async function assertPackageJsonExists(
  pluginDir: string,
  pluginName: string,
): Promise<void> {
  const packageJsonPath = path.join(pluginDir, 'package.json');
  try {
    await access(packageJsonPath);
  } catch {
    throw new PluginLoaderError({
      code: 'FILE_NOT_FOUND',
      message: `Required file not found: ${packageJsonPath}`,
      pluginPath: pluginDir,
      pluginName,
    });
  }
}

function isValidPluginExport(
  value: unknown,
): value is { readonly name: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'name' in value &&
    typeof (value as Record<string, unknown>).name === 'string'
  );
}

async function importAndValidateEntry(
  pluginDir: string,
  manifest: PluginManifest,
): Promise<Extractor | Processor | Exporter> {
  const entryPath = path.resolve(pluginDir, manifest.entry);

  try {
    await access(entryPath);
  } catch {
    throw new PluginLoaderError({
      code: 'FILE_NOT_FOUND',
      message: `Entry file not found for plugin "${manifest.name}": ${entryPath}`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  let imported: Record<string, unknown>;
  try {
    const entryUrl = pathToFileURL(entryPath).href;
    imported = (await import(entryUrl)) as Record<string, unknown>;
  } catch {
    throw new PluginLoaderError({
      code: 'ENTRY_IMPORT_ERROR',
      message: `Failed to import entry file for plugin "${manifest.name}": ${entryPath}`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  if (!('default' in imported)) {
    throw new PluginLoaderError({
      code: 'INVALID_EXPORT',
      message: `Plugin "${manifest.name}" entry file must have a default export`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  const exported: unknown = imported.default;

  if (!isValidPluginExport(exported)) {
    throw new PluginLoaderError({
      code: 'INVALID_EXPORT',
      message: `Plugin "${manifest.name}" default export must be an object with a "name" string property`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  if (exported.name !== manifest.name) {
    throw new PluginLoaderError({
      code: 'INVALID_EXPORT',
      message: `Plugin "${manifest.name}" default export name "${exported.name}" does not match manifest name`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  return exported;
}

function registerPlugin(
  type: PluginManifestType,
  instance: Extractor | Processor | Exporter,
  registry: PipelineRegistry,
): void {
  switch (type) {
    case 'extractor':
      registry.registerExtractor(instance);
      break;
    case 'processor':
      registry.registerProcessor(instance);
      break;
    case 'exporter':
      registry.registerExporter(instance);
      break;
  }
}
