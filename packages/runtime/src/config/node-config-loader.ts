/**
 * Node.js-backed factory for FileConfigLoader.
 *
 * Wires the core FileConfigLoader to the real Node.js filesystem so that
 * the runtime can resolve configuration without core knowing about fs.
 *
 * Expected directory layout under `basePath`:
 *
 *   global.json
 *   org.json
 *   namespaces/<namespace>.json
 *   users/<userId>.json
 */

import { readFile } from 'node:fs/promises';
import { FileConfigLoader } from '@ai-engine/core';

/**
 * Creates a FileConfigLoader backed by the real Node.js `fs.readFile`.
 * Missing files are returned as `undefined` (ENOENT is swallowed).
 */
export function createNodeConfigLoader(basePath: string): FileConfigLoader {
  const readFileFn = async (path: string): Promise<string | undefined> => {
    try {
      return await readFile(path, 'utf-8');
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return undefined;
      throw err;
    }
  };

  return new FileConfigLoader(basePath, readFileFn);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
