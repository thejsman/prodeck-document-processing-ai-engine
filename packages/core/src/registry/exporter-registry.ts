import { PluginRegistryError } from '../errors/plugin-registry-error.js';

export interface Exporter {
  readonly name: string;
}

export class ExporterRegistry {
  private readonly exporters = new Map<string, Exporter>();

  register(exporter: Exporter): void {
    if (this.exporters.has(exporter.name)) {
      throw new PluginRegistryError({
        code: 'DUPLICATE_PLUGIN',
        message: `Exporter "${exporter.name}" is already registered`,
        pluginType: 'exporter',
        pluginName: exporter.name,
      });
    }
    this.exporters.set(exporter.name, exporter);
  }

  get(name: string, stepIndex?: number): Exporter {
    const exporter = this.exporters.get(name);
    if (exporter === undefined) {
      throw new PluginRegistryError({
        code: 'PLUGIN_NOT_FOUND',
        message: `Exporter "${name}" is not registered`,
        pluginType: 'exporter',
        pluginName: name,
        stepIndex,
      });
    }
    return exporter;
  }
}
