/**
 * Minimal extension → MIME type map for asset serving.
 * Used by the download endpoint and asset metadata generation.
 */
export const MIME_TYPES: Readonly<Record<string, string>> = {
  // Documents
  '.md':   'text/markdown',
  '.mdx':  'text/mdx',
  '.txt':  'text/plain',
  '.html': 'text/html',
  '.htm':  'text/html',
  '.csv':  'text/csv',
  // Data
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml':  'application/yaml',
  '.xml':  'application/xml',
  // Diagrams / code
  '.mmd':  'text/x-mermaid',
  '.dot':  'text/vnd.graphviz',
  '.js':   'application/javascript',
  '.ts':   'text/typescript',
  '.css':  'text/css',
  // Images
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  // Documents
  '.pdf':  'application/pdf',
  '.zip':  'application/zip',
};

export function getMimeType(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = fileName.slice(dot).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}
