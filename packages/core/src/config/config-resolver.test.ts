import { describe, it, expect } from 'vitest';
import { ConfigResolver, deepMerge } from './config-resolver.js';
import { FileConfigLoader } from './config-loader.js';
import type { CoreConfig, ConfigLoader } from './config-types.js';

// ---------------------------------------------------------------------------
// deepMerge unit tests
// ---------------------------------------------------------------------------

describe('deepMerge', () => {
  it('returns source values when target is empty', () => {
    const result = deepMerge({} as CoreConfig, { tone: 'formal' });
    expect(result).toEqual({ tone: 'formal' });
  });

  it('target values survive when source does not override them', () => {
    const result = deepMerge(
      { tone: 'formal', defaultProvider: 'openai' } as CoreConfig,
      { tone: 'casual' },
    );
    expect(result).toEqual({ tone: 'casual', defaultProvider: 'openai' });
  });

  it('recursively merges nested plain objects', () => {
    const result = deepMerge(
      { pricingDefaults: { ratePerWeek: 100 } } as CoreConfig,
      { pricingDefaults: { ratePerWeek: 200 } },
    );
    expect(result).toEqual({ pricingDefaults: { ratePerWeek: 200 } });
  });

  it('does not mutate either input', () => {
    const target = { tone: 'formal' } as CoreConfig;
    const source = { tone: 'casual' };
    deepMerge(target, source);
    expect(target.tone).toBe('formal');
  });

  it('ignores undefined values in source', () => {
    const result = deepMerge(
      { tone: 'formal' } as CoreConfig,
      { tone: undefined },
    );
    expect(result.tone).toBe('formal');
  });
});

// ---------------------------------------------------------------------------
// FileConfigLoader unit tests (with mock ReadFileFn)
// ---------------------------------------------------------------------------

describe('FileConfigLoader', () => {
  function makeLoader(files: Record<string, string>) {
    const readFile = async (p: string) => files[p] ?? null;
    return new FileConfigLoader('/base', readFile);
  }

  it('loads global.json', async () => {
    const loader = makeLoader({ '/base/global.json': '{"tone":"formal"}' });
    expect(await loader.loadGlobal()).toEqual({ tone: 'formal' });
  });

  it('loads org.json', async () => {
    const loader = makeLoader({ '/base/org.json': '{"defaultProvider":"openai"}' });
    expect(await loader.loadOrg()).toEqual({ defaultProvider: 'openai' });
  });

  it('loads namespaces/<ns>.json', async () => {
    const loader = makeLoader({ '/base/namespaces/acme.json': '{"tone":"casual"}' });
    expect(await loader.loadNamespace('acme')).toEqual({ tone: 'casual' });
  });

  it('loads users/<id>.json', async () => {
    const loader = makeLoader({ '/base/users/alice.json': '{"tone":"friendly"}' });
    expect(await loader.loadUser('alice')).toEqual({ tone: 'friendly' });
  });

  it('returns empty object for missing file (null)', async () => {
    const loader = makeLoader({});
    expect(await loader.loadGlobal()).toEqual({});
  });

  it('returns empty object for empty file content', async () => {
    const loader = makeLoader({ '/base/global.json': '   ' });
    expect(await loader.loadGlobal()).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ConfigResolver unit tests
// ---------------------------------------------------------------------------

describe('ConfigResolver', () => {
  function makeResolver(layers: {
    global?: Partial<CoreConfig>;
    org?: Partial<CoreConfig>;
    namespaces?: Record<string, Partial<CoreConfig>>;
    users?: Record<string, Partial<CoreConfig>>;
  }): ConfigResolver {
    const loader: ConfigLoader = {
      loadGlobal: async () => layers.global ?? {},
      loadOrg: async () => layers.org ?? {},
      loadNamespace: async (ns) => layers.namespaces?.[ns] ?? {},
      loadUser: async (id) => layers.users?.[id] ?? {},
    };
    return new ConfigResolver(loader);
  }

  it('returns empty config when all layers are empty', async () => {
    const resolver = makeResolver({});
    expect(await resolver.resolve()).toEqual({});
  });

  it('merges global and org', async () => {
    const resolver = makeResolver({
      global: { tone: 'formal', defaultProvider: 'openai' },
      org: { tone: 'casual' },
    });
    expect(await resolver.resolve()).toEqual({
      tone: 'casual',
      defaultProvider: 'openai',
    });
  });

  it('applies namespace on top of org', async () => {
    const resolver = makeResolver({
      global: { tone: 'formal' },
      org: { defaultProvider: 'openai' },
      namespaces: { acme: { tone: 'direct' } },
    });
    expect(await resolver.resolve({ namespace: 'acme' })).toEqual({
      tone: 'direct',
      defaultProvider: 'openai',
    });
  });

  it('applies user on top of namespace', async () => {
    const resolver = makeResolver({
      global: { tone: 'formal' },
      namespaces: { acme: { tone: 'direct', defaultProvider: 'openai' } },
      users: { alice: { tone: 'friendly' } },
    });
    expect(await resolver.resolve({ namespace: 'acme', userId: 'alice' })).toEqual({
      tone: 'friendly',
      defaultProvider: 'openai',
    });
  });

  it('applies invocation overrides last', async () => {
    const resolver = makeResolver({
      global: { tone: 'formal' },
      users: { alice: { tone: 'friendly' } },
    });
    expect(
      await resolver.resolve({ userId: 'alice', overrides: { tone: 'urgent' } }),
    ).toEqual({ tone: 'urgent' });
  });

  it('skips namespace layer when not provided', async () => {
    const resolver = makeResolver({
      namespaces: { acme: { tone: 'direct' } },
    });
    expect(await resolver.resolve()).toEqual({});
  });

  it('skips user layer when not provided', async () => {
    const resolver = makeResolver({
      users: { alice: { tone: 'friendly' } },
    });
    expect(await resolver.resolve()).toEqual({});
  });

  it('deep-merges nested pricingDefaults', async () => {
    const resolver = makeResolver({
      global: { pricingDefaults: { ratePerWeek: 100 } },
      org: { pricingDefaults: { ratePerWeek: 200 } },
    });
    expect(await resolver.resolve()).toEqual({
      pricingDefaults: { ratePerWeek: 200 },
    });
  });

  it('each resolve call is independent', async () => {
    const resolver = makeResolver({
      global: { tone: 'formal' },
      namespaces: { acme: { tone: 'direct' } },
    });
    const a = await resolver.resolve({ namespace: 'acme' });
    const b = await resolver.resolve();
    expect(a.tone).toBe('direct');
    expect(b.tone).toBe('formal');
  });
});
