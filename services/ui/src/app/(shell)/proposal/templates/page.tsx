'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronRight, X, MoreHorizontal, Trash2, RotateCcw, Layout } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/auth-context';
import { TemplateEditor, TEMPLATE_SCAFFOLD } from '@/components/TemplateEditor';
import { fetchTemplates, saveTemplate, deleteTemplate, type TemplateInfo } from '@/lib/api';
import { toast } from 'sonner';

const TEMPLATE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function TemplatesPage() {
  const { apiKey } = useAuth();

  // ── New template trigger: incremented on create to signal composer ──
  const [newTemplateTrigger, setNewTemplateTrigger] = useState(0);

  // ── Right panel: template list ──────────────────────────────────
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [templatesExpanded, setTemplatesExpanded] = useState(true);

  // ── Selection: drives TemplateEditor via externalSelect ─────────
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  // ── New template modal ──────────────────────────────────────────
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSaving, setNewSaving] = useState(false);
  const [newError, setNewError] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const newInputRef = useRef<HTMLInputElement>(null);

  // ── Template list: hover / menu / delete state ─────────────────
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);
  const [menuTemplate, setMenuTemplate] = useState<string | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<string | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);

  // ── Right panel: resize ─────────────────────────────────────────
  const [rightPanelWidth, setRightPanelWidth] = useState(260);
  const isResizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(260);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = rightPanelWidth;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = resizeStartX.current - ev.clientX;
      setRightPanelWidth(Math.min(480, Math.max(180, resizeStartWidth.current + delta)));
    };
    const onMouseUp = () => {
      isResizing.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [rightPanelWidth]);

  // ── Load template list ──────────────────────────────────────────
  const loadTemplates = useCallback(async () => {
    if (!apiKey) return;
    setListLoading(true);
    setListError('');
    try {
      const list = await fetchTemplates(apiKey);
      setTemplates(list.filter(t => t.id !== 'default'));
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, [apiKey]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Refresh list when the user returns to this tab (e.g. after chat generates a template)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadTemplates(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadTemplates]);

  // Close template menu on outside click
  useEffect(() => {
    if (!menuTemplate) return;
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setMenuTemplate(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuTemplate]);

  const handleDeleteTemplate = useCallback(async (name: string) => {
    setMenuTemplate(null);
    if (!window.confirm(`Delete template "${name}"? This cannot be undone.`)) return;
    setDeletingTemplate(name);
    try {
      await deleteTemplate(apiKey!, name);
      if (selectedTemplate === name) setSelectedTemplate(null);
      setTemplates(prev => prev.filter(t => t.id !== name));
      toast.success(`Deleted "${name}"`);
    } catch (err) {
      toast.error('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeletingTemplate(null);
    }
  }, [apiKey, selectedTemplate, loadTemplates]);

  // ── Modal: focus input + Escape to close ───────────────────────
  useEffect(() => {
    if (showNewModal) {
      setTimeout(() => newInputRef.current?.focus(), 50);
    } else {
      setNewName('');
      setNewError('');
    }
  }, [showNewModal]);

  useEffect(() => {
    if (!showNewModal) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowNewModal(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showNewModal]);

  // ── Create new template ────────────────────────────────────────
  const nameValidationError = newName.trim()
    ? TEMPLATE_NAME_PATTERN.test(newName.trim()) ? '' : 'Use lowercase letters, numbers, and dashes only'
    : '';

  const handleCreateNew = useCallback(async () => {
    const name = newName.trim();
    if (!name || !TEMPLATE_NAME_PATTERN.test(name) || !apiKey) return;
    setNewSaving(true);
    setNewError('');
    try {
      const newTemplate = await saveTemplate(apiKey, name, TEMPLATE_SCAFFOLD.replace('my-template', name));
      setShowNewModal(false);
      setTemplates(prev => [newTemplate, ...prev.filter(t => t.name !== name)]);
      setRefreshTrigger(k => k + 1);
      setSelectedTemplate(name);
      setNewTemplateTrigger(k => k + 1);
    } catch (err) {
      setNewError(err instanceof Error ? err.message : String(err));
    } finally {
      setNewSaving(false);
    }
  }, [apiKey, newName, loadTemplates]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Topbar ── */}
      <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingLeft: 16, paddingRight: 8 }}>
        <span className="topbar-ns-label" style={{ flex: 1 }}>Templates</span>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => setShowNewModal(true)}
          style={{ width: 'auto' }}
        >
          New Template
        </button>
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT: main content ── */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '20px 24px' }}>
          <TemplateEditor
            hideSidebar
            externalSelect={selectedTemplate}
            onSelectedChange={setSelectedTemplate}
            refreshTrigger={refreshTrigger}
            newTemplateTrigger={newTemplateTrigger}
            onCreateNew={() => setShowNewModal(true)}
          />
        </div>

        {/* ── Resize handle ── */}
        <div
          onMouseDown={handleResizeMouseDown}
          style={{
            width: 5,
            flexShrink: 0,
            cursor: 'col-resize',
            background: 'transparent',
            borderLeft: '1px solid var(--border)',
            transition: 'background 0.15s',
            zIndex: 10,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'var(--primary)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        />

        {/* ── RIGHT panel ── */}
        <div style={{ width: rightPanelWidth, flexShrink: 0, overflowY: 'auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          <div>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <button
                onClick={() => setTemplatesExpanded(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <span className="sidebar-group-label" style={{ padding: 0, flex: 1, textAlign: 'left' }}>Templates</span>
                <Icon
                  icon={ChevronRight}
                  size="sm"
                  style={{ color: 'var(--muted)', opacity: 0.6, transform: templatesExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}
                />
              </button>
              <button
                onClick={() => loadTemplates()}
                title="Refresh"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center', opacity: listLoading ? 0.4 : 0.6 }}
              >
                <Icon icon={RotateCcw} size="sm" style={{ color: 'var(--muted)' }} />
              </button>
            </div>

            {/* Template list */}
            {templatesExpanded && (
              <div style={{ marginTop: 4 }}>
                {listLoading ? (
                  <p className="loading">Loading…</p>
                ) : listError ? (
                  <p className="error" style={{ fontSize: 12 }}>{listError}</p>
                ) : templates.length === 0 ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
                    <div style={{ maxWidth: 320, textAlign: 'center' }}>
                      <Layout size={40} strokeWidth={1.5} style={{ color: 'var(--subtle)', marginBottom: 14 }} />
                      <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', margin: 0 }}>
                        No pages yet
                      </p>
                      <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 6, marginBottom: 0 }}>
                        Start building your first page.
                      </p>
                      <button
                        onClick={() => setShowNewModal(true)}
                        className="btn btn-primary btn-sm"
                        style={{ marginTop: 20, width: 'auto' }}
                      >
                        New Page
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {templates.map(t => {
                      const isHovered = hoveredTemplate === t.id && (menuTemplate === null || menuTemplate === t.id);
                      const isMenuOpen = menuTemplate === t.id;
                      return (
                        <div
                          key={t.id}
                          style={{ position: 'relative', zIndex: isMenuOpen ? 10 : undefined }}
                          onMouseEnter={() => { if (menuTemplate === null || menuTemplate === t.id) setHoveredTemplate(t.id); }}
                          onMouseLeave={() => setHoveredTemplate(null)}
                        >
                          <button
                            className={`sidebar-link${selectedTemplate === t.id ? ' sidebar-link--active' : ''}`}
                            style={{
                              border: 'none', cursor: 'pointer', width: '100%',
                              textAlign: 'left', height: 32, flexDirection: 'row',
                              alignItems: 'center', gap: 8, background: 'var(--panel-soft)',
                              paddingTop: 0, paddingBottom: 0, paddingLeft: 10,
                              paddingRight: isHovered || isMenuOpen ? 36 : 10,
                              transition: 'padding-right 0.15s, background 0.2s ease, color 0.2s ease, transform 0.2s ease',
                            }}
                            onClick={() => { if (menuTemplate) return; setSelectedTemplate(t.id); }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                              {t.name}
                            </span>
                            <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 500, padding: '1px 5px', borderRadius: 4, background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)' }}>
                              v{t.version}
                            </span>
                          </button>

                          {/* ⋯ menu button */}
                          <div
                            ref={isMenuOpen ? fileMenuRef : null}
                            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', opacity: isHovered || isMenuOpen ? 1 : 0, pointerEvents: isHovered || isMenuOpen ? 'auto' : 'none', transition: 'opacity 0.15s' }}
                          >
                            <div style={{ position: 'relative' }}>
                              <button
                                className="btn btn-sm"
                                style={{ padding: '3px 5px', border: 'none', lineHeight: 1, display: 'flex', alignItems: 'center' }}
                                title="Options"
                                disabled={deletingTemplate !== null}
                                onClick={e => { e.stopPropagation(); setMenuTemplate(isMenuOpen ? null : t.id); }}
                              >
                                <Icon icon={MoreHorizontal} size="sm" />
                              </button>
                              {isMenuOpen && (
                                <div className="card" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', minWidth: 100, padding: '4px 0', zIndex: 200 }}>
                                  <button
                                    className="btn btn-sm"
                                    style={{ width: '100%', textAlign: 'left', borderRadius: 0, border: 'none', justifyContent: 'flex-start', padding: '8px 12px', color: 'var(--danger)', gap: 8 }}
                                    onClick={() => handleDeleteTemplate(t.id)}
                                  >
                                    {deletingTemplate === t.id
                                      ? <span className="spinner" />
                                      : <><Icon icon={Trash2} size="sm" /><span>Delete</span></>
                                    }
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── New Template Modal ── */}
      {showNewModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 20000,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowNewModal(false); }}
        >
          <div style={{
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            width: '100%',
            maxWidth: 480,
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}>

            {/* Header */}
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0, lineHeight: 1.5, letterSpacing: '0em' }}>
                  New Template
                </p>
                <button
                  onClick={() => setShowNewModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2, display: 'flex', alignItems: 'center', flexShrink: 0 }}
                ><Icon icon={X} size="md" /></button>
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--border)' }} />

            {/* Body */}
            <div style={{ padding: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
                  Template name
                </label>
                <input
                  ref={newInputRef}
                  value={newName}
                  onChange={e => { setNewName(e.target.value.toLowerCase()); setNewError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateNew(); }}
                  placeholder="e.g. sales-brief"
                  style={{
                    width: '100%', padding: '8px 10px',
                    border: `1px solid ${newError || nameValidationError ? 'var(--danger)' : 'var(--border)'}`,
                    borderRadius: 6, background: 'var(--panel-soft)',
                    color: 'var(--text)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {nameValidationError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 0' }}>{nameValidationError}</p>}
                {newError && <p style={{ fontSize: 12, color: 'var(--danger)', margin: '4px 0 0' }}>{newError}</p>}
              </div>
              <button
                onClick={handleCreateNew}
                disabled={newSaving || !newName.trim() || !!nameValidationError}
                style={{
                  width: '100%', padding: '9px 16px', borderRadius: 8, border: 'none',
                  background: newSaving || !newName.trim() || !!nameValidationError ? 'var(--panel-soft)' : 'var(--primary)',
                  color: newSaving || !newName.trim() || !!nameValidationError ? 'var(--muted)' : '#fff',
                  fontSize: 14, fontWeight: 400,
                  cursor: newSaving || !newName.trim() || !!nameValidationError ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
                  lineHeight: 1.5, letterSpacing: '0em',
                }}
              >{newSaving ? 'Creating…' : 'Create'}</button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
