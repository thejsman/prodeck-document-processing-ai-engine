'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import {
  fetchTemplates,
  fetchTemplate,
  saveTemplate,
  modifyTemplate,
  generateTemplate,
  type TemplateInfo,
} from '@/lib/api';

interface TemplateEditorProps {
  /** YAML injected by the AI builder. Clears after consumption. */
  aiInjectYaml?: string | null;
  /** Called after AI YAML has been consumed into editor state. */
  onAiYamlConsumed?: () => void;
  /** Called whenever editor content changes — lets parent track current YAML. */
  onContentChange?: (yaml: string) => void;
  /** When true, the built-in sidebar list is hidden (layout control from parent). */
  hideSidebar?: boolean;
  /** Drive selection from parent — triggers handleSelect when value changes. */
  externalSelect?: string | null;
  /** Called when the internal template list reloads (parent can sync its copy). */
  onTemplatesReloaded?: (templates: TemplateInfo[]) => void;
  /** Called when internal selection changes (parent can sync its selectedTemplate). */
  onSelectedChange?: (name: string | null) => void;
  /** Increment to force TemplateEditor to reload its internal template list. */
  refreshTrigger?: number;
  /**
   * Increment when a brand-new template was just created. Switches the bottom
   * composer to "generate" mode so the user can populate it with AI.
   */
  newTemplateTrigger?: number;
  /** Called when the empty-state CTA is clicked (parent opens its create modal). */
  onCreateNew?: () => void;
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

export const TEMPLATE_SCAFFOLD = SCAFFOLD;

export function TemplateEditor({
  aiInjectYaml,
  onAiYamlConsumed,
  onContentChange,
  hideSidebar,
  externalSelect,
  onTemplatesReloaded,
  onSelectedChange,
  refreshTrigger,
  newTemplateTrigger,
  onCreateNew,
}: TemplateEditorProps = {}) {
  const { apiKey } = useAuth();

  // Template list
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Editor state
  const [selected, setSelected] = useState<string | null>(null); // stores id (slug)
  const [selectedDisplayName, setSelectedDisplayName] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [loadError, setLoadError] = useState('');

  // New template (sidebar mode only)
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);

  // True when AI has generated YAML that hasn't been saved yet under a name
  const [isAiDraft, setIsAiDraft] = useState(false);

  const isDirty = content !== originalContent;

  // ── Bottom composer mode ────────────────────────────────────────
  // 'generate' — fresh template, prompt to generate content
  // 'modify'   — saved template, prompt to modify existing content
  const [composerMode, setComposerMode] = useState<'generate' | 'modify'>('modify');
  const [composerInput, setComposerInput] = useState('');
  const [composerWorking, setComposerWorking] = useState(false);
  const [composerError, setComposerError] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // ── AI injection (legacy path — sidebar mode) ───────────────────

