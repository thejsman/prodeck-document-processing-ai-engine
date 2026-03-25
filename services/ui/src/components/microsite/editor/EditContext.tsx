'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { LayoutAST } from '../../../types/presentation';

// ── Selection model ──────────────────────────────────────────────────────────

export interface EditSelection {
  sectionId: string;
  fieldPath: string;
  elementType: 'text' | 'button' | 'image' | 'icon';
  label: string;
}

// ── Context shape ─────────────────────────────────────────────────────────────

export interface EditContextValue {
  isEditing: true;
  ast: LayoutAST;
  selection: EditSelection | null;
  activeSectionId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  selectElement: (s: EditSelection) => void;
  selectSection: (sectionId: string) => void;
  clearSelection: () => void;
  updateField: (sectionId: string, fieldPath: string, value: unknown) => void;
  replaceAst: (ast: LayoutAST) => void;
  addArrayItem: (sectionId: string, arrayPath: string, template: unknown) => void;
  removeArrayItem: (sectionId: string, arrayPath: string, index: number) => void;
  moveArrayItem: (sectionId: string, arrayPath: string, from: number, to: number) => void;
  updateSection: (sectionId: string, newContent: unknown) => void;
  undo: () => void;
  redo: () => void;
}

const EditContext = createContext<EditContextValue | null>(null);

export function useEditContext(): EditContextValue | null {
  return useContext(EditContext);
}

// ── Deep-set helper ───────────────────────────────────────────────────────────

function setDeep(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const dot = path.indexOf('.');
  if (dot === -1) return { ...obj, [path]: value };
  const key = path.slice(0, dot);
  const rest = path.slice(dot + 1);
  const child = (obj[key] ?? {}) as Record<string, unknown>;
  if (/^\d+$/.test(rest.split('.')[0])) {
    const arr = Array.isArray(child) ? [...child] : [];
    const idxStr = rest.split('.')[0];
    const idx = parseInt(idxStr);
    const afterIdx = rest.slice(idxStr.length + 1);
    if (afterIdx) {
      arr[idx] = setDeep(arr[idx] as Record<string, unknown>, afterIdx, value);
    } else {
      arr[idx] = value;
    }
    return { ...obj, [key]: arr };
  }
  return { ...obj, [key]: setDeep(child, rest, value) };
}

// ── History stack limit ───────────────────────────────────────────────────────

const MAX_HISTORY = 50;

// ── Provider ─────────────────────────────────────────────────────────────────

interface ProviderProps {
  initialAst: LayoutAST;
  children: ReactNode;
  onChange?: (ast: LayoutAST) => void;
}

