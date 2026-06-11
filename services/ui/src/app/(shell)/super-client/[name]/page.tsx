"use client";

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import {
  ExternalLink,
  ArrowUp,
  X,
  CheckCircle,
  Loader,
  Sparkles,
  Globe,
  FileText,
  ImagePlus,
  MoreHorizontal,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Plus,
  Pencil,
  Link2 as LinkIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/lib/auth-context";
import { useSidebar } from "@/lib/sidebar-store";
import { MemorySection, ClientProfileFields } from "@/components/chat/MemorySection";
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
  normalizeMicrositeHtml,
  buildInstruction,
} from "@/lib/microsite-bridge";
import { generationStore, type Generation } from "@/lib/generation-store";
import { uploadStore, type UploadEntry } from "@/lib/upload-store";
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
  generateMicrositeV2Stream,
  type SuperClientMeta,
  type SuperClientHistoryEntry,
  type SuperClientChatEvent,
  type SuperClientFile,
  type SuperClientProposal,
  type SuperClientMicrosite,
} from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  generationId?: string;
  uploadId?: string;
  createdAt?: string;
  editContext?: "microsite" | "proposal";
}

function genId() {
  return Math.random().toString(36).slice(2);
}

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
  if (!gen) return null;
  const isMicrosite = gen.type === "microsite";
  const isGenerating = gen.phase === "generating";
  const isComplete = gen.phase === "complete";
  // Progress 0–92% while generating (charCount-driven), snaps to 100 on complete.
  // Assumes a typical microsite is ~32k HTML chars.
  const progressPct = isComplete
    ? 100
    : Math.min(((gen.charCount ?? 0) / 32000) * 100, 92);
  return (
    <div
      onClick={isComplete ? () => onView(gen) : undefined}
      style={{
        position: "relative",
        borderRadius: 12,
        background: "var(--panel)",
        overflow: "hidden",
        maxWidth: 280,
        cursor: isComplete ? "pointer" : "default",
      }}
    >
      {/* Check icon — top right when complete */}
      {isComplete && (
        <span style={{ position: "absolute", top: 9, right: 10 }}>
          <CheckCircle size={13} style={{ color: "#22c55e", display: "block" }} />
        </span>
      )}

      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 6,
          padding: "7px 44px 7px 10px",
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
          {isMicrosite ? (
            <Globe size={13} strokeWidth={1.5} />
          ) : (
            <FileText size={13} strokeWidth={1.5} />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              paddingRight: 4,
            }}
          >
            {gen.title.split(/\s*[-–—]\s*/)[0]}
          </span>
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
            {gen.clientSlug} · {isMicrosite ? "Microsite" : "Proposal"}
          </div>
        </div>
      </div>

      {/* Loader — absolute top-right while generating */}
      {isGenerating && (
        <span style={{ position: "absolute", top: 9, right: 10 }}>
          <Loader size={13} style={{ color: "var(--primary)", animation: "spin 1s linear infinite", display: "block" }} />
        </span>
      )}

      {/* Progress bar — microsite only while generating */}
      {isGenerating && isMicrosite && (
        <div style={{ padding: "0 10px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
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
            <span style={{ fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              {Math.round(progressPct)}%
            </span>
          </div>
        </div>
      )}
      {/* Steps — hide once complete */}
      {gen.steps.length > 0 && isGenerating && (
        <div style={{ padding: "0 10px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
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
                  <span className="status-glyph" style={{ width: 6, height: 6, flexShrink: 0 }} />
                ) : (
                  <span style={{ color: "#22c55e", fontSize: 9, flexShrink: 0 }}>✓</span>
                )}
                <span style={{ flex: 1 }}>{step}</span>
              </div>
            );
          })}
        </div>
      )}
      {gen.phase === "error" && (
        <div style={{ padding: "0 10px 12px", fontSize: 11, color: "var(--danger)" }}>
          {gen.error ?? "Generation failed"}
        </div>
      )}
    </div>
  );
}

// UploadMessageCard — upload progress card rendered in the chat thread (user side).
// Subscribes directly to uploadStore for XHR progress, and reads live doc status
// from `docs` (polled by the right panel) to show a rich sequential step visualization.
const SC_PROCESSING_STEPS = [
  { label: "Reading document" },
  { label: "Extracting information" },
  { label: "Building search index" },
] as const;

