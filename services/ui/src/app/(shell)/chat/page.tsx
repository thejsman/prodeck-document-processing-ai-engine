'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, PanelRight, LayoutGrid, ArrowUp, Download, Pencil, Plus, X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { useSSE, type ProposalSection } from '@/lib/use-sse';
import { ChatUploadDrawer } from '@/components/ChatUploadDrawer';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { NamespacePanel, parseMicrositeInfo } from '@/components/chat/NamespacePanel';
import { ProposalSectionBlock } from '@/components/chat/ProposalSectionBlock';
import { ExecutionTracePanel } from '@/components/chat/ExecutionTracePanel';
import { ProposalProgressBar } from '@/components/chat/ProposalProgressBar';
import { MemoryEditor } from '@/components/MemoryEditor';
import { ConfigEditor } from '@/components/ConfigEditor';
import { ProposalForm } from '@/components/ProposalForm';
import { fetchMicrositeContent, type ProposalDocument, type Presentation } from '@/lib/api';
import type { LayoutAST } from '@/types/presentation';
import { Microsite, type MicrositeHandle } from '@/components/microsite/Microsite';
import { MicrositeEditor } from '@/components/microsite/editor/MicrositeEditor';
import { ThemeToggle } from '@/components/system/ThemeToggle';
import { useExecutionStore } from '@/core/execution/execution-store';
import { startExecutionTransport } from '@/core/execution/execution-transport';