export function EditProvider({ initialAst, children, onChange }: ProviderProps) {
  const [ast, setAst] = useState<LayoutAST>(() => JSON.parse(JSON.stringify(initialAst)) as LayoutAST);
  const [selection, setSelection] = useState<EditSelection | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(
    initialAst.sections?.[0]?.id ?? null,
  );

  // Undo / redo stacks (hold snapshots before each mutation)
  const undoStack = useRef<LayoutAST[]>([]);
  const redoStack = useRef<LayoutAST[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0); // triggers re-render for canUndo/canRedo

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  const selectElement = useCallback((s: EditSelection) => {
    setSelection(s);
    setActiveSectionId(s.sectionId);
  }, []);

  const selectSection = useCallback((sectionId: string) => {
    setActiveSectionId(sectionId);
    setSelection(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const notify = useCallback((next: LayoutAST) => {
    if (onChange) setTimeout(() => onChange(next), 0);
  }, [onChange]);

  /** Push current AST onto undo stack before a mutation */
  function snapshot(current: LayoutAST) {
    undoStack.current = [...undoStack.current.slice(-(MAX_HISTORY - 1)), JSON.parse(JSON.stringify(current)) as LayoutAST];
    redoStack.current = []; // new action clears redo
    setHistoryVersion(v => v + 1);
  }

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    setAst(current => {
      const prev = undoStack.current[undoStack.current.length - 1];
      undoStack.current = undoStack.current.slice(0, -1);
      redoStack.current = [JSON.parse(JSON.stringify(current)) as LayoutAST, ...redoStack.current].slice(0, MAX_HISTORY);
      setHistoryVersion(v => v + 1);
      notify(prev);
      return prev;
    });
  }, [notify]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    setAst(current => {
      const next = redoStack.current[0];
      redoStack.current = redoStack.current.slice(1);
      undoStack.current = [...undoStack.current, JSON.parse(JSON.stringify(current)) as LayoutAST].slice(-MAX_HISTORY);
      setHistoryVersion(v => v + 1);
      notify(next);
      return next;
    });
  }, [notify]);

  const updateField = useCallback(
    (sectionId: string, fieldPath: string, value: unknown) => {
      setAst(prev => {
        snapshot(prev);
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          if (fieldPath === '__imageUrl') return { ...sec, image: { ...sec.image, url: value as string | null } };
          if (fieldPath === '__imageQuery') return { ...sec, image: { ...sec.image, query: value as string } };
          if (fieldPath === '__imageSource') return { ...sec, image: { ...sec.image, source: value as string } };
          if (fieldPath === '__bgColor') return { ...sec, bgColor: value as string };
          if (fieldPath === '__heading') return { ...sec, heading: value as string };
          return {
            ...sec,
            content: setDeep(sec.content as unknown as Record<string, unknown>, fieldPath, value) as unknown as typeof sec.content,
          };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
    },
    [notify],
  );

  const replaceAst = useCallback((newAst: LayoutAST) => {
    setAst(prev => {
      snapshot(prev);
      notify(newAst);
      return newAst;
    });
  }, [notify]);

  const addArrayItem = useCallback(
    (sectionId: string, arrayPath: string, template: unknown) => {
      setAst(prev => {
        snapshot(prev);
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          const content = sec.content as unknown as Record<string, unknown>;
          const arr = (content[arrayPath] as unknown[]) ?? [];
          const updated = setDeep(content, arrayPath, [...arr, template]);
          return { ...sec, content: updated as unknown as typeof sec.content };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
    },
    [notify],
  );

  const removeArrayItem = useCallback(
    (sectionId: string, arrayPath: string, index: number) => {
      setAst(prev => {
        snapshot(prev);
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          const content = sec.content as unknown as Record<string, unknown>;
          const arr = [...((content[arrayPath] as unknown[]) ?? [])];
          arr.splice(index, 1);
          const updated = setDeep(content, arrayPath, arr);
          return { ...sec, content: updated as unknown as typeof sec.content };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
    },
    [notify],
  );

  const moveArrayItem = useCallback(
    (sectionId: string, arrayPath: string, from: number, to: number) => {
      setAst(prev => {
        snapshot(prev);
        if (sectionId === '__sections__' && arrayPath === '__sections__') {
          const arr = [...prev.sections];
          const [item] = arr.splice(from, 1);
          arr.splice(to, 0, item);
          const next: LayoutAST = { ...prev, sections: arr as typeof prev.sections };
          notify(next);
          return next;
        }
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          const content = sec.content as unknown as Record<string, unknown>;
          const arr = [...((content[arrayPath] as unknown[]) ?? [])];
          const [item] = arr.splice(from, 1);
          arr.splice(to, 0, item);
          const updated = setDeep(content, arrayPath, arr);
          return { ...sec, content: updated as unknown as typeof sec.content };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
    },
    [notify],
  );

  const updateSection = useCallback(
    (sectionId: string, newContent: unknown) => {
      setAst(prev => {
        snapshot(prev);
        const sections = prev.sections.map(sec =>
          sec.id === sectionId
            ? { ...sec, content: newContent as typeof sec.content }
            : sec,
        ) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
    },
    [notify],
  );

  // Suppress unused warning — historyVersion only drives canUndo/canRedo re-render
  void historyVersion;

  return (
    <EditContext.Provider
      value={{
        isEditing: true,
        ast,
        selection,
        activeSectionId,
        canUndo,
        canRedo,
        selectElement,
        selectSection,
        clearSelection,
        updateField,
        replaceAst,
        addArrayItem,
        removeArrayItem,
        moveArrayItem,
        updateSection,
        undo,
        redo,
      }}
    >
      {children}
    </EditContext.Provider>
  );
}
