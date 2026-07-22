export type MemoryFileType = 'upload' | 'chat' | 'site-crawl';

export interface MemoryFileEntry {
  id: string;
  type: MemoryFileType;
  fileName: string;
  description: string;
  updatedAt: string;
  sourceId?: string;
}
