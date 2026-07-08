'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Globe, FolderOpen, Presentation, ChevronDown, MoreHorizontal, Trash2 } from 'lucide-react';
import { transitionOverlay } from '@/components/system/TransitionOverlay';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { ThemeToggle } from '@/components/system/ThemeToggle';
import {
  listSuperClients,
  listSuperClientProposals,
  listSuperClientMicrosites,
  listGeneratedDocuments,
  listSlides,
  fetchAllMicrositeHistory,
  fetchProposals,
  deleteProposal,
  deleteSuperClientProposal,
  deleteMicrositeHistoryFromServer,
  deleteSuperClientMicrosite,
  type SuperClientMeta,
  type SuperClientProposal,
  type SuperClientMicrosite,
  type GeneratedDocument,
  type SavedSlide,
  type ProposalFile,
  type MicrositeHistoryServerEntry,
} from '@/lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

type Tab = 'proposals' | 'microsites' | 'documents' | 'presentations';

interface ArtifactProposal {
  key: string;
  title: string;
  date: string;
  rawDate: string;
  clientName: string;
  clientSlug: string;
  navUrl: string;
  deleteInfo:
    | { kind: 'sc'; client: string; fileName: string }
    | { kind: 'reg'; namespace: string; fileName: string }
    | null;
}

interface ArtifactMicrosite {
  key: string;
  title: string;
  date: string;
  rawDate: string;
  clientSlug: string;
  version?: number;
  type?: string;
  navUrl: string;
  deleteInfo:
    | { kind: 'sc'; client: string; id: string }
    | { kind: 'hist'; namespace: string; entryId: string }
    | null;
}

interface ArtifactDocument {
  key: string;
  title: string;
  date: string;
  rawDate: string;
  documentType?: string;
  clientName: string;
  clientSlug: string;
  id: string;
}

interface ArtifactSlide {
  key: string;
  title: string;
  date: string;
  rawDate: string;
  slideCount: number;
  clientName: string;
  clientSlug: string;
  id: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fileNameToTitle(fileName: string) {
  return fileName
    .replace(/\.md$/i, '')
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugToDisplayName(slug: string) {
  return slug
    .replace(/^sc-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Card component ────────────────────────────────────────────────────────────

interface ArtifactCardProps {
  badge: string;
  badgeColor: string;
  title: string;
  date: string;
  clientLabel: string;
  onView: () => void;
  onDelete?: () => Promise<void>;
}

function ArtifactCard({ badge, badgeColor, title, date, clientLabel, onView, onDelete }: ArtifactCardProps) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  async function handleDelete() {
    if (!onDelete || deleting) return;
    setDeleting(true);
    setMenuOpen(false);
    try { await onDelete(); } finally { setDeleting(false); }
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        position: 'relative',
        background: hovered ? 'var(--panel-soft)' : 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'default',
        transition: 'background 0.15s',
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {/* Three-dot menu — visible on hover */}
      {onDelete && (hovered || menuOpen) && (
        <div ref={menuRef} style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              color: 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            <Icon icon={MoreHorizontal} size="sm" />
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '4px 0',
                minWidth: 120,
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                zIndex: 20,
              }}
            >
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  cursor: deleting ? 'default' : 'pointer',
                  fontSize: 13,
                  color: 'var(--danger, #ef4444)',
                  textAlign: 'left',
                }}
              >
                <Icon icon={Trash2} size="sm" />
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ fontSize: 10, fontWeight: 700, color: badgeColor, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
        {badge}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--text)',
          lineHeight: 1.45,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -2 }}>{date}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{clientLabel}</span>
        <button
          onClick={onView}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--primary)',
            background: 'none',
            border: '1px solid var(--primary)',
            cursor: 'pointer',
            padding: '4px 14px',
            borderRadius: 6,
            transition: 'background 0.12s, color 0.12s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--primary)';
            (e.currentTarget as HTMLButtonElement).style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'none';
            (e.currentTarget as HTMLButtonElement).style.color = 'var(--primary)';
          }}
        >
          View
        </button>
      </div>
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  count: number;
  clients: string[];
  selectedClient: string;
  onClientChange: (c: string) => void;
}

