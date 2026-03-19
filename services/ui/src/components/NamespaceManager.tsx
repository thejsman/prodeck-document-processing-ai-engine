'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useNamespace } from '@/lib/namespace-context';
import { createNamespace } from '@/lib/api';

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function NamespaceManager() {
  const { apiKey } = useAuth();
  const { namespaces, isLoading, error: nsError, refresh } = useNamespace();

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const validationError = newName.trim()
    ? NAME_PATTERN.test(newName.trim())
      ? ''
      : 'Use lowercase letters, numbers, and dashes only (e.g. "acme-corp")'
    : '';

  const canCreate = newName.trim() && !validationError && !creating;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey || !canCreate) return;

    setCreating(true);
    setError('');
    setSuccess('');

    try {
      const name = await createNamespace(apiKey, newName.trim());
      setSuccess(`Namespace "${name}" created`);
      setNewName('');
      refresh();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="ns-manager">
      {/* Create form */}
      <div className="card">
        <h2>Create Namespace</h2>
        <form onSubmit={handleCreate} className="ns-manager-form">
          <div className="ns-manager-input-row">
            <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
              <input
                className="input"
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value.toLowerCase());
                  setError('');
                }}
                placeholder="e.g. acme-corp"
                disabled={creating}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canCreate}
              style={{ width: 'auto' }}
            >
              {creating ? <><span className="spinner" /> Creating…</> : 'Create'}
            </button>
          </div>
          {validationError && <p className="error">{validationError}</p>}
          {error && <p className="error">{error}</p>}
          {success && <p className="ns-manager-success">{success}</p>}
        </form>
      </div>

      {/* Namespace list */}
      <div className="card">
        <h2>Namespaces {!isLoading && <span className="badge">{namespaces.length}</span>}</h2>
        {isLoading ? (
          <p className="loading">Loading namespaces…</p>
        ) : nsError ? (
          <p className="error">{nsError}</p>
        ) : namespaces.length === 0 ? (
          <div className="placeholder" style={{ minHeight: 120 }}>
            <p className="muted">No namespaces yet. Create one above.</p>
          </div>
        ) : (
          <ul className="ns-list">
            {namespaces.map((ns) => (
              <li key={ns} className="ns-list-item">
                <span className="ns-list-name">{ns}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
