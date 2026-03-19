export type PythonPluginCode =
  | 'SPAWN_FAILED'
  | 'PROCESS_ERROR'
  | 'INVALID_OUTPUT'
  | 'TIMEOUT';

export interface PythonPluginErrorDetails {
  code: PythonPluginCode;
  message: string;
  pluginName: string;
  stderr?: string;
  exitCode?: number;
}

export class PythonPluginError extends Error {
  public readonly code: PythonPluginCode;
  public readonly pluginName: string;
  public readonly stderr: string | undefined;
  public readonly exitCode: number | undefined;

  constructor(details: PythonPluginErrorDetails) {
    super(details.message);
    this.name = 'PythonPluginError';
    this.code = details.code;
    this.pluginName = details.pluginName;
    this.stderr = details.stderr;
    this.exitCode = details.exitCode;
  }
}