function FilterBar({ count, clients, selectedClient, onClientChange }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--panel)',
          color: 'var(--text)',
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        {selectedClient ? slugToDisplayName(selectedClient) : `All (${count})`}
        <Icon icon={ChevronDown} size="sm" />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            zIndex: 100,
            minWidth: 160,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            overflow: 'hidden',
          }}
        >
          <button
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: selectedClient === '' ? 'var(--primary-soft)' : 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}
            onClick={() => { onClientChange(''); setOpen(false); }}
          >
            All ({count})
          </button>
          {clients.map((c) => (
            <button
              key={c}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: selectedClient === c ? 'var(--primary-soft)' : 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}
              onClick={() => { onClientChange(c); setOpen(false); }}
            >
              {slugToDisplayName(c)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{ gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
      No {label} yet.
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function ArtifactsPage() {
  const { apiKey } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab | null;
    return t && ['proposals', 'microsites', 'documents', 'presentations'].includes(t) ? t : 'proposals';
  });
  const [loading, setLoading] = useState(true);

  const [proposals, setProposals] = useState<ArtifactProposal[]>([]);
  const [microsites, setMicrosites] = useState<ArtifactMicrosite[]>([]);
  const [documents, setDocuments] = useState<ArtifactDocument[]>([]);
  const [slides, setSlides] = useState<ArtifactSlide[]>([]);

  const [filterClient, setFilterClient] = useState('');

  // Shows the shell-level persistent overlay from the moment a card is tapped;
  // the destination page hides it once the artifact is actually open. Living
  // in the layout, the overlay survives the route swap — no flicker between
  // this page, the route loading fallback, and the destination's own loading.
  function openArtifact(label: string, url: string) {
    transitionOverlay.show(label);
    router.push(url);
  }

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const [clients, regularProposals, micrositeHistory] = await Promise.all([
        listSuperClients(apiKey).catch(() => [] as SuperClientMeta[]),
        fetchProposals(apiKey).catch(() => [] as ProposalFile[]),
        fetchAllMicrositeHistory(apiKey).catch(() => [] as MicrositeHistoryServerEntry[]),
      ]);

      const [scProposalsResults, scMicrositeResults, docsResults, slidesResults] = await Promise.all([
        Promise.allSettled(clients.map((c) => listSuperClientProposals(apiKey, c.name).then((ps) => ({ clientName: c.name, displayName: c.displayName, ps })))),
        Promise.allSettled(clients.map((c) => listSuperClientMicrosites(apiKey, c.name).then((ms) => ({ clientName: c.name, displayName: c.displayName, ms })))),
        Promise.allSettled(clients.map((c) => listGeneratedDocuments(apiKey, c.name).then((ds) => ({ clientName: c.name, displayName: c.displayName, ds })))),
        Promise.allSettled(clients.map((c) => listSlides(apiKey, c.name).then((ss) => ({ clientName: c.name, displayName: c.displayName, ss })))),
      ]);

      // ── Proposals ──────────────────────────────────────────────────────────
      const allProposals: ArtifactProposal[] = [];

      scProposalsResults
        .filter((r): r is PromiseFulfilledResult<{ clientName: string; displayName: string; ps: SuperClientProposal[] }> => r.status === 'fulfilled')
        .forEach(({ value: { clientName, ps } }) => {
          ps.forEach((p) => {
            allProposals.push({
              key: `sc-${clientName}-${p.fileName}`,
              title: p.title || fileNameToTitle(p.fileName),
              date: formatDate(p.savedAt),
              rawDate: p.savedAt,
              clientName: slugToDisplayName(clientName),
              clientSlug: clientName,
              // Deep link into the super client page so the proposal opens in the
              // same right-panel viewer as the client's own artifacts tab.
              navUrl: `/super-client/${encodeURIComponent(clientName)}?open=proposal&id=${encodeURIComponent(p.fileName)}&from=artifacts`,
              deleteInfo: { kind: 'sc', client: clientName, fileName: p.fileName },
            });
          });
        });

      // Deduplicate: skip regular proposals whose fileName namespace starts with 'sc-'
      regularProposals
        .filter((p) => {
          const ns = p.fileName.includes('::') ? p.fileName.split('::')[0] : '';
          return !ns.startsWith('sc-');
        })
        .forEach((p) => {
          const parts = p.fileName.split('::');
          const ns = parts.length > 1 ? parts[0] : '';
          const file = parts.length > 1 ? parts.slice(1).join('::') : p.fileName;
          const navUrl = ns
            ? `/proposal?artifact=${encodeURIComponent(file)}&namespace=${encodeURIComponent(ns)}&from=chat`
            : `/proposal?artifact=${encodeURIComponent(p.fileName)}&from=chat`;
          allProposals.push({
            key: `reg-${p.client}-${p.fileName}`,
            title: fileNameToTitle(file || p.fileName),
            date: formatDate(p.createdAt),
            rawDate: p.createdAt,
            clientName: slugToDisplayName(p.client),
            clientSlug: p.client,
            navUrl,
            deleteInfo: ns ? { kind: 'reg', namespace: ns, fileName: file } : null,
          });
        });

      allProposals.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
      setProposals(allProposals);

      // ── Microsites ─────────────────────────────────────────────────────────
      const allMicrosites: ArtifactMicrosite[] = [];

      scMicrositeResults
        .filter((r): r is PromiseFulfilledResult<{ clientName: string; displayName: string; ms: SuperClientMicrosite[] }> => r.status === 'fulfilled')
        .forEach(({ value: { clientName, ms } }) => {
          ms.forEach((m) => {
            allMicrosites.push({
              key: `sc-ms-${clientName}-${m.id}`,
              title: m.title || m.proposalTitle || 'Untitled Microsite',
              date: formatDate(m.savedAt),
              rawDate: m.savedAt,
              clientSlug: clientName,
              type: m.pdfPresentation ? (m.pdfOrientation === 'portrait' ? 'PDF 9:16' : 'PDF 16:9') : undefined,
              // Deep link into the super client page so the microsite opens in the
              // same right-panel viewer as the client's own artifacts tab.
              navUrl: `/super-client/${encodeURIComponent(clientName)}?open=microsite&id=${encodeURIComponent(m.id)}&from=artifacts`,
              deleteInfo: { kind: 'sc', client: clientName, id: m.id },
            });
          });
        });

      // Only include regular (non-SC) history entries — SC entries have id starting with 'sc:'
      micrositeHistory
        .filter((m) => !m.id.startsWith('sc:'))
        .forEach((m) => {
          allMicrosites.push({
            key: `hist-${m.namespace}-${m.id}`,
            title: m.title || slugToDisplayName(m.namespace),
            date: formatDate(m.savedAt),
            rawDate: m.savedAt,
            clientSlug: m.namespace,
            version: m.version,
            type: m.type,
            // proposalId is unused when entryId is present — use namespace as placeholder
            navUrl: `/microsite-view/${encodeURIComponent(m.namespace)}/${encodeURIComponent(m.namespace)}?entryId=${encodeURIComponent(m.id)}`,
            deleteInfo: { kind: 'hist', namespace: m.namespace, entryId: m.id },
          });
        });

      allMicrosites.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
      setMicrosites(allMicrosites);

      // ── Documents ──────────────────────────────────────────────────────────
      const allDocs: ArtifactDocument[] = docsResults
        .filter((r): r is PromiseFulfilledResult<{ clientName: string; displayName: string; ds: GeneratedDocument[] }> => r.status === 'fulfilled')
        .flatMap(({ value: { clientName, displayName, ds } }) =>
          ds.map((d) => ({
            key: `doc-${clientName}-${d.id}`,
            title: d.title,
            date: formatDate(d.createdAt),
            rawDate: d.createdAt,
            documentType: d.documentType,
            clientName: displayName,
            clientSlug: clientName,
            id: d.id,
          })),
        );
      allDocs.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
      setDocuments(allDocs);

      // ── Slides ─────────────────────────────────────────────────────────────
      const allSlides: ArtifactSlide[] = slidesResults
        .filter((r): r is PromiseFulfilledResult<{ clientName: string; displayName: string; ss: SavedSlide[] }> => r.status === 'fulfilled')
        .flatMap(({ value: { clientName, displayName, ss } }) =>
          ss.map((s) => ({
            key: `slide-${clientName}-${s.id}`,
            title: s.title || 'Untitled Presentation',
            date: formatDate(s.savedAt),
            rawDate: s.savedAt,
            slideCount: s.slideCount,
            clientName: displayName,
            clientSlug: clientName,
            id: s.id,
          })),
        );
      allSlides.sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
      setSlides(allSlides);
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { void load(); }, [load]);

  // ── Filtered lists ──────────────────────────────────────────────────────────
  const filteredProposals = filterClient ? proposals.filter((p) => p.clientSlug === filterClient) : proposals;
  const filteredMicrosites = filterClient ? microsites.filter((m) => m.clientSlug === filterClient) : microsites;
  const filteredDocuments = filterClient ? documents.filter((d) => d.clientSlug === filterClient) : documents;
  const filteredSlides = filterClient ? slides.filter((s) => s.clientSlug === filterClient) : slides;

  const clientSlugsForTab = (() => {
    if (activeTab === 'proposals') return [...new Set(proposals.map((p) => p.clientSlug))];
    if (activeTab === 'microsites') return [...new Set(microsites.map((m) => m.clientSlug))];
    if (activeTab === 'documents') return [...new Set(documents.map((d) => d.clientSlug))];
    return [...new Set(slides.map((s) => s.clientSlug))];
  })();

  const activeCount = (() => {
    if (activeTab === 'proposals') return proposals.length;
    if (activeTab === 'microsites') return microsites.length;
    if (activeTab === 'documents') return documents.length;
    return slides.length;
  })();

  async function handleDeleteProposal(p: ArtifactProposal) {
    if (!p.deleteInfo) return;
    if (p.deleteInfo.kind === 'sc') {
      await deleteSuperClientProposal(apiKey, p.deleteInfo.client, p.deleteInfo.fileName);
    } else {
      await deleteProposal(apiKey, p.deleteInfo.namespace, p.deleteInfo.fileName);
    }
    setProposals((prev) => prev.filter((x) => x.key !== p.key));
  }

  async function handleDeleteMicrosite(m: ArtifactMicrosite) {
    if (!m.deleteInfo) return;
    if (m.deleteInfo.kind === 'sc') {
      await deleteSuperClientMicrosite(apiKey, m.deleteInfo.client, m.deleteInfo.id);
    } else {
      await deleteMicrositeHistoryFromServer(apiKey, m.deleteInfo.namespace, m.deleteInfo.entryId);
    }
    setMicrosites((prev) => prev.filter((x) => x.key !== m.key));
  }

  const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: 'proposals', label: 'Proposals', icon: FileText },
    { id: 'microsites', label: 'Microsites', icon: Globe },
    { id: 'documents', label: 'Documents', icon: FolderOpen },
    { id: 'presentations', label: 'Presentations', icon: Presentation },
  ];

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: 20,
    marginTop: 28,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Slim top bar with title + theme toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Artifacts
        </span>
        <ThemeToggle />
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--border)',
          padding: '0 24px',
          background: 'var(--panel)',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setFilterClient(''); router.replace(`/artifacts?tab=${tab.id}`); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '11px 16px',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? 'var(--text)' : 'var(--muted)',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              borderRadius: 0,
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            <Icon icon={tab.icon} size="sm" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="artifacts-content" style={{ flex: 1, overflow: 'auto', padding: '28px 64px' }}>
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 48, textAlign: 'center' }}>
            Loading…
          </div>
        ) : (
          <>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
                {TABS.find((t) => t.id === activeTab)?.label}
              </h2>
              <FilterBar
                count={activeCount}
                clients={clientSlugsForTab}
                selectedClient={filterClient}
                onClientChange={setFilterClient}
              />
            </div>

            {/* Proposals */}
            {activeTab === 'proposals' && (
              <div style={gridStyle}>
                {filteredProposals.length === 0 ? (
                  <EmptyState label="proposals" />
                ) : (
                  filteredProposals.map((p) => (
                    <ArtifactCard
                      key={p.key}
                      badge="Proposal"
                      badgeColor="var(--primary)"
                      title={p.title}
                      date={p.date}
                      clientLabel={p.clientName}
                      onView={() => openArtifact('Opening proposal…', p.navUrl)}
                      onDelete={p.deleteInfo ? () => handleDeleteProposal(p) : undefined}
                    />
                  ))
                )}
              </div>
            )}

            {/* Microsites */}
            {activeTab === 'microsites' && (
              <div style={gridStyle}>
                {filteredMicrosites.length === 0 ? (
                  <EmptyState label="microsites" />
                ) : (
                  filteredMicrosites.map((m) => (
                    <ArtifactCard
                      key={m.key}
                      badge={m.type ? `Microsite · ${m.type}` : 'Microsite'}
                      badgeColor="#3b82f6"
                      title={m.title}
                      date={m.date}
                      clientLabel={slugToDisplayName(m.clientSlug)}
                      onView={() => openArtifact('Opening microsite…', m.navUrl)}
                      onDelete={m.deleteInfo ? () => handleDeleteMicrosite(m) : undefined}
                    />
                  ))
                )}
              </div>
            )}

            {/* Documents */}
            {activeTab === 'documents' && (
              <div style={gridStyle}>
                {filteredDocuments.length === 0 ? (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      padding: '48px 0',
                      textAlign: 'center',
                      color: 'var(--muted)',
                      fontSize: 14,
                    }}
                  >
                    Ask me to write any document — strategy, blog post, press release, report, deck…
                  </div>
                ) : (
                  filteredDocuments.map((d) => (
                    <ArtifactCard
                      key={d.key}
                      badge={d.documentType ? `Document · ${d.documentType}` : 'Document'}
                      badgeColor="#22c55e"
                      title={d.title}
                      date={d.date}
                      clientLabel={d.clientName}
                      onView={() =>
                        // Deep link into the super client page — opens in the same
                        // right-panel viewer as the client's own artifacts tab.
                        openArtifact(
                          'Opening document…',
                          `/super-client/${encodeURIComponent(d.clientSlug)}?open=document&id=${encodeURIComponent(d.id)}&from=artifacts`,
                        )
                      }
                    />
                  ))
                )}
              </div>
            )}

            {/* Presentations */}
            {activeTab === 'presentations' && (
              <div style={gridStyle}>
                {filteredSlides.length === 0 ? (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      padding: '48px 0',
                      textAlign: 'center',
                      color: 'var(--muted)',
                      fontSize: 14,
                    }}
                  >
                    Ask me to create a presentation in chat
                  </div>
                ) : (
                  filteredSlides.map((s) => (
                    <ArtifactCard
                      key={s.key}
                      badge={`Presentation · ${s.slideCount} slide${s.slideCount !== 1 ? 's' : ''}`}
                      badgeColor="#a855f7"
                      title={s.title}
                      date={s.date}
                      clientLabel={s.clientName}
                      onView={() =>
                        // Deep link into the super client page — opens the slide deck
                        // in the same right-panel viewer as the client's artifacts tab
                        // (previously this only navigated to the client page).
                        openArtifact(
                          'Opening presentation…',
                          `/super-client/${encodeURIComponent(s.clientSlug)}?open=slide&id=${encodeURIComponent(s.id)}&from=artifacts`,
                        )
                      }
                    />
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
