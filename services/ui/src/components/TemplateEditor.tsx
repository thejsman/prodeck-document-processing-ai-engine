'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  fetchTemplates,
  fetchTemplate,
  saveTemplate,
  type TemplateInfo,
} from '@/lib/api';

interface TemplateEditorProps {
  /** YAML injected by the AI builder. Clears after consumption. */
  aiInjectYaml?: string | null;
  /** Called after AI YAML has been consumed into editor state. */
  onAiYamlConsumed?: () => void;
  /** Called whenever editor content changes — lets parent track current YAML. */
  onContentChange?: (yaml: string) => void;
}

const TEMPLATE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SCAFFOLD = `name: my-template
version: "1.0"
description: Describe what this template is for

sections:
  - title: "Section Title"
    query: "search query for RAG retrieval"
    instruction: >
      Write the section content for a proposal to {client}
      in the {industry} industry. Describe expectations here.
`;

export function TemplateEditor({
  aiInjectYaml,
  onAiYamlConsumed,
  onContentChange,
}: TemplateEditorProps = {}) {
  const { apiKey } = useAuth();

  // Template list
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Editor state
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [loadError, setLoadError] = useState('');

  // New template
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  // True when AI has generated YAML that hasn't been saved yet under a name
  const [isAiDraft, setIsAiDraft] = useState(false);

  const isDirty = content !== originalContent;

  // ── AI injection ────────────────────────────────────────────────

  useEffect(() => {
    if (!aiInjectYaml) return;
    setContent(aiInjectYaml);
    setOriginalContent('');
    setSaveError('');
    setSaveSuccess('');
    // No template selected yet — show draft editor and prompt user to name it
    if (!selected) {
      setIsAiDraft(true);
      setShowNew(true);
    }
    onAiYamlConsumed?.();
  }, [aiInjectYaml, onAiYamlConsumed, selected]);

  // ── Notify parent of content changes ───────────────────────────

  useEffect(() => {
    onContentChange?.(content);
  }, [content, onContentChange]);

  // ── Load template list ──────────────────────────────────────────

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

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ── Select template ─────────────────────────────────────────────

  const handleSelect = useCallback(async (name: string) => {
    if (!apiKey) return;
    setSelected(name);
    setIsAiDraft(false);
    setContent('');
    setOriginalContent('');
    setLoadError('');
    setSaveError('');
    setSaveSuccess('');

    try {
      const detail = await fetchTemplate(apiKey, name);
      setContent(detail.content);
      setOriginalContent(detail.content);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [apiKey]);

  // ── Save template ───────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!apiKey || !selected || !isDirty) return;
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');

    try {
      await saveTemplate(apiKey, selected, content);
      setOriginalContent(content);
      setSaveSuccess('Template saved');
      loadList();
      setTimeout(() => setSaveSuccess(''), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [apiKey, selected, content, isDirty, loadList]);

  // ── Create new template ─────────────────────────────────────────

  const handleCreateNew = useCallback(async () => {
    if (!apiKey) return;
    const name = newName.trim();
    if (!name || !TEMPLATE_NAME_PATTERN.test(name)) return;

    // If there is AI-generated content in the editor, save that instead of
    // the blank scaffold — this is how the generated template gets persisted.
    // Also normalise the YAML `name:` field to match the file name so that
    // the template list can route back to this file correctly.
    const yamlToSave = isAiDraft && content.trim()
      ? content.replace(/^name:[ \t]*.+$/m, `name: ${name}`)
      : SCAFFOLD.replace('my-template', name);

    setSaving(true);
    setSaveError('');
    try {
      await saveTemplate(apiKey, name, yamlToSave);
      setShowNew(false);
      setNewName('');
      setIsAiDraft(false);
      await loadList();
      setSelected(name);
      setContent(yamlToSave);
      setOriginalContent(yamlToSave);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [apiKey, newName, content, isAiDraft, loadList]);

  const handleCancelNew = useCallback(() => {
    setShowNew(false);
    setNewName('');
    // If the user cancels while reviewing an AI draft, clear it
    if (isAiDraft) {
      setIsAiDraft(false);
      setContent('');
      setOriginalContent('');
    }
  }, [isAiDraft]);

  const handleReset = useCallback(() => {
    setContent(originalContent);
    setSaveError('');
    setSaveSuccess('');
  }, [originalContent]);

  // Focus new-name input when shown
  useEffect(() => {
    if (showNew) newInputRef.current?.focus();
  }, [showNew]);

  const nameValidationError = newName.trim()
    ? TEMPLATE_NAME_PATTERN.test(newName.trim())
      ? ''
      : 'Use lowercase letters, numbers, and dashes only'
    : '';

  // Show the editor panel when a template is selected OR when there is an
  // AI-generated draft waiting to be named and saved.
  const showEditor = selected !== null || isAiDraft;

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="tpl-editor">
      {/* Left panel — template list */}
      <div className="tpl-editor-sidebar card">
        <div className="tpl-editor-sidebar-header">
          <h3>Templates</h3>
          <button
            className="btn"
            onClick={() => (showNew ? handleCancelNew() : setShowNew(true))}
            style={{ padding: '4px 10px', fontSize: 13 }}
          >
            {showNew ? 'Cancel' : '+ New'}
          </button>
        </div>

        {showNew && (
          <div className="tpl-editor-new">
            {isAiDraft && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Name the AI-generated template to save it.
              </p>
            )}
            <input
              ref={newInputRef}
              className="input"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase())}
              placeholder="e.g. sales-brief"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateNew();
                if (e.key === 'Escape') handleCancelNew();
              }}
            />
            {nameValidationError && <p className="error">{nameValidationError}</p>}
            <button
              className="btn btn-primary"
              onClick={handleCreateNew}
              disabled={!newName.trim() || !!nameValidationError || saving}
              style={{ marginTop: 6, width: '100%' }}
            >
              {isAiDraft ? 'Save AI Template' : 'Create'}
            </button>
          </div>
        )}

        {listLoading ? (
          <p className="loading">Loading templates&hellip;</p>
        ) : listError ? (
          <p className="error">{listError}</p>
        ) : templates.length === 0 ? (
          <p className="muted" style={{ padding: '12px 0' }}>No templates found</p>
        ) : (
          <ul className="tpl-list">
            {templates.map((t) => (
              <li
                key={t.name}
                className={`tpl-list-item${selected === t.name ? ' tpl-list-item--active' : ''}`}
                onClick={() => handleSelect(t.name)}
              >
                <span className="tpl-list-name">{t.name}</span>
                <span className="muted" style={{ fontSize: 11 }}>v{t.version}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right panel — editor */}
      <div className="tpl-editor-main card">
        {!showEditor ? (
          <div className="placeholder" style={{ minHeight: 300 }}>
            <p className="muted">Select a template to edit, or create a new one.</p>
          </div>
        ) : loadError ? (
          <p className="error">{loadError}</p>
        ) : (
          <>
            <div className="tpl-editor-toolbar">
              <h3>
                {isAiDraft ? (
                  <span>
                    AI Draft
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                      — enter a name in the sidebar to save
                    </span>
                  </span>
                ) : selected}
              </h3>
              <div className="tpl-editor-actions">
                {isDirty && !isAiDraft && (
                  <button className="btn" onClick={handleReset} disabled={saving}>
                    Reset
                  </button>
                )}
                {!isAiDraft && (
                  <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    disabled={!isDirty || saving}
                    style={{ width: 'auto' }}
                  >
                    {saving ? <><span className="spinner" /> Saving&hellip;</> : 'Save'}
                  </button>
                )}
              </div>
            </div>

            <textarea
              className="tpl-editor-textarea"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setSaveError('');
                setSaveSuccess('');
              }}
              spellCheck={false}
            />

            {saveError && <p className="error" style={{ marginTop: 8 }}>{saveError}</p>}
            {saveSuccess && <p className="tpl-editor-success">{saveSuccess}</p>}
          </>
        )}
      </div>
    </div>
  );
}