  useEffect(() => {
    if (!aiInjectYaml) return;
    setContent(aiInjectYaml);
    setOriginalContent('');
    setSaveError('');
    setSaveSuccess('');
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
      onTemplatesReloaded?.(list);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [apiKey, onTemplatesReloaded]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Sync external selection → internal handleSelect
  useEffect(() => {
    if (externalSelect != null && externalSelect !== selected) {
      handleSelect(externalSelect);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSelect]);

  // Notify parent when internal selection changes
  useEffect(() => {
    onSelectedChange?.(selected);
  }, [selected, onSelectedChange]);

  // Force-reload list when parent increments refreshTrigger
  useEffect(() => {
    if (refreshTrigger !== undefined) loadList();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  // Switch composer to generate mode when parent signals a new template was created
  useEffect(() => {
    if (newTemplateTrigger === undefined || newTemplateTrigger === 0) return;
    setComposerMode('generate');
    setComposerInput('');
    setComposerError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTemplateTrigger]);

  // ── Select template ─────────────────────────────────────────────

  const handleSelect = useCallback(async (id: string, displayName?: string) => {
    if (!apiKey) return;
    setSelected(id);
    setSelectedDisplayName(displayName ?? id);
    setIsAiDraft(false);
    setContent('');
    setOriginalContent('');
    setLoadError('');
    setSaveError('');
    setSaveSuccess('');
    // Existing templates always open in modify mode
    setComposerMode('modify');
    setComposerInput('');
    setComposerError('');

    try {
      const detail = await fetchTemplate(apiKey, id);
      setContent(detail.content);
      setOriginalContent(detail.content);
      // Only set content if it hasn't been populated by AI generation during the fetch
      setContent(prev => prev === '' ? detail.content : prev);
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
      // After saving, always switch to modify mode
      setComposerMode('modify');
      setComposerInput('');
      setComposerError('');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [apiKey, selected, content, isDirty, loadList]);

  // ── Create new template (sidebar mode) ─────────────────────────

  const handleCreateNew = useCallback(async () => {
    if (!apiKey) return;
    const name = newName.trim();
    if (!name || !TEMPLATE_NAME_PATTERN.test(name)) return;

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
      setSelectedDisplayName(name);
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

  // ── Bottom composer: generate or modify ─────────────────────────

  const handleComposerSubmit = useCallback(async () => {
    if (!apiKey || !composerInput.trim() || composerWorking) return;
    setComposerWorking(true);
    setComposerError('');
    try {
      if (composerMode === 'generate') {
        const yaml = await generateTemplate(apiKey, composerInput.trim());
        // Replace the scaffold with generated content — makes editor dirty so Save appears
        if (selected) {
          const named = yaml.replace(/^name:[ \t]*.+$/m, `name: ${selected}`);
          setContent(named);
        } else {
          setContent(yaml);
        }
      } else {
        const yaml = await modifyTemplate(apiKey, content, composerInput.trim());
        setContent(yaml);
      }
      setComposerInput('');
      if (composerRef.current) composerRef.current.style.height = 'auto';
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : String(err));
    } finally {
      setComposerWorking(false);
    }
  }, [apiKey, composerMode, composerInput, composerWorking, content, selected]);

  // Focus new-name input when shown
  useEffect(() => {
    if (showNew) newInputRef.current?.focus();
  }, [showNew]);

  const nameValidationError = newName.trim()
    ? TEMPLATE_NAME_PATTERN.test(newName.trim())
      ? ''
      : 'Use lowercase letters, numbers, and dashes only'
    : '';

  const showEditor = selected !== null || isAiDraft;

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="tpl-editor" style={hideSidebar ? { display: 'flex', flexDirection: 'column', alignItems: 'stretch', flex: 1, minHeight: 0, width: '100%' } : undefined}>
      {/* Left panel — template list (hidden when sidebar is managed externally) */}
      {!hideSidebar && (
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
      )}

      {/* Right panel — editor */}
      <div className={`tpl-editor-main${showEditor ? ' card' : ''}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {!showEditor ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--primary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <Icon icon={FileText} size="xl" style={{ color: 'var(--primary)' }} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', margin: '0 0 10px', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
              Proposal templates
            </h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 340, lineHeight: 1.5, letterSpacing: '0em', margin: '0 0 28px' }}>
              Templates define the sections and prompts used to generate proposals. Create one to standardise your outputs for any client or industry.
            </p>
            {onCreateNew && (
              <button
                onClick={onCreateNew}
                style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 400, cursor: 'pointer', lineHeight: 1.5, letterSpacing: '0em' }}
              >
                Create Template
              </button>
            )}
          </div>
        ) : loadError ? (
          <p className="error">{loadError}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="tpl-editor-toolbar">
              <h3>
                {isAiDraft ? (
                  <span>
                    AI Draft
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                      {hideSidebar ? '— enter a name above to save' : '— enter a name in the sidebar to save'}
                    </span>
                  </span>
                ) : (selectedDisplayName ?? selected)}
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
              style={{ flex: 1, minHeight: 0 }}
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

            {/* ── Bottom composer: generate (new template) or modify (saved template) ── */}
            <div className="chat-v2-composer-wrap" style={{ margin: '8px 0 0', padding: '12px 0 0', background: 'transparent' }}>
              <div className="chat-v2-composer">
                <textarea
                  ref={composerRef}
                  className="chat-v2-input"
                  rows={1}
                  placeholder={
                    composerMode === 'generate'
                      ? 'Generate from prompt… e.g. "Create a fintech compliance template"'
                      : 'Modify this template… e.g. "Add a pricing section"'
                  }
                  value={composerInput}
                  disabled={composerWorking}
                  onChange={e => {
                    setComposerInput(e.target.value);
                    setComposerError('');
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComposerSubmit(); }
                  }}
                />
                <button
                  className="chat-v2-send-btn"
                  onClick={handleComposerSubmit}
                  disabled={composerWorking || !composerInput.trim() || (composerMode === 'modify' && !content.trim())}
                  aria-label={composerMode === 'generate' ? 'Generate' : 'Apply change'}
                >
                  {composerWorking
                    ? <span className="spinner chat-spinner-sm" />
                    : <Icon icon={ArrowUp} size="md" />
                  }
                </button>
              </div>
              {composerError && <p className="error" style={{ fontSize: 12, marginTop: 6, paddingLeft: 2 }}>{composerError}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
