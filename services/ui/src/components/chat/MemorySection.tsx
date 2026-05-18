'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  fetchClientMemory,
  addKnowledgeEntry,
  updateClientKnowledgeEntry,
  deleteClientKnowledgeEntry,
  addStakeholder,
  updateStakeholder,
  deleteStakeholder,
  resolveConflict,
  type ClientMemory,
  type ClientKnowledgeEntry,
  type StakeholderRecord,
} from '@/lib/api';
import { Section } from './NamespacePanel';

// ── Category dot colors ───────────────────────────────────────────
const CATEGORY_COLOR: Record<ClientKnowledgeEntry['category'], string> = {
  preference: 'var(--primary, #6366f1)',
  constraint: '#f59e0b',
  relationship: '#a855f7',
  context: 'var(--muted, #6b7280)',
};

const CATEGORY_LABEL: Record<ClientKnowledgeEntry['category'], string> = {
  preference: 'pref',
  constraint: 'limit',
  relationship: 'rel',
  context: 'ctx',
};

// ── Sub-section header ────────────────────────────────────────────

function SubHeader({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px 2px', gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1 }}>
        {label}
      </span>
      <button
        onClick={onAdd}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', color: 'var(--muted)', borderRadius: 4, lineHeight: 1, display: 'flex', alignItems: 'center' }}
        title={`Add ${label.toLowerCase()}`}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

// ── Knowledge entry row ───────────────────────────────────────────

interface KnowledgeRowProps {
  entry: ClientKnowledgeEntry;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
}

function KnowledgeRow({ entry, onEdit, onDelete }: KnowledgeRowProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const handleSave = async () => {
    if (!draft.trim() || draft === entry.content) { setEditing(false); return; }
    setSaving(true);
    try {
      await onEdit(entry.id, draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(entry.content);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ padding: '4px 8px 4px 12px' }}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') handleCancel(); }}
          rows={3}
          style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--primary)', borderRadius: 6, color: 'var(--text)', fontSize: 12, lineHeight: 1.5, padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={handleCancel} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--muted)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !draft.trim()} style={{ background: 'var(--primary)', border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: saving ? 'not-allowed' : 'pointer', color: '#fff', opacity: saving || !draft.trim() ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'relative', padding: '3px 8px 3px 12px', display: 'flex', alignItems: 'flex-start', gap: 6, borderRadius: 6, background: hovered ? 'var(--panel-item)' : 'transparent', transition: 'background 0.1s', margin: '1px 4px' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Category dot + label */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3, paddingTop: 1 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: CATEGORY_COLOR[entry.category], flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontWeight: 600, color: CATEGORY_COLOR[entry.category], textTransform: 'uppercase', letterSpacing: '0.05em', lineHeight: 1 }}>
          {CATEGORY_LABEL[entry.category]}
        </span>
      </div>

      {/* Content */}
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', lineHeight: 1.5, wordBreak: 'break-word' }} title={entry.content}>
        {entry.content.length > 80 ? entry.content.slice(0, 80) + '…' : entry.content}
      </span>

      {/* Edit / delete icons (hover) */}
      {hovered && (
        <div style={{ flexShrink: 0, display: 'flex', gap: 2, alignItems: 'center', paddingTop: 1 }}>
          <button
            onClick={() => { setDraft(entry.content); setEditing(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', borderRadius: 3, lineHeight: 1 }}
            title="Edit"
          >
            <Pencil size={11} />
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--danger, #ef4444)', borderRadius: 3, lineHeight: 1 }}
            title="Delete"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── New knowledge form ────────────────────────────────────────────

interface NewKnowledgeFormProps {
  onSubmit: (content: string, category: ClientKnowledgeEntry['category']) => Promise<void>;
  onCancel: () => void;
}

function NewKnowledgeForm({ onSubmit, onCancel }: NewKnowledgeFormProps) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<ClientKnowledgeEntry['category']>('context');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onSubmit(content.trim(), category);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '4px 8px 4px 12px' }}>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={e => setContent(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        placeholder="Add a fact…"
        rows={3}
        style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--primary)', borderRadius: 6, color: 'var(--text)', fontSize: 12, lineHeight: 1.5, padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <select
          value={category}
          onChange={e => setCategory(e.target.value as ClientKnowledgeEntry['category'])}
          style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', fontSize: 11, padding: '2px 6px', outline: 'none' }}
        >
          <option value="context">Context</option>
          <option value="preference">Preference</option>
          <option value="constraint">Constraint</option>
          <option value="relationship">Relationship</option>
        </select>
        <button onClick={onCancel} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', fontSize: 11, cursor: 'pointer', color: 'var(--muted)' }}>
          <X size={11} />
        </button>
        <button onClick={handleSubmit} disabled={saving || !content.trim()} style={{ background: 'var(--primary)', border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: saving || !content.trim() ? 'not-allowed' : 'pointer', color: '#fff', opacity: saving || !content.trim() ? 0.6 : 1 }}>
          {saving ? '…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ── Stakeholder row ───────────────────────────────────────────────

interface StakeholderRowProps {
  record: StakeholderRecord;
  onEdit: (id: string, updates: Partial<{ name: string; role: string; notes: string }>) => Promise<void>;
  onDelete: (id: string) => void;
}

function StakeholderRow({ record, onEdit, onDelete }: StakeholderRowProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(record.name);
  const [role, setRole] = useState(record.role);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onEdit(record.id, { name: name.trim(), role: role.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setName(record.name);
    setRole(record.role);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ padding: '4px 8px 4px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          style={{ background: 'var(--bg)', border: '1px solid var(--primary)', borderRadius: 5, color: 'var(--text)', fontSize: 12, padding: '4px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
        />
        <input
          value={role}
          onChange={e => setRole(e.target.value)}
          placeholder="Role"
          onKeyDown={e => { if (e.key === 'Escape') handleCancel(); }}
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', fontSize: 12, padding: '4px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={handleCancel} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: 'var(--muted)' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} style={{ background: 'var(--primary)', border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: '#fff', opacity: saving || !name.trim() ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: 'relative', padding: '3px 8px 3px 12px', display: 'flex', alignItems: 'center', gap: 6, borderRadius: 6, background: hovered ? 'var(--panel-item)' : 'transparent', transition: 'background 0.1s', margin: '1px 4px' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--primary-soft, rgba(99,102,241,0.12))', color: 'var(--primary)', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, textTransform: 'uppercase' }}>
        {record.name.charAt(0)}
      </span>
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {record.name}
        {record.role && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {record.role}</span>}
      </span>
      {hovered && (
        <div style={{ flexShrink: 0, display: 'flex', gap: 2 }}>
          <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted)', borderRadius: 3 }} title="Edit">
            <Pencil size={11} />
          </button>
          <button onClick={() => onDelete(record.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--danger, #ef4444)', borderRadius: 3 }} title="Delete">
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── New stakeholder form ──────────────────────────────────────────

interface NewStakeholderFormProps {
  onSubmit: (name: string, role: string) => Promise<void>;
  onCancel: () => void;
}

function NewStakeholderForm({ onSubmit, onCancel }: NewStakeholderFormProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(name.trim(), role.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '4px 8px 4px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Name"
        autoFocus
        style={{ background: 'var(--bg)', border: '1px solid var(--primary)', borderRadius: 5, color: 'var(--text)', fontSize: 12, padding: '4px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
      />
      <input
        value={role}
        onChange={e => setRole(e.target.value)}
        placeholder="Role (optional)"
        onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', fontSize: 12, padding: '4px 8px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', fontSize: 11, cursor: 'pointer', color: 'var(--muted)' }}>
          <X size={11} />
        </button>
        <button onClick={handleSubmit} disabled={saving || !name.trim()} style={{ background: 'var(--primary)', border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: 11, cursor: saving || !name.trim() ? 'not-allowed' : 'pointer', color: '#fff', opacity: saving || !name.trim() ? 0.6 : 1 }}>
          {saving ? '…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

// ── Conflicts panel ───────────────────────────────────────────────

interface ConflictsPanelProps {
  conflicts: ClientMemory['conflicts'];
  onResolve: (id: string, resolution: 'keep_old' | 'use_new' | 'keep_both') => Promise<void>;
}

function ConflictsPanel({ conflicts, onResolve }: ConflictsPanelProps) {
  const [resolving, setResolving] = useState<string | null>(null);

  const handle = async (id: string, resolution: 'keep_old' | 'use_new' | 'keep_both') => {
    setResolving(id);
    try { await onResolve(id, resolution); } finally { setResolving(null); }
  };

  return (
    <div style={{ margin: '4px 4px 0', padding: '8px 8px', background: 'color-mix(in srgb, #f59e0b 8%, var(--panel-item))', borderRadius: 8, border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)' }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: '#b45309', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Conflicts to review</p>
      {conflicts.map(c => (
        <div key={c.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Existing:</div>
          <p style={{ fontSize: 12, color: 'var(--text)', margin: '0 0 4px', lineHeight: 1.4 }}>{c.existingContent}</p>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>New:</div>
          <p style={{ fontSize: 12, color: 'var(--text)', margin: '0 0 8px', lineHeight: 1.4 }}>{c.incomingContent}</p>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(['keep_old', 'use_new', 'keep_both'] as const).map(res => (
              <button
                key={res}
                disabled={resolving === c.id}
                onClick={() => handle(c.id, res)}
                style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', cursor: resolving === c.id ? 'not-allowed' : 'pointer', opacity: resolving === c.id ? 0.6 : 1, textTransform: 'capitalize' }}
              >
                {resolving === c.id ? <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Check size={8} /> …</span> : res.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stable fields block ───────────────────────────────────────────

function StableFields({ memory }: { memory: ClientMemory }) {
  const { stableFields, clientIndustry } = memory;
  const contact = stableFields.contactName?.value;
  const industry = stableFields.clientIndustry?.value ?? clientIndustry;

  const parts: string[] = [];
  if (industry) parts.push(typeof industry === 'string' ? industry : industry.join(', '));
  if (contact) parts.push(`Contact: ${typeof contact === 'string' ? contact : contact.join(', ')}`);

  if (!parts.length) return null;

  return (
    <div style={{ padding: '2px 12px 6px' }}>
      {parts.map((p, i) => (
        <p key={i} style={{ fontSize: 11, color: 'var(--muted)', margin: '1px 0', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>
          {p}
        </p>
      ))}
    </div>
  );
}

// ── Delete confirmation portal ────────────────────────────────────

interface ConfirmDeleteProps {
  label: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

function ConfirmDelete({ label, onConfirm, onCancel }: ConfirmDeleteProps) {
  const [deleting, setDeleting] = useState(false);

  const handle = async () => {
    setDeleting(true);
    try { await onConfirm(); } finally { setDeleting(false); }
  };

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onMouseDown={e => { if (e.target === e.currentTarget && !deleting) onCancel(); }}
    >
      <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, width: '100%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 20px 0' }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', margin: '0 0 12px' }}>Delete memory entry</p>
        </div>
        <div style={{ height: 1, background: 'var(--border)' }} />
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: 'var(--text)', marginBottom: 16, lineHeight: 1.5 }}>
            Delete <strong>"{label.length > 60 ? label.slice(0, 60) + '…' : label}"</strong>?
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onCancel} disabled={deleting} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--panel-soft)', color: 'var(--text)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button onClick={handle} disabled={deleting} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'var(--danger, #ef4444)', color: '#fff', fontSize: 13, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main component ────────────────────────────────────────────────

interface Props {
  namespace: string;
  onHasMemory?: (has: boolean) => void;
  onLoadingChange?: (loading: boolean) => void;
}

export function MemorySection({ namespace, onHasMemory, onLoadingChange }: Props) {
  const { apiKey } = useAuth();
  const [memory, setMemory] = useState<ClientMemory | null>(null);
  const [loading, setLoading] = useState(true);

  // Knowledge state
  const [addingKnowledge, setAddingKnowledge] = useState(false);
  const [confirmDeleteKnowledge, setConfirmDeleteKnowledge] = useState<ClientKnowledgeEntry | null>(null);

  // Stakeholder state
  const [addingStakeholder, setAddingStakeholder] = useState(false);
  const [confirmDeleteStakeholder, setConfirmDeleteStakeholder] = useState<StakeholderRecord | null>(null);

  // Conflicts
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoading(true);
    onLoadingChange?.(true);
    fetchClientMemory(apiKey, namespace)
      .then(m => {
        setMemory(m);
        onHasMemory?.(true);
      })
      .catch(() => { setMemory(null); onHasMemory?.(false); })
      .finally(() => { setLoading(false); onLoadingChange?.(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey]);

  // ── Knowledge handlers ──────────────────────────────────────────

  const handleAddKnowledge = async (content: string, category: ClientKnowledgeEntry['category']) => {
    if (!memory) return;
    const entry = await addKnowledgeEntry(apiKey, namespace, content, category);
    setMemory({ ...memory, knowledge: [...memory.knowledge, entry] });
    setAddingKnowledge(false);
  };

  const handleEditKnowledge = async (id: string, content: string) => {
    if (!memory) return;
    // Optimistic update
    const prev = memory.knowledge;
    setMemory({ ...memory, knowledge: memory.knowledge.map(e => e.id === id ? { ...e, content } : e) });
    try {
      await updateClientKnowledgeEntry(apiKey, namespace, id, content);
    } catch {
      setMemory({ ...memory, knowledge: prev });
    }
  };

  const handleDeleteKnowledge = async () => {
    if (!memory || !confirmDeleteKnowledge) return;
    const id = confirmDeleteKnowledge.id;
    const prev = memory.knowledge;
    setMemory({ ...memory, knowledge: memory.knowledge.filter(e => e.id !== id) });
    setConfirmDeleteKnowledge(null);
    try {
      await deleteClientKnowledgeEntry(apiKey, namespace, id);
    } catch {
      setMemory({ ...memory, knowledge: prev });
    }
  };

  // ── Stakeholder handlers ────────────────────────────────────────

  const handleAddStakeholder = async (name: string, role: string) => {
    if (!memory) return;
    const record = await addStakeholder(apiKey, namespace, { name, role });
    setMemory({ ...memory, stakeholders: [...memory.stakeholders, record] });
    setAddingStakeholder(false);
  };

  const handleEditStakeholder = async (id: string, updates: Partial<{ name: string; role: string }>) => {
    if (!memory) return;
    const prev = memory.stakeholders;
    setMemory({ ...memory, stakeholders: memory.stakeholders.map(s => s.id === id ? { ...s, ...updates } : s) });
    try {
      await updateStakeholder(apiKey, namespace, id, updates);
    } catch {
      setMemory({ ...memory, stakeholders: prev });
    }
  };

  const handleDeleteStakeholder = async () => {
    if (!memory || !confirmDeleteStakeholder) return;
    const id = confirmDeleteStakeholder.id;
    const prev = memory.stakeholders;
    setMemory({ ...memory, stakeholders: memory.stakeholders.filter(s => s.id !== id) });
    setConfirmDeleteStakeholder(null);
    try {
      await deleteStakeholder(apiKey, namespace, id);
    } catch {
      setMemory({ ...memory, stakeholders: prev });
    }
  };

  // ── Conflict handler ────────────────────────────────────────────

  const handleResolveConflict = async (id: string, resolution: 'keep_old' | 'use_new' | 'keep_both') => {
    if (!memory) return;
    await resolveConflict(apiKey, namespace, id, resolution);
    setMemory({ ...memory, conflicts: memory.conflicts.filter(c => c.id !== id) });
  };

  // ── Render ──────────────────────────────────────────────────────

  if (!namespace) return null;

  const unresolvedConflicts = memory?.conflicts.filter(c => c.status === 'needs_review') ?? [];

  return (
    <>
      <Section
        label="Memory"
        loading={loading}
        badge={unresolvedConflicts.length}
      >
        {!memory ? (
          <div style={{ padding: '2px 8px 4px 12px' }}>
            <span className="sidebar-label" style={{ color: 'var(--muted)', opacity: 0.4, fontSize: 13 }}>No memory yet</span>
          </div>
        ) : (
          <>
            {/* Stable fields */}
            <StableFields memory={memory} />

            {/* Knowledge sub-section */}
            <SubHeader label="Knowledge" onAdd={() => setAddingKnowledge(true)} />
            {memory.knowledge.length === 0 && !addingKnowledge && (
              <div style={{ padding: '2px 8px 4px 12px' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.4 }}>No facts yet</span>
              </div>
            )}
            {memory.knowledge.map(entry => (
              <KnowledgeRow
                key={entry.id}
                entry={entry}
                onEdit={handleEditKnowledge}
                onDelete={id => setConfirmDeleteKnowledge(memory.knowledge.find(e => e.id === id) ?? null)}
              />
            ))}
            {addingKnowledge && (
              <NewKnowledgeForm
                onSubmit={handleAddKnowledge}
                onCancel={() => setAddingKnowledge(false)}
              />
            )}

            {/* Stakeholders sub-section */}
            <SubHeader label="Stakeholders" onAdd={() => setAddingStakeholder(true)} />
            {memory.stakeholders.length === 0 && !addingStakeholder && (
              <div style={{ padding: '2px 8px 4px 12px' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', opacity: 0.4 }}>No stakeholders yet</span>
              </div>
            )}
            {memory.stakeholders.map(s => (
              <StakeholderRow
                key={s.id}
                record={s}
                onEdit={handleEditStakeholder}
                onDelete={id => setConfirmDeleteStakeholder(memory.stakeholders.find(s => s.id === id) ?? null)}
              />
            ))}
            {addingStakeholder && (
              <NewStakeholderForm
                onSubmit={handleAddStakeholder}
                onCancel={() => setAddingStakeholder(false)}
              />
            )}

            {/* Conflicts */}
            {unresolvedConflicts.length > 0 && (
              <>
                <button
                  onClick={() => setShowConflicts(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 12px', width: '100%', textAlign: 'left' }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {unresolvedConflicts.length} conflict{unresolvedConflicts.length > 1 ? 's' : ''} to review
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>{showConflicts ? '▲' : '▼'}</span>
                </button>
                {showConflicts && (
                  <ConflictsPanel
                    conflicts={unresolvedConflicts}
                    onResolve={handleResolveConflict}
                  />
                )}
              </>
            )}
          </>
        )}
      </Section>

      {/* Delete confirmations */}
      {confirmDeleteKnowledge && (
        <ConfirmDelete
          label={confirmDeleteKnowledge.content}
          onConfirm={handleDeleteKnowledge}
          onCancel={() => setConfirmDeleteKnowledge(null)}
        />
      )}
      {confirmDeleteStakeholder && (
        <ConfirmDelete
          label={`${confirmDeleteStakeholder.name} · ${confirmDeleteStakeholder.role}`}
          onConfirm={handleDeleteStakeholder}
          onCancel={() => setConfirmDeleteStakeholder(null)}
        />
      )}
    </>
  );
}
