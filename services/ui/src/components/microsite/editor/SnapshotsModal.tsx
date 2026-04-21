'use client';

import { useState, useEffect } from 'react';
import type { LayoutAST } from '../../../types/presentation';

interface Snapshot {
  id: string;
  name: string;
  timestamp: number;
  sectionCount: number;
  ast: string;
}

function getKey(namespace: string, proposalId: string) {
  return `ms-snapshots-${namespace}-${proposalId}`;
}

function loadSnapshots(namespace: string, proposalId: string): Snapshot[] {
  try {
    const raw = localStorage.getItem(getKey(namespace, proposalId));
    return raw ? (JSON.parse(raw) as Snapshot[]) : [];
  } catch {
    return [];
  }
}

function saveSnapshots(namespace: string, proposalId: string, snapshots: Snapshot[]) {
  localStorage.setItem(getKey(namespace, proposalId), JSON.stringify(snapshots.slice(-20)));
}

interface Props {
  ast: LayoutAST;
  namespace: string;
  proposalId: string;
  onRestore: (ast: LayoutAST) => void;
  onClose: () => void;
}

export function SnapshotsModal({ ast, namespace, proposalId, onRestore, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [newName, setNewName] = useState('');
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    setSnapshots(loadSnapshots(namespace, proposalId));
  }, [namespace, proposalId]);

  function handleSave() {
    const name = newName.trim() || `Snapshot ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const snapshot: Snapshot = {
      id: `snap-${Date.now()}`,
      name,
      timestamp: Date.now(),
      sectionCount: ast.sections.length,
      ast: JSON.stringify(ast),
    };
    const next = [...snapshots, snapshot];
    setSnapshots(next);
    saveSnapshots(namespace, proposalId, next);
    setNewName('');
  }

  function handleRestore(snap: Snapshot) {
    try {
      const restored = JSON.parse(snap.ast) as LayoutAST;
      onRestore(restored);
      onClose();
    } catch {
      // corrupt snapshot — ignore
    }
  }

  function handleDelete(id: string) {
    const next = snapshots.filter(s => s.id !== id);
    setSnapshots(next);
    saveSnapshots(namespace, proposalId, next);
    if (confirmRestore === id) setConfirmRestore(null);
  }

  function formatTime(ts: number) {
    const d = new Date(ts);
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 480,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#1e293b' }}>💾 Snapshots</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#94a3b8' }}>Save named checkpoints and restore anytime</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 18, padding: 4, lineHeight: 1 }}>✕</button>
        </div>

        {/* Save new snapshot */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 8 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            placeholder={`Snapshot name (e.g. "Before client call")`}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 7,
              border: '1px solid #e2e8f0', fontSize: 12, outline: 'none',
              color: '#1e293b',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = '#6366f1')}
            onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
          />
          <button
            onClick={handleSave}
            style={{
              padding: '8px 16px', borderRadius: 7, border: 'none',
              background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >Save now</button>
        </div>

        {/* Snapshot list */}
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {snapshots.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
              No snapshots yet. Save one above to get started.
            </div>
          ) : (
            [...snapshots].reverse().map(snap => (
              <div
                key={snap.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 20px', borderBottom: '1px solid #f1f5f9',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>{snap.name}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                    {formatTime(snap.timestamp)} · {snap.sectionCount} sections
                  </div>
                </div>

                {confirmRestore === snap.id ? (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => handleRestore(snap)}
                      style={{ padding: '5px 10px', borderRadius: 5, border: 'none', background: '#6366f1', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    >Restore</button>
                    <button
                      onClick={() => setConfirmRestore(null)}
                      style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 11, cursor: 'pointer' }}
                    >Cancel</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={() => setConfirmRestore(snap.id)}
                      style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                    >Restore</button>
                    <button
                      onClick={() => handleDelete(snap.id)}
                      style={{ padding: '5px 8px', borderRadius: 5, border: 'none', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer' }}
                      title="Delete snapshot"
                    >✕</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div style={{ padding: '10px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
          <p style={{ margin: 0, fontSize: 10, color: '#94a3b8' }}>
            Stored locally in browser · Up to 20 snapshots · Restoring replaces current content
          </p>
        </div>
      </div>
    </div>
  );
}
