'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
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
} from 'lucide-react';
import { ThemeToggle } from '@/components/system/ThemeToggle';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { useSidebar } from '@/lib/sidebar-store';
import { MemorySection } from '@/components/chat/MemorySection';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { GenerateV2Modal } from '@/components/microsite/GenerateV2Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MicrositeV2, buildHtml } from '@/components/MicrositeV2';
import { PublishModal } from '@/components/microsite/editor/PublishModal';
import type { LayoutAST } from '@/types/presentation';
import { generationStore, type Generation } from '@/lib/generation-store';
import { uploadStore, type UploadEntry } from '@/lib/upload-store';
// UploadEntry is used inside UploadMessageCard only
import {
  getSuperClient,
  enrichSuperClientUrl,
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
} from '@/lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  generationId?: string;
  uploadId?: string;
}

function genId() {
  return Math.random().toString(36).slice(2);
}

// ArtifactCard — artifact capsule rendered in the chat message list
function ArtifactCard({
  gid,
  generations,
  onView,
}: {
  gid: string;
  generations: Generation[];
  onView: (gen: Generation) => void;
}) {
  const gen = generations.find((g) => g.id === gid);
  if (!gen) return null;
  const isMicrosite = gen.type === 'microsite';
  const isGenerating = gen.phase === 'generating';
  const isComplete = gen.phase === 'complete';
  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'var(--panel)',
        overflow: 'hidden',
        maxWidth: 300,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
        }}
      >
        <span
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--primary-soft, rgba(99,102,241,0.12))',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon icon={isMicrosite ? Globe : FileText} size="sm" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 500,
            }}
          >
            {isMicrosite ? 'Microsite' : 'Proposal'}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {gen.title}
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>
          {isGenerating && (
            <Loader
              size={13}
              style={{
                color: 'var(--primary)',
                animation: 'spin 1s linear infinite',
              }}
            />
          )}
          {isComplete && <CheckCircle size={13} style={{ color: '#22c55e' }} />}
        </div>
      </div>
      {/* Steps */}
      {gen.steps.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '7px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {gen.steps.slice(-4).map((step, i, arr) => {
            const isLast = i === arr.length - 1;
            return (
              <div
                key={i}
                style={{
                  fontSize: 11,
                  color: isLast && isGenerating ? 'var(--text)' : 'var(--muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                {isLast && isGenerating ? (
                  <span className="status-glyph" style={{ width: 6, height: 6, flexShrink: 0 }} />
                ) : (
                  <span style={{ color: '#22c55e', fontSize: 9, flexShrink: 0 }}>✓</span>
                )}
                {step}
              </div>
            );
          })}
        </div>
      )}
      {gen.phase === 'error' && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '7px 12px',
            fontSize: 11,
            color: 'var(--danger)',
          }}
        >
          {gen.error ?? 'Generation failed'}
        </div>
      )}
      {isComplete && (
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '8px 12px',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={() => onView(gen)}
            style={{
              background: 'var(--primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            View <ChevronRight size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// UploadMessageCard — upload progress card rendered in the chat thread (user side).
// Subscribes directly to uploadStore for XHR progress, and reads live doc status
// from `docs` (polled by the right panel) to mirror the exact same states.
function UploadMessageCard({ uploadId, docs }: { uploadId: string; docs: SuperClientFile[] }) {
  const [entry, setEntry] = useState<UploadEntry | undefined>(() => uploadStore.get(uploadId));
  useEffect(() => uploadStore.subscribe((all) => setEntry(all.find((u) => u.id === uploadId))), [uploadId]);
  if (!entry) return null;

  const isUploading = entry.status === 'uploading';
  const isFailed = entry.status === 'failed';

  // Once the XHR is done, mirror the server-side doc status from the right panel
  const doc = !isUploading ? docs.find((d) => d.fileName === entry.fileName) : undefined;
  const docStatus = doc?.status;

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '10px 14px',
        minWidth: 220,
        maxWidth: 300,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* File name row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        <FileText size={15} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--muted)' }} />
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {entry.fileName}
        </span>
      </div>

      {/* Progress / status — mirrors right panel exactly */}
      {isUploading && (
        <>
          <div
            style={{
              height: 3,
              borderRadius: 99,
              background: 'var(--border)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${entry.pct}%`,
                background: 'var(--primary)',
                borderRadius: 99,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          <span
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Icon icon={Loader} size="sm" style={{ animation: 'spin 1s linear infinite', width: 10, height: 10 }} />
            {entry.pct}% · Uploading…
          </span>
        </>
      )}

      {/* XHR done — show server-side extraction status */}
      {!isUploading && !isFailed && (!doc || docStatus === 'processing') && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <Icon icon={Loader} size="sm" style={{ animation: 'spin 1s linear infinite', width: 10, height: 10 }} />
          Processing…
        </span>
      )}

      {!isUploading && !isFailed && docStatus === 'extracted' && (
        <span
          style={{
            fontSize: 11,
            color: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <CheckCircle size={11} strokeWidth={2} style={{ flexShrink: 0 }} />
          Indexed
        </span>
      )}

      {!isUploading && !isFailed && docStatus === 'failed' && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--destructive, #ef4444)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          ✕ Extraction failed
        </span>
      )}

      {isFailed && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--destructive, #ef4444)',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          ✕ {entry.error ?? 'Upload failed'}
        </span>
      )}
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
  const [fullscreenMicrosite, setFullscreenMicrosite] = useState<LayoutAST | null>(null);
  const [micrositePanelWidth, setMicrositePanelWidth] = useState(640);
  const [micrositeDragging, setMicrositeDragging] = useState(false);
  const micrositeDragRef = useRef<{
    startX: number;
    startWidth: number;
  } | null>(null);

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
  const [loadingMicrositeFor, setLoadingMicrositeFor] = useState<string | null>(null);
  const [micrositeEditInput, setMicrositeEditInput] = useState('');
  const [micrositeEditing, setMicrositeEditing] = useState(false);
  const [micrositeEditBanner, setMicrositeEditBanner] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingLogo, setEditingLogo] = useState<{ base64: string; mediaType: string } | null>(null);
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

  const [generations, setGenerations] = useState<Generation[]>([]);
  const [changedSections, setChangedSections] = useState<Set<string>>(new Set());
  const [updateBanner, setUpdateBanner] = useState('');

  const [composerStage, setComposerStage] = useState<null | 'select-proposal' | 'configure'>(null);
  const [composerProposal, setComposerProposal] = useState<{
    proposal: SuperClientProposal;
    markdown: string;
  } | null>(null);
  const [composerInstructions, setComposerInstructions] = useState('');
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
      setMemoryKey(k => k + 1);
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

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Sync generation store → local state (runs even when component is unmounted via subscription)
  useEffect(() => generationStore.subscribe(setGenerations), []);

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    getSuperClient(apiKey, name)
      .then(({ meta: m, contextMd: ctx, history }) => {
        setMeta(m);
        setContextMd(ctx);
        const historyMsgs: Message[] = history.map((h: SuperClientHistoryEntry) => ({
          id: genId(),
          role: h.role,
          content: h.content,
        }));
        // Re-inject capsule messages for any active/complete generations for this client
        // (handles the case where the user navigated away and back during generation)
        const activeGens = generationStore.forClient(name);
        const genMsgs: Message[] = activeGens.map((gen) => ({
          id: `gen-msg-${gen.id}`,
          role: 'assistant',
          content: '',
          generationId: gen.id,
        }));
        // Re-inject upload cards for any active/recent uploads for this client
        const activeUploads = uploadStore.forClient(name);
        const uploadMsgs: Message[] = activeUploads.map((u) => ({
          id: `upload-msg-${u.id}`,
          role: 'user',
          content: '',
          uploadId: u.id,
        }));
        setMessages([...historyMsgs, ...uploadMsgs, ...genMsgs]);
        setMemoryKey((k) => k + 1);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [name, apiKey]);

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

  // Ctrl+Z = undo, Ctrl+Y / Ctrl+Shift+Z = redo for microsite editor
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) {
        if (canUndo) {
          e.preventDefault();
          void handleMicrositeRevert();
        }
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        if (canRedo) {
          e.preventDefault();
          void handleMicrositeRedo();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canUndo, canRedo]);

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
    setMessages((prev) => [...prev, { id: `upload-msg-${uploadId}`, role: 'user', content: '', uploadId }]);
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
    try {
      const ast = await getSuperClientMicrosite(apiKey, name, m.id);
      setViewingMicrosite({
        id: m.id,
        ast,
        renderKey: `${m.id}-${Date.now()}`,
      });
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

  async function handleMicrositeEdit() {
    const hasText = micrositeEditInput.trim().length > 0;
    const activeLogo: { base64: string; mediaType: string } | { url: string } | null =
      editingLogo ?? (editingLogoUrl.trim() ? { url: editingLogoUrl.trim() } : null);
    if (!viewingMicrosite || (!hasText && !activeLogo) || micrositeEditing) return;

    const instruction = micrositeEditInput.trim();
    setMicrositeEditing(true);
    setMicrositeEditBanner('');
    setCanUndo(false);
    setCanRedo(false);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    try {
      let finalHtml: string;

      if (hasText && activeLogo) {
        // Text edit first, then inject logo via deterministic server bypass
        await editSuperClientMicrosite(apiKey, name, viewingMicrosite.id, instruction);
        const logoSrc = 'url' in activeLogo ? activeLogo.url : `data:${activeLogo.mediaType};base64,${activeLogo.base64}`;
        const { html } = await editSuperClientMicrosite(apiKey, name, viewingMicrosite.id, `__LOGO_INJECT__:${logoSrc}`);
        finalHtml = html;
      } else if (hasText) {
        // Text edit only
        const { html } = await editSuperClientMicrosite(apiKey, name, viewingMicrosite.id, instruction);
        finalHtml = html;
      } else {
        // Logo-only: deterministic server-side injection, no LLM
        const logoSrc = 'url' in activeLogo! ? activeLogo!.url : `data:${(activeLogo as { base64: string; mediaType: string }).mediaType};base64,${(activeLogo as { base64: string; mediaType: string }).base64}`;
        const { html } = await editSuperClientMicrosite(apiKey, name, viewingMicrosite.id, `__LOGO_INJECT__:${logoSrc}`);
        finalHtml = html;
      }

      setMicrositeEditInput('');
      setEditingLogo(null);
      setEditingLogoUrl('');
      setShowEditingLogoUrlInput(false);
      setViewingMicrosite((prev) =>
        prev
          ? {
              ...prev,
              ast: {
                ...prev.ast,
                sections: [{ ...(prev.ast.sections[0] as object), customHtml: finalHtml } as unknown as typeof prev.ast.sections[0], ...prev.ast.sections.slice(1)],
              },
              renderKey: `${prev.id}-${Date.now()}`,
            }
          : null,
      );
      setCanUndo(true);
      setCanRedo(false);
      setMicrositeEditBanner('Microsite updated');
      undoTimerRef.current = setTimeout(() => {
        setMicrositeEditBanner('');
        setCanUndo(false);
      }, 30000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Edit failed';
      setMicrositeEditBanner(`Error: ${msg}`);
      setTimeout(() => setMicrositeEditBanner(''), 8000);
    } finally {
      setMicrositeEditing(false);
    }
  }

  async function handleMicrositeRevert() {
    if (!viewingMicrosite || micrositeEditing) return;
    setMicrositeEditing(true);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setCanUndo(false);
    setMicrositeEditBanner('');
    try {
      const { html } = await revertSuperClientMicrosite(apiKey, name, viewingMicrosite.id);
      setViewingMicrosite((prev) =>
        prev
          ? {
              ...prev,
              ast: {
                ...prev.ast,
                sections: [{ ...prev.ast.sections[0], customHtml: html }, ...prev.ast.sections.slice(1)],
              },
              renderKey: `${prev.id}-${Date.now()}`,
            }
          : null,
      );
      setCanRedo(true);
    } catch (err) {
      console.error('Microsite revert failed', err);
    } finally {
      setMicrositeEditing(false);
    }
  }

  async function handleMicrositeRedo() {
    if (!viewingMicrosite || micrositeEditing || !canRedo) return;
    setMicrositeEditing(true);
    setCanRedo(false);
    setMicrositeEditBanner('');
    try {
      const { html } = await revertSuperClientMicrosite(apiKey, name, viewingMicrosite.id);
      setViewingMicrosite((prev) =>
        prev
          ? {
              ...prev,
              ast: {
                ...prev.ast,
                sections: [{ ...prev.ast.sections[0], customHtml: html }, ...prev.ast.sections.slice(1)],
              },
              renderKey: `${prev.id}-${Date.now()}`,
            }
          : null,
      );
      setCanUndo(true);
    } catch (err) {
      console.error('Microsite redo failed', err);
    } finally {
      setMicrositeEditing(false);
    }
  }

  function handleMicrositeDragStart(e: React.MouseEvent) {
    e.preventDefault();
    micrositeDragRef.current = {
      startX: e.clientX,
      startWidth: micrositePanelWidth,
    };
    setMicrositeDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(ev: MouseEvent) {
      if (!micrositeDragRef.current) return;
      const delta = micrositeDragRef.current.startX - ev.clientX;
      const next = Math.max(320, Math.min(1100, micrositeDragRef.current.startWidth + delta));
      setMicrositePanelWidth(next);
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

  const MICROSITE_INTENT_RE =
    /\b(generate|create|make|build|design)\b[^.?!]*\bmicrosite\b|\bmicrosite\b[^.?!]*\b(generate|create|make|build|design)\b/i;
  const PROPOSAL_INTENT_RE = /\b(generate|create|write|draft|make|build)\s+(a\s+)?proposal\b/i;

  function dismissProposal() {
    // Abort any in-flight stream so the backend cannot save further changes
    abortRef.current?.abort();
    setViewingProposal(null);
    setChangedSections(new Set());
    setUpdateBanner('');
    restoreSidebar();
  }

  function dismissMicrosite() {
    setViewingMicrosite(null);
    restoreSidebar();
    setMicrositeEditInput('');
    setMicrositeEditBanner('');
    setCanUndo(false);
    setCanRedo(false);
    setEditingLogo(null);
    setEditingLogoUrl('');
    setShowEditingLogoUrlInput(false);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }

  function resetComposer() {
    setComposerStage(null);
    setComposerProposal(null);
    setComposerInstructions('');
    setComposerImage(null);
    setComposerLogo(null);
    setComposerLogoUrl('');
    setShowLogoUrlInput(false);
    setComposerMessage('');
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
        if (!ctx) { onDone(dataUrl.split(',')[1], file.type); return; }
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

  function injectLogoIntoHtml(html: string, logo: { base64: string; mediaType: string } | { url: string }): string {
    // Remove ALL previously injected logo divs (any attribute order) and their companion scripts
    let stripped = html
      .replace(/<div[^>]*id="__brand-logo__"[^>]*>[\s\S]*?<\/div>/gi, '')
      .replace(/<script[^>]*>\s*\/\*\s*__logo-inject__/gi, (m) => {
        // find and remove the whole script block that starts with this marker
        return m; // placeholder; handled by full-block regex below
      });
    // Remove the full companion script block by its unique marker comment
    stripped = stripped.replace(/<script[^>]*>\/\*__logo-inject__\*\/[\s\S]*?<\/script>/gi, '');

    const src = 'url' in logo ? logo.url : `data:${logo.mediaType};base64,${logo.base64}`;
    const logoHtml = `<div id="__brand-logo__" style="position:fixed;top:16px;left:20px;z-index:2147483647;pointer-events:none;"><img src="${src}" style="height:44px;width:auto;object-fit:contain;display:block;" alt="" /></div>`;
    // Hide provider attribution in both footer ("PREPARED BY") and header brand/logo element
    const hideProviderScript = `<script>/*__logo-inject__*/(function(){function h(){var els=document.querySelectorAll('*');for(var i=0;i<els.length;i++){var t=(els[i].children.length===0?els[i].textContent||'':'');if(/prepared\\s*by/i.test(t)){var p=els[i].parentElement;(p&&p!==document.body?p:els[i]).style.display='none';}}var hdr=document.querySelector('header,nav,[class*="header"],[class*="navbar"]');if(hdr){var brand=hdr.querySelector('[class*="logo"],[class*="brand"],[class*="navbar-brand"]');if(brand){brand.style.visibility='hidden';}else{var first=hdr.firstElementChild;if(first&&first.id!=='__brand-logo__'){first.style.visibility='hidden';}}}}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',h);}else{h();}})()</script>`;
    const injection = logoHtml + hideProviderScript;
    if (/<body[^>]*>/i.test(stripped)) {
      return stripped.replace(/(<body[^>]*>)/i, `$1${injection}`);
    }
    return injection + stripped;
  }

  async function handleComposerSelectProposal(p: SuperClientProposal) {
    setLoadingMicrositeFor(p.fileName);
    try {
      const markdown = await getSuperClientProposal(apiKey, name, p.fileName);
      setComposerProposal({ proposal: p, markdown });
      setComposerStage('configure');
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

  async function generateComposerMicrosite() {
    if (!composerProposal || !name) return;

    const msGenId = genId();
    const msAbort = new AbortController();
    const proposalTitle = composerProposal.proposal.title;
    const proposalMarkdown = composerProposal.markdown;
    const proposalInstructions = composerInstructions || undefined;
    const proposalImage = composerImage ?? undefined;
    const proposalLogo: { base64: string; mediaType: string } | { url: string } | undefined =
      composerLogo ?? (composerLogoUrl.trim() ? { url: composerLogoUrl.trim() } : undefined);
    const proposalId = composerProposal.proposal.fileName.replace(/\.md$/, '');

    // Start in the module store (survives navigation)
    generationStore.start({
      id: msGenId,
      clientSlug: name,
      type: 'microsite',
      title: proposalTitle,
      abort: () => msAbort.abort(),
    });

    // Add artifact message to chat and collapse composer immediately
    setMessages((prev) => [
      ...prev,
      {
        id: `gen-msg-${msGenId}`,
        role: 'assistant',
        content: '',
        generationId: msGenId,
      },
    ]);
    resetComposer();

    try {
      await generateMicrositeV2Stream(apiKey, name, proposalId, {
        proposalMarkdown,
        userPrompt: proposalInstructions,
        referenceImage: proposalImage,
        signal: msAbort.signal,
        onEvent: (evt) => {
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
            // Inject logo into customHtml if provided
            if (proposalLogo && ast.sections?.[0]) {
              const section = ast.sections[0] as unknown as { customHtml?: string };
              if (section.customHtml) {
                const patched = { ...(ast.sections[0] as object), customHtml: injectLogoIntoHtml(section.customHtml, proposalLogo) };
                ast = {
                  ...ast,
                  sections: [patched as unknown as typeof ast.sections[0], ...ast.sections.slice(1)],
                };
              }
            }
            // Open panel immediately with the stream AST — don't block on save
            const tempId = `preview-${msGenId}`;
            setViewingMicrosite({
              id: tempId,
              ast,
              renderKey: `${tempId}-${Date.now()}`,
            });
            setViewingProposal(null);
            setChangedSections(new Set());
            setUpdateBanner('');
            setActiveRightTab('artifacts');
            collapseForPanel();
            void (async () => {
              try {
                const saved = await saveSuperClientMicrosite(apiKey, name, ast, proposalTitle);
                generationStore.complete(msGenId, { micrositeId: saved.id, ast }, saved.title);
                // Swap temp ID for the real saved ID
                setViewingMicrosite((prev) =>
                  prev?.id === tempId
                    ? {
                        id: saved.id,
                        ast,
                        renderKey: `${saved.id}-${Date.now()}`,
                      }
                    : prev,
                );
                // Optimistic update so the artifacts tab is populated immediately
                setMicrosites((prev) => {
                  if (prev.some((m) => m.id === saved.id)) return prev;
                  return [saved, ...prev];
                });
                loadMicrosites(); // sync with server
                showToast('Microsite generated and saved');
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
      }
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const isQuestion = /^(how|what|why|when|where|who|is|are|can|could|would|does|do|did|will|should)\b/i.test(text);
    if (!isQuestion && MICROSITE_INTENT_RE.test(text)) {
      const reply =
        proposals.length === 0
          ? "You'll need a proposal first — ask me to generate one for this client."
          : proposals.length === 1
            ? 'Sure! Select the proposal below to get started.'
            : "Sure! Pick a proposal below and I'll walk you through it.";
      setMessages((prev) => [...prev, { id: genId(), role: 'user', content: text }]);
      setInput('');
      // Extract any context the user included alongside the trigger word and pre-fill instructions
      const extracted = text
        .replace(/\b(generate|create|make|build|design)\b/gi, '')
        .replace(/\bmicrosite\b/gi, '')
        .replace(/\b(a|an|the|me|my|for|please|can you|could you)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (extracted) setComposerInstructions(extracted);
      if (proposals.length > 0) {
        setComposerMessage(reply);
        setComposerStage('select-proposal');
      } else {
        setMessages((prev) => [...prev, { id: genId(), role: 'assistant', content: reply }]);
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
        type: 'proposal',
        title: 'Proposal',
        abort: () => abortRef.current?.abort(),
      });
    }

    const userMsg: Message = { id: genId(), role: 'user', content: text };
    const assistantMsgId = genId();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      streaming: true,
      ...(proposalGenId ? { generationId: proposalGenId } : {}),
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
          if (evt.type === 'chunk' && evt.text) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, content: m.content + evt.text } : m)),
            );
          }
          if (evt.type === 'done') {
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
                  type: 'proposal',
                  title: evt.proposalSaved.title,
                  abort: () => {},
                });
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsgId ? { ...m, generationId: effectiveGenId! } : m)),
                );
              }
              generationStore.complete(
                effectiveGenId,
                { fileName: evt.proposalSaved.fileName },
                evt.proposalSaved.title,
              );
              setActiveRightTab('artifacts');
              // Optimistic update so the artifacts tab is populated immediately
              setProposals((prev) => {
                if (prev.some((p) => p.fileName === evt.proposalSaved!.fileName)) return prev;
                return [evt.proposalSaved!, ...prev];
              });
              loadProposals(); // sync with server
              void openProposal(evt.proposalSaved!);
            } else if (proposalGenId) {
              // Proposal intent matched but LLM didn't generate one — remove the capsule
              generationStore.dismiss(proposalGenId);
              setMessages((prev) => prev.filter((m) => m.generationId !== proposalGenId));
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
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        Loading…
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

  return (
    <>
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
        {/* Center — chat */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            overflow: 'hidden',
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
                onClick={() => setRightPanelOpen((v) => !v)}
                title={rightPanelOpen ? 'Hide panel' : 'Show panel'}
              >
                <Icon icon={rightPanelOpen ? ChevronRight : ChevronLeft} size="sm" />
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
                  // Strip XML artifact tags from the streaming display so raw markup isn't shown
                  const visibleContent =
                    msg.streaming && msg.role === 'assistant'
                      ? msg.content.replace(/<(proposal|section-update)[^>]*>[\s\S]*$/, '').trim()
                      : msg.content;
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
                    return (
                      <div key={msg.id} className="chat-v2-message chat-v2-message--user">
                        <div className="chat-v2-bubble">{visibleContent}</div>
                      </div>
                    );
                  }

                  // Assistant message — column wrapper needed to stack bubble + artifact card
                  return (
                    <div key={msg.id} className="chat-v2-message chat-v2-message--assistant">
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
                                {msg.streaming && <span className="chat-cursor" />}
                              </>
                            )}
                          </div>
                        )}
                        {/* Artifact card */}
                        {hasArtifact && (
                          <ArtifactCard
                            gid={msg.generationId!}
                            generations={generations}
                            onView={(gen) => {
                              if (gen.type === 'microsite' && gen.result?.micrositeId) {
                                // Always fetch from server so edits made after generation are reflected
                                const found = microsites.find((m) => m.id === gen.result!.micrositeId);
                                if (!found) {
                                  showToast('This microsite has been deleted', 'error');
                                } else {
                                  void handleOpenMicrosite(found);
                                }
                              } else if (gen.type === 'proposal' && gen.result?.fileName) {
                                void openProposal({
                                  fileName: gen.result.fileName,
                                  title: gen.title,
                                  savedAt: '',
                                });
                              }
                            }}
                          />
                        )}
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
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                  background: 'var(--panel-soft)',
                }}
              >
                {composerMessage && (
                  <div
                    style={{
                      display: 'inline-block',
                      marginBottom: 10,
                      padding: '8px 12px',
                      borderRadius: '12px 12px 12px 4px',
                      background: 'var(--panel)',
                      border: '1px solid var(--border)',
                      fontSize: 13,
                      color: 'var(--text)',
                      lineHeight: 1.5,
                    }}
                  >
                    {composerMessage}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text)',
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Sparkles size={13} /> Pick a proposal
                  </p>
                  <button
                    onClick={resetComposer}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--muted)',
                      display: 'flex',
                      padding: 0,
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {proposals.map((p) => (
                    <button
                      key={p.fileName}
                      onClick={() => void handleComposerSelectProposal(p)}
                      disabled={loadingMicrositeFor === p.fileName}
                      style={{
                        textAlign: 'left',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        background: 'var(--panel)',
                        cursor: 'pointer',
                        width: '100%',
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
            )}

            {/* Composer expansion — configure */}
            {composerStage === 'configure' && composerProposal && (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  padding: 12,
                  background: 'var(--panel-soft)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <p
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text)',
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Sparkles size={13} /> {composerProposal.proposal.title}
                  </p>
                  <button
                    onClick={resetComposer}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--muted)',
                      display: 'flex',
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
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 8,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => composerImageInputRef.current?.click()}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '5px 10px',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: composerImage ? 'var(--primary)' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <ImagePlus size={12} />
                      {composerImage ? 'Image attached ✓' : 'Reference image'}
                    </button>
                    <button
                      onClick={() => composerLogoInputRef.current?.click()}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '5px 10px',
                        cursor: 'pointer',
                        fontSize: 12,
                        color: composerLogo ? 'var(--primary)' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <ImagePlus size={12} />
                      {composerLogo ? 'Logo attached ✓' : 'Choose logo'}
                    </button>
                    {!composerLogo && (
                      showLogoUrlInput ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            autoFocus
                            type="url"
                            value={composerLogoUrl}
                            onChange={(e) => setComposerLogoUrl(e.target.value)}
                            placeholder="Paste logo URL…"
                            style={{
                              fontSize: 12,
                              padding: '4px 8px',
                              borderRadius: 6,
                              border: '1px solid var(--border)',
                              background: 'var(--panel)',
                              color: 'var(--text)',
                              outline: 'none',
                              width: 180,
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setShowLogoUrlInput(false);
                              if (e.key === 'Escape') { setComposerLogoUrl(''); setShowLogoUrlInput(false); }
                            }}
                          />
                          {composerLogoUrl.trim() && (
                            <button
                              onClick={() => setShowLogoUrlInput(false)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 11, padding: '4px 6px' }}
                            >
                              ✓
                            </button>
                          )}
                          <button
                            onClick={() => { setComposerLogoUrl(''); setShowLogoUrlInput(false); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 4 }}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowLogoUrlInput(true)}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            padding: '5px 10px',
                            cursor: 'pointer',
                            fontSize: 12,
                            color: composerLogoUrl.trim() ? 'var(--primary)' : 'var(--muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <LinkIcon size={12} />
                          {composerLogoUrl.trim() ? 'Logo URL set ✓' : 'Logo URL'}
                        </button>
                      )
                    )}
                  </div>
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
                    }}
                  >
                    <Sparkles size={13} /> Generate Microsite
                  </button>
                </div>
              </div>
            )}

            {/* Textarea row — hidden while composer expansion is active */}
            {!composerStage && (
              <div
                className="chat-v2-composer"
                style={
                  viewingProposal || viewingMicrosite
                    ? { flexDirection: 'column', alignItems: 'stretch', gap: 0 }
                    : undefined
                }
              >
                {/* Proposal chip — lives inside the composer bubble */}
                {viewingProposal && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px 4px 6px 6px',
                    }}
                  >
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 4px 3px 8px',
                        borderRadius: 20,
                        background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)',
                        fontSize: 11,
                        color: 'var(--primary)',
                        fontWeight: 500,
                        maxWidth: '100%',
                        overflow: 'hidden',
                      }}
                    >
                      <FileText size={10} style={{ flexShrink: 0 }} />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Editing: Proposal
                      </span>
                      <button
                        onClick={dismissProposal}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--primary)',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '2px 3px',
                          borderRadius: 10,
                          opacity: 0.7,
                          flexShrink: 0,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = '0.7';
                        }}
                        title="Dismiss proposal"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                )}
                {/* Microsite chip + logo buttons inline */}
                {viewingMicrosite && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 6px 6px', flexWrap: 'wrap' }}>
                    {/* Chip */}
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '3px 4px 3px 8px',
                        borderRadius: 20,
                        background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)',
                        fontSize: 11,
                        color: 'var(--primary)',
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      <Globe size={10} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                        Editing:{' '}
                        {(lastMicrositeRef.current?.ast.meta as { title?: string })?.title ?? 'Microsite'}
                      </span>
                      <button
                        onClick={dismissMicrosite}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', display: 'flex', alignItems: 'center', padding: '2px 3px', borderRadius: 10, opacity: 0.7, flexShrink: 0 }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
                        title="Close microsite"
                      >
                        <X size={10} />
                      </button>
                    </div>
                    {/* Update logo button */}
                    <button
                      onClick={() => editingLogoInputRef.current?.click()}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: editingLogo ? 'var(--primary)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                    >
                      <ImagePlus size={11} />
                      {editingLogo ? 'Logo attached ✓' : 'Update logo'}
                    </button>
                    <input
                      ref={editingLogoInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        compressLogoFile(f, (base64, mediaType) => {
                          setEditingLogo({ base64, mediaType: mediaType as 'image/png' });
                          setEditingLogoUrl('');
                        });
                        e.target.value = '';
                      }}
                    />
                    {/* Logo URL */}
                    {!editingLogo && (
                      showEditingLogoUrlInput ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            autoFocus
                            type="url"
                            value={editingLogoUrl}
                            onChange={(e) => setEditingLogoUrl(e.target.value)}
                            placeholder="Paste logo URL…"
                            style={{ fontSize: 11, padding: '3px 7px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--text)', outline: 'none', width: 160 }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') setShowEditingLogoUrlInput(false);
                              if (e.key === 'Escape') { setEditingLogoUrl(''); setShowEditingLogoUrlInput(false); }
                            }}
                          />
                          {editingLogoUrl.trim() && (
                            <button onClick={() => setShowEditingLogoUrlInput(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 11, padding: '3px 5px' }}>✓</button>
                          )}
                          <button onClick={() => { setEditingLogoUrl(''); setShowEditingLogoUrlInput(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 3 }}>
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowEditingLogoUrlInput(true)}
                          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11, color: editingLogoUrl.trim() ? 'var(--primary)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                        >
                          <LinkIcon size={11} />
                          {editingLogoUrl.trim() ? 'Logo URL set ✓' : 'Logo URL'}
                        </button>
                      )
                    )}
                    {(editingLogo || editingLogoUrl.trim()) && !showEditingLogoUrlInput && (
                      <button
                        onClick={() => { setEditingLogo(null); setEditingLogoUrl(''); setShowEditingLogoUrlInput(false); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 2 }}
                        title="Remove logo"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                )}
                {/* Microsite edit result banner */}
                {viewingMicrosite && micrositeEditBanner.startsWith('Error:') && (
                  <span
                    onClick={() => setMicrositeEditBanner('')}
                    style={{
                      display: 'block',
                      fontSize: 12,
                      color: 'var(--destructive, #ef4444)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      padding: '4px 12px 0',
                      cursor: 'pointer',
                    }}
                    title="Click to dismiss"
                  >
                    {micrositeEditBanner}
                  </span>
                )}
                {/* Input row */}
                <div style={{ display: 'flex', alignItems: 'flex-end', flex: 1 }}>
                  {/* Attach (+) button — left side, chat/proposal mode only */}
                  {!viewingMicrosite && (
                    <div style={{ position: 'relative', flexShrink: 0 }}>
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
                          padding: '6px 8px',
                          borderRadius: 8,
                          marginBottom: 2,
                          opacity: 0.65,
                          transition: 'opacity 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.opacity = attachMenuOpen ? '1' : '0.65';
                        }}
                      >
                        <Plus size={18} strokeWidth={1.75} />
                      </button>
                      {attachMenuOpen && (
                        <>
                          {/* Backdrop to close on outside click */}
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
                              <FileText size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'var(--muted)' }} />
                              Upload document
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <textarea
                    ref={textareaRef}
                    className="chat-v2-input"
                    value={viewingMicrosite ? micrositeEditInput : input}
                    onChange={(e) =>
                      viewingMicrosite ? setMicrositeEditInput(e.target.value) : setInput(e.target.value)
                    }
                    onKeyDown={
                      viewingMicrosite
                        ? (e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void handleMicrositeEdit();
                            }
                          }
                        : handleKeyDown
                    }
                    placeholder={
                      viewingMicrosite
                        ? 'Edit this microsite…'
                        : viewingProposal
                          ? 'Ask to edit or refine this proposal…'
                          : `Ask about ${meta.displayName}…`
                    }
                    disabled={viewingMicrosite ? micrositeEditing : false}
                    rows={1}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                    }}
                  />
                  <button
                    className="chat-v2-send-btn"
                    onClick={() => (viewingMicrosite ? void handleMicrositeEdit() : void sendMessage())}
                    disabled={
                      viewingMicrosite
                        ? micrositeEditing || (!micrositeEditInput.trim() && !editingLogo && !editingLogoUrl.trim())
                        : streaming || !input.trim()
                    }
                  >
                    <Icon
                      icon={viewingMicrosite && micrositeEditing ? Loader : ArrowUp}
                      size="sm"
                      style={
                        viewingMicrosite && micrositeEditing ? { animation: 'spin 1s linear infinite' } : undefined
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
            )}
          </div>
        </div>

        {/* Microsite slide-in panel */}
        <div
          style={{
            width: viewingMicrosite ? micrositePanelWidth : 0,
            minWidth: 0,
            flexShrink: 0,
            overflow: 'hidden',
            borderLeft: viewingMicrosite ? '1px solid var(--border)' : 'none',
            transition: micrositeDragging ? 'none' : 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {lastMicrositeRef.current && (
            <div
              style={{
                width: micrositePanelWidth,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                position: 'relative',
              }}
            >
              {/* Drag handle */}
              <div
                onMouseDown={handleMicrositeDragStart}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 8,
                  cursor: 'col-resize',
                  zIndex: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    width: 3,
                    height: 36,
                    borderRadius: 2,
                    background: micrositeDragging ? 'var(--primary)' : 'var(--border)',
                    transition: 'background 0.15s',
                  }}
                />
              </div>
              {/* Header */}
              <div
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0,
                }}
              >
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text)',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Globe size={14} style={{ color: 'var(--primary)' }} />
                  {(lastMicrositeRef.current!.ast.meta as { title?: string })?.title ?? 'Microsite'}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => void handleMicrositeRevert()}
                    disabled={micrositeEditing || !canUndo}
                    title="Undo last edit (Ctrl+Z)"
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
                  <button
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
                style={{
                  flex: 1,
                  minHeight: 0,
                  background: '#fff',
                  position: 'relative',
                }}
              >
                <iframe
                  key={lastMicrositeRef.current!.renderKey}
                  srcDoc={
                    (
                      lastMicrositeRef.current!.ast.sections?.[0] as {
                        customHtml?: string;
                      }
                    )?.customHtml ?? ''
                  }
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    colorScheme: 'light',
                  }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                />
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
          style={{
            width: viewingProposal ? 560 : 0,
            minWidth: 0,
            flexShrink: 0,
            overflow: 'hidden',
            borderLeft: viewingProposal ? '1px solid var(--border)' : 'none',
            transition: 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--panel)',
          }}
        >
          {lastProposalRef.current && (
            <div
              style={{
                width: 560,
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              <div
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexShrink: 0,
                }}
              >
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text)',
                    margin: 0,
                  }}
                >
                  {lastProposalRef.current!.title}
                </p>
                <button
                  onClick={dismissProposal}
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

        {/* Right panel — client info */}
        <div
          style={{
            width: viewingProposal || viewingMicrosite || !rightPanelOpen ? 0 : 320,
            minWidth: 0,
            borderLeft: viewingProposal || viewingMicrosite || !rightPanelOpen ? 'none' : '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflow: 'hidden',
            transition: 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div className="client-panel">
            {/* ── Tab bar ── */}
            <div className="client-panel-tabs" style={{ height: 52 }}>
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
                {microsites.length + proposals.length > 0 && (
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
                    {microsites.length + proposals.length}
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
                  <div style={{ padding: '14px 12px 10px 16px' }}>
                    <div style={{ fontSize: 14, fontWeight: 400, color: 'var(--text)' }}>
                      {meta?.displayName ?? name}
                    </div>

                    {urlEditMode ? (
                      <div style={{ marginTop: 6 }}>
                        <input
                          type="url"
                          value={urlInput}
                          onChange={e => setUrlInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && urlInput.trim() && !enriching) {
                              if (contextMd.trim()) {
                                setEnrichConfirmPending(true);
                              } else {
                                void handleEnrichUrl();
                              }
                            }
                            if (e.key === 'Escape') { setUrlEditMode(false); setEnrichError(''); }
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
                            borderRadius: 4,
                            color: 'var(--text)',
                            boxSizing: 'border-box',
                          }}
                        />
                        {enrichError && (
                          <div style={{ fontSize: 11, color: '#e55', marginTop: 3 }}>
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
                              borderRadius: 4,
                              cursor: enriching || !urlInput.trim() ? 'not-allowed' : 'pointer',
                              opacity: enriching || !urlInput.trim() ? 0.6 : 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {enriching && <Loader size={11} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />}
                            {enriching ? 'Fetching…' : 'Fetch'}
                          </button>
                          <button
                            disabled={enriching}
                            onClick={() => { setUrlEditMode(false); setEnrichError(''); }}
                            style={{
                              fontSize: 12,
                              padding: '3px 8px',
                              background: 'none',
                              border: '1px solid var(--border)',
                              borderRadius: 4,
                              color: 'var(--muted)',
                              cursor: enriching ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : meta?.url ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <a
                          href={meta.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 13,
                            fontWeight: 400,
                            color: 'var(--muted)',
                            textDecoration: 'none',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {meta.url.replace(/^https?:\/\//, '')}
                        </a>
                        <button
                          onClick={() => { setUrlInput(meta.url ?? ''); setUrlEditMode(true); setEnrichError(''); }}
                          title="Edit website URL"
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '1px 2px',
                            color: 'var(--muted)',
                            flexShrink: 0,
                            display: 'flex',
                            lineHeight: 1,
                          }}
                        >
                          <Pencil size={12} strokeWidth={1.5} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setUrlInput(''); setUrlEditMode(true); setEnrichError(''); }}
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: 'var(--muted)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                          textDecorationStyle: 'dashed',
                          textUnderlineOffset: 2,
                        }}
                      >
                        Add website URL
                      </button>
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
                      <span style={{ flex: 1 }} />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        title="Upload document"
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: uploading ? 'not-allowed' : 'pointer',
                          padding: '2px 4px',
                          color: 'var(--muted)',
                          display: 'flex',
                          lineHeight: 1,
                        }}
                      >
                        {uploading ? (
                          <span style={{ fontSize: 10 }}>{uploadPct}%</span>
                        ) : (
                          <Plus size={16} strokeWidth={1.5} />
                        )}
                      </button>
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
                              <span className="client-panel-row-name">{doc.fileName}</span>
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
                <div className="client-panel-list" style={{ padding: '6px 12px' }}>
                  {/* Microsites */}
                  <div className="brief-panel-section-header" style={{ padding: '12px 4px 2px' }}>
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
                    <span style={{ flex: 1 }} />
                    <button
                      onClick={() => void handleGenerateMicrosite()}
                      disabled={proposals.length === 0 || loadingMicrositeFor !== null}
                      title="Generate microsite"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: proposals.length === 0 ? 'not-allowed' : 'pointer',
                        padding: '2px 4px',
                        color: 'var(--muted)',
                        display: 'flex',
                        lineHeight: 1,
                        opacity: proposals.length === 0 ? 0.3 : 1,
                      }}
                    >
                      <Plus size={16} strokeWidth={1.5} />
                    </button>
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
                  <div className="brief-panel-section-header" style={{ padding: '10px 4px 2px' }}>
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

      {/* MicrositeV2 full-screen viewer */}
      {fullscreenMicrosite && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40000,
            background: 'var(--panel)',
          }}
        >
          <MicrositeV2 ast={fullscreenMicrosite} onBack={() => setFullscreenMicrosite(null)} />
        </div>
      )}

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
