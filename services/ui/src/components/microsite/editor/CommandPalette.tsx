'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

interface Props {
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? commands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        (c.description ?? '').toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  // Reset active index when filter changes
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Auto-focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const run = useCallback(
    (cmd: PaletteCommand) => {
      onClose();
      cmd.action();
    },
    [onClose],
  );

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIdx];
      if (cmd) run(cmd);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        background: 'rgba(15,23,42,0.5)',
        backdropFilter: 'blur(4px)',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 'min(560px, calc(100vw - 32px))',
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', gap: 10 }}>
          <span style={{ fontSize: 16, color: '#94a3b8', flexShrink: 0 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: 15, color: '#1e293b',
              background: 'transparent', fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13, padding: 2 }}
            >✕</button>
          )}
          <kbd style={{
            padding: '2px 6px', borderRadius: 5, border: '1px solid #e2e8f0',
            background: '#f8fafc', color: '#94a3b8', fontSize: 10, fontWeight: 600, flexShrink: 0,
          }}>Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 380, overflowY: 'auto', padding: '6px 0' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              No commands match "{query}"
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => run(cmd)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 14px',
                  cursor: 'pointer',
                  background: i === activeIdx ? '#f5f3ff' : 'transparent',
                  transition: 'background 0.08s',
                }}
              >
                <span
                  style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: i === activeIdx ? '#ede9fe' : '#f1f5f9',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, transition: 'background 0.08s',
                  }}
                >{cmd.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{cmd.label}</div>
                  {cmd.description && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{cmd.description}</div>
                  )}
                </div>
                {cmd.shortcut && (
                  <kbd style={{
                    padding: '2px 7px', borderRadius: 5, border: '1px solid #e2e8f0',
                    background: '#f8fafc', color: '#64748b', fontSize: 10,
                    fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
                  }}>{cmd.shortcut}</kbd>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', gap: 16, padding: '8px 14px',
          borderTop: '1px solid #f1f5f9', background: '#f8fafc',
        }}>
          {[['↑↓', 'Navigate'], ['↵', 'Run'], ['Esc', 'Close']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <kbd style={{
                padding: '1px 6px', borderRadius: 4, border: '1px solid #e2e8f0',
                background: '#fff', fontSize: 10, color: '#64748b', fontWeight: 600,
              }}>{key}</kbd>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
