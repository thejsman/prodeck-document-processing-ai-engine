import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryRegistry } from './memory-registry.js';
import type { MemoryData, MemoryStore, EpisodicEntry } from './memory-types.js';

/**
 * In-memory mock for MemoryStore.
 * Allows tests to control what each layer returns without file I/O.
 */
class MockMemoryStore implements MemoryStore {
  org: MemoryData = {};
  namespaces = new Map<string, MemoryData>();
  users = new Map<string, MemoryData>();

  async loadOrg(): Promise<MemoryData> {
    return this.org;
  }

  async loadNamespace(namespace: string): Promise<MemoryData> {
    return this.namespaces.get(namespace) ?? {};
  }

  async loadUser(userId: string): Promise<MemoryData> {
    return this.users.get(userId) ?? {};
  }

  async writeNamespace(namespace: string, data: MemoryData): Promise<void> {
    this.namespaces.set(namespace, data);
  }
}

describe('MemoryRegistry', () => {
  let store: MockMemoryStore;
  let registry: MemoryRegistry;

  beforeEach(() => {
    store = new MockMemoryStore();
    registry = new MemoryRegistry(store);
  });

  describe('getMemory', () => {
    it('returns org memory when no namespace or user given', async () => {
      store.org = { tone: 'formal' };

      const result = await registry.getMemory();

      expect(result).toEqual({ tone: 'formal' });
    });

    it('merges org and namespace memory', async () => {
      store.org = { tone: 'formal', defaultProvider: 'openai' };
      store.namespaces.set('acme', { tone: 'casual' });

      const result = await registry.getMemory('acme');

      expect(result).toEqual({ tone: 'casual', defaultProvider: 'openai' });
    });

    it('merges org, namespace, and user memory in priority order', async () => {
      store.org = { tone: 'formal', defaultProvider: 'openai' };
      store.namespaces.set('acme', { tone: 'casual', region: 'us-east' });
      store.users.set('alice', { tone: 'friendly' });

      const result = await registry.getMemory('acme', 'alice');

      expect(result).toEqual({
        tone: 'friendly',
        defaultProvider: 'openai',
        region: 'us-east',
      });
    });

    it('handles empty org gracefully', async () => {
      store.namespaces.set('acme', { tone: 'casual' });

      const result = await registry.getMemory('acme');

      expect(result).toEqual({ tone: 'casual' });
    });

    it('handles missing namespace gracefully', async () => {
      store.org = { tone: 'formal' };

      const result = await registry.getMemory('nonexistent');

      expect(result).toEqual({ tone: 'formal' });
    });

    it('handles missing user gracefully', async () => {
      store.org = { tone: 'formal' };

      const result = await registry.getMemory(undefined, 'ghost');

      expect(result).toEqual({ tone: 'formal' });
    });

    it('concatenates episodic arrays across layers', async () => {
      const orgEntry: EpisodicEntry = {
        timestamp: '2025-01-01T00:00:00Z',
        source: 'org-setup',
        content: 'Org created',
      };
      const nsEntry: EpisodicEntry = {
        timestamp: '2025-02-01T00:00:00Z',
        source: 'ns-setup',
        content: 'Namespace configured',
      };

      store.org = { episodic: [orgEntry] };
      store.namespaces.set('acme', { episodic: [nsEntry] });

      const result = await registry.getMemory('acme');

      expect(result.episodic).toEqual([orgEntry, nsEntry]);
    });

    it('deep-merges nested objects', async () => {
      store.org = { settings: { theme: 'dark', lang: 'en' } };
      store.namespaces.set('acme', { settings: { lang: 'fr' } });

      const result = await registry.getMemory('acme');

      expect(result).toEqual({ settings: { theme: 'dark', lang: 'fr' } });
    });

    it('returns empty object when all layers are empty', async () => {
      const result = await registry.getMemory();

      expect(result).toEqual({});
    });
  });

  describe('appendNamespaceMemory', () => {
    it('appends entry to existing episodic array', async () => {
      const existing: EpisodicEntry = {
        timestamp: '2025-01-01T00:00:00Z',
        source: 'init',
        content: 'First entry',
      };
      store.namespaces.set('acme', { episodic: [existing], tone: 'formal' });

      const newEntry: EpisodicEntry = {
        timestamp: '2025-03-01T00:00:00Z',
        source: 'meeting',
        content: 'Action items discussed',
      };

      await registry.appendNamespaceMemory('acme', newEntry);

      const stored = store.namespaces.get('acme')!;
      expect(stored.episodic).toEqual([existing, newEntry]);
      expect(stored.tone).toBe('formal');
    });

    it('creates episodic array when none exists', async () => {
      store.namespaces.set('acme', { tone: 'casual' });

      const entry: EpisodicEntry = {
        timestamp: '2025-03-01T00:00:00Z',
        source: 'meeting',
        content: 'Notes',
      };

      await registry.appendNamespaceMemory('acme', entry);

      const stored = store.namespaces.get('acme')!;
      expect(stored.episodic).toEqual([entry]);
      expect(stored.tone).toBe('casual');
    });

    it('creates namespace memory when it does not exist', async () => {
      const entry: EpisodicEntry = {
        timestamp: '2025-03-01T00:00:00Z',
        source: 'meeting',
        content: 'Notes',
      };

      await registry.appendNamespaceMemory('newns', entry);

      const stored = store.namespaces.get('newns')!;
      expect(stored.episodic).toEqual([entry]);
    });
  });
});
