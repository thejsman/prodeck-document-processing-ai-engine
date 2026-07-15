'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  Brain,
  Database,
  Eraser,
  Menu,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { useMobileNav } from '@/lib/mobile-nav-store';
import { useSSE, type ProposalSection, type ConfirmationRequest } from '@/lib/use-sse';
import { ChatUploadDrawer } from '@/components/ChatUploadDrawer';
import { ChatFileUpload } from '@/components/chat/ChatFileUpload';
import { ChatEmptyState } from '@/components/chat/ChatEmptyState';
import { parseMicrositeInfo } from '@/components/chat/NamespacePanel';
import { ProposalSectionBlock } from '@/components/chat/ProposalSectionBlock';
import { ConfirmationBlock } from '@/components/chat/ConfirmationBlock';
import { ExecutionTracePanel } from '@/components/chat/ExecutionTracePanel';
import { ProposalProgressBar } from '@/components/chat/ProposalProgressBar';
import { useProposalGenerationStore } from '@/core/proposal-generation-store';
import { MemoryEditor } from '@/components/MemoryEditor';
import { ConfigEditor } from '@/components/ConfigEditor';
import { ProposalForm } from '@/components/ProposalForm';
import { fetchMicrositeContent, saveMicrositeAst, fetchKnowledgeFiles, postUploadMessage, listSkills, fetchProposals, type ProposalDocument, type Presentation, type SkillSummaryApi } from '@/lib/api';
import type { LayoutAST } from '@/types/presentation';
import { Microsite, type MicrositeHandle } from '@/components/microsite/Microsite';
import { MicrositePro } from '@/components/microsite/MicrositePro';
import { injectBridgeScript, normalizeMicrositeHtml, type BridgeMessage } from '@/lib/microsite-bridge';
import { SelectionOverlay } from '@/components/microsite/smart-editor/SelectionOverlay';
import { InlineEditPanel } from '@/components/microsite/smart-editor/InlineEditPanel';
import { ThemeToggle } from '@/components/system/ThemeToggle';
import { useExecutionStore } from '@/core/execution/execution-store';
import { startExecutionTransport } from '@/core/execution/execution-transport';
import { BriefPanel } from '@/components/chat/BriefPanel';
import { ExtractionConfirmationCard } from '@/components/chat/ExtractionConfirmationCard';
import { useBrief } from '@/hooks/useBrief';
import { BriefContext } from '@/lib/brief-context';
import type { RequirementKey, DocumentClassification } from '@/lib/api';
import { useExtractionCardStore } from '@/core/extraction/extraction-card-store';
import {
  confirmExtractionCard,
  discardExtractionCard,
  reclassifyExtractionCard,
  fetchPendingExtractions,
  fetchBriefReadiness,
  type BriefContext as BriefContextData,
} from '@/lib/api';
import { useIngestionProgressStore } from '@/core/execution/ingestion-progress-store';
import { ClientPanel } from '@/components/chat/ClientPanel';
import { useCollectionStatus } from '@/lib/use-collection-status';

// ── Types ──────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'upload' | 'extraction_card';
  content: string;
  /** Populated when the message is a structured proposal stream. */
  sections?: ProposalSection[];
  metadata?: { proposalArtifactId?: string; proposalNamespace?: string };
  /** Populated when the pipeline halted at Stage 4.5 for user confirmation. */
  confirmation?: ConfirmationRequest;
  /** Structured questions for QuestionsBlock rendering. */
  questionsRequest?: Array<{ field: string; question: string }>;
  /** Present when role === 'extraction_card'. */
  extractionCardId?: string;
  /** Populated for inline file upload progress entries. */
  uploadData?: {
    fileName: string;
    fileSize: number;
    progress: number;
    status: 'uploading' | 'processing' | 'done' | 'error';
    stage?: string;
    errorMessage?: string;
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
      const data = (await res.json()) as { namespaces?: string[] };
      const list = data.namespaces ?? [];
      if (list.length === 0) return 'No namespaces found. Create one to get started.';
      return `Available namespaces:\n\n${list.map((n) => `- \`${n}\``).join('\n')}`;
    },
  },
];

async function trySystemQuery(q: string, apiKey: string, namespace: string): Promise<string | null> {
  for (const handler of SYSTEM_QUERIES) {
    if (handler.pattern.test(q)) {
      return handler.fetch(apiKey, namespace);
    }
  }
  return null;
}

// ── Session helpers ─────────────────────────────────────────────

function localSessionKey(namespace: string): string {
  return `chat-session-id-${namespace}`;
}

/**
 * Resolves the session ID for a namespace using a server-first strategy:
 *   1. Check localStorage cache (fast path, avoids round-trip on repeat visits)
 *   2. Fetch GET /api/chat/session/latest?namespace=X from the server
 *      — if a session exists for this API key + namespace, use it and refresh cache
 *      — if not, generate a new UUID and cache it locally
 *
 * This ensures the same user on any device always resumes their latest session
 * while different users sharing a namespace remain fully isolated (scoped by API key).
 */
async function resolveSessionId(namespace: string, apiKey: string): Promise<string> {
  const cacheKey = localSessionKey(namespace);
  const cached = localStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `/api/chat/session/latest?namespace=${encodeURIComponent(namespace)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (res.ok) {
      const data = (await res.json()) as { sessionId: string | null };
      if (data.sessionId) {
        localStorage.setItem(cacheKey, data.sessionId);
        return data.sessionId;
      }
    }
  } catch {
    // Fall through to generate a new ID
  }

  const id = crypto.randomUUID();
  localStorage.setItem(cacheKey, id);
  return id;
}


function TypewriterLabel({ text, className }: { text: string; className?: string }) {
  const [displayed, setDisplayed] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setDisplayed('');
    if (!text) return;
    let i = 0;
    timerRef.current = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) { clearInterval(timerRef.current!); timerRef.current = null; }
    }, 28);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [text]);
  return <em className={className}>{displayed}</em>;
}

function buildUploadSummaryMessage(fileNames: string[], context: BriefContextData): string {
  const relevant = context.sources.filter((s) => fileNames.includes(s.fileName));
  const fields = relevant.reduce((sum, s) => sum + s.fieldsExtracted.length, 0);
  const knowledge = relevant.reduce((sum, s) => sum + s.knowledgeEntriesCreated, 0);

  const name =
    fileNames.length > 1
      ? `${fileNames[0]} +${fileNames.length - 1} more`
      : (fileNames[0] ?? 'the document');

  if (fields === 0 && knowledge === 0) {
    return `**${name}** is indexed and ready. Ask me anything about its contents.`;
  }

  const parts: string[] = [];
  if (fields > 0) parts.push(`${fields} requirement field${fields > 1 ? 's' : ''} extracted`);
  if (knowledge > 0) parts.push(`${knowledge} knowledge entr${knowledge > 1 ? 'ies' : 'y'} added`);

  return `Processed **${name}** — ${parts.join(', ')}. The context panel has been updated.\n\nAsk me anything about this document, or say "generate proposal" to create a proposal using this context.`;
}

