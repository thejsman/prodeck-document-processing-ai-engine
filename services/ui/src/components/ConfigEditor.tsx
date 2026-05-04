'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { fetchNamespaceConfig, saveNamespaceConfig } from '@/lib/api';

const SUPPORTED_FIELDS = ['defaultTemplate', 'tone', 'chunkStrategy', 'pricingDefaults', 'llm', 'temperature'];

interface Props {
  /** Hide the namespace selector (for modal use where namespace is already in context) */
  hideSelector?: boolean;
}

export function ConfigEditor({ hideSelector = false }: Props) {
  const { apiKey } = useAuth();
  const { namespace, namespaces, isLoading: nsLoading } = useNamespace();

  const [selectedNs, setSelectedNs] = useState(namespace ?? '');
  const [editorValue, setEditorValue] = useState('');
  const [savedValue, setSavedValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [parseError, setParseError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (namespace) setSelectedNs(namespace);
  }, [namespace]);

  const loadConfig = useCallback(async (ns: string) => {
    if (!apiKey || !ns) return;
    setLoading(true);
    setError('');
    setParseError('');
    setSuccess('');
    try {
      const data = await fetchNamespaceConfig(apiKey, ns);
      const json = JSON.stringify(data, null, 2);
      setEditorValue(json);
      setSavedValue(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (selectedNs) loadConfig(selectedNs);
  }, [selectedNs, loadConfig]);

  useEffect(() => {
    if (!editorValue.trim()) { setParseError(''); return; }
    try {
      JSON.parse(editorValue);
      setParseError('');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  }, [editorValue]);

  const handleSave = async () => {
    if (!apiKey || !selectedNs) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editorValue);
    } catch {
      setParseError('Cannot save — JSON is invalid');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('Config must be a JSON object, not an array or primitive');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await saveNamespaceConfig(apiKey, selectedNs, parsed);
      const json = JSON.stringify(result, null, 2);
      setEditorValue(json);
      setSavedValue(json);
      setSuccess('Configuration saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleFormat = () => {
    try {
      setEditorValue(JSON.stringify(JSON.parse(editorValue), null, 2));
      setParseError('');
    } catch { /* parseError already set */ }
  };

  const handleReset = () => {
    setEditorValue(savedValue);
    setParseError('');
    setError('');
    setSuccess('');
  };

  const isDirty = editorValue !== savedValue;
  const canSave = isDirty && !parseError && !saving && !!selectedNs;

  if (nsLoading) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading namespaces…</p>;
  }

  if (!namespaces.length) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>
        No namespaces found. Ingest documents to create one.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Namespace selector — hidden in modal context */}
      {!hideSelector && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label htmlFor="config-ns" style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            Project
          </label>
          <select
            id="config-ns"
            className="select"
            value={selectedNs}
            onChange={(e) => setSelectedNs(e.target.value)}
            style={{ flex: 1, maxWidth: 280 }}
          >
            <option value="">Select namespace…</option>
            {namespaces.map((ns) => (
              <option key={ns} value={ns}>{ns}</option>
            ))}
          </select>
        </div>
      )}

      {/* Loading / no-namespace placeholder */}
      {!selectedNs ? (
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
          Select a namespace to edit its configuration.
        </p>
      ) : loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>Loading…</p>
      ) : (
        <>
          {/* Status strip */}
          {(parseError || error || success || isDirty) && (
            <div style={{ fontSize: 12, minHeight: 18 }}>
              {parseError && <span style={{ color: 'var(--danger)' }}>{parseError}</span>}
              {!parseError && error && <span style={{ color: 'var(--danger)' }}>{error}</span>}
              {!parseError && !error && success && <span style={{ color: 'var(--success)' }}>{success}</span>}
              {!parseError && !error && !success && isDirty && (
                <span style={{ color: 'var(--warning)' }}>Unsaved changes</span>
              )}
            </div>
          )}

          {/* Code editor textarea */}
          <textarea
            value={editorValue}
            onChange={(e) => setEditorValue(e.target.value)}
            spellCheck={false}
            placeholder="{}"
            style={{
              width: '100%',
              minHeight: 240,
              background: 'var(--bg)',
              border: `1px solid ${parseError ? 'var(--danger)' : 'var(--border)'}`,
              borderRadius: 8,
              color: 'var(--text)',
              fontFamily: '"SF Mono", "Fira Code", ui-monospace, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.65,
              padding: '14px 16px',
              resize: 'vertical',
              outline: 'none',
              transition: 'border-color 0.15s',
              boxSizing: 'border-box',
            }}
            onFocus={e => { if (!parseError) e.currentTarget.style.borderColor = 'var(--primary)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = parseError ? 'var(--danger)' : 'var(--border)'; }}
          />

          {/* Supported fields hint */}
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
            Supported fields:{' '}
            {SUPPORTED_FIELDS.map((f, i) => (
              <span key={f}>
                <code style={{
                  fontFamily: '"SF Mono", "Fira Code", ui-monospace, monospace',
                  fontSize: 12,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background: 'var(--panel-soft)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                }}>
                  {f}
                </code>
                {i < SUPPORTED_FIELDS.length - 1 ? ', ' : ''}
              </span>
            ))}
          </p>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={handleFormat}
              disabled={!!parseError || !editorValue.trim()}
            >
              Format
            </button>
            <button
              className="btn btn-sm"
              onClick={handleReset}
              disabled={!isDirty}
            >
              Reset
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={handleSave}
              disabled={!canSave}
              style={{ marginLeft: 'auto', width: 'auto', minWidth: 72 }}
            >
              {saving ? <><span className="spinner" /> Saving…</> : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
