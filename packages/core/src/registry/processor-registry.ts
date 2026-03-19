import { PluginRegistryError } from '../errors/plugin-registry-error.js';

export interface Processor {
  readonly name: string;
}

export class ProcessorRegistry {
  private readonly processors = new Map<string, Processor>();

  register(processor: Processor): void {
    if (this.processors.has(processor.name)) {
      throw new PluginRegistryError({
        code: 'DUPLICATE_PLUGIN',
        message: `Processor "${processor.name}" is already registered`,
        pluginType: 'processor',
        pluginName: processor.name,
      });
    }
    this.processors.set(processor.name, processor);
  }

  get(name: string, stepIndex?: number): Processor {
    const processor = this.processors.get(name);
    if (processor === undefined) {
      throw new PluginRegistryError({
        code: 'PLUGIN_NOT_FOUND',
        message: `Processor "${name}" is not registered`,
        pluginType: 'processor',
        pluginName: name,
        stepIndex,
      });
    }
    return processor;
  }
}
