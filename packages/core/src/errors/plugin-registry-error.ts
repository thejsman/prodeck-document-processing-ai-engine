export type PluginType = 'extractor' | 'processor' | 'exporter' | 'presenter';

export type PluginRegistryCode = 'DUPLICATE_PLUGIN' | 'PLUGIN_NOT_FOUND';

export interface PluginRegistryErrorDetails {
  code: PluginRegistryCode;
  message: string;
  pluginType: PluginType;
  pluginName: string;
  stepIndex?: number;
}

export class PluginRegistryError extends Error {
  public readonly code: PluginRegistryCode;
  public readonly pluginType: PluginType;
  public readonly pluginName: string;
  public readonly stepIndex: number | undefined;

  constructor(details: PluginRegistryErrorDetails) {
    super(details.message);
    this.name = 'PluginRegistryError';
    this.code = details.code;
    this.pluginType = details.pluginType;
    this.pluginName = details.pluginName;
    this.stepIndex = details.stepIndex;
  }
}
