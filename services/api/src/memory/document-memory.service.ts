import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryFileEntry, MemoryFileType } from './document-memory.types.js';

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n\n?/;

// Per-client folder of discrete, relevance-scannable memory documents —
// one per uploaded file, plus a single derived chat-knowledge doc and a
// single derived site-crawl doc. Sits alongside (not inside) memory.json;
// see docs/chat-redevelopment-spec-v3.md context in CLAUDE.md for why the
// two systems stay separate.
export class DocumentMemoryService {
  constructor(private readonly workdir: string) {}

  memoryDir(clientSlug: string): string {
    return path.join(this.workdir, 'clients', clientSlug, 'memory');
  }

  private indexPath(clientSlug: string): string {
    return path.join(this.memoryDir(clientSlug), 'index.json');
  }

  private filePath(clientSlug: string, id: string): string {
    return path.join(this.memoryDir(clientSlug), `${id}.md`);
  }

  async readIndex(clientSlug: string): Promise<MemoryFileEntry[]> {
    try {
      const raw = await readFile(this.indexPath(clientSlug), 'utf-8');
      return JSON.parse(raw) as MemoryFileEntry[];
    } catch {
      return [];
    }
  }

  private async writeIndex(clientSlug: string, entries: MemoryFileEntry[]): Promise<void> {
    await mkdir(this.memoryDir(clientSlug), { recursive: true });
    await writeFile(this.indexPath(clientSlug), JSON.stringify(entries, null, 2));
  }

  /** Writes/overwrites one memory file (with frontmatter meta) and upserts its index entry. */
  async upsertFile(
    clientSlug: string,
    opts: {
      id: string;
      type: MemoryFileType;
      fileName: string;
      description: string;
      markdown: string;
      sourceId?: string;
    },
  ): Promise<MemoryFileEntry> {
    const dir = this.memoryDir(clientSlug);
    await mkdir(dir, { recursive: true });
    const updatedAt = new Date().toISOString();

    const frontmatter = [
      '---',
      `type: ${opts.type}`,
      `description: ${JSON.stringify(opts.description)}`,
      ...(opts.sourceId ? [`sourceId: ${opts.sourceId}`] : []),
      `updatedAt: ${updatedAt}`,
      '---',
      '',
    ].join('\n');

    const filePath = this.filePath(clientSlug, opts.id);
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, `${frontmatter}\n${opts.markdown}`, 'utf-8');
    await rename(tmpPath, filePath);

    const entry: MemoryFileEntry = {
      id: opts.id,
      type: opts.type,
      fileName: opts.fileName,
      description: opts.description,
      updatedAt,
      ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
    };

    const entries = await this.readIndex(clientSlug);
    const idx = entries.findIndex((e) => e.id === opts.id);
    if (idx !== -1) entries[idx] = entry;
    else entries.push(entry);
    await this.writeIndex(clientSlug, entries);

    return entry;
  }

  /** Full markdown body of one file, frontmatter stripped — for prompt injection. */
  async getFileContent(clientSlug: string, id: string): Promise<string | null> {
    try {
      const raw = await readFile(this.filePath(clientSlug, id), 'utf-8');
      return raw.replace(FRONTMATTER_RE, '');
    } catch {
      return null;
    }
  }

  async removeBySourceId(clientSlug: string, sourceId: string): Promise<void> {
    const entries = await this.readIndex(clientSlug);
    const match = entries.find((e) => e.sourceId === sourceId);
    if (!match) return;
    await this.writeIndex(clientSlug, entries.filter((e) => e.id !== match.id));
    await rm(this.filePath(clientSlug, match.id), { force: true });
  }
}
