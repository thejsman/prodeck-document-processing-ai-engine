import type { Logger } from '@ai-engine/runtime';

export function createConsoleReporter(): Logger {
  return {
    info(message: string) {
      process.stderr.write(`[info] ${message}\n`);
    },
    error(message: string) {
      process.stderr.write(`[error] ${message}\n`);
    },
  };
}

function isStructuredError(
  error: unknown,
): error is Error & { code: string } {
  return (
    error instanceof Error &&
    typeof (error as unknown as Record<string, unknown>).code === 'string'
  );
}

export function formatError(error: unknown): string {
  if (isStructuredError(error)) {
    return `${error.name} [${error.code}]: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
