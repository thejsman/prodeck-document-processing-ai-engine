/**
 * Custom hook for consuming SSE from a POST endpoint.
 *
 * Uses fetch() + ReadableStream to read server-sent events
 * from POST /query (EventSource only supports GET).
 */

import { useState, useCallback, useRef } from 'react';

export interface ProposalSection {
  section: string;
  content: string;
  artifactId: string;
}

interface UseSSEReturn {
  chunks: string;
  phase: string;
  isStreaming: boolean;
  error: string | null;
  sections: ProposalSection[];
  startStream: (body: Record<string, unknown>) => void;
  reset: () => void;
}

export function useSSE(apiKey: string, url: string): UseSSEReturn {
  const [chunks, setChunks] = useState('');
  const [phase, setPhase] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(
    (body: Record<string, unknown>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setChunks('');
      setPhase('');
      setError(null);
      setSections([]);
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

                if (currentEvent === 'phase') {
                  try {
                    const parsed = JSON.parse(payload) as { phase?: string };
                    if (parsed.phase) setPhase(parsed.phase);
                  } catch { /* ignore */ }
                  currentEvent = '';
                  continue;
                }

                if (currentEvent === 'proposal_section') {
                  try {
                    const parsed = JSON.parse(payload) as ProposalSection;
                    if (parsed.section && parsed.artifactId) {
                      setSections((prev) => [...prev, parsed]);
                    }
                  } catch { /* ignore malformed payload */ }
                  currentEvent = '';
                  continue;
                }

                if (currentEvent === 'done') {
                  setPhase('');
                  // Fallback: if no tokens streamed (e.g. Ollama buffered mode),
                  // use the answer/message from the done payload so the response isn't lost.
                  try {
                    const parsed = JSON.parse(payload) as { answer?: string; message?: string };
                    const text = parsed.message ?? parsed.answer ?? '';
                    if (text) setChunks((prev) => prev || text);
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
    setPhase('');
    setError(null);
    setSections([]);
    setIsStreaming(false);
  }, []);

  return { chunks, phase, isStreaming, error, sections, startStream, reset };
}
