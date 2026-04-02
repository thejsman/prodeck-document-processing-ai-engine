'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types (mirrors TraceEvent in services/api/src/trace/trace-store.ts)
// ---------------------------------------------------------------------------

type TraceEventType = 'state' | 'tool' | 'agent' | 'error' | 'artifact';

interface TraceEvent {
  timestamp: number;
  type: TraceEventType;
  name: string;
  data?: unknown;
}

interface TraceResponse {
  events: TraceEvent[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const TYPE_LABELS: Record<TraceEventType, string> = {
  state: 'STATE',
  tool: 'TOOL',
  agent: 'AGENT',
  error: 'ERROR',
  artifact: 'ARTIFACT',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  chatSessionId: string;
  apiKey: string;
  /** When true, the panel polls every 2 s for new events. */
  live?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutionTracePanel({ chatSessionId, apiKey, live = false }: Props) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchTrace() {
    try {
      const res = await fetch(`/api/chat/trace/${chatSessionId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as TraceResponse;
      setEvents(data.events);
      setNote(data.note ?? null);
    } catch {
      // Network errors are silent — trace panel is diagnostic only
    } finally {
      setLoading(false);
    }
  }

  // Initial load + optional live polling
  useEffect(() => {
    void fetchTrace();

    if (live) {
      intervalRef.current = setInterval(() => void fetchTrace(), 2_000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSessionId, live]);

  // Scroll to bottom when new events arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <aside className="trace-panel">
      <div className="trace-panel-header">
        <span className="trace-panel-title">Execution Trace</span>
        <div className="trace-panel-meta">
          {live && <span className="trace-panel-live">● LIVE</span>}
          <button
            className="trace-panel-refresh"
            onClick={() => void fetchTrace()}
            title="Refresh trace"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="trace-panel-body">
        {loading ? (
          <div className="trace-panel-empty">Loading trace…</div>
        ) : note ? (
          <div className="trace-panel-disabled">{note}</div>
        ) : events.length === 0 ? (
          <div className="trace-panel-empty">No events recorded yet.</div>
        ) : (
          <>
            {/* Column headers */}
            <div className="trace-row trace-row--header" aria-hidden>
              <span className="trace-col trace-col-time">Time</span>
              <span className="trace-col trace-col-type">Type</span>
              <span className="trace-col trace-col-name">Name</span>
            </div>

            {events.map((ev, i) => (
              <div key={i}>
                <button
                  className={`trace-row trace-row--${ev.type}${expandedIndex === i ? ' trace-row--expanded' : ''}`}
                  onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                  aria-expanded={expandedIndex === i}
                >
                  <span className="trace-col trace-col-time">{formatTime(ev.timestamp)}</span>
                  <span className={`trace-col trace-col-type trace-badge trace-badge--${ev.type}`}>
                    {TYPE_LABELS[ev.type] ?? ev.type.toUpperCase()}
                  </span>
                  <span className="trace-col trace-col-name">{ev.name}</span>
                  {ev.data !== undefined && (
                    <span className="trace-col trace-col-expand" aria-hidden>▾</span>
                  )}
                </button>

                {expandedIndex === i && ev.data !== undefined && (
                  <pre className="trace-detail">
                    {JSON.stringify(ev.data, null, 2)}
                  </pre>
                )}

                {/* Separator line between sections */}
                {ev.type === 'state' && <hr className="trace-separator" />}
              </div>
            ))}

            <div ref={bottomRef} />
          </>
        )}
      </div>
    </aside>
  );
}
