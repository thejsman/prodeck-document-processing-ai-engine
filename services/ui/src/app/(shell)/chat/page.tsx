'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { ArrowUp, Brain, Download, Eraser, Pencil, PanelRightClose, PanelRightOpen, Plus, SlidersHorizontal, Upload, X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { useSSE, type ProposalSection, type ConfirmationRequest } from '@/lib/use-sse';
import { ChatUploadDrawer } from '@/components/ChatUploadDrawer';
import { ChatFileUpload } from '@/components/chat/ChatFileUpload';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { NamespacePanel, parseMicrositeInfo } from '@/components/chat/NamespacePanel';
import { ProposalSectionBlock } from '@/components/chat/ProposalSectionBlock';
import { ConfirmationBlock } from '@/components/chat/ConfirmationBlock';
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
  role: 'user' | 'assistant' | 'upload';
  content: string;
  /** Populated when the message is a structured proposal stream. */
  sections?: ProposalSection[];
  metadata?: { proposalArtifactId?: string; proposalNamespace?: string };
  /** Populated when the pipeline halted at Stage 4.5 for user confirmation. */
  confirmation?: ConfirmationRequest;
  /** Populated for inline file upload progress entries. */
  uploadData?: {
    fileName: string;
    fileSize: number;
    progress: number;
    status: 'uploading' | 'processing' | 'done' | 'error';
  };
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

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [fileRefreshTick, setFileRefreshTick] = useState(0);
  const [traceOpen, setTraceOpen] = useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [panelHasContent, setPanelHasContent] = useState(true);
  const [insights, setInsights] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isGeneratingFromModal, setIsGeneratingFromModal] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<ProposalDocument | null>(null);

  const [viewMicrosite, setViewMicrosite] = useState<Presentation | null>(null);
  const [viewMicrositeAST, setViewMicrositeAST] = useState<LayoutAST | null>(null);
  const [viewMicrositeLoading, setViewMicrositeLoading] = useState(false);
  const [editingMicrosite, setEditingMicrosite] = useState(false);
  const [msHeaderScrolled, setMsHeaderScrolled] = useState(false);
  const micrositeRef = useRef<MicrositeHandle>(null);
  const msSentinelRef = useRef<HTMLDivElement>(null);

  const chatSessionIdRef = useRef<string | null>(null);
  const uploadMsgIdRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const rafRef = useRef<number | null>(null);
  const revealedLenRef = useRef(0);

  const { chunks, phase, isStreaming, error, sections, toolEvents, doneActions, confirmationRequest, startStream, reset } = useSSE(apiKey, '/api/chat/message');

  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const removeExecution = useExecutionStore((s) => s.removeExecution);

  // Tracks the execution ID registered in the store for the current stream's generation task
  const chatExecIdRef = useRef<string | null>(null);

  // Once a *generation* phase label arrives (not pre-generation phases like
  // "Extracting requirements" that precede clarifying questions), lock into
  // proposal stream mode so the progress bar never flickers back to dots.
  const GENERATION_PHASE_PREFIXES = [
    'Planning proposal structure', 'Building section outline',
    'Preparing template', 'Generating proposal',
    'Saved as version', 'Checking proposal consistency',
  ];
  const hadPhaseRef = useRef(false);
  if (isStreaming && phase && GENERATION_PHASE_PREFIXES.some(p => phase.startsWith(p))) hadPhaseRef.current = true;
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

  // Show header border only when content has scrolled beneath it
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setHeaderScrolled(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Same scroll-border behaviour for the microsite viewer header
  useEffect(() => {
    const sentinel = msSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setMsHeaderScrolled(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [viewMicrosite]);

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
    if (chunks || sections.length > 0 || confirmationRequest) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: chunks,
          sections: sections.length > 0 ? [...sections] : undefined,
          confirmation: confirmationRequest ?? undefined,
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
  }, [input, isStreaming, chunks, sections, confirmationRequest, namespace, apiKey, reset, startStream, removeExecution]);

  // ── File upload inline progress callbacks ─────────────────────────

  const handleUploadStart = useCallback((files: File[]) => {
    const id = crypto.randomUUID();
    const displayName = files.length > 1
      ? `${files[0].name} +${files.length - 1} more`
      : files[0].name;
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    uploadMsgIdRef.current = id;
    setMessages((prev) => [
      ...prev,
      { id, role: 'upload', content: '', uploadData: { fileName: displayName, fileSize: totalSize, progress: 0, status: 'uploading' } },
    ]);
  }, []);

  const handleUploadProgress = useCallback((progress: number) => {
    const id = uploadMsgIdRef.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.uploadData ? { ...m, uploadData: { ...m.uploadData, progress } } : m,
      ),
    );
  }, []);

  const handleUploadDone = useCallback(() => {
    const id = uploadMsgIdRef.current;
    if (id) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.uploadData
            ? { ...m, uploadData: { ...m.uploadData, progress: 100, status: 'done' } }
            : m,
        ),
      );
      uploadMsgIdRef.current = null;
    }
    setFileRefreshTick((t) => t + 1);
  }, []);

  const handleUploadError = useCallback(() => {
    const id = uploadMsgIdRef.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id && m.uploadData ? { ...m, uploadData: { ...m.uploadData, status: 'error' } } : m,
      ),
    );
    uploadMsgIdRef.current = null;
  }, []);

  const sendConfirmation = useCallback((msg: string) => {
    if (isStreaming) return;
    // Commit current stream to history first
    if (chunks || confirmationRequest) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: chunks,
          confirmation: confirmationRequest ?? undefined,
        },
      ]);
      reset();
    }
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: msg }]);
    const ns = namespace || 'default';
    startStream({ message: msg, namespace: ns, chatSessionId: chatSessionIdRef.current ?? undefined });
  }, [isStreaming, chunks, confirmationRequest, namespace, startStream, reset]);

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
    setInput(text);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  const hasContent = messages.length > 0 || !!chunks || sections.length > 0 || !!generatedDoc || isGeneratingFromModal;

  // Derive proposal URL from generated document metadata (same logic as ProposalPage.currentFileName + NamespacePanel href)
  const generatedProposalHref = (() => {
    if (!generatedDoc) return null;
    const m = generatedDoc.metadata as Record<string, unknown>;
    const outputFile = (m.output_file ?? m.output_path) as string | undefined;
    if (!outputFile) return `/proposal?from=chat`;
    const parts = outputFile.replace(/\\/g, '/').split('/');
    const fileName = parts.pop();
    if (!fileName) return `/proposal?from=chat`;
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
        <div className="chat-v2-center">
          <header className={`chat-v2-header${msHeaderScrolled ? ' chat-v2-header--scrolled' : ''}`}>
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
            <div ref={msSentinelRef} style={{ height: 0, flexShrink: 0 }} />
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
      </div>
    );
  }

  return (
    <div className="chat-v2">
      {/* ── Center column: header + messages + composer ── */}
      <div className="chat-v2-center">
        <header className={`chat-v2-header${headerScrolled ? ' chat-v2-header--scrolled' : ''}`}>
          <div className="chat-v2-header-left">
            <span className="chat-v2-ns">{namespace || 'default'}</span>
          </div>
          <div className="chat-v2-header-right">
            <button
              className={`chat-v2-panel-toggle${traceOpen ? ' active' : ''}`}
              onClick={() => setTraceOpen((v) => !v)}
              title={traceOpen ? 'Hide trace' : 'Show execution trace'}
            >
              ⚡
            </button>
            <ThemeToggle />
            {panelHasContent && (
              <button
                className={`chat-v2-panel-toggle${panelVisible ? ' active' : ''}`}
                onClick={() => setPanelVisible((v) => !v)}
                title={panelVisible ? 'Hide panel' : 'Show panel'}
              >
                <Icon icon={panelVisible ? PanelRightClose : PanelRightOpen} size="sm" />
              </button>
            )}
          </div>
        </header>

        {/* ── Body ── */}
        <div className="chat-v2-body">
          <div className="chat-v2-main">
          {/* Messages */}
          <div className="chat-v2-messages">
            <div ref={sentinelRef} style={{ height: 0, flexShrink: 0 }} />
            {!hasContent ? (
              <ChatEmptyState namespace={namespace} onSuggestion={handleSuggestion} insights={insights} />
            ) : (
              <>
                {messages.map((m, i) => {
                  if (m.role === 'upload' && m.uploadData) {
                    return (
                      <div
                        key={m.id}
                        className="chat-v2-message chat-v2-message--user"
                        style={{ '--msg-i': i } as React.CSSProperties}
                      >
                        <ChatFileUpload {...m.uploadData} />
                      </div>
                    );
                  }
                  return (
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
                          // History load: show persistent proposal card if artifact exists
                          const artifactId = m.metadata?.proposalArtifactId as string | undefined;
                          if (artifactId) {
                            const historyClient = m.content?.match(/Proposal for "([^"]+)"/)?.[1] || namespace || 'Proposal';
                            const artifactNs = (m.metadata?.proposalNamespace as string | undefined) || namespace || 'default';
                            const historyHref = `/proposal?artifact=${encodeURIComponent(artifactId)}&namespace=${encodeURIComponent(artifactNs)}&from=chat`;
                            return (
                              <div style={{ maxWidth: '33.33%' }}>
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 400 }}>Proposal generated</span>
                                <div className="proposal-card" style={{ background: 'var(--panel-soft)', cursor: 'default' }}>
                                  <div className="proposal-card-header">
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <span className="proposal-card-name">{historyClient}</span>
                                    </div>
                                    <span style={{ flexShrink: 0, background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 100, fontSize: 10, fontWeight: 600, padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4 }}>v1</span>
                                  </div>
                                  <div className="proposal-card-footer">
                                    <div className="proposal-card-meta">
                                      <span className="proposal-card-ns">{namespace || 'default'}</span>
                                      <span className="badge--draft" style={{ fontSize: 10 }}>DRAFT</span>
                                    </div>
                                    <Link href={historyHref} className="proposal-card-view-btn">View →</Link>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          return (
                            <>
                              <div className="prose">
                                <ReactMarkdown>{m.content}</ReactMarkdown>
                              </div>
                              {m.confirmation && (
                                <ConfirmationBlock
                                  request={m.confirmation}
                                  onConfirm={sendConfirmation}
                                  disabled={isStreaming}
                                />
                              )}
                            </>
                          );
                        })()
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                  );
                })}

                {/* ── Modal-triggered generation: loading + done card ── */}
                {isGeneratingFromModal && (
                  <div className="chat-v2-message chat-v2-message--assistant" style={{ '--msg-i': messages.length } as React.CSSProperties}>
                    <div className="chat-v2-avatar">AI</div>
                    <div className="chat-v2-bubble">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 16 }}>
                        <span className="ppb-dots"><span /><span /><span /></span>
                        Generating proposal
                      </span>
                    </div>
                  </div>
                )}
                {generatedDoc && !isGeneratingFromModal && (() => {
                  const clientName = (generatedDoc.metadata?.client as string) || namespace || 'New Proposal';
                  const dateLabel = new Date(generatedDoc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                  return (
                    <div className="chat-v2-message chat-v2-message--assistant" style={{ '--msg-i': messages.length } as React.CSSProperties}>
                      <div className="chat-v2-avatar">AI</div>
                      <div className="chat-v2-bubble" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: '33.33%' }}>
                        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>Proposal generated</span>
                        <div className="proposal-card" style={{ background: 'var(--panel-soft)', margin: 0, cursor: 'default' }}>
                          <div className="proposal-card-header">
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <span className="proposal-card-name">{clientName}</span>
                              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{dateLabel}</span>
                            </div>
                            <span style={{ flexShrink: 0, background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 100, fontSize: 10, fontWeight: 600, padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4 }}>v1</span>
                          </div>
                          <div className="proposal-card-footer">
                            <div className="proposal-card-meta">
                              <span className="proposal-card-ns">{namespace || 'default'}</span>
                              <span className="badge--draft" style={{ fontSize: 10 }}>DRAFT</span>
                            </div>
                            <Link href={generatedProposalHref ?? '/proposal'} className="proposal-card-view-btn">View →</Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

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

                      {/* In-progress — V2 path: tool event detected but no sections stream */}
                      {isStreaming && generationTool !== null && sections.length === 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 16 }}>
                          <span className="ppb-dots"><span /><span /><span /></span>
                          {generationTool === 'generate_microsite' ? 'Generating microsite' : 'Generating proposal'}
                        </span>
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
                              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 16, marginTop: 8 }}>
                                <span className="ppb-dots"><span /><span /><span /></span>
                                {generationTool === 'generate_microsite' ? 'Generating microsite' : 'Generating proposal'}
                              </span>
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

                      {/* Completion card */}
                      {!isStreaming && (sections.length > 0 || hadGenerationTool) && (() => {
                        if (doneActions?.openMicrositeUrl) {
                          return (
                            <div className="proposal-done-footer">
                              <div className="proposal-done-actions">
                                <a href={doneActions.openMicrositeUrl} className="proposal-done-link proposal-done-link--primary">View microsite</a>
                                {doneActions.openProposalUrl && <a href={`${doneActions.openProposalUrl}${doneActions.openProposalUrl.includes('?') ? '&' : '?'}from=chat`} className="proposal-done-link">View proposal</a>}
                              </div>
                            </div>
                          );
                        }
                        const clientName = chunks?.match(/Proposal for "([^"]+)"/)?.[1] || namespace || 'New Proposal';
                        const fallbackArtifact = sections[0]?.artifactId;
                        const proposalHref = doneActions?.openProposalUrl
                          ? `${doneActions.openProposalUrl}${doneActions.openProposalUrl.includes('?') ? '&' : '?'}from=chat`
                          : fallbackArtifact
                            ? `/proposal?artifact=${encodeURIComponent(fallbackArtifact)}&namespace=${encodeURIComponent(namespace || 'default')}&from=chat`
                            : `/proposal?from=chat`;
                        const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                        return (
                          <div style={{ marginTop: 12, maxWidth: '33.33%' }}>
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 400 }}>Proposal generated</span>
                            <div className="proposal-card" style={{ background: 'var(--panel-soft)', cursor: 'default' }}>
                              <div className="proposal-card-header">
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <span className="proposal-card-name">{clientName}</span>
                                  <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>{dateLabel}</span>
                                </div>
                                <span style={{ flexShrink: 0, background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 100, fontSize: 10, fontWeight: 600, padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4 }}>v1</span>
                              </div>
                              <div className="proposal-card-footer">
                                <div className="proposal-card-meta">
                                  <span className="proposal-card-ns">{namespace || 'default'}</span>
                                  <span className="badge--draft" style={{ fontSize: 10 }}>DRAFT</span>
                                </div>
                                <Link href={proposalHref} className="proposal-card-view-btn">View →</Link>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
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
                      {!isStreaming && (doneActions?.openTemplatesUrl ?? doneActions?.viewTemplatesUrl) && (
                        <div className="proposal-done-actions" style={{ marginTop: 12 }}>
                          <a href={(doneActions?.openTemplatesUrl ?? doneActions?.viewTemplatesUrl)!} className="proposal-done-link proposal-done-link--primary">
                            View Templates ↗
                          </a>
                        </div>
                      )}
                      {!isStreaming && doneActions?.openTemplateUrl && (
                        <div className="proposal-done-actions" style={{ marginTop: 12 }}>
                          <a href={`${doneActions.openTemplateUrl}&from=chat`} className="proposal-done-link proposal-done-link--primary">
                            View Template Draft ↗
                          </a>
                        </div>
                      )}
                      {/* ── Confirmation block for active stream ── */}
                      {!isStreaming && confirmationRequest && (
                        <ConfirmationBlock
                          request={confirmationRequest}
                          onConfirm={sendConfirmation}
                          disabled={isStreaming}
                        />
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
              onUploadStart={handleUploadStart}
              onProgress={handleUploadProgress}
              onUploaded={handleUploadDone}
              onUploadError={handleUploadError}
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
                      { label: 'Ingest', icon: Upload, action: () => { setShowUpload(true); setShowMenu(false); } },
                      { label: 'Memory', icon: Brain, action: () => { setShowMemoryModal(true); setShowMenu(false); } },
                      { label: 'Configuration', icon: SlidersHorizontal, action: () => { setShowConfigModal(true); setShowMenu(false); } },
                    ].map(item => (
                      <button
                        key={item.label}
                        onClick={item.action}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-soft)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        <Icon icon={item.icon} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                        {item.label}
                      </button>
                    ))}
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <button
                      onClick={() => { if (hasContent && !isStreaming) { setShowClearConfirm(true); setShowMenu(false); } }}
                      disabled={!hasContent || isStreaming}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: hasContent && !isStreaming ? 'pointer' : 'not-allowed', fontSize: 13, color: hasContent ? 'var(--danger)' : 'var(--muted)', transition: 'background 0.1s', opacity: !hasContent || isStreaming ? 0.4 : 1 }}
                      onMouseEnter={e => { if (hasContent && !isStreaming) e.currentTarget.style.background = 'var(--panel-soft)'; }}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <Icon icon={Eraser} size="sm" style={{ flexShrink: 0 }} />
                      Clear Chat
                    </button>
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

          </div>
        </div>

      {/* ── Right panel: full height, not under header ── */}
      <div style={{ width: panelVisible && panelHasContent ? 256 : 0, flexShrink: 0, overflow: 'hidden', transition: 'width 0.22s ease' }}>
        <NamespacePanel namespace={namespace} onMicrositeClick={setViewMicrosite} fileRefreshTick={fileRefreshTick} onHasContent={setPanelHasContent} />
      </div>

      {/* Execution trace panel */}
      {traceOpen && chatSessionIdRef.current && (
        <ExecutionTracePanel
          chatSessionId={chatSessionIdRef.current}
          apiKey={apiKey}
          live={isStreaming}
        />
      )}

      {/* Clear Chat confirmation dialog */}
      {showClearConfirm && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onMouseDown={e => { if (e.target === e.currentTarget) setShowClearConfirm(false); }}
        >
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 0' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px', lineHeight: 1.5 }}>Clear chat</p>
            </div>
            <div style={{ height: 1, background: 'var(--border)' }} />
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                Clear all messages in the <strong>"{namespace || 'default'}"</strong> session?
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', fontSize: 14, cursor: 'pointer' }}
                >Cancel</button>
                <button
                  onClick={() => { handleClear(); setShowClearConfirm(false); }}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--danger)', color: '#fff', fontSize: 14, cursor: 'pointer' }}
                >Clear Chat</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

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
