/**
 * Usage tracking abstraction.
 *
 * Core defines the event shape and recorder interface.
 * Concrete implementations (file-based JSONL writer, etc.) live in the
 * runtime layer or service layer where filesystem access is allowed.
 *
 * Each event is a single JSON object. Callers serialize one event per line
 * into data/usage/events.jsonl.
 *
 * Usage enforcement (credits, quotas) is NOT implemented here.
 * This is pure event recording.
 */

export interface UsageEvent {
  user?: string;
  namespace: string;
  agent: string;
  tokensUsed?: number;
  timestamp: string;
}

export interface UsageRecorder {
  record(event: UsageEvent): Promise<void>;
}

/**
 * Factory: wraps any async line-appending function into a UsageRecorder.
 *
 * The `appendLine` function is injected by the caller (runtime / service layer).
 * Core stays pure — it never calls fs.appendFile directly.
 *
 * Example usage in API:
 *   const recorder = createUsageRecorder(async (line) => {
 *     await fs.appendFile(eventsPath, line + '\n', 'utf-8');
 *   });
 */
export function createUsageRecorder(
  appendLine: (line: string) => Promise<void>,
): UsageRecorder {
  return {
    async record(event: UsageEvent): Promise<void> {
      await appendLine(JSON.stringify(event));
    },
  };
}

/** No-op recorder — for tests and CLI contexts that don't need persistence. */
export const noopUsageRecorder: UsageRecorder = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async record(_event: UsageEvent): Promise<void> {
    // intentional no-op
  },
};
