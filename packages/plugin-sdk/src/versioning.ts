/** Current SDK version shipped with this runtime */
export const RUNTIME_SDK_VERSION = '0.1.0';

export interface CompatibilityResult {
  compatible: boolean;
  reason?: string;
}

/**
 * Check whether a plugin's declared sdkVersion is compatible with the runtime.
 *
 * Compatibility rule: only the **major** version must match.
 * A plugin declaring sdkVersion "0.1" is compatible with runtime "0.1.x" but
 * NOT with "1.0.0" (major bump = breaking change).
 *
 * @param pluginSdkVersion  The `sdkVersion` field from the plugin's manifest
 * @param runtimeSdkVersion Defaults to `RUNTIME_SDK_VERSION`
 */
export function checkSdkCompatibility(
  pluginSdkVersion: string,
  runtimeSdkVersion: string = RUNTIME_SDK_VERSION,
): CompatibilityResult {
  const pluginMajor = parseMajor(pluginSdkVersion);
  const runtimeMajor = parseMajor(runtimeSdkVersion);

  if (pluginMajor === null) {
    return { compatible: false, reason: `Invalid plugin sdkVersion: "${pluginSdkVersion}"` };
  }
  if (runtimeMajor === null) {
    return { compatible: false, reason: `Invalid runtime sdkVersion: "${runtimeSdkVersion}"` };
  }
  if (pluginMajor !== runtimeMajor) {
    return {
      compatible: false,
      reason: `SDK major version mismatch: plugin requires ${pluginMajor}, runtime provides ${runtimeMajor}`,
    };
  }
  return { compatible: true };
}

function parseMajor(version: string): number | null {
  const match = version.match(/^(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}
