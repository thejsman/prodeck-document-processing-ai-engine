import { PluginRegistryError } from '../errors/plugin-registry-error.js';

export interface Extractor {
  readonly name: string;
}

export class ExtractorRegistry {
  private readonly extractors = new Map<string, Extractor>();

  register(extractor: Extractor): void {
    if (this.extractors.has(extractor.name)) {
      throw new PluginRegistryError({
        code: 'DUPLICATE_PLUGIN',
        message: `Extractor "${extractor.name}" is already registered`,
        pluginType: 'extractor',
        pluginName: extractor.name,
      });
    }
    this.extractors.set(extractor.name, extractor);
  }

  get(name: string, stepIndex?: number): Extractor {
    const extractor = this.extractors.get(name);
    if (extractor === undefined) {
      throw new PluginRegistryError({
        code: 'PLUGIN_NOT_FOUND',
        message: `Extractor "${name}" is not registered`,
        pluginType: 'extractor',
        pluginName: name,
        stepIndex,
      });
    }
    return extractor;
  }
}
