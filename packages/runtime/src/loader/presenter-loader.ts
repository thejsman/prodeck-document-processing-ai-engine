import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkSdkCompatibility, RUNTIME_SDK_VERSION } from '@ai-engine/plugin-sdk';
import type { PluginManifest, PresentationPlugin } from '@ai-engine/plugin-sdk';
import { PluginLoaderError } from '../errors/plugin-loader-error.js';

// ── In-memory registry for presenter plugins ─────────────────────────────

export class PresenterPluginRegistry {
  private readonly plugins = new Map<string, PresentationPlugin>();

  register(plugin: PresentationPlugin): void {
    const name = plugin.manifest.name;
    if (this.plugins.has(name)) {
      throw new PluginLoaderError({
        code: 'DUPLICATE_PLUGIN_NAME',
        message: `Presenter plugin "${name}" is already registered`,
        pluginPath: name,
        pluginName: name,
      });
    }
    this.plugins.set(name, plugin);
  }

  get(name: string): PresentationPlugin | undefined {
    return this.plugins.get(name);
  }

  getAll(): PresentationPlugin[] {
    return Array.from(this.plugins.values());
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  size(): number {
    return this.plugins.size;
  }
}

// ── Loader ────────────────────────────────────────────────────────────────

/**
 * Scan one or more directories for `plugins/presenter-*` subdirectories,
 * load each plugin's manifest + entry, validate SDK compatibility,
 * and register them in the provided registry.
 */
export async function loadPresenterPlugins(
  pluginDirs: readonly string[],
  registry: PresenterPluginRegistry,
): Promise<void> {
  const seenNames = new Set<string>();

  for (const dir of pluginDirs) {
    await loadPresenterPluginDir(dir, registry, seenNames);
  }
}

/**
 * Auto-discover all `presenter-*` subdirectories inside `baseDir`,
 * load each as a presenter plugin, and register them.
 */
export async function discoverPresenterPlugins(
  baseDir: string,
  registry: PresenterPluginRegistry,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return; // base dir doesn't exist — skip silently
  }

  const presenterDirs = entries
    .filter((e) => e.startsWith('presenter-'))
    .map((e) => path.join(baseDir, e));

  await loadPresenterPlugins(presenterDirs, registry);
}

// ── Internal ──────────────────────────────────────────────────────────────

async function loadPresenterPluginDir(
  pluginDir: string,
  registry: PresenterPluginRegistry,
  seenNames: Set<string>,
): Promise<void> {
  const manifest = await readAndValidateManifest(pluginDir);

  if (seenNames.has(manifest.name)) {
    throw new PluginLoaderError({
      code: 'DUPLICATE_PLUGIN_NAME',
      message: `Presenter plugin name "${manifest.name}" is already used by another plugin in this batch`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }
  seenNames.add(manifest.name);

  const compat = checkSdkCompatibility(manifest.sdkVersion, RUNTIME_SDK_VERSION);
  if (!compat.compatible) {
    throw new PluginLoaderError({
      code: 'API_VERSION_MISMATCH',
      message: `Presenter plugin "${manifest.name}" is incompatible: ${compat.reason}`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  const plugin = await importPresenterEntry(pluginDir, manifest);
  registry.register(plugin);
}

async function readAndValidateManifest(pluginDir: string): Promise<PluginManifest> {
  const manifestPath = path.join(pluginDir, 'plugin.json');

  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf-8');
  } catch {
    throw new PluginLoaderError({
      code: 'FILE_NOT_FOUND',
      message: `Presenter plugin manifest not found: ${manifestPath}`,
      pluginPath: pluginDir,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PluginLoaderError({
      code: 'MANIFEST_READ_ERROR',
      message: `Presenter plugin manifest is not valid JSON: ${manifestPath}`,
      pluginPath: pluginDir,
    });
  }

  return validatePresenterManifest(parsed, pluginDir);
}

function validatePresenterManifest(parsed: unknown, pluginDir: string): PluginManifest {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PluginLoaderError({
      code: 'MANIFEST_INVALID',
      message: 'Presenter plugin manifest must be a JSON object',
      pluginPath: pluginDir,
    });
  }

  const obj = parsed as Record<string, unknown>;

  for (const field of ['name', 'displayName', 'version', 'sdkVersion', 'entry'] as const) {
    if (typeof obj[field] !== 'string' || (obj[field] as string).length === 0) {
      throw new PluginLoaderError({
        code: 'MANIFEST_INVALID',
        message: `Presenter plugin manifest "${field}" must be a non-empty string`,
        pluginPath: pluginDir,
      });
    }
  }

  if (obj['type'] !== 'presenter') {
    throw new PluginLoaderError({
      code: 'MANIFEST_INVALID',
      message: `Presenter plugin manifest "type" must be "presenter", got "${String(obj['type'])}"`,
      pluginPath: pluginDir,
      pluginName: obj['name'] as string,
    });
  }

  return obj as unknown as PluginManifest;
}

async function importPresenterEntry(
  pluginDir: string,
  manifest: PluginManifest,
): Promise<PresentationPlugin> {
  const entryPath = path.resolve(pluginDir, manifest.entry);

  try {
    await access(entryPath);
  } catch {
    throw new PluginLoaderError({
      code: 'FILE_NOT_FOUND',
      message: `Entry file not found for presenter plugin "${manifest.name}": ${entryPath}`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  let imported: Record<string, unknown>;
  try {
    const entryUrl = pathToFileURL(entryPath).href;
    imported = (await import(entryUrl)) as Record<string, unknown>;
  } catch (err) {
    throw new PluginLoaderError({
      code: 'ENTRY_IMPORT_ERROR',
      message: `Failed to import presenter plugin "${manifest.name}": ${entryPath}. ${(err as Error).message}`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  const exported = imported.default as unknown;

  if (
    exported === null ||
    typeof exported !== 'object' ||
    !('tokens' in (exported as object)) ||
    !('fonts' in (exported as object))
  ) {
    throw new PluginLoaderError({
      code: 'INVALID_EXPORT',
      message: `Presenter plugin "${manifest.name}" default export must have "tokens" and "fonts" properties`,
      pluginPath: pluginDir,
      pluginName: manifest.name,
    });
  }

  return exported as PresentationPlugin;
}
