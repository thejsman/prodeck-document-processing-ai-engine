"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/lib/auth-context";
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
} from "@/lib/api";

// ── Category config ───────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  preference: "var(--primary, #6366f1)",
  constraint: "#f59e0b",
  relationship: "#a855f7",
  context: "var(--muted, #6b7280)",
  requirement: "#3b82f6",
  priority: "#f43f5e",
  problem: "#ef4444",
  opportunity: "#22c55e",
  decision: "#06b6d4",
  metric: "#14b8a6",
  action_item: "#f97316",
};

// ── Sub-section header ────────────────────────────────────────────

function SubHeader({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 12px 2px",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          flex: 1,
        }}
      >
        {label}
      </span>
      <button
        onClick={onAdd}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "1px 3px",
          color: "var(--muted)",
          borderRadius: 4,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
        }}
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const handleSave = async () => {
    if (!draft.trim() || draft === entry.content) {
      setEditing(false);
      return;
    }
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

  const dotColor = CATEGORY_COLOR[entry.category] ?? "var(--muted)";

  if (editing) {
    return (
      <div className="brief-field-card">
        <div className="brief-field-edit-body">
          <textarea
            ref={textareaRef}
            className="brief-field-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
            }}
            rows={3}
          />
          <div className="brief-field-edit-actions">
            <button
              className="brief-knowledge-save-btn"
              disabled={saving || !draft.trim()}
              onClick={handleSave}
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              className="brief-knowledge-cancel-btn"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="brief-field-card" style={{ position: "relative" }}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
          marginTop: 2,
        }}
      />
      <span className="brief-knowledge-content" style={{ flex: 1 }}>
        {entry.content}
      </span>
      <div
        className="brief-field-actions"
        style={{
          position: "absolute",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          background: "var(--panel)",
          paddingLeft: 4,
        }}
      >
        <button
          className="brief-knowledge-icon-btn"
          title="Edit"
          onClick={() => {
            setDraft(entry.content);
            setEditing(true);
          }}
        >
          <Pencil size={16} strokeWidth={1.5} />
        </button>
        <button
          className="brief-knowledge-icon-btn"
          title="Delete"
          style={{ color: "var(--danger, #ef4444)" }}
          onClick={() => onDelete(entry.id)}
        >
          <Trash2 size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

// ── New knowledge form ────────────────────────────────────────────

interface NewKnowledgeFormProps {
  onSubmit: (
    content: string,
    category: ClientKnowledgeEntry["category"],
  ) => Promise<void>;
  onCancel: () => void;
}

function NewKnowledgeForm({ onSubmit, onCancel }: NewKnowledgeFormProps) {
  const [content, setContent] = useState("");
  const [category, setCategory] =
    useState<ClientKnowledgeEntry["category"]>("context");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

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
    <div style={{ padding: "4px 8px 4px 12px" }}>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Add a fact…"
        rows={3}
        style={{
          width: "100%",
          background: "var(--bg)",
          border: "1px solid var(--primary)",
          borderRadius: 6,
          color: "var(--text)",
          fontSize: 12,
          lineHeight: 1.5,
          padding: "6px 8px",
          resize: "vertical",
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}
      >
        <select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as ClientKnowledgeEntry["category"])
          }
          style={{
            flex: 1,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            color: "var(--text)",
            fontSize: 11,
            padding: "2px 6px",
            outline: "none",
          }}
        >
          <option value="context">Context</option>
          <option value="preference">Preference</option>
          <option value="constraint">Constraint</option>
          <option value="relationship">Relationship</option>
        </select>
        <button
          onClick={onCancel}
          style={{
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "2px 6px",
            fontSize: 11,
            cursor: "pointer",
            color: "var(--muted)",
          }}
        >
          <X size={11} />
        </button>
        <button
          onClick={handleSubmit}
          disabled={saving || !content.trim()}
          style={{
            background: "var(--primary)",
            border: "none",
            borderRadius: 5,
            padding: "2px 8px",
            fontSize: 11,
            cursor: saving || !content.trim() ? "not-allowed" : "pointer",
            color: "#fff",
            opacity: saving || !content.trim() ? 0.6 : 1,
          }}
        >
          {saving ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}

// ── Stakeholder row ───────────────────────────────────────────────

