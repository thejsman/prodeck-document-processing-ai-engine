// services/api/src/site-facts/design/design-store.ts
//
// Single-file atomic write for the design-system doc — same temp-then-rename
// pattern as ../store.ts. This module produces exactly one artifact
// (design-system.md, tokens embedded inside it); nothing else is persisted.

import { rename, writeFile } from 'node:fs/promises';

export async function writeDesignSystemDoc(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, contents, 'utf-8');
  await rename(tmpPath, filePath);
}
