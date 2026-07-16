'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import {
  ExternalLink,
  ArrowLeft,
  ArrowUp,
  X,
  Check,
  CheckCircle,
  Loader,
  Sparkles,
  Globe,
  FileText,
  ImagePlus,
  ImageIcon,
  MoreHorizontal,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Plus,
  Pencil,
  Link2 as LinkIcon,
  Download,
  Presentation,
  HelpCircle,
} from "lucide-react";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { HelpTip } from "@/components/help/HelpTip";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/lib/auth-context";
import { useSidebar } from "@/lib/sidebar-store";
import {
  MemorySection,
  ClientProfileFields,
} from "@/components/chat/MemorySection";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GenerateV2Modal } from "@/components/microsite/GenerateV2Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MicrositeV2, buildHtml } from "@/components/MicrositeV2";
import { PublishModal } from "@/components/microsite/editor/PublishModal";
import type { LayoutAST } from "@/types/presentation";
import { SelectionOverlay } from "@/components/microsite/smart-editor/SelectionOverlay";
import { InlineEditPanel } from "@/components/microsite/smart-editor/InlineEditPanel";
import {
  type BridgeMessage,
  injectBridgeScript,
  stripPreviewInjections,
  normalizeMicrositeHtml,
  injectSlideScaler,
  buildInstruction,
} from '@/lib/microsite-bridge';
import { generationStore, type Generation } from '@/lib/generation-store';
import { transitionOverlay } from '@/components/system/TransitionOverlay';
import { uploadStore, type UploadEntry } from '@/lib/upload-store';
// UploadEntry is used inside UploadMessageCard only
import {
  getSuperClient,
  getSuperClientGenerations,
  upsertSuperClientGeneration,
  deleteSuperClientGeneration,
  enrichSuperClientUrl,
  appendSuperClientHistory,
  streamSuperClientChat,
  listSuperClientDocuments,
  uploadSuperClientDocument,
  deleteSuperClientDocument,
  openSuperClientDocument,
  listSuperClientProposals,
  getSuperClientProposal,
  deleteSuperClientProposal,
  listSuperClientMicrosites,
  getSuperClientMicrosite,
  saveSuperClientMicrosite,
  deleteSuperClientMicrosite,
  editSuperClientMicrosite,
  revertSuperClientMicrosite,
  patchSuperClientMicrositeHtml,
  editSuperClientSlide,
  patchSuperClientSlideHtml,
  generateMicrositeV2Stream,
  prepareImages,
  type PreparedImage,
  exportSuperClientMicrositeAsPdf,
  listGeneratedDocuments,
  getGeneratedDocumentContent,
  deleteGeneratedDocument,
  listSlides,
  getSlideHtmlUrl,
  deleteSlide,
  fetchClientMemory,
  updateClientStableField,
  type SuperClientMeta,
  type SuperClientHistoryEntry,
  type SuperClientChatEvent,
  type SuperClientFile,
  type SuperClientProposal,
  type SuperClientMicrosite,
  type GeneratedDocument,
  type SavedSlide,
} from "@/lib/api";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  generationId?: string;
  uploadId?: string;
  createdAt?: string;
  editContext?: "microsite" | "proposal" | "document" | "slide";
  documentType?: string;
  // Assistant clarifying question — rendered as a distinct question card.
  isQuestion?: boolean;
  options?: string[];
}

function docTypeLabel(t: string) {
  return t.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
}

function genId() {
  return Math.random().toString(36).slice(2);
}

// Realistic progress steps shown one-at-a-time while each artifact type generates
const GENERATION_STEPS: Record<string, string[]> = {
  slide: [
    "Reading client context…",
    "Analyzing presentation requirements…",
    "Structuring slides…",
    "Writing slide content…",
    "Applying design and layout…",
    "Finalizing presentation…",
  ],
  document: [
    "Reading client context…",
    "Researching topic…",
    "Structuring document…",
    "Writing sections…",
    "Reviewing and refining…",
    "Preparing document…",
  ],
  proposal: [
    "Reading client context…",
    "Analyzing requirements…",
    "Drafting proposal sections…",
    "Refining content…",
    "Finalizing proposal…",
  ],
  microsite: [
    "Reading client context…",
    "Planning layout…",
    "Building sections…",
    "Applying design system…",
    "Optimizing content…",
    "Finalizing microsite…",
  ],
};
const STEP_INTERVAL_MS = 3200;

// ArtifactCard — artifact capsule rendered in the chat message list
function ArtifactCard({
  gid,
  generations,
  version,
  onView,
}: {
  gid: string;
  generations: Generation[];
  version?: number;
  onView: (gen: Generation) => void;
}) {
  const gen = generations.find((g) => g.id === gid);
  const [stepIndex, setStepIndex] = useState(0);

  const isGenerating = gen?.phase === "generating";
  const genType = gen?.type ?? "proposal";

  // Cycle through predefined steps while generating; reset when a new generation starts
  useEffect(() => {
    if (!isGenerating) { setStepIndex(0); return; }
    const steps = GENERATION_STEPS[genType] ?? GENERATION_STEPS.proposal;
    setStepIndex(0);
    const id = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isGenerating, genType, gid]);

  if (!gen) return null;
  const isMicrosite = gen.type === "microsite";
  const isDocument = gen.type === "document";
  const isSlide = gen.type === "slide";
  const isComplete = gen.phase === "complete";
  // Progress 0→99% while generating using an asymptotic curve so it always
  // increments with each new streamed char instead of plateauing at a fixed cap.
  // At 32k chars ≈ 86%, at 50k ≈ 96%; snaps to 100 on complete.
  const progressPct = isComplete ? 100 : Math.round(99 * (1 - Math.exp(-(gen.charCount ?? 0) / 16000)));
  return (
    <div
      onClick={isComplete ? () => onView(gen) : undefined}
      style={{
        position: 'relative',
        borderRadius: 12,
        background: 'var(--panel)',
        overflow: 'hidden',
        maxWidth: 280,
        cursor: isComplete ? 'pointer' : 'default',
      }}
    >
      {/* Check icon — top right when complete */}
      {isComplete && (
        <span style={{ position: 'absolute', top: 9, right: 10 }}>
          <CheckCircle size={13} style={{ color: '#22c55e', display: 'block' }} />
        </span>
      )}

      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
          padding: '7px 44px 7px 10px',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--primary-soft, rgba(99,102,241,0.12))',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 1,
          }}
        >
          {isMicrosite ? (
            <Globe size={13} strokeWidth={1.5} />
          ) : (
            <FileText size={13} strokeWidth={1.5} />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Type label row — mirrors right-panel format */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--primary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {isDocument && isComplete && gen.result?.documentType
                ? gen.result.documentType.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
                : isMicrosite ? "Microsite" : isDocument ? "Document" : isSlide ? "Presentation" : "Proposal"}
            </span>
            {isDocument && isComplete && gen.result?.preferredFormat && gen.result.preferredFormat !== "md" && (
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  background: "var(--primary-soft, rgba(99,102,241,0.12))",
                  color: "var(--primary)",
                  borderRadius: 3,
                  padding: "1px 4px",
                  textTransform: "uppercase",
                }}
              >
                {gen.result.preferredFormat}
              </span>
            )}
          </div>
          <span
            style={{
              display: 'block',
              fontSize: 13,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingRight: 4,
            }}
          >
            {gen.title.split(/\s*[-–—]\s*/)[0]}
          </span>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {gen.clientSlug} · {isMicrosite ? "Microsite" : "Proposal"}
          </div>
        </div>
      </div>

      {/* Loader — absolute top-right while generating */}
      {isGenerating && (
        <span style={{ position: 'absolute', top: 9, right: 10 }}>
          <Loader
            size={13}
            style={{
              color: 'var(--primary)',
              animation: 'spin 1s linear infinite',
              display: 'block',
            }}
          />
        </span>
      )}

      {/* Progress bar — microsite only while generating */}
      {isGenerating && isMicrosite && (
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: "var(--border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  borderRadius: 2,
                  background: "var(--primary)",
                  width: `${progressPct}%`,
                  transition: "width 0.8s ease",
                }}
              />
            </div>
            <span
              style={{
                fontSize: 10,
                color: "var(--muted)",
                fontVariantNumeric: "tabular-nums",
                flexShrink: 0,
              }}
            >
              {Math.round(progressPct)}%
            </span>
          </div>
        </div>
      )}
      {/* Steps — hide once complete */}
      {gen.steps.length > 0 && isGenerating && (
        <div
          style={{
            padding: "0 10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {gen.steps.slice(-4).map((step, i, arr) => {
            const isLast = i === arr.length - 1;
            const isActive = isLast && isGenerating;
            return (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  color: isActive ? "var(--text)" : "var(--muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                {isActive ? (
                  <span
                    className="status-glyph"
                    style={{ width: 6, height: 6, flexShrink: 0 }}
                  />
                ) : (
                  <span
                    style={{ color: "#22c55e", fontSize: 9, flexShrink: 0 }}
                  >
                    ✓
                  </span>
                )}
                <span style={{ flex: 1 }}>{step}</span>
              </div>
            );
          })}
        </div>
      )}
      {gen.phase === "error" && (
        <div
          style={{
            padding: '0 10px 12px',
            fontSize: 11,
            color: 'var(--danger)',
          }}
        >
          {gen.error ?? 'Generation failed'}
        </div>
      )}
      {/* Download link — document with auto-exported file */}
      {isDocument && isComplete && gen.result?.downloadUrl && (
        <a
          href={gen.result.downloadUrl}
          download
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px 8px",
            fontSize: 11,
            color: "var(--primary)",
            textDecoration: "none",
            borderTop: "1px solid var(--border)",
          }}
        >
          <Download size={11} strokeWidth={1.5} />
          Download {gen.result.preferredFormat?.toUpperCase()}
        </a>
      )}
    </div>
  );
}

// UploadMessageCard — upload progress card rendered in the chat thread (user side).
// Subscribes directly to uploadStore for XHR progress, and reads live doc status
// from `docs` (polled by the right panel) to show a rich sequential step visualization.
const SC_PROCESSING_STEPS = [
  { label: 'Reading document' },
  { label: 'Extracting information' },
  { label: 'Building search index' },
] as const;

