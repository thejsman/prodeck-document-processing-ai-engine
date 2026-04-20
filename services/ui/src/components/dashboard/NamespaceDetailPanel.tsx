'use client';

import { useState, useEffect } from 'react';
import { LucideProps } from 'lucide-react';
import { ChevronDown, FileText, Globe, Database } from 'lucide-react';
import { useNamespace } from '@/lib/namespace-context';
import { useAuth } from '@/lib/auth-context';
import {
  fetchProposals,
  fetchPresentations,
  fetchKnowledgeFiles,
  type ProposalFile,
  type Presentation,
  type IngestionFile,
} from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

interface SectionProps {
  icon: React.FC<LucideProps>;
  label: string;
  loading: boolean;
  children: React.ReactNode;
}

function Section({ icon, label, loading, children }: SectionProps) {
  const [open, setOpen] = useState(true);
  const [hovered, setHovered] = useState(false);

  return (
    <div className="sidebar-group">
      <div
        className="sidebar-link"
        role="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      >
        <Icon icon={icon} size="md" className="sidebar-icon" />
        <span className="sidebar-label" style={{ flex: 1, opacity: 0.45 }}>{label}</span>
        <Icon
          icon={ChevronDown}
          size="sm"
          style={{
            flexShrink: 0,
            opacity: hovered ? 0.5 : 0,
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'opacity 0.15s, transform 0.15s ease',
          }}
        />
      </div>

      {open && (
        loading
          ? (
            <div style={{ padding: '2px 8px 4px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>Loading…</span>
            </div>
          )
          : children
      )}
    </div>
  );
}

export function NamespaceDetailPanel() {
  const { namespace } = useNamespace();
  const { apiKey } = useAuth();

  const [proposals, setProposals] = useState<ProposalFile[]>([]);
  const [microsites, setMicrosites] = useState<Presentation[]>([]);
  const [files, setFiles] = useState<IngestionFile[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [loadingMicrosites, setLoadingMicrosites] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoadingProposals(true);
    fetchProposals(apiKey)
      .then(setProposals)
      .catch(() => setProposals([]))
      .finally(() => setLoadingProposals(false));
  }, [namespace, apiKey]);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoadingMicrosites(true);
    fetchPresentations(apiKey, namespace)
      .then(setMicrosites)
      .catch(() => setMicrosites([]))
      .finally(() => setLoadingMicrosites(false));
  }, [namespace, apiKey]);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoadingFiles(true);
    fetchKnowledgeFiles(apiKey, namespace)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false));
  }, [namespace, apiKey]);

  if (!namespace) return null;

  return (
    <div
      className="card"
      style={{ padding: '8px 0', overflow: 'hidden' }}
    >
      {/* Namespace name header */}
      <div style={{
        padding: '6px 18px 10px',
        borderBottom: '1px solid var(--border)',
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', letterSpacing: '0em' }}>
          {namespace}
        </span>
      </div>

      {/* Three collapsible sections — styled to mirror the sidebar Namespaces section */}
      <div style={{ padding: '4px 10px' }}>
        <Section icon={FileText} label="Proposals" loading={loadingProposals}>
          {proposals.length === 0 ? (
            <div style={{ padding: '2px 8px 4px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>No proposals yet</span>
            </div>
          ) : (
            proposals.map(p => (
              <div key={p.fileName} className="sidebar-link" style={{ cursor: 'default' }}>
                <span className="sidebar-label">{p.client || p.fileName}</span>
              </div>
            ))
          )}
        </Section>

        <Section icon={Globe} label="Microsites" loading={loadingMicrosites}>
          {microsites.length === 0 ? (
            <div style={{ padding: '2px 8px 4px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>No microsites yet</span>
            </div>
          ) : (
            microsites.map(m => (
              <div key={m.proposalId} className="sidebar-link" style={{ cursor: 'default' }}>
                <span className="sidebar-label">{m.fileName}</span>
              </div>
            ))
          )}
        </Section>

        <Section icon={Database} label="Ingested Files" loading={loadingFiles}>
          {files.length === 0 ? (
            <div style={{ padding: '2px 8px 4px' }}>
              <span className="sidebar-label" style={{ opacity: 0.45, fontSize: 13 }}>No files yet</span>
            </div>
          ) : (
            files.map(f => (
              <div key={f.fileName} className="sidebar-link" style={{ cursor: 'default' }}>
                <span className="sidebar-label">{f.fileName}</span>
              </div>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}