export default function ChatPage() {
  const { apiKey } = useAuth();
  const { namespace } = useNamespace();
  const { openMobileNav } = useMobileNav();
  const router = useRouter();
  const searchParams = useSearchParams();

  const brief = useBrief(namespace || 'default', apiKey);
  const { status: collectionStatus, loading: collectionLoading } = useCollectionStatus();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<{ field: string; question: string } | null>(null);
  const [composerConfirmation, setComposerConfirmation] = useState<ConfirmationRequest | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillSummaryApi[]>([]);
  const [skillPickerRequest, setSkillPickerRequest] = useState<{ pendingMessage: string } | null>(null);
  const [activeSkillSlug, setActiveSkillSlug] = useState<string | null>(null);
  const [ingestChipDismissed, setIngestChipDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(`ingest-chip-dismissed-${namespace}`) === '1';
  });
  const [nudgeReady, setNudgeReady] = useState(false);
  const [fileRefreshTick, setFileRefreshTick] = useState(0);

  // ── Extraction card store integration ───────────────────────────
  const allExtractionCards = useExtractionCardStore((s) => s.cards);
  const ingestionProgress = useIngestionProgressStore((s) => s.progress);
  const extractionCards = useMemo(
    () => Object.values(allExtractionCards).filter((c) => c.namespace === (namespace ?? 'default')),
    [allExtractionCards, namespace],
  );
  const seenCardIdsRef = useRef<Set<string>>(new Set());

  // Refresh brief context after ingestion completes so extraction cards appear promptly
  useEffect(() => {
    if (fileRefreshTick > 0) brief.refresh();
  }, [fileRefreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync new extraction cards from the store into the chat messages array
  useEffect(() => {
    for (const card of extractionCards) {
      if (!seenCardIdsRef.current.has(card.cardId)) {
        seenCardIdsRef.current.add(card.cardId);
        setMessages((prev) => [
          ...prev,
          {
            id: `extraction-${card.cardId}`,
            role: 'extraction_card',
            content: '',
            extractionCardId: card.cardId,
          },
        ]);
      }
    }
  }, [extractionCards]);

  const [traceOpen, setTraceOpen] = useState(false);
  const [insights, setInsights] = useState<string[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [composerPulse, setComposerPulse] = useState(false);
  const [briefModalOpen, setBriefModalOpen] = useState(false);
  const [collectionPanelOpen, setCollectionPanelOpen] = useState(false);
  const [typeTarget, setTypeTarget] = useState('');
  const typeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const briefFields = brief.context?.requirements?.fields ?? {};
  const briefTier1Count = (['clientName', 'clientIndustry', 'projectType'] as RequirementKey[]).filter(
    (k) => briefFields[k]?.value,
  ).length;

  const pendingGeneration = useProposalGenerationStore((s) => s.pending);
  const startPendingGeneration = useProposalGenerationStore((s) => s.start);
  const finishPendingGeneration = useProposalGenerationStore((s) => s.finish);
  const clearPendingGeneration = useProposalGenerationStore((s) => s.clear);
  const briefColor = briefTier1Count === 3 ? 'var(--success)' : briefTier1Count > 0 ? 'var(--warning)' : 'var(--muted)';
  const [isGeneratingFromModal, setIsGeneratingFromModal] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<ProposalDocument | null>(null);

  const [viewMicrosite, setViewMicrosite] = useState<{ entryId: string; namespace: string; proposalId: string; displayName: string } | null>(null);
  const [viewMicrositeAST, setViewMicrositeAST] = useState<LayoutAST | null>(null);
  const [viewMicrositeLoading, setViewMicrositeLoading] = useState(false);
  const [msHeaderScrolled, setMsHeaderScrolled] = useState(false);
  const msSentinelRef = useRef<HTMLDivElement>(null);
  const micrositeRef = useRef<MicrositeHandle>(null);
  // Bridge inline editor state
  const chatIframeRef = useRef<HTMLIFrameElement>(null);
  const chatIframeContainerRef = useRef<HTMLDivElement>(null);
  const [chatIframeContainerH, setChatIframeContainerH] = useState(0);
  const [chatIframeContainerW, setChatIframeContainerW] = useState(0);
  const [chatActiveSrcDoc, setChatActiveSrcDoc] = useState('');
  const [chatEditModeActive, setChatEditModeActive] = useState(false);
  const [chatSelectedElement, setChatSelectedElement] = useState<BridgeMessage | null>(null);
  const [chatHoveredElement, setChatHoveredElement] = useState<BridgeMessage | null>(null);
  const [chatEditing, setChatEditing] = useState(false);
  const [chatEditBanner, setChatEditBanner] = useState('');
  const [chatEditHistory, setChatEditHistory] = useState<string[]>([]);
  const [chatEditHistoryIndex, setChatEditHistoryIndex] = useState(-1);
  const chatDeselectingRef = useRef(false);
  const chatSelectedRef = useRef<BridgeMessage | null>(null);

  const chatSessionIdRef = useRef<string | null>(null);
  const uploadMsgIdRef = useRef<string | null>(null);
  const uploadedFileNamesRef = useRef<string[]>([]);
  const uploadedFileSizeRef = useRef<number>(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // Tracks active ingestion polling: set after upload completes, cleared when processing done
  const [activeUploadPoll, setActiveUploadPoll] = useState<{ msgId: string; fileNames: string[] } | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const skipNextScrollRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const rafRef = useRef<number | null>(null);
  const revealedLenRef = useRef(0);

  const {
    chunks,
    phase,
    isStreaming,
    error,
    sections,
    toolEvents,
    doneActions,
    confirmationRequest,
    questionsRequest,
    startStream,
    reset,
  } = useSSE(apiKey, '/api/chat/message');

  // ── Fetch available skills for skill picker ──────────────────────────────
  useEffect(() => {
    if (!apiKey) return;
    listSkills(apiKey).then(setAvailableSkills).catch(() => {});
  }, [apiKey]);

  // ── Skill-from-URL: auto-submit when navigated from /skills with ?skill= ──
  const skillFromUrl = searchParams.get('skill');
  const skillNameFromUrl = searchParams.get('skillName');
  const skillAutoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!skillFromUrl || skillAutoSubmittedRef.current || !apiKey) return;
    skillAutoSubmittedRef.current = true;
    const msg = `Generate a proposal using the "${skillNameFromUrl || skillFromUrl}" proposal skill`;
    const ns = namespace || 'default';
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: msg }]);
    startStream({ message: msg, namespace: ns, chatSessionId: undefined });
    // Strip skill params from URL so refresh doesn't re-submit
    router.replace('/chat');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, startStream]);

  // Track last known phase so the status bubble never goes blank mid-transition.
  // Cleared when a new stream starts (in handleSend) so it doesn't bleed across messages.
  const lastPhaseRef = useRef('');
  if (isStreaming && phase) lastPhaseRef.current = phase;
  const statusPhase = phase || lastPhaseRef.current || 'Thinking';

  // Hold the status bubble for 200ms after streaming ends to bridge the gap
  // between "dots disappear" and "content renders" (React batching timing).
  const [showStatusHold, setShowStatusHold] = useState(false);
  useEffect(() => {
    if (isStreaming) {
      setShowStatusHold(true);
      return;
    }
    const t = setTimeout(() => setShowStatusHold(false), 200);
    return () => clearTimeout(t);
  }, [isStreaming]);

  // Typewriter effect for status phase — reveals characters one by one on each change.
  const [displayedPhase, setDisplayedPhase] = useState('');
  const phaseTypewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phaseTypewriterRef.current) clearInterval(phaseTypewriterRef.current);
    if (!statusPhase) { setDisplayedPhase(''); return; }
    setDisplayedPhase('');
    let i = 0;
    phaseTypewriterRef.current = setInterval(() => {
      i++;
      setDisplayedPhase(statusPhase.slice(0, i));
      if (i >= statusPhase.length) {
        clearInterval(phaseTypewriterRef.current!);
        phaseTypewriterRef.current = null;
      }
    }, 28);
    return () => { if (phaseTypewriterRef.current) clearInterval(phaseTypewriterRef.current); };
  }, [statusPhase]);

  useEffect(() => {
    setNudgeReady(false);
    const t = setTimeout(() => setNudgeReady(true), 2500);
    return () => clearTimeout(t);
  }, [namespace]);

  const showIngestNudge = nudgeReady && !ingestChipDismissed && collectionStatus !== null && (collectionStatus.documentCount ?? 0) === 0;

  // Auto-open panel when namespace is set — reveal it as data flows in
  useEffect(() => {
    if (!namespace) return;
    const t = setTimeout(() => setCollectionPanelOpen(true), 1200);
    return () => clearTimeout(t);
  }, [namespace]);

  // Auto-open when brief data appears
  useEffect(() => {
    if (collectionStatus && collectionStatus.baseCompleteness > 0) {
      setCollectionPanelOpen(true);
    }
  }, [collectionStatus?.baseCompleteness]);

  // Auto-open when a proposal or microsite completes
  const allExecutions = useExecutionStore((s) => s.executions);
  useEffect(() => {
    const hasCompleted = Object.values(allExecutions).some(
      (e) => (e.type === 'proposal' || e.type === 'microsite') && e.status === 'completed',
    );
    if (hasCompleted) setCollectionPanelOpen(true);
  }, [allExecutions]);

  // Snapshot the last active composer content so it stays visible during the exit animation.
  const composerOpen = !!(activeQuestion || composerConfirmation || skillPickerRequest || showIngestNudge);
  const composerSnapshotRef = useRef<{
    activeQuestion: typeof activeQuestion;
    composerConfirmation: typeof composerConfirmation;
    skillPickerRequest: typeof skillPickerRequest;
  }>({ activeQuestion: null, composerConfirmation: null, skillPickerRequest: null });
  if (composerOpen) {
    composerSnapshotRef.current = { activeQuestion, composerConfirmation, skillPickerRequest };
  }
  const renderQuestion = composerOpen ? activeQuestion : composerSnapshotRef.current.activeQuestion;
  const renderConfirmation = composerOpen ? composerConfirmation : composerSnapshotRef.current.composerConfirmation;
  const renderSkillPicker = composerOpen ? skillPickerRequest : composerSnapshotRef.current.skillPickerRequest;

  // When the pipeline returns structured questions, surface the first one in the composer
  useEffect(() => {
    if (!isStreaming && questionsRequest && questionsRequest.length > 0) {
      setActiveQuestion(questionsRequest[0]);
    }
  }, [isStreaming, questionsRequest]);

  // Promote template/generated-template confirmations into the composer card
  useEffect(() => {
    if (!isStreaming && confirmationRequest &&
      (confirmationRequest.kind === 'confirm_template' || confirmationRequest.kind === 'approve_generated_template')) {
      setComposerConfirmation(confirmationRequest);
    }
  }, [isStreaming, confirmationRequest]);

  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const removeExecution = useExecutionStore((s) => s.removeExecution);

  // Tracks the execution ID registered in the store for the current stream's generation task
  const chatExecIdRef = useRef<string | null>(null);

  // Once a *generation* phase label arrives (not pre-generation phases like
  // "Extracting requirements" that precede clarifying questions), lock into
  // proposal stream mode so the progress bar never flickers back to dots.
  const GENERATION_PHASE_PREFIXES = [
    'Planning proposal structure',
    'Building section outline',
    'Preparing template',
    'Generating proposal',
    'Saved as version',
    'Checking proposal consistency',
  ];
  const hadPhaseRef = useRef(false);
  if (isStreaming && phase && GENERATION_PHASE_PREFIXES.some((p) => phase.startsWith(p))) hadPhaseRef.current = true;
  if (!isStreaming) hadPhaseRef.current = false;

  // Reactive signal: which generation tool is running (null if none).
  // Derived from toolEvents (state) so JSX re-renders when it arrives.
  // Computed early so it can be referenced in the useEffect below.
  const generationTool =
    toolEvents.find((ev) => ev.tool === 'generate_proposal' || ev.tool === 'generate_microsite')?.tool ?? null;

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

  const fetchInsights = useCallback(
    (ns: string) => {
      fetch(`/api/namespace/${encodeURIComponent(ns)}/insights`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
        .then((res) => (res.ok ? res.json() : { suggestions: [] }))
        .then((data: { suggestions: string[] }) => setInsights(data.suggestions ?? []))
        .catch(() => {
          /* insights unavailable — leave as-is */
        });
    },
    [apiKey],
  );

  useEffect(() => {
    if (!viewMicrosite || !apiKey) return;
    setViewMicrositeAST(null);
    setViewMicrositeLoading(true);
    fetchMicrositeContent(apiKey, viewMicrosite.namespace, viewMicrosite.proposalId, undefined, viewMicrosite.entryId)
      .then(({ ast }) => {
        setViewMicrositeAST(ast as LayoutAST);
        const html = ((ast as LayoutAST)?.sections?.[0] as { customHtml?: string })?.customHtml ?? '';
        if (html) {
          const normalized = normalizeMicrositeHtml(html);
          setChatActiveSrcDoc(normalized);
          setChatEditHistory([html]);
          setChatEditHistoryIndex(0);
        }
      })
      .catch(() => {})
      .finally(() => setViewMicrositeLoading(false));
  }, [viewMicrosite, apiKey]);

  // Reset bridge editor state when a new microsite is opened
  useEffect(() => {
    setChatEditModeActive(false);
    setChatSelectedElement(null);
    setChatHoveredElement(null);
    setChatEditBanner('');
    chatDeselectingRef.current = false;
    chatSelectedRef.current = null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMicrosite?.entryId]);

  // Keep chatSelectedRef in sync for bridge listener closure
  useEffect(() => { chatSelectedRef.current = chatSelectedElement; }, [chatSelectedElement]);

  // Track iframe container height for InlineEditPanel above/below flip
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = chatIframeContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      setChatIframeContainerH(entry.contentRect.height);
      setChatIframeContainerW(entry.contentRect.width);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [viewMicrositeAST]);

  // Bridge message listener — only active when edit mode is on
  useEffect(() => {
    if (!chatEditModeActive) return;
    function handleBridgeMsg(e: MessageEvent) {
      const d = e.data as Partial<BridgeMessage>;
      if (d?.source !== 'microsite-bridge') return;
      if (d.type === 'hover') { setChatHoveredElement(d as BridgeMessage); return; }
      if (d.type === 'leave') { setChatHoveredElement(null); return; }
      if (d.type === 'track-update' && d.rect) {
        setChatSelectedElement(prev => prev ? { ...prev, rect: d.rect! } : prev);
        setChatHoveredElement(prev => prev ? { ...prev, rect: d.rect! } : prev);
        return;
      }
      if (d.type === 'select') {
        if (chatDeselectingRef.current) return;
        const incoming = d as BridgeMessage;
        if (chatSelectedRef.current?.path && chatSelectedRef.current.path === incoming.path) {
          clearChatBridgeSelection();
        } else {
          setChatSelectedElement(incoming);
        }
      }
    }
    window.addEventListener('message', handleBridgeMsg);
    return () => window.removeEventListener('message', handleBridgeMsg);
  }, [chatEditModeActive]);

  function clearChatBridgeSelection() {
    chatIframeRef.current?.contentWindow?.postMessage({ source: 'microsite-host', type: 'deselect' }, '*');
    chatDeselectingRef.current = true;
    setTimeout(() => { chatDeselectingRef.current = false; }, 150);
    setChatSelectedElement(null);
    setChatHoveredElement(null);
  }

  function chatGetCurrentHtml(): string {
    return (viewMicrositeAST?.sections?.[0] as { customHtml?: string })?.customHtml ?? '';
  }

  function chatRefreshSelectedElement(updatedHtml: string) {
    const path = chatSelectedRef.current?.path;
    if (!path) return;
    try {
      const doc = new DOMParser().parseFromString(updatedHtml, 'text/html');
      const parts = path.split(/\s*>\s*/);
      let scope: Element | Document = doc;
      for (const part of parts) {
        const tagM = part.match(/^(\w[\w-]*)/);
        if (!tagM) return;
        const tag = tagM[1];
        const idM = part.match(/#([\w-]+)/);
        const clsM = part.match(/\.([\w-]+)/);
        const nthM = part.match(/:nth-of-type\((\d+)\)/);
        const nth = nthM ? parseInt(nthM[1], 10) : 1;
        const candidates: Element[] = Array.from(scope.querySelectorAll(scope instanceof Document ? tag : `:scope > ${tag}`))
          .filter((el) => (!idM?.[1] || el.id === idM[1]) && (!clsM?.[1] || el.classList.contains(clsM[1])));
        const found: Element | null = candidates[nth - 1] ?? null;
        if (!found) return;
        scope = found;
      }
      if (scope instanceof Element) {
        setChatSelectedElement((prev) => prev
          ? { ...prev, outerHtml: scope.outerHTML.slice(0, 8192), text: ((scope as Element).textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) }
          : prev,
        );
      }
    } catch { /* leave as-is on parse error */ }
  }

  function chatApplyHtml(html: string) {
    // Capture scroll position before srcDoc update so the iframe can restore it after reload
    const scrollY = Math.round(chatIframeRef.current?.contentWindow?.scrollY ?? 0);
    const normalized = normalizeMicrositeHtml(html);
    let srcDoc = chatEditModeActive ? injectBridgeScript(normalized) : normalized;
    if (scrollY > 0) {
      const scrollScript = `<script>(function(){var y=${scrollY};var b=document.documentElement;b.style.scrollBehavior='auto';function r(){window.scrollTo(0,y);}r();setTimeout(r,50);setTimeout(r,150);})()</script>`;
      const bodyClose = srcDoc.lastIndexOf('</body>');
      srcDoc = bodyClose !== -1 ? srcDoc.slice(0, bodyClose) + scrollScript + srcDoc.slice(bodyClose) : srcDoc + scrollScript;
    }
    // Refresh selected element state so InlineEditPanel reflects new bold/italic/color etc.
    chatRefreshSelectedElement(html);
    setChatActiveSrcDoc(srcDoc);
    setViewMicrositeAST((prev) =>
      prev
        ? ({
            ...prev,
            sections: [
              { ...(prev.sections[0] as object), customHtml: html },
              ...prev.sections.slice(1),
            ],
          } as unknown as LayoutAST)
        : prev,
    );
    // Push to history
    setChatEditHistory((prev) => {
      const base = prev.slice(0, chatEditHistoryIndex + 1);
      const next = [...base, html];
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });
    setChatEditHistoryIndex((prev) => Math.min(prev + 1, 49));
  }

  // Client-side deterministic HTML patching — handles STYLE, TEXT, BG_IMAGE, IMAGE, REMOVE
  function applyClientHtmlPatch(html: string, instruction: string): string | null {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    function findEl(cssPath: string): Element | null {
      try {
        const parts = cssPath.trim().split(/\s*>\s*/);
        let scope: Element | Document = doc;
        for (const part of parts) {
          const tagM = part.match(/^(\w[\w-]*)/);
          if (!tagM) return null;
          const tag = tagM[1];
          const idM = part.match(/#([\w-]+)/);
          const clsM = part.match(/\.([\w-]+)/);
          const nthM = part.match(/:nth-of-type\((\d+)\)/);
          const nth = nthM ? parseInt(nthM[1], 10) : 1;
          const id = idM?.[1];
          const cls = clsM?.[1];
          const sel = scope instanceof Document ? tag : `:scope > ${tag}`;
          const candidates: Element[] = Array.from(scope.querySelectorAll(sel)).filter(
            (el: Element) => (!id || el.id === id) && (!cls || el.classList.contains(cls)),
          );
          const found: Element | null = candidates[nth - 1] ?? null;
          if (!found) return null;
          scope = found;
        }
        return scope instanceof Document ? null : (scope as Element);
      } catch {
        return null;
      }
    }

    const stylePatch = instruction.match(/^__STYLE_PATCH__:([\s\S]+?)\|\|([\w-]+)\|\|([\s\S]+?)(?:\|\|[\s\S]*)?$/);
    if (stylePatch) {
      const [, path, prop, value] = stylePatch;
      const el = findEl(path) as HTMLElement | null;
      if (el) {
        const existing = el.getAttribute('style') ?? '';
        const propRx = new RegExp(`(?:^|;)\\s*${prop}\\s*:[^;]*`, 'gi');
        let cleaned = existing.replace(propRx, '').replace(/^;+|;+$/g, '').trim();
        if (prop === 'background-color') {
          // Clear background-image so the color isn't hidden behind it
          cleaned = cleaned.replace(/background-image\s*:[^;]*/gi, '').replace(/;{2,}/g, ';').replace(/^;|;$/g, '').trim();
          el.setAttribute('style', cleaned
            ? `${cleaned}; ${prop}: ${value}; background-image: none !important`
            : `${prop}: ${value}; background-image: none !important`);
        } else {
          el.setAttribute('style', cleaned ? `${cleaned}; ${prop}: ${value} !important` : `${prop}: ${value} !important`);
        }
      }
      return doc.documentElement.outerHTML;
    }

    const textPatch = instruction.match(/^__TEXT_PATCH__:([\s\S]+?)\|\|([\s\S]+?)(?:\|\|[\s\S]*)?$/);
    if (textPatch) {
      const [, path, newText] = textPatch;
      const el = findEl(path);
      if (el) el.textContent = newText;
      return doc.documentElement.outerHTML;
    }

    const bgImagePatch = instruction.match(/^__BG_IMAGE_PATCH__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|[\s\S]*)?$/);
    if (bgImagePatch) {
      const [, path, url] = bgImagePatch;
      const el = findEl(path) as HTMLElement | null;
      if (el) {
        const existing = el.getAttribute('style') ?? '';
        const cleaned = existing.replace(/background(?:-image)?\s*:[^;]*/gi, '').replace(/^;+|;+$/g, '').trim();
        el.setAttribute('style', cleaned
          ? `${cleaned}; background-image:url('${url}') !important; background-size:cover !important; background-position:center !important`
          : `background-image:url('${url}') !important; background-size:cover !important; background-position:center !important`);
      }
      return doc.documentElement.outerHTML;
    }

    const imgInject = instruction.match(/^__IMAGE_INJECT_SCOPED__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|[\s\S]*)?$/);
    if (imgInject) {
      const [, path, url] = imgInject;
      const el = findEl(path);
      if (el) {
        const img = el.tagName.toLowerCase() === 'img' ? el : el.querySelector('img');
        if (img) { img.setAttribute('src', url); (img as HTMLElement).removeAttribute('srcset'); }
      }
      return doc.documentElement.outerHTML;
    }

    const removeByPath = instruction.match(/^__REMOVE_BY_PATH__:([\s\S]+?)(?:\|\|[\s\S]*)?$/);
    if (removeByPath) {
      const [, path] = removeByPath;
      const el = findEl(path);
      if (el) el.parentNode?.removeChild(el);
      return doc.documentElement.outerHTML;
    }

    const iconReplace = instruction.match(/^__ICON_REPLACE__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)(?:\|\|[\s\S]*)?$/);
    if (iconReplace) {
      const [, path, url] = iconReplace;
      const el = findEl(path);
      if (el) {
        const img = el.tagName.toLowerCase() === 'img' ? el : el.querySelector('img');
        if (img) img.setAttribute('src', url);
      }
      return doc.documentElement.outerHTML;
    }

    const svgReplace = instruction.match(/^__SVG_REPLACE__:([\s\S]+?)\|\|([\s\S]+)$/);
    if (svgReplace) {
      const [, path, svgMarkup] = svgReplace;
      const el = findEl(path);
      if (el) {
        const container = doc.createElement('div');
        container.innerHTML = svgMarkup;
        const newSvg = container.querySelector('svg');
        const existingSvg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
        if (newSvg && existingSvg) existingSvg.replaceWith(newSvg);
      }
      return doc.documentElement.outerHTML;
    }

    const logoSwap = instruction.match(/^__LOGO_SWAP__:([\s\S]+?)\|\|((?:https?:\/\/|data:)[^\|]+)$/);
    if (logoSwap) {
      const [, path, url] = logoSwap;
      const el = findEl(path);
      if (el) {
        const img = el.tagName.toLowerCase() === 'img' ? el : el.querySelector('img');
        if (img) { img.setAttribute('src', url); (img as HTMLElement).removeAttribute('srcset'); }
      }
      return doc.documentElement.outerHTML;
    }

    const gradientTextPatch = instruction.match(/^__GRADIENT_TEXT_PATCH__:([\s\S]+?)\|\|([\s\S]+?)(?:\|\|[\s\S]*)?$/);
    if (gradientTextPatch) {
      const [, path, gradientCss] = gradientTextPatch;
      if (/^(?:linear|radial|conic)-gradient\(/i.test(gradientCss.trim())) {
        const el = findEl(path) as HTMLElement | null;
        if (el) {
          const existing = el.getAttribute('style') ?? '';
          const STRIP = ['background', 'background-image', '-webkit-background-clip', 'background-clip', '-webkit-text-fill-color', 'color'];
          const cleaned = existing
            .split(';').map(s => s.trim())
            .filter(s => { if (!s) return false; const p = s.split(':')[0]?.trim().toLowerCase() ?? ''; return !STRIP.includes(p); })
            .join('; ');
          const gradProps = `background-image:${gradientCss};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent`;
          el.setAttribute('style', cleaned ? `${cleaned}; ${gradProps}` : gradProps);
        }
      }
      return doc.documentElement.outerHTML;
    }

    return null;
  }

  async function applyChatMicrositeInstruction(instruction: string, banner: string) {
    if (!viewMicrosite || !apiKey || chatEditing) return;
    const currentHtml = chatGetCurrentHtml();
    if (!currentHtml) return;

    const patched = applyClientHtmlPatch(currentHtml, instruction);
    if (patched) {
      chatApplyHtml(patched);
      setChatEditBanner(banner);
      setTimeout(() => setChatEditBanner(''), 3000);
      // Persist to server in background
      try {
        const updatedAst = {
          ...viewMicrositeAST!,
          sections: [
            { ...(viewMicrositeAST!.sections[0] as object), customHtml: patched },
            ...viewMicrositeAST!.sections.slice(1),
          ],
        } as unknown as LayoutAST;
        await saveMicrositeAst(apiKey, viewMicrosite.namespace, viewMicrosite.proposalId, updatedAst, viewMicrosite.entryId);
      } catch { /* non-fatal */ }
      return;
    }
    // Non-patchable instruction — no-op for now
  }

  const chatCanUndo = chatEditHistoryIndex > 0;
  const chatCanRedo = chatEditHistoryIndex < chatEditHistory.length - 1;

  function chatHandleUndo() {
    if (!chatCanUndo) return;
    const newIdx = chatEditHistoryIndex - 1;
    const html = chatEditHistory[newIdx];
    setChatEditHistoryIndex(newIdx);
    const normalized = normalizeMicrositeHtml(html);
    setChatActiveSrcDoc(chatEditModeActive ? injectBridgeScript(normalized) : normalized);
    setViewMicrositeAST((prev) =>
      prev
        ? ({ ...prev, sections: [{ ...(prev.sections[0] as object), customHtml: html }, ...prev.sections.slice(1)] } as unknown as LayoutAST)
        : prev,
    );
  }

  function chatHandleRedo() {
    if (!chatCanRedo) return;
    const newIdx = chatEditHistoryIndex + 1;
    const html = chatEditHistory[newIdx];
    setChatEditHistoryIndex(newIdx);
    const normalized = normalizeMicrositeHtml(html);
    setChatActiveSrcDoc(chatEditModeActive ? injectBridgeScript(normalized) : normalized);
    setViewMicrositeAST((prev) =>
      prev
        ? ({ ...prev, sections: [{ ...(prev.sections[0] as object), customHtml: html }, ...prev.sections.slice(1)] } as unknown as LayoutAST)
        : prev,
    );
  }

  const chatHint = () => chatSelectedElement?.outerHtml?.slice(0, 400) ?? '';

  async function handleChatStylePatch(prop: string, value: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__STYLE_PATCH__:${chatSelectedElement.path}||${prop}||${value}||${chatHint()}`, `${prop} updated`);
  }
  async function handleChatGradientTextPatch(gradientCss: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__GRADIENT_TEXT_PATCH__:${chatSelectedElement.path}||${gradientCss}||${chatHint()}`, 'Gradient updated');
  }
  async function handleChatTextPatch(newText: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__TEXT_PATCH__:${chatSelectedElement.path}||${newText}||${chatHint()}`, 'Text updated');
  }
  async function handleChatImageReplace(url: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__IMAGE_INJECT_SCOPED__:${chatSelectedElement.path}||${url}||${chatHint()}`, 'Image replaced');
  }
  async function handleChatBgImagePatch(url: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__BG_IMAGE_PATCH__:${chatSelectedElement.path}||${url}||${chatHint()}`, 'Background image updated');
  }
  async function handleChatIconReplace(url: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__ICON_REPLACE__:${chatSelectedElement.path}||${url}||${chatHint()}`, 'Icon replaced');
  }
  async function handleChatSvgReplace(svgMarkup: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__SVG_REPLACE__:${chatSelectedElement.path}||${svgMarkup}`, 'Icon replaced');
  }
  async function handleChatLogoReplace(url: string) {
    if (chatSelectedElement?.path) {
      await applyChatMicrositeInstruction(`__LOGO_SWAP__:${chatSelectedElement.path}||${url}`, 'Logo updated');
    }
  }
  async function handleChatVideoReplace(url: string) {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__VIDEO_INJECT__:${chatSelectedElement.path}||${url}||${chatHint()}`, 'Video updated');
  }
  async function handleChatRemoveSection() {
    if (!chatSelectedElement?.path) return;
    await applyChatMicrositeInstruction(`__REMOVE_BY_PATH__:${chatSelectedElement.path}||${chatHint()}`, 'Removed');
    clearChatBridgeSelection();
  }
  async function handleChatRemoveSectionContainer() {
    if (!chatSelectedElement) return;
    const sectionM = chatSelectedElement.path?.match(/\b(section#[\w-]+)/);
    if (sectionM) {
      await applyChatMicrositeInstruction(`__REMOVE_BY_PATH__:${sectionM[1]}`, 'Section removed');
    } else if (chatSelectedElement.sectionType) {
      await applyChatMicrositeInstruction(`__REMOVE_BY_PATH__:section#${chatSelectedElement.sectionType}`, 'Section removed');
    }
    clearChatBridgeSelection();
  }

  // Load persisted chat history and initial insights on mount (or namespace change)
  useEffect(() => {
    const ns = namespace || 'default';

    // Cancel any in-flight generation execution from the previous namespace
    if (chatExecIdRef.current !== null) {
      removeExecution(chatExecIdRef.current);
      chatExecIdRef.current = null;
    }

    // Clear current chat state immediately so the old namespace's messages
    // and insights don't linger while the new namespace's data loads.
    skipNextScrollRef.current = true;
    setMessages([]);
    setInsights([]);
    setIngestChipDismissed(localStorage.getItem(`ingest-chip-dismissed-${ns}`) === '1');
    setNudgeReady(false);
    setActiveQuestion(null);
    setComposerConfirmation(null);
    setGeneratedDoc(null);
    reset();
    setDisplayed('');
    revealedLenRef.current = 0;

    void (async () => {
      const sessionId = await resolveSessionId(ns, apiKey);
      chatSessionIdRef.current = sessionId;

      fetch(`/api/chat/session/${sessionId}/history?namespace=${encodeURIComponent(ns)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
        .then((res) => (res.ok ? res.json() : { messages: [] }))
        .then(
          (data: {
            messages: Array<{
              id: string;
              role: 'user' | 'assistant' | 'upload';
              content: string;
              timestamp?: string;
              metadata?: { proposalArtifactId?: string; displayName?: string; fileSize?: number; fileNames?: string[] };
            }>;
          }) => {
            // Map server history → Message objects. Upload cards are stored server-side
            // with role='upload'; reconstruct them in chronological order alongside chat messages.
            const messages: Message[] = data.messages.map((m) => {
              if (m.role !== 'upload') return m as Message;
              return {
                id: m.id,
                role: 'upload' as const,
                content: '',
                uploadData: {
                  fileName: m.metadata?.displayName ?? '',
                  fileSize: m.metadata?.fileSize ?? 0,
                  progress: 0,
                  status: 'processing' as const,
                  stage: 'Queued',
                },
              };
            });

            skipNextScrollRef.current = true;
            setMessages(messages);

            // Resume polling for upload messages newer than 24 h — older ones are terminal.
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
            const recentUploads = data.messages.filter(
              (m) => m.role === 'upload' && new Date(m.timestamp ?? 0).getTime() > oneDayAgo,
            );
            for (const m of recentUploads) {
              const fileNames = m.metadata?.fileNames ?? [];
              if (fileNames.length > 0) setActiveUploadPoll({ msgId: m.id, fileNames });
            }
          },
        )
        .catch(() => {
          /* history unavailable — start fresh */
        });

      // Page-load recovery: restore pending extraction cards from previous session
      fetchPendingExtractions(apiKey, ns)
        .then(({ pending }) => {
          useExtractionCardStore.getState().loadRecoveryCards(
            pending.map((p) => ({
              cardId: p.cardId,
              namespace: ns,
              fileName: p.fileName ?? p.documentId,
              classification: p.classification ?? 'client_source',
              extractedFields: Object.entries(p.fields ?? {}).map(([key, field]) => ({
                key: key as RequirementKey,
                value: field?.value,
                confidence: field?.confidence ?? 0,
                conflict: p.conflicts?.find((c) => c.key === key),
              })),
              knowledgeEntryCount: p.knowledgeEntries?.length ?? 0,
              highConfidenceCount: Object.values(p.fields ?? {}).filter((f) => (f?.confidence ?? 0) >= 0.8).length,
              lowConfidenceCount: Object.values(p.fields ?? {}).filter((f) => (f?.confidence ?? 0) < 0.8).length,
              notFoundFields: [],
              expiresAt: p.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              cardState: 'pending' as const,
              addedAt: Date.now(),
            })),
          );
        })
        .catch(() => {
          /* pending extractions unavailable */
        });

      fetchInsights(ns);
      setTimeout(() => textareaRef.current?.focus(), 0);
    })();
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
    const observer = new IntersectionObserver(([entry]) => setHeaderScrolled(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Same scroll-border behaviour for the microsite viewer header
  useEffect(() => {
    const sentinel = msSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setMsHeaderScrolled(!entry.isIntersecting), {
      threshold: 0,
    });
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

  // Auto-scroll when messages or displayed text changes, but skip bulk loads (history restore)
  useEffect(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, displayed]);

  // Typewriter effect for Ask-from-Brief
  useEffect(() => {
    if (!typeTarget) return;
    if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    setInput('');
    let i = 0;
    function tick() {
      i++;
      const next = typeTarget.slice(0, i);
      setInput(next);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
      }
      if (i < typeTarget.length) {
        typeTimerRef.current = setTimeout(tick, 20);
      } else {
        setTypeTarget('');
      }
    }
    typeTimerRef.current = setTimeout(tick, 20);
    return () => {
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    };
  }, [typeTarget]);

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

  const submitWithSkill = useCallback((pendingMessage: string, skillSlug: string | null) => {
    const msg = skillSlug
      ? `Generate a proposal using the "${skillSlug}" proposal skill`
      : pendingMessage;
    const ns = namespace || 'default';
    setSkillPickerRequest(null);
    setActiveSkillSlug(skillSlug);
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: msg }]);
    startStream({ message: msg, namespace: ns, chatSessionId: chatSessionIdRef.current ?? undefined });
  }, [namespace, startStream]);

  const submit = useCallback(() => {
    const q = input.trim();
    if (!q || isStreaming) return;

    // If the user intends to generate a proposal and skills are available, show skill picker
    const isGenerateProposal = /\bgenerate\b.*\bproposal\b|\bproposal\b.*\bgenerate\b/i.test(q);
    const wantsSkillExplicitly = /\bskill\b/i.test(q);
    if (isGenerateProposal && !wantsSkillExplicitly && availableSkills.length > 0) {
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setSkillPickerRequest({ pendingMessage: q });
      return;
    }

    // Commit any in-progress streaming response to history
    if (chunks || sections.length > 0 || confirmationRequest || questionsRequest) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: chunks,
          sections: sections.length > 0 ? [...sections] : undefined,
          confirmation: confirmationRequest ?? undefined,
          questionsRequest: questionsRequest ?? undefined,
        },
      ]);
      // Cancel any in-flight generation execution from the previous stream
      if (chatExecIdRef.current !== null) {
        removeExecution(chatExecIdRef.current);
        chatExecIdRef.current = null;
      }
      reset();
    }

    setActiveQuestion(null);
    setComposerConfirmation(null);
    setSkillPickerRequest(null);
    setActiveSkillSlug(null);
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: q }]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const ns = namespace || 'default';

    // Intercept system queries — answer from API directly, skip RAG
    trySystemQuery(q, apiKey, ns).then((answer) => {
      if (answer !== null) {
        setMessages((prev) => [...prev, { id: `assistant-${Date.now()}`, role: 'assistant', content: answer }]);
        return;
      }
      startStream({ message: q, namespace: ns, chatSessionId: chatSessionIdRef.current ?? undefined });
    });
  }, [
    input,
    isStreaming,
    chunks,
    sections,
    confirmationRequest,
    questionsRequest,
    availableSkills,
    namespace,
    apiKey,
    reset,
    startStream,
    removeExecution,
  ]);

  // ── Extraction card handlers ───────────────────────────────────

  const handleCardConfirm = useCallback(
    async (
      cardId: string,
      overrides?: Record<string, { value: string }>,
      resolvedConflicts?: Record<string, string>,
    ) => {
      const ns = namespace ?? 'default';
      try {
        const result = await confirmExtractionCard(apiKey, ns, cardId, overrides, resolvedConflicts);
        useExtractionCardStore.getState().updateCardState(cardId, 'confirmed', {
          fieldsWritten: result.fieldsWritten.length,
        });
        brief.refresh();
      } catch (err) {
        console.error('[Chat] failed to confirm extraction card', err);
      }
    },
    [apiKey, namespace, brief],
  );

  const handleCardDiscard = useCallback(
    async (cardId: string) => {
      const ns = namespace ?? 'default';
      try {
        await discardExtractionCard(apiKey, ns, cardId);
        useExtractionCardStore.getState().updateCardState(cardId, 'discarded');
      } catch (err) {
        console.error('[Chat] failed to discard extraction card', err);
      }
    },
    [apiKey, namespace],
  );

  const handleCardReclassify = useCallback(
    async (cardId: string, newClassification: DocumentClassification) => {
      const ns = namespace ?? 'default';
      try {
        await reclassifyExtractionCard(apiKey, ns, cardId, newClassification);
        useExtractionCardStore.getState().updateCardState(cardId, 'discarded');
      } catch (err) {
        console.error('[Chat] failed to reclassify extraction card', err);
      }
    },
    [apiKey, namespace],
  );

  const handleCardFill = useCallback((cardId: string, fieldKey: RequirementKey) => {
    const label = fieldKey
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
    setInput(`What is the ${label} for this engagement?`);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // ── File upload inline progress callbacks ─────────────────────────

  const handleUploadStart = useCallback(
    (files: File[]) => {
      const id = crypto.randomUUID();
      const displayName = files.length > 1 ? `${files[0].name} +${files.length - 1} more` : files[0].name;
      const totalSize = files.reduce((acc, f) => acc + f.size, 0);
      const fileNames = files.map((f) => f.name);
      uploadMsgIdRef.current = id;
      uploadedFileNamesRef.current = fileNames;
      uploadedFileSizeRef.current = totalSize;
      setMessages((prev) => [
        ...prev,
        {
          id,
          role: 'upload',
          content: '',
          uploadData: { fileName: displayName, fileSize: totalSize, progress: 0, status: 'uploading' },
        },
      ]);
    },
    [namespace],
  );

  const handleUploadProgress = useCallback((progress: number) => {
    const id = uploadMsgIdRef.current;
    if (!id) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.uploadData ? { ...m, uploadData: { ...m.uploadData, progress } } : m)),
    );
  }, []);

  const handleUploadDone = useCallback(
    (queued: Array<{ fileName: string; jobId: string }>) => {
      for (const { fileName, jobId } of queued) {
        addExecution({ id: jobId, type: 'ingestion', status: 'queued', title: fileName });
      }

      const id = uploadMsgIdRef.current;
      if (!id) return;
      const fileNames = queued.map((q) => q.fileName);

      // Persist the upload card to server history so it survives page refreshes.
      if (apiKey && chatSessionIdRef.current) {
        const displayName = uploadedFileNamesRef.current.length > 1
          ? `${uploadedFileNamesRef.current[0]} +${uploadedFileNamesRef.current.length - 1} more`
          : (uploadedFileNamesRef.current[0] ?? '');
        postUploadMessage(apiKey, chatSessionIdRef.current, namespace || 'default', {
          id,
          displayName,
          fileSize: uploadedFileSizeRef.current,
          fileNames,
        }).catch(() => { /* non-critical */ });
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.uploadData
            ? { ...m, uploadData: { ...m.uploadData, progress: 100, status: 'processing', stage: 'Queued' } }
            : m,
        ),
      );
      setActiveUploadPoll({ msgId: id, fileNames });
    },
    [addExecution, apiKey, namespace],
  );

  const handleUploadError = useCallback(
    (errorMessage?: string) => {
      const id = uploadMsgIdRef.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id && m.uploadData ? { ...m, uploadData: { ...m.uploadData, status: 'error', errorMessage } } : m,
        ),
      );
      uploadMsgIdRef.current = null;
      uploadedFileNamesRef.current = [];
    },
    [],
  );

  useEffect(() => {
    if (!activeUploadPoll || !apiKey || !namespace) return;
    const { msgId, fileNames } = activeUploadPoll;
    const startedAt = Date.now();
    const POLL_TIMEOUT_MS = 3 * 60 * 1000; // give up after 3 minutes
    const MISSING_GRACE_MS = 15_000;       // treat files gone >15s as failed

    function resolveAs(terminalStatus: 'done' | 'error', errorMessage?: string) {
      clearInterval(interval);
      setActiveUploadPoll(null);
      uploadMsgIdRef.current = null;
      uploadedFileNamesRef.current = [];
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.uploadData
            ? { ...m, uploadData: { ...m.uploadData, status: terminalStatus, errorMessage } }
            : m,
        ),
      );
      if (terminalStatus === 'done') {
        setFileRefreshTick((t) => t + 1);
        // Fetch context summary and surface what was extracted as an assistant message
        fetchBriefReadiness(apiKey, namespace || 'default')
          .then(({ context }) => {
            const summary = buildUploadSummaryMessage(fileNames, context);
            setMessages((prev) => [
              ...prev,
              {
                id: `assistant-upload-summary-${Date.now()}`,
                role: 'assistant',
                content: summary,
              },
            ]);
          })
          .catch(() => { /* non-critical */ });
      }
    }

    const interval = setInterval(async () => {
      try {
        const elapsed = Date.now() - startedAt;
        if (elapsed > POLL_TIMEOUT_MS) {
          resolveAs('error', 'Indexing timed out');
          return;
        }

        const fetched = await fetchKnowledgeFiles(apiKey, namespace || 'default');
        const relevant = fetched.filter((f) => fileNames.includes(f.fileName));

        // Files not found — deleted or namespace reset. Give a short grace period
        // then treat as failed so the card doesn't spin forever.
        if (relevant.length === 0) {
          if (elapsed > MISSING_GRACE_MS) resolveAs('error', 'Files not found');
          return;
        }

        const allTerminal = relevant.every(
          (f) => f.status === 'indexed' || f.status === 'extracted' || f.status === 'failed',
        );
        if (allTerminal) {
          const anySuccess = relevant.some((f) => f.status === 'indexed' || f.status === 'extracted');
          const failedFiles = relevant.filter((f) => f.status === 'failed');
          const errorMessage = failedFiles.length > 0 ? (failedFiles[0]?.error ?? 'Processing failed') : undefined;
          resolveAs(anySuccess ? 'done' : 'error', errorMessage);
        } else {
          const hasExtracting = relevant.some((f) => f.status === 'extracting');
          const hasProcessing = relevant.some((f) => f.status === 'processing');
          const stage = hasExtracting ? 'Extracting…' : hasProcessing ? 'Indexing…' : 'Queued';
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId && m.uploadData ? { ...m, uploadData: { ...m.uploadData, stage } } : m)),
          );
        }
      } catch {
        /* ignore transient errors */
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [activeUploadPoll, apiKey, namespace]);
  const sendConfirmation = useCallback(
    (msg: string) => {
      if (isStreaming) return;
      // Commit current stream to history first
      if (chunks || confirmationRequest || questionsRequest) {
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: chunks,
            confirmation: confirmationRequest ?? undefined,
            questionsRequest: questionsRequest ?? undefined,
          },
        ]);
        reset();
      }
      setActiveQuestion(null);
      setComposerConfirmation(null);
      lastPhaseRef.current = '';
      lastLoggedPhaseRef.current = '';
      setProposalLog([]);
      setRevealedCount(0);
      clearPendingGeneration();
      setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: 'user', content: msg }]);
      const ns = namespace || 'default';
      startStream({ message: msg, namespace: ns, chatSessionId: chatSessionIdRef.current ?? undefined });
    },
    [isStreaming, chunks, confirmationRequest, questionsRequest, namespace, startStream, reset, clearPendingGeneration],
  );

  function handleClear() {
    // Rotate to a new session ID so the fresh chat has clean history
    const ns = namespace || 'default';
    const newId = crypto.randomUUID();
    localStorage.setItem(localSessionKey(ns), newId);
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

  const hasPendingGenerationHere = pendingGeneration?.status === 'generating' && pendingGeneration.namespace === (namespace || 'default');
  const hasContent = messages.length > 0 || !!chunks || sections.length > 0 || !!generatedDoc || isGeneratingFromModal || hasPendingGenerationHere;

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

  // Resolve display name for the active skill slug
  const activeSkillName = activeSkillSlug
    ? (availableSkills.find((s) => s.slug === activeSkillSlug)?.displayName ?? activeSkillSlug)
    : null;

  // Parse numeric version from a proposal filename or namespaced artifact id.
  // Returns 1 for the first proposal (no _v suffix), N for subsequent ones.
  const parseProposalVersion = (filenameOrPath: string | undefined): number => {
    if (!filenameOrPath) return 1;
    const bare = filenameOrPath.includes('::') ? filenameOrPath.split('::').slice(1).join('::') : filenameOrPath;
    const fileName = bare.replace(/\\/g, '/').split('/').pop() ?? bare;
    const match = fileName.match(/_proposal(?:_v(\d+))?\.md$/);
    return match?.[1] ? parseInt(match[1], 10) : 1;
  };

  // True once any proposal-specific signal arrives during a stream.
  // Used to switch from thinking dots → progress bar without overlap.
  const isProposalStream = sections.length > 0 || toolEvents.length > 0 || hadPhaseRef.current;

  // Accumulate proposal generation phases as text lines — each phase types in as a new line.
  const [proposalLog, setProposalLog] = useState<string[]>([]);
  const lastLoggedPhaseRef = useRef('');
  useEffect(() => {
    if (isProposalStream && phase && phase !== lastLoggedPhaseRef.current) {
      lastLoggedPhaseRef.current = phase;
      setProposalLog((prev) => [...prev, phase]);
    }
    if (!isStreaming && !isProposalStream) {
      lastLoggedPhaseRef.current = '';
    }
  }, [isProposalStream, isStreaming, phase]);

  // Progressive section reveal — sections arrive all at once from the backend,
  // so we expose them one-by-one at 350ms intervals to simulate streaming.
  const [revealedCount, setRevealedCount] = useState(0);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (sections.length > revealedCount) {
      revealTimerRef.current = setTimeout(() => setRevealedCount((c) => c + 1), 350);
      return () => { if (revealTimerRef.current) clearTimeout(revealTimerRef.current); };
    }
  }, [sections.length, revealedCount]);
  const revealedSections = sections.slice(0, revealedCount);
  const isRevealing = revealedCount < sections.length;

  // Sync proposal generation state to the store so the card persists across navigation.
  const generationClientName = (briefFields.clientName?.value as string) || namespace || 'New Proposal';
  useEffect(() => {
    if (isStreaming && generationTool === 'generate_proposal') {
      startPendingGeneration(generationClientName, namespace || 'default');
    }
  }, [isStreaming, generationTool, generationClientName, namespace, startPendingGeneration]);

  useEffect(() => {
    if (!isStreaming && !isRevealing && sections.length > 0) {
      finishPendingGeneration();
    }
  }, [isStreaming, isRevealing, sections.length, finishPendingGeneration]);

  // Poll for completion when a generating state was restored from localStorage on refresh
  useEffect(() => {
    if (!pendingGeneration || pendingGeneration.status !== 'generating') return;
    const isRestored = Date.now() - pendingGeneration.startedAt > 5_000;
    if (!isRestored) return;
    const iv = setInterval(() => {
      fetchProposals(apiKey)
        .then((proposals) => {
          const found = proposals.some(
            (p) =>
              p.client.toLowerCase() === pendingGeneration.client.toLowerCase() &&
              p.fileName.startsWith(`${pendingGeneration.namespace}::`)
          );
          if (found) finishPendingGeneration();
        })
        .catch(() => {});
    }, 5_000);
    return () => clearInterval(iv);
  }, [pendingGeneration, apiKey, finishPendingGeneration]);

  if (viewMicrosite) {
    const dismiss = () => {
      setViewMicrosite(null);
      setViewMicrositeAST(null);
      setChatEditModeActive(false);
      clearChatBridgeSelection();
      setChatActiveSrcDoc('');
      setChatEditHistory([]);
      setChatEditHistoryIndex(-1);
    };
    const hasCustomHtml = !!chatGetCurrentHtml();

    return (
      <div className="chat-v2">
        <div className="chat-v2-center" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <header className={`chat-v2-header${msHeaderScrolled ? ' chat-v2-header--scrolled' : ''}`}>
            <div className="chat-v2-header-left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {chatEditModeActive && (
                <>
                  <button
                    className="chat-v2-clear-btn"
                    onClick={chatHandleUndo}
                    disabled={!chatCanUndo}
                    aria-label="Undo"
                    title="Undo"
                    style={{ opacity: chatCanUndo ? 1 : 0.35 }}
                  >
                    ↩
                  </button>
                  <button
                    className="chat-v2-clear-btn"
                    onClick={chatHandleRedo}
                    disabled={!chatCanRedo}
                    aria-label="Redo"
                    title="Redo"
                    style={{ opacity: chatCanRedo ? 1 : 0.35 }}
                  >
                    ↪
                  </button>
                </>
              )}
              <span className="chat-v2-ns">{viewMicrosite.displayName}</span>
              {chatEditModeActive && chatEditBanner && (
                <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>{chatEditBanner}</span>
              )}
            </div>
            <div className="chat-v2-header-right">
              {viewMicrositeAST && hasCustomHtml && (
                <button
                  className="chat-v2-clear-btn"
                  style={{
                    background: chatEditModeActive ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
                    color: chatEditModeActive ? 'var(--primary)' : undefined,
                    borderRadius: 6,
                  }}
                  onClick={() => {
                    const next = !chatEditModeActive;
                    setChatEditModeActive(next);
                    if (!next) clearChatBridgeSelection();
                    const html = chatGetCurrentHtml();
                    if (html) {
                      const normalized = normalizeMicrositeHtml(html);
                      setChatActiveSrcDoc(next ? injectBridgeScript(normalized) : normalized);
                    }
                  }}
                  aria-label="Toggle edit mode"
                  title={chatEditModeActive ? 'Exit edit mode' : 'Edit microsite'}
                >
                  <Icon icon={Pencil} size="md" />
                </button>
              )}
              <button className="chat-v2-clear-btn" onClick={dismiss} aria-label="Close microsite">
                <Icon icon={X} size="md" />
              </button>
            </div>
          </header>

          {viewMicrositeLoading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
              Loading…
            </div>
          )}

          {!viewMicrositeLoading && viewMicrositeAST && !hasCustomHtml && (
            // AST-only microsite (no customHtml) — render with React component, no bridge editing
            <div style={{ flex: 1, overflow: 'auto' }}>
              {viewMicrositeAST.generationMode !== 'classic' ? (
                <MicrositePro
                  ref={micrositeRef}
                  ast={viewMicrositeAST}
                  mode="embedded"
                  namespace={viewMicrosite.namespace}
                  proposalId={viewMicrosite.proposalId}
                />
              ) : (
                <Microsite
                  ref={micrositeRef}
                  ast={viewMicrositeAST}
                  mode="embedded"
                  namespace={viewMicrosite.namespace}
                  proposalId={viewMicrosite.proposalId}
                />
              )}
            </div>
          )}

          {!viewMicrositeLoading && viewMicrositeAST && hasCustomHtml && (
            <div
              ref={chatIframeContainerRef}
              style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}
            >
              <iframe
                ref={chatIframeRef}
                srcDoc={chatActiveSrcDoc}
                style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                sandbox="allow-scripts allow-same-origin"
                title="Microsite preview"
              />
              {chatEditModeActive && (
                <SelectionOverlay
                  hovered={chatHoveredElement}
                  selected={chatSelectedElement}
                  isProcessing={chatEditing}
                  onClearSelected={() => clearChatBridgeSelection()}
                />
              )}
              {chatEditModeActive && chatSelectedElement && (
                <InlineEditPanel
                  selected={chatSelectedElement}
                  micrositeEditing={chatEditing}
                  containerH={chatIframeContainerH}
                  containerW={chatIframeContainerW}
                  onStylePatch={handleChatStylePatch}
                  onGradientTextPatch={handleChatGradientTextPatch}
                  onTextPatch={handleChatTextPatch}
                  onImageReplace={handleChatImageReplace}
                  onBgImagePatch={handleChatBgImagePatch}
                  onIconReplace={handleChatIconReplace}
                  onSvgReplace={handleChatSvgReplace}
                  onLogoReplace={handleChatLogoReplace}
                  onVideoReplace={handleChatVideoReplace}
                  onRemoveSection={handleChatRemoveSection}
                  onRemoveSectionContainer={handleChatRemoveSectionContainer}
                  onClose={() => clearChatBridgeSelection()}
                />
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <BriefContext.Provider value={brief}>
    <div className="chat-v2">
      <style>{`
        @keyframes composer-ask-pulse {
          0%   { box-shadow: 0 0 0 0   color-mix(in srgb, var(--primary) 0%,  transparent); }
          12%  { box-shadow: 0 0 0 5px color-mix(in srgb, var(--primary) 30%, transparent); }
          100% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--primary) 0%,  transparent); }
        }
        .chat-v2-composer--pulse { animation: composer-ask-pulse 1200ms ease-out forwards; }
      `}</style>
      {/* ── Center column: header + messages + composer ── */}
      <div className="chat-v2-center">
        <header className={`chat-v2-header${headerScrolled ? ' chat-v2-header--scrolled' : ''}`}>
          <div className="chat-v2-header-left">
            <button
              className="topbar-hamburger"
              onClick={openMobileNav}
              aria-label="Open navigation"
            >
              <Icon icon={Menu} size="md" />
            </button>
            <span className="chat-v2-ns">{namespace || 'default'}</span>
          </div>
          <div className="chat-v2-header-right">
            {/* <button
              className={`chat-v2-panel-toggle${traceOpen ? ' active' : ''}`}
              onClick={() => setTraceOpen((v) => !v)}
              title={traceOpen ? 'Hide trace' : 'Show execution trace'}
            >
              ⚡
            </button> */}
            <ThemeToggle />
            {namespace && (
              <button
                className={`chat-v2-panel-toggle${collectionPanelOpen ? ' active' : ''}`}
                onClick={() => setCollectionPanelOpen((v) => !v)}
                title={collectionPanelOpen ? 'Hide panel' : 'Show panel'}
              >
                <Icon icon={collectionPanelOpen ? PanelRightClose : PanelRightOpen} size="sm" />
              </button>
            )}
          </div>
        </header>

        <BriefPanel
          namespace={namespace || 'default'}
          apiKey={apiKey}
          open={briefModalOpen}
          onOpenChange={setBriefModalOpen}
          onAskField={(question) => {
            setTimeout(() => {
              textareaRef.current?.focus();
              setComposerPulse(true);
              setTimeout(() => setComposerPulse(false), 700);
              setTypeTarget(question);
            }, 60);
          }}
        />

        {/* ── Body ── */}
        <div className="chat-v2-body">
          <div className="chat-v2-main">
            {/* Messages */}
            <div className="chat-v2-messages">
              <div ref={sentinelRef} style={{ height: 0, flexShrink: 0 }} />
              {!hasContent && extractionCards.filter((c) => c.cardState === 'pending').length === 0 ? (
                <ChatEmptyState namespace={namespace} onSuggestion={handleSuggestion} insights={insights} />
              ) : hasContent ? (
                <>
                  {messages.map((m, i) => {
                    if (m.role === 'upload' && m.uploadData) {
                      return (
                        <div
                          key={m.id}
                          className="chat-v2-message chat-v2-message--user"
                          style={{ '--msg-i': i } as React.CSSProperties}
                        >
                          <ChatFileUpload
                            {...m.uploadData}
                            chunkProgress={
                              m.uploadData.status === 'processing'
                                ? ingestionProgress[m.uploadData.fileName]
                                : undefined
                            }
                          />
                        </div>
                      );
                    }
                    return (
                      <div
                        key={m.id}
                        className={`chat-v2-message chat-v2-message--${m.role === 'extraction_card' ? 'assistant' : m.role}`}
                        style={{ '--msg-i': i } as React.CSSProperties}
                      >
                        {(m.role === 'assistant' || m.role === 'extraction_card') && (
                          <div className="chat-v2-avatar">AI</div>
                        )}
                        <div
                          className="chat-v2-bubble"
                          style={
                            m.role === 'extraction_card'
                              ? { padding: 0, background: 'none', border: 'none' }
                              : undefined
                          }
                        >
                          {m.role === 'extraction_card' && m.extractionCardId ? (
                            <ExtractionConfirmationCard
                              cardId={m.extractionCardId}
                              namespace={namespace ?? 'default'}
                              apiKey={apiKey}
                              onConfirm={handleCardConfirm}
                              onDiscard={handleCardDiscard}
                              onReclassify={handleCardReclassify}
                              onFill={handleCardFill}
                            />
                          ) : m.role === 'assistant' ? (
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
                                const historyClient =
                                  m.content?.match(/Proposal for "([^"]+)"/)?.[1] || namespace || 'Proposal';
                                const artifactNs =
                                  (m.metadata?.proposalNamespace as string | undefined) || namespace || 'default';
                                const historyHref = `/proposal?artifact=${encodeURIComponent(artifactId)}&namespace=${encodeURIComponent(artifactNs)}&from=chat`;
                                const historyVersion = parseProposalVersion(artifactId);
                                return (
                                  <div>
                                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 400 }}>
                                      Proposal generated
                                    </span>
                                  <div className="proposal-card" style={{ width: 240 }}>
                                    <div className="proposal-card-header">
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <span className="proposal-card-name">{historyClient}</span>
                                      </div>
                                      <span style={{ flexShrink: 0, alignSelf: 'flex-start', display: 'inline-block', background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 100, fontSize: 10, fontWeight: 600, padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4 }}>
                                        v{historyVersion}
                                      </span>
                                    </div>
                                    <div className="proposal-card-footer">
                                      <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>
                                        {namespace || 'default'}
                                      </span>
                                      <Link href={historyHref} className="chat-v2-clear-btn" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                                        View
                                      </Link>
                                    </div>
                                  </div>
                                  </div>
                                );
                              }
                              return (
                                <>
                                  <div className="prose">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
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
                    <div
                      className="chat-v2-message chat-v2-message--assistant"
                      style={{ '--msg-i': messages.length } as React.CSSProperties}
                    >
                      <div className="chat-v2-avatar">AI</div>
                      <div className="chat-v2-bubble">
                        <span
                          style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 16 }}
                        >
                          <span className="ppb-dots">
                            <span />
                            <span />
                            <span />
                          </span>
                          Generating proposal
                        </span>
                      </div>
                    </div>
                  )}
                  {generatedDoc &&
                    !isGeneratingFromModal &&
                    (() => {
                      const clientName = (generatedDoc.metadata?.client as string) || namespace || 'New Proposal';
                      const dateLabel = new Date(generatedDoc.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const genDocVersion = parseProposalVersion(
                        generatedProposalHref
                          ? (new URLSearchParams(generatedProposalHref.split('?')[1] ?? '').get('artifact') ?? '')
                          : ''
                      );
                      return (
                        <div
                          className="chat-v2-message chat-v2-message--assistant"
                          style={{ '--msg-i': messages.length } as React.CSSProperties}
                        >
                          <div className="chat-v2-avatar">AI</div>
                          <div className="chat-v2-bubble" style={{ padding: 0, background: 'none', border: 'none', boxShadow: 'none' }}>
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 400 }}>
                              Proposal generated
                            </span>
                            <div className="proposal-card" style={{ width: 240 }}>
                              <div className="proposal-card-header">
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <span className="proposal-card-name">{clientName}</span>
                                  {dateLabel && (
                                    <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                                      {dateLabel}
                                    </span>
                                  )}
                                </div>
                                <span style={{ flexShrink: 0, alignSelf: 'flex-start', display: 'inline-block', background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 100, fontSize: 10, fontWeight: 600, padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4 }}>
                                  v{genDocVersion}
                                </span>
                              </div>
                              <div className="proposal-card-footer">
                                <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>
                                  {namespace || 'default'}
                                </span>
                                <Link href={generatedProposalHref ?? '/proposal'} className="chat-v2-clear-btn" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                                  View
                                </Link>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                  {/* ── Proposal generation: progress bar + sections + done card ── */}
                  {(isProposalStream || (!isStreaming && (sections.length > 0 || hadGenerationTool)) || hasPendingGenerationHere) && (
                    <div
                      className="chat-v2-message chat-v2-message--assistant"
                      style={{ '--msg-i': messages.length } as React.CSSProperties}
                    >
                      <div className="chat-v2-avatar">AI</div>
                      <div className="chat-v2-bubble chat-v2-bubble--sections">
                        {/* Generating card — shown while streaming or when returning to page mid-generation */}
                        {(isStreaming && sections.length === 0) || (!isProposalStream && !isRevealing && hasPendingGenerationHere) ? (() => {
                          const clientName = pendingGeneration?.client || (briefFields.clientName?.value as string) || namespace || 'New Proposal';
                          const phaseLabel = phase
                            ? phase.replace(/^Running:\s*(generate_?proposal|generate proposal)\s*$/i, 'Generating proposal')
                                   .replace(/^Running:\s*/i, '')
                                   .replace(/_/g, ' ')
                            : 'Generating proposal…';
                          return (
                            <div className="proposal-card proposal-card--generating" style={{ maxWidth: 260 }}>
                              <div className="proposal-card-header">
                                <span className="proposal-card-name">{clientName}</span>
                                <span className="proposal-card-gen-dots">
                                  <span /><span /><span />
                                </span>
                              </div>
                              {activeSkillName && (
                                <div className="proposal-card-skill-label">
                                  <span>Using skill</span>
                                  <strong>{activeSkillName}</strong>
                                </div>
                              )}
                              <div className="proposal-card-footer">
                                <div className="proposal-card-meta">
                                  <span className="proposal-card-ns">{namespace || 'default'}</span>
                                  <span style={{ color: 'var(--border)' }}>·</span>
                                  <span className="proposal-card-date" style={{ color: 'var(--primary)', fontWeight: 500 }}>
                                    {phaseLabel}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })() : null}

                        {/* Inline streaming prose — sections revealed progressively */}
                        {(isRevealing || (!isStreaming && sections.length > 0 && isRevealing)) && (
                          <div className="proposal-inline-stream">
                            {revealedSections.map((s, i) => {
                              const isLast = i === revealedSections.length - 1;
                              return (
                                <div key={s.section} className="proposal-inline-section">
                                  <p className="proposal-inline-heading">{s.section}</p>
                                  <div className="proposal-inline-body">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.content}</ReactMarkdown>
                                    {isLast && <span className="chat-cursor" />}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Section blocks — shown once all sections are revealed */}
                        {!isStreaming && !isRevealing && sections.length > 0 && (
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
                          </div>
                        )}

                        {/* Completion card */}
                        {!isStreaming && !isRevealing &&
                          (sections.length > 0 || hadGenerationTool) &&
                          (() => {
                            if (doneActions?.openMicrositeUrl) {
                              return (
                                <div className="proposal-done-footer">
                                  <div className="proposal-done-actions">
                                    <a
                                      href={doneActions.openMicrositeUrl}
                                      className="proposal-done-link proposal-done-link--primary"
                                    >
                                      View microsite
                                    </a>
                                    {doneActions.openProposalUrl && (
                                      <a
                                        href={`${doneActions.openProposalUrl}${doneActions.openProposalUrl.includes('?') ? '&' : '?'}from=chat`}
                                        className="proposal-done-link"
                                      >
                                        View proposal
                                      </a>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            const clientName =
                              chunks?.match(/Proposal for "([^"]+)"/)?.[1] || namespace || 'New Proposal';
                            const fallbackArtifact = sections[0]?.artifactId;
                            const proposalHref = doneActions?.openProposalUrl
                              ? `${doneActions.openProposalUrl}${doneActions.openProposalUrl.includes('?') ? '&' : '?'}from=chat`
                              : fallbackArtifact
                                ? `/proposal?artifact=${encodeURIComponent(fallbackArtifact)}&namespace=${encodeURIComponent(namespace || 'default')}&from=chat`
                                : `/proposal?from=chat`;
                            const completionVersion = parseProposalVersion(
                              doneActions?.openProposalUrl
                                ? (new URLSearchParams(doneActions.openProposalUrl.split('?')[1] ?? '').get('artifact') ?? fallbackArtifact)
                                : fallbackArtifact
                            );
                            const dateLabel = new Date().toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            });
                            return (
                              <div style={{ marginTop: 12 }}>
                                <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 400 }}>
                                  Proposal generated
                                </span>
                                <div className="proposal-card" style={{ width: 240 }}>
                                  <div className="proposal-card-header">
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <span className="proposal-card-name">{clientName}</span>
                                      {dateLabel && (
                                        <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.4 }}>
                                          {dateLabel}
                                        </span>
                                      )}
                                    </div>
                                    <span style={{ flexShrink: 0, alignSelf: 'flex-start', display: 'inline-block', background: 'var(--primary-soft)', color: 'var(--primary)', borderRadius: 100, fontSize: 10, fontWeight: 600, padding: '2px 8px', letterSpacing: '0.06em', lineHeight: 1.4 }}>
                                      v{completionVersion}
                                    </span>
                                  </div>
                                  {activeSkillName && (
                                    <div className="proposal-card-skill-label">
                                      <span>Generated using</span>
                                      <strong>{activeSkillName}</strong>
                                    </div>
                                  )}
                                  <div className="proposal-card-footer">
                                    <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1 }}>
                                      {namespace || 'default'}
                                    </span>
                                    <Link href={proposalHref} className="chat-v2-clear-btn" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                                      View
                                    </Link>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                      </div>
                    </div>
                  )}

                  {/* ── Status label — non-proposal streams waiting for first chunk ── */}
                  {(isStreaming || showStatusHold) && !chunks && !isProposalStream && (
                    <div className="chat-v2-message chat-v2-message--assistant">
                      <div className="chat-v2-avatar">AI</div>
                      <div className="chat-v2-bubble chat-v2-bubble--thinking">
                        <span className="status-glyph" aria-hidden="true" />
                        <em className="chat-status-text">{displayedPhase}</em>
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
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayed}</ReactMarkdown>
                          </div>
                        )}
                        {!isStreaming && (doneActions?.openTemplatesUrl ?? doneActions?.viewTemplatesUrl) && (
                          <div className="proposal-done-actions" style={{ marginTop: 12 }}>
                            <a
                              href={(doneActions?.openTemplatesUrl ?? doneActions?.viewTemplatesUrl)!}
                              className="proposal-done-link proposal-done-link--primary"
                            >
                              View Templates ↗
                            </a>
                          </div>
                        )}
                        {!isStreaming && doneActions?.openTemplateUrl && (
                          <div className="proposal-done-actions" style={{ marginTop: 12 }}>
                            <a
                              href={`${doneActions.openTemplateUrl}&from=chat`}
                              className="proposal-done-link proposal-done-link--primary"
                            >
                              View Template Draft ↗
                            </a>
                          </div>
                        )}
                        {!isStreaming && doneActions?.openDocumentUrl && (
                          <div className="proposal-done-actions" style={{ marginTop: 12 }}>
                            <a
                              href={`${doneActions.openDocumentUrl}&from=chat`}
                              className="proposal-done-link proposal-done-link--primary"
                            >
                              View Document ↗
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

                  {error && <div className="chat-v2-error">{error}</div>}
                </>
              ) : null}
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
            <div className={`chat-v2-composer-wrap${composerOpen ? ' chat-v2-composer-wrap--question' : ''}`}>
              {/* Animated collapse/expand — always in DOM, transitions open/closed */}
              <div className={`composer-context-wrap${composerOpen ? ' composer-context-wrap--open' : ''}`}>
                <div className="composer-context-inner">
                  {renderConfirmation?.kind === 'confirm_template' && (
                    <div className="composer-question-context">
                      <div className="composer-template-context-header">
                        <p className="composer-question-heading" style={{ margin: 0 }}>Template Recommendation</p>
                        <button type="button" className="composer-question-dismiss"
                          onClick={() => setComposerConfirmation(null)} aria-label="Dismiss">
                          <Icon icon={X} size="sm" />
                        </button>
                      </div>
                      <div className="composer-template-card">
                        <div className="composer-template-title-row">
                          <span className="composer-template-name">{renderConfirmation.templateName}</span>
                          <span className="composer-template-badge">{Math.round(renderConfirmation.confidence * 100)}% match</span>
                        </div>
                        <p className="composer-template-reasoning">{renderConfirmation.reasoning}</p>
                        <ul className="composer-template-section-list">
                          {renderConfirmation.sections.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                        <div className="composer-template-actions">
                          <button type="button" className="composer-template-btn composer-template-btn--primary"
                            onClick={() => sendConfirmation('yes')}>
                            Use this template
                          </button>
                          <button type="button" className="composer-template-btn"
                            onClick={() => sendConfirmation('suggest alternatives')}>
                            Suggest alternatives
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {renderConfirmation?.kind === 'approve_generated_template' && (
                    <div className="composer-question-context">
                      <div className="composer-template-context-header">
                        <p className="composer-question-heading" style={{ margin: 0 }}>Suggested Template</p>
                        <button type="button" className="composer-question-dismiss"
                          onClick={() => setComposerConfirmation(null)} aria-label="Dismiss">
                          <Icon icon={X} size="sm" />
                        </button>
                      </div>
                      <p className="composer-template-subtitle">
                        Based on your brief, here's a proposal structure — approve to start building.
                      </p>
                      <div className="composer-template-card">
                        <div className="composer-template-title-row">
                          <span className="composer-template-name">{renderConfirmation.templateName}</span>
                          <span className="composer-template-badge">{renderConfirmation.sections.length} sections</span>
                        </div>
                        <ul className="composer-template-section-list">
                          {renderConfirmation.sections.map((s) => (
                            <li key={s}>{s}</li>
                          ))}
                        </ul>
                        <div className="composer-template-actions">
                          <button type="button" className="composer-template-btn composer-template-btn--primary"
                            onClick={() => sendConfirmation('approve')}>
                            Approve &amp; build
                          </button>
                          <a href={renderConfirmation.viewLink} target="_blank" rel="noreferrer"
                            className="composer-template-btn">
                            Preview draft ↗
                          </a>
                        </div>
                      </div>
                    </div>
                  )}
                  {renderSkillPicker && (
                    <div className="composer-question-context composer-skill-picker">
                      <div className="composer-template-context-header">
                        <p className="composer-question-heading" style={{ margin: 0 }}>Generate Proposal</p>
                        <button type="button" className="composer-question-dismiss"
                          onClick={() => setSkillPickerRequest(null)} aria-label="Dismiss">
                          <Icon icon={X} size="sm" />
                        </button>
                      </div>
                      <div className="composer-skill-strips">
                        <p className="composer-skill-section-label">Apply a proposal skill</p>
                        {availableSkills.map((skill) => (
                          <button
                            key={skill.slug}
                            type="button"
                            className="composer-skill-strip"
                            onClick={() => submitWithSkill(renderSkillPicker.pendingMessage, skill.slug)}
                          >
                            <span className="composer-skill-strip-dot" />
                            <span className="composer-skill-strip-name">{skill.displayName}</span>
                            <span className="composer-skill-strip-arrow">→</span>
                          </button>
                        ))}
                        <div className="composer-skill-divider" />
                        <button
                          type="button"
                          className="composer-skill-strip composer-skill-strip--plain"
                          onClick={() => submitWithSkill(renderSkillPicker.pendingMessage, null)}
                        >
                          <span className="composer-skill-strip-name">Generate without a skill</span>
                          <span className="composer-skill-strip-arrow">→</span>
                        </button>
                      </div>
                    </div>
                  )}
                  {showIngestNudge && !activeQuestion && !composerConfirmation && !skillPickerRequest && (
                    <div className="composer-question-context">
                      <div className="composer-question-card">
                        <span className="composer-question-content">
                          <span className="composer-question-text">Ingest client documents to generate a proposal</span>
                        </span>
                        <button
                          type="button"
                          className="composer-question-dismiss"
                          onClick={() => {
                            setIngestChipDismissed(true);
                            localStorage.setItem(`ingest-chip-dismissed-${namespace}`, '1');
                          }}
                          aria-label="Dismiss"
                        >
                          <Icon icon={X} size="sm" />
                        </button>
                      </div>
                      <button
                        type="button"
                        className="composer-skill-strip"
                        onClick={() => setShowUpload(true)}
                      >
                        <span className="composer-skill-strip-name">Upload documents</span>
                        <span className="composer-skill-strip-arrow">→</span>
                      </button>
                    </div>
                  )}
                  {renderQuestion && (() => {
                    const aqMatch = renderQuestion.question.match(/^(.*?)\s*\(e\.g\.,(.+)\)$/s);
                    const aqMain = aqMatch ? aqMatch[1].trim() : renderQuestion.question;
                    const aqHint = aqMatch ? `e.g.,${aqMatch[2]}` : '';
                    return (
                      <div className="composer-question-context">
                        <p className="composer-question-heading">Before we begin</p>
                        <div className="composer-question-card">
                          <span className="composer-question-content">
                            <span className="composer-question-text">{aqMain}</span>
                            {aqHint && <span className="composer-question-hint">{aqHint}</span>}
                          </span>
                          <button
                            type="button"
                            className="composer-question-dismiss"
                            onClick={() => setActiveQuestion(null)}
                            aria-label="Dismiss question"
                          >
                            <Icon icon={X} size="sm" />
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
              <div className={`chat-v2-composer${composerPulse ? ' chat-v2-composer--pulse' : ''}${composerOpen ? ' chat-v2-composer--question' : ''}`}>
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
                    <div
                      style={{
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
                      }}
                    >
                      {[
                        {
                          label: 'Ingest',
                          icon: Upload,
                          action: () => {
                            setShowUpload(true);
                            setShowMenu(false);
                          },
                        },
                        {
                          label: 'Memory',
                          icon: Brain,
                          action: () => {
                            setShowMemoryModal(true);
                            setShowMenu(false);
                          },
                        },
                        {
                          label: 'Configuration',
                          icon: SlidersHorizontal,
                          action: () => {
                            setShowConfigModal(true);
                            setShowMenu(false);
                          },
                        },
                      ].map((item) => (
                        <button
                          key={item.label}
                          onClick={item.action}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 14px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 13,
                            color: 'var(--text)',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--panel-soft)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                        >
                          <Icon icon={item.icon} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                          {item.label}
                        </button>
                      ))}
                      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                      <button
                        onClick={() => {
                          if (hasContent && !isStreaming) {
                            setShowClearConfirm(true);
                            setShowMenu(false);
                          }
                        }}
                        disabled={!hasContent || isStreaming}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 14px',
                          background: 'none',
                          border: 'none',
                          cursor: hasContent && !isStreaming ? 'pointer' : 'not-allowed',
                          fontSize: 13,
                          color: hasContent ? 'var(--danger)' : 'var(--muted)',
                          transition: 'background 0.1s',
                          opacity: !hasContent || isStreaming ? 0.4 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (hasContent && !isStreaming) e.currentTarget.style.background = 'var(--panel-soft)';
                        }}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
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
                  placeholder={activeQuestion ? 'Type your answer…' : composerConfirmation ? 'Or type a response…' : 'Ask AI to generate proposal, ingest documents, or analyse knowledge…'}
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
                  {isStreaming ? <span className="spinner chat-spinner-sm" /> : <Icon icon={ArrowUp} size="md" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile backdrop — tap outside to close whichever panel is open */}
      {(collectionPanelOpen && !!namespace) && (
        <div
          className="chat-panel-backdrop"
          onClick={() => setCollectionPanelOpen(false)}
        />
      )}

      {/* ── Unified client panel (tabs: Brief / Proposals / Microsites / Files / Memory) ── */}
      <div
        className="chat-collection-panel"
        style={{
          width: collectionPanelOpen && !!namespace ? 320 : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: 'width 0.22s ease',
          borderLeft: collectionPanelOpen && !!namespace ? '1px solid var(--border)' : 'none',
        }}
      >
        {collectionPanelOpen && !!namespace && (
          <div style={{ width: 320, height: '100%', overflow: 'hidden' }}>
            <ClientPanel
              namespace={namespace}
              collectionStatus={collectionStatus}
              fileRefreshTick={fileRefreshTick}
              onMicrositeClick={(info) => setViewMicrosite(info)}
              onAskField={(question) => {
                setTimeout(() => {
                  textareaRef.current?.focus();
                  setComposerPulse(true);
                  setTimeout(() => setComposerPulse(false), 700);
                  setTypeTarget(question);
                }, 60);
              }}
            />
          </div>
        )}
      </div>

      {/* Execution trace panel */}
      {traceOpen && chatSessionIdRef.current && (
        <ExecutionTracePanel chatSessionId={chatSessionIdRef.current} apiKey={apiKey} live={isStreaming} />
      )}

      {/* Clear Chat confirmation dialog */}
      {showClearConfirm &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 20000,
              background: 'rgba(0,0,0,0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowClearConfirm(false);
            }}
          >
            <div
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                width: '100%',
                maxWidth: 420,
                boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: 52,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0 20px',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--panel-soft)',
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Clear chat</span>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: 'none',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-label="Close"
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
              <div style={{ padding: 24 }}>
                <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 20, lineHeight: 1.5 }}>
                  Clear all messages in the <strong>"{namespace || 'default'}"</strong> session?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => {
                      handleClear();
                      setShowClearConfirm(false);
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--danger)',
                      color: '#fff',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    Clear Chat
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Generate Proposal modal */}
      {showGenerateModal && (
        <div
          className="ai-editor-overlay"
          onClick={() => {
            if (!isGeneratingFromModal) setShowGenerateModal(false);
          }}
        >
          <div className="ai-editor-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="ai-editor-header">
              <h3>Generate Proposal</h3>
              <button
                onClick={() => setShowGenerateModal(false)}
                disabled={isGeneratingFromModal}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: isGeneratingFromModal ? 'not-allowed' : 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--muted)',
                }}
                aria-label="Close"
              >
                <Icon icon={X} size="md" />
              </button>
            </div>
            <div style={{ padding: '0 20px 20px', overflowY: 'auto', maxHeight: 'calc(80vh - 60px)' }}>
              <ProposalForm
                onGenerate={(doc) => {
                  setGeneratedDoc(doc);
                  setShowGenerateModal(false);
                }}
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
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMemoryModal(false);
          }}
        >
          <div
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              width: 'min(580px, 92vw)',
              maxHeight: '88vh',
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{ padding: '22px 24px 18px', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <p
                    style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1.4 }}
                  >
                    Namespace Memory
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                    Namespace memory lets you store structured context that persists across sessions. Paste or write
                    JSON below to define it.
                  </p>
                </div>
                <button
                  onClick={() => setShowMemoryModal(false)}
                  style={{
                    flexShrink: 0,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: 2,
                  }}
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
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 20000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowConfigModal(false);
          }}
        >
          <div
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              width: 'min(580px, 92vw)',
              maxHeight: '88vh',
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{ padding: '22px 24px 18px', flexShrink: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                <div>
                  <p
                    style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1.4 }}
                  >
                    Namespace Configuration
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                    Configuration controls pipeline behavior for this namespace. Edit the JSON below to define defaults.
                  </p>
                </div>
                <button
                  onClick={() => setShowConfigModal(false)}
                  style={{
                    flexShrink: 0,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    marginTop: 2,
                  }}
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
    </BriefContext.Provider>
  );
}