function UploadMessageCard({ uploadId, docs }: { uploadId: string; docs: SuperClientFile[] }) {
  const [entry, setEntry] = useState<UploadEntry | undefined>(() => uploadStore.get(uploadId));
  useEffect(() => uploadStore.subscribe((all) => setEntry(all.find((u) => u.id === uploadId))), [uploadId]);

  // Advance through processing steps on a timer to show believable progress
  const [processingStep, setProcessingStep] = useState(0);
  const isProcessingState = entry && entry.status !== 'uploading' && entry.status !== 'failed';
  const docForEntry = entry ? docs.find((d) => d.fileName === (entry.storedFileName ?? entry.fileName)) : undefined;
  const isProcessing = isProcessingState && (!docForEntry || docForEntry.status === 'processing');

  useEffect(() => {
    if (!isProcessing) {
      setProcessingStep(0);
      return;
    }
    const t1 = setTimeout(() => setProcessingStep(1), 2500);
    const t2 = setTimeout(() => setProcessingStep(2), 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isProcessing]);

  if (!entry) return null;

  const isUploading = entry.status === 'uploading';
  const isFailed = entry.status === 'failed';
  const doc = !isUploading ? docs.find((d) => d.fileName === (entry.storedFileName ?? entry.fileName)) : undefined;
  const docStatus = doc?.status;
  const isDone = !isUploading && !isFailed && docStatus === 'extracted';
  const isDocFailed = !isUploading && !isFailed && docStatus === 'failed';

  // ── Done: collapsed pill ────────────────────────────────────────
  if (isDone) {
    return (
      <div className="chat-file-upload chat-file-upload--done">
        <FileText size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--primary)' }} />
        <span className="chat-file-upload__name chat-file-upload__name--inline">{entry.fileName}</span>
        <CheckCircle size={14} strokeWidth={2} className="chat-file-upload__check-icon" />
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────
  if (isFailed || isDocFailed) {
    const msg = isFailed ? (entry.error ?? 'Upload failed') : 'Extraction failed';
    const label = msg.length > 80 ? msg.slice(0, 80) + '…' : msg;
    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <FileText size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--muted)' }} />
          <span className="chat-file-upload__name">{entry.fileName}</span>
        </div>
        <div className="chat-file-upload__track">
          <div className="chat-file-upload__fill chat-file-upload__fill--error" style={{ width: '100%' }} />
        </div>
        <div className="chat-file-upload__status chat-file-upload__status--error">{label}</div>
      </div>
    );
  }

  // ── Uploading: progress bar + pending steps ─────────────────────
  if (isUploading) {
    const pct = entry.pct ?? 0;
    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <FileText size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--primary)' }} />
          <span className="chat-file-upload__name">{entry.fileName}</span>
        </div>
        <div className="chat-file-upload__track">
          <div className="chat-file-upload__fill" style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
        <div className="chat-file-upload__steps">
          <div className="chat-file-upload__step chat-file-upload__step--active">
            <span className="chat-file-upload__step-icon">
              <span className="chat-file-upload__step-spinner" />
            </span>
            <span>Uploading{pct > 0 && pct < 100 ? ` ${pct}%` : '…'}</span>
          </div>
          {SC_PROCESSING_STEPS.map((step) => (
            <div key={step.label} className="chat-file-upload__step chat-file-upload__step--pending">
              <span className="chat-file-upload__step-icon">
                <span className="chat-file-upload__step-dot-pending" />
              </span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Processing: timed step advance ─────────────────────────────
  return (
    <div className="chat-file-upload">
      <div className="chat-file-upload__header">
        <FileText size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--primary)' }} />
        <span className="chat-file-upload__name">{entry.fileName}</span>
      </div>
      <div className="chat-file-upload__steps">
        <div className="chat-file-upload__step chat-file-upload__step--done">
          <span className="chat-file-upload__step-icon">
            <CheckCircle size={12} strokeWidth={2} className="chat-file-upload__step-check" />
          </span>
          <span>Uploaded</span>
        </div>
        {SC_PROCESSING_STEPS.map((step, idx) => {
          const isDoneStep = idx < processingStep;
          const isActiveStep = idx === processingStep;
          return (
            <div
              key={step.label}
              className={`chat-file-upload__step${isDoneStep ? ' chat-file-upload__step--done' : isActiveStep ? ' chat-file-upload__step--active' : ' chat-file-upload__step--pending'}`}
            >
              <span className="chat-file-upload__step-icon">
                {isDoneStep ? (
                  <CheckCircle size={12} strokeWidth={2} className="chat-file-upload__step-check" />
                ) : isActiveStep ? (
                  <span className="chat-file-upload__step-spinner" />
                ) : (
                  <span className="chat-file-upload__step-dot-pending" />
                )}
              </span>
              <span>
                {step.label}
                {isActiveStep ? '…' : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SuperClientPage() {
  const { name } = useParams<{ name: string }>();
  const { apiKey } = useAuth();
  const router = useRouter();
  const { collapsed: sidebarCollapsed, collapse: collapseSidebar, expand: expandSidebar } = useSidebar();
  const sidebarWasCollapsedRef = useRef(false);

  const collapseForPanel = useCallback(() => {
    sidebarWasCollapsedRef.current = sidebarCollapsed;
    collapseSidebar();
  }, [sidebarCollapsed, collapseSidebar]);

  const restoreSidebar = useCallback(() => {
    if (!sidebarWasCollapsedRef.current) {
      expandSidebar();
    }
  }, [expandSidebar]);

  const [meta, setMeta] = useState<SuperClientMeta | null>(null);
  const [contextMd, setContextMd] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memoryKey, setMemoryKey] = useState(0);
  const [error, setError] = useState('');

  const [docs, setDocs] = useState<SuperClientFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hadProcessingRef = useRef(false);
  const summarizedDocsRef = useRef<Set<string>>(new Set());
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  const [proposals, setProposals] = useState<SuperClientProposal[]>([]);
  const [viewingProposal, setViewingProposal] = useState<{
    fileName: string;
    title: string;
    content: string;
  } | null>(null);

  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocument[]>([]);
  const [viewingDocument, setViewingDocument] = useState<{
    id: string;
    title: string;
    documentType: string;
    content: string;
  } | null>(null);
  const lastDocumentRef = useRef<typeof viewingDocument>(null);
  if (viewingDocument) lastDocumentRef.current = viewingDocument;

  const [hoveredGenDocId, setHoveredGenDocId] = useState<string | null>(null);
  const [menuGenDocId, setMenuGenDocId] = useState<string | null>(null);
  const [menuGenDocPos, setMenuGenDocPos] = useState({ top: 0, right: 0 });
  const [confirmDeleteGenDoc, setConfirmDeleteGenDoc] = useState<string | null>(null);
  const genDocMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [showDocExportMenu, setShowDocExportMenu] = useState(false);
  const [docExportLoading, setDocExportLoading] = useState(false);
  const [showSlideExportMenu, setShowSlideExportMenu] = useState(false);
  const [slideExportLoading, setSlideExportLoading] = useState<'pdf' | 'pptx' | null>(null);
  const [slideExportMsg, setSlideExportMsg] = useState('');
  // ── Slide editing (mirrors microsite editing state) ──────────────────────
  const [slideEditInput, setSlideEditInput] = useState('');
  const [slideEditing, setSlideEditing] = useState(false);
  const [slideEditBanner, setSlideEditBanner] = useState('');
  // Ref holds the current in-memory HTML (for passing as currentHtml to the edit API).
  const slideCurrentHtmlRef = useRef<string | null>(null);
  // srcDoc drives the slide iframe — edits apply in-place without remounting.
  const [slideSrcDoc, setSlideSrcDoc] = useState('');
  const slideIframeRef = useRef<HTMLIFrameElement>(null);
  const MAX_SLIDE_HISTORY = 50;
  const [slideEditHistory, setSlideEditHistory] = useState<string[]>([]);
  const [slideEditHistoryIndex, setSlideEditHistoryIndex] = useState(-1);
  const [slideEditSavedHistoryIndex, setSlideEditSavedHistoryIndex] = useState(-1);
  const canSlideUndo = slideEditHistoryIndex > 0;
  const canSlideRedo = slideEditHistoryIndex < slideEditHistory.length - 1;
  const hasUnsavedSlideChanges = slideEditHistory.length > 0 && slideEditHistoryIndex !== slideEditSavedHistoryIndex;
  const [slideStripVisible, setSlideStripVisible] = useState(true);
  const [documentStripVisible, setDocumentStripVisible] = useState(true);
  const [slideDragging, setSlideDragging] = useState(false);
  const [slideDragHover, setSlideDragHover] = useState(false);
  const slideDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const [microsites, setMicrosites] = useState<SuperClientMicrosite[]>([]);
  const [viewingMicrosite, setViewingMicrosite] = useState<{
    id: string;
    ast: LayoutAST;
    renderKey: string;
  } | null>(null);
  const [fullscreenMicrosite, setFullscreenMicrosite] = useState<LayoutAST | null>(null);
  const [chatPanelWidth, setChatPanelWidth] = useState(344);
  const [micrositeDragging, setMicrositeDragging] = useState(false);
  const [micrositeDragHover, setMicrositeDragHover] = useState(false);
  const micrositeDragRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const [iframeContainerH, setIframeContainerH] = useState(0);
  const [iframeContainerW, setIframeContainerW] = useState(0);
  const slideIframeContainerRef = useRef<HTMLDivElement>(null);
  const [slideIframeContainerH, setSlideIframeContainerH] = useState(0);
  const [slideIframeContainerW, setSlideIframeContainerW] = useState(0);
  const MICROSITE_MIN_WIDTH = 500;
  const CHAT_MIN_WIDTH = 360;

  // Callback ref: the container div is conditionally rendered, so a useRef+useEffect([])
  // would fire before the element mounts and silently do nothing. A callback ref fires
  // exactly when the element enters/leaves the DOM, guaranteeing the ResizeObserver
  // is wired up as soon as the first microsite opens.
  const _iframeContainerRoRef = useRef<ResizeObserver | null>(null);
  const iframeContainerRef = useCallback((el: HTMLDivElement | null) => {
    _iframeContainerRoRef.current?.disconnect();
    _iframeContainerRoRef.current = null;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setIframeContainerH(el.offsetHeight);
      setIframeContainerW(el.offsetWidth);
    });
    ro.observe(el);
    setIframeContainerH(el.offsetHeight);
    setIframeContainerW(el.offsetWidth);
    _iframeContainerRoRef.current = ro;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp chatPanelWidth whenever the container resizes (e.g. left nav opens/closes)
  useEffect(() => {
    const el = splitContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const containerWidth = splitContainerRef.current?.offsetWidth ?? 0;
      if (containerWidth === 0) return;
      const maxChatWidth = Math.max(CHAT_MIN_WIDTH, containerWidth - MICROSITE_MIN_WIDTH);
      setChatPanelWidth((prev) => Math.min(prev, maxChatWidth));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [savedSlides, setSavedSlides] = useState<SavedSlide[]>([]);
  const [viewingSlide, setViewingSlide] = useState<{
    id: string;
    url: string;
    title: string;
    orientation?: 'landscape' | 'portrait';
  } | null>(null);

  // True while any artifact panel (proposal, document, microsite, slide) is
  // open. Read by the presentation/slide generation-complete handler — whose
  // closure captures stale state from when the generation started — to decide
  // whether auto-opening the finished slide deck would hijack something the
  // user is currently viewing or editing. Microsites, documents and proposals
  // always slide in on creation regardless of this ref.
  const artifactOpenRef = useRef(false);
  artifactOpenRef.current = !!(viewingProposal || viewingDocument || viewingMicrosite || viewingSlide);

  // Total count shown on the Artifacts tab — every artifact kind in the panel
  // (microsites + proposals + presentations + generated documents). Derived from
  // the list state so it updates automatically on generation and deletion.
  const artifactCount =
    microsites.length + proposals.length + savedSlides.length + generatedDocs.length;

  // Cache last-seen content so panels render content during close animation (prevents content flash)
  const lastMicrositeRef = useRef(viewingMicrosite);
  if (viewingMicrosite) lastMicrositeRef.current = viewingMicrosite;
  const lastProposalRef = useRef(viewingProposal);
  if (viewingProposal) lastProposalRef.current = viewingProposal;
  const lastSlideRef = useRef(viewingSlide);
  if (viewingSlide) lastSlideRef.current = viewingSlide;
  const [micrositeModal, setMicrositeModal] = useState<{
    proposal: SuperClientProposal;
    markdown: string;
  } | null>(null);
  const [showProposalPicker, setShowProposalPicker] = useState(false);
  const [loadingMicrositeFor, setLoadingMicrositeFor] = useState<string | null>(null);
  const [micrositeEditInput, setMicrositeEditInput] = useState('');
  const [micrositeEditing, setMicrositeEditing] = useState(false);
  const [micrositeEditBanner, setMicrositeEditBanner] = useState('');
  const [pdfDownloading, setPdfDownloading] = useState(false);
  // ── Multi-level undo/redo history ────────────────────────────────────────
  const MAX_HISTORY = 50;
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [editHistoryIndex, setEditHistoryIndex] = useState(-1);
  const [savedHistoryIndex, setSavedHistoryIndex] = useState(-1);
  // Derived flags — no extra state needed
  const canUndo = editHistoryIndex > 0;
  const canRedo = editHistoryIndex < editHistory.length - 1;
  const hasUnsavedChanges = editHistory.length > 0 && editHistoryIndex !== savedHistoryIndex;
  const [editModeActive, setEditModeActive] = useState(false);
  const [micrositeStripVisible, setMicrositeStripVisible] = useState(true);
  const [proposalStripVisible, setProposalStripVisible] = useState(true);
  // Both orientations use CSS aspect-ratio — no JS scaling, no letterboxing, no
  // ratio constants in the viewer. Portrait sections use max-width:calc(100vh*9/16)
  // in the HTML so they self-size to one slide per viewport and center via margin:auto.
  const _pdfAst = lastMicrositeRef.current?.ast;
  const _pdfPortrait = _pdfAst?.pdfOrientation === 'portrait';
  const _isPdf = false;
  const _SW = 0;
  const _SH = 0;
  const _canScale = false;
  const _pdfScale = 1;
  const _pdfOx = 0;
  const _pdfOy = 0;
  // Double-buffer: two stacked iframes. Edits load into the invisible background
  // slot; when it signals ready the slots swap instantly — no white flash.
  const iframeARef = useRef<HTMLIFrameElement>(null);
  const iframeBRef = useRef<HTMLIFrameElement>(null);
  const activeSlotRef = useRef<'A' | 'B'>('A');
  const swapPendingRef = useRef(false);
  const swapSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [iframeSrcDocA, setIframeSrcDocA] = useState('');
  const [iframeSrcDocB, setIframeSrcDocB] = useState('');
  const [activeSlot, setActiveSlot] = useState<'A' | 'B'>('A');
  // Video loading overlay — shown after a video URL replacement until Vimeo buffers.
  const [videoLoading, setVideoLoading] = useState(false);
  const videoLoadingRef = useRef(false); // ref so the swap-ready handler sees current value
  const videoLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setVideoLoadingBoth(v: boolean) {
    videoLoadingRef.current = v;
    setVideoLoading(v);
  }
  // Helpers that always operate on the current active/background slot.
  const getActiveIframe = () => (activeSlotRef.current === 'A' ? iframeARef.current : iframeBRef.current);
  const setActiveSrcDoc = (srcDoc: string) => {
    if (activeSlotRef.current === 'A') setIframeSrcDocA(srcDoc);
    else setIframeSrcDocB(srcDoc);
  };
  const setBackSrcDoc = (srcDoc: string) => {
    if (activeSlotRef.current === 'A') setIframeSrcDocB(srcDoc);
    else setIframeSrcDocA(srcDoc);
  };
  const [hoveredElement, setHoveredElement] = useState<BridgeMessage | null>(null);
  const [selectedElement, setSelectedElement] = useState<BridgeMessage | null>(null);

  // Tell the iframe bridge to clear its internal selectedEl + cancel RAF loop,
  // then clear parent state. Prevents the tracking loop from re-opening the panel.
  const clearBridgeSelection = () => {
    getActiveIframe()?.contentWindow?.postMessage({ source: 'microsite-host', type: 'deselect' }, '*');
    setSelectedElement(null);
    setHoveredElement(null);
  };

  // ── Slide smart-edit mode ─────────────────────────────────────────────────
  const [slideEditModeActive, setSlideEditModeActive] = useState(false);
  const [selectedSlideElement, setSelectedSlideElement] = useState<BridgeMessage | null>(null);
  const [hoveredSlideElement, setHoveredSlideElement] = useState<BridgeMessage | null>(null);

  const clearSlideSelection = () => {
    slideIframeRef.current?.contentWindow?.postMessage(
      { source: "microsite-host", type: "deselect" },
      "*",
    );
    setSelectedSlideElement(null);
    setHoveredSlideElement(null);
  };

  // ── History helpers ───────────────────────────────────────────────────────
  // Push a new HTML snapshot onto the stack. Any forward history is discarded
  // (same behaviour as every text editor: a new edit after undo clears redo).
  function pushHistory(html: string) {
    setEditHistory((prev) => {
      const base = prev.slice(0, editHistoryIndex + 1);
      const next = [...base, html];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
    setEditHistoryIndex((prev) => Math.min(prev + 1, MAX_HISTORY - 1));
  }

  // Seed the history stack when a microsite is first opened or generated.
  function seedHistory(html: string) {
    setEditHistory([html]);
    setEditHistoryIndex(0);
    setSavedHistoryIndex(0); // opening state counts as already "saved"
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Slide history helpers ─────────────────────────────────────────────────
  function pushSlideHistory(html: string) {
    slideCurrentHtmlRef.current = html;
    applySlideHtml(html); // update srcDoc in-place, preserving scroll
    setSlideEditHistory((prev) => {
      const base = prev.slice(0, slideEditHistoryIndex + 1);
      const next = [...base, html];
      return next.length > MAX_SLIDE_HISTORY
        ? next.slice(next.length - MAX_SLIDE_HISTORY)
        : next;
    });
    setSlideEditHistoryIndex((prev) => Math.min(prev + 1, MAX_SLIDE_HISTORY - 1));
  }

  function seedSlideHistory(html: string) {
    slideCurrentHtmlRef.current = html;
    setSlideEditHistory([html]);
    setSlideEditHistoryIndex(0);
    setSlideEditSavedHistoryIndex(0);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Walk a CSS path ("section#hero > div.foo:nth-of-type(1) > span") inside a
  // parsed Document to find the matching element. Used only for refreshing
  // selectedElement state after an LLM edit — best-effort, not safety-critical.
  function findElByPath(doc: Document, path: string): Element | null {
    const parts = path.split(/\s*>\s*/);
    let scope: Element | Document = doc;
    for (const part of parts) {
      const tagMatch = part.match(/^(\w[\w-]*)/);
      if (!tagMatch) return null;
      const tag = tagMatch[1];
      const idMatch = part.match(/#([\w-]+)/);
      const clsMatch = part.match(/\.([\w-]+)/);
      const nthMatch = part.match(/:nth-of-type\((\d+)\)/);
      const nth = nthMatch ? parseInt(nthMatch[1], 10) : 1;
      const id = idMatch?.[1];
      const cls = clsMatch?.[1];
      const selector = scope instanceof Document ? tag : `:scope > ${tag}`;
      const candidates: Element[] = Array.from(scope.querySelectorAll(selector)).filter(
        (el): el is Element => (!id || (el as Element).id === id) && (!cls || (el as Element).classList.contains(cls)),
      );
      const found: Element | null = candidates[nth - 1] ?? null;
      if (!found) return null;
      scope = found;
    }
    return scope instanceof Element ? scope : null;
  }

  // After an LLM edit on a selected element, re-read its outerHtml from the
  // updated document so the InlineEditPanel shows fresh color/font/text values.
  // If the element can't be found at the old path, selectedElement is left as-is.
  function refreshSelectedElementFromHtml(updatedHtml: string) {
    if (!selectedElement?.path) return;
    try {
      const doc = new DOMParser().parseFromString(updatedHtml, 'text/html');
      const el = findElByPath(doc, selectedElement.path);
      if (el) {
        setSelectedElement({
          ...selectedElement,
          outerHtml: el.outerHTML.slice(0, 8192),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
        });
      }
    } catch {
      /* leave selectedElement unchanged on parse error */
    }
  }
  const [editingLogo, setEditingLogo] = useState<{
    base64: string;
    mediaType: string;
  } | null>(null);
  const [editingLogoUrl, setEditingLogoUrl] = useState('');
  const [showEditingLogoUrlInput, setShowEditingLogoUrlInput] = useState(false);
  const editingLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [hoveredMicrositeId, setHoveredMicrositeId] = useState<string | null>(null);
  const [hoveredProposalId, setHoveredProposalId] = useState<string | null>(null);
  const [hoveredDocId, setHoveredDocId] = useState<string | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<'context' | 'artifacts'>('context');

  const [urlEditMode, setUrlEditMode] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const [enrichConfirmPending, setEnrichConfirmPending] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  // Close right panel by default on mobile — prevents it from auto-sliding in on navigation
  useEffect(() => {
    if (window.innerWidth <= 768) setRightPanelOpen(false);
  }, []);
  const [menuMicrositeId, setMenuMicrositeId] = useState<string | null>(null);
  const [menuMicrositePos, setMenuMicrositePos] = useState({
    top: 0,
    right: 0,
  });
  const [menuProposalId, setMenuProposalId] = useState<string | null>(null);
  const [menuProposalPos, setMenuProposalPos] = useState({ top: 0, right: 0 });
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [menuDocPos, setMenuDocPos] = useState({ top: 0, right: 0 });
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<string | null>(null);
  const [confirmDeleteMicrosite, setConfirmDeleteMicrosite] = useState<string | null>(null);
  const [showPublishMicrosite, setShowPublishMicrosite] = useState(false);
  const [confirmDeleteProposal, setConfirmDeleteProposal] = useState<string | null>(null);
  const msMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const propMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const docMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [hoveredSlideId, setHoveredSlideId] = useState<string | null>(null);
  const [menuSlideId, setMenuSlideId] = useState<string | null>(null);
  const [menuSlidePos, setMenuSlidePos] = useState({ top: 0, right: 0 });
  const [confirmDeleteSlide, setConfirmDeleteSlide] = useState<string | null>(null);
  const slideMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [generations, setGenerations] = useState<Generation[]>([]);
  const localGenIdsRef = useRef<Set<string>>(new Set());
  const [changedSections, setChangedSections] = useState<Set<string>>(
    new Set(),
  );
  const [updateBanner, setUpdateBanner] = useState("");
  const [changedDocSections, setChangedDocSections] = useState<Set<string>>(
    new Set(),
  );
  const [updateDocBanner, setUpdateDocBanner] = useState("");

  const [composerStage, setComposerStage] = useState<null | 'select-proposal' | 'configure' | 'clarify'>(null);
  // Active clarifying question — rendered in the composer (like the proposal
  // selector) instead of inline; while set, the text input is hidden.
  const [activeQuestion, setActiveQuestion] = useState<{ text: string; options: string[] } | null>(null);
  // When set, the active clarify question is a local profile-field question
  // (e.g. Project Type missing after ingestion) — the answer is saved straight
  // to client memory instead of being sent to the chat backend.
  const [pendingProfileField, setPendingProfileField] = useState<null | 'projectType'>(null);
  const [composerProposal, setComposerProposal] = useState<{
    proposal: SuperClientProposal;
    markdown: string;
  } | null>(null);
  const [composerInstructions, setComposerInstructions] = useState('');
  const [composerPresentationMode, setComposerPresentationMode] = useState<'web' | 'pdf-landscape' | 'pdf-portrait'>(
    'web',
  );
  const [composerImage, setComposerImage] = useState<{
    base64: string;
    mediaType: string;
  } | null>(null);
  const [composerLogo, setComposerLogo] = useState<{
    base64: string;
    mediaType: string;
  } | null>(null);
  const [composerLogoUrl, setComposerLogoUrl] = useState('');
  const [showLogoUrlInput, setShowLogoUrlInput] = useState(false);
  const [composerMessage, setComposerMessage] = useState('');
  const composerImageInputRef = useRef<HTMLInputElement | null>(null);
  const composerLogoInputRef = useRef<HTMLInputElement | null>(null);
  const composerContextImageInputRef = useRef<HTMLInputElement | null>(null);
  const prevContextImageIdsRef = useRef<string[]>([]);
  const [composerContextImages, setComposerContextImages] = useState<
    Array<{ id: string; base64: string; mediaType: string; preview: string }>
  >([]);
  const [composerPreparedImages, setComposerPreparedImages] = useState<PreparedImage[]>([]);
  const [composerImagesPreparing, setComposerImagesPreparing] = useState(false);
  // IDs of images that were already ready before the current prepare cycle — these keep full opacity
  const [readyImageIds, setReadyImageIds] = useState<Set<string>>(new Set());
  const [composerAttachMenuOpen, setComposerAttachMenuOpen] = useState(false);
  // Holds latest name/apiKey/proposalMarkdown for the prepare effect without being effect deps
  const prepareParamsRef = useRef<{
    name: string;
    apiKey: string;
    proposalMarkdown: string;
  }>({
    name: '',
    apiKey: '',
    proposalMarkdown: '',
  });

  const [toastMsg, setToastMsg] = useState<{
    text: string;
    variant: 'default' | 'error';
    key: number;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(text: string, variant: 'default' | 'error' = 'default') {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg({ text, variant, key: Date.now() });
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3500);
  }

  async function handleEnrichUrl() {
    if (!urlInput.trim() || !name || !apiKey) return;
    setEnriching(true);
    setEnrichError('');
    try {
      const result = await enrichSuperClientUrl(apiKey, name, urlInput.trim());
      setMeta(result.meta);
      setContextMd(result.contextMd);
      setMemoryKey((k) => k + 1);
      setUrlEditMode(false);
      setUrlInput('');
      showToast('Client context updated from website');
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Failed to fetch context');
    } finally {
      setEnriching(false);
    }
  }

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Until the user actively sends something in this session, every chat
  // scroll is instant — opening the page must show the thread already resting
  // at the last bubble, never scrolling to it (late-loading cards and images
  // keep nudging the height well after mount). Smooth scrolling is reserved
  // for live conversation, and even then only for short hops.
  const userInteractedRef = useRef(false);
  const scrollToBottom = useCallback(() => {
    const el = bottomRef.current;
    if (!el) return;
    const dist = el.getBoundingClientRect().top - window.innerHeight;
    const smooth = userInteractedRef.current && dist <= 300;
    el.scrollIntoView({ behavior: smooth ? 'smooth' : ('instant' as ScrollBehavior) });
  }, []);

  // Sync generation store → local state (runs even when component is unmounted via subscription)
  useEffect(() => generationStore.subscribe(setGenerations), []);

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    Promise.all([
      getSuperClient(apiKey, name),
      // Non-fatal: if generations.json is being written during active generation,
      // the request may fail transiently. Continue with empty list rather than
      // blocking the whole page with "Network error".
      getSuperClientGenerations(apiKey, name).catch(() => [] as Awaited<ReturnType<typeof getSuperClientGenerations>>),
    ])
      .then(([{ meta: m, contextMd: ctx, history }, serverGens]) => {
        setMeta(m);
        setContextMd(ctx);
        // Hydrate store with server-persisted generations before building messages
        generationStore.hydrateFromServer(serverGens.map((g) => ({ ...g, createdAt: g.createdAt ?? '' })));
        const historyMsgs: Message[] = history.map((h: SuperClientHistoryEntry) => ({
          id: genId(),
          role: h.role,
          content: h.content,
          createdAt: h.createdAt,
          ...(h.editContext ? { editContext: h.editContext } : {}),
          ...(h.pendingClarification ? { isQuestion: true } : {}),
        }));
        // Fallback: infer editContext from content for messages saved before this field existed.
        // If an assistant message looks like a microsite edit confirmation, tag it and the
        // preceding user message retroactively.
        for (let i = 0; i < historyMsgs.length; i++) {
          const msg = historyMsgs[i];
          if (msg.role === 'assistant' && !msg.editContext) {
            const isMicrositeResult = msg.content.startsWith('Done! Updated') || msg.content.startsWith('Edit failed:');
            if (isMicrositeResult) {
              msg.editContext = 'microsite';
              const prev = historyMsgs[i - 1];
              if (prev && prev.role === 'user' && !prev.editContext) {
                prev.editContext = 'microsite';
              }
            }
          }
        }
        // Re-inject capsule messages for all generations — completed cards stay visible
        // across refreshes; the old "too many cards" bug was from localStorage (now removed)
        const activeGens = generationStore.forClient(name);
        const genMsgs: Message[] = activeGens.map((gen) => ({
          id: `gen-msg-${gen.id}`,
          role: 'assistant' as const,
          content: '',
          generationId: gen.id,
          createdAt: gen.createdAt,
        }));
        // Re-inject upload cards for any active/recent uploads for this client
        const activeUploads = uploadStore.forClient(name);
        const uploadMsgs: Message[] = activeUploads.map((u) => ({
          id: `upload-msg-${u.id}`,
          role: 'user' as const,
          content: '',
          uploadId: u.id,
          createdAt: new Date().toISOString(),
        }));
        // Merge and sort chronologically so generation/upload cards land in the right position
        const allMsgs = [...historyMsgs, ...uploadMsgs, ...genMsgs].sort((a, b) => {
          if (!a.createdAt && !b.createdAt) return 0;
          if (!a.createdAt) return 1;
          if (!b.createdAt) return -1;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        setMessages(allMsgs);
        setMemoryKey((k) => k + 1);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [name, apiKey]);

  // Sync generation store mutations → server for cross-browser / cross-machine persistence.
  // terminal states (complete/error) are written immediately; generating state: first write is
  // immediate (so other tabs/browsers can discover the entry), subsequent updates are debounced 3s.
  useEffect(() => {
    if (!name) return;
    const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const syncedIds = new Set<string>(); // IDs that have had at least one server write
    const prevIds = new Set<string>();

    const unsub = generationStore.subscribe((gens) => {
      const clientGens = gens.filter((g) => g.clientSlug === name);
      const currentIds = new Set(clientGens.map((g) => g.id));

      // Detect dismissed generations and remove from server
      for (const prevId of prevIds) {
        if (!currentIds.has(prevId)) {
          void deleteSuperClientGeneration(apiKey, name, prevId);
          syncedIds.delete(prevId);
        }
      }
      prevIds.clear();
      currentIds.forEach((id) => prevIds.add(id));

      for (const gen of clientGens) {
        const existing = syncTimers.get(gen.id);
        if (existing) clearTimeout(existing);

        // Strip abort (non-serialisable) before sending to server
        const { abort: _abort, ...entry } = gen;
        if (gen.phase === 'complete' || gen.phase === 'error') {
          void upsertSuperClientGeneration(apiKey, name, entry);
          syncTimers.delete(gen.id);
          syncedIds.add(gen.id);
        } else if (!syncedIds.has(gen.id)) {
          // First write for this generation — write immediately so other browsers/tabs
          // can discover it via getSuperClientGenerations on page load.
          void upsertSuperClientGeneration(apiKey, name, entry);
          syncedIds.add(gen.id);
        } else {
          // Subsequent generating-state updates (e.g. charCount) — debounce to avoid flooding
          const timer = setTimeout(() => {
            void upsertSuperClientGeneration(apiKey, name, entry);
            syncTimers.delete(gen.id);
          }, 3000);
          syncTimers.set(gen.id, timer);
        }
      }
    });

    return () => {
      unsub();
      syncTimers.forEach((t) => clearTimeout(t));
    };
  }, [apiKey, name]);

  // Poll the server for any 'generating' entries — both remote (other tab) and local
  // ones where the stream may have disconnected before the completion event arrived.
  useEffect(() => {
    if (!name) return;
    const stillGenerating = generations.filter((g) => g.clientSlug === name && g.phase === 'generating');
    if (stillGenerating.length === 0) return;
    const intervalId = setInterval(async () => {
      try {
        const serverGens = await getSuperClientGenerations(apiKey, name);
        generationStore.refreshFromServer(serverGens.map((g) => ({ ...g, createdAt: g.createdAt ?? '' })));
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearInterval(intervalId);
  }, [generations, apiKey, name]);

  // On page load the chat must simply appear at the bottom — never animate
  // down to it. One instant scroll isn't enough: cards, markdown, and images
  // keep growing the chat height for a moment after mount, and any later
  // smooth scroll then animates over the remaining distance. So for a short
  // settling window after the chat mounts, keep re-pinning to the bottom
  // instantly (behavior:auto); only after the window do new messages
  // smooth-scroll.
  const chatPinnedUntilRef = useRef(0);
  useEffect(() => {
    if (loading) return; // chat isn't mounted until the initial load finishes
    chatPinnedUntilRef.current = Date.now() + 1500;
    const pin = () => bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    pin();
    const t = setInterval(() => {
      if (Date.now() > chatPinnedUntilRef.current) {
        clearInterval(t);
        return;
      }
      pin();
    }, 100);
    return () => clearInterval(t);
  }, [loading]);
  useLayoutEffect(() => {
    if (messages.length === 0) return;
    if (Date.now() < chatPinnedUntilRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      return;
    }
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadDocs = useCallback(() => {
    if (!name) return;
    listSuperClientDocuments(apiKey, name)
      .then(setDocs)
      .catch(() => {});
  }, [name, apiKey]);

  const loadProposals = useCallback(() => {
    if (!name) return;
    listSuperClientProposals(apiKey, name)
      .then(setProposals)
      .catch(() => {});
  }, [name, apiKey]);

  const loadMicrosites = useCallback(() => {
    if (!name) return;
    listSuperClientMicrosites(apiKey, name)
      .then(setMicrosites)
      .catch(() => {});
  }, [name, apiKey]);

  const loadGeneratedDocs = useCallback(() => {
    if (!name) return;
    listGeneratedDocuments(apiKey, name)
      .then(setGeneratedDocs)
      .catch(() => {});
  }, [name, apiKey]);

  const loadSavedSlides = useCallback(() => {
    if (!name) return;
    listSlides(apiKey, name)
      .then(setSavedSlides)
      .catch(() => {});
  }, [name, apiKey]);

  useEffect(() => {
    loadDocs();
    loadProposals();
    loadMicrosites();
    loadGeneratedDocs();
    loadSavedSlides();
  }, [loadDocs, loadProposals, loadMicrosites, loadGeneratedDocs, loadSavedSlides]);

  // When a generation completes, refresh the matching artifact list so the newly
  // created artifact shows up in the right panel (and the tab count updates)
  // without a page refresh. This covers the tab that ran the generation as well
  // as other tabs, which learn of completion via generation-store polling. Each
  // generation id is handled once so we don't refetch on every store broadcast.
  const handledCompletionsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const g of generations) {
      if (g.clientSlug !== name || g.phase !== 'complete') continue;
      if (handledCompletionsRef.current.has(g.id)) continue;
      // Microsites emit an early "complete" (AST only) before the save finishes;
      // skip it — without marking handled — so we wait for the post-save
      // completion carrying a real id and don't refetch a list that doesn't
      // include the new microsite yet (which would clobber the optimistic add).
      if (g.type === 'microsite' && !g.result?.micrositeId) continue;
      handledCompletionsRef.current.add(g.id);
      switch (g.type) {
        case 'proposal':
          loadProposals();
          break;
        case 'microsite':
          loadMicrosites();
          break;
        case 'document':
          loadGeneratedDocs();
          break;
        case 'slide':
          loadSavedSlides();
          break;
      }
    }
  }, [generations, name, loadProposals, loadMicrosites, loadGeneratedDocs, loadSavedSlides]);

  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === 'processing');
    if (hasProcessing && !pollRef.current) {
      hadProcessingRef.current = true;
      pollRef.current = setInterval(loadDocs, 3000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      if (hadProcessingRef.current) {
        hadProcessingRef.current = false;
        setMemoryKey((k) => k + 1);
      }
    } else if (!hasProcessing && !pollRef.current && hadProcessingRef.current) {
      // The cleanup already cleared pollRef before this effect ran —
      // detect the transition by checking hadProcessingRef directly.
      hadProcessingRef.current = false;
      setMemoryKey((k) => k + 1);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [docs, loadDocs]);

  // ── Deep link: /super-client/{name}?open={proposal|microsite|document|slide}&id=…
  // Used by the aggregated /artifacts page so tapping a card there opens the
  // artifact through the exact same right-panel handlers — identical UI/UX to
  // opening it from this page's artifacts tab. Waits for the relevant list to
  // load, then opens the listed item; if the list has loaded and the item is
  // gone, the handler's own 404 path (toast + prune) takes over.
  const deepLinkConsumedRef = useRef(false);
  // Armed when the deep link came from the /artifacts page: closing that
  // artifact returns the user there (same tab). Cleared as soon as the user
  // opens anything else in this client — they've started working here.
  const artifactsReturnRef = useRef<{ type: string; id: string; seen: boolean } | null>(null);
  // Full-page loader label shown while a deep-linked artifact is loading —
  // covers the chat/list UI so the transition from /artifacts goes straight
  // from loader to open artifact instead of flashing the intermediate page.
  // Initialized synchronously from the URL so the very first client render
  // already shows the right label — setting it in an effect flashed
  // "Loading…" for a frame first.
  const [deepLinkOpening, setDeepLinkOpening] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const qs = new URLSearchParams(window.location.search);
    const open = qs.get('open');
    if (!open || !qs.get('id')) return null;
    return open === 'proposal' ? 'Opening proposal…'
      : open === 'microsite' ? 'Opening microsite…'
      : open === 'document' ? 'Opening document…'
      : open === 'slide' ? 'Opening presentation…'
      : null;
  });
  const deepLinkTargetRef = useRef<{ type: string; id: string } | null>(null);
  useEffect(() => {
    if (!deepLinkOpening) return;
    // Claim the shell-level persistent overlay (already visible if the user
    // came from /artifacts; shows it for direct URL entries). Being mounted in
    // the layout it survived the route swap — one continuous loader.
    transitionOverlay.show(deepLinkOpening);
    // Safety: never strand the overlay if the artifact fails to load (404 etc.)
    const t = setTimeout(() => {
      setDeepLinkOpening(null);
      transitionOverlay.hide();
    }, 10_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A load error must release the overlay so the error screen is visible.
  useEffect(() => {
    if (error) transitionOverlay.hide();
  }, [error]);
  // Drop the overlay the moment the deep-linked artifact is actually open.
  useEffect(() => {
    const t = deepLinkTargetRef.current;
    if (!t) return;
    const opened =
      (t.type === 'proposal' && viewingProposal?.fileName === t.id) ||
      (t.type === 'microsite' && viewingMicrosite?.id === t.id) ||
      (t.type === 'document' && viewingDocument?.id === t.id) ||
      (t.type === 'slide' && viewingSlide?.id === t.id);
    if (opened) {
      deepLinkTargetRef.current = null;
      setDeepLinkOpening(null);
      transitionOverlay.hide();
      // Opening the panel collapses the chat column — it rewraps taller, so
      // re-arm the instant pin-to-bottom window over the reflow.
      chatPinnedUntilRef.current = Date.now() + 800;
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    }
  }, [viewingProposal, viewingMicrosite, viewingDocument, viewingSlide]);
  useEffect(() => {
    if (deepLinkConsumedRef.current || typeof window === 'undefined') return;
    const qs = new URLSearchParams(window.location.search);
    const open = qs.get('open');
    const id = qs.get('id');
    if (!open || !id) {
      deepLinkConsumedRef.current = true;
      return;
    }
    const consume = () => {
      deepLinkConsumedRef.current = true;
      deepLinkTargetRef.current = { type: open, id };
      if (qs.get('from') === 'artifacts') {
        artifactsReturnRef.current = { type: open, id, seen: false };
      }
      // Strip the params so back/refresh doesn't re-open the artifact.
      router.replace(`/super-client/${encodeURIComponent(name)}`, { scroll: false });
    };
    if (open === 'proposal') {
      const found = proposals.find((p) => p.fileName === id);
      if (found) { consume(); void openProposal(found); }
      else if (proposals.length > 0) { consume(); void openProposal({ fileName: id, title: id.replace(/\.md$/i, ''), savedAt: '' }); }
    } else if (open === 'microsite') {
      const found = microsites.find((m) => m.id === id);
      if (found) { consume(); void handleOpenMicrosite(found); }
      else if (microsites.length > 0) { consume(); void handleOpenMicrosite({ id } as SuperClientMicrosite); }
    } else if (open === 'document') {
      const found = generatedDocs.find((d) => d.id === id);
      if (found) { consume(); void openDocument(found); }
      else if (generatedDocs.length > 0) { consume(); void openDocument({ id, title: '', documentType: '' } as GeneratedDocument); }
    } else if (open === 'slide') {
      const found = savedSlides.find((s) => s.id === id);
      if (found) { consume(); openSlide(found); }
      else if (savedSlides.length > 0) { consume(); openSlide({ id, title: '', client: name, slideCount: 0, savedAt: '' } as SavedSlide); }
    } else {
      deepLinkConsumedRef.current = true;
      setDeepLinkOpening(null);
      transitionOverlay.hide();
    }
  }, [proposals, microsites, generatedDocs, savedSlides]);

  // Return-to-/artifacts watcher: covers every close path (X button, dismiss,
  // delete) by observing the viewer states instead of instrumenting each
  // handler. Waits until the deep-linked artifact has actually opened (`seen`),
  // then: closed with nothing else open → navigate back to the originating
  // /artifacts tab; replaced by another artifact → disarm and stay.
  useEffect(() => {
    const r = artifactsReturnRef.current;
    if (!r) return;
    const ownId =
      r.type === 'proposal' ? viewingProposal?.fileName
      : r.type === 'microsite' ? viewingMicrosite?.id
      : r.type === 'document' ? viewingDocument?.id
      : r.type === 'slide' ? viewingSlide?.id
      : undefined;
    const anyOpen = !!(viewingProposal || viewingMicrosite || viewingDocument || viewingSlide);
    if (!r.seen) {
      if (ownId === r.id) r.seen = true;
      else if (anyOpen) artifactsReturnRef.current = null; // opened something else before ours loaded
      return;
    }
    if (ownId === r.id) return; // still open
    artifactsReturnRef.current = null;
    if (!anyOpen) {
      const tab =
        r.type === 'proposal' ? 'proposals'
        : r.type === 'microsite' ? 'microsites'
        : r.type === 'document' ? 'documents'
        : 'presentations';
      router.push(`/artifacts?tab=${tab}`);
    }
  }, [viewingProposal, viewingMicrosite, viewingDocument, viewingSlide]);

  // When a document transitions from processing → extracted, add an assistant summary message
  const prevDocsRef = useRef<SuperClientFile[]>([]);
  useEffect(() => {
    const prev = prevDocsRef.current;
    prevDocsRef.current = docs;
    const justExtracted = docs.filter(
      (d) =>
        d.status === 'extracted' &&
        prev.find((p) => p.fileName === d.fileName)?.status === 'processing' &&
        !summarizedDocsRef.current.has(d.fileName),
    );
    if (justExtracted.length === 0) return;
    for (const d of justExtracted) summarizedDocsRef.current.add(d.fileName);
    const names = justExtracted.map((d) => d.originalName ?? d.fileName);
    const label =
      names.length === 1
        ? `**${names[0]}**`
        : `**${names[0]}** and ${names.length - 1} other file${names.length > 2 ? 's' : ''}`;
    const indexedContent = `${label} has been indexed and added to the knowledge base. Ask me anything about it, or say "generate proposal" to create one based on this context.`;
    setMessages((prev) => [
      ...prev,
      {
        id: genId(),
        role: 'assistant',
        content: indexedContent,
      },
    ]);
    void appendSuperClientHistory(apiKey, name, [{ role: 'assistant', content: indexedContent }]);

    // Extraction has already written stable fields (industry, project type) to
    // client memory. If the ingested documents did not yield a Project Type,
    // ask for it with the composer question card — unless the composer is
    // already occupied (proposal selector, another question, …).
    if (composerStage === null) {
      void (async () => {
        try {
          const mem = await fetchClientMemory(apiKey, name);
          const projectType = String(mem?.stableFields?.projectType?.value ?? '').trim();
          if (projectType) return;
          setActiveQuestion({
            text: `The ingested document${names.length > 1 ? 's' : ''} didn't mention a project type. What kind of project is this engagement for ${meta?.displayName ?? name}?`,
            options: ['Proposal', 'Microsite / Proposal', 'Presentation / Pitch Deck', 'Website / Landing Page', 'Other…'],
          });
          setPendingProfileField('projectType');
          setComposerStage('clarify');
        } catch {
          // Non-critical — the field stays editable in the Context tab.
        }
      })();
    }
  }, [docs]);

  // Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo for microsite & slide editors
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          handleMicrositeRevert();
        } else if (canSlideUndo) {
          e.preventDefault();
          handleSlideRevert();
        }
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        if (canRedo) {
          e.preventDefault();
          handleMicrositeRedo();
        } else if (canSlideRedo) {
          e.preventDefault();
          handleSlideRedo();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndo, canRedo]);

  // Prevent body/html scroll while full screen is open.
  // Must target both body AND documentElement — some browsers show the scrollbar
  // on <html>, others on <body>. The fixed overlay doesn't suppress it on its own.
  useEffect(() => {
    if (!fullscreenMicrosite) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [fullscreenMicrosite]);

  // Reset strip visibility when a new microsite/proposal is opened
  useEffect(() => {
    if (viewingMicrosite) setMicrositeStripVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingMicrosite?.id]);

  useEffect(() => {
    if (viewingProposal) setProposalStripVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingProposal?.fileName]);

  useEffect(() => {
    if (viewingDocument) setDocumentStripVisible(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingDocument?.id]);

  useEffect(() => {
    if (viewingSlide) {
      setSlideStripVisible(true);
      // Auto-focus the composer textarea so the user can type immediately
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingSlide?.id]);

  useEffect(() => {
    if (!editModeActive) return;
    function onMessage(e: MessageEvent) {
      const msg = e.data as BridgeMessage;
      if (!msg || msg.source !== 'microsite-bridge') return;
      if (msg.type === 'hover') setHoveredElement(msg);
      else if (msg.type === 'leave') setHoveredElement(null);
      else if (msg.type === 'track-update' && msg.rect) {
        setSelectedElement((prev) => (prev ? { ...prev, rect: msg.rect } : prev));
        setHoveredElement((prev) => (prev ? { ...prev, rect: msg.rect } : prev));
      } else if (msg.type === 'select') setSelectedElement(msg);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [editModeActive]);

  // Slide smart-edit bridge messages — mirrors microsite but scoped to the slide iframe.
  useEffect(() => {
    if (!slideEditModeActive) return;
    function onMessage(e: MessageEvent) {
      // Only handle messages from the slide iframe window
      if (slideIframeRef.current && e.source !== slideIframeRef.current.contentWindow) return;
      const msg = e.data as BridgeMessage;
      if (!msg || msg.source !== "microsite-bridge") return;
      if (msg.type === "hover") setHoveredSlideElement(msg);
      else if (msg.type === "leave") setHoveredSlideElement(null);
      else if (msg.type === "track-update" && msg.rect) {
        setSelectedSlideElement((prev) => prev ? { ...prev, rect: msg.rect } : prev);
        setHoveredSlideElement((prev) => prev ? { ...prev, rect: msg.rect } : prev);
      } else if (msg.type === "select") setSelectedSlideElement(msg);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [slideEditModeActive]);

  // Background iframe signals when it has loaded and set scroll — swap slots instantly.
  useEffect(() => {
    function onSwapReady(e: MessageEvent) {
      if (e.data?.source !== 'microsite-swap-ready' || !swapPendingRef.current) return;
      if (swapSafetyTimerRef.current) {
        clearTimeout(swapSafetyTimerRef.current);
        swapSafetyTimerRef.current = null;
      }
      swapPendingRef.current = false;
      const next: 'A' | 'B' = activeSlotRef.current === 'A' ? 'B' : 'A';
      activeSlotRef.current = next;
      setActiveSlot(next);
      // If a video replacement is pending, start the post-swap countdown.
      // Vimeo needs ~3 more seconds after the iframe swap to start playing.
      if (videoLoadingRef.current) {
        if (videoLoadTimerRef.current) clearTimeout(videoLoadTimerRef.current);
        videoLoadTimerRef.current = setTimeout(() => {
          videoLoadTimerRef.current = null;
          setVideoLoadingBoth(false);
        }, 3000);
      }
    }
    window.addEventListener('message', onSwapReady);
    return () => window.removeEventListener('message', onSwapReady);
  }, []);

  async function handleFileUpload(file: File) {
    if (uploading || !name) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const added = await uploadSuperClientDocument(apiKey, name, file, setUploadPct);
      setDocs((prev) => {
        const next = [...prev];
        for (const f of added) {
          const idx = next.findIndex((d) => d.fileName === f.fileName);
          if (idx !== -1) next[idx] = f;
          else next.push(f);
        }
        return next;
      });
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  }

  // Upload a document from the chat composer — shows a progress card in the chat thread
  async function handleFileUploadFromComposer(file: File) {
    if (!name) return;
    const uploadId = genId();
    uploadStore.start({ id: uploadId, clientSlug: name, fileName: file.name });
    setMessages((prev) => [
      ...prev,
      {
        id: `upload-msg-${uploadId}`,
        role: 'user',
        content: '',
        uploadId,
        createdAt: new Date().toISOString(),
      },
    ]);
    scrollToBottom();
    try {
      const added = await uploadSuperClientDocument(apiKey, name, file, (pct) => uploadStore.progress(uploadId, pct));
      // Pass the server-assigned filename so the card can match against docs[]
      uploadStore.done(uploadId, added[0]?.fileName);
      setDocs((prev) => {
        const next = [...prev];
        for (const f of added) {
          const idx = next.findIndex((d) => d.fileName === f.fileName);
          if (idx !== -1) next[idx] = f;
          else next.push(f);
        }
        return next;
      });
    } catch (err) {
      uploadStore.fail(uploadId, (err as Error).message ?? 'Upload failed');
      console.error('Composer upload failed', err);
    }
  }

  async function handleDeleteDoc(fileName: string) {
    if (!name) return;
    try {
      await deleteSuperClientDocument(apiKey, name, fileName);
      setDocs((prev) => prev.filter((d) => d.fileName !== fileName));
      setMemoryKey((k) => k + 1);
      // Dismiss any upload card whose stored file was just deleted
      uploadStore.forClient(name).forEach((e) => {
        if ((e.storedFileName ?? e.fileName) === fileName) uploadStore.dismiss(e.id);
      });
    } catch (err) {
      console.error('Delete failed', err);
    }
  }

  async function openProposal(proposal: SuperClientProposal) {
    if (!name) return;
    setChangedSections(new Set());
    setUpdateBanner('');
    setViewingProposal({
      fileName: proposal.fileName,
      title: proposal.title,
      content: '',
    });
    setViewingMicrosite(null);
    collapseForPanel();
    try {
      const content = await getSuperClientProposal(apiKey, name, proposal.fileName);
      setViewingProposal({
        fileName: proposal.fileName,
        title: proposal.title,
        content,
      });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('404')) {
        setViewingProposal(null);
        setProposals((prev) => prev.filter((p) => p.fileName !== proposal.fileName));
        showToast('This proposal no longer exists', 'error');
      } else {
        setViewingProposal(null);
        showToast(`Failed to load proposal: ${msg}`, 'error');
      }
    }
  }

  async function handleDeleteProposal(fileName: string) {
    if (!name) return;
    try {
      await deleteSuperClientProposal(apiKey, name, fileName);
      setProposals((prev) => prev.filter((p) => p.fileName !== fileName));
      if (viewingProposal) {
        setViewingProposal(null);
        setChangedSections(new Set());
        setUpdateBanner('');
      }
    } catch (err) {
      console.error('Delete proposal failed', err);
    }
  }

  async function handleGenerateMicrosite() {
    if (!name || proposals.length === 0) return;
    if (proposals.length === 1) {
      const p = proposals[0];
      setLoadingMicrositeFor(p.fileName);
      try {
        const markdown = await getSuperClientProposal(apiKey, name, p.fileName);
        setMicrositeModal({ proposal: p, markdown });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (msg.includes('404')) {
          setProposals((prev) => prev.filter((pr) => pr.fileName !== p.fileName));
          showToast('This proposal no longer exists', 'error');
        } else {
          showToast(`Failed to load proposal: ${msg}`, 'error');
        }
      } finally {
        setLoadingMicrositeFor(null);
      }
    } else {
      setShowProposalPicker(true);
    }
  }

  async function handlePickProposal(p: SuperClientProposal) {
    if (!name) return;
    setShowProposalPicker(false);
    setLoadingMicrositeFor(p.fileName);
    try {
      const markdown = await getSuperClientProposal(apiKey, name, p.fileName);
      setMicrositeModal({ proposal: p, markdown });
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('404')) {
        setProposals((prev) => prev.filter((pr) => pr.fileName !== p.fileName));
        showToast('This proposal no longer exists', 'error');
      } else {
        showToast(`Failed to load proposal: ${msg}`, 'error');
      }
    } finally {
      setLoadingMicrositeFor(null);
    }
  }

  async function handleOpenMicrosite(m: SuperClientMicrosite) {
    if (!name) return;
    // Clear any selection/hover state from the previous microsite so stale
    // selectedElement doesn't suppress hover rectangles on the newly opened one.
    clearBridgeSelection();
    try {
      const ast = await getSuperClientMicrosite(apiKey, name, m.id);
      const html = buildHtml(ast);
      const rk = `${m.id}-${Date.now()}`;
      const srcDoc = computeSrcDoc(html);

      if (viewingMicrosite) {
        // Panel already open — load into background slot and swap once rendered
        // to avoid the visible blank-then-reload flash on the active iframe.
        const swapScript = `<script>(function(){requestAnimationFrame(function(){window.parent.postMessage({source:'microsite-swap-ready'},'*');});})();<\/script>`;
        const bodyClose = srcDoc.lastIndexOf('</body>');
        const srcDocWithSwap =
          bodyClose !== -1 ? srcDoc.slice(0, bodyClose) + swapScript + srcDoc.slice(bodyClose) : srcDoc + swapScript;

        swapPendingRef.current = true;
        if (swapSafetyTimerRef.current) clearTimeout(swapSafetyTimerRef.current);
        swapSafetyTimerRef.current = setTimeout(() => {
          swapSafetyTimerRef.current = null;
          if (!swapPendingRef.current) return;
          swapPendingRef.current = false;
          const next: 'A' | 'B' = activeSlotRef.current === 'A' ? 'B' : 'A';
          activeSlotRef.current = next;
          setActiveSlot(next);
        }, 2000);
        setBackSrcDoc(srcDocWithSwap);
      } else {
        setActiveSrcDoc(srcDoc);
      }

      setViewingMicrosite({ id: m.id, ast, renderKey: rk });
      seedHistory(html); // seed undo history with the opening state
      if (viewingProposal) {
        setViewingProposal(null);
        setChangedSections(new Set());
        setUpdateBanner('');
      }
      collapseForPanel();
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('404')) {
        setMicrosites((prev) => prev.filter((ms) => ms.id !== m.id));
        showToast('This microsite no longer exists', 'error');
      } else {
        showToast(`Failed to load microsite: ${msg}`, 'error');
      }
    }
  }

  async function handleDeleteMicrosite(id: string) {
    if (!name) return;
    try {
      await deleteSuperClientMicrosite(apiKey, name, id);
      setMicrosites((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error('Delete microsite failed', err);
    }
  }

  async function handleDeleteGenDoc(id: string) {
    if (!name) return;
    try {
      await deleteGeneratedDocument(apiKey, name, id);
      setGeneratedDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      console.error("Delete generated document failed", err);
    }
  }

  async function handleDeleteSlide(id: string) {
    if (!name) return;
    try {
      await deleteSlide(apiKey, name, id);
      setSavedSlides((prev) => prev.filter((s) => s.id !== id));
      if (viewingSlide?.id === id) setViewingSlide(null);
    } catch (err) {
      console.error("Delete slide failed", err);
    }
  }

  async function openDocument(doc: GeneratedDocument) {
    if (!name) return;
    setViewingDocument({ id: doc.id, title: doc.title, documentType: doc.documentType, content: "" });
    setViewingProposal(null);
    setViewingMicrosite(null);
    setViewingSlide(null);
    setActiveRightTab("artifacts");
    collapseForPanel();
    try {
      const content = await getGeneratedDocumentContent(apiKey, name, doc.id);
      setViewingDocument({ id: doc.id, title: doc.title, documentType: doc.documentType, content });
    } catch (err) {
      setViewingDocument(null);
      showToast(`Failed to load document: ${(err as Error).message}`, "error");
    }
  }

  async function handleDownloadPresentationPDF() {
    if (!viewingMicrosite) return;
    setPdfDownloading(true);
    showToast('Generating PDF…');

    try {
      const isPortrait = viewingMicrosite.ast?.pdfOrientation === 'portrait';
      const orientation = isPortrait ? 'portrait' : 'landscape';

      const res = await fetch(
        `/api/super-clients/${encodeURIComponent(name)}/microsites/${encodeURIComponent(viewingMicrosite.id)}/export-pdf?orientation=${orientation}`,
        { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined },
      );

      if (!res.ok) {
        const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
        throw new Error(err.error ?? 'PDF generation failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const title = (viewingMicrosite.ast?.meta as { title?: string } | undefined)?.title ?? name;
      const safe = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      a.href = url;
      a.download = `${safe}.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('PDF downloaded');
    } catch (err) {
      showToast((err as Error).message ?? 'PDF generation failed', 'error');
    } finally {
      setPdfDownloading(false);
    }
  }

  function computeSrcDoc(html: string, forEditMode = editModeActive): string {
    let normalized = normalizeMicrositeHtml(html);
    // Presentation decks (16:9 / 9:16, detected by their baked constraint style) must
    // render ONLY their slide sections. Older generations emitted a logo strip before
    // slide 1, which shows as stray chrome escaping above the first slide in the viewer
    // and breaks one-page-per-slide PDF pagination. Hide any non-section element that
    // precedes a slide; the :has(~) guard leaves runtime-appended nodes (edit-bridge
    // overlays after the last section) untouched. Newly generated decks carry this rule
    // in their own constraints — this covers decks saved before the rule existed.
    if (normalized.includes('__pdf-slide-constraints__') && !normalized.includes('__pdf-chrome-hide')) {
      const chromeHide =
        '<style id="__pdf-chrome-hide">*:has(>[data-section-id])>*:not([data-section-id]):not(script):not(style):not(link):not(meta):has(~[data-section-id]){display:none!important;}</style>';
      const bodyClose = normalized.lastIndexOf('</body>');
      normalized =
        bodyClose !== -1
          ? normalized.slice(0, bodyClose) + chromeHide + normalized.slice(bodyClose)
          : normalized + chromeHide;
    }
    return forEditMode ? injectBridgeScript(normalized) : normalized;
  }

  // Load edited HTML into the BACKGROUND iframe slot.
  // The injected script: sets scroll before first paint (scroll-behavior:auto = instant),
  // sends microsite-swap-ready after the first rAF so the parent swaps slots only
  // once the background iframe is fully painted at the correct position.
  function applyEditHtml(html: string) {
    const y = Math.round(getActiveIframe()?.contentWindow?.scrollY ?? 0);
    let srcDoc = computeSrcDoc(html);
    const script = `<script id="__scroll-restore">(function(){var y=${y};function r(){if(y>0){document.documentElement.style.scrollBehavior='auto';document.body&&(document.body.style.scrollBehavior='auto');window.scrollTo(0,y);}}r();requestAnimationFrame(function(){window.parent.postMessage({source:'microsite-swap-ready'},'*');if(y>0){var n=0;function t(){r();if(++n<5)setTimeout(t,80);}setTimeout(t,30);}});})();<\/script>`;
    const bodyClose = srcDoc.lastIndexOf('</body>');
    srcDoc = bodyClose !== -1 ? srcDoc.slice(0, bodyClose) + script + srcDoc.slice(bodyClose) : srcDoc + script;
    // Mark swap pending; cancel any previous safety timer
    swapPendingRef.current = true;
    if (swapSafetyTimerRef.current) clearTimeout(swapSafetyTimerRef.current);
    swapSafetyTimerRef.current = setTimeout(() => {
      swapSafetyTimerRef.current = null;
      if (!swapPendingRef.current) return;
      swapPendingRef.current = false;
      const next: 'A' | 'B' = activeSlotRef.current === 'A' ? 'B' : 'A';
      activeSlotRef.current = next;
      setActiveSlot(next);
    }, 2000);
    setBackSrcDoc(srcDoc);
  }

  // Mirror of applyEditHtml for slides: captures scroll, injects restore script, sets srcDoc.
  function applySlideHtml(html: string, withBridge?: boolean) {
    const useBridge = withBridge ?? slideEditModeActive;
    // Strip any stale injections, then optionally re-inject bridge script
    const clean = stripPreviewInjections(html);
    const bridged = useBridge ? injectBridgeScript(clean) : clean;
    const y = Math.round(slideIframeRef.current?.contentWindow?.scrollY ?? 0);
    const script = `<script id="__scroll-restore">(function(){var y=${y};function r(){if(y>0){document.documentElement.style.scrollBehavior='auto';document.body&&(document.body.style.scrollBehavior='auto');window.scrollTo(0,y);}}r();requestAnimationFrame(function(){if(y>0){var n=0;function t(){r();if(++n<5)setTimeout(t,80);}setTimeout(t,30);}});})();<\/script>`;
    const bodyClose = bridged.lastIndexOf('</body>');
    const srcDoc = bodyClose !== -1
      ? bridged.slice(0, bodyClose) + script + bridged.slice(bodyClose)
      : bridged + script;
    setSlideSrcDoc(srcDoc);
  }

  async function handleMicrositeEdit() {
    const hasText = micrositeEditInput.trim().length > 0;
    const activeLogo: { base64: string; mediaType: string } | { url: string } | null =
      editingLogo ?? (editingLogoUrl.trim() ? { url: editingLogoUrl.trim() } : null);
    if (!viewingMicrosite || (!hasText && !activeLogo) || micrositeEditing) return;

    let instruction = buildInstruction(selectedElement, micrositeEditInput.trim());
    // URL-based deterministic bypass: detect image or video URL in the instruction
    const _urlMatch = micrositeEditInput.trim().match(/https?:\/\/\S+/);
    if (_urlMatch) {
      const url = _urlMatch[0];
      const isVideo = /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
      const isLogoIntent = /\blogo\b/i.test(micrositeEditInput);

      if (!isVideo) {
        const isBgIntent = /\b(?:background|bg)\b/i.test(micrositeEditInput);
        const isReplaceIntent = /\b(?:replace|swap|change|update|use this as|set as)\b/i.test(micrositeEditInput);
        const selectedTag = selectedElement?.tag?.toLowerCase() ?? '';

        // Container elevated from an <img> click: outerHtml contains <img src>.
        // __BG_IMAGE_PATCH__ would set a CSS background-image that's invisible
        // because the real <img> element sits on top. Use __IMAGE_INJECT_SCOPED__
        // instead — it finds and replaces the <img src> inside the container.
        const hasWrappedImg = selectedTag !== 'img' && /<img\b/i.test(selectedElement?.outerHtml ?? '');

        if (selectedElement?.path && isBgIntent && selectedTag !== 'img' && !hasWrappedImg) {
          // "add/set/change background image on a section/div" with no img child
          // Use __BG_IMAGE_PATCH__ which sets background-image in the inline style.
          instruction = `__BG_IMAGE_PATCH__:${selectedElement.path}||${url}`;
        } else if (selectedElement?.path && (selectedTag === 'img' || isReplaceIntent || hasWrappedImg)) {
          // Explicit replacement, <img> selected, or container with wrapped img
          // → scoped src/attr replacement via __IMAGE_INJECT_SCOPED__.
          const hintSnippet = selectedElement.outerHtml?.slice(0, 300) ?? '';
          instruction = `__IMAGE_INJECT_SCOPED__:${selectedElement.path}||${url}||${hintSnippet}`;
        } else if (selectedElement?.path) {
          // All other element+URL combos (add below, insert right, add inside, etc.)
          // → let __ELEMENT_EDIT__ flow to LLM for structural insertion.
        } else if (isLogoIntent) {
          // "replace logo with [url]" without element selected → targeted logo replacement
          instruction = `__LOGO_REPLACE__:${url}`;
        } else {
          // No element selected. __IMAGE_INJECT__ blindly replaces the FIRST
          // background-image / <img> in the document, so it is only safe when
          // the user gave us nothing but the URL itself (a bare paste = "put
          // this image wherever the main image is"). Any surrounding words
          // ("add this into the pricing section", "use as the team photo",
          // "place it below the heading") carry placement/target intent that a
          // first-match replacement would silently get wrong — those sentences
          // flow through unchanged to the server's LLM operation-picker, which
          // sees the full document and decides target + placement itself.
          const textMinusUrl = micrositeEditInput
            .replace(url, ' ')
            .replace(/[\s.,;:!?'"()-]+/g, ' ')
            .trim();
          if (!textMinusUrl) {
            instruction = `__IMAGE_INJECT__:${url}`;
          }
          // else: keep the raw sentence → server op-picker decides.
        }
      }
      // NOTE: a section-keyword regex used to rewrite video-URL sentences into
      // __VIDEO_IN_SECTION__ here — for both "no element selected" and "a
      // <section> is selected" cases. It was removed because guessing the
      // target section (and whether "background" means hero-fill vs inline)
      // from a free-text sentence is exactly the fragile pattern this editor
      // is moving away from, and it collided with unrelated sentence clauses
      // (e.g. "remove background image and add this video..." was misread by
      // a *different* server-side regex before this one even ran). With no
      // element selected, the raw sentence now flows to the server's unified
      // LLM operation-picker, which normalizes the video URL to an embed URL
      // itself and decides placement from the full instruction + full
      // document. With a <section> selected, it falls through to the default
      // __ELEMENT_EDIT__ instruction built above — the same LLM-driven,
      // element-scoped path already used for every other free-text edit on a
      // selected element.
      // Video URL: server's Vimeo/YouTube detection fires on any matching URL.
    }
    // Snapshot label for chat messages before clearing input
    const editLabel = micrositeEditInput.trim();
    const micrositeTitle = microsites.find((m) => m.id === viewingMicrosite.id)?.title ?? 'Microsite';
    const now = new Date().toISOString();
    const userMsgId = genId();
    const assistantMsgId = genId();

    // Save user instruction to chat immediately
    const userContent = activeLogo && !hasText ? `Updated logo on **${micrositeTitle}**` : `${editLabel}`;
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: userContent,
        createdAt: now,
        editContext: 'microsite' as const,
      },
    ]);

    setMicrositeEditing(true);
    setMicrositeEditBanner('');
    try {
      let finalHtml: string;
      let editSummary: string = '';

      if (hasText && activeLogo) {
        // Text edit first, then inject logo via deterministic server bypass
        const { summary: s1 } = await editSuperClientMicrosite(apiKey, name, viewingMicrosite.id, instruction);
        editSummary = s1;
        const logoSrc =
          'url' in activeLogo ? activeLogo.url : `data:${activeLogo.mediaType};base64,${activeLogo.base64}`;
        const { html } = await editSuperClientMicrosite(
          apiKey,
          name,
          viewingMicrosite.id,
          `__LOGO_INJECT__:${logoSrc}`,
        );
        finalHtml = html;
      } else if (hasText) {
        // Text edit only
        const { html, summary: s } = await editSuperClientMicrosite(apiKey, name, viewingMicrosite.id, instruction);
        finalHtml = html;
        editSummary = s;
      } else {
        // Logo-only: deterministic server-side injection, no LLM
        const logoSrc =
          'url' in activeLogo!
            ? activeLogo!.url
            : `data:${(activeLogo as { base64: string; mediaType: string }).mediaType};base64,${(activeLogo as { base64: string; mediaType: string }).base64}`;
        const { html } = await editSuperClientMicrosite(
          apiKey,
          name,
          viewingMicrosite.id,
          `__LOGO_INJECT__:${logoSrc}`,
        );
        finalHtml = html;
        editSummary = 'Logo updated';
      }

      setMicrositeEditInput('');
      setEditingLogo(null);
      setEditingLogoUrl('');
      setShowEditingLogoUrlInput(false);
      if (selectedElement) {
        // An element was targeted: keep it selected so the inline editor stays
        // active. Refresh outerHtml so the inline editor shows fresh values.
        refreshSelectedElementFromHtml(finalHtml);
      } else {
        // General microsite edit (no element selected) — deselect as before.
        clearBridgeSelection();
      }
      // Write new HTML directly into the iframe (no reload → scroll preserved)
      applyEditHtml(finalHtml);
      setViewingMicrosite((prev) =>
        prev
          ? {
              ...prev,
              ast: {
                ...prev.ast,
                sections: [
                  {
                    ...(prev.ast.sections[0] as object),
                    customHtml: finalHtml,
                  } as unknown as (typeof prev.ast.sections)[0],
                  ...prev.ast.sections.slice(1),
                ],
              },
              renderKey: prev.renderKey,
            }
          : null,
      );
      pushHistory(finalHtml);
      setMicrositeEditBanner('Microsite updated');
      setTimeout(() => setMicrositeEditBanner(''), 4000);

      // Save assistant confirmation to chat.
      // editSummary can be the raw LLM instruction echoed back — only show it
      // when it looks like a clean human-readable label (deterministic ops return
      // short phrases like "Text updated"; LLM fallbacks return the raw instruction).
      const successAt = new Date().toISOString();
      const isFriendlySummary =
        editSummary.length > 0 &&
        editSummary.length <= 80 &&
        !/^[<#_]|__/.test(editSummary);
      const successContent = isFriendlySummary
        ? editSummary
        : `Microsite updated`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: 'assistant',
          content: successContent,
          createdAt: successAt,
          editContext: 'microsite' as const,
        },
      ]);
      void appendSuperClientHistory(apiKey, name, [
        {
          role: 'user',
          content: userContent,
          createdAt: now,
          editContext: 'microsite',
        },
        {
          role: 'assistant',
          content: successContent,
          createdAt: successAt,
          editContext: 'microsite',
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Edit failed';
      setMicrositeEditBanner(`Error: ${msg}`);
      setTimeout(() => setMicrositeEditBanner(''), 8000);

      // Save error response to chat
      const errorAt = new Date().toISOString();
      const errorContent = `Edit failed: ${msg}`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: 'assistant',
          content: errorContent,
          createdAt: errorAt,
          editContext: 'microsite' as const,
        },
      ]);
      void appendSuperClientHistory(apiKey, name, [
        {
          role: 'user',
          content: userContent,
          createdAt: now,
          editContext: 'microsite',
        },
        {
          role: 'assistant',
          content: errorContent,
          createdAt: errorAt,
          editContext: 'microsite',
        },
      ]);
    } finally {
      setMicrositeEditing(false);
    }
  }

  // ── InlineEditPanel: shared instruction dispatcher ───────────────────────
  async function applyMicrositeInstruction(instruction: string, banner: string) {
    if (!viewingMicrosite || micrositeEditing) return;
    setMicrositeEditing(true);
    setMicrositeEditBanner('');
    try {
      // Sync in-memory HTML to disk before editing so the server always has the
      // latest state (a previous LLM edit may have updated React state but failed
      // to save, leaving the disk file stale).
      const currentHtml = (viewingMicrosite.ast.sections?.[0] as { customHtml?: string })?.customHtml;
      if (currentHtml) {
        try {
          await patchSuperClientMicrositeHtml(apiKey, name, viewingMicrosite.id, currentHtml);
        } catch {
          /* non-fatal — proceed with the edit using currentHtml in request */
        }
      }
      const { html: finalHtml } = await editSuperClientMicrosite(
        apiKey,
        name,
        viewingMicrosite.id,
        instruction,
        currentHtml,
      );
      applyEditHtml(finalHtml);
      setViewingMicrosite((prev) =>
        prev
          ? {
              ...prev,
              ast: {
                ...prev.ast,
                sections: [
                  {
                    ...(prev.ast.sections[0] as object),
                    customHtml: finalHtml,
                  } as unknown as (typeof prev.ast.sections)[0],
                  ...prev.ast.sections.slice(1),
                ],
              },
              renderKey: prev.renderKey,
            }
          : null,
      );
      pushHistory(finalHtml);
      setMicrositeEditBanner(banner);
      setTimeout(() => setMicrositeEditBanner(''), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Edit failed';
      setMicrositeEditBanner(`Error: ${msg}`);
      setTimeout(() => setMicrositeEditBanner(''), 8000);
    } finally {
      setMicrositeEditing(false);
    }
  }

  // Short snippet of the selected element's outerHTML — used as a hint on the server
  // so every instruction has a content-based fallback when findByPath can't locate
  // the element (e.g. after an LLM edit restructured the surrounding DOM).
  const hint = () => selectedElement?.outerHtml?.slice(0, 400) ?? '';

  async function handleStylePatch(prop: string, value: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__STYLE_PATCH__:${selectedElement.path}||${prop}||${value}||${hint()}`,
      `${prop} updated`,
    );
  }

  async function handleGradientTextPatch(gradientCss: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__GRADIENT_TEXT_PATCH__:${selectedElement.path}||${gradientCss}||${hint()}`,
      'Gradient updated',
    );
  }

  async function handleTextPatch(newText: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(`__TEXT_PATCH__:${selectedElement.path}||${newText}||${hint()}`, 'Text updated');
  }

  async function handleImageReplace(url: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__IMAGE_INJECT_SCOPED__:${selectedElement.path}||${url}||${hint()}`,
      'Image replaced',
    );
  }

  async function handleLogoReplace(url: string) {
    if (selectedElement?.path) {
      await applyMicrositeInstruction(`__LOGO_SWAP__:${selectedElement.path}||${url}`, 'Logo updated');
    } else {
      await applyMicrositeInstruction(`__LOGO_INJECT__:${url}`, 'Logo updated');
    }
  }

  async function handleRemoveSection() {
    if (!selectedElement?.path) return;
    // Remove the exactly selected element (not the whole section).
    await applyMicrositeInstruction(`__REMOVE_BY_PATH__:${selectedElement.path}||${hint()}`, 'Removed');
    clearBridgeSelection();
  }

  async function handleRemoveSectionContainer() {
    if (!selectedElement) return;
    // Always removes the entire parent <section> regardless of which child is selected.
    // Extracts the section# anchor from the CSS path — e.g. section#hero from
    // "section#hero > div.hero-bg > div.overlay".
    const sectionM = selectedElement.path?.match(/\b(section#[\w-]+)/);
    if (sectionM) {
      await applyMicrositeInstruction(`__REMOVE_BY_PATH__:${sectionM[1]}`, `Section removed`);
    } else if (selectedElement.sectionType) {
      // Fallback: use sectionType to build path (handles section#phase1-1 → phase1)
      await applyMicrositeInstruction(`__REMOVE_BY_PATH__:section#${selectedElement.sectionType}`, `Section removed`);
    }
    clearBridgeSelection();
  }

  async function handleBgImagePatch(url: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__BG_IMAGE_PATCH__:${selectedElement.path}||${url}||${hint()}`,
      'Background image updated',
    );
  }

  async function handleVideoReplace(url: string) {
    if (!selectedElement?.path) return;
    // Show loader immediately; cleared by onSwapReady + 3s or by 10s safety timeout.
    if (videoLoadTimerRef.current) clearTimeout(videoLoadTimerRef.current);
    setVideoLoadingBoth(true);
    videoLoadTimerRef.current = setTimeout(() => {
      videoLoadTimerRef.current = null;
      setVideoLoadingBoth(false);
    }, 10000);
    try {
      await applyMicrositeInstruction(`__VIDEO_INJECT__:${selectedElement.path}||${url}||${hint()}`, 'Video updated');
    } catch {
      if (videoLoadTimerRef.current) clearTimeout(videoLoadTimerRef.current);
      setVideoLoadingBoth(false);
    }
  }

  async function handleIconReplace(url: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(`__ICON_REPLACE__:${selectedElement.path}||${url}||${hint()}`, 'Icon replaced');
  }

  async function handleSvgReplace(svgMarkup: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(`__SVG_REPLACE__:${selectedElement.path}||${svgMarkup}||${hint()}`, 'Icon replaced');
  }

  // ── Slide InlineEditPanel handlers ───────────────────────────────────────
  async function applySlideInstruction(instruction: string, banner: string) {
    if (!viewingSlide || slideEditing) return;
    setSlideEditing(true);
    setSlideEditBanner('');
    try {
      const { html: newHtml } = await editSuperClientSlide(
        apiKey, name ?? '', viewingSlide.id, instruction, slideCurrentHtmlRef.current ?? undefined
      );
      pushSlideHistory(newHtml);
      setSlideEditBanner(banner);
      setTimeout(() => setSlideEditBanner(''), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Edit failed';
      setSlideEditBanner(`Error: ${msg}`);
      setTimeout(() => setSlideEditBanner(''), 8000);
    } finally {
      setSlideEditing(false);
    }
  }

  const slideHint = () => selectedSlideElement?.outerHtml?.slice(0, 400) ?? '';

  async function handleSlideStylePatch(prop: string, value: string) {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__STYLE_PATCH__:${selectedSlideElement.path}||${prop}||${value}||${slideHint()}`, `${prop} updated`);
  }
  async function handleSlideGradientTextPatch(gradientCss: string) {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__GRADIENT_TEXT_PATCH__:${selectedSlideElement.path}||${gradientCss}||${slideHint()}`, 'Gradient updated');
  }
  async function handleSlideTextPatch(newText: string) {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__TEXT_PATCH__:${selectedSlideElement.path}||${newText}||${slideHint()}`, 'Text updated');
  }
  async function handleSlideImageReplace(url: string) {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__IMAGE_INJECT_SCOPED__:${selectedSlideElement.path}||${url}||${slideHint()}`, 'Image replaced');
  }
  async function handleSlideBgImagePatch(url: string) {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__BG_IMAGE_PATCH__:${selectedSlideElement.path}||${url}||${slideHint()}`, 'Background image updated');
  }
  async function handleSlideRemoveSection() {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__REMOVE_BY_PATH__:${selectedSlideElement.path}||${slideHint()}`, 'Removed');
    clearSlideSelection();
  }
  async function handleSlideRemoveSectionContainer() {
    if (!selectedSlideElement) return;
    const sectionM = selectedSlideElement.path?.match(/\b(section#[\w-]+)/);
    if (sectionM) {
      await applySlideInstruction(`__REMOVE_BY_PATH__:${sectionM[1]}`, 'Section removed');
    } else if (selectedSlideElement.sectionType) {
      await applySlideInstruction(`__REMOVE_BY_PATH__:section#${selectedSlideElement.sectionType}`, 'Section removed');
    }
    clearSlideSelection();
  }
  // Unused for slides but required by InlineEditPanel prop types
  const handleSlideLogoReplace = async (url: string) => {
    await applySlideInstruction(`__IMAGE_INJECT_SCOPED__:${selectedSlideElement?.path ?? ''}||${url}||${slideHint()}`, 'Image replaced');
  };
  const handleSlideVideoReplace = async (url: string) => {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__VIDEO_INJECT__:${selectedSlideElement.path}||${url}||${slideHint()}`, 'Video updated');
  };
  const handleSlideIconReplace = async (url: string) => {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__ICON_REPLACE__:${selectedSlideElement.path}||${url}||${slideHint()}`, 'Icon replaced');
  };
  const handleSlideSvgReplace = async (svgMarkup: string) => {
    if (!selectedSlideElement?.path) return;
    await applySlideInstruction(`__SVG_REPLACE__:${selectedSlideElement.path}||${svgMarkup}||${slideHint()}`, 'Icon replaced');
  };

  // Instant client-side undo — no server round-trip, no loading spinner.
  // Silently syncs to server in the background so hard-refresh shows undone state.
  function handleMicrositeRevert() {
    if (!viewingMicrosite || micrositeEditing || !canUndo) return;
    const prevIndex = editHistoryIndex - 1;
    const prevHtml = editHistory[prevIndex];
    setEditHistoryIndex(prevIndex);
    applyEditHtml(prevHtml);
    setViewingMicrosite((prev) =>
      prev
        ? {
            ...prev,
            ast: {
              ...prev.ast,
              sections: [
                {
                  ...(prev.ast.sections[0] as object),
                  customHtml: prevHtml,
                } as unknown as (typeof prev.ast.sections)[0],
                ...prev.ast.sections.slice(1),
              ],
            },
            renderKey: prev.renderKey,
          }
        : null,
    );
    void patchSuperClientMicrositeHtml(apiKey, name, viewingMicrosite.id, prevHtml).catch(() => {});
  }

  // Instant client-side redo.
  function handleMicrositeRedo() {
    if (!viewingMicrosite || micrositeEditing || !canRedo) return;
    const nextIndex = editHistoryIndex + 1;
    const nextHtml = editHistory[nextIndex];
    setEditHistoryIndex(nextIndex);
    applyEditHtml(nextHtml);
    setViewingMicrosite((prev) =>
      prev
        ? {
            ...prev,
            ast: {
              ...prev.ast,
              sections: [
                {
                  ...(prev.ast.sections[0] as object),
                  customHtml: nextHtml,
                } as unknown as (typeof prev.ast.sections)[0],
                ...prev.ast.sections.slice(1),
              ],
            },
            renderKey: prev.renderKey,
          }
        : null,
    );
    void patchSuperClientMicrositeHtml(apiKey, name, viewingMicrosite.id, nextHtml).catch(() => {});
  }

  // Explicit save — persists the current history snapshot to disk and marks it
  // as the "saved" position so the unsaved-changes indicator clears.
  async function handleMicrositeSave() {
    if (!viewingMicrosite || micrositeEditing || !hasUnsavedChanges) return;
    const currentHtml = editHistory[editHistoryIndex];
    if (!currentHtml) return;
    setMicrositeEditing(true);
    try {
      await patchSuperClientMicrositeHtml(apiKey, name, viewingMicrosite.id, currentHtml);
      setSavedHistoryIndex(editHistoryIndex);
      setMicrositeEditBanner('Changes saved');
      setTimeout(() => setMicrositeEditBanner(''), 3000);
    } catch {
      setMicrositeEditBanner('Save failed — try again');
      setTimeout(() => setMicrositeEditBanner(''), 5000);
    } finally {
      setMicrositeEditing(false);
    }
  }

  function handleMicrositeDragStart(e: React.MouseEvent) {
    e.preventDefault();
    micrositeDragRef.current = {
      startX: e.clientX,
      startWidth: chatPanelWidth,
    };
    setMicrositeDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(ev: MouseEvent) {
      if (!micrositeDragRef.current) return;
      const containerWidth = splitContainerRef.current?.offsetWidth ?? window.innerWidth;
      const maxChatWidth = containerWidth - MICROSITE_MIN_WIDTH;
      // Dragging left shrinks chat (delta positive → subtract), dragging right grows it
      const delta = ev.clientX - micrositeDragRef.current.startX;
      const next = Math.max(CHAT_MIN_WIDTH, Math.min(maxChatWidth, micrositeDragRef.current.startWidth + delta));
      setChatPanelWidth(next);
    }

    function onMouseUp() {
      micrositeDragRef.current = null;
      setMicrositeDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // ── Slide edit handlers ───────────────────────────────────────────────────
  async function handleSlideEdit() {
    if (!viewingSlide || !slideEditInput.trim() || slideEditing) return;
    const instruction = buildInstruction(selectedSlideElement, slideEditInput.trim());
    clearSlideSelection();
    const slideTitle = viewingSlide.title;
    const now = new Date().toISOString();
    const userMsgId = genId();
    const assistantMsgId = genId();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: slideEditInput.trim(), createdAt: now, editContext: 'slide' as const },
    ]);
    setSlideEditing(true);
    setSlideEditBanner('');
    setSlideEditInput('');
    try {
      const { html: newHtml, summary } = await editSuperClientSlide(
        apiKey,
        name ?? '',
        viewingSlide.id,
        instruction,
        slideCurrentHtmlRef.current ?? undefined,
      );
      pushSlideHistory(newHtml); // updates ref + bumps URL suffix
      setSlideEditBanner(`Updated`);
      setTimeout(() => setSlideEditBanner(''), 4000);

      const successAt = new Date().toISOString();
      const isFriendlySlipSummary =
        !!summary && summary.length <= 80 && !/^[<#_]|__/.test(summary);
      const successContent = isFriendlySlipSummary
        ? summary
        : `Presentation updated`;
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: 'assistant', content: successContent, createdAt: successAt, editContext: 'slide' as const },
      ]);
      void appendSuperClientHistory(apiKey, name, [
        { role: 'user', content: instruction, createdAt: now, editContext: 'slide' },
        { role: 'assistant', content: successContent, createdAt: successAt, editContext: 'slide' },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Edit failed';
      setSlideEditBanner(`Error: ${msg}`);
      setTimeout(() => setSlideEditBanner(''), 8000);
      const errorAt = new Date().toISOString();
      const errorContent = `Edit failed: ${msg}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: 'assistant', content: errorContent, createdAt: errorAt, editContext: 'slide' as const },
      ]);
    } finally {
      setSlideEditing(false);
    }
  }

  function handleSlideRevert() {
    if (!viewingSlide || slideEditing || !canSlideUndo) return;
    const prevIndex = slideEditHistoryIndex - 1;
    const prevHtml = slideEditHistory[prevIndex];
    setSlideEditHistoryIndex(prevIndex);
    slideCurrentHtmlRef.current = prevHtml;
    applySlideHtml(prevHtml);
    void patchSuperClientSlideHtml(apiKey, name ?? '', viewingSlide.id, prevHtml).catch(() => {});
  }

  function handleSlideRedo() {
    if (!viewingSlide || slideEditing || !canSlideRedo) return;
    const nextIndex = slideEditHistoryIndex + 1;
    const nextHtml = slideEditHistory[nextIndex];
    setSlideEditHistoryIndex(nextIndex);
    slideCurrentHtmlRef.current = nextHtml;
    applySlideHtml(nextHtml);
    void patchSuperClientSlideHtml(apiKey, name ?? '', viewingSlide.id, nextHtml).catch(() => {});
  }

  async function handleSlideSave() {
    if (!viewingSlide || slideEditing || !hasUnsavedSlideChanges) return;
    const currentHtml = slideEditHistory[slideEditHistoryIndex];
    if (!currentHtml) return;
    setSlideEditing(true);
    try {
      await patchSuperClientSlideHtml(apiKey, name ?? '', viewingSlide.id, currentHtml);
      setSlideEditSavedHistoryIndex(slideEditHistoryIndex);
      setSlideEditBanner('Changes saved');
      setTimeout(() => setSlideEditBanner(''), 3000);
    } catch {
      setSlideEditBanner('Save failed — try again');
      setTimeout(() => setSlideEditBanner(''), 5000);
    } finally {
      setSlideEditing(false);
    }
  }

  function handleSlideDragStart(e: React.MouseEvent) {
    e.preventDefault();
    slideDragRef.current = { startX: e.clientX, startWidth: chatPanelWidth };
    setSlideDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(ev: MouseEvent) {
      if (!slideDragRef.current) return;
      const containerWidth = splitContainerRef.current?.offsetWidth ?? window.innerWidth;
      const maxChatWidth = containerWidth - 400;
      const delta = ev.clientX - slideDragRef.current.startX;
      const next = Math.max(CHAT_MIN_WIDTH, Math.min(maxChatWidth, slideDragRef.current.startWidth + delta));
      setChatPanelWidth(next);
    }

    function onMouseUp() {
      slideDragRef.current = null;
      setSlideDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
  // ─────────────────────────────────────────────────────────────────────────

  function parseMarkdownSections(md: string): Array<{ heading: string; body: string }> {
    const lines = md.split('\n');
    const sections: Array<{ heading: string; body: string }> = [];
    let heading = '';
    let bodyLines: string[] = [];
    for (const line of lines) {
      if (/^#{1,3} /.test(line)) {
        sections.push({ heading, body: bodyLines.join('\n').trim() });
        heading = line;
        bodyLines = [];
      } else {
        bodyLines.push(line);
      }
    }
    sections.push({ heading, body: bodyLines.join('\n').trim() });
    return sections.filter((s) => s.heading || s.body);
  }

  function diffSections(oldMd: string, newMd: string): Set<string> {
    const oldSections = parseMarkdownSections(oldMd);
    const newSections = parseMarkdownSections(newMd);
    const oldMap = new Map(oldSections.map((s) => [s.heading, s.body]));
    const newMap = new Map(newSections.map((s) => [s.heading, s.body]));
    const changed = new Set<string>();
    for (const s of newSections) {
      if (oldMap.get(s.heading) !== s.body) changed.add(s.heading);
    }
    for (const s of oldSections) {
      if (s.heading && !newMap.has(s.heading)) changed.add(s.heading);
    }
    return changed;
  }

  // Mirrors the backend intent-classifier `kw_microsite` rule (services/api/src/chat/
  // intent-classifier.ts) — keep the two in sync. Recognises natural phrasings:
  // microsite, presentation, slide deck, landing page, one-/1-pager, single-page
  // site, mini-site, plus "convert/turn ... into a site/page/presentation".
  const MICROSITE_INTENT_RE =
    /\b(generate|create|make|build|design)\b[^.?!]*\bmicrosite\b|\bmicrosite\b[^.?!]*\b(generate|create|make|build|design)\b/i;
  const PROPOSAL_INTENT_RE =
    /\b(generate|create|write|draft|make|build)\s+(a\s+)?proposal\b/i;
  const SLIDE_INTENT_RE =
    /\b(generate|create|make|build|design|write|draft)\b[^.?!\n]{0,40}\b(slides?|deck|pptx?|presentation)\b|\bpptx?\b|\bpitch\s+deck\b/i;
  const DOCUMENT_INTENT_RE =
    /\b(generate|create|write|draft|make|build)\b[^.?!\n]{0,60}\b(blog\s*post|white\s*paper|case\s*study|press\s*release|strategy|report|brief|document|doc|article|post|paragraph|summary|proposal\s*document|executive\s*report|okr|rfp|statement\s*of\s*work|pitch\s*document|meeting\s*summary|competitive\s*analysis|vendor\s*evaluation|technical\s*spec)\b/i;

  function dismissProposal() {
    // Abort any in-flight stream so the backend cannot save further changes
    abortRef.current?.abort();
    setViewingProposal(null);
    setChangedSections(new Set());
    setUpdateBanner('');
    restoreSidebar();
  }

  function dismissDocument() {
    setViewingDocument(null);
    setShowDocExportMenu(false);
    setChangedDocSections(new Set());
    setUpdateDocBanner("");
    restoreSidebar();
  }

  function stripMarkdown(md: string): string {
    return md
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\|[-:| ]+\|$/gm, '')
      .replace(/^\|(.+)\|$/gm, (_m, inner) =>
        inner.split('|').map((c: string) => c.trim()).filter(Boolean).join('  ')
      )
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.+?)\*\*/gs, '$1')
      .replace(/\*(.+?)\*/gs, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[(.+?)\]\(.*?\)/gs, '$1')
      .replace(/^[-*+]\s+/gm, '• ')
      .replace(/^>\s*/gm, '')
      .replace(/^---+$/gm, '———')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function handleDocumentExport(fmt: 'pdf' | 'docx' | 'rtf' | 'md' | 'txt') {
    const docRef = viewingDocument ?? lastDocumentRef.current;
    if (!docRef?.content) return;
    setShowDocExportMenu(false);

    const safeName = (docRef.title || 'document')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 60);

    function triggerBlob(blob: Blob, filename: string) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    if (fmt === 'md') {
      triggerBlob(new Blob([docRef.content], { type: 'text/markdown;charset=utf-8' }), `${safeName}.md`);
      return;
    }

    if (fmt === 'txt') {
      triggerBlob(new Blob([stripMarkdown(docRef.content)], { type: 'text/plain;charset=utf-8' }), `${safeName}.txt`);
      return;
    }

    // Server-side: PDF (Puppeteer), DOCX (docx package), RTF (pure string)
    const EXT: Record<string, string> = { pdf: 'pdf', docx: 'docx', rtf: 'rtf' };
    const ext = EXT[fmt] ?? 'pdf';
    setDocExportLoading(true);
    try {
      const params = new URLSearchParams({ format: fmt });
      if (apiKey) params.set('token', apiKey);
      const res = await fetch(
        `/api/super-clients/${encodeURIComponent(name ?? '')}/generated-documents/${encodeURIComponent(docRef.id)}/export?${params.toString()}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      triggerBlob(blob, `${safeName}.${ext}`);
    } catch (err) {
      console.error(`Document ${fmt.toUpperCase()} export failed:`, err);
      showToast(`${fmt.toUpperCase()} export failed — please try again`);
    } finally {
      setDocExportLoading(false);
    }
  }

  function dismissMicrosite() {
    setViewingMicrosite(null);
    restoreSidebar();
    setMicrositeEditInput('');
    setMicrositeEditBanner('');
    // Clear history when closing the microsite panel
    setEditHistory([]);
    setEditHistoryIndex(-1);
    setSavedHistoryIndex(-1);
    setEditingLogo(null);
    setEditingLogoUrl('');
    setShowEditingLogoUrlInput(false);
    setEditModeActive(false);
    clearBridgeSelection();
  }

  function dismissSlide() {
    setViewingSlide(null);
    setShowSlideExportMenu(false);
    setSlideEditInput('');
    setSlideEditBanner('');
    slideCurrentHtmlRef.current = null;
    setSlideSrcDoc('');
    setSlideEditHistory([]);
    setSlideEditHistoryIndex(-1);
    setSlideEditSavedHistoryIndex(-1);
    setSlideEditModeActive(false);
    setSelectedSlideElement(null);
    setHoveredSlideElement(null);
    restoreSidebar();
  }

  async function handleSlideExport(fmt: 'pdf' | 'pptx') {
    const slideRef = viewingSlide ?? lastSlideRef.current;
    if (!slideRef || !name) return;
    setShowSlideExportMenu(false);
    setSlideExportLoading(fmt);
    setSlideExportMsg('Loading…');
    try {
      const slideParams = new URLSearchParams();
      if (apiKey) slideParams.set('token', apiKey);
      const htmlRes = await fetch(
        `/api/super-clients/${encodeURIComponent(name)}/slides/${encodeURIComponent(slideRef.id)}?${slideParams.toString()}`,
      );
      if (!htmlRes.ok) throw new Error('Could not fetch slide HTML');
      const html = await htmlRes.text();

      const { downloadHtmlSlidePdf, downloadHtmlSlidePptx } = await import('@/lib/html-slide-export');
      const title = slideRef.title || 'Presentation';
      const orientation = slideRef.orientation === 'portrait' ? 'portrait' : 'landscape';
      const progress = (_pct: number, msg: string) => setSlideExportMsg(msg);

      if (fmt === 'pdf') {
        await downloadHtmlSlidePdf(html, title, progress, orientation);
      } else {
        await downloadHtmlSlidePptx(html, title, progress, orientation);
      }
    } catch (err) {
      console.error('Slide export failed:', err);
      showToast('Export failed — please try again');
    } finally {
      setSlideExportLoading(null);
      setSlideExportMsg('');
    }
  }

  function openSlide(slide: SavedSlide) {
    const bg = typeof window !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
      : undefined;
    setViewingSlide({
      id: slide.id,
      url: getSlideHtmlUrl(name, slide.id, apiKey ?? undefined, bg || undefined),
      title: slide.title,
      orientation: slide.orientation,
    });
    setSlideStripVisible(true);
    setActiveRightTab("artifacts");
    collapseForPanel();
    // Fetch initial HTML to seed undo history and drive the srcDoc iframe
    setSlideSrcDoc(''); // blank while loading
    const params = new URLSearchParams();
    if (apiKey) params.set('token', apiKey);
    fetch(`/api/super-clients/${encodeURIComponent(name ?? '')}/slides/${encodeURIComponent(slide.id)}?${params.toString()}`)
      .then((r) => r.ok ? r.text() : Promise.reject(r.status))
      .then((html) => { seedSlideHistory(html); setSlideSrcDoc(html); })
      .catch(() => {});
  }

  function resetComposer() {
    setComposerStage(null);
    setActiveQuestion(null);
    setPendingProfileField(null);
    setComposerProposal(null);
    setComposerInstructions('');
    setComposerPresentationMode('web');
    setComposerImage(null);
    setComposerLogo(null);
    setComposerLogoUrl('');
    setShowLogoUrlInput(false);
    setComposerMessage('');
    setComposerContextImages([]);
    setComposerPreparedImages([]);
    setComposerImagesPreparing(false);
    setReadyImageIds(new Set());
  }

  function compressLogoFile(file: File, onDone: (base64: string, mediaType: string) => void) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const MAX_H = 200;
        const scale = img.naturalHeight > MAX_H ? MAX_H / img.naturalHeight : 1;
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          onDone(dataUrl.split(',')[1], file.type);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL('image/png', 0.85);
        onDone(compressed.split(',')[1], 'image/png');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleComposerLogoUpload(file: File) {
    compressLogoFile(file, (base64, mediaType) => {
      setComposerLogo({ base64, mediaType: mediaType as 'image/png' });
    });
  }

  // ── Initials-based SVG logo fallback ─────────────────────────────────────────
  // Derives 1-3 uppercase initials from a company name and wraps them in a
  // rounded-rect SVG that can be injected into the navbar logo slot.
  function getInitials(name: string): string {
    // Split on spaces AND hyphens so "Lyman-Morse" → ["Lyman","Morse"] → "LM"
    const words = name
      .trim()
      .split(/[\s\-]+/)
      .filter((w) => w.length > 1 && !/^(the|and|of|for|in|a|an|&|--)$/i.test(w));
    if (words.length === 0) return name.slice(0, 2).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    // Two words → both initials; three or more → first three
    return words
      .slice(0, Math.min(words.length, 3))
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }

  function extractAccentColor(html: string): string {
    // 1. Named accent variables first
    const named = html.match(
      /--(?:c-accent|accent|primary|brand(?:-color)?|color-accent|highlight|key-color)\s*:\s*(#[0-9a-fA-F]{3,8})/i,
    );
    if (named) return named[1];

    // 2. Collect all CSS variable hex values from the first 6000 chars and pick
    //    the first one that is clearly non-neutral (not near-black, near-white, or gray).
    const snippet = html.slice(0, 6000);
    const allVars = [...snippet.matchAll(/--[\w-]+\s*:\s*(#[0-9a-fA-F]{6})\b/gi)];
    for (const hit of allVars) {
      const hex = hit[1];
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      const lightness = (max + min) / 2 / 255;
      const saturation = max === min ? 0 : (max - min) / (255 - Math.abs((2 * (max + min)) / 2 - 255));
      // Skip near-black (<15% lightness), near-white (>85%), or near-gray (<20% saturation)
      if (lightness < 0.15 || lightness > 0.85 || saturation < 0.2) continue;
      return hex;
    }

    return '#1e3a5f'; // neutral navy fallback
  }

  function generateInitialsSvg(initials: string, bgColor: string): string {
    const w = initials.length > 2 ? 52 : 44;
    const fontSize = initials.length > 2 ? 14 : 17;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="44" viewBox="0 0 ${w} 44">`,
      `<rect width="${w}" height="44" rx="8" fill="${bgColor}"/>`,
      `<text x="${w / 2}" y="22" font-family="system-ui,-apple-system,sans-serif"`,
      ` font-weight="700" font-size="${fontSize}" fill="#ffffff"`,
      ` text-anchor="middle" dominant-baseline="central">${initials}</text>`,
      `</svg>`,
    ].join('');
  }

  // Injects an initials SVG into the navbar logo slot when no real logo is available.
  function injectInitialsFallback(html: string, companyName: string): string {
    if (!companyName.trim()) return html;
    const initials = getInitials(companyName);
    const color = extractAccentColor(html);
    const svg = generateInitialsSvg(initials, color);
    const wrapper = `<div style="display:flex;align-items:center;flex-shrink:0;">${svg}</div>`;

    // Strategy 0 — replace __site-logo__ img placeholder (LLM-generated pattern).
    // Replaces the entire <img> tag (including its onerror scenery fallback) with the SVG.
    // Matches any variant: __site-logo__, __site-logo-2__, __site-logo-N__, etc.
    if (/__site-logo[^"]*"/.test(html)) {
      return html.replace(/<img\b[^>]*id="__site-logo[^"]*"[^>]*\/?>/i, svg);
    }

    // Strategy 1 — replace __site-logo-slot__ text div content (new prompt pattern)
    if (html.includes('id="__site-logo-slot__"')) {
      return html.replace(/(<div[^>]*id="__site-logo-slot__"[^>]*>)([\s\S]*?)(<\/div>)/i, `$1${svg}$3`);
    }
    // Strategy 2 — find a logo/brand class element WITHIN nav/header bounds only.
    // The previous [\s\S]*? approach could cross </nav> and match footer elements.
    // Now we extract the nav content first, then search inside it.
    const navOpenM = html.match(/(<(nav|header)\b[^>]*>)/i);
    if (navOpenM) {
      const navStart = html.indexOf(navOpenM[0]);
      const closeTag = `</${navOpenM[2].toLowerCase()}>`;
      const navEndIdx = html.indexOf(closeTag, navStart + navOpenM[0].length);
      const navBounds = html.slice(navStart, navEndIdx !== -1 ? navEndIdx : navStart + 3000);

      const logoM = navBounds.match(/<(?:a|div|span)\b[^>]*class="[^"]*(?:logo|brand|navbar-brand)[^"]*"[^>]*>/i);
      if (logoM) {
        // Insert SVG right after the opening logo tag, scoped inside nav
        const insertAt = navStart + navBounds.indexOf(logoM[0]) + logoM[0].length;
        return html.slice(0, insertAt) + svg + html.slice(insertAt);
      }

      // Strategy 3 — inject as first child of the nav/header
      return html.slice(0, navStart + navOpenM[0].length) + wrapper + html.slice(navStart + navOpenM[0].length);
    }
    return html;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  function injectLogoIntoHtml(html: string, logo: { base64: string; mediaType: string } | { url: string }): string {
    // Strip any previous logo injection artifacts
    let out = html
      .replace(/<div[^>]*id="__brand-logo__"[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<script[^>]*>\/\*__logo-inject__\*\/[\s\S]*?<\/script>/gi, '');

    const src = 'url' in logo ? logo.url : `data:${logo.mediaType};base64,${logo.base64}`;
    const imgStyle = 'height:44px;width:auto;max-width:180px;object-fit:contain;display:block;flex-shrink:0;';

    // Strategy 1 — replace the __site-logo__ img placeholder the LLM emits.
    // Also removes the onerror="" scenery fallback so it can never fire.
    // Matches any variant: __site-logo__, __site-logo-2__, __site-logo-N__, etc.
    if (/__site-logo[^"]*"/.test(out)) {
      out = out.replace(/(<img\b[^>]*id="__site-logo[^"]*"[^>]*)\bsrc="[^"]*"/i, `$1src="${src}"`);
      // Strip onerror — prevents the picsum scenery fallback from ever loading
      out = out.replace(/(<img\b[^>]*id="__site-logo[^"]*"[^>]*?)\s*\bonerror="[^"]*"/i, '$1');
      return out;
    }

    // Also handle __site-logo-slot__ text div (new prompt pattern)
    if (out.includes('id="__site-logo-slot__"')) {
      return out.replace(
        /(<div[^>]*id="__site-logo-slot__"[^>]*>)([\s\S]*?)(<\/div>)/i,
        `$1<img src="${src}" alt="logo" style="${imgStyle}">$3`,
      );
    }

    // Strategy 2 — find any <img> directly inside a <nav> or <header> and replace its src
    const navImgRe = /(<(?:nav|header)\b[^>]*>[\s\S]*?)(<img\b[^>]*>)/i;
    if (navImgRe.test(out)) {
      return out.replace(navImgRe, (_, before, imgTag) => {
        const patched = imgTag
          .replace(/\bsrc="[^"]*"/i, `src="${src}"`)
          .replace(/\bstyle="[^"]*"/i, `style="${imgStyle}"`);
        const finalImg = patched.includes('src=') ? patched : patched.replace('<img', `<img src="${src}"`);
        return before + finalImg;
      });
    }

    // Strategy 3 — find an element with a logo/brand class inside nav/header and inject img
    const navLogoRe =
      /(<(?:nav|header)\b[\s\S]*?)(<(?:a|div|span)\b[^>]*class="[^"]*(?:logo|brand|navbar-brand)[^"]*"[^>]*>)/i;
    if (navLogoRe.test(out)) {
      return out.replace(navLogoRe, (_, before, logoOpenTag) => {
        // Add flex centering to the logo container and prepend the img
        const flexTag = logoOpenTag.includes('style=')
          ? logoOpenTag.replace(/\bstyle="([^"]*)"/i, (_m: string, s: string) => {
              const cleaned = s.replace(/display\s*:[^;]+;?/gi, '').replace(/align-items\s*:[^;]+;?/gi, '');
              return `style="${cleaned.trim()};display:flex;align-items:center;"`;
            })
          : logoOpenTag.replace('>', ' style="display:flex;align-items:center;">');
        return `${before}${flexTag}<img src="${src}" alt="logo" style="${imgStyle}">`;
      });
    }

    // Strategy 4 — inject into the very first child of the nav/header
    const navOpenRe = /(<(?:nav|header)\b[^>]*>)/i;
    if (navOpenRe.test(out)) {
      const slot = `<div style="display:flex;align-items:center;flex-shrink:0;"><img src="${src}" alt="logo" style="${imgStyle}"></div>`;
      return out.replace(navOpenRe, `$1${slot}`);
    }

    // Strategy 5 — fallback: fixed overlay that is vertically centered within a 64px navbar band
    const overlay = `<div id="__brand-logo__" style="position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;display:flex;align-items:center;height:64px;padding-left:20px;"><img src="${src}" alt="logo" style="${imgStyle}"></div>`;
    return /<body[^>]*>/i.test(out) ? out.replace(/(<body[^>]*>)/i, `$1${overlay}`) : overlay + out;
  }

  async function handleComposerSelectProposal(p: SuperClientProposal) {
    setLoadingMicrositeFor(p.fileName);
    try {
      const markdown = await getSuperClientProposal(apiKey, name, p.fileName);
      setComposerProposal({ proposal: p, markdown });
      setComposerStage('configure');
      // Collapse open viewer panels so the configure card gets full chat width
      setViewingProposal(null);
      setViewingMicrosite(null);
    } catch (err) {
      console.error('Failed to load proposal', err);
    } finally {
      setLoadingMicrositeFor(null);
    }
  }

  function handleComposerImageUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(',')[1];
      const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
      setComposerImage({ base64, mediaType });
    };
    reader.readAsDataURL(file);
  }

  // Keep prepareParamsRef current on every render so the effect callback can read
  // the latest values without them being listed as effect deps (which would cause
  // unnecessary re-runs when unrelated state changes).
  prepareParamsRef.current = {
    name: name ?? '',
    apiKey: apiKey ?? '',
    proposalMarkdown: composerProposal?.markdown ?? '',
  };

  // Trigger the prepare skill whenever images or instructions change.
  // Debounces 400 ms so rapid pastes of multiple images collapse into one call.
  useEffect(() => {
    const currentIds = composerContextImages.map((img) => img.id);
    const prevIds = prevContextImageIdsRef.current;
    const hasNewImages = currentIds.some((id) => !prevIds.includes(id));
    prevContextImageIdsRef.current = currentIds;

    if (!hasNewImages) {
      // Pure removal — prune existing prepared state without hitting the API
      if (composerContextImages.length === 0) {
        setComposerPreparedImages([]);
        setComposerImagesPreparing(false);
        setReadyImageIds(new Set());
      } else {
        const currentIdSet = new Set(currentIds);
        const keptIndices = prevIds.map((id, i) => (currentIdSet.has(id) ? i : -1)).filter((i) => i >= 0);
        setComposerPreparedImages((prev) => keptIndices.map((i) => prev[i]).filter(Boolean) as typeof prev);
        setReadyImageIds((prev) => new Set([...prev].filter((id) => currentIdSet.has(id))));
      }
      return;
    }

    if (composerContextImages.length === 0) {
      setComposerPreparedImages([]);
      setComposerImagesPreparing(false);
      setReadyImageIds(new Set());
      return;
    }

    setComposerImagesPreparing(true);
    const abort = new AbortController();
    // Snapshot IDs at effect-start so the closure captures the current list

    const timer = setTimeout(async () => {
      const { name: ns, apiKey: key, proposalMarkdown } = prepareParamsRef.current;
      try {
        const prepared = await prepareImages(key, ns, {
          images: composerContextImages.map((img) => ({
            base64: img.base64,
            mediaType: img.mediaType,
          })),
          ...(proposalMarkdown ? { proposalMarkdown } : {}),
          ...(composerInstructions.trim() ? { userInstructions: composerInstructions.trim() } : {}),
        });
        if (!abort.signal.aborted) {
          setComposerPreparedImages(prepared);
          setReadyImageIds(new Set(currentIds));
          setComposerImagesPreparing(false);
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          console.warn('[prepare] image prepare skill failed:', err);
          setComposerPreparedImages([]);
          setReadyImageIds(new Set());
          setComposerImagesPreparing(false);
        }
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [composerContextImages]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleComposerPaste(e: React.ClipboardEvent<HTMLElement>) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    e.stopPropagation();

    // Capture File objects synchronously — clipboard items are only valid
    // during the event handler; getAsFile() must not be deferred.
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);

    files.forEach((file) => {
      if (file.type === 'image/avif') {
        // Claude Vision doesn't accept AVIF — convert to JPEG via canvas
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d')!.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
          URL.revokeObjectURL(objectUrl);
          const base64 = dataUrl.split(',')[1];
          setComposerContextImages((current) => {
            if (current.length >= 11) return current;
            return [
              ...current,
              {
                id: genId(),
                base64,
                mediaType: 'image/jpeg',
                preview: dataUrl,
              },
            ];
          });
        };
        img.src = objectUrl;
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          const base64 = dataUrl.split(',')[1];
          const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
          setComposerContextImages((current) => {
            if (current.length >= 11) return current;
            return [...current, { id: genId(), base64, mediaType, preview: dataUrl }];
          });
        };
        reader.readAsDataURL(file);
      }
    });
  }

  async function generateComposerMicrosite() {
    if (!composerProposal || !name) return;

    const msGenId = genId();
    const msAbort = new AbortController();
    const generationStartedAt = new Date().toISOString();
    const proposalTitle = composerProposal.proposal.title;
    const micrositeTitle = proposalTitle.replace(/\bProposal\b/g, 'Microsite').replace(/\bproposal\b/g, 'microsite');
    const proposalMarkdown = composerProposal.markdown;
    const proposalInstructions = composerInstructions || undefined;
    const proposalImage = composerImage ?? undefined;
    const proposalLogo: { base64: string; mediaType: string } | { url: string } | undefined =
      composerLogo ?? (composerLogoUrl.trim() ? { url: composerLogoUrl.trim() } : undefined);
    const proposalId = composerProposal.proposal.fileName.replace(/\.md$/, '');
    // Capture all image state NOW before resetComposer clears it
    const preparedImagesSnapshot = [...composerPreparedImages];
    const rawImagesSnapshot = [...composerContextImages];
    const imageInstructionsSnapshot = composerInstructions;
    const stillPreparing = composerImagesPreparing;

    // Start in the module store (survives navigation)
    generationStore.start({
      id: msGenId,
      clientSlug: name,
      type: 'microsite',
      title: micrositeTitle,
      abort: () => msAbort.abort(),
    });
    localGenIdsRef.current.add(msGenId);

    // Add artifact message to chat and collapse composer immediately
    setMessages((prev) => [
      ...prev,
      {
        id: `gen-msg-${msGenId}`,
        role: 'assistant',
        content: '',
        generationId: msGenId,
        createdAt: new Date().toISOString(),
      },
    ]);
    resetComposer();

    try {
      // Use pre-prepared images if ready; otherwise run the prepare skill inline now.
      // (The eager prepare might still be running if the user clicked Generate quickly.)
      let contextImages = preparedImagesSnapshot;
      if (contextImages.length === 0 && rawImagesSnapshot.length > 0) {
        generationStore.addStep(msGenId, stillPreparing ? 'Finishing image analysis…' : 'Preparing images…');
        try {
          contextImages = await prepareImages(apiKey, name, {
            images: rawImagesSnapshot.map((img) => ({
              base64: img.base64,
              mediaType: img.mediaType,
            })),
            ...(proposalMarkdown ? { proposalMarkdown } : {}),
            ...(imageInstructionsSnapshot.trim() ? { userInstructions: imageInstructionsSnapshot.trim() } : {}),
          });
          generationStore.addStep(msGenId, `✓ ${contextImages.length} image(s) ready`);
        } catch (imgErr) {
          const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
          console.warn('[generate] inline image prepare failed:', errMsg);
          generationStore.addStep(
            msGenId,
            `⚠ Image preparation failed: ${errMsg.slice(0, 200)} — generating without images`,
          );
        }
      }

      let partialCharCount = 0;
      const isPdfMode = composerPresentationMode !== 'web';
      const pdfOrientation = composerPresentationMode === 'pdf-portrait' ? 'portrait' : 'landscape';
      await generateMicrositeV2Stream(apiKey, name, proposalId, {
        proposalMarkdown,
        userPrompt: proposalInstructions,
        referenceImage: proposalImage,
        ...(contextImages.length > 0 ? { contextImages } : {}),
        pdfPresentation: isPdfMode || undefined,
        pdfOrientation: isPdfMode ? pdfOrientation : undefined,
        signal: msAbort.signal,
        onEvent: (evt) => {
          if (evt.type === 'html_chunk') {
            partialCharCount += evt.chunk.length;
            generationStore.updateChars(msGenId, partialCharCount);
          }
          if (evt.type === 'progress' && evt.message) {
            generationStore.addStep(msGenId, evt.message);
          }
          if (evt.type === 'plan' && evt.totalSections) {
            generationStore.addStep(msGenId, `Building ${evt.totalSections} sections…`);
          }
          if (evt.type === 'section' && evt.heading) {
            generationStore.addStep(msGenId, `${evt.heading}`);
          }
          if (evt.type === 'complete' && evt.ast) {
            let ast = evt.ast as LayoutAST;
            // Inject logo (real image) or SVG initials fallback into the navbar slot
            if (ast.sections?.[0]) {
              const section = ast.sections[0] as unknown as {
                customHtml?: string;
              };
              if (section.customHtml) {
                const companyName =
                  ((ast.brand as unknown as Record<string, unknown>)?.companyName as string) || proposalTitle || '';
                // When a real logo is provided inject it; otherwise strip the
                // placeholder entirely — removes broken-image icon from navbar.
                const patchedHtml = proposalLogo
                  ? injectLogoIntoHtml(section.customHtml, proposalLogo)
                  : section.customHtml
                      // Remove the flex wrapper div that contains only the logo img
                      .replace(
                        /<div[^>]*flex-shrink:0[^>]*>\s*<img\b[^>]*id="__site-logo[^"]*"[^>]*\/?>\s*<\/div>/gi,
                        '',
                      )
                      // Fallback: remove bare logo img if not wrapped (catches __site-logo-N__ variants too)
                      .replace(/<img\b[^>]*id="__site-logo[^"]*"[^>]*\/?>/gi, '');
                const patched = {
                  ...(ast.sections[0] as object),
                  customHtml: patchedHtml,
                };
                ast = {
                  ...ast,
                  sections: [patched as unknown as (typeof ast.sections)[0], ...ast.sections.slice(1)],
                };
              }
            }
            if (isPdfMode) ast = { ...ast, pdfPresentation: true, pdfOrientation };
            const tempId = `preview-${msGenId}`;
            // Open the panel immediately with the stream AST (don't block on
            // save) so the finished microsite always auto-slides in on
            // creation — same as proposals/documents on completion. Whatever
            // artifact is currently open (source proposal or otherwise) is
            // replaced by the freshly generated microsite.
            {
              // Reset edit mode so the new microsite opens in view-only state.
              // Without this, if edit mode was active on a previous microsite,
              // the iframe loads without the bridge (hardcoded false below) but
              // editModeActive stays true — causing hover/click to silently fail.
              setEditModeActive(false);
              clearBridgeSelection();
              const genHtml = buildHtml(ast);
              setActiveSrcDoc(computeSrcDoc(genHtml, false));
              setViewingMicrosite({
                id: tempId,
                ast,
                renderKey: `${tempId}-${Date.now()}`,
              });
              seedHistory(genHtml); // seed undo history with initial generated state
              setViewingProposal(null);
              setChangedSections(new Set());
              setUpdateBanner('');
              setActiveRightTab('artifacts');
              collapseForPanel();
            }
            // Mark complete immediately so the progress card snaps to 100% without waiting for save
            generationStore.complete(msGenId, { ast });
            void (async () => {
              try {
                const saved = await saveSuperClientMicrosite(apiKey, name, ast, proposalTitle);
                generationStore.complete(msGenId, { micrositeId: saved.id, ast }, saved.title);
                // Swap temp ID for the real saved ID
                setViewingMicrosite((prev) => {
                  if (prev?.id !== tempId) return prev;
                  // renderKey change triggers remount; srcDoc stays the same (no scroll reset)
                  return {
                    id: saved.id,
                    ast,
                    renderKey: `${saved.id}-${Date.now()}`,
                  };
                });
                // Optimistic update so the artifacts tab is populated immediately
                setMicrosites((prev) => {
                  if (prev.some((m) => m.id === saved.id)) return prev;
                  return [saved, ...prev];
                });
                loadMicrosites(); // sync with server
                showToast('Microsite generated and saved');
                void appendSuperClientHistory(apiKey, name, [
                  {
                    role: 'user',
                    content: `Generate microsite for "${proposalTitle}"${composerPresentationMode !== 'web' ? ` (PDF ${composerPresentationMode === 'pdf-portrait' ? '9:16' : '16:9'})` : ''}`,
                    createdAt: generationStartedAt,
                  },
                  {
                    role: 'assistant',
                    content: `Microsite generated: **${saved.title ?? micrositeTitle}**`,
                    createdAt: new Date().toISOString(),
                  },
                ]);
              } catch (err) {
                generationStore.error(msGenId, (err as Error).message);
                showToast(`Failed to save microsite: ${(err as Error).message}`, 'error');
              }
            })();
          }
          if (evt.type === 'error') {
            generationStore.error(msGenId, evt.message ?? 'Unknown error');
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        generationStore.error(msGenId, (err as Error).message);
        void appendSuperClientHistory(apiKey, name, [
          {
            role: 'user',
            content: `Generate microsite for "${proposalTitle}"${composerPresentationMode !== 'web' ? ` (PDF ${composerPresentationMode === 'pdf-portrait' ? '9:16' : '16:9'})` : ''}`,
            createdAt: generationStartedAt,
          },
          {
            role: 'assistant',
            content: `Microsite generation failed: ${(err as Error).message}`,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    }
  }

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;
    // From the first user-sent message on, chat scrolls may animate (live
    // conversation); everything before that stays instant.
    userInteractedRef.current = true;

    // Answer to a local profile-field question (e.g. Project Type missing after
    // ingestion): save straight to client memory — never send to the chat
    // backend. Must run before intent detection so an answer like
    // "Microsite / Proposal" is not hijacked by the microsite intercept.
    if (pendingProfileField) {
      const field = pendingProfileField;
      setPendingProfileField(null);
      resetComposer();
      setInput('');
      const answerTs = new Date().toISOString();
      const confirmTs = new Date(Date.now() + 1).toISOString();
      setMessages((prev) => [...prev, { id: genId(), role: 'user', content: text, createdAt: answerTs }]);
      try {
        await updateClientStableField(apiKey, name, field, text);
        setMemoryKey((k) => k + 1);
        const confirmMsg = `Got it — Project Type set to **${text}**. You can edit it anytime in the Context tab.`;
        setMessages((prev) => [...prev, { id: genId(), role: 'assistant', content: confirmMsg, createdAt: confirmTs }]);
        void appendSuperClientHistory(apiKey, name, [
          { role: 'user', content: text, createdAt: answerTs },
          { role: 'assistant', content: confirmMsg, createdAt: confirmTs },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: 'assistant',
            content: 'Could not save the project type — you can set it manually in the Context tab.',
            createdAt: confirmTs,
          },
        ]);
      }
      return;
    }

    const isQuestion = /^(how|what|why|when|where|who|is|are|can|could|would|does|do|did|will|should)\b/i.test(text);
    if (!isQuestion && MICROSITE_INTENT_RE.test(text)) {
      const reply =
        proposals.length === 0
          ? "You'll need a proposal first, ask me to generate one for this client."
          : proposals.length === 1
            ? 'Pick a proposal below to generate its microsite.'
            : 'Pick a proposal below to generate its microsite.';
      const intentNow = new Date().toISOString();
      const intentAssistantTs = new Date(Date.now() + 1).toISOString();
      setMessages((prev) => [...prev, { id: genId(), role: 'user', content: text, createdAt: intentNow }]);
      setInput('');
      // Extract any context the user included alongside the trigger word and pre-fill instructions
      const extracted = text
        .replace(/\b(generate|create|make|build|design|turn|convert|into)\b/gi, '')
        .replace(
          /\b(microsite|micro-site|presentation|slide\s?deck|slides|landing\s?page|(one|1)[-\s]?pager|single[-\s]?page\s+(site|website|page)|(one|1)[-\s]?page\s+(site|website)|mini[-\s]?site)\b/gi,
          '',
        )
        .replace(/\b(a|an|the|me|my|for|please|can you|could you)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (extracted) setComposerInstructions(extracted);
      if (proposals.length > 0) {
        setComposerMessage(reply);
        setComposerStage('select-proposal');
        // Collapse viewer panels so the proposal picker gets full chat width
        setViewingProposal(null);
        setViewingMicrosite(null);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: 'assistant', content: reply, createdAt: intentAssistantTs },
        ]);
      }
      void appendSuperClientHistory(apiKey, name, [
        { role: 'user', content: text, createdAt: intentNow },
        { role: 'assistant', content: reply, createdAt: intentAssistantTs },
      ]);
      return;
    }

    // Detect intent and compose a planning message synchronously — no server
    // round-trip, so the text appears the moment the user hits send.
    let proposalGenId: string | null = null;
    let slideGenId: string | null = null;
    let documentGenId: string | null = null;
    let docCharCount = 0;
    let docFirstChunk = true;
    let slideCharCount = 0;
    let slideFirstChunk = true;

    const clientLabel = meta?.displayName ?? name;
    let planningContent = "";

    if (SLIDE_INTENT_RE.test(text)) {
      const countMatch = text.match(/\b(\d+)[\s\-]*(page|slide|screen)s?\b/i);
      const count = countMatch ? countMatch[1] : null;
      planningContent = count
        ? `Building a ${count}-slide presentation for ${clientLabel}…`
        : `Building a presentation for ${clientLabel}…`;
      slideGenId = genId();
      generationStore.start({
        id: slideGenId,
        clientSlug: name,
        type: "slide",
        title: "Presentation",
        abort: () => abortRef.current?.abort(),
      });
      generationStore.addStep(slideGenId, "Reading client context…");
      localGenIdsRef.current.add(slideGenId);
    } else if (PROPOSAL_INTENT_RE.test(text)) {
      planningContent = `Drafting a proposal for ${clientLabel}…`;
      proposalGenId = genId();
      generationStore.start({
        id: proposalGenId,
        clientSlug: name,
        type: 'proposal',
        title: 'Proposal',
        abort: () => abortRef.current?.abort(),
      });
      localGenIdsRef.current.add(proposalGenId);
    } else if (DOCUMENT_INTENT_RE.test(text)) {
      const docTypeMatch = text.match(/\b(blog\s*post|white\s*paper|case\s*study|press\s*release|strategy\s*\w*|report|brief|article|summary|paragraph|okr|rfp|statement\s*of\s*work|pitch\s*document|meeting\s*summary|competitive\s*analysis|vendor\s*evaluation|technical\s*spec)\b/i);
      const docTypeHint = docTypeMatch ? docTypeMatch[1].toLowerCase() : 'document';
      planningContent = `Creating a ${docTypeHint} for ${clientLabel}…`;
      documentGenId = genId();
      generationStore.start({
        id: documentGenId,
        clientSlug: name,
        type: "document",
        title: "Document",
        abort: () => abortRef.current?.abort(),
      });
      generationStore.addStep(documentGenId, "Reading client context…");
      localGenIdsRef.current.add(documentGenId);
    }

    const now = new Date().toISOString();
    const userMsg: Message = {
      id: genId(),
      role: 'user',
      content: text,
      createdAt: now,
      ...(proposalEditActive ? { editContext: "proposal" as const } : {}),
    };
    const assistantMsgId = genId();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      streaming: true,
      createdAt: now,
      // generationId is intentionally NOT pre-attached here (unlike the eager
      // generationStore.start() above) — the card must only become visible once
      // the server's "planning" event confirms generation is actually happening
      // (see the evt.type === "planning" handler below, which attaches
      // proposalGenId at that point). Attaching it eagerly made the card flash
      // and then vanish whenever the readiness gate declines a bare request
      // against a context-less client — that gate returns before ever emitting
      // "planning". Document/slide already follow this pattern; proposal was
      // the one path attaching it upfront.
      ...(proposalEditActive ? { editContext: "proposal" as const } : {}),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      await streamSuperClientChat(
        apiKey,
        name,
        text,
        (evt: SuperClientChatEvent) => {
          if (evt.type === "planning" && evt.artifactType) {
            // Server-driven generation card — authoritative over the optimistic
            // regex path (covers e.g. resume-after-clarify where no regex fired).
            const t = evt.artifactType;
            let gid = t === "slide" ? slideGenId : t === "proposal" ? proposalGenId : documentGenId;
            if (!gid) {
              gid = genId();
              generationStore.start({
                id: gid,
                clientSlug: name,
                type: t,
                title: evt.genTitle ?? evt.skillName ?? (t === "slide" ? "Presentation" : t === "proposal" ? "Proposal" : "Document"),
                abort: () => abortRef.current?.abort(),
              });
              localGenIdsRef.current.add(gid);
              if (t === "slide") slideGenId = gid;
              else if (t === "proposal") proposalGenId = gid;
              else documentGenId = gid;
            }
            // Attach the card to the streaming assistant message so it renders
            // live during generation (previously slide/document cards only
            // attached retroactively on done).
            const attach = gid;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, generationId: attach } : m)),
            );
          }
          if (evt.type === "progress" && evt.message) {
            // Mirror the microsite mapping: server progress → card step.
            const active = slideGenId ?? proposalGenId ?? documentGenId;
            if (active) {
              const gen = generationStore.get(active);
              // Skip exact-duplicate consecutive steps (regex path may have
              // already seeded the same first step locally).
              if (gen?.steps[gen.steps.length - 1] !== evt.message) {
                generationStore.addStep(active, evt.message);
              }
            }
          }
          if (evt.type === "chunk" && evt.text) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + evt.text }
                  : m,
              ),
            );
          }
          if (evt.type === 'done') {
            if (evt.isClarify && evt.text) {
              // Questions take over the composer (like the microsite proposal
              // selector) instead of appearing inline — drop the placeholder
              // bubble and surface the question + options in the composer.
              setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
              setActiveQuestion({ text: evt.text, options: evt.clarifyOptions ?? [] });
              setComposerStage('clarify');
              return;
            }
            if (evt.isMicrosite) {
              // Microsite intent detected by the backend (e.g. "landingpage", which
              // the client-side regex misses): open the proposal selector in the
              // composer — the same UX as the client-side microsite intercept.
              setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
              if (proposals.length > 0) {
                setComposerMessage(evt.text ?? 'Pick a proposal below to generate its microsite.');
                setComposerStage('select-proposal');
                setViewingProposal(null);
                setViewingMicrosite(null);
              } else {
                // No proposals yet — show the guidance so the user knows the next step.
                setMessages((prev) => [
                  ...prev,
                  {
                    id: genId(),
                    role: 'assistant',
                    content: evt.text ?? "You'll need a proposal first, ask me to generate one for this client.",
                    createdAt: new Date().toISOString(),
                  },
                ]);
              }
              return;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      streaming: false,
                      ...(evt.text ? { content: evt.text } : {}),
                    }
                  : m,
              ),
            );
            if (evt.proposalSaved && !evt.slideSaved) {
              // Only show a proposal card when slides weren't also generated.
              // If slideSaved is also present the user asked for a presentation —
              // update the proposals list silently and let the slide card win.
              let effectiveGenId = proposalGenId;
              if (!effectiveGenId) {
                effectiveGenId = genId();
                generationStore.start({
                  id: effectiveGenId,
                  clientSlug: name,
                  type: 'proposal',
                  title: evt.proposalSaved.title,
                  abort: () => {},
                });
                localGenIdsRef.current.add(effectiveGenId);
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, generationId: effectiveGenId! } : m)),
                );
              }
              generationStore.complete(
                effectiveGenId,
                { fileName: evt.proposalSaved.fileName },
                evt.proposalSaved.title,
              );
              // Optimistic update so the artifacts tab is populated immediately
              setProposals((prev) => {
                if (
                  prev.some((p) => p.fileName === evt.proposalSaved!.fileName)
                )
                  return prev;
                return [evt.proposalSaved!, ...prev];
              });
              loadProposals();
              // Always slide the freshly generated proposal in on creation,
              // replacing whatever artifact is currently open.
              setActiveRightTab("artifacts");
              void openProposal(evt.proposalSaved!);
            } else if (evt.proposalSaved && evt.slideSaved) {
              // Slides take the card — update proposals list silently, dismiss any early card
              setProposals((prev) => {
                if (prev.some((p) => p.fileName === evt.proposalSaved!.fileName))
                  return prev;
                return [evt.proposalSaved!, ...prev];
              });
              loadProposals();
              if (proposalGenId) {
                generationStore.dismiss(proposalGenId);
                setMessages((prev) =>
                  prev.filter((m) => m.generationId !== proposalGenId),
                );
              }
            } else if (proposalGenId) {
              // Proposal intent matched but LLM didn't generate one — remove the
              // capsule, but keep any text the backend streamed (e.g. the
              // no-context decline guidance) by stripping the generationId
              // instead of deleting a content-bearing bubble.
              generationStore.dismiss(proposalGenId);
              const gid = proposalGenId;
              setMessages((prev) =>
                prev
                  .map((m) => (m.generationId === gid && m.content.trim() ? { ...m, generationId: undefined } : m))
                  .filter((m) => m.generationId !== gid),
              );
            }
            if (evt.proposalUpdated) {
              setProposals((prev) =>
                prev.map((p) => (p.fileName === evt.proposalUpdated!.fileName ? evt.proposalUpdated! : p)),
              );
              void (async () => {
                try {
                  const newContent = await getSuperClientProposal(apiKey, name, evt.proposalUpdated!.fileName);
                  setViewingProposal((prev) => {
                    if (!prev) return prev;
                    const changed = diffSections(prev.content, newContent);
                    setChangedSections(changed);
                    const count = changed.size;
                    setUpdateBanner(count === 1 ? '1 section updated' : `${count} sections updated`);
                    return {
                      fileName: prev.fileName,
                      title: evt.proposalUpdated!.title,
                      content: newContent,
                    };
                  });
                } catch (err) {
                  console.error('Failed to reload updated proposal', err);
                }
              })();
            }
            if (evt.documentSaved) {
              let effectiveDocGenId = documentGenId;
              if (!effectiveDocGenId) {
                effectiveDocGenId = genId();
                generationStore.start({
                  id: effectiveDocGenId,
                  clientSlug: name,
                  type: "document",
                  title: evt.documentSaved.title,
                  abort: () => {},
                });
                localGenIdsRef.current.add(effectiveDocGenId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, generationId: effectiveDocGenId! }
                      : m,
                  ),
                );
              }
              generationStore.addStep(effectiveDocGenId, "Saving document…");
              generationStore.complete(
                effectiveDocGenId,
                {
                  documentId: evt.documentSaved.id,
                  documentType: evt.documentSaved.documentType,
                  preferredFormat: evt.documentSaved.preferredFormat,
                  downloadUrl: evt.documentSaved.downloadUrl,
                },
                evt.documentSaved.title,
              );
              setGeneratedDocs((prev) =>
                prev.some((d) => d.id === evt.documentSaved!.id)
                  ? prev
                  : [evt.documentSaved!, ...prev],
              );
              loadGeneratedDocs();
              // Always slide the freshly generated document in on creation,
              // replacing whatever artifact is currently open.
              void openDocument(evt.documentSaved);
            } else if (documentGenId) {
              // Keep any streamed text (e.g. no-context decline) — drop only the card.
              generationStore.dismiss(documentGenId);
              const gid = documentGenId;
              setMessages((prev) =>
                prev
                  .map((m) => (m.generationId === gid && m.content.trim() ? { ...m, generationId: undefined } : m))
                  .filter((m) => m.generationId !== gid),
              );
            }
            if (evt.slideSaved) {
              let effectiveSlideGenId = slideGenId;
              if (!effectiveSlideGenId) {
                // Retroactive: intent regex didn't match, create a card now
                effectiveSlideGenId = genId();
                generationStore.start({
                  id: effectiveSlideGenId,
                  clientSlug: name,
                  type: "slide",
                  title: evt.slideSaved.title,
                  abort: () => {},
                });
                localGenIdsRef.current.add(effectiveSlideGenId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, generationId: effectiveSlideGenId! }
                      : m,
                  ),
                );
              }
              generationStore.addStep(effectiveSlideGenId, "Saving presentation…");
              generationStore.complete(
                effectiveSlideGenId,
                { slideId: evt.slideSaved.id },
                evt.slideSaved.title,
              );
              setSavedSlides((prev) =>
                prev.some((s) => s.id === evt.slideSaved!.id)
                  ? prev
                  : [evt.slideSaved!, ...prev],
              );
              // Never slide the new presentation in over an artifact the user
              // is viewing/editing — it stays reachable via the generation card.
              if (!artifactOpenRef.current) {
                setActiveRightTab("artifacts");
                openSlide(evt.slideSaved);
              }
            } else if (slideGenId) {
              // Intent matched but LLM didn't generate a presentation — remove the
              // capsule, keeping any streamed text (e.g. no-context decline).
              generationStore.dismiss(slideGenId);
              const gid = slideGenId;
              setMessages((prev) =>
                prev
                  .map((m) => (m.generationId === gid && m.content.trim() ? { ...m, generationId: undefined } : m))
                  .filter((m) => m.generationId !== gid),
              );
            }
            if (evt.documentUpdated) {
              setGeneratedDocs((prev) =>
                prev.map((d) =>
                  d.id === evt.documentUpdated!.id ? { ...d, ...evt.documentUpdated! } : d,
                ),
              );
              void (async () => {
                try {
                  const newContent = await getGeneratedDocumentContent(
                    apiKey,
                    name,
                    evt.documentUpdated!.id,
                  );
                  setViewingDocument((prev) => {
                    if (!prev) return prev;
                    const changed = diffSections(prev.content, newContent);
                    setChangedDocSections(changed);
                    const count = changed.size;
                    setUpdateDocBanner(
                      count === 1 ? "1 section updated" : `${count} sections updated`,
                    );
                    return { ...prev, content: newContent };
                  });
                } catch (err) {
                  console.error("Failed to reload updated document", err);
                }
              })();
            }
          }
          if (evt.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: `Error: ${evt.message ?? 'Unknown error'}`,
                      streaming: false,
                    }
                  : m,
              ),
            );
          }
        },
        abortRef.current.signal,
        viewingProposal ? viewingProposal.fileName : undefined,
        viewingDocument ? viewingDocument.id : undefined,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `Error: ${(err as Error).message}`,
                  streaming: false,
                }
              : m,
          ),
        );
      }
    } finally {
      setStreaming(false);
      // Resolve any card this turn started that never reached a terminal state.
      // The done-handler branches already complete/dismiss cards on success and
      // on a failed generation; this catches the error/abort/timeout paths,
      // which otherwise leave the card stuck 'generating' — and persisted on the
      // server as a permanent spinner. Dismiss triggers the server DELETE via the
      // generationStore subscribe sync. No-op if already complete or gone.
      for (const gid of [slideGenId, proposalGenId, documentGenId]) {
        if (gid && generationStore.get(gid)?.phase === 'generating') {
          generationStore.dismiss(gid);
        }
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  if (loading) {
    // Fixed full-viewport overlay (covers the sidebar too) so the loading
    // state is visually identical to the /artifacts tap overlay and the
    // deep-link overlay — one continuous loader, not a sequence of layouts.
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 3000,
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: 'var(--muted)',
          fontSize: 13,
        }}
      >
        {/* animationDelay locks the rotation phase to the wall clock so the
            spinner doesn't visibly restart when one loading overlay hands
            off to the next (artifacts tap → page load → deep-link open). */}
        <Loader
          suppressHydrationWarning
          size={22}
          style={{ animation: 'spin 1s linear infinite', animationDelay: `-${Date.now() % 1000}ms`, color: 'var(--primary)' }}
        />
        <span suppressHydrationWarning>{deepLinkOpening ?? 'Loading…'}</span>
      </div>
    );
  }

  if (error || !meta) {
    const is404 = error?.includes('404');
    const isNetwork = error?.toLowerCase().includes('network') || error?.toLowerCase().includes('failed to fetch');
    const title = is404 ? 'Client not found' : isNetwork ? 'Network error' : 'Something went wrong';
    const detail = is404
      ? 'This client may have been deleted.'
      : isNetwork
        ? 'Check your connection and try again.'
        : (error ?? 'Could not load client.');
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 12,
        }}
      >
        <p
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--text)',
            margin: 0,
          }}
        >
          {title}
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>{detail}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={() => router.push('/')}
            style={{
              padding: '7px 16px',
              borderRadius: 8,
              fontSize: 13,
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              color: 'var(--text)',
            }}
          >
            ← All clients
          </button>
          {!is404 && (
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                fontSize: 13,
                background: 'var(--primary)',
                border: 'none',
                cursor: 'pointer',
                color: '#fff',
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // Version maps: group by key, sort oldest→newest, assign v1/v2…
  const msVersionMap = new Map<string, number>();
  {
    const grouped = new Map<string, typeof microsites>();
    for (const ms of [...microsites].sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime())) {
      const key = ms.proposalTitle || ms.title.split(/\s*[-–—]\s*/)[0];
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(ms);
    }
    for (const group of grouped.values()) group.forEach((ms, i) => msVersionMap.set(ms.id, i + 1));
  }
  const propVersionMap = new Map<string, number>();
  {
    const grouped = new Map<string, typeof proposals>();
    for (const p of [...proposals].sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime())) {
      const key = p.title.split(/\s*[-–—]\s*/)[0];
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }
    for (const group of grouped.values()) group.forEach((p, i) => propVersionMap.set(p.fileName, i + 1));
  }

  const micrositeEditActive = !!(viewingMicrosite && micrositeStripVisible);
  const proposalEditActive = !!(viewingProposal && proposalStripVisible);
  const documentEditActive = !!(viewingDocument && documentStripVisible);
  const slideEditActive = !!(viewingSlide && slideStripVisible);
  // Any artifact viewer open — documents and presentations open the same way as
  // microsites and proposals: full-width viewer, right info panel collapsed.
  const anyViewerOpen = !!(viewingMicrosite || viewingProposal || viewingDocument || viewingSlide);

  return (
    <>
      <div ref={splitContainerRef} style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
        {/* Center — chat */}
        <div
          style={{
            flex: 1,
            maxWidth: editModeActive
              ? CHAT_MIN_WIDTH
              : anyViewerOpen
                ? chatPanelWidth
                : "100%",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: 'hidden',
            transition: 'max-width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          {/* Header */}
          <header className="chat-v2-header">
            <div className="chat-v2-header-left">
              <button className="chat-v2-back-btn" onClick={() => router.push('/')} aria-label="Back to all clients">
                <ArrowLeft size={16} />
              </button>
              <span className="chat-v2-ns">{meta.displayName}</span>
            </div>
            <div className="chat-v2-header-right">
              <HelpTip topicId="super-client-workspace" size="md" label="Help: client workspace" />
              <ThemeToggle />
              <button
                className="chat-v2-panel-toggle"
                onClick={() => {
                  if (viewingMicrosite) dismissMicrosite();
                  else if (viewingProposal) dismissProposal();
                  else if (viewingDocument) dismissDocument();
                  else if (viewingSlide) dismissSlide();
                  else setRightPanelOpen((v) => !v);
                }}
                title={
                  anyViewerOpen
                    ? "Close panel"
                    : rightPanelOpen
                      ? "Hide panel"
                      : "Show panel"
                }
              >
                <Icon
                  icon={
                    anyViewerOpen
                      ? ChevronRight
                      : rightPanelOpen
                        ? ChevronRight
                        : ChevronLeft
                  }
                  size="sm"
                />
              </button>
            </div>
          </header>

          {/* Messages */}
          <div className="chat-v2-body">
            <div className="chat-v2-main">
              <div className="chat-v2-messages">
                {messages.length === 0 && (
                  <div
                    style={{
                      textAlign: 'center',
                      color: 'var(--muted)',
                      fontSize: 14,
                      marginTop: 60,
                    }}
                  >
                    Ask anything about {meta.displayName}
                  </div>
                )}
                {messages.map((msg) => {
                  // Strip LLM artifact markup. During streaming cut at the first open tag;
                  // on completed messages remove all self-closing and block artifact tags.
                  const visibleContent = (() => {
                    if (msg.role !== 'assistant') return msg.content;
                    if (msg.streaming) {
                      return msg.content.replace(/<(slides|proposal|section-update)[^>]*>[\s\S]*$/, '').trim();
                    }
                    return msg.content
                      .replace(/<text-replace\b[^>]*?\/?>/gi, '')
                      .replace(/<\/?(?:proposal|section-update)\b[^>]*>/gi, '')
                      // Defense-in-depth: raw artifact/full-document markup must
                      // never render as a chat bubble even if the backend leaks
                      // it — strip from the first such marker to end of message.
                      .replace(/<(?:slides|!DOCTYPE|html|proposal|document)\b[\s\S]*$/i, '')
                      .replace(/\n{3,}/g, '\n\n')
                      .trim();
                  })();
                  const hasContent = !!visibleContent;
                  const hasArtifact = !!msg.generationId;
                  if (msg.role === 'user') {
                    if (msg.uploadId) {
                      return (
                        <div key={msg.id} className="chat-v2-message chat-v2-message--user">
                          <UploadMessageCard uploadId={msg.uploadId} docs={docs} />
                        </div>
                      );
                    }
                    if (
                      msg.editContext === "microsite" ||
                      msg.editContext === "proposal"
                    ) {
                      const EyebrowIcon =
                        msg.editContext === "microsite" ? Globe : FileText;
                      const eyebrowLabel =
                        msg.editContext === "microsite"
                          ? "Edit microsite"
                          : "Edit proposal";
                      return (
                        <div key={msg.id} className="chat-v2-message chat-v2-message--user">
                          <div
                            className="chat-v2-bubble"
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 0,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 500,
                                color: '#706F6B',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                lineHeight: 1,
                                marginBottom: 0,
                              }}
                            >
                              <EyebrowIcon size={16} style={{ flexShrink: 0 }} />
                              {eyebrowLabel}
                            </span>
                            {visibleContent}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={msg.id} className="chat-v2-message chat-v2-message--user">
                        <div className="chat-v2-bubble">{visibleContent}</div>
                      </div>
                    );
                  }

                  // Microsite edit confirmation — eyebrow above normal assistant bubble
                  if (msg.editContext === "microsite") {
                    const isError = visibleContent.startsWith("Edit failed");
                    return (
                      <div
                        key={msg.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            paddingLeft: 2,
                          }}
                        >
                          <Icon
                            icon={isError ? X : CheckCircle}
                            size="xs"
                            style={{ color: isError ? '#ef4444' : '#22c55e' }}
                          />
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              color: isError ? '#ef4444' : '#22c55e',
                            }}
                          >
                            {isError ? "Edit failed" : "Microsite updated"}
                          </span>
                        </div>
                        <div className="chat-v2-message chat-v2-message--assistant">
                          <div className="chat-v2-avatar">AI</div>
                          <div className="chat-v2-bubble">
                            <div className="prose">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleContent}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Assistant message — column wrapper needed to stack bubble + artifact card
                  const isEditDone =
                    (msg.editContext === "proposal" || msg.editContext === "document") &&
                    !msg.streaming &&
                    /\b(updated|changed|saved|applied|modified|revised|replaced|rewritten|regenerated)\b/i.test(
                      visibleContent,
                    ) &&
                    !/\?|for example[:\s]|what (would|do|changes)|give me (the )?direction|let me know|tell me|could you|can you/i.test(
                      visibleContent,
                    );
                  const isProposalDone = isEditDone;
                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: isProposalDone ? 4 : 0,
                      }}
                    >
                      {isProposalDone && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            paddingLeft: 2,
                          }}
                        >
                          <Icon icon={CheckCircle} size="xs" style={{ color: '#22c55e' }} />
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 500,
                              color: '#22c55e',
                            }}
                          >
                            Proposal updated
                          </span>
                        </div>
                      )}
                      <div className="chat-v2-message chat-v2-message--assistant">
                        <div className="chat-v2-avatar">AI</div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          {msg.editContext === 'proposal' && msg.streaming && (
                            <span
                              style={{
                                fontSize: 10,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: 'var(--text-secondary)',
                                opacity: 0.5,
                              }}
                            >
                              Proposal Edit
                            </span>
                          )}
                          {/* Text bubble — hidden for pure artifact messages */}
                          {(hasContent || (msg.streaming && !hasArtifact)) && (
                            <div className="chat-v2-bubble">
                              {msg.streaming && !visibleContent && (
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                  }}
                                >
                                  <span className="status-glyph" aria-hidden="true" />
                                  <em className="chat-status-text">Thinking…</em>
                                </div>
                              )}
                              {visibleContent && (
                                <>
                                  <div className="prose">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{visibleContent}</ReactMarkdown>
                                  </div>
                                  {msg.streaming && !hasArtifact && (
                                    <span className="chat-cursor" />
                                  )}
                                </>
                              )}
                            </div>
                          )}
                          {/* Artifact card */}
                          {hasArtifact && (
                            <ArtifactCard
                              gid={msg.generationId!}
                              generations={generations}
                              version={(() => {
                                const g = generations.find((x) => x.id === msg.generationId);
                                if (!g) return undefined;
                                if (g.type === 'microsite' && g.result?.micrositeId)
                                  return msVersionMap.get(g.result.micrositeId);
                                if (g.type === 'proposal' && g.result?.fileName)
                                  return propVersionMap.get(g.result.fileName);
                                return undefined;
                              })()}
                              onView={(gen) => {
                                if (gen.type === 'microsite') {
                                  if (gen.result?.micrositeId) {
                                    // micrositeId known — prefer local list for speed, fall back to
                                    // server fetch when local state hasn't caught up yet (race: save
                                    // completed but setMicrosites hasn't re-rendered).
                                    const found = microsites.find((m) => m.id === gen.result!.micrositeId);
                                    if (found) {
                                      void handleOpenMicrosite(found);
                                    } else {
                                      void handleOpenMicrosite({ id: gen.result.micrositeId } as SuperClientMicrosite);
                                    }
                                  } else if (gen.result?.ast) {
                                    // Save still in-flight — open from the cached AST so the tap
                                    // is never a no-op. Will be replaced by the real ID once save lands.
                                    const ast = gen.result.ast as LayoutAST;
                                    const html = buildHtml(ast);
                                    setActiveSrcDoc(computeSrcDoc(html));
                                    setViewingMicrosite({
                                      id: `preview-${gen.id}`,
                                      ast,
                                      renderKey: `preview-${gen.id}-tap`,
                                    });
                                    setActiveRightTab('artifacts');
                                    collapseForPanel();
                                  }
                                } else if (gen.type === 'proposal' && gen.result?.fileName) {
                                  void openProposal({
                                    fileName: gen.result.fileName,
                                    title: gen.title,
                                    savedAt: '',
                                  });
                                } else if (
                                  gen.type === "document" &&
                                  gen.result?.documentId
                                ) {
                                  const found = generatedDocs.find(
                                    (d) => d.id === gen.result!.documentId,
                                  );
                                  if (found) {
                                    void openDocument(found);
                                  }
                                } else if (
                                  gen.type === "slide" &&
                                  gen.result?.slideId
                                ) {
                                  const found = savedSlides.find(
                                    (s) => s.id === gen.result!.slideId,
                                  );
                                  if (found) {
                                    openSlide(found);
                                  } else {
                                    openSlide({ id: gen.result.slideId, title: gen.title, client: name, slideCount: 0, savedAt: "" });
                                  }
                                }
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </div>
          </div>

          {/* Input */}
          <div className="chat-v2-composer-wrap">
            {/* Composer expansion — select proposal */}
            {composerStage === 'select-proposal' && (
              <div
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  padding: '12px 12px 8px',
                  background: 'var(--panel-soft)',
                }}
              >
                {/* X — top right */}
                <button
                  onClick={resetComposer}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                    padding: 0,
                    opacity: 0.6,
                  }}
                >
                  <X size={16} />
                </button>
                {composerMessage && (
                  <div
                    style={{
                      marginBottom: 10,
                      fontSize: 14,
                      fontWeight: 400,
                      color: 'var(--text)',
                      lineHeight: 1.5,
                      paddingRight: 28,
                    }}
                  >
                    {composerMessage}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {proposals.map((p) => (
                    <button
                      key={p.fileName}
                      onClick={() => void handleComposerSelectProposal(p)}
                      disabled={loadingMicrositeFor === p.fileName}
                      style={{
                        textAlign: 'left',
                        padding: '7px 10px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--panel)',
                        cursor: 'pointer',
                        width: '100%',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 6,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '0.8';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: 'var(--primary-soft, rgba(99,102,241,0.12))',
                          color: 'var(--primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginTop: 1,
                        }}
                      >
                        <FileText size={13} strokeWidth={1.5} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              fontSize: 13,
                              color: 'var(--text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {p.title.split(/\s*[-–—]\s*/)[0]}
                          </span>
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 10,
                              fontWeight: 600,
                              color: 'var(--primary)',
                              background: 'var(--primary-soft, rgba(99,102,241,0.12))',
                              borderRadius: 4,
                              padding: '1px 5px',
                              lineHeight: 1.5,
                            }}
                          >
                            v{propVersionMap.get(p.fileName) ?? 1}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--muted)',
                            marginTop: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {loadingMicrositeFor === p.fileName
                            ? 'Loading…'
                            : `${meta?.displayName ?? name} · ${new Date(p.savedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Composer expansion — clarifying question (mirrors the proposal selector) */}
            {composerStage === 'clarify' && activeQuestion && (
              <div
                className="sc-question-overlay"
                style={{
                  position: 'relative',
                  borderRadius: 10,
                  padding: '12px 12px 10px',
                  background: 'var(--panel-soft)',
                }}
              >
                {/* X — top right; closing returns the text composer */}
                <button
                  onClick={resetComposer}
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                    padding: 0,
                    opacity: 0.6,
                  }}
                  aria-label="Dismiss question"
                >
                  <X size={16} />
                </button>
                <div
                  className="sc-q-stagger"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 7,
                    color: 'var(--primary)',
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    animationDelay: '0.05s',
                  }}
                >
                  <HelpCircle size={13} strokeWidth={2} />
                  <span>Quick question</span>
                </div>
                <div
                  className="sc-q-stagger"
                  style={{
                    marginBottom: activeQuestion.options.length ? 11 : 0,
                    fontSize: 14,
                    color: 'var(--text)',
                    lineHeight: 1.5,
                    paddingRight: 20,
                    animationDelay: '0.11s',
                  }}
                >
                  {activeQuestion.text}
                </div>
                {activeQuestion.options.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {activeQuestion.options.map((opt, i) => (
                      <button
                        key={i}
                        className="sc-q-stagger"
                        disabled={streaming}
                        onClick={() => {
                          // "Other…" on a profile-field question: return the text
                          // composer for a custom answer, keeping the question
                          // pending so the typed reply is saved to the field.
                          // Deliberately NOT resetComposer() — that clears the flag.
                          if (pendingProfileField && opt === 'Other…') {
                            setComposerStage(null);
                            setActiveQuestion(null);
                            return;
                          }
                          const t = opt; resetComposer(); void sendMessage(t);
                        }}
                        style={{
                          border: '1px solid var(--border)',
                          background: 'var(--panel)',
                          color: 'var(--text)',
                          borderRadius: 999,
                          padding: '6px 13px',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: streaming ? 'default' : 'pointer',
                          opacity: streaming ? 0.5 : 1,
                          transition: 'background 0.15s, border-color 0.15s',
                          animationDelay: `${0.17 + i * 0.05}s`,
                        }}
                        onMouseEnter={(e) => {
                          if (streaming) return;
                          e.currentTarget.style.background = 'var(--primary)';
                          e.currentTarget.style.color = '#fff';
                          e.currentTarget.style.borderColor = 'var(--primary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'var(--panel)';
                          e.currentTarget.style.color = 'var(--text)';
                          e.currentTarget.style.borderColor = 'var(--border)';
                        }}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Composer expansion — configure */}
            {composerStage === 'configure' && composerProposal && (
              <>
                {/* Proposal header — same style as Edit microsite strip */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 10px 0 14px',
                    height: 44,
                    borderRadius: '16px 16px 0 0',
                    background: 'color-mix(in srgb, var(--primary) 15%, var(--panel-soft))',
                    marginBottom: -6,
                    position: 'relative',
                    zIndex: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    <Sparkles size={14} style={{ flexShrink: 0 }} />
                    {composerProposal.proposal.title}
                  </span>
                  <button
                    onClick={resetComposer}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      padding: 0,
                      opacity: 0.6,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.opacity = '0.6';
                    }}
                    title="Dismiss"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div
                  className="chat-v2-composer"
                  onPaste={(e) => handleComposerPaste(e as React.ClipboardEvent<HTMLElement>)}
                  tabIndex={-1}
                  style={{ outline: 'none', position: 'relative', zIndex: 1 }}
                >
                  {/* Shimmer CSS */}
                  <style>{`
                  @keyframes composerWave {
                    0% { background-position: -200% 0; }
                    100% { background-position: 200% 0; }
                  }
                  .composer-thumb-shimmer {
                    position: absolute; inset: 0; border-radius: 7px; pointer-events: none;
                    background: linear-gradient(90deg, transparent 20%, rgba(255,255,255,0.22) 50%, transparent 80%);
                    background-size: 200% 100%;
                    animation: composerWave 1.4s ease-in-out infinite;
                  }
                `}</style>

                  {/* Textarea */}
                  <textarea
                    className="chat-v2-input"
                    value={composerInstructions}
                    onChange={(e) => setComposerInstructions(e.target.value)}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${el.scrollHeight}px`;
                    }}
                    placeholder="Optional: any design direction or focus areas…"
                    rows={2}
                    style={{
                      width: '100%',
                      resize: 'none',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                      fontSize: 13,
                      outline: 'none',
                      fontFamily: 'inherit',
                      lineHeight: 1.5,
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      minHeight: 60,
                    }}
                  />
                  {/* Thumbnail strip — only when images present */}
                  {composerContextImages.length > 0 && (
                    <div
                      style={{
                        borderTop: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        padding: '6px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {composerContextImages.map((img, i) => (
                        <div key={img.id} style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
                          <img
                            src={img.preview}
                            alt="pasted"
                            style={{
                              width: 36,
                              height: 36,
                              objectFit: 'cover',
                              borderRadius: 6,
                              display: 'block',
                              opacity: composerImagesPreparing && !readyImageIds.has(img.id) ? 0.38 : 1,
                              transition: 'opacity 0.5s ease',
                              border: '1px solid var(--border)',
                            }}
                          />
                          {composerImagesPreparing && !readyImageIds.has(img.id) && (
                            <div className="composer-thumb-shimmer" style={{ animationDelay: `${i * 0.18}s` }} />
                          )}
                          <button
                            onClick={() => setComposerContextImages((prev) => prev.filter((x) => x.id !== img.id))}
                            style={{
                              position: 'absolute',
                              top: -4,
                              right: -4,
                              background: 'rgba(0,0,0,0.75)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '50%',
                              width: 14,
                              height: 14,
                              cursor: 'pointer',
                              padding: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <X size={7} />
                          </button>
                        </div>
                      ))}
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--muted)',
                          flexShrink: 0,
                          marginLeft: 2,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        {composerContextImages.length}/11
                        {composerImagesPreparing && (
                          <span style={{ color: 'var(--primary)', animation: 'pulse 1.2s infinite' }}>
                            · analyzing…
                          </span>
                        )}
                      </span>
                    </div>
                  )}

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 14px',
                    }}
                  >
                    <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button
                        className={`chat-v2-attach-btn${composerAttachMenuOpen ? ' active' : ''}`}
                        onClick={() => setComposerAttachMenuOpen((v) => !v)}
                        title="Attach"
                      >
                        <Plus size={16} />
                      </button>
                      {composerAttachMenuOpen && (
                        <>
                          <div
                            style={{
                              position: 'fixed',
                              inset: 0,
                              zIndex: 9998,
                            }}
                            onClick={() => setComposerAttachMenuOpen(false)}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              bottom: 'calc(100% + 6px)',
                              left: 0,
                              zIndex: 9999,
                              background: 'var(--panel)',
                              border: '1px solid var(--border)',
                              borderRadius: 10,
                              padding: 4,
                              minWidth: 192,
                              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                            }}
                          >
                            {[
                              {
                                icon: (
                                  <ImageIcon
                                    size={14}
                                    strokeWidth={1.5}
                                    style={{
                                      flexShrink: 0,
                                      color: 'var(--muted)',
                                    }}
                                  />
                                ),
                                label:
                                  composerContextImages.length > 0
                                    ? `Add more images (${composerContextImages.length}/11)`
                                    : 'Add images',
                                action: () => {
                                  setComposerAttachMenuOpen(false);
                                  composerContextImageInputRef.current?.click();
                                },
                                disabled: composerContextImages.length >= 11,
                              },
                              {
                                icon: (
                                  <ImagePlus
                                    size={14}
                                    strokeWidth={1.5}
                                    style={{
                                      flexShrink: 0,
                                      color: composerImage ? 'var(--primary)' : 'var(--muted)',
                                    }}
                                  />
                                ),
                                label: composerImage ? 'Design inspiration ✓' : 'Design inspiration',
                                action: () => {
                                  setComposerAttachMenuOpen(false);
                                  composerImageInputRef.current?.click();
                                },
                                disabled: false,
                              },
                              {
                                icon: (
                                  <ImagePlus
                                    size={14}
                                    strokeWidth={1.5}
                                    style={{
                                      flexShrink: 0,
                                      color: composerLogo ? 'var(--primary)' : 'var(--muted)',
                                    }}
                                  />
                                ),
                                label: composerLogo ? 'Logo attached ✓' : 'Choose logo',
                                action: () => {
                                  setComposerAttachMenuOpen(false);
                                  composerLogoInputRef.current?.click();
                                },
                                disabled: false,
                              },
                              ...(!composerLogo
                                ? [
                                    {
                                      icon: (
                                        <LinkIcon
                                          size={14}
                                          strokeWidth={1.5}
                                          style={{
                                            flexShrink: 0,
                                            color: composerLogoUrl.trim() ? 'var(--primary)' : 'var(--muted)',
                                          }}
                                        />
                                      ),
                                      label: composerLogoUrl.trim() ? 'Logo URL set ✓' : 'Logo URL',
                                      action: () => {
                                        setComposerAttachMenuOpen(false);
                                        setShowLogoUrlInput(true);
                                      },
                                      disabled: false,
                                    },
                                  ]
                                : []),
                            ].map((item, idx) => (
                              <button
                                key={idx}
                                onClick={item.action}
                                disabled={item.disabled}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 9,
                                  width: '100%',
                                  background: 'none',
                                  border: 'none',
                                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                                  padding: '8px 10px',
                                  borderRadius: 7,
                                  fontSize: 13,
                                  color: item.disabled ? 'var(--muted)' : 'var(--foreground)',
                                  textAlign: 'left',
                                  opacity: item.disabled ? 0.5 : 1,
                                }}
                                onMouseEnter={(e) => {
                                  if (!item.disabled)
                                    (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-soft)';
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLButtonElement).style.background = 'none';
                                }}
                              >
                                {item.icon}
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Logo URL inline input */}
                    {showLogoUrlInput && !composerLogo && (
                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <input
                          autoFocus
                          type="url"
                          value={composerLogoUrl}
                          onChange={(e) => setComposerLogoUrl(e.target.value)}
                          placeholder="Paste logo URL…"
                          style={{
                            flex: 1,
                            fontSize: 12,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--panel)',
                            color: 'var(--text)',
                            outline: 'none',
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setShowLogoUrlInput(false);
                            if (e.key === 'Escape') {
                              setComposerLogoUrl('');
                              setShowLogoUrlInput(false);
                            }
                          }}
                        />
                        {composerLogoUrl.trim() && (
                          <button
                            onClick={() => setShowLogoUrlInput(false)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: 'var(--primary)',
                              fontSize: 11,
                              padding: '4px 6px',
                            }}
                          >
                            ✓
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setComposerLogoUrl('');
                            setShowLogoUrlInput(false);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--muted)',
                            display: 'flex',
                            padding: 4,
                          }}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )}

                    {/* Hidden file inputs */}
                    <input
                      ref={composerContextImageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const files = Array.from(e.target.files ?? []);
                        if (files.length === 0) return;
                        e.target.value = '';
                        files.forEach((file) => {
                          if (file.type === 'image/avif') {
                            const objectUrl = URL.createObjectURL(file);
                            const img = new Image();
                            img.onload = () => {
                              const canvas = document.createElement('canvas');
                              canvas.width = img.naturalWidth;
                              canvas.height = img.naturalHeight;
                              canvas.getContext('2d')!.drawImage(img, 0, 0);
                              const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                              URL.revokeObjectURL(objectUrl);
                              const base64 = dataUrl.split(',')[1];
                              setComposerContextImages((current) => {
                                if (current.length >= 11) return current;
                                return [
                                  ...current,
                                  {
                                    id: genId(),
                                    base64,
                                    mediaType: 'image/jpeg',
                                    preview: dataUrl,
                                  },
                                ];
                              });
                            };
                            img.src = objectUrl;
                          } else {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const dataUrl = ev.target?.result as string;
                              const base64 = dataUrl.split(',')[1];
                              const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
                              setComposerContextImages((current) => {
                                if (current.length >= 11) return current;
                                return [
                                  ...current,
                                  {
                                    id: genId(),
                                    base64,
                                    mediaType,
                                    preview: dataUrl,
                                  },
                                ];
                              });
                            };
                            reader.readAsDataURL(file);
                          }
                        });
                      }}
                    />
                    <input
                      ref={composerImageInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleComposerImageUpload(f);
                      }}
                    />
                    <input
                      ref={composerLogoInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleComposerLogoUpload(f);
                        e.target.value = '';
                      }}
                    />

                    {/* Right: PDF chip + Generate button */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={() =>
                          setComposerPresentationMode(composerPresentationMode === 'web' ? 'pdf-landscape' : 'web')
                        }
                        className={`composer-mode-btn${composerPresentationMode !== 'web' ? ' composer-mode-btn--active' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 3,
                            border: `1.5px solid ${composerPresentationMode !== 'web' ? 'rgba(255,255,255,0.7)' : 'currentColor'}`,
                            background: composerPresentationMode !== 'web' ? 'rgba(255,255,255,0.25)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            transition: 'background 0.15s, border-color 0.15s',
                          }}
                        >
                          {composerPresentationMode !== 'web' && (
                            <svg width="7" height="5" viewBox="0 0 7 5" fill="none">
                              <path
                                d="M1 2.5L2.8 4L6 1"
                                stroke="#fff"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                        PDF Friendly
                      </button>
                      {composerPresentationMode !== 'web' && (
                        <div className="composer-pdf-orientation">
                          {(['pdf-landscape', 'pdf-portrait'] as const).map((value) => (
                            <button
                              key={value}
                              onClick={() => setComposerPresentationMode(value)}
                              className={`composer-pdf-orientation-btn${composerPresentationMode === value ? ' composer-pdf-orientation-btn--active' : ''}`}
                            >
                              {value === 'pdf-landscape' ? '16:9' : '9:16'}
                            </button>
                          ))}
                        </div>
                      )}
                      {viewingMicrosite || viewingProposal ? (
                        <button
                          onClick={() => void generateComposerMicrosite()}
                          title="Generate Microsite"
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 8,
                            background: 'var(--primary)',
                            color: '#fff',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <ChevronRight size={16} strokeWidth={2.5} />
                        </button>
                      ) : (
                        <button
                          onClick={() => void generateComposerMicrosite()}
                          style={{
                            padding: '7px 14px',
                            borderRadius: 8,
                            background: 'var(--primary)',
                            color: '#fff',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 13,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <Sparkles size={13} />
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                            <span>Generate Microsite</span>
                            {composerPresentationMode !== 'web' && (
                              <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.8 }}>
                                PDF Friendly ({composerPresentationMode === 'pdf-landscape' ? '16:9' : '9:16'})
                              </span>
                            )}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {/* end chat-v2-composer */}
              </>
            )}

            {/* Textarea row — hidden while composer expansion is active */}
            {!composerStage && (
              <>
                {/* Document editing strip */}
                {viewingDocument && documentStripVisible && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 10px 0 14px",
                      height: 44,
                      borderRadius: "16px 16px 0 0",
                      background:
                        "color-mix(in srgb, var(--primary) 15%, var(--panel-soft))",
                      marginBottom: -6,
                      position: "relative",
                      zIndex: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--primary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <FileText size={16} style={{ flexShrink: 0 }} />
                      {viewingDocument?.documentType ? `Edit ${docTypeLabel(viewingDocument.documentType)}` : 'Edit document'}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDocumentStripVisible(false);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--primary)",
                        display: "flex",
                        alignItems: "center",
                        padding: 0,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = "0.6";
                      }}
                      title="Dismiss"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {/* Proposal editing strip — sits above composer, same as microsite strip */}
                {viewingProposal && proposalStripVisible && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 10px 0 14px',
                      height: 44,
                      borderRadius: '16px 16px 0 0',
                      background: 'color-mix(in srgb, var(--primary) 15%, var(--panel-soft))',
                      marginBottom: -6,
                      position: 'relative',
                      zIndex: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <FileText size={16} style={{ flexShrink: 0 }} />
                      Edit proposal
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setProposalStripVisible(false);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        padding: 0,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '0.6';
                      }}
                      title="Dismiss"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {/* Selection strip — shows when an element is targeted in microsite edit mode */}
                {viewingMicrosite && editModeActive && selectedElement && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 10px 0 14px',
                      height: 44,
                      borderRadius: '16px 16px 0 0',
                      background: 'color-mix(in srgb, var(--primary) 15%, var(--panel-soft))',
                      marginBottom: -6,
                      position: 'relative',
                      zIndex: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        overflow: 'hidden',
                      }}
                    >
                      <Pencil size={16} style={{ flexShrink: 0 }} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {selectedElement.sectionType ? `${selectedElement.sectionType} › ` : ''}
                        {selectedElement.label}
                      </span>
                    </span>
                    <button
                      onClick={() => clearBridgeSelection()}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        padding: 0,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '0.6';
                      }}
                      title="Clear selection"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {/* Slide element selection strip — shows when element is targeted in smart edit mode */}
                {viewingSlide && slideEditModeActive && selectedSlideElement && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 10px 0 14px",
                      height: 44,
                      borderRadius: "16px 16px 0 0",
                      background: "color-mix(in srgb, var(--primary) 15%, var(--panel-soft))",
                      marginBottom: -6,
                      position: "relative",
                      zIndex: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--primary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        overflow: "hidden",
                      }}
                    >
                      <Pencil size={16} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {selectedSlideElement.sectionType ? `${selectedSlideElement.sectionType} › ` : ""}
                        {selectedSlideElement.label}
                      </span>
                    </span>
                    <button
                      onClick={() => clearSlideSelection()}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", display: "flex", alignItems: "center", padding: 0, opacity: 0.6, flexShrink: 0 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
                      title="Clear selection"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {/* Slide editing strip — hidden when smart edit mode has an element selected */}
                {viewingSlide && slideStripVisible && !(slideEditModeActive && selectedSlideElement) && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 10px 0 14px",
                      height: 44,
                      borderRadius: "16px 16px 0 0",
                      background:
                        "color-mix(in srgb, var(--primary) 15%, var(--panel-soft))",
                      marginBottom: -6,
                      position: "relative",
                      zIndex: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: "var(--primary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <Presentation size={16} style={{ flexShrink: 0 }} />
                      Edit presentation
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSlideStripVisible(false);
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--primary)",
                        display: "flex",
                        alignItems: "center",
                        padding: 0,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = "0.6";
                      }}
                      title="Dismiss"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {/* Microsite editing strip — sits above composer with 4px sliding behind it */}
                {viewingMicrosite && micrositeStripVisible && !(editModeActive && selectedElement) && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 10px 0 14px',
                      height: 44,
                      borderRadius: '16px 16px 0 0',
                      background: 'color-mix(in srgb, var(--primary) 15%, var(--panel-soft))',
                      marginBottom: -6,
                      position: 'relative',
                      zIndex: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Globe size={16} style={{ flexShrink: 0 }} />
                      Edit microsite
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMicrositeStripVisible(false);
                        setEditModeActive(false);
                        clearBridgeSelection();
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        padding: 0,
                        opacity: 0.6,
                        flexShrink: 0,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = '0.6';
                      }}
                      title="Dismiss"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                <div
                  className="chat-v2-composer"
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    ...(anyViewerOpen
                      ? {
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          gap: 0,
                        }
                      : {}),
                  }}
                >
                  {/* Microsite edit result banner */}
                  {viewingMicrosite &&
                    micrositeEditBanner.startsWith("Error:") && (
                      <span
                        onClick={() => setMicrositeEditBanner("")}
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--destructive, #ef4444)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          padding: "4px 12px 0",
                          cursor: "pointer",
                        }}
                        title="Click to dismiss"
                      >
                        {micrositeEditBanner}
                      </span>
                    )}
                  {/* Textarea */}
                  <textarea
                    ref={textareaRef}
                    className="chat-v2-input"
                    value={
                      micrositeEditActive
                        ? micrositeEditInput
                        : slideEditActive
                          ? slideEditInput
                          : input
                    }
                    onChange={(e) =>
                      micrositeEditActive
                        ? setMicrositeEditInput(e.target.value)
                        : slideEditActive
                          ? setSlideEditInput(e.target.value)
                          : setInput(e.target.value)
                    }
                    onKeyDown={
                      micrositeEditActive
                        ? (e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void handleMicrositeEdit();
                            }
                          }
                        : slideEditActive
                          ? (e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void handleSlideEdit();
                              }
                            }
                          : handleKeyDown
                    }
                    placeholder={
                      pendingProfileField
                        ? `Type the project type for ${meta.displayName}…`
                        : micrositeEditActive && editModeActive && selectedElement
                        ? selectedElement.tag === 'img'
                          ? 'Paste URL or describe the change…'
                          : `Describe the edit…`
                        : micrositeEditActive
                          ? editModeActive
                            ? "Tap an element to select it"
                            : "Describe your edit…"
                          : proposalEditActive
                            ? "Ask to edit this proposal…"
                            : `Ask about ${meta.displayName}…`
                    }
                    disabled={
                      micrositeEditActive
                        ? micrositeEditing
                        : slideEditActive
                          ? slideEditing
                          : false
                    }
                    rows={1}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                    }}
                  />
                  {/* Horizontal separator — hidden */}
                  <div style={{ height: 1, margin: '0 2px' }} />
                  {/* Bottom bar: attach left, send right — same padding as textarea */}
                  <div className="chat-v2-composer-bottom">
                    {/* Attach (+) button */}
                    {!micrositeEditActive ? (
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <button
                          onClick={() => setAttachMenuOpen((v) => !v)}
                          title="Attach"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--muted)',
                            display: 'flex',
                            alignItems: 'center',
                            padding: '4px',
                            borderRadius: 4,
                            lineHeight: 1,
                          }}
                        >
                          <Plus size={16} />
                        </button>
                        {attachMenuOpen && (
                          <>
                            <div
                              style={{
                                position: 'fixed',
                                inset: 0,
                                zIndex: 9998,
                              }}
                              onClick={() => setAttachMenuOpen(false)}
                            />
                            <div
                              style={{
                                position: 'absolute',
                                bottom: 'calc(100% + 6px)',
                                left: 0,
                                zIndex: 9999,
                                background: 'var(--panel)',
                                border: '1px solid var(--border)',
                                borderRadius: 10,
                                padding: '4px',
                                minWidth: 172,
                                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                              }}
                            >
                              <button
                                onClick={() => {
                                  setAttachMenuOpen(false);
                                  composerFileInputRef.current?.click();
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 9,
                                  width: '100%',
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  padding: '8px 10px',
                                  borderRadius: 7,
                                  fontSize: 13,
                                  color: 'var(--foreground)',
                                  textAlign: 'left',
                                }}
                                onMouseEnter={(e) => {
                                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--panel-soft)';
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLButtonElement).style.background = 'none';
                                }}
                              >
                                <FileText
                                  size={14}
                                  strokeWidth={1.5}
                                  style={{
                                    flexShrink: 0,
                                    color: 'var(--muted)',
                                  }}
                                />
                                Upload document
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div />
                    )}
                    {/* Right-side group: edit icons + send */}
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      {viewingProposal && (
                        <button
                          onClick={() => setProposalStripVisible(true)}
                          title="Edit proposal"
                          className="theme-toggle"
                          style={{
                            background: proposalEditActive
                              ? 'color-mix(in srgb, var(--primary) 12%, transparent)'
                              : 'transparent',
                            border: '1px solid transparent',
                            color: proposalEditActive ? 'var(--primary)' : undefined,
                            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                      {viewingMicrosite && (
                        <button
                          disabled={micrositeEditing}
                          onClick={() => {
                            if (micrositeEditing) return;
                            const next = !editModeActive;
                            setEditModeActive(next);
                            if (next) {
                              setMicrositeStripVisible(true);
                            } else {
                              clearBridgeSelection();
                            }
                            setViewingMicrosite((prev) => {
                              if (!prev) return null;
                              setActiveSrcDoc(computeSrcDoc(buildHtml(prev.ast), next));
                              return {
                                ...prev,
                                renderKey: `${prev.id}-${Date.now()}`,
                              };
                            });
                          }}
                          title={
                            micrositeEditing
                              ? 'Updating microsite…'
                              : editModeActive
                                ? 'Exit smart edit mode'
                                : 'Smart edit — click any element to target it'
                          }
                          className="theme-toggle"
                          style={{
                            background: editModeActive
                              ? 'color-mix(in srgb, var(--primary) 12%, transparent)'
                              : 'transparent',
                            border: '1px solid transparent',
                            color: editModeActive ? 'var(--primary)' : undefined,
                            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                            opacity: micrositeEditing ? 0.4 : 1,
                            cursor: micrositeEditing ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                      {viewingSlide && (
                        <button
                          disabled={slideEditing}
                          onClick={() => {
                            if (slideEditing) return;
                            const next = !slideEditModeActive;
                            setSlideEditModeActive(next);
                            if (!next) clearSlideSelection();
                            const html = slideCurrentHtmlRef.current;
                            if (html) applySlideHtml(html, next);
                          }}
                          title={
                            slideEditing
                              ? 'Updating presentation…'
                              : slideEditModeActive
                                ? 'Exit smart edit mode'
                                : 'Smart edit — click any element to target it'
                          }
                          className="theme-toggle"
                          style={{
                            background: slideEditModeActive
                              ? 'color-mix(in srgb, var(--primary) 12%, transparent)'
                              : 'transparent',
                            border: '1px solid transparent',
                            color: slideEditModeActive ? 'var(--primary)' : undefined,
                            transition: 'background 0.15s, color 0.15s, border-color 0.15s',
                            opacity: slideEditing ? 0.4 : 1,
                            cursor: slideEditing ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <Pencil size={16} />
                        </button>
                      )}
                      {/* Send button */}
                      <button
                        className="chat-v2-send-btn"
                        onClick={() =>
                          micrositeEditActive
                            ? void handleMicrositeEdit()
                            : slideEditActive
                              ? void handleSlideEdit()
                              : void sendMessage()
                        }
                        disabled={
                          micrositeEditActive
                            ? micrositeEditing ||
                              (!micrositeEditInput.trim() &&
                                !editingLogo &&
                                !editingLogoUrl.trim())
                            : slideEditActive
                              ? slideEditing || !slideEditInput.trim()
                              : streaming || !input.trim()
                        }
                      >
                        <Icon
                          icon={
                            micrositeEditActive && micrositeEditing
                              ? Loader
                              : ArrowUp
                          }
                          size="md"
                          style={
                            micrositeEditActive && micrositeEditing
                              ? { animation: "spin 1s linear infinite" }
                              : undefined
                          }
                        />
                      </button>
                    </div>
                    {/* Hidden file input for composer attach */}
                    <input
                      ref={composerFileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          void handleFileUploadFromComposer(f);
                          e.target.value = '';
                        }
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Microsite slide-in panel */}
        <div
          className={`sc-viewer-panel${viewingMicrosite ? ' sc-viewer-panel--open' : ''}`}
          style={{
            flexGrow: viewingMicrosite ? 1 : 0,
            flexShrink: 0,
            flexBasis: viewingMicrosite ? 0 : 'auto',
            width: viewingMicrosite ? undefined : 0,
            minWidth: viewingMicrosite ? MICROSITE_MIN_WIDTH : 0,
            borderLeft: viewingMicrosite ? '1px solid var(--border)' : 'none',
          }}
        >
          {lastMicrositeRef.current && (
            <div
              className="sc-viewer-panel-inner"
              style={{
                width: '100%',
                position: 'relative',
              }}
            >
              {/* Drag handle — hidden in edit mode so microsite stays maximised */}
              <div
                onMouseDown={editModeActive ? undefined : handleMicrositeDragStart}
                onMouseEnter={() => !editModeActive && setMicrositeDragHover(true)}
                onMouseLeave={() => setMicrositeDragHover(false)}
                title={editModeActive ? undefined : 'Drag to resize'}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: editModeActive ? 0 : 14,
                  cursor: editModeActive ? 'default' : 'col-resize',
                  zIndex: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: micrositeDragging
                    ? 'color-mix(in srgb, var(--primary) 8%, transparent)'
                    : micrositeDragHover
                      ? 'color-mix(in srgb, var(--border) 30%, transparent)'
                      : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                    transition: 'opacity 0.15s, transform 0.15s',
                    opacity: micrositeDragging || micrositeDragHover ? 1 : 0.4,
                    transform: micrositeDragging ? 'scaleX(1.2)' : 'scaleX(1)',
                  }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: micrositeDragging || micrositeDragHover ? 4 : 3,
                        height: 4,
                        borderRadius: '50%',
                        background: micrositeDragging ? 'var(--primary)' : 'var(--muted-foreground, var(--muted))',
                        transition: 'width 0.15s, background 0.15s',
                      }}
                    />
                  ))}
                </div>
                {/* width tooltip during drag */}
                {micrositeDragging && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: 18,
                      transform: 'translateY(-50%)',
                      background: 'var(--primary)',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      zIndex: 30,
                      letterSpacing: '0.02em',
                      display: 'none',
                    }}
                  >
                    {chatPanelWidth}px
                  </div>
                )}
              </div>
              {/* Header */}
              <div
                className="sc-panel-header"
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0,
                  gap: 8,
                }}
              >
                <button
                  className="chat-v2-back-btn sc-panel-back-btn"
                  onClick={dismissMicrosite}
                  aria-label="Close panel"
                >
                  <ArrowLeft size={16} />
                </button>
                <>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text)',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <Globe size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                  {(lastMicrositeRef.current!.ast.meta as { title?: string })?.title ?? 'Microsite'}
                  {msVersionMap.get(lastMicrositeRef.current!.id) != null && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: 'rgba(var(--primary-rgb, 99,102,241), 0.85)',
                        background: 'rgba(99,102,241,0.1)',
                        border: '1px solid rgba(99,102,241,0.25)',
                        borderRadius: 999,
                        padding: '1px 6px',
                        letterSpacing: '0.04em',
                        flexShrink: 0,
                        lineHeight: '16px',
                      }}
                    >
                      v{msVersionMap.get(lastMicrositeRef.current!.id)}
                    </span>
                  )}
                </p>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  {/* Undo / Redo / Save — hidden on mobile */}
                  <div className="sc-panel-history-btns">
                    {/* Unsaved-changes indicator */}
                    {hasUnsavedChanges && (
                      <span
                        title="Unsaved changes"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: '#f59e0b',
                          flexShrink: 0,
                          display: 'inline-block',
                        }}
                      />
                    )}
                    {/* Undo */}
                    <button
                      onClick={() => handleMicrositeRevert()}
                      disabled={micrositeEditing || !canUndo}
                      title={
                        canUndo
                          ? `Undo (${editHistoryIndex} step${editHistoryIndex !== 1 ? 's' : ''} available) — Ctrl+Z`
                          : 'Nothing to undo'
                      }
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '4px 10px',
                        cursor: micrositeEditing || !canUndo ? 'default' : 'pointer',
                        fontSize: 12,
                        color: canUndo ? 'var(--foreground)' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        opacity: canUndo ? 1 : 0.4,
                      }}
                    >
                      ↩ Undo
                    </button>
                    {/* Redo */}
                    <button
                      onClick={() => handleMicrositeRedo()}
                      disabled={micrositeEditing || !canRedo}
                      title="Redo — Ctrl+Shift+Z"
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '4px 10px',
                        cursor: micrositeEditing || !canRedo ? 'default' : 'pointer',
                        fontSize: 12,
                        color: canRedo ? 'var(--foreground)' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        opacity: canRedo ? 1 : 0.4,
                      }}
                    >
                      ↪ Redo
                    </button>
                    {/* Explicit Save */}
                    <button
                      onClick={() => void handleMicrositeSave()}
                      disabled={micrositeEditing || !hasUnsavedChanges}
                      title={hasUnsavedChanges ? 'Save changes' : 'No unsaved changes'}
                      style={{
                        background: hasUnsavedChanges && !micrositeEditing ? 'var(--primary)' : 'none',
                        border: `1px solid ${hasUnsavedChanges && !micrositeEditing ? 'var(--primary)' : 'var(--border)'}`,
                        borderRadius: 6,
                        padding: '4px 10px',
                        cursor: micrositeEditing || !hasUnsavedChanges ? 'default' : 'pointer',
                        fontSize: 12,
                        color: hasUnsavedChanges && !micrositeEditing ? '#fff' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        opacity: hasUnsavedChanges ? 1 : 0.4,
                        fontWeight: hasUnsavedChanges ? 600 : 400,
                        transition: 'background 0.15s, border-color 0.15s, color 0.15s',
                      }}
                    >
                      Save
                    </button>
                  </div>
                  <button
                    onClick={() => setFullscreenMicrosite(lastMicrositeRef.current!.ast)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <ExternalLink size={12} /> Full screen
                  </button>
                  <button
                    onClick={() => setShowPublishMicrosite(true)}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Globe size={12} /> Publish
                  </button>
                  {lastMicrositeRef.current?.ast?.pdfPresentation && (
                    <button
                      onClick={() => void handleDownloadPresentationPDF()}
                      disabled={pdfDownloading}
                      title="Download as PDF Presentation"
                      style={{
                        background: pdfDownloading ? 'none' : 'color-mix(in srgb, var(--primary) 12%, transparent)',
                        border: '1px solid var(--primary)',
                        borderRadius: 6,
                        padding: '4px 10px',
                        cursor: pdfDownloading ? 'default' : 'pointer',
                        fontSize: 12,
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        opacity: pdfDownloading ? 0.6 : 1,
                        transition: 'background 0.15s, opacity 0.15s',
                      }}
                    >
                      {pdfDownloading ? (
                        <>
                          <Loader size={12} className="animate-spin" /> Generating…
                        </>
                      ) : (
                        <>
                          <Download size={12} /> Download PDF{' '}
                          {lastMicrositeRef.current?.ast?.pdfOrientation === 'portrait' ? '9:16' : '16:9'}
                        </>
                      )}
                    </button>
                  )}
                  <button
                    className="sc-panel-close-btn"
                    onClick={dismissMicrosite}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--muted)',
                      display: 'flex',
                      padding: 4,
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
                </>
              </div>

              {/* Microsite edit success banner */}
              {micrositeEditBanner && !micrositeEditBanner.startsWith('Error:') && (
                <div
                  style={{
                    padding: '8px 20px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    borderBottom: '1px solid rgba(34, 197, 94, 0.2)',
                    fontSize: 12,
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
                  {micrositeEditBanner}
                </div>
              )}

              {/* Responsive iframe preview */}
              <div
                ref={iframeContainerRef}
                style={{
                  flex: 1,
                  minHeight: 0,
                  background: _isPdf ? '#111' : '#fff',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Both orientations: iframe fills the container. Portrait sections
                    self-center via max-width:calc(100vh*9/16)+margin:auto in their CSS. */}
                <iframe
                  ref={iframeARef}
                  srcDoc={iframeSrcDocA}
                  style={{
                    position: 'absolute',
                    border: 'none',
                    colorScheme: 'light',
                    opacity: activeSlot === 'A' ? 1 : 0,
                    pointerEvents: activeSlot === 'A' ? 'auto' : 'none',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                  }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms allow-modals"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                />
                {/* Slot B — background loading slot */}
                <iframe
                  ref={iframeBRef}
                  srcDoc={iframeSrcDocB}
                  style={{
                    position: 'absolute',
                    border: 'none',
                    colorScheme: 'light',
                    opacity: activeSlot === 'B' ? 1 : 0,
                    pointerEvents: activeSlot === 'B' ? 'auto' : 'none',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                  }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms allow-modals"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                />
                {/* Video loading overlay — shown while Vimeo/YouTube buffers after a URL swap */}
                {videoLoading && (
                  <>
                    <style>{`@keyframes __vl-spin{to{transform:rotate(360deg)}}`}</style>
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 25,
                        background: 'rgba(0,0,0,0.55)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          border: '3px solid rgba(255,255,255,0.2)',
                          borderTopColor: '#fff',
                          animation: '__vl-spin 0.75s linear infinite',
                        }}
                      />
                      <p
                        style={{
                          color: 'rgba(255,255,255,0.85)',
                          marginTop: 14,
                          fontSize: 13,
                          fontWeight: 500,
                          letterSpacing: '0.02em',
                        }}
                      >
                        Loading video…
                      </p>
                    </div>
                  </>
                )}
                {/* Figma-style selection overlay — in smart edit mode OR while a global edit is processing */}
                {(editModeActive || micrositeEditing) && (
                  <SelectionOverlay
                    hovered={hoveredElement}
                    selected={selectedElement}
                    isProcessing={micrositeEditing}
                    processingLabel="Updating microsite…"
                    onClearSelected={() => clearBridgeSelection()}
                  />
                )}
                {/* Floating "Remove Section" button — top-right, blue, only for structural
                     (non-text) elements so text selections don't accidentally wipe the section */}
                {editModeActive &&
                  selectedElement &&
                  (() => {
                    const TEXT_TAGS_INLINE = new Set([
                      'h1',
                      'h2',
                      'h3',
                      'h4',
                      'h5',
                      'h6',
                      'p',
                      'span',
                      'a',
                      'li',
                      'button',
                      'label',
                      'td',
                      'th',
                      'caption',
                      'figcaption',
                      'dt',
                      'dd',
                      'blockquote',
                      'em',
                      'strong',
                      'small',
                      'b',
                      'i',
                    ]);
                    const tag = (selectedElement.tag ?? '').toLowerCase();
                    const sectionType = selectedElement.sectionType;
                    if (!sectionType) return null;

                    // Known text tags never get "Remove Section"
                    if (TEXT_TAGS_INLINE.has(tag)) return null;

                    // Leaf text elements (any tag whose inner content has no child HTML and has text)
                    // e.g. <div class="hero-label">Confidential Proposal</div>
                    const innerHtml = (selectedElement.outerHtml ?? '')
                      .replace(/^<[^>]+>/, '')
                      .replace(/<\/[^>]+>$/, '');
                    const hasChildElements = /<\w/.test(innerHtml);
                    const hasTextContent = (selectedElement.text ?? '').trim().length > 0;
                    if (hasTextContent && !hasChildElements) return null;

                    // Dimension check — user suggestion:
                    // Only show "Remove Section" when the selected element fills ≥85% of
                    // the parent section's width AND height. This ensures that clicking a
                    // small component (card, image, etc.) inside a large section does NOT
                    // show the destructive button. Full-section backgrounds/overlays and
                    // the section element itself always pass this check.
                    const elRect = selectedElement.rect;
                    const secRect = selectedElement.sectionRect;
                    if (secRect && secRect.width > 0 && secRect.height > 0) {
                      const wRatio = elRect.width / secRect.width;
                      const hRatio = elRect.height / secRect.height;
                      if (wRatio < 0.85 || hRatio < 0.85) return null;
                    }
                    // Position the button inside the section at top-right with margin.
                    // Use sectionRect (parent section's bounds) so it always lands
                    // inside the section regardless of which element was clicked.
                    const btnTop = secRect ? secRect.top + 12 : 12;
                    // Place right edge 12px inside the section's right border.
                    // translateX(-100% - 12px) moves the button left by its own width + 12px.
                    const btnLeft = secRect ? secRect.left + secRect.width : undefined;
                    return (
                      <div
                        style={{
                          position: 'absolute',
                          top: btnTop,
                          ...(btnLeft !== undefined
                            ? {
                                left: btnLeft,
                                transform: 'translateX(calc(-100% - 12px))',
                              }
                            : { right: 12 }),
                          zIndex: 25,
                          pointerEvents: 'auto',
                        }}
                      >
                        <button
                          disabled={micrositeEditing}
                          onClick={() => void handleRemoveSectionContainer()}
                          title={`Remove entire "${sectionType}" section`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 30,
                            height: 30,
                            padding: 0,
                            borderRadius: 6,
                            background: micrositeEditing ? 'rgba(13,153,255,0.35)' : 'rgba(13,153,255,0.92)',
                            border: '1.5px solid rgba(13,153,255,1)',
                            color: '#fff',
                            cursor: micrositeEditing ? 'not-allowed' : 'pointer',
                            boxShadow: '0 2px 12px rgba(13,153,255,0.35)',
                            opacity: micrositeEditing ? 0.5 : 1,
                            transition: 'background 0.15s',
                          }}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                        </button>
                      </div>
                    );
                  })()}
                {/* Inline property editor — centered at bottom of iframe area */}
                {editModeActive && selectedElement && (
                  <InlineEditPanel
                    selected={selectedElement}
                    micrositeEditing={micrositeEditing}
                    containerH={iframeContainerH}
                    containerW={iframeContainerW}
                    onStylePatch={handleStylePatch}
                    onGradientTextPatch={handleGradientTextPatch}
                    onTextPatch={handleTextPatch}
                    onImageReplace={handleImageReplace}
                    onBgImagePatch={handleBgImagePatch}
                    onIconReplace={handleIconReplace}
                    onSvgReplace={handleSvgReplace}
                    onLogoReplace={handleLogoReplace}
                    onVideoReplace={handleVideoReplace}
                    onRemoveSection={handleRemoveSection}
                    onRemoveSectionContainer={handleRemoveSectionContainer}
                    onClose={() => clearBridgeSelection()}
                  />
                )}
                {/* Overlay blocks iframe from swallowing mouse events during resize */}
                {micrositeDragging && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 10,
                      cursor: 'col-resize',
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Proposal slide-in panel */}
        <div
          className={`sc-viewer-panel${viewingProposal ? ' sc-viewer-panel--open' : ''}`}
          style={{
            flexGrow: viewingProposal ? 1 : 0,
            flexShrink: 0,
            flexBasis: viewingProposal ? 0 : 'auto',
            width: viewingProposal ? undefined : 0,
            minWidth: viewingProposal ? 400 : 0,
            borderLeft: viewingProposal ? '1px solid var(--border)' : 'none',
            position: 'relative',
          }}
        >
          {lastProposalRef.current && (
            <div
              className="sc-viewer-panel-inner"
              style={{
                width: '100%',
              }}
            >
              {/* Drag handle */}
              <div
                onMouseDown={handleMicrositeDragStart}
                onMouseEnter={() => setMicrositeDragHover(true)}
                onMouseLeave={() => setMicrositeDragHover(false)}
                title="Drag to resize"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 14,
                  cursor: 'col-resize',
                  zIndex: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: micrositeDragging
                    ? 'color-mix(in srgb, var(--primary) 8%, transparent)'
                    : micrositeDragHover
                      ? 'color-mix(in srgb, var(--border) 30%, transparent)'
                      : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 3,
                    transition: 'opacity 0.15s, transform 0.15s',
                    opacity: micrositeDragging || micrositeDragHover ? 1 : 0.4,
                    transform: micrositeDragging ? 'scaleX(1.2)' : 'scaleX(1)',
                  }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: micrositeDragging || micrositeDragHover ? 4 : 3,
                        height: 4,
                        borderRadius: '50%',
                        background: micrositeDragging ? 'var(--primary)' : 'var(--muted-foreground, var(--muted))',
                        transition: 'width 0.15s, background 0.15s',
                      }}
                    />
                  ))}
                </div>
              </div>
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                  gap: 8,
                }}
              >
                <button
                  className="chat-v2-back-btn sc-panel-back-btn"
                  onClick={dismissProposal}
                  aria-label="Close proposal panel"
                >
                  <ArrowLeft size={16} />
                </button>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                    margin: 0,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  {lastProposalRef.current!.title}
                </p>
                <button
                  className="sc-panel-close-btn"
                  onClick={dismissProposal}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--muted)',
                    display: 'flex',
                    padding: 4,
                    flexShrink: 0,
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              {updateBanner && (
                <div
                  style={{
                    padding: '8px 20px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    borderBottom: '1px solid rgba(34, 197, 94, 0.2)',
                    fontSize: 12,
                    color: 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
                  {updateBanner}
                </div>
              )}
              <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }} className="proposal-body">
                {parseMarkdownSections(lastProposalRef.current!.content).map((section, i) => {
                  const isChanged = changedSections.has(section.heading);
                  const mdChunk = [section.heading, section.body].filter(Boolean).join('\n');
                  return (
                    <div
                      key={i}
                      style={{
                        borderRadius: 6,
                        padding: isChanged ? '10px 12px' : undefined,
                        marginBottom: isChanged ? 8 : undefined,
                        background: isChanged ? 'rgba(234, 179, 8, 0.08)' : undefined,
                        borderLeft: isChanged ? '3px solid rgba(234, 179, 8, 0.6)' : undefined,
                        transition: 'background 0.4s ease, border-color 0.4s ease',
                      }}
                    >
                      <div className="prose">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{mdChunk}</ReactMarkdown>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Document slide-in panel */}
        <div
          className={`sc-viewer-panel${viewingDocument ? " sc-viewer-panel--open" : ""}`}
          style={{
            flexGrow: viewingDocument ? 1 : 0,
            flexShrink: 0,
            flexBasis: viewingDocument ? 0 : "auto",
            width: viewingDocument ? undefined : 0,
            minWidth: viewingDocument ? 400 : 0,
            borderLeft: viewingDocument ? "1px solid var(--border)" : "none",
            position: "relative",
          }}
        >
          {(viewingDocument || lastDocumentRef.current) && (
            <div
              className="sc-viewer-panel-inner"
              style={{ width: "100%" }}
            >
              {/* Drag handle */}
              <div
                onMouseDown={handleMicrositeDragStart}
                onMouseEnter={() => setMicrositeDragHover(true)}
                onMouseLeave={() => setMicrositeDragHover(false)}
                title="Drag to resize"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 14,
                  cursor: "col-resize",
                  zIndex: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: micrositeDragging
                    ? "color-mix(in srgb, var(--primary) 8%, transparent)"
                    : micrositeDragHover
                      ? "color-mix(in srgb, var(--border) 30%, transparent)"
                      : "transparent",
                  transition: "background 0.15s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    transition: "opacity 0.15s, transform 0.15s",
                    opacity: micrositeDragging || micrositeDragHover ? 1 : 0.4,
                    transform: micrositeDragging ? "scaleX(1.2)" : "scaleX(1)",
                  }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: micrositeDragging || micrositeDragHover ? 4 : 3,
                        height: 4,
                        borderRadius: "50%",
                        background: micrositeDragging
                          ? "var(--primary)"
                          : "var(--muted-foreground, var(--muted))",
                        transition: "width 0.15s, background 0.15s",
                      }}
                    />
                  ))}
                </div>
              </div>
              {/* Header */}
              <div
                style={{
                  padding: "10px 20px 10px 20px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                  gap: 8,
                }}
              >
                <button
                  className="chat-v2-back-btn sc-panel-back-btn"
                  onClick={dismissDocument}
                  aria-label="Close document panel"
                >
                  <ArrowLeft size={16} />
                </button>
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--primary-soft, rgba(99,102,241,0.12))",
                    color: "var(--primary)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FileText size={13} strokeWidth={1.5} />
                </span>
                {/* Eyebrow + title stacked */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {(() => {
                    const docRef = viewingDocument ?? lastDocumentRef.current;
                    const typeLabel = docRef?.documentType
                      ? docRef.documentType
                          .split("-")
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                          .join(" ")
                      : null;
                    return (
                      <>
                        {typeLabel && (
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: "var(--primary)",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              marginBottom: 1,
                            }}
                          >
                            {typeLabel}
                          </div>
                        )}
                        <p
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: "var(--text)",
                            margin: 0,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {docRef?.title ?? "Document"}
                        </p>
                      </>
                    );
                  })()}
                </div>
                {/* Export dropdown */}
                {(() => {
                  const docRef = viewingDocument ?? lastDocumentRef.current;
                  const EXPORT_FORMATS = [
                    { value: "pdf"  as const, label: "PDF (.pdf)" },
                    { value: "docx" as const, label: "Word (.docx)" },
                    { value: "rtf"  as const, label: "Rich Text (.rtf)" },
                    { value: "md"   as const, label: "Markdown (.md)" },
                    { value: "txt"  as const, label: "Plain Text (.txt)" },
                  ];
                  const canExport = !!(viewingDocument?.content) && !docExportLoading;
                  return (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button
                        onClick={() => canExport && setShowDocExportMenu((v) => !v)}
                        disabled={!canExport}
                        title="Export document"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "5px 10px",
                          background: canExport ? "var(--primary)" : "var(--primary-soft, rgba(99,102,241,0.5))",
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          cursor: canExport ? "pointer" : "default",
                          fontSize: 12,
                          fontWeight: 500,
                          minWidth: 76,
                          justifyContent: "center",
                        }}
                      >
                        <Download size={12} strokeWidth={2} />
                        {docExportLoading ? "Exporting…" : "Export"}
                      </button>
                      {showDocExportMenu && docRef && (
                        <>
                          <div
                            style={{ position: "fixed", inset: 0, zIndex: 99 }}
                            onClick={() => setShowDocExportMenu(false)}
                          />
                          <div
                            style={{
                              position: "absolute",
                              top: "calc(100% + 6px)",
                              right: 0,
                              background: "var(--panel)",
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                              minWidth: 160,
                              zIndex: 100,
                              overflow: "hidden",
                            }}
                          >
                            {EXPORT_FORMATS.map((fmt) => (
                              <button
                                key={fmt.value}
                                onClick={() => handleDocumentExport(fmt.value)}
                                style={{
                                  display: "block",
                                  width: "100%",
                                  padding: "9px 14px",
                                  fontSize: 13,
                                  color: "var(--text)",
                                  textAlign: "left",
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={(e) => {
                                  (e.currentTarget as HTMLElement).style.background = "var(--panel-soft)";
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLElement).style.background = "transparent";
                                }}
                              >
                                {fmt.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
                <button
                  className="sc-panel-close-btn"
                  onClick={dismissDocument}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--muted)",
                    display: "flex",
                    padding: 4,
                    flexShrink: 0,
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              {/* Update banner */}
              {updateDocBanner && (
                <div
                  style={{
                    padding: "8px 20px",
                    background: "rgba(34, 197, 94, 0.1)",
                    borderBottom: "1px solid rgba(34, 197, 94, 0.2)",
                    fontSize: 12,
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle size={12} style={{ color: "#22c55e", flexShrink: 0 }} />
                  {updateDocBanner}
                </div>
              )}
              {/* Content */}
              <div
                style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}
                className="proposal-body"
              >
                {viewingDocument?.content ? (
                  parseMarkdownSections(viewingDocument.content).map((section, i) => {
                    const isChanged = changedDocSections.has(section.heading);
                    const mdChunk = [section.heading, section.body].filter(Boolean).join("\n");
                    return (
                      <div
                        key={i}
                        style={{
                          borderRadius: 6,
                          padding: isChanged ? "10px 12px" : undefined,
                          marginBottom: isChanged ? 8 : undefined,
                          background: isChanged ? "rgba(234, 179, 8, 0.08)" : undefined,
                          borderLeft: isChanged ? "3px solid rgba(234, 179, 8, 0.6)" : undefined,
                          transition: "background 0.4s ease, border-color 0.4s ease",
                        }}
                      >
                        <div className="prose">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{mdChunk}</ReactMarkdown>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ color: "var(--muted)", fontSize: 14 }}>
                    Loading…
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Presentation slide-in panel */}
        <div
          className={`sc-viewer-panel${viewingSlide ? " sc-viewer-panel--open" : ""}`}
          style={{
            flexGrow: viewingSlide ? 1 : 0,
            flexShrink: 0,
            flexBasis: viewingSlide ? 0 : "auto",
            width: viewingSlide ? undefined : 0,
            minWidth: viewingSlide ? 400 : 0,
            borderLeft: viewingSlide ? "1px solid var(--border)" : "none",
            position: "relative",
          }}
        >
          {(viewingSlide || lastSlideRef.current) && (
            <div
              className="sc-viewer-panel-inner"
              style={{ width: "100%", position: "relative" }}
            >
              {/* Drag handle */}
              <div
                onMouseDown={handleSlideDragStart}
                onMouseEnter={() => setSlideDragHover(true)}
                onMouseLeave={() => setSlideDragHover(false)}
                title="Drag to resize"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 14,
                  cursor: "col-resize",
                  zIndex: 20,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: slideDragging
                    ? "color-mix(in srgb, var(--primary) 8%, transparent)"
                    : slideDragHover
                      ? "color-mix(in srgb, var(--border) 30%, transparent)"
                      : "transparent",
                  transition: "background 0.15s",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    transition: "opacity 0.15s, transform 0.15s",
                    opacity: slideDragging || slideDragHover ? 1 : 0.4,
                    transform: slideDragging ? "scaleX(1.2)" : "scaleX(1)",
                  }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      style={{
                        width: slideDragging || slideDragHover ? 4 : 3,
                        height: 4,
                        borderRadius: "50%",
                        background: slideDragging
                          ? "var(--primary)"
                          : "var(--muted-foreground, var(--muted))",
                        transition: "width 0.15s, background 0.15s",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Header */}
              <div
                className="sc-panel-header"
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                  gap: 8,
                }}
              >
                <button
                  className="chat-v2-back-btn sc-panel-back-btn"
                  onClick={dismissSlide}
                  aria-label="Close presentation panel"
                >
                  <ArrowLeft size={16} />
                </button>
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  <Presentation
                    size={14}
                    style={{ color: "var(--primary)", flexShrink: 0 }}
                  />
                  {(viewingSlide ?? lastSlideRef.current)?.title ?? "Presentation"}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  {/* Undo / Redo / Save */}
                  <div className="sc-panel-history-btns">
                    {hasUnsavedSlideChanges && (
                      <span
                        title="Unsaved changes"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#f59e0b",
                          flexShrink: 0,
                          display: "inline-block",
                        }}
                      />
                    )}
                    <button
                      onClick={handleSlideRevert}
                      disabled={slideEditing || !canSlideUndo}
                      title={canSlideUndo ? `Undo — Ctrl+Z` : "Nothing to undo"}
                      style={{
                        background: "none",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "4px 10px",
                        cursor: slideEditing || !canSlideUndo ? "default" : "pointer",
                        fontSize: 12,
                        color: canSlideUndo ? "var(--foreground)" : "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        opacity: canSlideUndo ? 1 : 0.4,
                      }}
                    >
                      ↩ Undo
                    </button>
                    <button
                      onClick={handleSlideRedo}
                      disabled={slideEditing || !canSlideRedo}
                      title="Redo — Ctrl+Shift+Z"
                      style={{
                        background: "none",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "4px 10px",
                        cursor: slideEditing || !canSlideRedo ? "default" : "pointer",
                        fontSize: 12,
                        color: canSlideRedo ? "var(--foreground)" : "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        opacity: canSlideRedo ? 1 : 0.4,
                      }}
                    >
                      ↪ Redo
                    </button>
                    <button
                      onClick={() => void handleSlideSave()}
                      disabled={slideEditing || !hasUnsavedSlideChanges}
                      title={hasUnsavedSlideChanges ? "Save changes" : "No unsaved changes"}
                      style={{
                        background: hasUnsavedSlideChanges && !slideEditing ? "var(--primary)" : "none",
                        border: `1px solid ${hasUnsavedSlideChanges && !slideEditing ? "var(--primary)" : "var(--border)"}`,
                        borderRadius: 6,
                        padding: "4px 10px",
                        cursor: slideEditing || !hasUnsavedSlideChanges ? "default" : "pointer",
                        fontSize: 12,
                        color: hasUnsavedSlideChanges && !slideEditing ? "#fff" : "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        opacity: hasUnsavedSlideChanges ? 1 : 0.4,
                        fontWeight: hasUnsavedSlideChanges ? 600 : 400,
                        transition: "background 0.15s, border-color 0.15s, color 0.15s",
                      }}
                    >
                      Save
                    </button>
                  </div>
                  {/* Export dropdown */}
                  {(() => {
                    const slideRef = viewingSlide ?? lastSlideRef.current;
                    return (
                      <div style={{ position: "relative", flexShrink: 0 }}>
                        <button
                          onClick={() => !slideExportLoading && setShowSlideExportMenu((v) => !v)}
                          title="Export presentation"
                          disabled={!!slideExportLoading}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            padding: "4px 10px",
                            background: "none",
                            color: "var(--muted)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            cursor: slideExportLoading ? "default" : "pointer",
                            fontSize: 12,
                          }}
                        >
                          <Download size={12} strokeWidth={2} />
                          {slideExportLoading
                            ? (slideExportMsg || "Exporting…")
                            : "Export"}
                        </button>
                        {showSlideExportMenu && slideRef && (
                          <>
                            <div
                              style={{ position: "fixed", inset: 0, zIndex: 99 }}
                              onClick={() => setShowSlideExportMenu(false)}
                            />
                            <div
                              style={{
                                position: "absolute",
                                top: "calc(100% + 6px)",
                                right: 0,
                                background: "var(--panel)",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                                minWidth: 160,
                                zIndex: 100,
                                overflow: "hidden",
                              }}
                            >
                              {([
                                { fmt: "pdf" as const, label: "PDF (.pdf)" },
                                { fmt: "pptx" as const, label: "PowerPoint (.pptx)" },
                              ] as const).map(({ fmt, label }) => (
                                <button
                                  key={fmt}
                                  onClick={() => handleSlideExport(fmt)}
                                  style={{
                                    display: "block",
                                    width: "100%",
                                    padding: "9px 14px",
                                    fontSize: 13,
                                    color: "var(--text)",
                                    textAlign: "left",
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                  }}
                                  onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "var(--panel-soft)";
                                  }}
                                  onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLElement).style.background = "transparent";
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}
                  <button
                    className="sc-panel-close-btn"
                    onClick={dismissSlide}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--muted)",
                      display: "flex",
                      padding: 4,
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Slide edit success banner */}
              {slideEditBanner && !slideEditBanner.startsWith("Error:") && (
                <div
                  style={{
                    padding: "8px 20px",
                    background: "rgba(34, 197, 94, 0.1)",
                    borderBottom: "1px solid rgba(34, 197, 94, 0.2)",
                    fontSize: 12,
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle size={12} style={{ color: "#22c55e", flexShrink: 0 }} />
                  {slideEditBanner}
                </div>
              )}

              {/* Slide iframe — srcDoc updated in-place to preserve scroll on edit */}
              <div ref={slideIframeContainerRef} style={{ flex: 1, minHeight: 0, background: "#fff", position: "relative" }}>
                <iframe
                  ref={slideIframeRef}
                  srcDoc={slideSrcDoc || undefined}
                  src={slideSrcDoc ? undefined : (viewingSlide ?? lastSlideRef.current)?.url}
                  style={{ width: "100%", height: "100%", border: "none", position: "absolute", inset: 0 }}
                  title={(viewingSlide ?? lastSlideRef.current)?.title ?? "Presentation"}
                />
                {slideEditModeActive && (
                  <SelectionOverlay
                    hovered={hoveredSlideElement}
                    selected={selectedSlideElement}
                    isProcessing={false}
                    onClearSelected={() => clearSlideSelection()}
                  />
                )}
                {slideEditModeActive && selectedSlideElement && (
                  <InlineEditPanel
                    selected={selectedSlideElement}
                    micrositeEditing={slideEditing}
                    containerH={slideIframeContainerH}
                    containerW={slideIframeContainerW}
                    onStylePatch={handleSlideStylePatch}
                    onGradientTextPatch={handleSlideGradientTextPatch}
                    onTextPatch={handleSlideTextPatch}
                    onImageReplace={handleSlideImageReplace}
                    onBgImagePatch={handleSlideBgImagePatch}
                    onIconReplace={handleSlideIconReplace}
                    onSvgReplace={handleSlideSvgReplace}
                    onLogoReplace={handleSlideLogoReplace}
                    onVideoReplace={handleSlideVideoReplace}
                    onRemoveSection={handleSlideRemoveSection}
                    onRemoveSectionContainer={handleSlideRemoveSectionContainer}
                    onClose={() => clearSlideSelection()}
                  />
                )}
                {slideEditing && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 10,
                      background: "rgba(0,0,0,0.35)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "column",
                      gap: 10,
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    <Loader size={24} style={{ animation: "spin 1s linear infinite" }} />
                    Updating presentation…
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Backdrop — mobile only, closes the right panel on tap outside */}
        {rightPanelOpen && <div className="sc-panel-backdrop" onClick={() => setRightPanelOpen(false)} />}

        {/* Right panel — client info */}
        <div
          className="chat-side-panel"
          style={{
            width:
              anyViewerOpen || !rightPanelOpen ? 0 : 320,
            minWidth: 0,
            borderLeft:
              anyViewerOpen || !rightPanelOpen
                ? "none"
                : "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: 'hidden',
            transition: 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div className="client-panel">
            {/* ── Tab bar ── */}
            <div className="client-panel-tabs" style={{ height: 48 }}>
              <button
                className={`client-panel-tab${activeRightTab === 'context' ? ' active' : ''}`}
                onClick={() => setActiveRightTab('context')}
              >
                Context
              </button>
              <button
                className={`client-panel-tab${activeRightTab === 'artifacts' ? ' active' : ''}`}
                onClick={() => setActiveRightTab('artifacts')}
                style={{ gap: 5 }}
              >
                Artifacts
                {artifactCount > 0 && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: activeRightTab === 'artifacts' ? 'var(--primary)' : 'var(--border)',
                      color: activeRightTab === 'artifacts' ? '#fff' : 'var(--muted)',
                      fontSize: 10,
                      fontWeight: 600,
                      lineHeight: 1,
                      padding: '0 4px',
                      marginBottom: 1,
                    }}
                  >
                    {artifactCount}
                  </span>
                )}
              </button>
            </div>

            {/* ── Tab content ── */}
            <div className="client-panel-body">
              {/* Context tab: documents + memory */}
              {activeRightTab === 'context' && (
                <>
                  {/* Client identity */}
                  <div
                    className="client-panel-list"
                    style={{
                      paddingTop: 8,
                      paddingLeft: 12,
                      paddingRight: 12,
                      paddingBottom: 4,
                    }}
                  >
                    <div className="brief-panel-section-header" style={{ padding: '0 4px 2px' }}>
                      <span
                        style={{
                          flex: 'none',
                          fontSize: 14,
                          fontWeight: 400,
                          color: 'var(--text)',
                          textTransform: 'none',
                          letterSpacing: 0,
                        }}
                      >
                        {meta?.displayName ?? name}
                      </span>
                    </div>

                    {urlEditMode ? (
                      <div style={{ padding: '4px 4px 6px' }}>
                        <input
                          type="url"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && urlInput.trim() && !enriching) {
                              if (contextMd.trim()) {
                                setEnrichConfirmPending(true);
                              } else {
                                void handleEnrichUrl();
                              }
                            }
                            if (e.key === 'Escape') {
                              setUrlEditMode(false);
                              setEnrichError('');
                            }
                          }}
                          placeholder="https://example.com"
                          disabled={enriching}
                          autoFocus
                          style={{
                            width: '100%',
                            fontSize: 12,
                            padding: '4px 8px',
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            color: 'var(--text)',
                            boxSizing: 'border-box',
                          }}
                        />
                        {enrichError && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#e55',
                              marginTop: 3,
                            }}
                          >
                            {enrichError}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <button
                            disabled={enriching || !urlInput.trim()}
                            onClick={() => {
                              if (contextMd.trim()) {
                                setEnrichConfirmPending(true);
                              } else {
                                void handleEnrichUrl();
                              }
                            }}
                            style={{
                              fontSize: 12,
                              padding: '3px 10px',
                              background: 'var(--accent, #6366f1)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: 6,
                              cursor: enriching || !urlInput.trim() ? 'not-allowed' : 'pointer',
                              opacity: enriching || !urlInput.trim() ? 0.6 : 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {enriching && (
                              <Loader size={11} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
                            )}
                            {enriching ? 'Fetching…' : 'Fetch'}
                          </button>
                          <button
                            disabled={enriching}
                            onClick={() => {
                              setUrlEditMode(false);
                              setEnrichError('');
                            }}
                            style={{
                              fontSize: 12,
                              padding: '3px 8px',
                              background: 'none',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              color: 'var(--muted)',
                              cursor: enriching ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : meta?.url ? (
                      <div className="client-panel-row" style={{ cursor: 'default' }}>
                        <Globe size={13} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--muted)' }} />
                        <a
                          href={meta.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="client-panel-row-name"
                          style={{
                            color: 'var(--muted)',
                            textDecoration: 'none',
                          }}
                        >
                          {meta.url.replace(/^https?:\/\//, '')}
                        </a>
                        <div className="brief-field-actions" style={{ marginLeft: 'auto' }}>
                          <button
                            className="brief-knowledge-icon-btn"
                            onClick={() => {
                              setUrlInput(meta.url ?? '');
                              setUrlEditMode(true);
                              setEnrichError('');
                            }}
                            title="Edit website URL"
                          >
                            <Pencil size={16} strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="client-panel-row"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setUrlInput('');
                          setUrlEditMode(true);
                          setEnrichError('');
                        }}
                      >
                        <Plus
                          size={13}
                          strokeWidth={1.5}
                          style={{
                            flexShrink: 0,
                            color: 'var(--muted)',
                            opacity: 0.5,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 13,
                            color: 'var(--muted)',
                            opacity: 0.5,
                          }}
                        >
                          Add website URL
                        </span>
                      </div>
                    )}
                  </div>

                  {enrichConfirmPending && (
                    <ConfirmDialog
                      title="Replace client context?"
                      message="This will overwrite the existing client context with new content fetched from the website. This cannot be undone."
                      confirmLabel="Replace"
                      onConfirm={async () => {
                        setEnrichConfirmPending(false);
                        await handleEnrichUrl();
                      }}
                      onCancel={() => setEnrichConfirmPending(false)}
                    />
                  )}

                  <ClientProfileFields key={`profile-${memoryKey}`} namespace={name} />

                  {/* Documents */}
                  <div className="client-panel-list" style={{ paddingTop: 8, paddingLeft: 12, paddingRight: 12 }}>
                    <div className="brief-panel-section-header" style={{ padding: '0 4px 2px' }}>
                      <span
                        style={{
                          flex: 'none',
                          fontSize: 14,
                          fontWeight: 400,
                          color: 'var(--muted)',
                          textTransform: 'none',
                          letterSpacing: 0,
                        }}
                      >
                        Documents
                      </span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          void handleFileUpload(f);
                          e.target.value = '';
                        }
                      }}
                    />
                    {docs.length === 0 && !uploading ? (
                      <div
                        style={{
                          padding: '4px 2px',
                          fontSize: 13,
                          color: 'var(--muted)',
                          opacity: 0.5,
                        }}
                      >
                        Upload .pdf, .txt, or .md files.
                      </div>
                    ) : (
                      docs.map((doc) => {
                        const isHov = hoveredDocId === doc.fileName;
                        const menuOpen = menuDocId === doc.fileName;
                        return (
                          <div
                            key={doc.fileName}
                            style={{ position: 'relative' }}
                            onMouseEnter={() => {
                              if (!menuDocId || menuDocId === doc.fileName) setHoveredDocId(doc.fileName);
                            }}
                            onMouseLeave={() => setHoveredDocId(null)}
                          >
                            <div
                              className="client-panel-row"
                              style={{
                                paddingRight: isHov || menuOpen ? 36 : 10,
                                cursor: 'default',
                              }}
                            >
                              <span className="client-panel-row-name">{doc.originalName ?? doc.fileName}</span>
                              {doc.status === 'processing' && (
                                <span
                                  style={{
                                    flexShrink: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    fontSize: 10,
                                    color: 'var(--primary)',
                                  }}
                                >
                                  <Icon
                                    icon={Loader}
                                    size="sm"
                                    style={{
                                      animation: 'spin 1s linear infinite',
                                      width: 10,
                                      height: 10,
                                    }}
                                  />
                                  Processing
                                </span>
                              )}
                              {doc.status === 'extracted' && (
                                <span
                                  className="ingestion-badge--indexed"
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 10,
                                    fontWeight: 500,
                                    background: 'transparent',
                                    border: 'none',
                                  }}
                                >
                                  INDEXED
                                </span>
                              )}
                              {doc.status === 'failed' && (
                                <span
                                  className="ingestion-badge--failed"
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 10,
                                    fontWeight: 500,
                                    background: 'transparent',
                                    border: 'none',
                                  }}
                                >
                                  FAILED
                                </span>
                              )}
                            </div>
                            <button
                              ref={(el) => {
                                docMenuBtnRefs.current[doc.fileName] = el;
                              }}
                              className="btn btn-sm client-panel-row-menu"
                              title="Options"
                              style={{
                                position: 'absolute',
                                right: 10,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                padding: '1px 5px',
                                border: 'none',
                                lineHeight: 1,
                                opacity: isHov || menuOpen ? 1 : 0,
                                pointerEvents: isHov || menuOpen ? 'auto' : 'none',
                                transition: 'opacity 0.15s',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const btn = docMenuBtnRefs.current[doc.fileName];
                                if (!btn) return;
                                const rect = btn.getBoundingClientRect();
                                setMenuDocPos({
                                  top: rect.bottom + 4,
                                  right: window.innerWidth - rect.right,
                                });
                                setMenuDocId(menuOpen ? null : doc.fileName);
                              }}
                            >
                              <Icon icon={MoreHorizontal} size="sm" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <MemorySection key={memoryKey} namespace={name} />
                </>
              )}

              {/* Artifacts tab: microsites + proposals */}
              {activeRightTab === 'artifacts' && (
                <div className="client-panel-list" style={{ paddingTop: 4, paddingLeft: 12, paddingRight: 12 }}>
                  {/* Microsites */}
                  <div className="brief-panel-section-header" style={{ padding: '0 4px 2px' }}>
                    <span
                      style={{
                        flex: 'none',
                        fontSize: 14,
                        fontWeight: 400,
                        color: 'var(--muted)',
                        textTransform: 'none',
                        letterSpacing: 0,
                      }}
                    >
                      Microsites
                    </span>
                  </div>
                  {microsites.length === 0 ? (
                    <div
                      style={{
                        padding: '4px 2px',
                        fontSize: 13,
                        color: 'var(--muted)',
                        opacity: 0.5,
                      }}
                    >
                      {proposals.length === 0 ? 'Create a proposal first' : 'No microsites yet'}
                    </div>
                  ) : (
                    microsites.map((m) => {
                      const isHov = hoveredMicrositeId === m.id;
                      const menuOpen = menuMicrositeId === m.id;
                      return (
                        <div
                          key={m.id}
                          className="client-panel-row"
                          onClick={() => void handleOpenMicrosite(m)}
                          onMouseEnter={() => setHoveredMicrositeId(m.id)}
                          onMouseLeave={() => setHoveredMicrositeId(null)}
                          style={{
                            paddingRight: isHov || menuOpen ? 36 : 10,
                            height: 'auto',
                            paddingTop: 7,
                            paddingBottom: 7,
                            alignItems: 'flex-start',
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 26,
                              height: 26,
                              borderRadius: '50%',
                              background: 'var(--primary-soft, rgba(99,102,241,0.12))',
                              color: 'var(--primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginTop: 1,
                            }}
                          >
                            <Globe size={13} strokeWidth={1.5} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  color: 'var(--text)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {m.title.split(/\s*[-–—]\s*/)[0]}
                              </span>
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: 'var(--primary)',
                                  background: 'var(--primary-soft, rgba(99,102,241,0.12))',
                                  borderRadius: 4,
                                  padding: '1px 5px',
                                  lineHeight: 1.5,
                                }}
                              >
                                v{msVersionMap.get(m.id) ?? 1}
                              </span>
                              {m.pdfPresentation && (
                                <span
                                  title={`PDF Presentation (${m.pdfOrientation === 'portrait' ? '9:16' : '16:9'})`}
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 9,
                                    fontWeight: 700,
                                    color: '#7c6af7',
                                    background: 'rgba(124,106,247,0.12)',
                                    borderRadius: 3,
                                    padding: '1px 4px',
                                    lineHeight: 1.5,
                                    letterSpacing: '0.04em',
                                  }}
                                >
                                  {m.pdfOrientation === 'portrait' ? 'PDF 9:16' : 'PDF 16:9'}
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: 'var(--muted)',
                                marginTop: 2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {meta?.displayName ?? name} ·{' '}
                              {new Date(m.savedAt).toLocaleDateString('en', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                          </div>
                          <button
                            ref={(el) => {
                              msMenuBtnRefs.current[m.id] = el;
                            }}
                            className="btn btn-sm client-panel-row-menu"
                            title="Options"
                            onClick={(e) => {
                              e.stopPropagation();
                              const btn = msMenuBtnRefs.current[m.id];
                              if (!btn) return;
                              const rect = btn.getBoundingClientRect();
                              setMenuMicrositePos({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                              setMenuMicrositeId(menuOpen ? null : m.id);
                            }}
                            style={{ opacity: isHov || menuOpen ? 1 : 0 }}
                          >
                            <Icon icon={MoreHorizontal} size="sm" />
                          </button>
                        </div>
                      );
                    })
                  )}

                  {/* Proposals */}
                  <div className="brief-panel-section-header" style={{ padding: '8px 4px 2px' }}>
                    <span
                      style={{
                        flex: 'none',
                        fontSize: 14,
                        fontWeight: 400,
                        color: 'var(--muted)',
                        textTransform: 'none',
                        letterSpacing: 0,
                      }}
                    >
                      Proposals
                    </span>
                  </div>
                  {proposals.length === 0 ? (
                    <div
                      style={{
                        padding: '4px 2px',
                        fontSize: 13,
                        color: 'var(--muted)',
                        opacity: 0.5,
                      }}
                    >
                      Ask me to generate a proposal in chat.
                    </div>
                  ) : (
                    proposals.map((p) => {
                      const isHov = hoveredProposalId === p.fileName;
                      const menuOpen = menuProposalId === p.fileName;
                      return (
                        <div
                          key={p.fileName}
                          className="client-panel-row"
                          onClick={() => void openProposal(p)}
                          onMouseEnter={() => setHoveredProposalId(p.fileName)}
                          onMouseLeave={() => setHoveredProposalId(null)}
                          style={{
                            paddingRight: isHov || menuOpen ? 36 : 10,
                            height: 'auto',
                            paddingTop: 7,
                            paddingBottom: 7,
                            alignItems: 'flex-start',
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 26,
                              height: 26,
                              borderRadius: '50%',
                              background: 'var(--primary-soft, rgba(99,102,241,0.12))',
                              color: 'var(--primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginTop: 1,
                            }}
                          >
                            <FileText size={13} strokeWidth={1.5} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  color: 'var(--text)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {p.title.split(/\s*[-–—]\s*/)[0]}
                              </span>
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: 'var(--primary)',
                                  background: 'var(--primary-soft, rgba(99,102,241,0.12))',
                                  borderRadius: 4,
                                  padding: '1px 5px',
                                  lineHeight: 1.5,
                                }}
                              >
                                v{propVersionMap.get(p.fileName) ?? 1}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: 'var(--muted)',
                                marginTop: 2,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {meta?.displayName ?? name} ·{' '}
                              {new Date(p.savedAt).toLocaleDateString('en', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                          </div>
                          <button
                            ref={(el) => {
                              propMenuBtnRefs.current[p.fileName] = el;
                            }}
                            className="btn btn-sm client-panel-row-menu"
                            title="Options"
                            onClick={(e) => {
                              e.stopPropagation();
                              const btn = propMenuBtnRefs.current[p.fileName];
                              if (!btn) return;
                              const rect = btn.getBoundingClientRect();
                              setMenuProposalPos({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                              setMenuProposalId(menuOpen ? null : p.fileName);
                            }}
                            style={{ opacity: isHov || menuOpen ? 1 : 0 }}
                          >
                            <Icon icon={MoreHorizontal} size="sm" />
                          </button>
                        </div>
                      );
                    })
                  )}

                  {/* Generated Documents */}
                  <div
                    className="brief-panel-section-header"
                    style={{ padding: "8px 4px 2px" }}
                  >
                    <span
                      style={{
                        flex: "none",
                        fontSize: 14,
                        fontWeight: 400,
                        color: "var(--muted)",
                        textTransform: "none",
                        letterSpacing: 0,
                      }}
                    >
                      Documents
                    </span>
                  </div>
                  {generatedDocs.length === 0 ? (
                    <div
                      style={{
                        padding: "4px 2px",
                        fontSize: 13,
                        color: "var(--muted)",
                        opacity: 0.5,
                      }}
                    >
                      Ask me to write any document — strategy, blog post, press release, report, deck…
                    </div>
                  ) : (
                    generatedDocs.map((doc) => {
                      const isHov = hoveredGenDocId === doc.id;
                      const menuOpen = menuGenDocId === doc.id;
                      const typeLabel = doc.documentType
                        .split("-")
                        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                        .join(" ");
                      return (
                        <div
                          key={doc.id}
                          className="client-panel-row"
                          onClick={() => void openDocument(doc)}
                          onMouseEnter={() => setHoveredGenDocId(doc.id)}
                          onMouseLeave={() => setHoveredGenDocId(null)}
                          style={{
                            paddingRight: isHov || menuOpen ? 36 : 10,
                            height: "auto",
                            paddingTop: 7,
                            paddingBottom: 7,
                            alignItems: "flex-start",
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 26,
                              height: 26,
                              borderRadius: "50%",
                              background: "var(--primary-soft, rgba(99,102,241,0.12))",
                              color: "var(--primary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 1,
                            }}
                          >
                            <FileText size={13} strokeWidth={1.5} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "var(--primary)",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em",
                                }}
                              >
                                {typeLabel}
                              </span>
                              {doc.preferredFormat && doc.preferredFormat !== "md" && (
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    letterSpacing: "0.04em",
                                    background: "var(--primary-soft, rgba(99,102,241,0.12))",
                                    color: "var(--primary)",
                                    borderRadius: 3,
                                    padding: "1px 4px",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  {doc.preferredFormat}
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                color: "var(--text)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {doc.title}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--muted)",
                                marginTop: 2,
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {meta?.displayName ?? name} ·{" "}
                                {new Date(doc.createdAt).toLocaleDateString("en", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </span>
                              {doc.downloadUrl && (
                                <a
                                  href={doc.downloadUrl}
                                  download
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    flexShrink: 0,
                                    color: "var(--primary)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 3,
                                    textDecoration: "none",
                                    fontSize: 11,
                                  }}
                                  title={`Download ${doc.preferredFormat?.toUpperCase()}`}
                                >
                                  <Download size={11} strokeWidth={1.5} />
                                </a>
                              )}
                            </div>
                          </div>
                          <button
                            ref={(el) => {
                              genDocMenuBtnRefs.current[doc.id] = el;
                            }}
                            className="btn btn-sm client-panel-row-menu"
                            title="Options"
                            onClick={(e) => {
                              e.stopPropagation();
                              const btn = genDocMenuBtnRefs.current[doc.id];
                              if (!btn) return;
                              const rect = btn.getBoundingClientRect();
                              setMenuGenDocPos({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                              setMenuGenDocId(menuOpen ? null : doc.id);
                            }}
                            style={{ opacity: isHov || menuOpen ? 1 : 0 }}
                          >
                            <Icon icon={MoreHorizontal} size="sm" />
                          </button>
                        </div>
                      );
                    })
                  )}

                  {/* Presentations */}
                  <div
                    className="brief-panel-section-header"
                    style={{ padding: "8px 4px 2px" }}
                  >
                    <span
                      style={{
                        flex: "none",
                        fontSize: 14,
                        fontWeight: 400,
                        color: "var(--muted)",
                        textTransform: "none",
                        letterSpacing: 0,
                      }}
                    >
                      Presentations
                    </span>
                  </div>
                  {savedSlides.length === 0 ? (
                    <div
                      style={{
                        padding: "4px 2px",
                        fontSize: 13,
                        color: "var(--muted)",
                        opacity: 0.5,
                      }}
                    >
                      Ask me to create a presentation in chat.
                    </div>
                  ) : (
                    savedSlides.map((slide) => {
                      const isHov = hoveredSlideId === slide.id;
                      const menuOpen = menuSlideId === slide.id;
                      return (
                        <div
                          key={slide.id}
                          className="client-panel-row"
                          onClick={() => openSlide(slide)}
                          onMouseEnter={() => setHoveredSlideId(slide.id)}
                          onMouseLeave={() => setHoveredSlideId(null)}
                          style={{
                            paddingRight: isHov || menuOpen ? 36 : 10,
                            height: "auto",
                            paddingTop: 7,
                            paddingBottom: 7,
                            alignItems: "flex-start",
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 26,
                              height: 26,
                              borderRadius: "50%",
                              background: "var(--primary-soft, rgba(99,102,241,0.12))",
                              color: "var(--primary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 1,
                            }}
                          >
                            <Presentation size={13} strokeWidth={1.5} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                color: "var(--text)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {slide.title}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--muted)",
                                marginTop: 2,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {meta?.displayName ?? name} ·{" "}
                              {new Date(slide.savedAt).toLocaleDateString("en", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })}
                              {slide.slideCount > 0 && ` · ${slide.slideCount} slides`}
                            </div>
                          </div>
                          <button
                            ref={(el) => {
                              slideMenuBtnRefs.current[slide.id] = el;
                            }}
                            className="btn btn-sm client-panel-row-menu"
                            title="Options"
                            onClick={(e) => {
                              e.stopPropagation();
                              const btn = slideMenuBtnRefs.current[slide.id];
                              if (!btn) return;
                              const rect = btn.getBoundingClientRect();
                              setMenuSlidePos({
                                top: rect.bottom + 4,
                                right: window.innerWidth - rect.right,
                              });
                              setMenuSlideId(menuOpen ? null : slide.id);
                            }}
                            style={{ opacity: isHov || menuOpen ? 1 : 0 }}
                          >
                            <Icon icon={MoreHorizontal} size="sm" />
                          </button>
                        </div>
                      );
                    })
                  )}

                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel ··· dropdown menus ── */}
      {menuMicrositeId &&
        createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 99998 }} onClick={() => setMenuMicrositeId(null)} />
            <div
              className="card"
              style={{
                position: 'fixed',
                top: menuMicrositePos.top,
                right: menuMicrositePos.right,
                minWidth: 120,
                padding: '4px 0',
                zIndex: 99999,
              }}
            >
              <button
                className="btn btn-sm"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: 0,
                  border: 'none',
                  justifyContent: 'flex-start',
                  padding: '8px 14px',
                  fontSize: 14,
                  color: 'var(--danger)',
                  gap: 8,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const id = menuMicrositeId;
                  setMenuMicrositeId(null);
                  setConfirmDeleteMicrosite(id);
                }}
              >
                <Icon icon={Trash2} size="sm" />
                <span>Delete</span>
              </button>
            </div>
          </>,
          document.body,
        )}
      {menuProposalId &&
        createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 99998 }} onClick={() => setMenuProposalId(null)} />
            <div
              className="card"
              style={{
                position: 'fixed',
                top: menuProposalPos.top,
                right: menuProposalPos.right,
                minWidth: 120,
                padding: '4px 0',
                zIndex: 99999,
              }}
            >
              <button
                className="btn btn-sm"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: 0,
                  border: 'none',
                  justifyContent: 'flex-start',
                  padding: '8px 14px',
                  fontSize: 14,
                  color: 'var(--danger)',
                  gap: 8,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const id = menuProposalId;
                  setMenuProposalId(null);
                  setConfirmDeleteProposal(id);
                }}
              >
                <Icon icon={Trash2} size="sm" />
                <span>Delete</span>
              </button>
            </div>
          </>,
          document.body,
        )}
      {confirmDeleteMicrosite && (
        <ConfirmDialog
          title="Delete microsite"
          message={`Delete "${microsites.find((m) => m.id === confirmDeleteMicrosite)?.title ?? confirmDeleteMicrosite}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await handleDeleteMicrosite(confirmDeleteMicrosite);
            setConfirmDeleteMicrosite(null);
          }}
          onCancel={() => setConfirmDeleteMicrosite(null)}
        />
      )}
      {confirmDeleteProposal && (
        <ConfirmDialog
          title="Delete proposal"
          message={`Delete "${proposals.find((p) => p.fileName === confirmDeleteProposal)?.title ?? confirmDeleteProposal}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await handleDeleteProposal(confirmDeleteProposal);
            setConfirmDeleteProposal(null);
          }}
          onCancel={() => setConfirmDeleteProposal(null)}
        />
      )}
      {confirmDeleteGenDoc && (
        <ConfirmDialog
          title="Delete document"
          message={`Delete "${generatedDocs.find((d) => d.id === confirmDeleteGenDoc)?.title ?? confirmDeleteGenDoc}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await handleDeleteGenDoc(confirmDeleteGenDoc);
            setConfirmDeleteGenDoc(null);
          }}
          onCancel={() => setConfirmDeleteGenDoc(null)}
        />
      )}
      {menuSlideId &&
        createPortal(
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 99998 }}
              onClick={() => setMenuSlideId(null)}
            />
            <div
              className="card"
              style={{
                position: "fixed",
                top: menuSlidePos.top,
                right: menuSlidePos.right,
                minWidth: 120,
                padding: "4px 0",
                zIndex: 99999,
              }}
            >
              <button
                className="btn btn-sm"
                style={{
                  width: "100%",
                  textAlign: "left",
                  borderRadius: 0,
                  border: "none",
                  justifyContent: "flex-start",
                  padding: "8px 14px",
                  fontSize: 14,
                  color: "var(--danger)",
                  gap: 8,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const id = menuSlideId;
                  setMenuSlideId(null);
                  setConfirmDeleteSlide(id);
                }}
              >
                <Icon icon={Trash2} size="sm" />
                <span>Delete</span>
              </button>
            </div>
          </>,
          document.body,
        )}
      {confirmDeleteSlide && (
        <ConfirmDialog
          title="Delete presentation"
          message={`Delete "${savedSlides.find((s) => s.id === confirmDeleteSlide)?.title ?? confirmDeleteSlide}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await handleDeleteSlide(confirmDeleteSlide);
            setConfirmDeleteSlide(null);
          }}
          onCancel={() => setConfirmDeleteSlide(null)}
        />
      )}
      {menuGenDocId &&
        createPortal(
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 99998 }}
              onClick={() => setMenuGenDocId(null)}
            />
            <div
              className="card"
              style={{
                position: "fixed",
                top: menuGenDocPos.top,
                right: menuGenDocPos.right,
                minWidth: 140,
                padding: "4px 0",
                zIndex: 99999,
              }}
            >
              <button
                className="btn btn-sm"
                style={{
                  width: "100%",
                  textAlign: "left",
                  borderRadius: 0,
                  border: "none",
                  justifyContent: "flex-start",
                  padding: "8px 14px",
                  fontSize: 14,
                  color: "var(--danger)",
                  gap: 8,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const id = menuGenDocId;
                  setMenuGenDocId(null);
                  setConfirmDeleteGenDoc(id);
                }}
              >
                <Icon icon={Trash2} size="sm" />
                <span>Delete</span>
              </button>
            </div>
          </>,
          document.body,
        )}
      {menuDocId &&
        createPortal(
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 99998 }} onClick={() => setMenuDocId(null)} />
            <div
              className="card"
              style={{
                position: 'fixed',
                top: menuDocPos.top,
                right: menuDocPos.right,
                minWidth: 140,
                padding: '4px 0',
                zIndex: 99999,
              }}
            >
              <button
                className="btn btn-sm"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: 0,
                  border: 'none',
                  justifyContent: 'flex-start',
                  padding: '8px 14px',
                  fontSize: 14,
                  gap: 8,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const id = menuDocId;
                  setMenuDocId(null);
                  if (id) {
                    const downloadName = docs.find((d) => d.fileName === id)?.originalName ?? id;
                    void openSuperClientDocument(apiKey, name, id, downloadName);
                  }
                }}
              >
                <Icon icon={ExternalLink} size="sm" />
                <span>View</span>
              </button>
              <button
                className="btn btn-sm"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  borderRadius: 0,
                  border: 'none',
                  justifyContent: 'flex-start',
                  padding: '8px 14px',
                  fontSize: 14,
                  color: 'var(--danger)',
                  gap: 8,
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const id = menuDocId;
                  setMenuDocId(null);
                  setConfirmDeleteDoc(id);
                }}
              >
                <Icon icon={Trash2} size="sm" />
                <span>Delete</span>
              </button>
            </div>
          </>,
          document.body,
        )}
      {confirmDeleteDoc && (
        <ConfirmDialog
          title="Delete document"
          message={`Delete "${docs.find((d) => d.fileName === confirmDeleteDoc)?.originalName ?? confirmDeleteDoc}"? This will remove it from the knowledge base and cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            await handleDeleteDoc(confirmDeleteDoc);
            setConfirmDeleteDoc(null);
          }}
          onCancel={() => setConfirmDeleteDoc(null)}
        />
      )}

      {/* Proposal picker — shown when >1 proposals and user clicks Generate Microsite */}
      {showProposalPicker && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 32000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowProposalPicker(false);
          }}
        >
          <div
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--text)',
                  margin: 0,
                }}
              >
                Choose a Proposal
              </p>
              <button
                onClick={() => setShowProposalPicker(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                  display: 'flex',
                }}
              >
                <Icon icon={X} size="md" />
              </button>
            </div>
            <div
              style={{
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {proposals.map((p) => (
                <button
                  key={p.fileName}
                  onClick={() => void handlePickProposal(p)}
                  disabled={loadingMicrositeFor === p.fileName}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 14px',
                    background: 'var(--panel-soft)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--text)',
                      margin: 0,
                    }}
                  >
                    {p.title}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      margin: '2px 0 0',
                    }}
                  >
                    {loadingMicrositeFor === p.fileName ? 'Loading…' : new Date(p.savedAt).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* GenerateV2Modal — reused unchanged */}
      {micrositeModal && (
        <GenerateV2Modal
          apiKey={apiKey}
          namespace={name}
          proposalId={micrositeModal.proposal.fileName.replace(/\.md$/, '')}
          proposalName={micrositeModal.proposal.title}
          proposalMarkdown={micrositeModal.markdown}
          onComplete={async (ast) => {
            // Capture title before clearing modal state
            const proposalTitle = micrositeModal.proposal.title;
            setMicrositeModal(null);
            const tempId = `preview-modal-${Date.now()}`;
            setViewingMicrosite({
              id: tempId,
              ast,
              renderKey: `${tempId}-${Date.now()}`,
            });
            if (viewingProposal) {
              setViewingProposal(null);
              setChangedSections(new Set());
              setUpdateBanner('');
            }
            collapseForPanel();
            setActiveRightTab('artifacts');
            try {
              const saved = await saveSuperClientMicrosite(apiKey, name, ast, proposalTitle);
              setViewingMicrosite((prev) =>
                prev?.id === tempId
                  ? {
                      id: saved.id,
                      ast,
                      renderKey: `${saved.id}-${Date.now()}`,
                    }
                  : prev,
              );
              // Optimistic insert so the artifacts panel lists it immediately
              setMicrosites((prev) => (prev.some((m) => m.id === saved.id) ? prev : [saved, ...prev]));
              loadMicrosites();
              showToast('Microsite generated and saved');
            } catch (err) {
              showToast(`Failed to save microsite: ${(err as Error).message}`, 'error');
            }
          }}
          onClose={() => setMicrositeModal(null)}
        />
      )}

      {/* Microsite publish modal */}
      {showPublishMicrosite && lastMicrositeRef.current && (
        <PublishModal
          ast={lastMicrositeRef.current.ast}
          namespace={name}
          proposalId={viewingMicrosite?.id ?? lastMicrositeRef.current.id}
          onClose={() => setShowPublishMicrosite(false)}
        />
      )}

      {/* Full-screen viewer. The fixed-canvas scaler (injectSlideScaler) renders each
          presentation page at its native size scaled uniformly to fit the viewport
          width — pixel-perfect, no reflow. It owns section sizing/margins, so the old
          margin:auto centering is dropped; body stays display:block. */}
      {fullscreenMicrosite &&
        (() => {
          const rawHtml = buildHtml(fullscreenMicrosite);
          const bodyOpen = rawHtml.search(/<body[^>]*>/i);
          const NAV_FIX = `<style id="__fs-layout-fix__">body{display:block!important;}</style><script>document.addEventListener('click',function(e){var a=e.target.closest('a[href^="#"]');if(!a)return;e.preventDefault();var id=a.getAttribute('href').slice(1);var el=document.getElementById(id)||document.querySelector('[name="'+id+'"]');if(el)el.scrollIntoView({behavior:'smooth'});},true);</script>`;
          const tagEnd = bodyOpen !== -1 ? rawHtml.indexOf('>', bodyOpen) + 1 : -1;
          const fsHtml = injectSlideScaler(tagEnd > 0 ? rawHtml.slice(0, tagEnd) + NAV_FIX + rawHtml.slice(tagEnd) : rawHtml);
          const FS_BAR = 40;
          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 40000, background: '#000', overflow: 'hidden' }}>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: FS_BAR,
                  background: '#0a0a0a',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px',
                  zIndex: 1,
                }}
              >
                <button
                  onClick={() => setFullscreenMicrosite(null)}
                  style={{
                    background: 'none',
                    border: '1px solid #333',
                    color: '#ccc',
                    borderRadius: 6,
                    padding: '4px 12px',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  ← Back
                </button>
              </div>
              <iframe
                srcDoc={fsHtml}
                style={{
                  position: 'absolute',
                  top: FS_BAR,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: '100%',
                  height: `calc(100% - ${FS_BAR}px)`,
                  border: 'none',
                }}
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms allow-modals"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              />
            </div>
          );
        })()}

      {/* Toast notification */}
      {toastMsg && (
        <div
          key={toastMsg.key}
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            padding: '10px 20px',
            borderRadius: 10,
            background: toastMsg.variant === 'error' ? '#ef4444' : '#111',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
            animation: 'scToastIn 0.2s ease',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {toastMsg.text}
        </div>
      )}
    </>
  );
}
