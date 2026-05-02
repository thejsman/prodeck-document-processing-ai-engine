'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import Placeholder from '@tiptap/extension-placeholder';
import { Callout, PricingTable, Timeline } from './extensions';
import { SlashCommand } from './slash-command';
import { markdownToBlocks } from '@/lib/editor/markdown-to-blocks';
import { blocksToMarkdown } from '@/lib/editor/blocks-to-markdown';
import { blocksToTiptapJson, tiptapJsonToBlocks } from '@/lib/editor/tiptap-markdown';

interface BlockEditorProps {
  content: string;
  onUpdate: (markdown: string) => void;
  editable?: boolean;
  onSave?: () => void;
  onCancel?: () => void;
}

export function BlockEditor({
  content,
  onUpdate,
  editable = true,
  onSave,
  onCancel,
}: BlockEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleUpdate = useCallback(
    ({ editor }: { editor: ReturnType<typeof useEditor> extends infer E ? NonNullable<E> : never }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const blocks = tiptapJsonToBlocks(editor.getJSON());
        const md = blocksToMarkdown(blocks);
        onUpdateRef.current(md);
      }, 300);
    },
    [],
  );

  // Build initial Tiptap JSON from markdown — only on mount, not on every re-render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialDoc = useMemo(() => blocksToTiptapJson(markdownToBlocks(content)), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: "Type '/' for commands...",
      }),
      Callout,
      PricingTable,
      Timeline,
      SlashCommand,
    ],
    content: initialDoc,
    editable,
    immediatelyRender: false,
    onUpdate: handleUpdate,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSave?.();
          return true;
        }
        if (event.key === 'Escape') {
          onCancel?.();
          return true;
        }
        return false;
      },
    },
  });

  // Focus editor on mount
  useEffect(() => {
    if (editor && editable) {
      editor.commands.focus('end');
    }
  }, [editor, editable]);

  // Cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  if (!mounted) {
    return <div className="block-editor" style={{ minHeight: 200 }} />;
  }

  return (
    <div className="block-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
