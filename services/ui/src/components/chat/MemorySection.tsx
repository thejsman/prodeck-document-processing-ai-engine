'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
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

// ── Category config ───────────────────────────────────────────────


const CATEGORY_ORDER: ClientKnowledgeEntry['category'][] = [
  'requirement', 'priority', 'constraint', 'problem',
  'opportunity', 'decision', 'preference', 'metric',
  'action_item', 'relationship', 'context',
];

const CATEGORY_DISPLAY_NAME: Record<ClientKnowledgeEntry['category'], string> = {
  requirement:  'Requirements',
  priority:     'Priorities',
  constraint:   'Constraints',
  problem:      'Problems',
  opportunity:  'Opportunities',
  decision:     'Decisions',
  preference:   'Preferences',
  metric:       'Metrics',
  action_item:  'Actions',
  relationship: 'Relationships',
  context:      'Context',
};

// ── Knowledge row ─────────────────────────────────────────────────

interface KnowledgeRowProps {
  entry: ClientKnowledgeEntry;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => void;
}

function KnowledgeRow({ entry, onEdit, onDelete }: KnowledgeRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);

  const handleSave = async () => {
    if (!draft.trim() || draft === entry.content) { setEditing(false); return; }
    setSaving(true);
    try { await onEdit(entry.id, draft.trim()); setEditing(false); }
    finally { setSaving(false); }
  };

  const handleCancel = () => { setDraft(entry.content); setEditing(false); };

  if (editing) {
    return (
      <div className="brief-field-card">
        <div className="brief-field-edit-body">
          <textarea
            ref={textareaRef}
            className="brief-field-textarea"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') handleCancel(); }}
            rows={3}
          />
          <div className="brief-field-edit-actions">
            <button className="brief-knowledge-save-btn" disabled={saving || !draft.trim()} onClick={handleSave}>
              {saving ? '…' : 'Save'}
            </button>
            <button className="brief-knowledge-cancel-btn" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="brief-field-card" style={{ position: 'relative' }}>
      <span className="brief-knowledge-content">{entry.content}</span>
      <div className="brief-field-actions" style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', background: 'var(--panel)', paddingLeft: 4 }}>
        <button className="brief-knowledge-icon-btn" title="Edit" onClick={() => { setDraft(entry.content); setEditing(true); }}>
          <Pencil size={16} strokeWidth={1.5} />
        </button>
        <button className="brief-knowledge-icon-btn" title="Delete" style={{ color: 'var(--danger, #ef4444)' }} onClick={() => onDelete(entry.id)}>
          <Trash2 size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

// ── New knowledge form ────────────────────────────────────────────

interface NewKnowledgeFormProps {
  category: ClientKnowledgeEntry['category'];
  onSubmit: (content: string, category: ClientKnowledgeEntry['category']) => Promise<void>;
  onCancel: () => void;
}

function NewKnowledgeForm({ category, onSubmit, onCancel }: NewKnowledgeFormProps) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try { await onSubmit(content.trim(), category); }
    finally { setSaving(false); }
  };

  return (
    <div className="brief-field-card">
      <div className="brief-field-edit-body">
        <textarea
          ref={textareaRef}
          className="brief-field-textarea"
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
          placeholder={`Add to ${CATEGORY_DISPLAY_NAME[category].toLowerCase()}…`}
          rows={2}
        />
        <div className="brief-field-edit-actions">
          <button className="brief-knowledge-save-btn" disabled={saving || !content.trim()} onClick={handleSubmit}>
            {saving ? '…' : 'Add'}
          </button>
          <button className="brief-knowledge-cancel-btn" onClick={onCancel}>Cancel</button>
        </div>
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
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(record.name);
  const [role, setRole] = useState(record.role);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try { await onEdit(record.id, { name: name.trim(), role: role.trim() }); setEditing(false); }
    finally { setSaving(false); }
  };

  const handleCancel = () => { setName(record.name); setRole(record.role); setEditing(false); };

  if (editing) {
    return (
      <div className="brief-field-card">
        <div className="brief-knowledge-edit">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Full name"
            autoFocus
            className="brief-knowledge-textarea"
            style={{ resize: 'none' }}
          />
          <input
            value={role}
            onChange={e => setRole(e.target.value)}
            placeholder="Role or title"
            onKeyDown={e => { if (e.key === 'Escape') handleCancel(); }}
            className="brief-knowledge-textarea"
            style={{ resize: 'none' }}
          />
          <div className="brief-knowledge-edit-actions">
            <button className="brief-knowledge-cancel-btn" onClick={handleCancel}>Cancel</button>
            <button className="brief-knowledge-save-btn" disabled={saving || !name.trim()} onClick={handleSave}>
              {saving ? '…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const initials = record.name.split(' ').map((w: string) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <div className="brief-field-card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: 'var(--primary-soft, rgba(99,102,241,0.12))', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.name}</div>
        {record.role && (
          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record.role}</div>
        )}
      </div>
      <div className="brief-field-actions">
        <button className="brief-knowledge-icon-btn" onClick={() => setEditing(true)}><Pencil size={16} strokeWidth={1.5} /></button>
        <button className="brief-knowledge-icon-btn" style={{ color: 'var(--danger, #ef4444)' }} onClick={() => onDelete(record.id)}><Trash2 size={16} strokeWidth={1.5} /></button>
      </div>
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
    try { await onSubmit(name.trim(), role.trim()); }
    finally { setSaving(false); }
  };

  return (
    <div className="brief-field-card">
      <div className="brief-knowledge-edit">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Full name"
          autoFocus
          className="brief-knowledge-textarea"
          style={{ resize: 'none' }}
        />
        <input
          value={role}
          onChange={e => setRole(e.target.value)}
          placeholder="Role or title (optional)"
          onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
          className="brief-knowledge-textarea"
          style={{ resize: 'none' }}
        />
        <div className="brief-knowledge-edit-actions">
          <button className="brief-knowledge-cancel-btn" onClick={onCancel}><X size={11} /></button>
          <button className="brief-knowledge-save-btn" disabled={saving || !name.trim()} onClick={handleSubmit}>
            {saving ? '…' : 'Add'}
          </button>
        </div>
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

  const resolutionLabels: Record<string, string> = { keep_old: 'Keep old', use_new: 'Use new', keep_both: 'Keep both' };

  return (
    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)', margin: '0 0 8px' }}>
      <div style={{ background: 'color-mix(in srgb, #f59e0b 8%, var(--panel-soft))', padding: '6px 12px', borderBottom: '1px solid color-mix(in srgb, #f59e0b 20%, transparent)' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Conflicts to review</span>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {conflicts.map((c, i) => (
          <div key={c.id} style={{ paddingBottom: i < conflicts.length - 1 ? 10 : 0, borderBottom: i < conflicts.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Existing</div>
                <p style={{ fontSize: 11, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>{c.existingContent}</p>
              </div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>New</div>
                <p style={{ fontSize: 11, color: 'var(--text)', margin: 0, lineHeight: 1.5 }}>{c.incomingContent}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['keep_old', 'use_new', 'keep_both'] as const).map(res => (
                <button
                  key={res}
                  disabled={resolving === c.id}
                  onClick={() => handle(c.id, res)}
                  style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: resolving === c.id ? 'not-allowed' : 'pointer', opacity: resolving === c.id ? 0.6 : 1 }}
                >
                  {resolving === c.id ? '…' : resolutionLabels[res]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Section header (category group) ──────────────────────────────

function SectionHeader({
  label,
  onAdd,
}: {
  label: string;
  onAdd: () => void;
}) {
  return (
    <div className="brief-panel-section-header">
      <span className="brief-panel-section-label" style={{ flex: 'none', textTransform: 'none', letterSpacing: 0, fontSize: 14, fontWeight: 400 }}>{label}</span>
      <span style={{ flex: 1 }} />
      <button
        onClick={onAdd}
        title={`Add ${label.toLowerCase()}`}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '2px 4px', display: 'flex', lineHeight: 1 }}
      >
        <Plus size={16} strokeWidth={1.5} />
      </button>
    </div>
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

  const [addingForCategory, setAddingForCategory] = useState<ClientKnowledgeEntry['category'] | null>(null);
  const [confirmDeleteKnowledge, setConfirmDeleteKnowledge] = useState<ClientKnowledgeEntry | null>(null);
  const [addingStakeholder, setAddingStakeholder] = useState(false);
  const [confirmDeleteStakeholder, setConfirmDeleteStakeholder] = useState<StakeholderRecord | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoading(true);
    onLoadingChange?.(true);
    fetchClientMemory(apiKey, namespace)
      .then(m => { setMemory(m); onHasMemory?.(true); })
      .catch(() => { setMemory(null); onHasMemory?.(false); })
      .finally(() => { setLoading(false); onLoadingChange?.(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey]);

  const handleAddKnowledge = async (content: string, category: ClientKnowledgeEntry['category']) => {
    if (!memory) return;
    const entry = await addKnowledgeEntry(apiKey, namespace, content, category);
    setMemory({ ...memory, knowledge: [...memory.knowledge, entry] });
    setAddingForCategory(null);
  };

  const handleEditKnowledge = async (id: string, content: string) => {
    if (!memory) return;
    const prev = memory.knowledge;
    setMemory({ ...memory, knowledge: memory.knowledge.map(e => e.id === id ? { ...e, content } : e) });
    try { await updateClientKnowledgeEntry(apiKey, namespace, id, content); }
    catch { setMemory({ ...memory, knowledge: prev }); }
  };

  const handleDeleteKnowledge = async () => {
    if (!memory || !confirmDeleteKnowledge) return;
    const id = confirmDeleteKnowledge.id;
    const prev = memory.knowledge;
    setMemory({ ...memory, knowledge: memory.knowledge.filter(e => e.id !== id) });
    setConfirmDeleteKnowledge(null);
    try { await deleteClientKnowledgeEntry(apiKey, namespace, id); }
    catch { setMemory({ ...memory, knowledge: prev }); }
  };

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
    try { await updateStakeholder(apiKey, namespace, id, updates); }
    catch { setMemory({ ...memory, stakeholders: prev }); }
  };

  const handleDeleteStakeholder = async () => {
    if (!memory || !confirmDeleteStakeholder) return;
    const id = confirmDeleteStakeholder.id;
    const prev = memory.stakeholders;
    setMemory({ ...memory, stakeholders: memory.stakeholders.filter(s => s.id !== id) });
    setConfirmDeleteStakeholder(null);
    try { await deleteStakeholder(apiKey, namespace, id); }
    catch { setMemory({ ...memory, stakeholders: prev }); }
  };

  const handleResolveConflict = async (id: string, resolution: 'keep_old' | 'use_new' | 'keep_both') => {
    if (!memory) return;
    await resolveConflict(apiKey, namespace, id, resolution);
    setMemory({ ...memory, conflicts: memory.conflicts.filter(c => c.id !== id) });
  };

  if (!namespace) return null;

  if (loading) {
    return (
      <div style={{ padding: '16px 12px' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', opacity: 0.5 }}>Loading…</span>
      </div>
    );
  }

  if (!memory) {
    return (
      <div style={{ padding: '16px 16px' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', opacity: 0.45 }}>No memory yet</span>
      </div>
    );
  }

  const unresolvedConflicts = memory.conflicts.filter(c => c.status === 'needs_review');

  return (
    <>
      {/* Knowledge by category */}
      {CATEGORY_ORDER.map(cat => {
        const entries = memory.knowledge.filter(e => e.category === cat);
        const isAdding = addingForCategory === cat;
        return (
          <div key={cat} className="brief-side-panel-section">
            <SectionHeader
              label={CATEGORY_DISPLAY_NAME[cat]}
              onAdd={() => setAddingForCategory(isAdding ? null : cat)}
            />
            <div className="brief-side-panel-fields" style={{ maxHeight: 245, overflowY: 'auto' }}>
              {entries.map(entry => (
                <KnowledgeRow
                  key={entry.id}
                  entry={entry}
                  onEdit={handleEditKnowledge}
                  onDelete={id => setConfirmDeleteKnowledge(memory.knowledge.find(e => e.id === id) ?? null)}
                />
              ))}
              {isAdding && (
                <NewKnowledgeForm
                  category={cat}
                  onSubmit={handleAddKnowledge}
                  onCancel={() => setAddingForCategory(null)}
                />
              )}
              {entries.length === 0 && !isAdding && (
                <p style={{ fontSize: 13, color: 'var(--muted)', opacity: 0.4, margin: '2px 0 4px', paddingLeft: 4 }}>None yet</p>
              )}
            </div>
          </div>
        );
      })}

      {/* Stakeholders */}
      <div className="brief-side-panel-section">
        <SectionHeader
          label="Stakeholders"
          onAdd={() => setAddingStakeholder(true)}
        />
        <div className="brief-side-panel-fields" style={{ maxHeight: 245, overflowY: 'auto' }}>
          {memory.stakeholders.map(s => (
            <StakeholderRow
              key={s.id}
              record={s}
              onEdit={handleEditStakeholder}
              onDelete={id => setConfirmDeleteStakeholder(memory.stakeholders.find(sh => sh.id === id) ?? null)}
            />
          ))}
          {addingStakeholder && (
            <NewStakeholderForm onSubmit={handleAddStakeholder} onCancel={() => setAddingStakeholder(false)} />
          )}
          {memory.stakeholders.length === 0 && !addingStakeholder && (
            <p style={{ fontSize: 13, color: 'var(--muted)', opacity: 0.4, margin: '2px 0 4px', paddingLeft: 4 }}>None yet</p>
          )}
        </div>
      </div>

      {/* Conflicts */}
      {unresolvedConflicts.length > 0 && (
        <div className="brief-side-panel-section">
          <button
            onClick={() => setShowConflicts(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px 6px', width: '100%' }}
          >
            <span className="brief-panel-section-dot" style={{ background: '#f59e0b' }} />
            <span className="brief-panel-section-label" style={{ color: '#b45309' }}>
              {unresolvedConflicts.length} conflict{unresolvedConflicts.length > 1 ? 's' : ''}
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>{showConflicts ? '▲' : '▼'}</span>
          </button>
          {showConflicts && <ConflictsPanel conflicts={unresolvedConflicts} onResolve={handleResolveConflict} />}
        </div>
      )}

      {confirmDeleteKnowledge && (
        <ConfirmDialog
          title="Remove entry"
          message={`"${confirmDeleteKnowledge.content.length > 80 ? confirmDeleteKnowledge.content.slice(0, 80) + '…' : confirmDeleteKnowledge.content}"`}
          confirmLabel="Remove"
          onConfirm={handleDeleteKnowledge}
          onCancel={() => setConfirmDeleteKnowledge(null)}
        />
      )}
      {confirmDeleteStakeholder && (
        <ConfirmDialog
          title="Remove stakeholder"
          message={`Remove ${confirmDeleteStakeholder.name}${confirmDeleteStakeholder.role ? ` (${confirmDeleteStakeholder.role})` : ''}?`}
          confirmLabel="Remove"
          onConfirm={handleDeleteStakeholder}
          onCancel={() => setConfirmDeleteStakeholder(null)}
        />
      )}
    </>
  );
}
