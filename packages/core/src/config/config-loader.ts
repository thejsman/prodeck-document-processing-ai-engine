import type { CoreConfig, ConfigLoader } from './config-types.js';

/**
 * A read-file function injected by the caller (runtime layer).
 *
 * Must return the file contents as a string, or `undefined` / `null`
 * if the file does not exist. Must NOT throw on missing files.
 */
export type ReadFileFn = (
  path: string,
) => Promise<string | undefined | null>;

/**
 * Filesystem-backed ConfigLoader built from a pure function.
 *
 * Core itself never touches the filesystem.
 * The caller supplies `readFile` and `basePath`;
 * this class maps config layer requests to file paths
 * and parses the JSON.
 *
 * Expected directory layout under `basePath`:
 *
 *   global.json
 *   org.json
 *   namespaces/<namespace>.json
 *   users/<userId>.json
 */
export class FileConfigLoader implements ConfigLoader {
  private readonly basePath: string;
  private readonly readFile: ReadFileFn;

  constructor(basePath: string, readFile: ReadFileFn) {
    this.basePath = basePath;
    this.readFile = readFile;
  }

  async loadGlobal(): Promise<Partial<CoreConfig>> {
    return this.load(`${this.basePath}/global.json`);
  }

  async loadOrg(): Promise<Partial<CoreConfig>> {
    return this.load(`${this.basePath}/org.json`);
  }

  async loadNamespace(namespace: string): Promise<Partial<CoreConfig>> {
    return this.load(`${this.basePath}/namespaces/${namespace}.json`);
  }

  async loadUser(userId: string): Promise<Partial<CoreConfig>> {
    return this.load(`${this.basePath}/users/${userId}.json`);
  }

  private async load(path: string): Promise<Partial<CoreConfig>> {
    const content = await this.readFile(path);
    if (content == null || content.trim() === '') {
      return {};
    }
    return JSON.parse(content) as Partial<CoreConfig>;
  }
}