// ── Types ──────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Populated when the message is a structured proposal stream. */
  sections?: ProposalSection[];
  metadata?: { proposalArtifactId?: string };
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
  const [fileRefreshTick, setFileRefreshTick] = useState(0);
  const [traceOpen, setTraceOpen] = useState(false);
  const [insights, setInsights] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [isGeneratingFromModal, setIsGeneratingFromModal] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<ProposalDocument | null>(null);

  const [viewMicrosite, setViewMicrosite] = useState<Presentation | null>(null);
  const [viewMicrositeAST, setViewMicrositeAST] = useState<LayoutAST | null>(null);
  const [viewMicrositeLoading, setViewMicrositeLoading] = useState(false);
  const [editingMicrosite, setEditingMicrosite] = useState(false);
  const micrositeRef = useRef<MicrositeHandle>(null);

  const chatSessionIdRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rafRef = useRef<number | null>(null);
  const revealedLenRef = useRef(0);

  const { chunks, phase, isStreaming, error, sections, toolEvents, doneActions, startStream, reset } = useSSE(apiKey, '/api/chat/message');

  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const removeExecution = useExecutionStore((s) => s.removeExecution);

  // Tracks the execution ID registered in the store for the current stream's generation task
  const chatExecIdRef = useRef<string | null>(null);

  // Once a phase label arrives in a stream, stay in "proposal stream" mode
  // for the rest of that stream so the progress bar never flickers back to dots.
  const hadPhaseRef = useRef(false);
  if (isStreaming && phase) hadPhaseRef.current = true;
  if (!isStreaming) hadPhaseRef.current = false;

  // Reactive signal: which generation tool is running (null if none).
  // Derived from toolEvents (state) so JSX re-renders when it arrives.
  // Computed early so it can be referenced in the useEffect below.
  const generationTool = toolEvents.find(
    (ev) => ev.tool === 'generate_proposal' || ev.tool === 'generate_microsite',
  )?.tool ?? null;

  // True when this stream included a proposal/microsite generation (V2 path).
  // Stays true after streaming ends so the completion footer renders.
  const hadGenerationTool = toolEvents.some(
    (ev) => ev.tool === 'generate_proposal' || ev.tool === 'generate_microsite',
  );

  // Register a task in the execution store when a proposal/microsite generation tool starts.
  // This makes it show in the "Active Tasks" sidebar and enables the completion notification.
  //
  // Two detection paths:
  //   V2 (CHAT_V2=true): tool_progress SSE events → generationTool is set
  //   V1 (legacy):       proposal_section SSE events → sections.length > 0 (no tool events emitted)
  //
  // NOTE: isStreaming is intentionally NOT in the guard or dependency array.
  // React 18 automatic batching can collapse the final SSE events and setIsStreaming(false)
  // into a single render, so by the time this effect fires, isStreaming may already be false.
  // The chatExecIdRef guard prevents double-registration; the completion effect below handles
  // the immediate-complete case when the stream arrives fully buffered.
  useEffect(() => {
    if (chatExecIdRef.current !== null) return;

    let execType: 'proposal' | 'microsite' | null = null;

    if (generationTool) {
      // V2 path — tool event identifies the generation type
      execType = generationTool === 'generate_microsite' ? 'microsite' : 'proposal';
    } else if (sections.length > 0) {
      // V1 path — proposal_section events indicate proposal generation (V1 has no chat microsite)
      execType = 'proposal';
    }

    if (!execType) return;

    const execId = crypto.randomUUID();
    chatExecIdRef.current = execId;

    addExecution({
      id: execId,
      type: execType,
      status: 'running',
      title: execType === 'microsite' ? 'Generating microsite' : 'Generating proposal',
    });
    startExecutionTransport(apiKey); // idempotent — no-op if already connected
  }, [generationTool, sections.length, addExecution, apiKey]);

  const fetchInsights = useCallback((ns: string) => {
    fetch(`/api/namespace/${encodeURIComponent(ns)}/insights`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((data: { suggestions: string[] }) => setInsights(data.suggestions ?? []))
      .catch(() => { /* insights unavailable — leave as-is */ });
  }, [apiKey]);

  useEffect(() => {
    if (!viewMicrosite || !apiKey) return;
    setViewMicrositeAST(null);
    setViewMicrositeLoading(true);
    fetchMicrositeContent(apiKey, viewMicrosite.namespace, viewMicrosite.proposalId)
      .then(({ ast }) => setViewMicrositeAST(ast as LayoutAST))
      .catch(() => {})
      .finally(() => setViewMicrositeLoading(false));
  }, [viewMicrosite, apiKey]);

  // Load persisted chat history and initial insights on mount (or namespace change)
  useEffect(() => {
    const ns = namespace || 'default';
    const sessionId = getOrCreateSessionId(ns);
    chatSessionIdRef.current = sessionId;

    // Cancel any in-flight generation execution from the previous namespace
    if (chatExecIdRef.current !== null) {
      removeExecution(chatExecIdRef.current);
      chatExecIdRef.current = null;
    }

    // Clear current chat state immediately so the old namespace's messages
    // and insights don't linger while the new namespace's data loads.
    setMessages([]);
    setInsights([]);
    setGeneratedDoc(null);
    reset();
    setDisplayed('');
    revealedLenRef.current = 0;

    fetch(`/api/chat/session/${sessionId}/history?namespace=${encodeURIComponent(ns)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data: { messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; metadata?: { proposalArtifactId?: string } }> }) => {
        setMessages(data.messages);
      })
      .catch(() => { /* history unavailable — start fresh */ });

    fetchInsights(ns);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [namespace, apiKey, fetchInsights, reset, removeExecution]);

  // Refresh insights and restore focus after each query completes (isStreaming: true → false).
  // Also finalizes any chat-initiated execution in the store so the notification fires.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      fetchInsights(namespace || 'default');
      // Re-focus the composer so the user can type immediately after the AI replies.
      // setTimeout defers until after React finishes re-enabling the disabled textarea.
      setTimeout(() => textareaRef.current?.focus(), 0);

      if (chatExecIdRef.current !== null) {
        const execId = chatExecIdRef.current;
        if (error) {
          updateExecution(execId, { status: 'failed', errorMessage: error });
        } else {
          updateExecution(execId, { status: 'completed' });
        }
        chatExecIdRef.current = null;
      }
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, namespace, fetchInsights, error, updateExecution]);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

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
    if (chunks || sections.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: chunks,
          sections: sections.length > 0 ? [...sections] : undefined,
        },
      ]);
      // Cancel any in-flight generation execution from the previous stream
      if (chatExecIdRef.current !== null) {
        removeExecution(chatExecIdRef.current);
        chatExecIdRef.current = null;
      }
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
      startStream({ message: q, namespace: ns, chatSessionId: chatSessionIdRef.current ?? undefined });
    });
  }, [input, isStreaming, chunks, sections, namespace, apiKey, reset, startStream, removeExecution]);

  function handleClear() {
    // Rotate to a new session ID so the fresh chat has clean history
    const ns = namespace || 'default';
    const newId = crypto.randomUUID();
    localStorage.setItem(`chat-session-id-${ns}`, newId);
    chatSessionIdRef.current = newId;
    // Cancel any in-flight generation execution
    if (chatExecIdRef.current !== null) {
      removeExecution(chatExecIdRef.current);
      chatExecIdRef.current = null;
    }
    setMessages([]);
    reset();
    setDisplayed('');
    revealedLenRef.current = 0;
    textareaRef.current?.focus();
  }

  function handleSuggestion(text: string) {
    if (text === 'Generate a proposal from my documents') {
      setShowGenerateModal(true);
      return;
    }
    setInput(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  const hasContent = messages.length > 0 || !!chunks || sections.length > 0 || !!generatedDoc || isGeneratingFromModal;

  // Derive proposal URL from generated document metadata (same logic as ProposalPage.currentFileName + NamespacePanel href)
  const generatedProposalHref = (() => {
    if (!generatedDoc) return null;
    const m = generatedDoc.metadata as Record<string, unknown>;
    const outputFile = (m.output_file ?? m.output_path) as string | undefined;
    if (!outputFile) return '/proposal';
    const parts = outputFile.replace(/\\/g, '/').split('/');
    const fileName = parts.pop();
    if (!fileName) return '/proposal';
    const proposalsIdx = parts.lastIndexOf('proposals');
    const ns = namespace || '';
    const artifactNs =
      proposalsIdx > 0 && parts[proposalsIdx - 1] && parts[proposalsIdx - 1] !== 'namespaces'
        ? parts[proposalsIdx - 1]
        : ns;
    return artifactNs
      ? `/proposal?artifact=${encodeURIComponent(fileName)}&namespace=${encodeURIComponent(artifactNs)}&from=chat`
      : `/proposal?artifact=${encodeURIComponent(fileName)}&from=chat`;
  })();

  // True once any proposal-specific signal arrives during a stream.
  // Used to switch from thinking dots → progress bar without overlap.
  const isProposalStream = sections.length > 0 || toolEvents.length > 0 || hadPhaseRef.current;

  if (viewMicrosite) {
    const { name } = parseMicrositeInfo(viewMicrosite.proposalId);
    const dismiss = () => { setViewMicrosite(null); setViewMicrositeAST(null); setEditingMicrosite(false); };

    if (editingMicrosite && viewMicrositeAST) {
      return (
        <MicrositeEditor
          ast={viewMicrositeAST}
          namespace={viewMicrosite.namespace}
          proposalId={viewMicrosite.proposalId}
          onClose={() => setEditingMicrosite(false)}
          onExport={(editedAst) => { setViewMicrositeAST(editedAst); setEditingMicrosite(false); }}
        />
      );
    }

    return (
      <div className="chat-v2">
        <header className="chat-v2-header">
          <div className="chat-v2-header-left">
            <span className="chat-v2-ns">{name}</span>
          </div>
          <div className="chat-v2-header-right">
            {viewMicrositeAST && (
              <>
                <button className="chat-v2-clear-btn" onClick={() => micrositeRef.current?.downloadPdf()} aria-label="Download PDF">
                  <Icon icon={Download} size="md" />
                </button>
                <button className="chat-v2-clear-btn" onClick={() => setEditingMicrosite(true)} aria-label="Edit microsite">
                  <Icon icon={Pencil} size="md" />
                </button>
              </>
            )}
            <button className="chat-v2-clear-btn" onClick={dismiss} aria-label="Close microsite">
              <Icon icon={X} size="md" />
            </button>
          </div>
        </header>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {viewMicrositeLoading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 14 }}>
              Loading…
            </div>
          )}
          {!viewMicrositeLoading && viewMicrositeAST && (
            <Microsite
              ref={micrositeRef}
              ast={viewMicrositeAST}
              mode="embedded"
              namespace={viewMicrosite.namespace}
              proposalId={viewMicrosite.proposalId}
            />
          )}
        </div>
      </div>
    );
  }

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
            <Icon icon={Upload} size="sm" />
            <span>Upload</span>
          </button>
          <button className="chat-v2-action-btn" onClick={() => router.push('/proposal')}>
            <Icon icon={PanelRight} size="sm" />
            <span>Proposal</span>
          </button>
          <button className="chat-v2-action-btn" onClick={() => router.push('/presentation')}>
            <Icon icon={LayoutGrid} size="sm" />
            <span>Microsite</span>
          </button>
          {hasContent && (
            <button className="chat-v2-clear-btn" onClick={handleClear} disabled={isStreaming}>
              Clear
            </button>
          )}
          <button
            className={`chat-v2-panel-toggle${traceOpen ? ' active' : ''}`}
            onClick={() => setTraceOpen((v) => !v)}
            title={traceOpen ? 'Hide trace' : 'Show execution trace'}
          >
            ⚡
          </button>
          <ThemeToggle />
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
                        (() => {
                          // In-memory sections from active stream
                          if (m.sections?.length) {
                            return (
                              <div className="proposal-sections-wrap">
                                {m.sections.map((s) => (
                                  <ProposalSectionBlock
                                    key={s.section}
                                    section={s.section}
                                    content={s.content}
                                    artifactId={s.artifactId}
                                    namespace={namespace || 'default'}
                                    apiKey={apiKey}
                                  />
                                ))}
                              </div>
                            );
                          }
                          // History load: show persistent proposal link if artifact exists
                          const artifactId = m.metadata?.proposalArtifactId as string | undefined;
                          if (artifactId) {
                            return (
                              <div className="prose">
                                <ReactMarkdown>{m.content}</ReactMarkdown>
                                <div className="proposal-history-link-card">
                                  <span className="proposal-history-link-label">Proposal generated</span>
                                  <a
                                    href={`/proposal?artifact=${encodeURIComponent(artifactId)}&namespace=${encodeURIComponent(namespace || 'default')}`}
                                    className="proposal-done-link proposal-done-link--primary"
                                  >
                                    View proposal ↗
                                  </a>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div className="prose">
                              <ReactMarkdown>{m.content}</ReactMarkdown>
                            </div>
                          );
                        })()
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}

                {/* ── Modal-triggered generation: loading + done card ── */}
                {isGeneratingFromModal && (
                  <div className="chat-v2-message chat-v2-message--assistant" style={{ '--msg-i': messages.length } as React.CSSProperties}>
                    <div className="chat-v2-avatar">AI</div>
                    <div className="chat-v2-bubble chat-v2-bubble--sections">
                      <div className="chat-gen-progress">
                        <span className="chat-gen-progress__spinner" aria-hidden="true" />
                        <div className="chat-gen-progress__body">
                          <span className="chat-gen-progress__label">Generating proposal…</span>
                          <span className="chat-gen-progress__hint">Track progress in Active Tasks →</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {generatedDoc && !isGeneratingFromModal && (
                  <div className="chat-v2-message chat-v2-message--assistant" style={{ '--msg-i': messages.length } as React.CSSProperties}>
                    <div className="chat-v2-avatar">AI</div>
                    <div className="chat-v2-bubble chat-v2-bubble--sections">
                      <div className="proposal-done-footer">
                        <div className="proposal-done-actions">
                          <a
                            href={generatedProposalHref ?? '/proposal'}
                            className="proposal-done-link proposal-done-link--primary"
                          >
                            Open in editor ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Proposal generation: progress bar + sections + done card ── */}
                {(isProposalStream || (!isStreaming && (sections.length > 0 || hadGenerationTool))) && (
                  <div
                    className="chat-v2-message chat-v2-message--assistant"
                    style={{ '--msg-i': messages.length } as React.CSSProperties}
                  >
                    <div className="chat-v2-avatar">AI</div>
                    <div className="chat-v2-bubble chat-v2-bubble--sections">

                      {/* Progress bar — always shown while streaming */}
                      {isStreaming && (
                        <ProposalProgressBar
                          phase={phase}
                          toolEvents={toolEvents}
                          sectionCount={sections.length}
                          isStreaming={isStreaming}
                        />
                      )}

                      {/* In-progress card — V2 path: tool event detected but no sections stream */}
                      {isStreaming && generationTool !== null && sections.length === 0 && (
                        <div className="chat-gen-progress">
                          <span className="chat-gen-progress__spinner" aria-hidden="true" />
                          <div className="chat-gen-progress__body">
                            <span className="chat-gen-progress__label">
                              {generationTool === 'generate_microsite'
                                ? 'Generating microsite'
                                : 'Generating proposal'}…
                            </span>
                            <span className="chat-gen-progress__hint">
                              Track progress in Active Tasks →
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Section blocks — V1 path streams sections one by one */}
                      {sections.length > 0 && (
                        <div className="proposal-sections-wrap">
                          {sections.map((s) => (
                            <ProposalSectionBlock
                              key={s.section}
                              section={s.section}
                              content={s.content}
                              artifactId={s.artifactId}
                              namespace={namespace || 'default'}
                              apiKey={apiKey}
                            />
                          ))}
                          {/* After sections: in-progress card if type known, skeleton otherwise */}
                          {isStreaming && (
                            generationTool !== null ? (
                              <div className="chat-gen-progress">
                                <span className="chat-gen-progress__spinner" aria-hidden="true" />
                                <div className="chat-gen-progress__body">
                                  <span className="chat-gen-progress__label">
                                    {generationTool === 'generate_microsite'
                                      ? 'Generating microsite'
                                      : 'Generating proposal'}…
                                  </span>
                                  <span className="chat-gen-progress__hint">
                                    Track progress in Active Tasks →
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="psb psb--skeleton">
                                <div className="psb-header">
                                  <div className="psb-skeleton-title" />
                                </div>
                                <div className="psb-skeleton-lines">
                                  <div className="psb-skeleton-line" />
                                  <div className="psb-skeleton-line psb-skeleton-line--short" />
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {/* Completion message + improvement prompts + link */}
                      {!isStreaming && (sections.length > 0 || hadGenerationTool) && (
                        <div className="proposal-done-footer">
                          {chunks && (
                            <div className="prose proposal-done-message">
                              <ReactMarkdown>{chunks}</ReactMarkdown>
                            </div>
                          )}
                          <div className="proposal-done-actions">
                            {doneActions?.openMicrositeUrl ? (
                              <a href={doneActions.openMicrositeUrl} className="proposal-done-link proposal-done-link--primary">
                                View microsite
                              </a>
                            ) : (
                              <a href="/proposal" className="proposal-done-link proposal-done-link--primary">
                                Open in editor
                              </a>
                            )}
                            {doneActions?.openProposalUrl && (
                              <a href={doneActions.openProposalUrl} className="proposal-done-link">
                                View proposal
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Thinking dots — non-proposal streams waiting for first chunk ── */}
                {isStreaming && !chunks && !isProposalStream && (
                  <div className="chat-v2-message chat-v2-message--assistant">
                    <div className="chat-v2-avatar">AI</div>
                    <div className="chat-v2-bubble chat-v2-bubble--thinking">
                      <span className="chat-thinking-dot" />
                      <span className="chat-thinking-dot" />
                      <span className="chat-thinking-dot" />
                    </div>
                  </div>
                )}

                {/* ── Live streaming response — plain text (non-section streams) ── */}
                {chunks && sections.length === 0 && (
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

                {/* Phase label while plain text tokens are already streaming */}
                {isStreaming && chunks && sections.length === 0 && phase && (
                  <div className="chat-phase-strip">{phase}…</div>
                )}

                {error && <div className="chat-v2-error">{error}</div>}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Upload modal */}
          {showUpload && (
            <ChatUploadDrawer
              namespace={namespace}
              onUploaded={() => setFileRefreshTick(t => t + 1)}
              onClose={() => {
                setShowUpload(false);
                textareaRef.current?.focus();
              }}
            />
          )}

          {/* Input composer */}
          <div className="chat-v2-composer-wrap">
            <div className="chat-v2-composer">
              <div ref={menuRef} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className={`chat-v2-attach-btn${showMenu ? ' active' : ''}`}
                  onClick={() => setShowMenu((v) => !v)}
                  aria-label="More options"
                >
                  <Icon icon={Plus} size="md" />
                </button>
                {showMenu && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 8px)',
                    left: 0,
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
                    overflow: 'hidden',
                    minWidth: 160,
                    zIndex: 200,
                  }}>
                    {[
                      { label: 'Ingest', action: () => { setShowUpload(true); setShowMenu(false); } },
                      { label: 'Memory', action: () => { setShowMemoryModal(true); setShowMenu(false); } },
                      { label: 'Configuration', action: () => { setShowConfigModal(true); setShowMenu(false); } },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={item.action}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-soft)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <textarea
                ref={textareaRef}
                className="chat-v2-input"
                rows={1}
                placeholder="Ask AI to generate proposal, ingest documents, or analyse knowledge…"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
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
                  <Icon icon={ArrowUp} size="md" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Namespace panel */}
        <NamespacePanel namespace={namespace} onMicrositeClick={setViewMicrosite} fileRefreshTick={fileRefreshTick} />

        {/* Execution trace panel — only rendered when open */}
        {traceOpen && chatSessionIdRef.current && (
          <ExecutionTracePanel
            chatSessionId={chatSessionIdRef.current}
            apiKey={apiKey}
            live={isStreaming}
          />
        )}
      </div>

      {/* Generate Proposal modal */}
      {showGenerateModal && (
        <div className="ai-editor-overlay" onClick={() => { if (!isGeneratingFromModal) setShowGenerateModal(false); }}>
          <div className="ai-editor-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="ai-editor-header">
              <h3>Generate Proposal</h3>
              <button
                onClick={() => setShowGenerateModal(false)}
                disabled={isGeneratingFromModal}
                style={{ background: 'none', border: 'none', cursor: isGeneratingFromModal ? 'not-allowed' : 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: 'var(--muted)' }}
                aria-label="Close"
              >
                <Icon icon={X} size="md" />
              </button>
            </div>
            <div style={{ padding: '0 20px 20px', overflowY: 'auto', maxHeight: 'calc(80vh - 60px)' }}>
              <ProposalForm
                onGenerate={(doc) => { setGeneratedDoc(doc); setShowGenerateModal(false); }}
                isGenerating={isGeneratingFromModal}
                setIsGenerating={setIsGeneratingFromModal}
              />
            </div>
          </div>
        </div>
      )}

      {/* Memory modal */}
      {showMemoryModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowMemoryModal(false); }}
        >
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(580px, 92vw)', maxHeight: '88vh', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '22px 24px 18px', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1.4 }}>Namespace Memory</p>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                    Namespace memory lets you store structured context that persists across sessions. Paste or write JSON below to define it.
                  </p>
                </div>
                <button
                  onClick={() => setShowMemoryModal(false)}
                  style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, display: 'flex', alignItems: 'center', marginTop: 2 }}
                  aria-label="Close"
                >
                  <Icon icon={X} size="md" />
                </button>
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--border)', flexShrink: 0 }} />
            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 24px' }}>
              <MemoryEditor hideSelector />
            </div>
          </div>
        </div>
      )}

      {/* Configuration modal */}
      {showConfigModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowConfigModal(false); }}
        >
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, width: 'min(580px, 92vw)', maxHeight: '88vh', boxShadow: '0 20px 60px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '22px 24px 18px', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1.4 }}>Namespace Configuration</p>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                    Configuration controls pipeline behavior for this namespace. Edit the JSON below to define defaults.
                  </p>
                </div>
                <button
                  onClick={() => setShowConfigModal(false)}
                  style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, display: 'flex', alignItems: 'center', marginTop: 2 }}
                  aria-label="Close"
                >
                  <Icon icon={X} size="md" />
                </button>
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--border)', flexShrink: 0 }} />
            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 24px' }}>
              <ConfigEditor hideSelector />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
