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

export interface ToolEvent {
  status: 'started' | 'completed' | 'failed';
  tool: string;
  /** Timestamp added client-side for ordering */
  ts: number;
}

export interface EntityToConfirm {
  field: string;
  value: string;
  source: 'document' | 'inferred';
  confidence: number;
}

export interface OptionalFieldToFill {
  field: string;
  question: string;
}

export type ConfirmationRequest =
  | {
      kind: 'confirm_entities';
      entities: EntityToConfirm[];
      optionalFields: OptionalFieldToFill[];
    }
  | {
      kind: 'confirm_template';
      templateId: string;
      templateName: string;
      confidence: number;
      reasoning: string;
      sections: string[];
    }
  | {
      kind: 'approve_generated_template';
      templateSlug: string;
      templateName: string;
      sections: string[];
      viewLink: string;
    };

interface UseSSEReturn {
  chunks: string;
  phase: string;
  isStreaming: boolean;
  error: string | null;
  sections: ProposalSection[];
  toolEvents: ToolEvent[];
  doneActions: Record<string, string> | null;
  confirmationRequest: ConfirmationRequest | null;
  questionsRequest: Array<{ field: string; question: string }> | null;
  startStream: (body: Record<string, unknown>) => void;
  reset: () => void;
}

export function useSSE(apiKey: string, url: string): UseSSEReturn {
  const [chunks, setChunks] = useState('');
  const [phase, setPhase] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [doneActions, setDoneActions] = useState<Record<string, string> | null>(null);
  const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null);
  const [questionsRequest, setQuestionsRequest] = useState<Array<{ field: string; question: string }> | null>(null);
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
      setToolEvents([]);
      setDoneActions(null);
      setConfirmationRequest(null);
      setQuestionsRequest(null);
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

                if (currentEvent === 'tool_progress') {
                  try {
                    const parsed = JSON.parse(payload) as { status?: string; tool?: string };
                    if (parsed.tool && parsed.status) {
                      // Normalize server phase names ('start'|'complete'|'error') to
                      // the frontend's ToolEvent status vocabulary.
                      const STATUS_MAP: Record<string, ToolEvent['status']> = {
                        start: 'started',
                        complete: 'completed',
                        error: 'failed',
                      };
                      const status = STATUS_MAP[parsed.status] ?? (parsed.status as ToolEvent['status']);
                      setToolEvents((prev) => [
                        ...prev,
                        { status, tool: parsed.tool!, ts: Date.now() },
                      ]);
                    }
                  } catch { /* ignore */ }
                  currentEvent = '';
                  continue;
                }

                if (currentEvent === 'confirmation_request') {
                  try {
                    const parsed = JSON.parse(payload) as ConfirmationRequest;
                    if (parsed.kind) setConfirmationRequest(parsed);
                  } catch { /* ignore */ }
                  currentEvent = '';
                  continue;
                }

                if (currentEvent === 'questions_request') {
                  try {
                    const parsed = JSON.parse(payload) as Array<{ field: string; question: string }>;
                    if (Array.isArray(parsed)) setQuestionsRequest(parsed);
                  } catch { /* ignore */ }
                  currentEvent = '';
                  continue;
                }

                if (currentEvent === 'done') {
                  setPhase('');
                  // Fallback: if no tokens streamed (e.g. Ollama buffered mode),
                  // use the answer/message from the done payload so the response isn't lost.
                  try {
                    const parsed = JSON.parse(payload) as { answer?: string; message?: string; actions?: Record<string, string> };
                    const text = parsed.message ?? parsed.answer ?? '';
                    if (text) setChunks((prev) => prev || text);
                    if (parsed.actions) setDoneActions(parsed.actions);
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
    setToolEvents([]);
    setDoneActions(null);
    setConfirmationRequest(null);
    setQuestionsRequest(null);
    setIsStreaming(false);
  }, []);

  return { chunks, phase, isStreaming, error, sections, toolEvents, doneActions, confirmationRequest, questionsRequest, startStream, reset };
}