function UploadMessageCard({
  uploadId,
  docs,
}: {
  uploadId: string;
  docs: SuperClientFile[];
}) {
  const [entry, setEntry] = useState<UploadEntry | undefined>(() =>
    uploadStore.get(uploadId),
  );
  useEffect(
    () =>
      uploadStore.subscribe((all) =>
        setEntry(all.find((u) => u.id === uploadId)),
      ),
    [uploadId],
  );

  // Advance through processing steps on a timer to show believable progress
  const [processingStep, setProcessingStep] = useState(0);
  const isProcessingState =
    entry && entry.status !== "uploading" && entry.status !== "failed";
  const docForEntry = entry
    ? docs.find((d) => d.fileName === entry.fileName)
    : undefined;
  const isProcessing =
    isProcessingState && (!docForEntry || docForEntry.status === "processing");

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

  const isUploading = entry.status === "uploading";
  const isFailed = entry.status === "failed";
  const doc = !isUploading
    ? docs.find((d) => d.fileName === entry.fileName)
    : undefined;
  const docStatus = doc?.status;
  const isDone = !isUploading && !isFailed && docStatus === "extracted";
  const isDocFailed = !isUploading && !isFailed && docStatus === "failed";

  // ── Done: collapsed pill ────────────────────────────────────────
  if (isDone) {
    return (
      <div className="chat-file-upload chat-file-upload--done">
        <FileText
          size={14}
          strokeWidth={1.5}
          style={{ flexShrink: 0, color: "var(--primary)" }}
        />
        <span className="chat-file-upload__name chat-file-upload__name--inline">
          {entry.fileName}
        </span>
        <CheckCircle
          size={14}
          strokeWidth={2}
          className="chat-file-upload__check-icon"
        />
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────
  if (isFailed || isDocFailed) {
    const msg = isFailed
      ? (entry.error ?? "Upload failed")
      : "Extraction failed";
    const label = msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <FileText
            size={14}
            strokeWidth={1.5}
            style={{ flexShrink: 0, color: "var(--muted)" }}
          />
          <span className="chat-file-upload__name">{entry.fileName}</span>
        </div>
        <div className="chat-file-upload__track">
          <div
            className="chat-file-upload__fill chat-file-upload__fill--error"
            style={{ width: "100%" }}
          />
        </div>
        <div className="chat-file-upload__status chat-file-upload__status--error">
          {label}
        </div>
      </div>
    );
  }

  // ── Uploading: progress bar + pending steps ─────────────────────
  if (isUploading) {
    const pct = entry.pct ?? 0;
    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <FileText
            size={14}
            strokeWidth={1.5}
            style={{ flexShrink: 0, color: "var(--primary)" }}
          />
          <span className="chat-file-upload__name">{entry.fileName}</span>
        </div>
        <div className="chat-file-upload__track">
          <div
            className="chat-file-upload__fill"
            style={{ width: `${Math.max(pct, 4)}%` }}
          />
        </div>
        <div className="chat-file-upload__steps">
          <div className="chat-file-upload__step chat-file-upload__step--active">
            <span className="chat-file-upload__step-icon">
              <span className="chat-file-upload__step-spinner" />
            </span>
            <span>Uploading{pct > 0 && pct < 100 ? ` ${pct}%` : "…"}</span>
          </div>
          {SC_PROCESSING_STEPS.map((step) => (
            <div
              key={step.label}
              className="chat-file-upload__step chat-file-upload__step--pending"
            >
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
        <FileText
          size={14}
          strokeWidth={1.5}
          style={{ flexShrink: 0, color: "var(--primary)" }}
        />
        <span className="chat-file-upload__name">{entry.fileName}</span>
      </div>
      <div className="chat-file-upload__steps">
        <div className="chat-file-upload__step chat-file-upload__step--done">
          <span className="chat-file-upload__step-icon">
            <CheckCircle
              size={12}
              strokeWidth={2}
              className="chat-file-upload__step-check"
            />
          </span>
          <span>Uploaded</span>
        </div>
        {SC_PROCESSING_STEPS.map((step, idx) => {
          const isDoneStep = idx < processingStep;
          const isActiveStep = idx === processingStep;
          return (
            <div
              key={step.label}
              className={`chat-file-upload__step${isDoneStep ? " chat-file-upload__step--done" : isActiveStep ? " chat-file-upload__step--active" : " chat-file-upload__step--pending"}`}
            >
              <span className="chat-file-upload__step-icon">
                {isDoneStep ? (
                  <CheckCircle
                    size={12}
                    strokeWidth={2}
                    className="chat-file-upload__step-check"
                  />
                ) : isActiveStep ? (
                  <span className="chat-file-upload__step-spinner" />
                ) : (
                  <span className="chat-file-upload__step-dot-pending" />
                )}
              </span>
              <span>
                {step.label}
                {isActiveStep ? "…" : ""}
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
  const {
    collapsed: sidebarCollapsed,
    collapse: collapseSidebar,
    expand: expandSidebar,
  } = useSidebar();
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
  const [contextMd, setContextMd] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memoryKey, setMemoryKey] = useState(0);
  const [error, setError] = useState("");

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

  const [microsites, setMicrosites] = useState<SuperClientMicrosite[]>([]);
  const [viewingMicrosite, setViewingMicrosite] = useState<{
    id: string;
    ast: LayoutAST;
    renderKey: string;
  } | null>(null);
  const [fullscreenMicrosite, setFullscreenMicrosite] =
    useState<LayoutAST | null>(null);
  const [chatPanelWidth, setChatPanelWidth] = useState(344);
  const [micrositeDragging, setMicrositeDragging] = useState(false);
  const [micrositeDragHover, setMicrositeDragHover] = useState(false);
  const micrositeDragRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const iframeContainerRef = useRef<HTMLDivElement>(null);
  const [iframeContainerH, setIframeContainerH] = useState(0);
  const [iframeContainerW, setIframeContainerW] = useState(0);
  const MICROSITE_MIN_WIDTH = 500;
  const CHAT_MIN_WIDTH = 360;

  // Track iframe container dimensions so InlineEditPanel can flip above/below and clamp horizontally
  useEffect(() => {
    const el = iframeContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setIframeContainerH(el.offsetHeight);
      setIframeContainerW(el.offsetWidth);
    });
    ro.observe(el);
    setIframeContainerH(el.offsetHeight);
    setIframeContainerW(el.offsetWidth);
    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clamp chatPanelWidth whenever the container resizes (e.g. left nav opens/closes)
  useEffect(() => {
    const el = splitContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const containerWidth = splitContainerRef.current?.offsetWidth ?? 0;
      if (containerWidth === 0) return;
      const maxChatWidth = Math.max(
        CHAT_MIN_WIDTH,
        containerWidth - MICROSITE_MIN_WIDTH,
      );
      setChatPanelWidth((prev) => Math.min(prev, maxChatWidth));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache last-seen content so panels render content during close animation (prevents content flash)
  const lastMicrositeRef = useRef(viewingMicrosite);
  if (viewingMicrosite) lastMicrositeRef.current = viewingMicrosite;
  const lastProposalRef = useRef(viewingProposal);
  if (viewingProposal) lastProposalRef.current = viewingProposal;
  const [micrositeModal, setMicrositeModal] = useState<{
    proposal: SuperClientProposal;
    markdown: string;
  } | null>(null);
  const [showProposalPicker, setShowProposalPicker] = useState(false);
  const [loadingMicrositeFor, setLoadingMicrositeFor] = useState<string | null>(
    null,
  );
  const [micrositeEditInput, setMicrositeEditInput] = useState("");
  const [micrositeEditing, setMicrositeEditing] = useState(false);
  const [micrositeEditBanner, setMicrositeEditBanner] = useState("");
  // ── Multi-level undo/redo history ────────────────────────────────────────
  const MAX_HISTORY = 50;
  const [editHistory, setEditHistory] = useState<string[]>([]);
  const [editHistoryIndex, setEditHistoryIndex] = useState(-1);
  const [savedHistoryIndex, setSavedHistoryIndex] = useState(-1);
  // Derived flags — no extra state needed
  const canUndo = editHistoryIndex > 0;
  const canRedo = editHistoryIndex < editHistory.length - 1;
  const hasUnsavedChanges =
    editHistory.length > 0 && editHistoryIndex !== savedHistoryIndex;
  const [editModeActive, setEditModeActive] = useState(false);
  const [micrositeStripVisible, setMicrositeStripVisible] = useState(true);
  const [proposalStripVisible, setProposalStripVisible] = useState(true);
  // Double-buffer: two stacked iframes. Edits load into the invisible background
  // slot; when it signals ready the slots swap instantly — no white flash.
  const iframeARef = useRef<HTMLIFrameElement>(null);
  const iframeBRef = useRef<HTMLIFrameElement>(null);
  const activeSlotRef = useRef<"A" | "B">("A");
  const swapPendingRef = useRef(false);
  const swapSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [iframeSrcDocA, setIframeSrcDocA] = useState("");
  const [iframeSrcDocB, setIframeSrcDocB] = useState("");
  const [activeSlot, setActiveSlot] = useState<"A" | "B">("A");
  // Helpers that always operate on the current active/background slot.
  const getActiveIframe = () =>
    activeSlotRef.current === "A" ? iframeARef.current : iframeBRef.current;
  const setActiveSrcDoc = (srcDoc: string) => {
    if (activeSlotRef.current === "A") setIframeSrcDocA(srcDoc);
    else setIframeSrcDocB(srcDoc);
  };
  const setBackSrcDoc = (srcDoc: string) => {
    if (activeSlotRef.current === "A") setIframeSrcDocB(srcDoc);
    else setIframeSrcDocA(srcDoc);
  };
  const [hoveredElement, setHoveredElement] = useState<BridgeMessage | null>(
    null,
  );
  const [selectedElement, setSelectedElement] = useState<BridgeMessage | null>(
    null,
  );

  // Tell the iframe bridge to clear its internal selectedEl + cancel RAF loop,
  // then clear parent state. Prevents the tracking loop from re-opening the panel.
  const clearBridgeSelection = () => {
    getActiveIframe()?.contentWindow?.postMessage(
      { source: "microsite-host", type: "deselect" },
      "*",
    );
    setSelectedElement(null);
    setHoveredElement(null);
  };

  // ── History helpers ───────────────────────────────────────────────────────
  // Push a new HTML snapshot onto the stack. Any forward history is discarded
  // (same behaviour as every text editor: a new edit after undo clears redo).
  function pushHistory(html: string) {
    setEditHistory((prev) => {
      const base = prev.slice(0, editHistoryIndex + 1);
      const next = [...base, html];
      return next.length > MAX_HISTORY
        ? next.slice(next.length - MAX_HISTORY)
        : next;
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
      const candidates: Element[] = Array.from(
        scope.querySelectorAll(selector),
      ).filter(
        (el): el is Element =>
          (!id || (el as Element).id === id) &&
          (!cls || (el as Element).classList.contains(cls)),
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
      const doc = new DOMParser().parseFromString(updatedHtml, "text/html");
      const el = findElByPath(doc, selectedElement.path);
      if (el) {
        setSelectedElement({
          ...selectedElement,
          outerHtml: el.outerHTML.slice(0, 8192),
          text: (el.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120),
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
  const [editingLogoUrl, setEditingLogoUrl] = useState("");
  const [showEditingLogoUrlInput, setShowEditingLogoUrlInput] = useState(false);
  const editingLogoInputRef = useRef<HTMLInputElement | null>(null);
  const [hoveredMicrositeId, setHoveredMicrositeId] = useState<string | null>(
    null,
  );
  const [hoveredProposalId, setHoveredProposalId] = useState<string | null>(
    null,
  );
  const [hoveredDocId, setHoveredDocId] = useState<string | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<"context" | "artifacts">(
    "context",
  );

  const [urlEditMode, setUrlEditMode] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState("");
  const [enrichConfirmPending, setEnrichConfirmPending] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
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
  const [confirmDeleteMicrosite, setConfirmDeleteMicrosite] = useState<
    string | null
  >(null);
  const [showPublishMicrosite, setShowPublishMicrosite] = useState(false);
  const [confirmDeleteProposal, setConfirmDeleteProposal] = useState<
    string | null
  >(null);
  const msMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const propMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const docMenuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [generations, setGenerations] = useState<Generation[]>([]);
  const localGenIdsRef = useRef<Set<string>>(new Set());
  const [changedSections, setChangedSections] = useState<Set<string>>(
    new Set(),
  );
  const [updateBanner, setUpdateBanner] = useState("");

  const [composerStage, setComposerStage] = useState<
    null | "select-proposal" | "configure"
  >(null);
  const [composerProposal, setComposerProposal] = useState<{
    proposal: SuperClientProposal;
    markdown: string;
  } | null>(null);
  const [composerInstructions, setComposerInstructions] = useState("");
  const [composerImage, setComposerImage] = useState<{
    base64: string;
    mediaType: string;
  } | null>(null);
  const [composerLogo, setComposerLogo] = useState<{
    base64: string;
    mediaType: string;
  } | null>(null);
  const [composerLogoUrl, setComposerLogoUrl] = useState("");
  const [showLogoUrlInput, setShowLogoUrlInput] = useState(false);
  const [composerMessage, setComposerMessage] = useState("");
  const composerImageInputRef = useRef<HTMLInputElement | null>(null);
  const composerLogoInputRef = useRef<HTMLInputElement | null>(null);

  const [toastMsg, setToastMsg] = useState<{
    text: string;
    variant: "default" | "error";
    key: number;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(text: string, variant: "default" | "error" = "default") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg({ text, variant, key: Date.now() });
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3500);
  }

  async function handleEnrichUrl() {
    if (!urlInput.trim() || !name || !apiKey) return;
    setEnriching(true);
    setEnrichError("");
    try {
      const result = await enrichSuperClientUrl(apiKey, name, urlInput.trim());
      setMeta(result.meta);
      setContextMd(result.contextMd);
      setMemoryKey((k) => k + 1);
      setUrlEditMode(false);
      setUrlInput("");
      showToast("Client context updated from website");
    } catch (err) {
      setEnrichError(
        err instanceof Error ? err.message : "Failed to fetch context",
      );
    } finally {
      setEnriching(false);
    }
  }

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Sync generation store → local state (runs even when component is unmounted via subscription)
  useEffect(() => generationStore.subscribe(setGenerations), []);

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    Promise.all([
      getSuperClient(apiKey, name),
      getSuperClientGenerations(apiKey, name),
    ])
      .then(([{ meta: m, contextMd: ctx, history }, serverGens]) => {
        setMeta(m);
        setContextMd(ctx);
        // Hydrate store with server-persisted generations before building messages
        generationStore.hydrateFromServer(
          serverGens.map((g) => ({ ...g, createdAt: g.createdAt ?? "" })),
        );
        const historyMsgs: Message[] = history.map(
          (h: SuperClientHistoryEntry) => ({
            id: genId(),
            role: h.role,
            content: h.content,
            createdAt: h.createdAt,
            ...(h.editContext ? { editContext: h.editContext } : {}),
          }),
        );
        // Fallback: infer editContext from content for messages saved before this field existed.
        // If an assistant message looks like a microsite edit confirmation, tag it and the
        // preceding user message retroactively.
        for (let i = 0; i < historyMsgs.length; i++) {
          const msg = historyMsgs[i];
          if (msg.role === "assistant" && !msg.editContext) {
            const isMicrositeResult =
              msg.content.startsWith("Done! Updated") ||
              msg.content.startsWith("Edit failed:");
            if (isMicrositeResult) {
              msg.editContext = "microsite";
              const prev = historyMsgs[i - 1];
              if (prev && prev.role === "user" && !prev.editContext) {
                prev.editContext = "microsite";
              }
            }
          }
        }
        // Re-inject capsule messages for any active/complete generations for this client
        const activeGens = generationStore.forClient(name);
        const genMsgs: Message[] = activeGens.map((gen) => ({
          id: `gen-msg-${gen.id}`,
          role: "assistant" as const,
          content: "",
          generationId: gen.id,
          createdAt: gen.createdAt,
        }));
        // Re-inject upload cards for any active/recent uploads for this client
        const activeUploads = uploadStore.forClient(name);
        const uploadMsgs: Message[] = activeUploads.map((u) => ({
          id: `upload-msg-${u.id}`,
          role: "user" as const,
          content: "",
          uploadId: u.id,
          createdAt: new Date(u.addedAt).toISOString(),
        }));
        // Merge and sort chronologically so generation/upload cards land in the right position
        const allMsgs = [...historyMsgs, ...uploadMsgs, ...genMsgs].sort(
          (a, b) => {
            if (!a.createdAt && !b.createdAt) return 0;
            if (!a.createdAt) return 1;
            if (!b.createdAt) return -1;
            return (
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          },
        );
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
        if (gen.phase === "complete" || gen.phase === "error") {
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

  // Poll the server for any 'generating' entries that were loaded from another tab/browser.
  // Stops as soon as there are none left.
  useEffect(() => {
    if (!name) return;
    const remoteGenerating = generations.filter(
      (g) =>
        g.clientSlug === name &&
        g.phase === "generating" &&
        !localGenIdsRef.current.has(g.id),
    );
    if (remoteGenerating.length === 0) return;
    const intervalId = setInterval(async () => {
      try {
        const serverGens = await getSuperClientGenerations(apiKey, name);
        generationStore.refreshFromServer(
          serverGens.map((g) => ({ ...g, createdAt: g.createdAt ?? "" })),
        );
      } catch {
        /* ignore */
      }
    }, 4000);
    return () => clearInterval(intervalId);
  }, [generations, apiKey, name]);

  useEffect(() => {
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

  useEffect(() => {
    loadDocs();
    loadProposals();
    loadMicrosites();
  }, [loadDocs, loadProposals, loadMicrosites]);

  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === "processing");
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

  // When a document transitions from processing → extracted, add an assistant summary message
  const prevDocsRef = useRef<SuperClientFile[]>([]);
  useEffect(() => {
    const prev = prevDocsRef.current;
    prevDocsRef.current = docs;
    const justExtracted = docs.filter(
      (d) =>
        d.status === "extracted" &&
        prev.find((p) => p.fileName === d.fileName)?.status === "processing" &&
        !summarizedDocsRef.current.has(d.fileName),
    );
    if (justExtracted.length === 0) return;
    for (const d of justExtracted) summarizedDocsRef.current.add(d.fileName);
    const names = justExtracted.map((d) => d.fileName);
    const label =
      names.length === 1
        ? `**${names[0]}**`
        : `**${names[0]}** and ${names.length - 1} other file${names.length > 2 ? "s" : ""}`;
    setMessages((prev) => [
      ...prev,
      {
        id: genId(),
        role: "assistant",
        content: `${label} has been indexed and added to the knowledge base. Ask me anything about it, or say "generate proposal" to create one based on this context.`,
      },
    ]);
  }, [docs]);

  // Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo for microsite editor
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          handleMicrositeRevert(); // instant, not async
        }
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        if (canRedo) {
          e.preventDefault();
          handleMicrositeRedo(); // instant, not async
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo]);

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
    if (!editModeActive) return;
    function onMessage(e: MessageEvent) {
      const msg = e.data as BridgeMessage;
      if (!msg || msg.source !== "microsite-bridge") return;
      if (msg.type === "hover") setHoveredElement(msg);
      else if (msg.type === "leave") setHoveredElement(null);
      else if (msg.type === "track-update" && msg.rect) {
        setSelectedElement(prev => prev ? { ...prev, rect: msg.rect } : prev);
        setHoveredElement(prev => prev ? { ...prev, rect: msg.rect } : prev);
      }
      else if (msg.type === "select") setSelectedElement(msg);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [editModeActive]);

  // Background iframe signals when it has loaded and set scroll — swap slots instantly.
  useEffect(() => {
    function onSwapReady(e: MessageEvent) {
      if (e.data?.source !== "microsite-swap-ready" || !swapPendingRef.current)
        return;
      if (swapSafetyTimerRef.current) {
        clearTimeout(swapSafetyTimerRef.current);
        swapSafetyTimerRef.current = null;
      }
      swapPendingRef.current = false;
      const next: "A" | "B" = activeSlotRef.current === "A" ? "B" : "A";
      activeSlotRef.current = next;
      setActiveSlot(next);
    }
    window.addEventListener("message", onSwapReady);
    return () => window.removeEventListener("message", onSwapReady);
  }, []);

  async function handleFileUpload(file: File) {
    if (uploading || !name) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const added = await uploadSuperClientDocument(
        apiKey,
        name,
        file,
        setUploadPct,
      );
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
      console.error("Upload failed", err);
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
        role: "user",
        content: "",
        uploadId,
        createdAt: new Date().toISOString(),
      },
    ]);
    scrollToBottom();
    try {
      const added = await uploadSuperClientDocument(apiKey, name, file, (pct) =>
        uploadStore.progress(uploadId, pct),
      );
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
      uploadStore.fail(uploadId, (err as Error).message ?? "Upload failed");
      console.error("Composer upload failed", err);
    }
  }

  async function handleDeleteDoc(fileName: string) {
    if (!name) return;
    try {
      await deleteSuperClientDocument(apiKey, name, fileName);
      setDocs((prev) => prev.filter((d) => d.fileName !== fileName));
      setMemoryKey((k) => k + 1);
    } catch (err) {
      console.error("Delete failed", err);
    }
  }

  async function openProposal(proposal: SuperClientProposal) {
    if (!name) return;
    setChangedSections(new Set());
    setUpdateBanner("");
    setViewingProposal({
      fileName: proposal.fileName,
      title: proposal.title,
      content: "",
    });
    setViewingMicrosite(null);
    collapseForPanel();
    try {
      const content = await getSuperClientProposal(
        apiKey,
        name,
        proposal.fileName,
      );
      setViewingProposal({
        fileName: proposal.fileName,
        title: proposal.title,
        content,
      });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("404")) {
        setViewingProposal(null);
        setProposals((prev) =>
          prev.filter((p) => p.fileName !== proposal.fileName),
        );
        showToast("This proposal no longer exists", "error");
      } else {
        setViewingProposal(null);
        showToast(`Failed to load proposal: ${msg}`, "error");
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
        setUpdateBanner("");
      }
    } catch (err) {
      console.error("Delete proposal failed", err);
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
        const msg = (err as Error).message ?? "";
        if (msg.includes("404")) {
          setProposals((prev) =>
            prev.filter((pr) => pr.fileName !== p.fileName),
          );
          showToast("This proposal no longer exists", "error");
        } else {
          showToast(`Failed to load proposal: ${msg}`, "error");
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
      const msg = (err as Error).message ?? "";
      if (msg.includes("404")) {
        setProposals((prev) => prev.filter((pr) => pr.fileName !== p.fileName));
        showToast("This proposal no longer exists", "error");
      } else {
        showToast(`Failed to load proposal: ${msg}`, "error");
      }
    } finally {
      setLoadingMicrositeFor(null);
    }
  }

  async function handleOpenMicrosite(m: SuperClientMicrosite) {
    if (!name) return;
    try {
      const ast = await getSuperClientMicrosite(apiKey, name, m.id);
      const html =
        (ast.sections?.[0] as { customHtml?: string })?.customHtml ?? "";
      const rk = `${m.id}-${Date.now()}`;
      const srcDoc = computeSrcDoc(html);

      if (viewingMicrosite) {
        // Panel already open — load into background slot and swap once rendered
        // to avoid the visible blank-then-reload flash on the active iframe.
        const swapScript = `<script>(function(){requestAnimationFrame(function(){window.parent.postMessage({source:'microsite-swap-ready'},'*');});})();<\/script>`;
        const bodyClose = srcDoc.lastIndexOf("</body>");
        const srcDocWithSwap =
          bodyClose !== -1
            ? srcDoc.slice(0, bodyClose) + swapScript + srcDoc.slice(bodyClose)
            : srcDoc + swapScript;

        swapPendingRef.current = true;
        if (swapSafetyTimerRef.current)
          clearTimeout(swapSafetyTimerRef.current);
        swapSafetyTimerRef.current = setTimeout(() => {
          swapSafetyTimerRef.current = null;
          if (!swapPendingRef.current) return;
          swapPendingRef.current = false;
          const next: "A" | "B" = activeSlotRef.current === "A" ? "B" : "A";
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
        setUpdateBanner("");
      }
      collapseForPanel();
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (msg.includes("404")) {
        setMicrosites((prev) => prev.filter((ms) => ms.id !== m.id));
        showToast("This microsite no longer exists", "error");
      } else {
        showToast(`Failed to load microsite: ${msg}`, "error");
      }
    }
  }

  async function handleDeleteMicrosite(id: string) {
    if (!name) return;
    try {
      await deleteSuperClientMicrosite(apiKey, name, id);
      setMicrosites((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error("Delete microsite failed", err);
    }
  }

  function computeSrcDoc(html: string, forEditMode = editModeActive): string {
    const normalized = normalizeMicrositeHtml(html);
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
    const bodyClose = srcDoc.lastIndexOf("</body>");
    srcDoc =
      bodyClose !== -1
        ? srcDoc.slice(0, bodyClose) + script + srcDoc.slice(bodyClose)
        : srcDoc + script;
    // Mark swap pending; cancel any previous safety timer
    swapPendingRef.current = true;
    if (swapSafetyTimerRef.current) clearTimeout(swapSafetyTimerRef.current);
    swapSafetyTimerRef.current = setTimeout(() => {
      swapSafetyTimerRef.current = null;
      if (!swapPendingRef.current) return;
      swapPendingRef.current = false;
      const next: "A" | "B" = activeSlotRef.current === "A" ? "B" : "A";
      activeSlotRef.current = next;
      setActiveSlot(next);
    }, 2000);
    setBackSrcDoc(srcDoc);
  }

  async function handleMicrositeEdit() {
    const hasText = micrositeEditInput.trim().length > 0;
    const activeLogo:
      | { base64: string; mediaType: string }
      | { url: string }
      | null =
      editingLogo ??
      (editingLogoUrl.trim() ? { url: editingLogoUrl.trim() } : null);
    if (!viewingMicrosite || (!hasText && !activeLogo) || micrositeEditing)
      return;

    let instruction = buildInstruction(
      selectedElement,
      micrositeEditInput.trim(),
    );
    // URL-based deterministic bypass: detect image or video URL in the instruction
    const _urlMatch = micrositeEditInput.trim().match(/https?:\/\/\S+/);
    if (_urlMatch) {
      const url = _urlMatch[0];
      const isVideo = /youtube\.com|youtu\.be|vimeo\.com/i.test(url);
      const isLogoIntent = /\blogo\b/i.test(micrositeEditInput);

      if (!isVideo) {
        const isBgIntent = /\b(?:background|bg)\b/i.test(micrositeEditInput);
        const isReplaceIntent =
          /\b(?:replace|swap|change|update|use this as|set as)\b/i.test(
            micrositeEditInput,
          );
        const selectedTag = selectedElement?.tag?.toLowerCase() ?? "";

        // Container elevated from an <img> click: outerHtml contains <img src>.
        // __BG_IMAGE_PATCH__ would set a CSS background-image that's invisible
        // because the real <img> element sits on top. Use __IMAGE_INJECT_SCOPED__
        // instead — it finds and replaces the <img src> inside the container.
        const hasWrappedImg = selectedTag !== "img" &&
          /<img\b/i.test(selectedElement?.outerHtml ?? "");

        if (selectedElement?.path && isBgIntent && selectedTag !== "img" && !hasWrappedImg) {
          // "add/set/change background image on a section/div" with no img child
          // Use __BG_IMAGE_PATCH__ which sets background-image in the inline style.
          instruction = `__BG_IMAGE_PATCH__:${selectedElement.path}||${url}`;
        } else if (
          selectedElement?.path &&
          (selectedTag === "img" || isReplaceIntent || hasWrappedImg)
        ) {
          // Explicit replacement, <img> selected, or container with wrapped img
          // → scoped src/attr replacement via __IMAGE_INJECT_SCOPED__.
          const hintSnippet = selectedElement.outerHtml?.slice(0, 300) ?? "";
          instruction = `__IMAGE_INJECT_SCOPED__:${selectedElement.path}||${url}||${hintSnippet}`;
        } else if (selectedElement?.path) {
          // All other element+URL combos (add below, insert right, add inside, etc.)
          // → let __ELEMENT_EDIT__ flow to LLM for structural insertion.
        } else if (isLogoIntent) {
          // "replace logo with [url]" without element selected → targeted logo replacement
          instruction = `__LOGO_REPLACE__:${url}`;
        } else {
          // Generic image URL, no element → global replacement
          instruction = `__IMAGE_INJECT__:${url}`;
        }
      }
      // Video URL: server's Vimeo/YouTube detection fires on any matching URL.
    }
    // Snapshot label for chat messages before clearing input
    const editLabel = micrositeEditInput.trim();
    const micrositeTitle =
      microsites.find((m) => m.id === viewingMicrosite.id)?.title ??
      "Microsite";
    const now = new Date().toISOString();
    const userMsgId = genId();
    const assistantMsgId = genId();

    // Save user instruction to chat immediately
    const userContent =
      activeLogo && !hasText
        ? `Updated logo on **${micrositeTitle}**`
        : `${editLabel}`;
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: "user",
        content: userContent,
        createdAt: now,
        editContext: "microsite" as const,
      },
    ]);

    setMicrositeEditing(true);
    setMicrositeEditBanner("");
    try {
      let finalHtml: string;
      let editSummary: string = '';

      if (hasText && activeLogo) {
        // Text edit first, then inject logo via deterministic server bypass
        const { summary: s1 } = await editSuperClientMicrosite(
          apiKey,
          name,
          viewingMicrosite.id,
          instruction,
        );
        editSummary = s1;
        const logoSrc =
          "url" in activeLogo
            ? activeLogo.url
            : `data:${activeLogo.mediaType};base64,${activeLogo.base64}`;
        const { html } = await editSuperClientMicrosite(
          apiKey,
          name,
          viewingMicrosite.id,
          `__LOGO_INJECT__:${logoSrc}`,
        );
        finalHtml = html;
      } else if (hasText) {
        // Text edit only
        const { html, summary: s } = await editSuperClientMicrosite(
          apiKey,
          name,
          viewingMicrosite.id,
          instruction,
        );
        finalHtml = html;
        editSummary = s;
      } else {
        // Logo-only: deterministic server-side injection, no LLM
        const logoSrc =
          "url" in activeLogo!
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

      setMicrositeEditInput("");
      setEditingLogo(null);
      setEditingLogoUrl("");
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
      setMicrositeEditBanner("Microsite updated");
      setTimeout(() => setMicrositeEditBanner(""), 4000);

      // Save assistant confirmation to chat
      const successAt = new Date().toISOString();
      const successContent = editSummary || `Updated microsite`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: successContent,
          createdAt: successAt,
          editContext: "microsite" as const,
        },
      ]);
      void appendSuperClientHistory(apiKey, name, [
        {
          role: "user",
          content: userContent,
          createdAt: now,
          editContext: "microsite",
        },
        {
          role: "assistant",
          content: successContent,
          createdAt: successAt,
          editContext: "microsite",
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      setMicrositeEditBanner(`Error: ${msg}`);
      setTimeout(() => setMicrositeEditBanner(""), 8000);

      // Save error response to chat
      const errorAt = new Date().toISOString();
      const errorContent = `Edit failed: ${msg}`;
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: errorContent,
          createdAt: errorAt,
          editContext: "microsite" as const,
        },
      ]);
      void appendSuperClientHistory(apiKey, name, [
        {
          role: "user",
          content: userContent,
          createdAt: now,
          editContext: "microsite",
        },
        {
          role: "assistant",
          content: errorContent,
          createdAt: errorAt,
          editContext: "microsite",
        },
      ]);
    } finally {
      setMicrositeEditing(false);
    }
  }

  // ── InlineEditPanel: shared instruction dispatcher ───────────────────────
  async function applyMicrositeInstruction(
    instruction: string,
    banner: string,
  ) {
    if (!viewingMicrosite || micrositeEditing) return;
    setMicrositeEditing(true);
    setMicrositeEditBanner("");
    try {
      // Sync in-memory HTML to disk before editing so the server always has the
      // latest state (a previous LLM edit may have updated React state but failed
      // to save, leaving the disk file stale).
      const currentHtml = (
        viewingMicrosite.ast.sections?.[0] as { customHtml?: string }
      )?.customHtml;
      if (currentHtml) {
        try {
          await patchSuperClientMicrositeHtml(
            apiKey,
            name,
            viewingMicrosite.id,
            currentHtml,
          );
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
      setTimeout(() => setMicrositeEditBanner(""), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Edit failed";
      setMicrositeEditBanner(`Error: ${msg}`);
      setTimeout(() => setMicrositeEditBanner(""), 8000);
    } finally {
      setMicrositeEditing(false);
    }
  }

  // Short snippet of the selected element's outerHTML — used as a hint on the server
  // so every instruction has a content-based fallback when findByPath can't locate
  // the element (e.g. after an LLM edit restructured the surrounding DOM).
  const hint = () => selectedElement?.outerHtml?.slice(0, 400) ?? "";

  async function handleStylePatch(prop: string, value: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__STYLE_PATCH__:${selectedElement.path}||${prop}||${value}||${hint()}`,
      `${prop} updated`,
    );
  }

  async function handleTextPatch(newText: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__TEXT_PATCH__:${selectedElement.path}||${newText}||${hint()}`,
      "Text updated",
    );
  }

  async function handleImageReplace(url: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__IMAGE_INJECT_SCOPED__:${selectedElement.path}||${url}||${hint()}`,
      "Image replaced",
    );
  }

  async function handleLogoReplace(url: string) {
    if (selectedElement?.path) {
      await applyMicrositeInstruction(
        `__LOGO_SWAP__:${selectedElement.path}||${url}`,
        "Logo updated",
      );
    } else {
      await applyMicrositeInstruction(`__LOGO_INJECT__:${url}`, "Logo updated");
    }
  }

  async function handleRemoveSection() {
    if (!selectedElement?.path) return;
    // Remove the exactly selected element (not the whole section).
    await applyMicrositeInstruction(
      `__REMOVE_BY_PATH__:${selectedElement.path}||${hint()}`,
      "Removed",
    );
    clearBridgeSelection();
  }

  async function handleRemoveSectionContainer() {
    if (!selectedElement) return;
    // Always removes the entire parent <section> regardless of which child is selected.
    // Extracts the section# anchor from the CSS path — e.g. section#hero from
    // "section#hero > div.hero-bg > div.overlay".
    const sectionM = selectedElement.path?.match(/\b(section#[\w-]+)/);
    if (sectionM) {
      await applyMicrositeInstruction(
        `__REMOVE_BY_PATH__:${sectionM[1]}`,
        `Section removed`,
      );
    } else if (selectedElement.sectionType) {
      // Fallback: use sectionType to build path (handles section#phase1-1 → phase1)
      await applyMicrositeInstruction(
        `__REMOVE_BY_PATH__:section#${selectedElement.sectionType}`,
        `Section removed`,
      );
    }
    clearBridgeSelection();
  }

  async function handleBgImagePatch(url: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__BG_IMAGE_PATCH__:${selectedElement.path}||${url}||${hint()}`,
      "Background image updated",
    );
  }

  async function handleVideoReplace(url: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__VIDEO_INJECT__:${selectedElement.path}||${url}||${hint()}`,
      "Video updated",
    );
  }

  async function handleIconReplace(url: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__ICON_REPLACE__:${selectedElement.path}||${url}||${hint()}`,
      "Icon replaced",
    );
  }

  async function handleSvgReplace(svgMarkup: string) {
    if (!selectedElement?.path) return;
    await applyMicrositeInstruction(
      `__SVG_REPLACE__:${selectedElement.path}||${svgMarkup}`,
      "Icon replaced",
    );
  }

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
    void patchSuperClientMicrositeHtml(
      apiKey,
      name,
      viewingMicrosite.id,
      prevHtml,
    ).catch(() => {});
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
    void patchSuperClientMicrositeHtml(
      apiKey,
      name,
      viewingMicrosite.id,
      nextHtml,
    ).catch(() => {});
  }

  // Explicit save — persists the current history snapshot to disk and marks it
  // as the "saved" position so the unsaved-changes indicator clears.
  async function handleMicrositeSave() {
    if (!viewingMicrosite || micrositeEditing || !hasUnsavedChanges) return;
    const currentHtml = editHistory[editHistoryIndex];
    if (!currentHtml) return;
    setMicrositeEditing(true);
    try {
      await patchSuperClientMicrositeHtml(
        apiKey,
        name,
        viewingMicrosite.id,
        currentHtml,
      );
      setSavedHistoryIndex(editHistoryIndex);
      setMicrositeEditBanner("Changes saved");
      setTimeout(() => setMicrositeEditBanner(""), 3000);
    } catch {
      setMicrositeEditBanner("Save failed — try again");
      setTimeout(() => setMicrositeEditBanner(""), 5000);
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
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      if (!micrositeDragRef.current) return;
      const containerWidth =
        splitContainerRef.current?.offsetWidth ?? window.innerWidth;
      const maxChatWidth = containerWidth - MICROSITE_MIN_WIDTH;
      // Dragging left shrinks chat (delta positive → subtract), dragging right grows it
      const delta = ev.clientX - micrositeDragRef.current.startX;
      const next = Math.max(
        CHAT_MIN_WIDTH,
        Math.min(maxChatWidth, micrositeDragRef.current.startWidth + delta),
      );
      setChatPanelWidth(next);
    }

    function onMouseUp() {
      micrositeDragRef.current = null;
      setMicrositeDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function parseMarkdownSections(
    md: string,
  ): Array<{ heading: string; body: string }> {
    const lines = md.split("\n");
    const sections: Array<{ heading: string; body: string }> = [];
    let heading = "";
    let bodyLines: string[] = [];
    for (const line of lines) {
      if (/^#{1,3} /.test(line)) {
        sections.push({ heading, body: bodyLines.join("\n").trim() });
        heading = line;
        bodyLines = [];
      } else {
        bodyLines.push(line);
      }
    }
    sections.push({ heading, body: bodyLines.join("\n").trim() });
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

  const MICROSITE_INTENT_RE =
    /\b(generate|create|make|build|design)\b[^.?!]*\bmicrosite\b|\bmicrosite\b[^.?!]*\b(generate|create|make|build|design)\b/i;
  const PROPOSAL_INTENT_RE =
    /\b(generate|create|write|draft|make|build)\s+(a\s+)?proposal\b/i;

  function dismissProposal() {
    // Abort any in-flight stream so the backend cannot save further changes
    abortRef.current?.abort();
    setViewingProposal(null);
    setChangedSections(new Set());
    setUpdateBanner("");
    restoreSidebar();
  }

  function dismissMicrosite() {
    setViewingMicrosite(null);
    restoreSidebar();
    setMicrositeEditInput("");
    setMicrositeEditBanner("");
    // Clear history when closing the microsite panel
    setEditHistory([]);
    setEditHistoryIndex(-1);
    setSavedHistoryIndex(-1);
    setEditingLogo(null);
    setEditingLogoUrl("");
    setShowEditingLogoUrlInput(false);
    setEditModeActive(false);
    clearBridgeSelection();
  }

  function resetComposer() {
    setComposerStage(null);
    setComposerProposal(null);
    setComposerInstructions("");
    setComposerImage(null);
    setComposerLogo(null);
    setComposerLogoUrl("");
    setShowLogoUrlInput(false);
    setComposerMessage("");
  }

  function compressLogoFile(
    file: File,
    onDone: (base64: string, mediaType: string) => void,
  ) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const MAX_H = 200;
        const scale = img.naturalHeight > MAX_H ? MAX_H / img.naturalHeight : 1;
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          onDone(dataUrl.split(",")[1], file.type);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const compressed = canvas.toDataURL("image/png", 0.85);
        onDone(compressed.split(",")[1], "image/png");
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function handleComposerLogoUpload(file: File) {
    compressLogoFile(file, (base64, mediaType) => {
      setComposerLogo({ base64, mediaType: mediaType as "image/png" });
    });
  }

  // ── Initials-based SVG logo fallback ─────────────────────────────────────────
  // Derives 1-3 uppercase initials from a company name and wraps them in a
  // rounded-rect SVG that can be injected into the navbar logo slot.
  function getInitials(name: string): string {
    const words = name
      .trim()
      .split(/\s+/)
      .filter(
        (w) => w.length > 1 && !/^(the|and|of|for|in|a|an|&|--)$/i.test(w),
      );
    if (words.length === 0) return name.slice(0, 2).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    // Two words → both initials; three or more → first three
    return words
      .slice(0, Math.min(words.length, 3))
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  function extractAccentColor(html: string): string {
    // Try common CSS variable patterns that LLM-generated microsites use
    const m = html.match(
      /--(?:c-accent|accent|primary|brand-color|color-accent)\s*:\s*(#[0-9a-fA-F]{3,8})/i,
    );
    return m?.[1] ?? "#1e3a5f"; // neutral navy fallback
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
    ].join("");
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
    if (html.includes('id="__site-logo__"')) {
      return html.replace(/<img\b[^>]*id="__site-logo__"[^>]*\/?>/i, svg);
    }

    // Strategy 1 — replace __site-logo-slot__ text div content (new prompt pattern)
    if (html.includes('id="__site-logo-slot__"')) {
      return html.replace(
        /(<div[^>]*id="__site-logo-slot__"[^>]*>)([\s\S]*?)(<\/div>)/i,
        `$1${svg}$3`,
      );
    }
    // Strategy 2 — find a logo/brand class element WITHIN nav/header bounds only.
    // The previous [\s\S]*? approach could cross </nav> and match footer elements.
    // Now we extract the nav content first, then search inside it.
    const navOpenM = html.match(/(<(nav|header)\b[^>]*>)/i);
    if (navOpenM) {
      const navStart = html.indexOf(navOpenM[0]);
      const closeTag = `</${navOpenM[2].toLowerCase()}>`;
      const navEndIdx = html.indexOf(closeTag, navStart + navOpenM[0].length);
      const navBounds = html.slice(
        navStart,
        navEndIdx !== -1 ? navEndIdx : navStart + 3000,
      );

      const logoM = navBounds.match(
        /<(?:a|div|span)\b[^>]*class="[^"]*(?:logo|brand|navbar-brand)[^"]*"[^>]*>/i,
      );
      if (logoM) {
        // Insert SVG right after the opening logo tag, scoped inside nav
        const insertAt =
          navStart + navBounds.indexOf(logoM[0]) + logoM[0].length;
        return html.slice(0, insertAt) + svg + html.slice(insertAt);
      }

      // Strategy 3 — inject as first child of the nav/header
      return (
        html.slice(0, navStart + navOpenM[0].length) +
        wrapper +
        html.slice(navStart + navOpenM[0].length)
      );
    }
    return html;
  }
  // ─────────────────────────────────────────────────────────────────────────────

  function injectLogoIntoHtml(
    html: string,
    logo: { base64: string; mediaType: string } | { url: string },
  ): string {
    // Strip any previous logo injection artifacts
    let out = html
      .replace(/<div[^>]*id="__brand-logo__"[^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<script[^>]*>\/\*__logo-inject__\*\/[\s\S]*?<\/script>/gi, "");

    const src =
      "url" in logo ? logo.url : `data:${logo.mediaType};base64,${logo.base64}`;
    const imgStyle =
      "height:44px;width:auto;max-width:180px;object-fit:contain;display:block;flex-shrink:0;";

    // Strategy 1 — replace the __site-logo__ img placeholder the LLM emits.
    // Also removes the onerror="" scenery fallback so it can never fire.
    if (out.includes('id="__site-logo__"')) {
      out = out.replace(
        /(<img\b[^>]*id="__site-logo__"[^>]*)\bsrc="[^"]*"/i,
        `$1src="${src}"`,
      );
      // Strip onerror — prevents the picsum scenery fallback from ever loading
      out = out.replace(
        /(<img\b[^>]*id="__site-logo__"[^>]*?)\s*\bonerror="[^"]*"/i,
        "$1",
      );
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
        const finalImg = patched.includes("src=")
          ? patched
          : patched.replace("<img", `<img src="${src}"`);
        return before + finalImg;
      });
    }

    // Strategy 3 — find an element with a logo/brand class inside nav/header and inject img
    const navLogoRe =
      /(<(?:nav|header)\b[\s\S]*?)(<(?:a|div|span)\b[^>]*class="[^"]*(?:logo|brand|navbar-brand)[^"]*"[^>]*>)/i;
    if (navLogoRe.test(out)) {
      return out.replace(navLogoRe, (_, before, logoOpenTag) => {
        // Add flex centering to the logo container and prepend the img
        const flexTag = logoOpenTag.includes("style=")
          ? logoOpenTag.replace(
              /\bstyle="([^"]*)"/i,
              (_m: string, s: string) => {
                const cleaned = s
                  .replace(/display\s*:[^;]+;?/gi, "")
                  .replace(/align-items\s*:[^;]+;?/gi, "");
                return `style="${cleaned.trim()};display:flex;align-items:center;"`;
              },
            )
          : logoOpenTag.replace(
              ">",
              ' style="display:flex;align-items:center;">',
            );
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
    return /<body[^>]*>/i.test(out)
      ? out.replace(/(<body[^>]*>)/i, `$1${overlay}`)
      : overlay + out;
  }

  async function handleComposerSelectProposal(p: SuperClientProposal) {
    setLoadingMicrositeFor(p.fileName);
    try {
      const markdown = await getSuperClientProposal(apiKey, name, p.fileName);
      setComposerProposal({ proposal: p, markdown });
      setComposerStage("configure");
      // Collapse open viewer panels so the configure card gets full chat width
      setViewingProposal(null);
      setViewingMicrosite(null);
    } catch (err) {
      console.error("Failed to load proposal", err);
    } finally {
      setLoadingMicrositeFor(null);
    }
  }

  function handleComposerImageUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1];
      const mediaType = file.type as
        | "image/jpeg"
        | "image/png"
        | "image/webp"
        | "image/gif";
      setComposerImage({ base64, mediaType });
    };
    reader.readAsDataURL(file);
  }

  async function generateComposerMicrosite() {
    if (!composerProposal || !name) return;

    const msGenId = genId();
    const msAbort = new AbortController();
    const proposalTitle = composerProposal.proposal.title;
    const micrositeTitle = proposalTitle.replace(/\bProposal\b/g, "Microsite").replace(/\bproposal\b/g, "microsite");
    const proposalMarkdown = composerProposal.markdown;
    const proposalInstructions = composerInstructions || undefined;
    const proposalImage = composerImage ?? undefined;
    const proposalLogo:
      | { base64: string; mediaType: string }
      | { url: string }
      | undefined =
      composerLogo ??
      (composerLogoUrl.trim() ? { url: composerLogoUrl.trim() } : undefined);
    const proposalId = composerProposal.proposal.fileName.replace(/\.md$/, "");

    // Start in the module store (survives navigation)
    generationStore.start({
      id: msGenId,
      clientSlug: name,
      type: "microsite",
      title: micrositeTitle,
      abort: () => msAbort.abort(),
    });
    localGenIdsRef.current.add(msGenId);

    // Add artifact message to chat and collapse composer immediately
    setMessages((prev) => [
      ...prev,
      {
        id: `gen-msg-${msGenId}`,
        role: "assistant",
        content: "",
        generationId: msGenId,
        createdAt: new Date().toISOString(),
      },
    ]);
    resetComposer();

    try {
      let partialCharCount = 0;
      await generateMicrositeV2Stream(apiKey, name, proposalId, {
        proposalMarkdown,
        userPrompt: proposalInstructions,
        referenceImage: proposalImage,
        signal: msAbort.signal,
        onEvent: (evt) => {
          if (evt.type === "html_chunk") {
            partialCharCount += evt.chunk.length;
            generationStore.updateChars(msGenId, partialCharCount);
          }
          if (evt.type === "progress" && evt.message) {
            generationStore.addStep(msGenId, evt.message);
          }
          if (evt.type === "plan" && evt.totalSections) {
            generationStore.addStep(
              msGenId,
              `Building ${evt.totalSections} sections…`,
            );
          }
          if (evt.type === "section" && evt.heading) {
            generationStore.addStep(msGenId, `${evt.heading}`);
          }
          if (evt.type === "complete" && evt.ast) {
            let ast = evt.ast as LayoutAST;
            // Inject logo (real image) or SVG initials fallback into the navbar slot
            if (ast.sections?.[0]) {
              const section = ast.sections[0] as unknown as {
                customHtml?: string;
              };
              if (section.customHtml) {
                const companyName =
                  proposalTitle ||
                  ((ast.brand as unknown as Record<string, unknown>)
                    ?.companyName as string) ||
                  "";
                const patchedHtml = proposalLogo
                  ? injectLogoIntoHtml(section.customHtml, proposalLogo)
                  : injectInitialsFallback(section.customHtml, companyName);
                const patched = {
                  ...(ast.sections[0] as object),
                  customHtml: patchedHtml,
                };
                ast = {
                  ...ast,
                  sections: [
                    patched as unknown as (typeof ast.sections)[0],
                    ...ast.sections.slice(1),
                  ],
                };
              }
            }
            // Open panel immediately with the stream AST — don't block on save
            const tempId = `preview-${msGenId}`;
            const genHtml =
              (ast.sections?.[0] as { customHtml?: string })?.customHtml ?? "";
            setActiveSrcDoc(computeSrcDoc(genHtml, false));
            setViewingMicrosite({
              id: tempId,
              ast,
              renderKey: `${tempId}-${Date.now()}`,
            });
            seedHistory(genHtml); // seed undo history with initial generated state
            setViewingProposal(null);
            setChangedSections(new Set());
            setUpdateBanner("");
            setActiveRightTab("artifacts");
            collapseForPanel();
            void (async () => {
              try {
                const saved = await saveSuperClientMicrosite(
                  apiKey,
                  name,
                  ast,
                  proposalTitle,
                );
                generationStore.complete(
                  msGenId,
                  { micrositeId: saved.id, ast },
                  saved.title,
                );
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
                showToast("Microsite generated and saved");
              } catch (err) {
                generationStore.error(msGenId, (err as Error).message);
                showToast(
                  `Failed to save microsite: ${(err as Error).message}`,
                  "error",
                );
              }
            })();
          }
          if (evt.type === "error") {
            generationStore.error(msGenId, evt.message ?? "Unknown error");
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        generationStore.error(msGenId, (err as Error).message);
      }
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const isQuestion =
      /^(how|what|why|when|where|who|is|are|can|could|would|does|do|did|will|should)\b/i.test(
        text,
      );
    if (!isQuestion && MICROSITE_INTENT_RE.test(text)) {
      const reply =
        proposals.length === 0
          ? "You'll need a proposal first — ask me to generate one for this client."
          : proposals.length === 1
            ? "Pick a proposal below to generate its microsite."
            : "Pick a proposal below to generate its microsite.";
      setMessages((prev) => [
        ...prev,
        { id: genId(), role: "user", content: text },
      ]);
      setInput("");
      // Extract any context the user included alongside the trigger word and pre-fill instructions
      const extracted = text
        .replace(/\b(generate|create|make|build|design)\b/gi, "")
        .replace(/\bmicrosite\b/gi, "")
        .replace(/\b(a|an|the|me|my|for|please|can you|could you)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (extracted) setComposerInstructions(extracted);
      if (proposals.length > 0) {
        setComposerMessage(reply);
        setComposerStage("select-proposal");
        // Collapse viewer panels so the proposal picker gets full chat width
        setViewingProposal(null);
        setViewingMicrosite(null);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: "assistant", content: reply },
        ]);
      }
      return;
    }

    // Start a proposal generation entry in the store so the capsule shows in chat
    let proposalGenId: string | null = null;
    if (PROPOSAL_INTENT_RE.test(text)) {
      proposalGenId = genId();
      generationStore.start({
        id: proposalGenId,
        clientSlug: name,
        type: "proposal",
        title: "Proposal",
        abort: () => abortRef.current?.abort(),
      });
      localGenIdsRef.current.add(proposalGenId);
    }

    const now = new Date().toISOString();
    const userMsg: Message = {
      id: genId(),
      role: "user",
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
      ...(proposalGenId ? { generationId: proposalGenId } : {}),
      ...(proposalEditActive ? { editContext: "proposal" as const } : {}),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    abortRef.current = new AbortController();

    try {
      await streamSuperClientChat(
        apiKey,
        name,
        text,
        (evt: SuperClientChatEvent) => {
          if (evt.type === "chunk" && evt.text) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + evt.text }
                  : m,
              ),
            );
          }
          if (evt.type === "done") {
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
            if (evt.proposalSaved) {
              // If the proposal intent regex didn't match, retroactively attach a generation
              // entry to the assistant message so the ArtifactCard appears in the chat.
              let effectiveGenId = proposalGenId;
              if (!effectiveGenId) {
                effectiveGenId = genId();
                generationStore.start({
                  id: effectiveGenId,
                  clientSlug: name,
                  type: "proposal",
                  title: evt.proposalSaved.title,
                  abort: () => {},
                });
                localGenIdsRef.current.add(effectiveGenId);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, generationId: effectiveGenId! }
                      : m,
                  ),
                );
              }
              generationStore.complete(
                effectiveGenId,
                { fileName: evt.proposalSaved.fileName },
                evt.proposalSaved.title,
              );
              setActiveRightTab("artifacts");
              // Optimistic update so the artifacts tab is populated immediately
              setProposals((prev) => {
                if (
                  prev.some((p) => p.fileName === evt.proposalSaved!.fileName)
                )
                  return prev;
                return [evt.proposalSaved!, ...prev];
              });
              loadProposals(); // sync with server
              void openProposal(evt.proposalSaved!);
            } else if (proposalGenId) {
              // Proposal intent matched but LLM didn't generate one — remove the capsule
              generationStore.dismiss(proposalGenId);
              setMessages((prev) =>
                prev.filter((m) => m.generationId !== proposalGenId),
              );
            }
            if (evt.proposalUpdated) {
              setProposals((prev) =>
                prev.map((p) =>
                  p.fileName === evt.proposalUpdated!.fileName
                    ? evt.proposalUpdated!
                    : p,
                ),
              );
              void (async () => {
                try {
                  const newContent = await getSuperClientProposal(
                    apiKey,
                    name,
                    evt.proposalUpdated!.fileName,
                  );
                  setViewingProposal((prev) => {
                    if (!prev) return prev;
                    const changed = diffSections(prev.content, newContent);
                    setChangedSections(changed);
                    const count = changed.size;
                    setUpdateBanner(
                      count === 1
                        ? "1 section updated"
                        : `${count} sections updated`,
                    );
                    return {
                      fileName: prev.fileName,
                      title: evt.proposalUpdated!.title,
                      content: newContent,
                    };
                  });
                } catch (err) {
                  console.error("Failed to reload updated proposal", err);
                }
              })();
            }
          }
          if (evt.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: `Error: ${evt.message ?? "Unknown error"}`,
                      streaming: false,
                    }
                  : m,
              ),
            );
          }
        },
        abortRef.current.signal,
        viewingProposal ? viewingProposal.fileName : undefined,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
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
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  if (error || !meta) {
    const is404 = error?.includes("404");
    const isNetwork =
      error?.toLowerCase().includes("network") ||
      error?.toLowerCase().includes("failed to fetch");
    const title = is404
      ? "Client not found"
      : isNetwork
        ? "Network error"
        : "Something went wrong";
    const detail = is404
      ? "This client may have been deleted."
      : isNetwork
        ? "Check your connection and try again."
        : (error ?? "Could not load client.");
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 12,
        }}
      >
        <p
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            margin: 0,
          }}
        >
          {title}
        </p>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
          {detail}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={() => router.push("/")}
            style={{
              padding: "7px 16px",
              borderRadius: 8,
              fontSize: 13,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              cursor: "pointer",
              color: "var(--text)",
            }}
          >
            ← All clients
          </button>
          {!is404 && (
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "7px 16px",
                borderRadius: 8,
                fontSize: 13,
                background: "var(--primary)",
                border: "none",
                cursor: "pointer",
                color: "#fff",
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
    for (const ms of [...microsites].sort(
      (a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime(),
    )) {
      const key = ms.proposalTitle || ms.title.split(/\s*[-–—]\s*/)[0];
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(ms);
    }
    for (const group of grouped.values())
      group.forEach((ms, i) => msVersionMap.set(ms.id, i + 1));
  }
  const propVersionMap = new Map<string, number>();
  {
    const grouped = new Map<string, typeof proposals>();
    for (const p of [...proposals].sort(
      (a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime(),
    )) {
      const key = p.title.split(/\s*[-–—]\s*/)[0];
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }
    for (const group of grouped.values())
      group.forEach((p, i) => propVersionMap.set(p.fileName, i + 1));
  }

  const micrositeEditActive = !!(viewingMicrosite && micrositeStripVisible);
  const proposalEditActive = !!(viewingProposal && proposalStripVisible);

  return (
    <>
      <div
        ref={splitContainerRef}
        style={{ display: "flex", height: "100%", overflow: "hidden" }}
      >
        {/* Center — chat */}
        <div
          style={{
            flex: 1,
            maxWidth:
              editModeActive ? CHAT_MIN_WIDTH
              : (viewingProposal || viewingMicrosite) ? chatPanelWidth
              : "100%",
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
            transition: "max-width 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {/* Header */}
          <header className="chat-v2-header">
            <div className="chat-v2-header-left">
              <span className="chat-v2-ns">{meta.displayName}</span>
            </div>
            <div className="chat-v2-header-right">
              <ThemeToggle />
              <button
                className="chat-v2-panel-toggle"
                onClick={() => {
                  if (viewingMicrosite) dismissMicrosite();
                  else if (viewingProposal) dismissProposal();
                  else setRightPanelOpen((v) => !v);
                }}
                title={
                  viewingMicrosite || viewingProposal
                    ? "Close panel"
                    : rightPanelOpen
                      ? "Hide panel"
                      : "Show panel"
                }
              >
                <Icon
                  icon={
                    viewingMicrosite || viewingProposal
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
                      textAlign: "center",
                      color: "var(--muted)",
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
                      return msg.content
                        .replace(/<(proposal|section-update)[^>]*>[\s\S]*$/, '')
                        .trim();
                    }
                    return msg.content
                      .replace(/<text-replace\b[^>]*?\/?>/gi, '')
                      .replace(/<\/?(?:proposal|section-update)\b[^>]*>/gi, '')
                      .replace(/\n{3,}/g, '\n\n')
                      .trim();
                  })();
                  const hasContent = !!visibleContent;
                  const hasArtifact = !!msg.generationId;
                  if (msg.role === "user") {
                    if (msg.uploadId) {
                      return (
                        <div
                          key={msg.id}
                          className="chat-v2-message chat-v2-message--user"
                        >
                          <UploadMessageCard
                            uploadId={msg.uploadId}
                            docs={docs}
                          />
                        </div>
                      );
                    }
                    if (msg.editContext === 'microsite' || msg.editContext === 'proposal') {
                      const EyebrowIcon = msg.editContext === 'microsite' ? Globe : FileText;
                      const eyebrowLabel = msg.editContext === 'microsite' ? 'Edit microsite' : 'Edit proposal';
                      return (
                        <div key={msg.id} className="chat-v2-message chat-v2-message--user">
                          <div className="chat-v2-bubble" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 500,
                              color: '#706F6B',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              lineHeight: 1,
                              marginBottom: 0,
                            }}>
                              <EyebrowIcon size={16} style={{ flexShrink: 0 }} />
                              {eyebrowLabel}
                            </span>
                            {visibleContent}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={msg.id}
                        className="chat-v2-message chat-v2-message--user"
                      >
                        <div className="chat-v2-bubble">{visibleContent}</div>
                      </div>
                    );
                  }

                  // Microsite edit confirmation — eyebrow above normal assistant bubble
                  if (msg.editContext === 'microsite') {
                    const isError = visibleContent.startsWith('Edit failed');
                    return (
                      <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 2 }}>
                          <Icon icon={isError ? X : CheckCircle} size="xs" style={{ color: isError ? '#ef4444' : '#22c55e' }} />
                          <span style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: isError ? '#ef4444' : '#22c55e',
                          }}>
                            {isError ? 'Edit failed' : 'Microsite updated'}
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
                  const isProposalDone = msg.editContext === 'proposal' && !msg.streaming &&
                    /\b(updated|changed|saved|applied|modified|revised|replaced|rewritten|regenerated)\b/i.test(visibleContent) &&
                    !/\?|for example[:\s]|what (would|do|changes)|give me (the )?direction|let me know|tell me|could you|can you/i.test(visibleContent);
                  return (
                    <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: isProposalDone ? 4 : 0 }}>
                      {isProposalDone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 2 }}>
                          <Icon icon={CheckCircle} size="xs" style={{ color: '#22c55e' }} />
                          <span style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: '#22c55e',
                          }}>
                            Proposal updated
                          </span>
                        </div>
                      )}
                    <div
                      className="chat-v2-message chat-v2-message--assistant"
                    >
                      <div className="chat-v2-avatar">AI</div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        {msg.editContext === 'proposal' && msg.streaming && (
                          <span style={{
                            fontSize: 10,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            color: 'var(--text-secondary)',
                            opacity: 0.5,
                          }}>
                            Proposal Edit
                          </span>
                        )}
                        {/* Text bubble — hidden for pure artifact messages */}
                        {(hasContent || (msg.streaming && !hasArtifact)) && (
                          <div className="chat-v2-bubble">
                            {msg.streaming && !visibleContent && (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <span
                                  className="status-glyph"
                                  aria-hidden="true"
                                />
                                <em className="chat-status-text">Thinking…</em>
                              </div>
                            )}
                            {visibleContent && (
                              <>
                                <div className="prose">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {visibleContent}
                                  </ReactMarkdown>
                                </div>
                                {msg.streaming && (
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
                              if (g.type === "microsite" && g.result?.micrositeId)
                                return msVersionMap.get(g.result.micrositeId);
                              if (g.type === "proposal" && g.result?.fileName)
                                return propVersionMap.get(g.result.fileName);
                              return undefined;
                            })()}
                            onView={(gen) => {
                              if (
                                gen.type === "microsite" &&
                                gen.result?.micrositeId
                              ) {
                                // Always fetch from server so edits made after generation are reflected
                                const found = microsites.find(
                                  (m) => m.id === gen.result!.micrositeId,
                                );
                                if (!found) {
                                  showToast(
                                    "This microsite has been deleted",
                                    "error",
                                  );
                                } else {
                                  void handleOpenMicrosite(found);
                                }
                              } else if (
                                gen.type === "proposal" &&
                                gen.result?.fileName
                              ) {
                                void openProposal({
                                  fileName: gen.result.fileName,
                                  title: gen.title,
                                  savedAt: "",
                                });
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
            {composerStage === "select-proposal" && (
              <div
                style={{
                  position: "relative",
                  borderRadius: 10,
                  padding: "12px 12px 8px",
                  background: "var(--panel-soft)",
                }}
              >
                {/* X — top right */}
                <button
                  onClick={resetComposer}
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--muted)",
                    display: "flex",
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
                      color: "var(--text)",
                      lineHeight: 1.5,
                      paddingRight: 28,
                    }}
                  >
                    {composerMessage}
                  </div>
                )}
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                  {proposals.map((p) => (
                    <button
                      key={p.fileName}
                      onClick={() => void handleComposerSelectProposal(p)}
                      disabled={loadingMicrositeFor === p.fileName}
                      style={{
                        textAlign: "left",
                        padding: "7px 10px",
                        borderRadius: 8,
                        border: "none",
                        background: "var(--panel)",
                        cursor: "pointer",
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 6,
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = "0.8";
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.opacity = "1";
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
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              flex: 1,
                              fontSize: 13,
                              color: "var(--text)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {p.title.split(/\s*[-–—]\s*/)[0]}
                          </span>
                          <span
                            style={{
                              flexShrink: 0,
                              fontSize: 10,
                              fontWeight: 600,
                              color: "var(--primary)",
                              background: "var(--primary-soft, rgba(99,102,241,0.12))",
                              borderRadius: 4,
                              padding: "1px 5px",
                              lineHeight: 1.5,
                            }}
                          >
                            v{propVersionMap.get(p.fileName) ?? 1}
                          </span>
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
                          {loadingMicrositeFor === p.fileName
                            ? "Loading…"
                            : `${meta?.displayName ?? name} · ${new Date(p.savedAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Composer expansion — configure */}
            {composerStage === "configure" && composerProposal && (
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 12,
                  background: "var(--panel-soft)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--text)",
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Sparkles size={13} /> {composerProposal.proposal.title}
                  </p>
                  <button
                    onClick={resetComposer}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--muted)",
                      display: "flex",
                      padding: 0,
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <textarea
                  value={composerInstructions}
                  onChange={(e) => setComposerInstructions(e.target.value)}
                  placeholder="Optional: any design direction or focus areas…"
                  rows={2}
                  style={{
                    width: "100%",
                    resize: "none",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--panel)",
                    color: "var(--text)",
                    fontSize: 13,
                    outline: "none",
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => composerImageInputRef.current?.click()}
                      style={{
                        background: "none",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "5px 10px",
                        cursor: "pointer",
                        fontSize: 12,
                        color: composerImage
                          ? "var(--primary)"
                          : "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <ImagePlus size={12} />
                      {composerImage ? "Image attached ✓" : "Reference image"}
                    </button>
                    <button
                      onClick={() => composerLogoInputRef.current?.click()}
                      style={{
                        background: "none",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "5px 10px",
                        cursor: "pointer",
                        fontSize: 12,
                        color: composerLogo ? "var(--primary)" : "var(--muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <ImagePlus size={12} />
                      {composerLogo ? "Logo attached ✓" : "Choose logo"}
                    </button>
                    {!composerLogo &&
                      (showLogoUrlInput ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
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
                              fontSize: 12,
                              padding: "4px 8px",
                              borderRadius: 6,
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              color: "var(--text)",
                              outline: "none",
                              width: 180,
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") setShowLogoUrlInput(false);
                              if (e.key === "Escape") {
                                setComposerLogoUrl("");
                                setShowLogoUrlInput(false);
                              }
                            }}
                          />
                          {composerLogoUrl.trim() && (
                            <button
                              onClick={() => setShowLogoUrlInput(false)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "var(--primary)",
                                fontSize: 11,
                                padding: "4px 6px",
                              }}
                            >
                              ✓
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setComposerLogoUrl("");
                              setShowLogoUrlInput(false);
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--muted)",
                              display: "flex",
                              padding: 4,
                            }}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowLogoUrlInput(true)}
                          style={{
                            background: "none",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            padding: "5px 10px",
                            cursor: "pointer",
                            fontSize: 12,
                            color: composerLogoUrl.trim()
                              ? "var(--primary)"
                              : "var(--muted)",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <LinkIcon size={12} />
                          {composerLogoUrl.trim()
                            ? "Logo URL set ✓"
                            : "Logo URL"}
                        </button>
                      ))}
                  </div>
                  <input
                    ref={composerImageInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleComposerImageUpload(f);
                    }}
                  />
                  <input
                    ref={composerLogoInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleComposerLogoUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    onClick={() => void generateComposerMicrosite()}
                    style={{
                      padding: "7px 14px",
                      borderRadius: 8,
                      background: "var(--primary)",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Sparkles size={13} /> Generate Microsite
                  </button>
                </div>
              </div>
            )}

            {/* Textarea row — hidden while composer expansion is active */}
            {!composerStage && (
              <>
                {/* Proposal editing strip — sits above composer, same as microsite strip */}
                {viewingProposal && proposalStripVisible && (
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
                      }}
                    >
                      <FileText size={16} style={{ flexShrink: 0 }} />
                      Edit proposal
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setProposalStripVisible(false); }}
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
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
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
                        {selectedElement.sectionType ? `${selectedElement.sectionType} › ` : ""}
                        {selectedElement.label}
                      </span>
                    </span>
                    <button
                      onClick={() => clearBridgeSelection()}
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
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
                      title="Clear selection"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
                {/* Microsite editing strip — sits above composer with 4px sliding behind it */}
                {viewingMicrosite && micrositeStripVisible && !(editModeActive && selectedElement) && (
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
                      }}
                    >
                      <Globe size={16} style={{ flexShrink: 0 }} />
                      Edit microsite
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMicrositeStripVisible(false); setEditModeActive(false); clearBridgeSelection(); }}
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
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
                      title="Dismiss"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}
              <div
                className="chat-v2-composer"
                style={{
                  position: "relative",
                  zIndex: 1,
                  ...(viewingProposal || viewingMicrosite
                    ? { flexDirection: "column", alignItems: "stretch", gap: 0 }
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
                  value={micrositeEditActive ? micrositeEditInput : input}
                  onChange={(e) =>
                    micrositeEditActive
                      ? setMicrositeEditInput(e.target.value)
                      : setInput(e.target.value)
                  }
                  onKeyDown={
                    micrositeEditActive
                      ? (e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            void handleMicrositeEdit();
                          }
                        }
                      : handleKeyDown
                  }
                  placeholder={
                    micrositeEditActive && editModeActive && selectedElement
                      ? selectedElement.tag === "img"
                        ? "Paste URL or describe the change…"
                        : `Describe the edit…`
                      : micrositeEditActive
                        ? editModeActive
                          ? "Tap an element to select it"
                          : "Describe your edit…"
                        : proposalEditActive
                          ? "Ask to edit this proposal…"
                          : `Ask about ${meta.displayName}…`
                  }
                  disabled={micrositeEditActive ? micrositeEditing : false}
                  rows={1}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                  }}
                />
                {/* Horizontal separator — hidden */}
                <div style={{ height: 1, margin: "0 2px" }} />
                {/* Bottom bar: attach left, send right — same padding as textarea */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px" }}>
                  {/* Attach (+) button */}
                  {!micrositeEditActive ? (
                    <div style={{ position: "relative", flexShrink: 0 }}>
                      <button
                        onClick={() => setAttachMenuOpen((v) => !v)}
                        title="Attach"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--muted)",
                          display: "flex",
                          alignItems: "center",
                          padding: "4px",
                          borderRadius: 4,
                          lineHeight: 1,
                        }}
                      >
                        <Plus size={16} />
                      </button>
                      {attachMenuOpen && (
                        <>
                          <div
                            style={{ position: "fixed", inset: 0, zIndex: 9998 }}
                            onClick={() => setAttachMenuOpen(false)}
                          />
                          <div
                            style={{
                              position: "absolute",
                              bottom: "calc(100% + 6px)",
                              left: 0,
                              zIndex: 9999,
                              background: "var(--panel)",
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              padding: "4px",
                              minWidth: 172,
                              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                            }}
                          >
                            <button
                              onClick={() => {
                                setAttachMenuOpen(false);
                                composerFileInputRef.current?.click();
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 9,
                                width: "100%",
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: "8px 10px",
                                borderRadius: 7,
                                fontSize: 13,
                                color: "var(--foreground)",
                                textAlign: "left",
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "var(--panel-soft)";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "none";
                              }}
                            >
                              <FileText
                                size={14}
                                strokeWidth={1.5}
                                style={{ flexShrink: 0, color: "var(--muted)" }}
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {viewingProposal && (
                    <button
                      onClick={() => setProposalStripVisible(true)}
                      title="Edit proposal"
                      className="theme-toggle"
                      style={{
                        background: proposalEditActive ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                        border: "1px solid transparent",
                        color: proposalEditActive ? "var(--primary)" : undefined,
                        transition: "background 0.15s, color 0.15s, border-color 0.15s",
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {viewingMicrosite && (
                    <button
                      onClick={() => {
                        const next = !editModeActive;
                        setEditModeActive(next);
                        if (next) {
                          setMicrositeStripVisible(true);
                        } else {
                          clearBridgeSelection();
                        }
                        setViewingMicrosite((prev) => {
                          if (!prev) return null;
                          const html =
                            (prev.ast.sections?.[0] as { customHtml?: string })
                              ?.customHtml ?? "";
                          setActiveSrcDoc(computeSrcDoc(html, next));
                          return {
                            ...prev,
                            renderKey: `${prev.id}-${Date.now()}`,
                          };
                        });
                      }}
                      title={
                        editModeActive
                          ? "Exit smart edit mode"
                          : "Smart edit — click any element to target it"
                      }
                      className="theme-toggle"
                      style={{
                        background: editModeActive ? "color-mix(in srgb, var(--primary) 12%, transparent)" : "transparent",
                        border: "1px solid transparent",
                        color: editModeActive ? "var(--primary)" : undefined,
                        transition: "background 0.15s, color 0.15s, border-color 0.15s",
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
                        : void sendMessage()
                    }
                    disabled={
                      micrositeEditActive
                        ? micrositeEditing ||
                          (!micrositeEditInput.trim() &&
                            !editingLogo &&
                            !editingLogoUrl.trim())
                        : streaming || !input.trim()
                    }
                  >
                    <Icon
                      icon={micrositeEditActive && micrositeEditing ? Loader : ArrowUp}
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
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      void handleFileUploadFromComposer(f);
                      e.target.value = "";
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
          className={`sc-viewer-panel${viewingMicrosite ? " sc-viewer-panel--open" : ""}`}
          style={{
            flexGrow: viewingMicrosite ? 1 : 0,
            flexShrink: 0,
            flexBasis: viewingMicrosite ? 0 : "auto",
            width: viewingMicrosite ? undefined : 0,
            minWidth: viewingMicrosite ? MICROSITE_MIN_WIDTH : 0,
            borderLeft: viewingMicrosite ? "1px solid var(--border)" : "none",
          }}
        >
          {lastMicrositeRef.current && (
            <div
              className="sc-viewer-panel-inner"
              style={{
                width: "100%",
                position: "relative",
              }}
            >
              {/* Drag handle — hidden in edit mode so microsite stays maximised */}
              <div
                onMouseDown={editModeActive ? undefined : handleMicrositeDragStart}
                onMouseEnter={() => !editModeActive && setMicrositeDragHover(true)}
                onMouseLeave={() => setMicrositeDragHover(false)}
                title={editModeActive ? undefined : "Drag to resize"}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: editModeActive ? 0 : 14,
                  cursor: editModeActive ? "default" : "col-resize",
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
                {/* width tooltip during drag */}
                {micrositeDragging && (
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: 18,
                      transform: "translateY(-50%)",
                      background: "var(--primary)",
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 4,
                      whiteSpace: "nowrap",
                      pointerEvents: "none",
                      zIndex: 30,
                      letterSpacing: "0.02em",
                      display: "none",
                    }}
                  >
                    {chatPanelWidth}px
                  </div>
                )}
              </div>
              {/* Header */}
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                }}
              >
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
                  <Globe
                    size={14}
                    style={{ color: "var(--primary)", flexShrink: 0 }}
                  />
                  {(lastMicrositeRef.current!.ast.meta as { title?: string })
                    ?.title ?? "Microsite"}
                </p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexShrink: 0,
                  }}
                >
                  {/* Unsaved-changes indicator */}
                  {hasUnsavedChanges && (
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
                  {/* Undo */}
                  <button
                    onClick={() => handleMicrositeRevert()}
                    disabled={micrositeEditing || !canUndo}
                    title={
                      canUndo
                        ? `Undo (${editHistoryIndex} step${editHistoryIndex !== 1 ? "s" : ""} available) — Ctrl+Z`
                        : "Nothing to undo"
                    }
                    style={{
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "4px 10px",
                      cursor:
                        micrositeEditing || !canUndo ? "default" : "pointer",
                      fontSize: 12,
                      color: canUndo ? "var(--foreground)" : "var(--muted)",
                      display: "flex",
                      alignItems: "center",
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
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "4px 10px",
                      cursor:
                        micrositeEditing || !canRedo ? "default" : "pointer",
                      fontSize: 12,
                      color: canRedo ? "var(--foreground)" : "var(--muted)",
                      display: "flex",
                      alignItems: "center",
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
                    title={
                      hasUnsavedChanges ? "Save changes" : "No unsaved changes"
                    }
                    style={{
                      background:
                        hasUnsavedChanges && !micrositeEditing
                          ? "var(--primary)"
                          : "none",
                      border: `1px solid ${hasUnsavedChanges && !micrositeEditing ? "var(--primary)" : "var(--border)"}`,
                      borderRadius: 6,
                      padding: "4px 10px",
                      cursor:
                        micrositeEditing || !hasUnsavedChanges
                          ? "default"
                          : "pointer",
                      fontSize: 12,
                      color:
                        hasUnsavedChanges && !micrositeEditing
                          ? "#fff"
                          : "var(--muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      opacity: hasUnsavedChanges ? 1 : 0.4,
                      fontWeight: hasUnsavedChanges ? 600 : 400,
                      transition:
                        "background 0.15s, border-color 0.15s, color 0.15s",
                    }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() =>
                      setFullscreenMicrosite(lastMicrositeRef.current!.ast)
                    }
                    style={{
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <ExternalLink size={12} /> Full screen
                  </button>
                  <button
                    onClick={() => setShowPublishMicrosite(true)}
                    style={{
                      background: "none",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontSize: 12,
                      color: "var(--muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Globe size={12} /> Publish
                  </button>
                  <button
                    onClick={dismissMicrosite}
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

              {/* Microsite edit success banner */}
              {micrositeEditBanner &&
                !micrositeEditBanner.startsWith("Error:") && (
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
                    <CheckCircle
                      size={12}
                      style={{ color: "#22c55e", flexShrink: 0 }}
                    />
                    {micrositeEditBanner}
                  </div>
                )}

              {/* Responsive iframe preview */}
              <div
                ref={iframeContainerRef}
                style={{
                  flex: 1,
                  minHeight: 0,
                  background: "#fff",
                  position: "relative",
                }}
              >
                {/* Slot A */}
                <iframe
                  ref={iframeARef}
                  srcDoc={iframeSrcDocA}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                    colorScheme: "light",
                    opacity: activeSlot === "A" ? 1 : 0,
                    pointerEvents: activeSlot === "A" ? "auto" : "none",
                  }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                />
                {/* Slot B — background loading slot */}
                <iframe
                  ref={iframeBRef}
                  srcDoc={iframeSrcDocB}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                    colorScheme: "light",
                    opacity: activeSlot === "B" ? 1 : 0,
                    pointerEvents: activeSlot === "B" ? "auto" : "none",
                  }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                />
                {/* Figma-style selection overlay — only in smart edit mode */}
                {editModeActive && (
                  <SelectionOverlay
                    hovered={hoveredElement}
                    selected={selectedElement}
                    isProcessing={micrositeEditing}
                    onClearSelected={() => clearBridgeSelection()}
                  />
                )}
                {/* Floating "Remove Section" button — top-right, blue, only for structural
                     (non-text) elements so text selections don't accidentally wipe the section */}
                {editModeActive &&
                  selectedElement &&
                  (() => {
                    const TEXT_TAGS_INLINE = new Set([
                      "h1",
                      "h2",
                      "h3",
                      "h4",
                      "h5",
                      "h6",
                      "p",
                      "span",
                      "a",
                      "li",
                      "button",
                      "label",
                      "td",
                      "th",
                      "caption",
                      "figcaption",
                      "dt",
                      "dd",
                      "blockquote",
                      "em",
                      "strong",
                      "small",
                      "b",
                      "i",
                    ]);
                    const tag = (selectedElement.tag ?? "").toLowerCase();
                    const sectionType = selectedElement.sectionType;
                    if (!sectionType) return null;

                    // Known text tags never get "Remove Section"
                    if (TEXT_TAGS_INLINE.has(tag)) return null;

                    // Leaf text elements (any tag whose inner content has no child HTML and has text)
                    // e.g. <div class="hero-label">Confidential Proposal</div>
                    const innerHtml = (selectedElement.outerHtml ?? "")
                      .replace(/^<[^>]+>/, "")
                      .replace(/<\/[^>]+>$/, "");
                    const hasChildElements = /<\w/.test(innerHtml);
                    const hasTextContent =
                      (selectedElement.text ?? "").trim().length > 0;
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
                    const btnLeft = secRect
                      ? secRect.left + secRect.width
                      : undefined;
                    return (
                      <div
                        style={{
                          position: "absolute",
                          top: btnTop,
                          ...(btnLeft !== undefined
                            ? {
                                left: btnLeft,
                                transform: "translateX(calc(-100% - 12px))",
                              }
                            : { right: 12 }),
                          zIndex: 25,
                          pointerEvents: "auto",
                        }}
                      >
                        <button
                          disabled={micrositeEditing}
                          onClick={() => void handleRemoveSectionContainer()}
                          title={`Remove entire "${sectionType}" section`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 30,
                            height: 30,
                            padding: 0,
                            borderRadius: 6,
                            background: micrositeEditing
                              ? "rgba(13,153,255,0.35)"
                              : "rgba(13,153,255,0.92)",
                            border: "1.5px solid rgba(13,153,255,1)",
                            color: "#fff",
                            cursor: micrositeEditing
                              ? "not-allowed"
                              : "pointer",
                            boxShadow: "0 2px 12px rgba(13,153,255,0.35)",
                            opacity: micrositeEditing ? 0.5 : 1,
                            transition: "background 0.15s",
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
                      position: "absolute",
                      inset: 0,
                      zIndex: 10,
                      cursor: "col-resize",
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Proposal slide-in panel */}
        <div
          className={`sc-viewer-panel${viewingProposal ? " sc-viewer-panel--open" : ""}`}
          style={{
            flexGrow: viewingProposal ? 1 : 0,
            flexShrink: 0,
            flexBasis: viewingProposal ? 0 : "auto",
            width: viewingProposal ? undefined : 0,
            minWidth: viewingProposal ? 400 : 0,
            borderLeft: viewingProposal ? "1px solid var(--border)" : "none",
            position: "relative",
          }}
        >
          {lastProposalRef.current && (
            <div
              className="sc-viewer-panel-inner"
              style={{
                width: "100%",
              }}
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
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                }}
              >
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                    margin: 0,
                  }}
                >
                  {lastProposalRef.current!.title}
                </p>
                <button
                  onClick={dismissProposal}
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
              {updateBanner && (
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
                  <CheckCircle
                    size={12}
                    style={{ color: "#22c55e", flexShrink: 0 }}
                  />
                  {updateBanner}
                </div>
              )}
              <div
                style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}
                className="proposal-body"
              >
                {parseMarkdownSections(lastProposalRef.current!.content).map(
                  (section, i) => {
                    const isChanged = changedSections.has(section.heading);
                    const mdChunk = [section.heading, section.body]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <div
                        key={i}
                        style={{
                          borderRadius: 6,
                          padding: isChanged ? "10px 12px" : undefined,
                          marginBottom: isChanged ? 8 : undefined,
                          background: isChanged
                            ? "rgba(234, 179, 8, 0.08)"
                            : undefined,
                          borderLeft: isChanged
                            ? "3px solid rgba(234, 179, 8, 0.6)"
                            : undefined,
                          transition:
                            "background 0.4s ease, border-color 0.4s ease",
                        }}
                      >
                        <div className="prose">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {mdChunk}
                          </ReactMarkdown>
                        </div>
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          )}
        </div>

        {/* Backdrop — mobile only, closes the right panel on tap outside */}
        {rightPanelOpen && (
          <div
            className="sc-panel-backdrop"
            onClick={() => setRightPanelOpen(false)}
          />
        )}

        {/* Right panel — client info */}
        <div
          className="chat-side-panel"
          style={{
            width:
              viewingProposal || viewingMicrosite || !rightPanelOpen ? 0 : 320,
            minWidth: 0,
            borderLeft:
              viewingProposal || viewingMicrosite || !rightPanelOpen
                ? "none"
                : "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden",
            transition: "width 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div className="client-panel">
            {/* ── Tab bar ── */}
            <div className="client-panel-tabs" style={{ height: 48 }}>
              <button
                className={`client-panel-tab${activeRightTab === "context" ? " active" : ""}`}
                onClick={() => setActiveRightTab("context")}
              >
                Context
              </button>
              <button
                className={`client-panel-tab${activeRightTab === "artifacts" ? " active" : ""}`}
                onClick={() => setActiveRightTab("artifacts")}
                style={{ gap: 5 }}
              >
                Artifacts
                {microsites.length + proposals.length > 0 && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: 16,
                      height: 16,
                      borderRadius: "50%",
                      background:
                        activeRightTab === "artifacts"
                          ? "var(--primary)"
                          : "var(--border)",
                      color:
                        activeRightTab === "artifacts"
                          ? "#fff"
                          : "var(--muted)",
                      fontSize: 10,
                      fontWeight: 600,
                      lineHeight: 1,
                      padding: "0 4px",
                      marginBottom: 1,
                    }}
                  >
                    {microsites.length + proposals.length}
                  </span>
                )}
              </button>
            </div>

            {/* ── Tab content ── */}
            <div className="client-panel-body">
              {/* Context tab: documents + memory */}
              {activeRightTab === "context" && (
                <>
                  {/* Client identity */}
                  <div
                    className="client-panel-list"
                    style={{ paddingTop: 8, paddingLeft: 12, paddingRight: 12, paddingBottom: 4 }}
                  >
                    <div
                      className="brief-panel-section-header"
                      style={{ padding: "0 4px 2px" }}
                    >
                      <span
                        style={{
                          flex: "none",
                          fontSize: 14,
                          fontWeight: 400,
                          color: "var(--text)",
                          textTransform: "none",
                          letterSpacing: 0,
                        }}
                      >
                        {meta?.displayName ?? name}
                      </span>
                    </div>

                    {urlEditMode ? (
                      <div style={{ padding: "4px 4px 6px" }}>
                        <input
                          type="url"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              urlInput.trim() &&
                              !enriching
                            ) {
                              if (contextMd.trim()) {
                                setEnrichConfirmPending(true);
                              } else {
                                void handleEnrichUrl();
                              }
                            }
                            if (e.key === "Escape") {
                              setUrlEditMode(false);
                              setEnrichError("");
                            }
                          }}
                          placeholder="https://example.com"
                          disabled={enriching}
                          autoFocus
                          style={{
                            width: "100%",
                            fontSize: 12,
                            padding: "4px 8px",
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                            borderRadius: 6,
                            color: "var(--text)",
                            boxSizing: "border-box",
                          }}
                        />
                        {enrichError && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#e55",
                              marginTop: 3,
                            }}
                          >
                            {enrichError}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
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
                              padding: "3px 10px",
                              background: "var(--accent, #6366f1)",
                              color: "#fff",
                              border: "none",
                              borderRadius: 6,
                              cursor:
                                enriching || !urlInput.trim()
                                  ? "not-allowed"
                                  : "pointer",
                              opacity: enriching || !urlInput.trim() ? 0.6 : 1,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {enriching && (
                              <Loader
                                size={11}
                                strokeWidth={2}
                                style={{ animation: "spin 1s linear infinite" }}
                              />
                            )}
                            {enriching ? "Fetching…" : "Fetch"}
                          </button>
                          <button
                            disabled={enriching}
                            onClick={() => {
                              setUrlEditMode(false);
                              setEnrichError("");
                            }}
                            style={{
                              fontSize: 12,
                              padding: "3px 8px",
                              background: "none",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              color: "var(--muted)",
                              cursor: enriching ? "not-allowed" : "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : meta?.url ? (
                      <div
                        className="client-panel-row"
                        style={{ cursor: "default" }}
                      >
                        <Globe
                          size={13}
                          strokeWidth={1.5}
                          style={{ flexShrink: 0, color: "var(--muted)" }}
                        />
                        <a
                          href={meta.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="client-panel-row-name"
                          style={{
                            color: "var(--muted)",
                            textDecoration: "none",
                          }}
                        >
                          {meta.url.replace(/^https?:\/\//, "")}
                        </a>
                        <div className="brief-field-actions" style={{ marginLeft: "auto" }}>
                          <button
                            className="brief-knowledge-icon-btn"
                            onClick={() => {
                              setUrlInput(meta.url ?? "");
                              setUrlEditMode(true);
                              setEnrichError("");
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
                        style={{ cursor: "pointer" }}
                        onClick={() => {
                          setUrlInput("");
                          setUrlEditMode(true);
                          setEnrichError("");
                        }}
                      >
                        <Plus
                          size={13}
                          strokeWidth={1.5}
                          style={{ flexShrink: 0, color: "var(--muted)", opacity: 0.5 }}
                        />
                        <span
                          style={{
                            fontSize: 13,
                            color: "var(--muted)",
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

                  <ClientProfileFields namespace={name} />

                  {/* Documents */}
                  <div
                    className="client-panel-list"
                    style={{ paddingTop: 8, paddingLeft: 12, paddingRight: 12 }}
                  >
                    <div
                      className="brief-panel-section-header"
                      style={{ padding: "0 4px 2px" }}
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
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.txt,.md"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          void handleFileUpload(f);
                          e.target.value = "";
                        }
                      }}
                    />
                    {docs.length === 0 && !uploading ? (
                      <div
                        style={{
                          padding: "4px 2px",
                          fontSize: 13,
                          color: "var(--muted)",
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
                            style={{ position: "relative" }}
                            onMouseEnter={() => {
                              if (!menuDocId || menuDocId === doc.fileName)
                                setHoveredDocId(doc.fileName);
                            }}
                            onMouseLeave={() => setHoveredDocId(null)}
                          >
                            <div
                              className="client-panel-row"
                              style={{
                                paddingRight: isHov || menuOpen ? 36 : 10,
                                cursor: "default",
                              }}
                            >
                              <span className="client-panel-row-name">
                                {doc.fileName}
                              </span>
                              {doc.status === "processing" && (
                                <span
                                  style={{
                                    flexShrink: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 3,
                                    fontSize: 10,
                                    color: "var(--primary)",
                                  }}
                                >
                                  <Icon
                                    icon={Loader}
                                    size="sm"
                                    style={{
                                      animation: "spin 1s linear infinite",
                                      width: 10,
                                      height: 10,
                                    }}
                                  />
                                  Processing
                                </span>
                              )}
                              {doc.status === "extracted" && (
                                <span
                                  className="ingestion-badge--indexed"
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 10,
                                    fontWeight: 500,
                                    background: "transparent",
                                    border: "none",
                                  }}
                                >
                                  INDEXED
                                </span>
                              )}
                              {doc.status === "failed" && (
                                <span
                                  className="ingestion-badge--failed"
                                  style={{
                                    flexShrink: 0,
                                    fontSize: 10,
                                    fontWeight: 500,
                                    background: "transparent",
                                    border: "none",
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
                                position: "absolute",
                                right: 10,
                                top: "50%",
                                transform: "translateY(-50%)",
                                padding: "1px 5px",
                                border: "none",
                                lineHeight: 1,
                                opacity: isHov || menuOpen ? 1 : 0,
                                pointerEvents:
                                  isHov || menuOpen ? "auto" : "none",
                                transition: "opacity 0.15s",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const btn =
                                  docMenuBtnRefs.current[doc.fileName];
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
              {activeRightTab === "artifacts" && (
                <div
                  className="client-panel-list"
                  style={{ paddingTop: 4, paddingLeft: 12, paddingRight: 12 }}
                >
                  {/* Microsites */}
                  <div
                    className="brief-panel-section-header"
                    style={{ padding: "0 4px 2px" }}
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
                      Microsites
                    </span>
                  </div>
                  {microsites.length === 0 ? (
                    <div
                      style={{
                        padding: "4px 2px",
                        fontSize: 13,
                        color: "var(--muted)",
                        opacity: 0.5,
                      }}
                    >
                      {proposals.length === 0
                        ? "Create a proposal first"
                        : "No microsites yet"}
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
                              background:
                                "var(--primary-soft, rgba(99,102,241,0.12))",
                              color: "var(--primary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              marginTop: 1,
                            }}
                          >
                            <Globe size={13} strokeWidth={1.5} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  color: "var(--text)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {m.title.split(/\s*[-–—]\s*/)[0]}
                              </span>
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "var(--primary)",
                                  background:
                                    "var(--primary-soft, rgba(99,102,241,0.12))",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  lineHeight: 1.5,
                                }}
                              >
                                v{msVersionMap.get(m.id) ?? 1}
                              </span>
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
                              {new Date(m.savedAt).toLocaleDateString("en", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
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
                      Proposals
                    </span>
                  </div>
                  {proposals.length === 0 ? (
                    <div
                      style={{
                        padding: "4px 2px",
                        fontSize: 13,
                        color: "var(--muted)",
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
                              background:
                                "var(--primary-soft, rgba(99,102,241,0.12))",
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
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <span
                                style={{
                                  flex: 1,
                                  fontSize: 13,
                                  color: "var(--text)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {p.title.split(/\s*[-–—]\s*/)[0]}
                              </span>
                              <span
                                style={{
                                  flexShrink: 0,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "var(--primary)",
                                  background:
                                    "var(--primary-soft, rgba(99,102,241,0.12))",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  lineHeight: 1.5,
                                }}
                              >
                                v{propVersionMap.get(p.fileName) ?? 1}
                              </span>
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
                              {new Date(p.savedAt).toLocaleDateString("en", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
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
            <div
              style={{ position: "fixed", inset: 0, zIndex: 99998 }}
              onClick={() => setMenuMicrositeId(null)}
            />
            <div
              className="card"
              style={{
                position: "fixed",
                top: menuMicrositePos.top,
                right: menuMicrositePos.right,
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
            <div
              style={{ position: "fixed", inset: 0, zIndex: 99998 }}
              onClick={() => setMenuProposalId(null)}
            />
            <div
              className="card"
              style={{
                position: "fixed",
                top: menuProposalPos.top,
                right: menuProposalPos.right,
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
      {menuDocId &&
        createPortal(
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 99998 }}
              onClick={() => setMenuDocId(null)}
            />
            <div
              className="card"
              style={{
                position: "fixed",
                top: menuDocPos.top,
                right: menuDocPos.right,
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
          message={`Delete "${confirmDeleteDoc}"? This will remove it from the knowledge base and cannot be undone.`}
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
            position: "fixed",
            inset: 0,
            zIndex: 32000,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowProposalPicker(false);
          }}
        >
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              width: "100%",
              maxWidth: 440,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <p
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text)",
                  margin: 0,
                }}
              >
                Choose a Proposal
              </p>
              <button
                onClick={() => setShowProposalPicker(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--muted)",
                  display: "flex",
                }}
              >
                <Icon icon={X} size="md" />
              </button>
            </div>
            <div
              style={{
                padding: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {proposals.map((p) => (
                <button
                  key={p.fileName}
                  onClick={() => void handlePickProposal(p)}
                  disabled={loadingMicrositeFor === p.fileName}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 14px",
                    background: "var(--panel-soft)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  <p
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text)",
                      margin: 0,
                    }}
                  >
                    {p.title}
                  </p>
                  <p
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      margin: "2px 0 0",
                    }}
                  >
                    {loadingMicrositeFor === p.fileName
                      ? "Loading…"
                      : new Date(p.savedAt).toLocaleDateString()}
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
          proposalId={micrositeModal.proposal.fileName.replace(/\.md$/, "")}
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
              setUpdateBanner("");
            }
            collapseForPanel();
            try {
              const saved = await saveSuperClientMicrosite(
                apiKey,
                name,
                ast,
                proposalTitle,
              );
              setViewingMicrosite((prev) =>
                prev?.id === tempId
                  ? {
                      id: saved.id,
                      ast,
                      renderKey: `${saved.id}-${Date.now()}`,
                    }
                  : prev,
              );
              loadMicrosites();
              showToast("Microsite generated and saved");
            } catch (err) {
              showToast(
                `Failed to save microsite: ${(err as Error).message}`,
                "error",
              );
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

      {/* MicrositeV2 full-screen viewer */}
      {fullscreenMicrosite && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40000,
            background: "var(--panel)",
          }}
        >
          <MicrositeV2
            ast={fullscreenMicrosite}
            onBack={() => setFullscreenMicrosite(null)}
          />
        </div>
      )}

      {/* Toast notification */}
      {toastMsg && (
        <div
          key={toastMsg.key}
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 99999,
            padding: "10px 20px",
            borderRadius: 10,
            background: toastMsg.variant === "error" ? "#ef4444" : "#111",
            color: "#fff",
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
            animation: "scToastIn 0.2s ease",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {toastMsg.text}
        </div>
      )}
    </>
  );
}
