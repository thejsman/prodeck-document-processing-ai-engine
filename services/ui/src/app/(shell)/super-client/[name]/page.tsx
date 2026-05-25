'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, Send, Upload, X, CheckCircle, AlertCircle, Loader, Sparkles, Globe, ImagePlus } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { MemorySection } from '@/components/chat/MemorySection';
import ReactMarkdown from 'react-markdown';
import { GenerateV2Modal } from '@/components/microsite/GenerateV2Modal';
import { MicrositeV2 } from '@/components/MicrositeV2';
import type { LayoutAST } from '@/types/presentation';
import {
  getSuperClient,
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
}

function genId() {
  return Math.random().toString(36).slice(2);
}

export default function SuperClientPage() {
  const { name } = useParams<{ name: string }>();
  const { apiKey } = useAuth();

  const [meta, setMeta] = useState<SuperClientMeta | null>(null);
  const [contextMd, setContextMd] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [docs, setDocs] = useState<SuperClientFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [proposals, setProposals] = useState<SuperClientProposal[]>([]);
  const [viewingProposal, setViewingProposal] = useState<{ fileName: string; title: string; content: string } | null>(null);

  const [microsites, setMicrosites] = useState<SuperClientMicrosite[]>([]);
  const [viewingMicrosite, setViewingMicrosite] = useState<LayoutAST | null>(null);
  const [micrositeModal, setMicrositeModal] = useState<{ proposal: SuperClientProposal; markdown: string } | null>(null);
  const [showProposalPicker, setShowProposalPicker] = useState(false);
  const [loadingMicrositeFor, setLoadingMicrositeFor] = useState<string | null>(null);

  const [proposalGenerating, setProposalGenerating] = useState(false);
  const [proposalStep, setProposalStep] = useState(0);
  const proposalStepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [changedSections, setChangedSections] = useState<Set<string>>(new Set());
  const [updateBanner, setUpdateBanner] = useState('');

  const [composerStage, setComposerStage] = useState<null | 'select-proposal' | 'configure' | 'generating'>(null);
  const [composerProposal, setComposerProposal] = useState<{ proposal: SuperClientProposal; markdown: string } | null>(null);
  const [composerInstructions, setComposerInstructions] = useState('');
  const [composerImage, setComposerImage] = useState<{ base64: string; mediaType: string } | null>(null);
  const [composerProgress, setComposerProgress] = useState<string[]>([]);
  const [composerMessage, setComposerMessage] = useState('');
  const composerImageInputRef = useRef<HTMLInputElement | null>(null);
  const composerAbortRef = useRef<AbortController | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    getSuperClient(apiKey, name)
      .then(({ meta: m, contextMd: ctx, history }) => {
        setMeta(m);
        setContextMd(ctx);
        setMessages(
          history.map((h: SuperClientHistoryEntry) => ({
            id: genId(),
            role: h.role,
            content: h.content,
          })),
        );
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [name, apiKey]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadDocs = useCallback(() => {
    if (!name) return;
    listSuperClientDocuments(apiKey, name).then(setDocs).catch(() => {});
  }, [name, apiKey]);

  const loadProposals = useCallback(() => {
    if (!name) return;
    listSuperClientProposals(apiKey, name).then(setProposals).catch(() => {});
  }, [name, apiKey]);

  const loadMicrosites = useCallback(() => {
    if (!name) return;
    listSuperClientMicrosites(apiKey, name).then(setMicrosites).catch(() => {});
  }, [name, apiKey]);

  useEffect(() => {
    loadDocs();
    loadProposals();
    loadMicrosites();
  }, [loadDocs, loadProposals, loadMicrosites]);

  useEffect(() => {
    const hasProcessing = docs.some((d) => d.status === 'processing');
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(loadDocs, 3000);
    } else if (!hasProcessing && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [docs, loadDocs]);

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
          if (idx !== -1) next[idx] = f; else next.push(f);
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

  async function handleDeleteDoc(fileName: string) {
    if (!name) return;
    try {
      await deleteSuperClientDocument(apiKey, name, fileName);
      setDocs((prev) => prev.filter((d) => d.fileName !== fileName));
    } catch (err) {
      console.error('Delete failed', err);
    }
  }

  async function openProposal(proposal: SuperClientProposal) {
    if (!name) return;
    try {
      const content = await getSuperClientProposal(apiKey, name, proposal.fileName);
      setChangedSections(new Set());
      setUpdateBanner('');
      setViewingProposal({ fileName: proposal.fileName, title: proposal.title, content });
    } catch (err) {
      console.error('Failed to load proposal', err);
    }
  }

  async function handleDeleteProposal(fileName: string) {
    if (!name) return;
    try {
      await deleteSuperClientProposal(apiKey, name, fileName);
      setProposals((prev) => prev.filter((p) => p.fileName !== fileName));
      if (viewingProposal) { setViewingProposal(null); setChangedSections(new Set()); setUpdateBanner(''); }
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
        console.error('Failed to load proposal', err);
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
      console.error('Failed to load proposal', err);
    } finally {
      setLoadingMicrositeFor(null);
    }
  }

  async function handleOpenMicrosite(m: SuperClientMicrosite) {
    if (!name) return;
    try {
      const ast = await getSuperClientMicrosite(apiKey, name, m.id);
      setViewingMicrosite(ast);
    } catch (err) {
      console.error('Failed to load microsite', err);
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
    const changed = new Set<string>();
    for (const s of newSections) {
      if (oldMap.get(s.heading) !== s.body) changed.add(s.heading);
    }
    return changed;
  }

  const MICROSITE_INTENT_RE = /\bmicrosite\b/i;
  const PROPOSAL_INTENT_RE = /\b(generate|create|write|draft|make|build)\s+(a\s+)?proposal\b/i;
  const PROPOSAL_STEPS = [
    'Analyzing client context…',
    'Generating proposal outline…',
    'Writing executive summary…',
    'Drafting service sections…',
    'Finalizing proposal…',
  ];

  useEffect(() => {
    if (proposalGenerating && streaming) {
      setProposalStep(0);
      proposalStepTimerRef.current = setInterval(() => {
        setProposalStep((prev) => Math.min(prev + 1, PROPOSAL_STEPS.length - 1));
      }, 1600);
    } else {
      if (proposalStepTimerRef.current) {
        clearInterval(proposalStepTimerRef.current);
        proposalStepTimerRef.current = null;
      }
      setProposalStep(0);
    }
    return () => {
      if (proposalStepTimerRef.current) clearInterval(proposalStepTimerRef.current);
    };
  }, [proposalGenerating, streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetComposer() {
    setComposerStage(null);
    setComposerProposal(null);
    setComposerInstructions('');
    setComposerImage(null);
    setComposerProgress([]);
    setComposerMessage('');
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
    setComposerStage('generating');
    setComposerProgress(['Starting…']);
    composerAbortRef.current = new AbortController();
    const proposalId = composerProposal.proposal.fileName.replace(/\.md$/, '');
    try {
      await generateMicrositeV2Stream(apiKey, name, proposalId, {
        proposalMarkdown: composerProposal.markdown,
        userPrompt: composerInstructions || undefined,
        referenceImage: composerImage ?? undefined,
        signal: composerAbortRef.current.signal,
        onEvent: (evt) => {
          if (evt.type === 'progress' && evt.message) {
            setComposerProgress((prev) => [...prev, evt.message!]);
          }
          if (evt.type === 'plan' && evt.totalSections) {
            setComposerProgress((prev) => [...prev, `Building ${evt.totalSections} sections…`]);
          }
          if (evt.type === 'section' && evt.heading) {
            setComposerProgress((prev) => [...prev, `✓ ${evt.heading}`]);
          }
          if (evt.type === 'complete' && evt.ast) {
            const ast = evt.ast as LayoutAST;
            const title = composerProposal!.proposal.title;
            void (async () => {
              try {
                const saved = await saveSuperClientMicrosite(apiKey, name, ast, title);
                setMicrosites((prev) => [saved, ...prev]);
                setViewingMicrosite(ast);
              } catch (err) {
                console.error('Failed to save microsite', err);
              } finally {
                resetComposer();
              }
            })();
          }
          if (evt.type === 'error') {
            setComposerProgress((prev) => [...prev, `Error: ${evt.message ?? 'Unknown error'}`]);
          }
        },
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setComposerProgress((prev) => [...prev, `Error: ${(err as Error).message}`]);
      }
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    if (MICROSITE_INTENT_RE.test(text)) {
      const reply =
        proposals.length === 0
          ? "You'll need a proposal first — ask me to generate one for this client."
          : proposals.length === 1
            ? 'Sure! Select the proposal below to get started.'
            : "Sure! Pick a proposal below and I'll walk you through it.";
      setMessages((prev) => [...prev, { id: genId(), role: 'user', content: text }]);
      setInput('');
      if (proposals.length > 0) {
        setComposerMessage(reply);
        setComposerStage('select-proposal');
      } else {
        setMessages((prev) => [...prev, { id: genId(), role: 'assistant', content: reply }]);
      }
      return;
    }

    if (PROPOSAL_INTENT_RE.test(text)) {
      setProposalGenerating(true);
    }

    const userMsg: Message = { id: genId(), role: 'user', content: text };
    const assistantMsgId = genId();
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: '', streaming: true };

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
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: m.content + evt.text } : m,
              ),
            );
          }
          if (evt.type === 'done') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, streaming: false, ...(evt.text ? { content: evt.text } : {}) }
                  : m,
              ),
            );
            setProposalGenerating(false);
            if (evt.proposalSaved) {
              setProposals((prev) => [evt.proposalSaved!, ...prev]);
              void openProposal(evt.proposalSaved!);
            }
            if (evt.proposalUpdated) {
              setProposals((prev) =>
                prev.map((p) => p.fileName === evt.proposalUpdated!.fileName ? evt.proposalUpdated! : p),
              );
              void (async () => {
                try {
                  const newContent = await getSuperClientProposal(apiKey, name, evt.proposalUpdated!.fileName);
                  setViewingProposal((prev) => {
                    if (!prev) return prev;
                    const changed = diffSections(prev.content, newContent);
                    setChangedSections(changed);
                    const count = changed.size;
                    setUpdateBanner(
                      count === 1
                        ? '1 section updated'
                        : `${count} sections updated`,
                    );
                    return { fileName: prev.fileName, title: evt.proposalUpdated!.title, content: newContent };
                  });
                } catch (err) {
                  console.error('Failed to reload updated proposal', err);
                }
              })();
            }
          }
          if (evt.type === 'error') {
            setProposalGenerating(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: `Error: ${evt.message ?? 'Unknown error'}`, streaming: false }
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
              ? { ...m, content: `Error: ${(err as Error).message}`, streaming: false }
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  if (error || !meta) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--danger)', fontSize: 14 }}>
        {error || 'Super client not found'}
      </div>
    );
  }

  return (
    <>
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Center — chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
            {meta.displayName}
          </span>
          {meta.url && (
            <a
              href={meta.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--muted)', textDecoration: 'none' }}
            >
              <Icon icon={ExternalLink} size="sm" />
              {(() => { try { return new URL(meta.url).hostname; } catch { return meta.url; } })()}
            </a>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, marginTop: 60 }}>
              Ask anything about {meta.displayName}
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '72%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user' ? 'var(--primary)' : 'var(--panel-soft)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text)',
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {/* Pre-content thinking state — morphing glyph + status text */}
                {msg.streaming && !msg.content && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="status-glyph" aria-hidden="true" />
                    <em className="chat-status-text">
                      {proposalGenerating ? PROPOSAL_STEPS[proposalStep] : 'Thinking…'}
                    </em>
                  </div>
                )}

                {/* Content + proper blinking cursor */}
                {msg.content}
                {msg.streaming && msg.content && (
                  <span className="chat-cursor" />
                )}

                {/* Proposal step progress pill — shown while content is streaming */}
                {msg.streaming && proposalGenerating && msg.content && (
                  <div style={{
                    marginTop: 8,
                    padding: '5px 10px',
                    borderRadius: 6,
                    background: 'rgba(0,0,0,0.05)',
                    fontSize: 12,
                    color: 'var(--muted)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span className="status-glyph" style={{ width: '0.5em', height: '0.5em' }} aria-hidden="true" />
                    {PROPOSAL_STEPS[proposalStep]}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}>

          {/* Composer expansion — select proposal */}
          {composerStage === 'select-proposal' && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
              {composerMessage && (
                <div style={{
                  display: 'inline-block', marginBottom: 10,
                  padding: '8px 12px', borderRadius: '12px 12px 12px 4px',
                  background: 'var(--panel)', border: '1px solid var(--border)',
                  fontSize: 13, color: 'var(--text)', lineHeight: 1.5,
                }}>
                  {composerMessage}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={13} /> Pick a proposal
                </p>
                <button onClick={resetComposer} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 0 }}>
                  <X size={13} />
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {proposals.map((p) => (
                  <button
                    key={p.fileName}
                    onClick={() => void handleComposerSelectProposal(p)}
                    disabled={loadingMicrositeFor === p.fileName}
                    style={{ textAlign: 'left', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', width: '100%' }}
                  >
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{p.title}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                      {loadingMicrositeFor === p.fileName ? 'Loading…' : new Date(p.savedAt).toLocaleDateString()}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Composer expansion — configure */}
          {composerStage === 'configure' && composerProposal && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={13} /> {composerProposal.proposal.title}
                </p>
                <button onClick={resetComposer} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 0 }}>
                  <X size={13} />
                </button>
              </div>
              <textarea
                value={composerInstructions}
                onChange={(e) => setComposerInstructions(e.target.value)}
                placeholder="Optional: any design direction or focus areas…"
                rows={2}
                style={{
                  width: '100%', resize: 'none', padding: '8px 10px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'var(--panel)',
                  color: 'var(--text)', fontSize: 13, outline: 'none', fontFamily: 'inherit',
                  lineHeight: 1.5, boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                <button
                  onClick={() => composerImageInputRef.current?.click()}
                  style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                    padding: '5px 10px', cursor: 'pointer', fontSize: 12,
                    color: composerImage ? 'var(--primary)' : 'var(--muted)',
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <ImagePlus size={12} />
                  {composerImage ? 'Image attached ✓' : 'Reference image'}
                </button>
                <input
                  ref={composerImageInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleComposerImageUpload(f); }}
                />
                <button
                  onClick={() => void generateComposerMicrosite()}
                  style={{
                    padding: '7px 14px', borderRadius: 8, background: 'var(--primary)',
                    color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <Sparkles size={13} /> Generate Microsite
                </button>
              </div>
            </div>
          )}

          {/* Composer expansion — generating progress */}
          {composerStage === 'generating' && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--panel-soft)', maxHeight: 140, overflowY: 'auto' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generating microsite…
              </p>
              {composerProgress.map((line, i) => (
                <p key={i} style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0' }}>{line}</p>
              ))}
            </div>
          )}

          {/* Textarea row — hidden while composer expansion is active */}
          {!composerStage && <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${meta.displayName}…`}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              padding: '9px 12px',
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: 'var(--panel-soft)',
              color: 'var(--text)',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              maxHeight: 120,
              overflowY: 'auto',
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={() => void sendMessage()}
            disabled={streaming || !input.trim()}
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: 'none',
              background: streaming || !input.trim() ? 'var(--border)' : 'var(--primary)',
              color: streaming || !input.trim() ? 'var(--muted)' : '#fff',
              cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
          >
            <Icon icon={Send} size="sm" />
          </button>
        </div>}
        </div>
      </div>

      {/* Proposal slide-in panel */}
      <div style={{
        width: viewingProposal ? 560 : 0,
        minWidth: 0,
        flexShrink: 0,
        overflow: 'hidden',
        borderLeft: viewingProposal ? '1px solid var(--border)' : 'none',
        transition: 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {viewingProposal && (
          <div style={{ width: 560, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                {viewingProposal.title}
              </p>
              <button
                onClick={() => { setViewingProposal(null); setChangedSections(new Set()); setUpdateBanner(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex', padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>
            {updateBanner && (
              <div style={{
                padding: '8px 20px',
                background: 'rgba(34, 197, 94, 0.1)',
                borderBottom: '1px solid rgba(34, 197, 94, 0.2)',
                fontSize: 12,
                color: 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}>
                <CheckCircle size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
                {updateBanner}
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }} className="proposal-body">
              {parseMarkdownSections(viewingProposal.content).map((section, i) => {
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
                    <ReactMarkdown>{mdChunk}</ReactMarkdown>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right panel — client info */}
      <div style={{
        width: viewingProposal ? 0 : 280,
        minWidth: 0,
        borderLeft: viewingProposal ? 'none' : '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowX: 'hidden',
        overflowY: viewingProposal ? 'hidden' : 'auto',
        transition: 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Client meta */}
          <div>
            <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Client
            </p>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
              {meta.displayName}
            </p>
            {meta.url && (
              <a
                href={meta.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}
              >
                <Icon icon={ExternalLink} size="sm" />
                {meta.url}
              </a>
            )}
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>
              Created {new Date(meta.createdAt).toLocaleDateString()}
            </p>
          </div>

          {/* Microsites */}
          <div>
            <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Microsites
            </p>
            {microsites.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.6 }}>
                Generate a microsite from a proposal.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {microsites.map((m) => (
                <div key={m.id} style={{
                  padding: '7px 10px', borderRadius: 6,
                  background: 'var(--panel-soft)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                }}>
                  <button
                    onClick={() => void handleOpenMicrosite(m)}
                    style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Icon icon={Globe} size="sm" style={{ flexShrink: 0, color: 'var(--primary)' }} />
                      {m.title}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                      {new Date(m.savedAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    onClick={() => void handleDeleteMicrosite(m.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0, flexShrink: 0, display: 'flex' }}
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Proposals */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                Proposals
              </p>
              <button
                onClick={() => void handleGenerateMicrosite()}
                disabled={proposals.length === 0 || loadingMicrositeFor !== null}
                title="Generate microsite from proposal"
                style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                  padding: '3px 8px', cursor: proposals.length === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4,
                  opacity: proposals.length === 0 ? 0.4 : 1,
                }}
              >
                <Icon icon={Sparkles} size="sm" />
                {loadingMicrositeFor ? 'Loading…' : '→ Microsite'}
              </button>
            </div>
            {proposals.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.6 }}>
                Ask me to generate a proposal in chat.
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {proposals.map((p) => (
                <div
                  key={p.fileName}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    background: 'var(--panel-soft)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                  }}
                >
                  <button
                    onClick={() => void openProposal(p)}
                    style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >
                    <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.4 }}>{p.title}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
                      {new Date(p.savedAt).toLocaleDateString()}
                    </p>
                  </button>
                  <button
                    onClick={() => void handleDeleteProposal(p.fileName)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0, flexShrink: 0, display: 'flex' }}
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Documents */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
                Documents
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                  padding: '3px 8px', cursor: uploading ? 'not-allowed' : 'pointer',
                  fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <Icon icon={Upload} size="sm" />
                {uploading ? `${uploadPct}%` : 'Upload'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { void handleFileUpload(f); e.target.value = ''; } }}
              />
            </div>

            {docs.length === 0 && !uploading && (
              <p style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.6 }}>
                No documents yet. Upload .pdf, .txt, or .md files.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {docs.map((doc) => (
                <div
                  key={doc.fileName}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 8px', borderRadius: 6, background: 'var(--panel-soft)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.fileName}
                  </span>
                  {doc.status === 'processing' && <Icon icon={Loader} size="sm" style={{ color: 'var(--muted)', flexShrink: 0 }} />}
                  {doc.status === 'extracted' && <Icon icon={CheckCircle} size="sm" style={{ color: 'var(--success, #22c55e)', flexShrink: 0 }} />}
                  {doc.status === 'failed' && (
                    <span title={doc.error} style={{ display: 'flex', flexShrink: 0 }}>
                      <Icon icon={AlertCircle} size="sm" style={{ color: 'var(--danger)' }} />
                    </span>
                  )}
                  <button
                    onClick={() => void handleDeleteDoc(doc.fileName)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 0, display: 'flex', flexShrink: 0 }}
                  >
                    <Icon icon={X} size="sm" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Memory — auto-built from chat + ingested docs */}
          <div style={{ marginTop: 4 }}>
            <p style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Memory
            </p>
            <MemorySection namespace={name} />
          </div>
        </div>
      </div>
    </div>

    {/* Proposal picker — shown when >1 proposals and user clicks Generate Microsite */}
    {showProposalPicker && (
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 32000,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
        onClick={(e) => { if (e.target === e.currentTarget) setShowProposalPicker(false); }}
      >
        <div style={{
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12,
          width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden',
        }}>
          <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: 0 }}>Choose a Proposal</p>
            <button onClick={() => setShowProposalPicker(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', display: 'flex' }}>
              <Icon icon={X} size="md" />
            </button>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {proposals.map((p) => (
              <button
                key={p.fileName}
                onClick={() => void handlePickProposal(p)}
                disabled={loadingMicrositeFor === p.fileName}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 14px',
                  background: 'var(--panel-soft)', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer',
                }}
              >
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', margin: 0 }}>{p.title}</p>
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '2px 0 0' }}>
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
          try {
            const saved = await saveSuperClientMicrosite(apiKey, name, ast, micrositeModal.proposal.title);
            setMicrosites((prev) => [saved, ...prev]);
            setMicrositeModal(null);
            setViewingMicrosite(ast);
          } catch (err) {
            console.error('Failed to save microsite', err);
            setMicrositeModal(null);
          }
        }}
        onClose={() => setMicrositeModal(null)}
      />
    )}

    {/* MicrositeV2 full-screen viewer */}
    {viewingMicrosite && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 40000, background: 'var(--panel)' }}>
        <MicrositeV2 ast={viewingMicrosite} onBack={() => setViewingMicrosite(null)} />
      </div>
    )}
    </>
  );
}
