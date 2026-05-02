'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  fetchTemplates,
  fetchTemplate,
  saveTemplate,
  generateTemplate,
  modifyTemplate,
  deleteTemplate,
  type TemplateInfo,
} from '@/lib/api';

const BLANK_YAML = `name: My Template
version: "1.0"
description: ""

sections:
  - title: Executive Summary
    query: overview objectives scope
    instruction: "Write an executive summary for a proposal to {client} in the {industry} industry."
`;

export function TemplateManager() {
  const { apiKey } = useAuth();

  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [newError, setNewError] = useState('');

  const [showModifyBar, setShowModifyBar] = useState(false);
  const [modifyInstruction, setModifyInstruction] = useState('');
  const [modifying, setModifying] = useState(false);

  const loadList = useCallback(async () => {
    if (!apiKey) return;
    setListLoading(true);
    setListError('');
    try {
      const list = await fetchTemplates(apiKey);
      setTemplates(list);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { loadList(); }, [loadList]);

  const selectTemplate = useCallback(async (id: string) => {
    if (!apiKey) return;
    setSelectedId(id);
    setEditorLoading(true);
    setError('');
    setSuccess('');
    setShowModifyBar(false);
    setModifyInstruction('');
    try {
      const detail = await fetchTemplate(apiKey, id);
      setEditorValue(detail.content);
      setSavedValue(detail.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditorLoading(false);
    }
  }, [apiKey]);

  const handleSave = async () => {
    if (!apiKey || !selectedId || !editorValue.trim()) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await saveTemplate(apiKey, selectedId, editorValue);
      setSavedValue(editorValue);
      setSuccess('Template saved');
      setTimeout(() => setSuccess(''), 3000);
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!apiKey || !selectedId) return;
    if (!window.confirm(`Delete template "${selectedId}"? This cannot be undone.`)) return;
    setDeleting(true);
    setError('');
    try {
      await deleteTemplate(apiKey, selectedId);
      setSelectedId(null);
      setEditorValue('');
      setSavedValue('');
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  const handleGenerate = async () => {
    if (!apiKey || !newName.trim()) return;
    setGenerating(true);
    setNewError('');
    try {
      const yaml = newPrompt.trim()
        ? await generateTemplate(apiKey, newPrompt)
        : BLANK_YAML;
      setShowNewModal(false);
      setSelectedId(newName.trim());
      setEditorValue(yaml);
      setSavedValue('');
      setNewName('');
      setNewPrompt('');
    } catch (err) {
      setNewError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleModify = async () => {
    if (!apiKey || !modifyInstruction.trim() || !editorValue.trim()) return;
    setModifying(true);
    setError('');
    try {
      const updated = await modifyTemplate(apiKey, editorValue, modifyInstruction);
      setEditorValue(updated);
      setModifyInstruction('');
      setShowModifyBar(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModifying(false);
    }
  };

  const isDirty = editorValue !== savedValue;
  const canSave = isDirty && !saving && !!selectedId && !!editorValue.trim();
  const selectedTemplate = templates.find((t) => t.id === selectedId);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', minHeight: 500 }}>

      {/* ── Left sidebar ── */}
      <div
        className="card"
        style={{ width: 260, flexShrink: 0, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Templates</span>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => { setShowNewModal(true); setNewError(''); }}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            + New
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {listLoading ? (
            <p style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>Loading…</p>
          ) : listError ? (
            <p style={{ padding: '12px 16px', color: 'var(--danger)', fontSize: 13, margin: 0 }}>{listError}</p>
          ) : templates.length === 0 ? (
            <p style={{ padding: '12px 16px', color: 'var(--muted)', fontSize: 13, margin: 0 }}>No templates yet.</p>
          ) : (
            templates.map((t) => {
              const isActive = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  onClick={() => selectTemplate(t.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: isActive ? 'var(--panel-soft, var(--panel))' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    padding: '10px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    outline: isActive ? '2px solid var(--primary)' : 'none',
                    outlineOffset: -2,
                  }}
                >
                  <span style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--text)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {t.name || t.id}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {t.sections.length} section{t.sections.length !== 1 ? 's' : ''} · v{t.version}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right editor pane ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!selectedId ? (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
              Select a template to edit, or create a new one.
            </p>
          </div>
        ) : editorLoading ? (
          <div className="card" style={{ padding: '32px 24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>Loading…</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                {selectedTemplate?.name || selectedId}
              </span>
              {selectedTemplate && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {selectedTemplate.sections.length} section{selectedTemplate.sections.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {(error || success || isDirty) && (
              <div style={{ fontSize: 12, minHeight: 18 }}>
                {error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
                {!error && success && <span style={{ color: 'var(--success)' }}>{success}</span>}
                {!error && !success && isDirty && <span style={{ color: 'var(--warning)' }}>Unsaved changes</span>}
              </div>
            )}

            <textarea
              value={editorValue}
              onChange={(e) => { setEditorValue(e.target.value); setError(''); setSuccess(''); }}
              spellCheck={false}
              placeholder="# YAML template content"
              style={{
                width: '100%',
                minHeight: 360,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text)',
                fontFamily: '"SF Mono", "Fira Code", ui-monospace, Consolas, monospace',
                fontSize: 13,
                lineHeight: 1.65,
                padding: '14px 16px',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'var(--primary)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn btn-sm"
                onClick={() => setShowModifyBar((v) => !v)}
                disabled={modifying || !editorValue.trim()}
              >
                {showModifyBar ? 'Hide AI Modify' : 'Modify with AI'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => { setEditorValue(savedValue); setError(''); setSuccess(''); }}
                disabled={!isDirty}
              >
                Reset
              </button>
              <button
                className="btn btn-sm"
                onClick={handleDelete}
                disabled={deleting || saving}
                style={{ color: 'var(--danger)', marginLeft: 'auto' }}
              >
                {deleting ? <><span className="spinner" /> Deleting…</> : 'Delete'}
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleSave}
                disabled={!canSave}
                style={{ minWidth: 72 }}
              >
                {saving ? <><span className="spinner" /> Saving…</> : 'Save'}
              </button>
            </div>

            {showModifyBar && (
              <div style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '10px 14px',
                background: 'var(--panel)',
                borderRadius: 8,
                border: '1px solid var(--border)',
              }}>
                <input
                  className="input"
                  value={modifyInstruction}
                  onChange={(e) => setModifyInstruction(e.target.value)}
                  placeholder='e.g. "Add a Risk & Compliance section"'
                  onKeyDown={(e) => { if (e.key === 'Enter' && !modifying) handleModify(); }}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleModify}
                  disabled={modifying || !modifyInstruction.trim()}
                  style={{ flexShrink: 0, minWidth: 80 }}
                >
                  {modifying ? <><span className="spinner" /> Working…</> : 'Modify'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── New Template modal ── */}
      {showNewModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNewModal(false); }}
        >
          <div className="card" style={{ width: 420, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>New Template</h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                Template name <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="e.g. saas-proposal"
                style={{ fontSize: 13 }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>
                Describe the template
                <span style={{ marginLeft: 4, opacity: 0.7 }}>(optional — blank creates a starter skeleton)</span>
              </label>
              <textarea
                className="input"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder='e.g. "A proposal for a trampoline park focusing on safety, guest experience, and marketing."'
                rows={3}
                style={{ fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            {newError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{newError}</span>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => setShowNewModal(false)} disabled={generating}>
                Cancel
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleGenerate}
                disabled={generating || !newName.trim()}
                style={{ minWidth: 120 }}
              >
                {generating
                  ? <><span className="spinner" /> {newPrompt.trim() ? 'Generating…' : 'Creating…'}</>
                  : newPrompt.trim() ? 'Generate with AI' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
