'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { useSSE } from '@/lib/use-sse';
import { ChatUploadDrawer } from '@/components/ChatUploadDrawer';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { ChatContextPanel } from '@/components/chat/ChatContextPanel';

// ── Types ──────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// ── Page ───────────────────────────────────────────────────────────

// ── System query interception ───────────────────────────────────
// Certain factual questions about system state (namespaces, indexed docs, etc.)
// must be answered from the API directly — RAG will hallucinate these.

interface SystemQueryHandler {
  pattern: RegExp;
  fetch: (apiKey: string, namespace: string) => Promise<string>;
}

const SYSTEM_QUERIES: SystemQueryHandler[] = [
  {
    pattern: /\b(what|list|show|which).*(namespace|namespaces)\b|\bnamespaces.*(available|exist|have)\b/i,
    fetch: async (apiKey) => {
      const res = await fetch('/api/namespaces', { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) return 'Could not retrieve namespaces.';
      const data = await res.json() as { namespaces?: string[] };
      const list = data.namespaces ?? [];
      if (list.length === 0) return 'No namespaces found. Create one to get started.';
      return `Available namespaces:\n\n${list.map((n) => `- \`${n}\``).join('\n')}`;
    },
  },
];

async function trySystemQuery(
  q: string,
  apiKey: string,
  namespace: string,
): Promise<string | null> {
  for (const handler of SYSTEM_QUERIES) {
    if (handler.pattern.test(q)) {
      return handler.fetch(apiKey, namespace);
    }
  }
  return null;
}

// ── Session helpers ─────────────────────────────────────────────

function getOrCreateSessionId(namespace: string): string {
  const key = `chat-session-id-${namespace}`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(key, id);
  return id;
}

export default function ChatPage() {
  const { apiKey } = useAuth();
  const { namespace } = useNamespace();
  const router = useRouter();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);
  const [insights, setInsights] = useState<string[]>([]);

  const chatSessionIdRef = useRef<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rafRef = useRef<number | null>(null);
  const revealedLenRef = useRef(0);

  const { chunks, isStreaming, error, startStream, reset } = useSSE(apiKey, '/api/query');

  const fetchInsights = useCallback((ns: string) => {
    fetch(`/api/namespace/${encodeURIComponent(ns)}/insights`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((data: { suggestions: string[] }) => setInsights(data.suggestions ?? []))
      .catch(() => { /* insights unavailable — leave as-is */ });
  }, [apiKey]);

  // Load persisted chat history and initial insights on mount (or namespace change)
  useEffect(() => {
    const ns = namespace || 'default';
    const sessionId = getOrCreateSessionId(ns);
    chatSessionIdRef.current = sessionId;

    fetch(`/api/chat/session/${sessionId}/history?namespace=${encodeURIComponent(ns)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data: { messages: Array<{ id: string; role: 'user' | 'assistant'; content: string }> }) => {
        if (data.messages.length > 0) {
          setMessages(data.messages);
        }
      })
      .catch(() => { /* history unavailable — start fresh */ });

    fetchInsights(ns);
  }, [namespace, apiKey, fetchInsights]);

  // Refresh insights after each query completes (isStreaming: true → false)
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      fetchInsights(namespace || 'default');
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, namespace, fetchInsights]);

  // Typewriter: gradually reveal chunks so tokens appear one by one
  // even when the OS pipe delivers them in bulk batches.
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    if (!chunks) {
      revealedLenRef.current = 0;
      setDisplayed('');
      return;
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const animate = () => {
      const current = revealedLenRef.current;
      if (current >= chunks.length) return;
      // ~4 chars per frame ≈ 240 chars/sec at 60 fps — feels natural
      const next = Math.min(current + 2, chunks.length);
      revealedLenRef.current = next;
      setDisplayed(chunks.slice(0, next));
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [chunks]);

  // Auto-scroll when messages or displayed text changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, displayed]);

  // Auto-grow textarea
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const submit = useCallback(() => {
    const q = input.trim();
    if (!q || isStreaming) return;

    // Commit any in-progress streaming response to history
    if (chunks) {
      setMessages((prev) => [...prev, { id: `assistant-${Date.now()}`, role: 'assistant', content: chunks }]);
      reset();
    }

    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: q }]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const ns = namespace || 'default';

    // Intercept system queries — answer from API directly, skip RAG
    trySystemQuery(q, apiKey, ns).then((answer) => {
      if (answer !== null) {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: 'assistant', content: answer },
        ]);
        return;
      }
      startStream({ question: q, namespace: ns, chatSessionId: chatSessionIdRef.current ?? undefined });
    });
  }, [input, isStreaming, chunks, namespace, apiKey, reset, startStream]);

  function handleClear() {
    // Rotate to a new session ID so the fresh chat has clean history
    const ns = namespace || 'default';
    const newId = crypto.randomUUID();
    localStorage.setItem(`chat-session-id-${ns}`, newId);
    chatSessionIdRef.current = newId;
    setMessages([]);
    reset();
    setDisplayed('');
    revealedLenRef.current = 0;
    textareaRef.current?.focus();
  }

  function handleSuggestion(text: string) {
    setInput(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  const hasContent = messages.length > 0 || !!chunks;

  return (
    <div className="chat-v2">
      {/* ── Header ── */}
      <header className="chat-v2-header">
        <div className="chat-v2-header-left">
          <span className="chat-v2-ns">{namespace || 'default'}</span>
          <span className="chat-v2-status">
            <span className="chat-v2-status-dot" />
            Connected
          </span>
        </div>

        <div className="chat-v2-header-right">
          <button className="chat-v2-action-btn" onClick={() => setShowUpload((v) => !v)}>
            <span>⬆</span>
            <span>Upload</span>
          </button>
          <button className="chat-v2-action-btn" onClick={() => router.push('/proposal')}>
            <span>◧</span>
            <span>Proposal</span>
          </button>
          <button className="chat-v2-action-btn" onClick={() => router.push('/presentation')}>
            <span>▣</span>
            <span>Microsite</span>
          </button>
          {hasContent && (
            <button className="chat-v2-clear-btn" onClick={handleClear} disabled={isStreaming}>
              Clear
            </button>
          )}
          <button
            className={`chat-v2-panel-toggle${contextOpen ? ' active' : ''}`}
            onClick={() => setContextOpen((v) => !v)}
            title={contextOpen ? 'Hide panel' : 'Show context panel'}
          >
            ◫
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="chat-v2-body">
        {/* Main column */}
        <div className="chat-v2-main">
          {/* Messages */}
          <div className="chat-v2-messages">
            {!hasContent ? (
              <ChatEmptyState namespace={namespace} onSuggestion={handleSuggestion} insights={insights} />
            ) : (
              <>
                {messages.map((m, i) => (
                  <div
                    key={m.id}
                    className={`chat-v2-message chat-v2-message--${m.role}`}
                    style={{ '--msg-i': i } as React.CSSProperties}
                  >
                    {m.role === 'assistant' && <div className="chat-v2-avatar">AI</div>}
                    <div className="chat-v2-bubble">
                      {m.role === 'assistant' ? (
                        <div className="prose">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}

                {/* Live streaming response */}
                {chunks && (
                  <div
                    className="chat-v2-message chat-v2-message--assistant"
                    style={{ '--msg-i': messages.length } as React.CSSProperties}
                  >
                    <div className="chat-v2-avatar">AI</div>
                    <div className="chat-v2-bubble">
                      {isStreaming || displayed.length < chunks.length ? (
                        <>
                          <span className="chat-stream-text">{displayed}</span>
                          <span className="chat-cursor" />
                        </>
                      ) : (
                        <div className="prose">
                          <ReactMarkdown>{displayed}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Thinking indicator — streaming started but no chunks yet */}
                {isStreaming && !chunks && (
                  <div className="chat-v2-message chat-v2-message--assistant">
                    <div className="chat-v2-avatar">AI</div>
                    <div className="chat-v2-bubble chat-v2-bubble--thinking">
                      <span className="chat-thinking-dot" />
                      <span className="chat-thinking-dot" />
                      <span className="chat-thinking-dot" />
                    </div>
                  </div>
                )}

                {error && <div className="chat-v2-error">{error}</div>}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Upload drawer (above composer) */}
          {showUpload && (
            <div className="chat-v2-upload-wrap">
              <ChatUploadDrawer
                namespace={namespace}
                onClose={() => {
                  setShowUpload(false);
                  textareaRef.current?.focus();
                }}
              />
            </div>
          )}

          {/* Input composer */}
          <div className="chat-v2-composer-wrap">
            <div className="chat-v2-composer">
              <button
                type="button"
                className={`chat-v2-attach-btn${showUpload ? ' active' : ''}`}
                onClick={() => setShowUpload((v) => !v)}
                aria-label="Attach files"
              >
                +
              </button>
              <textarea
                ref={textareaRef}
                className="chat-v2-input"
                rows={1}
                placeholder="Ask AI to generate proposal, ingest documents, or analyse knowledge…"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                autoFocus
              />
              <button
                className="chat-v2-send-btn"
                onClick={submit}
                disabled={isStreaming || !input.trim()}
                aria-label="Send"
              >
                {isStreaming ? (
                  <span className="spinner chat-spinner-sm" />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 13V3M3 8l5-5 5 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            </div>
            <p className="chat-v2-composer-hint">↵ send &nbsp;·&nbsp; ⇧↵ newline</p>
          </div>
        </div>

        {/* Context panel */}
        {contextOpen && <ChatContextPanel namespace={namespace} insights={insights} />}
      </div>
    </div>
  );
}
