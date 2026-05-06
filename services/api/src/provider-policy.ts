/**
 * Provider routing policy — selects AI providers per namespace and operation.
 *
 * The policy is loaded from a JSON config file at startup.  For each
 * ingest / query request the layer resolves which provider to use,
 * sets the appropriate environment variables **synchronously** before
 * the runtime spawns its Python subprocess, then restores the original
 * env immediately — all before yielding to the event loop.
 *
 * If a fallback provider is defined and the primary fails, the
 * operation is retried once with the fallback configuration.
 */

import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProviderModels {
  readonly generation?: string;
  readonly embedding?: string;
}

interface ProviderOptions {
  readonly base_url?: string;
}

export interface OperationPolicy {
  readonly provider: string;
  readonly models: ProviderModels;
  readonly options: ProviderOptions;
  readonly fallback: OperationPolicy | null;
}

interface NamespacePolicy {
  readonly ingest?: OperationPolicy;
  readonly query?: OperationPolicy;
}

export interface ProviderPolicyConfig {
  readonly version: string;
  readonly default: Required<NamespacePolicy>;
  readonly namespaces: Record<string, NamespacePolicy>;
}

export type Operation = 'ingest' | 'query';

export interface ResolvedPolicy {
  readonly provider: string;
  readonly models: ProviderModels;
  readonly options: ProviderOptions;
  readonly fallback: ResolvedPolicy | null;
  readonly source: string;
}

export interface ProviderInfo {
  readonly provider: string;
  readonly usedFallback: boolean;
  readonly policySource: string;
}

// ---------------------------------------------------------------------------
// Known providers — used for validation and env-var mapping
// ---------------------------------------------------------------------------

const KNOWN_PROVIDERS = new Set(['ollama', 'openai', 'anthropic']);

const PROVIDER_ENV_KEYS: Record<string, readonly string[]> = {
  anthropic: [
    'LLM_PROVIDER',
    'ANTHROPIC_GENERATION_MODEL',
    'ANTHROPIC_TEMPERATURE',
  ],
  ollama: [
    'LLM_PROVIDER',
    'OLLAMA_BASE_URL',
    'OLLAMA_GENERATION_MODEL',
    'OLLAMA_EMBEDDING_MODEL',
  ],
  openai: [
    'LLM_PROVIDER',
    'OPENAI_GENERATION_MODEL',
    'OPENAI_EMBEDDING_MODEL',
  ],
};

/** Union of every env key any provider might touch. */
const ALL_PROVIDER_ENV_KEYS = [
  ...new Set(Object.values(PROVIDER_ENV_KEYS).flat()),
];

// ---------------------------------------------------------------------------
// Loading & validation
// ---------------------------------------------------------------------------

export async function loadProviderPolicy(
  configPath: string,
): Promise<ProviderPolicyConfig> {
  const raw = await readFile(configPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  return validatePolicy(parsed);
}

function validatePolicy(raw: unknown): ProviderPolicyConfig {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Provider policy must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== '1.0') {
    throw new Error(
      `Unsupported provider policy version: ${String(obj.version)}. Expected "1.0".`,
    );
  }

  if (!obj.default || typeof obj.default !== 'object') {
    throw new Error('Provider policy must include a "default" section');
  }

  const defaultSection = obj.default as Record<string, unknown>;

  if (!defaultSection.ingest) {
    throw new Error('Provider policy "default" must include an "ingest" entry');
  }
  if (!defaultSection.query) {
    throw new Error('Provider policy "default" must include a "query" entry');
  }

  validateOperationPolicy(defaultSection.ingest, 'default.ingest');
  validateOperationPolicy(defaultSection.query, 'default.query');

  const namespaces = (obj.namespaces ?? {}) as Record<string, unknown>;
  if (typeof namespaces !== 'object' || namespaces === null) {
    throw new Error('"namespaces" must be an object');
  }

  for (const [ns, nsPol] of Object.entries(namespaces)) {
    if (typeof nsPol !== 'object' || nsPol === null) {
      throw new Error(`Namespace "${ns}" must be an object`);
    }
    const nsObj = nsPol as Record<string, unknown>;
    if (nsObj.ingest !== undefined) {
      validateOperationPolicy(nsObj.ingest, `namespaces.${ns}.ingest`);
    }
    if (nsObj.query !== undefined) {
      validateOperationPolicy(nsObj.query, `namespaces.${ns}.query`);
    }
  }

  return raw as unknown as ProviderPolicyConfig;
}

