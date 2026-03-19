/**
 * Custom hook for consuming SSE from a POST endpoint.
 *
 * Uses fetch() + ReadableStream to read server-sent events
 * from POST /query (EventSource only supports GET).
 */

import { useState, useCallback, useRef } from 'react';

interface UseSSEReturn {
  chunks: string;
  isStreaming: boolean;
  error: string | null;
  startStream: (body: Record<string, unknown>) => void;
  reset: () => void;
}

export function useSSE(apiKey: string, url: string): UseSSEReturn {
  const [chunks, setChunks] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(
    (body: Record<string, unknown>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setChunks('');
      setError(null);
      setIsStreaming(true);

      (async () => {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ ...body, stream: true }),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let currentEvent = '';

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const payload = line.slice(6);

                if (currentEvent === 'error') {
                  try {
                    const parsed = JSON.parse(payload) as { error?: string };
                    throw new Error(parsed.error ?? 'Unknown error');
                  } catch (parseErr) {
                    if (parseErr instanceof SyntaxError) {
                      throw new Error(payload);
                    }
                    throw parseErr;
                  }
                }

                if (currentEvent === 'done') {
                  // Fallback: if no tokens streamed (e.g. Ollama buffered mode),
                  // use the answer from the done payload so the response isn't lost.
                  try {
                    const parsed = JSON.parse(payload) as { answer?: string };
                    if (parsed.answer) {
                      setChunks((prev) => prev || parsed.answer!);
                    }
                  } catch { /* ignore malformed done payload */ }
                  currentEvent = '';
                  continue;
                }

                // Plain token chunk.
                try {
                  const parsed = JSON.parse(payload) as string | { answer: string };
                  if (typeof parsed === 'string') {
                    setChunks((prev) => prev + parsed);
                  }
                } catch {
                  setChunks((prev) => prev + payload);
                }

                currentEvent = '';
              } else if (line === '') {
                // Blank line resets the event field per SSE spec.
                currentEvent = '';
              }
            }
          }
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            setError((err as Error).message);
          }
        } finally {
          setIsStreaming(false);
        }
      })();
    },
    [apiKey, url],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setChunks('');
    setError(null);
    setIsStreaming(false);
  }, []);

  return { chunks, isStreaming, error, startStream, reset };
}
