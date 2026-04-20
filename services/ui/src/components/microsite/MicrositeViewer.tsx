'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';
import { Microsite } from './Microsite';
import { MicrositeEditor } from './editor/MicrositeEditor';
import type { MicrositeHistoryEntry } from '@/lib/useMicrositeHistory';

interface Props {
  entry: MicrositeHistoryEntry;
  onClose: () => void;
  onUpdateEntry?: (updated: MicrositeHistoryEntry) => void;
}

export function MicrositeViewer({ entry, onClose, onUpdateEntry }: Props) {
  const [showEditor, setShowEditor] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [currentEntry, setCurrentEntry] = useState(entry);

  const title = currentEntry.ast.meta.client || currentEntry.ast.brand?.companyName || 'Microsite';
  const namespace = currentEntry.namespace;

  if (showPreview) {
    return (
      <Microsite
        ast={currentEntry.ast}
        onBack={() => setShowPreview(false)}
        mode="fullscreen"
      />
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
      <div style={{ height: 48, flexShrink: 0, display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingLeft: 16, paddingRight: 8 }}>
        <span className="topbar-ns-label" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {!showEditor && (
            <button className="chat-v2-action-btn" onClick={() => setShowEditor(true)}>Edit</button>
          )}
          {!showEditor && (
            <button className="chat-v2-action-btn" onClick={() => setShowPreview(true)}>Preview</button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '4px 8px', display: 'flex', alignItems: 'center' }}
            aria-label="Close microsite viewer"
          >
            <Icon icon={X} size="md" />
          </button>
        </div>
      </div>

      <div id="ms-embedded-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {showEditor ? (
          <MicrositeEditor
            ast={currentEntry.ast}
            namespace={namespace}
            proposalId={currentEntry.ast.proposalId || currentEntry.id}
            onClose={() => setShowEditor(false)}
            onExport={(editedAst) => {
              const updated = { ...currentEntry, ast: editedAst };
              setCurrentEntry(updated);
              onUpdateEntry?.(updated);
              setShowEditor(false);
            }}
          />
        ) : (
          <Microsite
            ast={currentEntry.ast}
            onEdit={() => setShowEditor(true)}
            mode="embedded"
          />
        )}
      </div>
    </div>
  );
}