function validateOperationPolicy(raw: unknown, path: string): void {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`"${path}" must be an object`);
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.provider !== 'string' || !KNOWN_PROVIDERS.has(obj.provider)) {
    throw new Error(
      `"${path}.provider" must be one of: ${[...KNOWN_PROVIDERS].join(', ')}. Got: ${String(obj.provider)}`,
    );
  }

  if (obj.fallback !== null && obj.fallback !== undefined) {
    validateOperationPolicy(obj.fallback, `${path}.fallback`);

    // Disallow nested fallbacks (depth = 1).
    const fb = obj.fallback as Record<string, unknown>;
    if (fb.fallback !== null && fb.fallback !== undefined) {
      throw new Error(
        `"${path}.fallback.fallback" is not allowed — fallback depth is limited to 1`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolvePolicy(
  config: ProviderPolicyConfig,
  namespace: string,
  operation: Operation,
): ResolvedPolicy {
  const nsPolicy = config.namespaces[namespace];
  const opPolicy = nsPolicy?.[operation] ?? config.default[operation];
  const source = nsPolicy?.[operation]
    ? `namespace:${namespace}`
    : 'default';

  return toResolved(opPolicy, source);
}

function toResolved(op: OperationPolicy, source: string): ResolvedPolicy {
  return {
    provider: op.provider,
    models: op.models,
    options: op.options,
    fallback: op.fallback ? toResolved(op.fallback, `${source}:fallback`) : null,
    source,
  };
}

// ---------------------------------------------------------------------------
// Environment variable mapping
// ---------------------------------------------------------------------------

export function buildEnvOverrides(
  policy: ResolvedPolicy,
): Record<string, string> {
  const env: Record<string, string> = {
    LLM_PROVIDER: policy.provider,
  };

  if (policy.provider === 'ollama') {
    if (policy.models.generation) {
      env.OLLAMA_GENERATION_MODEL = policy.models.generation;
    }
    if (policy.models.embedding) {
      env.OLLAMA_EMBEDDING_MODEL = policy.models.embedding;
    }
    if (policy.options.base_url) {
      env.OLLAMA_BASE_URL = policy.options.base_url;
    }
  }

  if (policy.provider === 'openai') {
    if (policy.models.generation) {
      env.OPENAI_GENERATION_MODEL = policy.models.generation;
    }
    if (policy.models.embedding) {
      env.OPENAI_EMBEDDING_MODEL = policy.models.embedding;
    }
  }

  if (policy.provider === 'anthropic') {
    if (policy.models.generation) {
      env.ANTHROPIC_GENERATION_MODEL = policy.models.generation;
    }
  }

  return env;
}

// ---------------------------------------------------------------------------
// Concurrency-safe env mutation
// ---------------------------------------------------------------------------

/**
 * Synchronously sets provider env vars, calls `fn`, then restores
 * the original values — all before any `await` yields control.
 *
 * `fn` is expected to return a Promise (the runtime call), but the
 * critical `spawn()` inside it executes synchronously within the
 * Promise constructor, capturing `process.env` at that instant.
 */
export function withProviderEnv<T>(policy: ResolvedPolicy, fn: () => T): T {
  const overrides = buildEnvOverrides(policy);
  const saved: Record<string, string | undefined> = {};

  // Save current values for every key any provider might set.
  for (const key of ALL_PROVIDER_ENV_KEYS) {
    saved[key] = process.env[key];
  }

  // Apply overrides.
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }

  let result: T;
  try {
    result = fn();
  } finally {
    // Restore — runs synchronously even if fn() threw.
    for (const [key, original] of Object.entries(saved)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Execute with fallback
// ---------------------------------------------------------------------------

export async function executeWithPolicy<T>(
  policy: ResolvedPolicy,
  fn: () => Promise<T>,
): Promise<{ result: T; usedFallback: boolean; provider: string }> {
  // Attempt primary provider.
  try {
    const result = await withProviderEnv(policy, fn);
    return { result, usedFallback: false, provider: policy.provider };
  } catch (primaryError) {
    if (!policy.fallback) {
      throw primaryError;
    }

    // Retry once with fallback provider.
    try {
      const result = await withProviderEnv(policy.fallback, fn);
      return { result, usedFallback: true, provider: policy.fallback.provider };
    } catch (fallbackError) {
      throw new Error(
        `Primary provider '${policy.provider}' failed: ${String(primaryError)}. ` +
          `Fallback provider '${policy.fallback.provider}' also failed: ${String(fallbackError)}.`,
      );
    }
  }
}
