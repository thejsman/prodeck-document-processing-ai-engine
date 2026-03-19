/**
 * save-asset tool
 *
 * Saves generated content to the namespace's storage backend and writes a
 * companion metadata sidecar alongside it.
 *
 * Input:
 *   content                    — file content to save
 *   metadata.fileName          — target file name (e.g. "diagram-1.mmd")
 *   metadata.executionId?      — execution that produced this asset (optional)
 *   metadata.mimeType?         — override auto-detected MIME type (optional)
 *   namespace                  — used to resolve the correct StorageProvider
 *
 * Output:
 *   files     — [uri]        — storage URI of the saved asset (backward compat)
 *   json      — { uri, metaUri }
 *
 * Sidecar convention:
 *   assets/diagram-1.mmd  →  assets/diagram-1.meta.json
 *
 * The `storageProviderFn` is injected at construction time — core stays pure
 * and the tool remains unaware of the storage backend.
 */

import type { Tool, ToolInput, ToolOutput, StorageProvider } from '@ai-engine/core';

// ── Minimal MIME map (no external deps) ──────────────────────────

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.md':   'text/markdown',
  '.mdx':  'text/mdx',
  '.txt':  'text/plain',
  '.html': 'text/html',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml':  'application/yaml',
  '.mmd':  'text/x-mermaid',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf':  'application/pdf',
};

function detectMimeType(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return MIME_TYPES[fileName.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

/** Derive the metadata sidecar path for a given asset path.
 *  "assets/diagram-1.mmd"  →  "assets/diagram-1.meta.json" */
function metaPathFor(relativePath: string): string {
  const dot = relativePath.lastIndexOf('.');
  const stem = dot > 0 ? relativePath.slice(0, dot) : relativePath;
  return `${stem}.meta.json`;
}

// ── Config ────────────────────────────────────────────────────────

export interface SaveAssetConfig {
  /**
   * Factory that returns a StorageProvider scoped to the given namespace.
   * Called at tool-run time with the namespace from AgentInput.
   * Injected by the CLI/API layer for per-namespace storage routing.
   */
  storageProviderFn: (namespace: string) => Promise<StorageProvider> | StorageProvider;
}

// ── Tool ──────────────────────────────────────────────────────────

export class SaveAssetTool implements Tool {
  readonly name = 'save-asset';
  readonly description =
    'Saves generated content (diagrams, documents, etc.) to the namespace storage backend. ' +
    'Returns the storage URI and writes a companion metadata sidecar.';

  private readonly storageProviderFn: SaveAssetConfig['storageProviderFn'];

  constructor(config: SaveAssetConfig) {
    this.storageProviderFn = config.storageProviderFn;
  }

  async run(input: ToolInput): Promise<ToolOutput> {
    const content    = input.content ?? '';
    const fileName   = input.metadata?.fileName as string | undefined;
    const namespace  = input.namespace ?? 'default';
    const executionId = input.metadata?.executionId as string | undefined;

    if (!fileName) {
      throw new Error('save-asset tool requires metadata.fileName');
    }
    if (!content) {
      throw new Error('save-asset tool requires content to save');
    }

    // Reject traversal and absolute paths in fileName
    if (fileName.includes('..') || fileName.startsWith('/')) {
      throw new Error(
        `Invalid file name: "${fileName}". Must not contain ".." or start with "/".`,
      );
    }

    const relativePath = `assets/${fileName}`;
    const provider = await this.storageProviderFn(namespace);

    // ── Write asset ───────────────────────────────────────────────
    const uri = await provider.writeFile(relativePath, content);

    // ── Write metadata sidecar ────────────────────────────────────
    const size = typeof content === 'string'
      ? Buffer.byteLength(content, 'utf-8')
      : (content as Buffer).length;

    const mimeType =
      (input.metadata?.mimeType as string | undefined) ?? detectMimeType(fileName);

    const meta = {
      uri,
      size,
      mimeType,
      ...(executionId !== undefined && { executionId }),
      createdAt: new Date().toISOString(),
      namespace,
    };

    const metaRelativePath = metaPathFor(relativePath);
    const metaUri = await provider.writeFile(metaRelativePath, JSON.stringify(meta, null, 2));

    // ── Return ────────────────────────────────────────────────────
    return {
      // files stays for backward compatibility with agents that read it
      files: [uri],
      // json carries the full asset coordinates
      json: { uri, metaUri },
    };
  }
}