interface StakeholderRowProps {
  record: StakeholderRecord;
  onEdit: (
    id: string,
    updates: Partial<{ name: string; role: string; notes: string }>,
  ) => Promise<void>;
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
      <div className="brief-field-card">
        <div className="brief-knowledge-edit">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            autoFocus
            className="brief-knowledge-textarea"
            style={{ resize: "none" }}
          />
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role or title"
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
            }}
            className="brief-knowledge-textarea"
            style={{ resize: "none" }}
          />
          <div className="brief-knowledge-edit-actions">
            <button
              className="brief-knowledge-cancel-btn"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              className="brief-knowledge-save-btn"
              disabled={saving || !name.trim()}
              onClick={handleSave}
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const initials = record.name
    .split(" ")
    .map((w: string) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="brief-field-card"
      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          flexShrink: 0,
          background: "var(--primary-soft, rgba(99,102,241,0.12))",
          color: "var(--primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {initials}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {record.name}
        </div>
        {record.role && (
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {record.role}
          </div>
        )}
      </div>
      <div className="brief-field-actions">
        <button
          className="brief-knowledge-icon-btn"
          onClick={() => setEditing(true)}
        >
          <Pencil size={16} strokeWidth={1.5} />
        </button>
        <button
          className="brief-knowledge-icon-btn"
          style={{ color: "var(--danger, #ef4444)" }}
          onClick={() => onDelete(record.id)}
        >
          <Trash2 size={16} strokeWidth={1.5} />
        </button>
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
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
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
    <div className="brief-field-card">
      <div className="brief-knowledge-edit">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoFocus
          className="brief-knowledge-textarea"
          style={{ resize: "none" }}
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role or title (optional)"
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
          }}
          className="brief-knowledge-textarea"
          style={{ resize: "none" }}
        />
        <div className="brief-knowledge-edit-actions">
          <button className="brief-knowledge-cancel-btn" onClick={onCancel}>
            <X size={11} />
          </button>
          <button
            className="brief-knowledge-save-btn"
            disabled={saving || !name.trim()}
            onClick={handleSubmit}
          >
            {saving ? "…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Conflicts panel ───────────────────────────────────────────────

interface ConflictsPanelProps {
  conflicts: ClientMemory["conflicts"];
  onResolve: (
    id: string,
    resolution: "keep_old" | "use_new" | "keep_both",
  ) => Promise<void>;
}

function ConflictsPanel({ conflicts, onResolve }: ConflictsPanelProps) {
  const [resolving, setResolving] = useState<string | null>(null);

  const handle = async (
    id: string,
    resolution: "keep_old" | "use_new" | "keep_both",
  ) => {
    setResolving(id);
    try {
      await onResolve(id, resolution);
    } finally {
      setResolving(null);
    }
  };

  return (
    <div
      style={{
        margin: "4px 4px 0",
        padding: "8px 8px",
        background: "color-mix(in srgb, #f59e0b 8%, var(--panel-item))",
        borderRadius: 8,
        border: "1px solid color-mix(in srgb, #f59e0b 30%, transparent)",
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#b45309",
          margin: "0 0 6px",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        Conflicts to review
      </p>
      {conflicts.map((c) => (
        <div
          key={c.id}
          style={{
            marginBottom: 10,
            paddingBottom: 10,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            Existing:
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--text)",
              margin: "0 0 4px",
              lineHeight: 1.4,
            }}
          >
            {c.existingContent}
          </p>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
            New:
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--text)",
              margin: "0 0 8px",
              lineHeight: 1.4,
            }}
          >
            {c.incomingContent}
          </p>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["keep_old", "use_new", "keep_both"] as const).map((res) => (
              <button
                key={res}
                disabled={resolving === c.id}
                onClick={() => handle(c.id, res)}
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 5,
                  border: "1px solid var(--border)",
                  background: "var(--panel-soft)",
                  color: "var(--text)",
                  cursor: resolving === c.id ? "not-allowed" : "pointer",
                  opacity: resolving === c.id ? 0.6 : 1,
                  textTransform: "capitalize",
                }}
              >
                {resolving === c.id ? (
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 3 }}
                  >
                    <Check size={8} /> …
                  </span>
                ) : (
                  res.replace("_", " ")
                )}
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
  if (industry)
    parts.push(typeof industry === "string" ? industry : industry.join(", "));
  if (contact)
    parts.push(
      `Contact: ${typeof contact === "string" ? contact : contact.join(", ")}`,
    );

  if (!parts.length) return null;

  return (
    <div style={{ padding: "2px 12px 6px" }}>
      {parts.map((p, i) => (
        <p
          key={i}
          style={{
            fontSize: 11,
            color: "var(--muted)",
            margin: "1px 0",
            lineHeight: 1.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={p}
        >
          {p}
        </p>
      ))}
    </div>
  );
}

// ── Section header (category group) ──────────────────────────────

function SectionHeader({
  label,
  color,
  count,
  onAdd,
}: {
  label: string;
  color: string;
  count: number;
  onAdd: () => void;
}) {
  return (
    <div className="brief-panel-section-header">
      <span
        className="brief-panel-section-label"
        style={{
          flex: "none",
          textTransform: "none",
          letterSpacing: 0,
          fontSize: 14,
          fontWeight: 400,
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1 }} />
      <button
        onClick={onAdd}
        title={`Add ${label.toLowerCase()}`}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--muted)",
          padding: "2px 4px",
          display: "flex",
          lineHeight: 1,
        }}
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

export function MemorySection({
  namespace,
  onHasMemory,
  onLoadingChange,
}: Props) {
  const { apiKey } = useAuth();
  const [memory, setMemory] = useState<ClientMemory | null>(null);
  const [loading, setLoading] = useState(true);

  const [addingForCategory, setAddingForCategory] = useState<
    ClientKnowledgeEntry["category"] | null
  >(null);
  const [confirmDeleteKnowledge, setConfirmDeleteKnowledge] =
    useState<ClientKnowledgeEntry | null>(null);
  const [addingStakeholder, setAddingStakeholder] = useState(false);
  const [confirmDeleteStakeholder, setConfirmDeleteStakeholder] =
    useState<StakeholderRecord | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);

  useEffect(() => {
    if (!namespace || !apiKey) return;
    setLoading(true);
    onLoadingChange?.(true);
    fetchClientMemory(apiKey, namespace)
      .then((m) => {
        setMemory(m);
        onHasMemory?.(true);
      })
      .catch(() => {
        setMemory(null);
        onHasMemory?.(false);
      })
      .finally(() => {
        setLoading(false);
        onLoadingChange?.(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, apiKey]);

  const handleAddKnowledge = async (
    content: string,
    category: ClientKnowledgeEntry["category"],
  ) => {
    if (!memory) return;
    const entry = await addKnowledgeEntry(apiKey, namespace, content, category);
    setMemory({ ...memory, knowledge: [...memory.knowledge, entry] });
    setAddingKnowledge(false);
  };

  const handleEditKnowledge = async (id: string, content: string) => {
    if (!memory) return;
    const prev = memory.knowledge;
    setMemory({
      ...memory,
      knowledge: memory.knowledge.map((e) =>
        e.id === id ? { ...e, content } : e,
      ),
    });
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
    setMemory({
      ...memory,
      knowledge: memory.knowledge.filter((e) => e.id !== id),
    });
    setConfirmDeleteKnowledge(null);
    try {
      await deleteClientKnowledgeEntry(apiKey, namespace, id);
    } catch {
      setMemory({ ...memory, knowledge: prev });
    }
  };

  const handleAddStakeholder = async (name: string, role: string) => {
    if (!memory) return;
    const record = await addStakeholder(apiKey, namespace, { name, role });
    setMemory({ ...memory, stakeholders: [...memory.stakeholders, record] });
    setAddingStakeholder(false);
  };

  const handleEditStakeholder = async (
    id: string,
    updates: Partial<{ name: string; role: string }>,
  ) => {
    if (!memory) return;
    const prev = memory.stakeholders;
    setMemory({
      ...memory,
      stakeholders: memory.stakeholders.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      ),
    });
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
    setMemory({
      ...memory,
      stakeholders: memory.stakeholders.filter((s) => s.id !== id),
    });
    setConfirmDeleteStakeholder(null);
    try {
      await deleteStakeholder(apiKey, namespace, id);
    } catch {
      setMemory({ ...memory, stakeholders: prev });
    }
  };

  const handleResolveConflict = async (
    id: string,
    resolution: "keep_old" | "use_new" | "keep_both",
  ) => {
    if (!memory) return;
    await resolveConflict(apiKey, namespace, id, resolution);
    setMemory({
      ...memory,
      conflicts: memory.conflicts.filter((c) => c.id !== id),
    });
  };

  if (!namespace) return null;

  if (loading) {
    return (
      <div style={{ padding: "16px 12px" }}>
        <span style={{ fontSize: 13, color: "var(--muted)", opacity: 0.5 }}>
          Loading…
        </span>
      </div>
    );
  }

  if (!memory) {
    return (
      <div style={{ padding: "16px 16px" }}>
        <span style={{ fontSize: 13, color: "var(--muted)", opacity: 0.45 }}>
          No memory yet
        </span>
      </div>
    );
  }

  const unresolvedConflicts = memory.conflicts.filter(
    (c) => c.status === "needs_review",
  );

  return (
    <>
      {/* Knowledge by category */}
      {CATEGORIES.map((cat) => {
        const entries = memory.knowledge.filter((e) => e.category === cat);
        const isAdding = addingForCategory === cat;
        return (
          <div key={cat} className="brief-side-panel-section">
            <SectionHeader
              label={`${CATEGORY_DISPLAY[cat]}s`}
              color={CATEGORY_COLOR[cat]}
              count={entries.length}
              onAdd={() => setAddingForCategory(isAdding ? null : cat)}
            />
            <div
              className="brief-side-panel-fields"
              style={{ maxHeight: 245, overflowY: "auto" }}
            >
              {entries.map((entry) => (
                <KnowledgeRow
                  key={entry.id}
                  entry={entry}
                  onEdit={handleEditKnowledge}
                  onDelete={(id) =>
                    setConfirmDeleteKnowledge(
                      memory.knowledge.find((e) => e.id === id) ?? null,
                    )
                  }
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
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    opacity: 0.4,
                    margin: "2px 0 4px",
                    paddingLeft: 4,
                  }}
                >
                  None yet
                </p>
              )}
            </div>
          </div>
        );
      })}

      {/* Stakeholders */}
      <div className="brief-side-panel-section">
        <SectionHeader
          label="Stakeholders"
          color="#3b82f6"
          count={memory.stakeholders.length}
          onAdd={() => setAddingStakeholder(true)}
        />
        <div
          className="brief-side-panel-fields"
          style={{ maxHeight: 245, overflowY: "auto" }}
        >
          {memory.stakeholders.map((s) => (
            <StakeholderRow
              key={s.id}
              record={s}
              onEdit={handleEditStakeholder}
              onDelete={(id) =>
                setConfirmDeleteStakeholder(
                  memory.stakeholders.find((sh) => sh.id === id) ?? null,
                )
              }
            />
          ))}
          {addingStakeholder && (
            <NewStakeholderForm
              onSubmit={handleAddStakeholder}
              onCancel={() => setAddingStakeholder(false)}
            />
          )}
          {memory.stakeholders.length === 0 && !addingStakeholder && (
            <p
              style={{
                fontSize: 13,
                color: "var(--muted)",
                opacity: 0.4,
                margin: "2px 0 4px",
                paddingLeft: 4,
              }}
            >
              None yet
            </p>
          )}
        </div>
      </div>

      {/* Conflicts */}
      {unresolvedConflicts.length > 0 && (
        <div className="brief-side-panel-section">
          <button
            onClick={() => setShowConflicts((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 4px 6px",
              width: "100%",
            }}
          >
            <span
              className="brief-panel-section-dot"
              style={{ background: "#f59e0b" }}
            />
            <span
              className="brief-panel-section-label"
              style={{ color: "#b45309" }}
            >
              {unresolvedConflicts.length} conflict
              {unresolvedConflicts.length > 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>
              {showConflicts ? "▲" : "▼"}
            </span>
          </button>
          {showConflicts && (
            <ConflictsPanel
              conflicts={unresolvedConflicts}
              onResolve={handleResolveConflict}
            />
          )}
        </div>
      )}

      {confirmDeleteKnowledge && (
        <ConfirmDialog
          title="Remove entry"
          message={`"${confirmDeleteKnowledge.content.length > 80 ? confirmDeleteKnowledge.content.slice(0, 80) + "…" : confirmDeleteKnowledge.content}"`}
          confirmLabel="Remove"
          onConfirm={handleDeleteKnowledge}
          onCancel={() => setConfirmDeleteKnowledge(null)}
        />
      )}
      {confirmDeleteStakeholder && (
        <ConfirmDialog
          title="Remove stakeholder"
          message={`Remove ${confirmDeleteStakeholder.name}${confirmDeleteStakeholder.role ? ` (${confirmDeleteStakeholder.role})` : ""}?`}
          confirmLabel="Remove"
          onConfirm={handleDeleteStakeholder}
          onCancel={() => setConfirmDeleteStakeholder(null)}
        />
      )}
    </>
  );
}
