// services/api/src/site-facts/image-context/store.ts
//
// Single-file atomic write for image-context.md — same temp-then-rename
// pattern used across this repo's other stores.

import { rename, writeFile } from 'node:fs/promises';

export async function writeImageContextDoc(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, contents, 'utf-8');
  await rename(tmpPath, filePath);
}
