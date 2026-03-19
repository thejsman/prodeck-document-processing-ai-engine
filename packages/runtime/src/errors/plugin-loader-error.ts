export type PluginLoaderCode =
  | 'FILE_NOT_FOUND'
  | 'MANIFEST_READ_ERROR'
  | 'MANIFEST_INVALID'
  | 'API_VERSION_MISMATCH'
  | 'ENTRY_IMPORT_ERROR'
  | 'INVALID_EXPORT'
  | 'DUPLICATE_PLUGIN_NAME';

export interface PluginLoaderErrorDetails {
  code: PluginLoaderCode;
  message: string;
  pluginPath: string;
  pluginName?: string;
}

export class PluginLoaderError extends Error {
  public readonly code: PluginLoaderCode;
  public readonly pluginPath: string;
  public readonly pluginName: string | undefined;

  constructor(details: PluginLoaderErrorDetails) {
    super(details.message);
    this.name = 'PluginLoaderError';
    this.code = details.code;
    this.pluginPath = details.pluginPath;
    this.pluginName = details.pluginName;
  }
}
