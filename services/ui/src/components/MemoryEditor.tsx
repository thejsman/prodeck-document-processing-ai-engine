'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { fetchMemory, saveMemory } from '@/lib/api';

export function MemoryEditor() {
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

  // Sync selected namespace with global namespace
  useEffect(() => {
    if (namespace) setSelectedNs(namespace);
  }, [namespace]);

  const loadMemory = useCallback(async (ns: string) => {
    if (!apiKey || !ns) return;
    setLoading(true);
    setError('');
    setParseError('');
    setSuccess('');
    try {
      const data = await fetchMemory(apiKey, ns);
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
    if (selectedNs) {
      loadMemory(selectedNs);
    }
  }, [selectedNs, loadMemory]);

  // Validate JSON on each keystroke
  useEffect(() => {
    if (!editorValue.trim()) {
      setParseError('');
      return;
    }
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
      setParseError('Memory must be a JSON object, not an array or primitive');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await saveMemory(apiKey, selectedNs, parsed);
      const json = JSON.stringify(result, null, 2);
      setEditorValue(json);
      setSavedValue(json);
      setSuccess('Memory saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(editorValue);
      setEditorValue(JSON.stringify(parsed, null, 2));
      setParseError('');
    } catch {
      // parseError already set by the effect
    }
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
    return (
      <div className="card">
        <p className="loading">Loading namespaces…</p>
      </div>
    );
  }

  if (!namespaces.length) {
    return (
      <div className="card">
        <div className="placeholder">
          <p className="muted">No namespaces found. Ingest documents to create one.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="memory-editor">
      <div className="card">
        <div className="memory-editor-toolbar">
          <div className="form-group" style={{ marginBottom: 0, flex: 1, maxWidth: 280 }}>
            <label htmlFor="memory-ns">Project</label>
            <select
              id="memory-ns"
              className="select"
              value={selectedNs}
              onChange={(e) => setSelectedNs(e.target.value)}
            >
              <option value="">Select namespace…</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>{ns}</option>
              ))}
            </select>
          </div>

          <div className="memory-editor-actions">
            <button
              className="btn btn-sm"
              onClick={handleFormat}
              disabled={!!parseError || !editorValue.trim()}
              title="Format JSON"
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
              style={{ width: 'auto' }}
            >
              {saving ? <><span className="spinner" /> Saving…</> : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {!selectedNs ? (
        <div className="card">
          <div className="placeholder">
            <p className="muted">Select a namespace to edit its memory</p>
          </div>
        </div>
      ) : loading ? (
        <div className="card">
          <p className="loading">Loading memory…</p>
        </div>
      ) : (
        <div className="card memory-editor-card">
          <div className="memory-editor-status-bar">
            {parseError && <span className="memory-editor-parse-error">{parseError}</span>}
            {!parseError && isDirty && <span className="memory-editor-dirty">Unsaved changes</span>}
            {!parseError && !isDirty && !success && <span className="muted">No changes</span>}
            {success && <span className="memory-editor-success">{success}</span>}
            {error && <span className="memory-editor-error">{error}</span>}
          </div>
          <textarea
            className={`memory-editor-textarea ${parseError ? 'memory-editor-textarea--error' : ''}`}
            value={editorValue}
            onChange={(e) => setEditorValue(e.target.value)}
            spellCheck={false}
            placeholder='{ }'
          />
          <div className="memory-editor-hint">
            <p className="muted">
              Supported fields: <code>preferredTone</code>, <code>clientProfile</code>,{' '}
              <code>pastLessons</code>, <code>avoidPhrases</code>, <code>episodic</code>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
