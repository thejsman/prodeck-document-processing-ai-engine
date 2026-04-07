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
  pendingSectionAI: { sectionId: string; instruction: string } | null;
  selectElement: (s: EditSelection) => void;
  selectSection: (sectionId: string) => void;
  clearSelection: () => void;
  updateField: (sectionId: string, fieldPath: string, value: unknown) => void;
  replaceAst: (ast: LayoutAST) => void;
  addArrayItem: (sectionId: string, arrayPath: string, template: unknown) => void;
  removeArrayItem: (sectionId: string, arrayPath: string, index: number) => void;
  moveArrayItem: (sectionId: string, arrayPath: string, from: number, to: number) => void;
  updateSection: (sectionId: string, newContent: unknown) => void;
  addSection: (afterIndex: number, newSection: LayoutAST['sections'][number]) => void;
  removeSection: (sectionId: string) => void;
  undo: () => void;
  redo: () => void;
  triggerSectionAI: (sectionId: string, instruction: string) => void;
  clearSectionAITrigger: () => void;
}

const EditContext = createContext<EditContextValue | null>(null);

export function useEditContext(): EditContextValue | null {
  return useContext(EditContext);
}

// ── Deep-get helper ──────────────────────────────────────────────────────────

function getDeep(obj: unknown, path: string): unknown {
  const dot = path.indexOf('.');
  if (dot === -1) return (obj as Record<string, unknown>)?.[path];
  const key = path.slice(0, dot);
  const rest = path.slice(dot + 1);
  return getDeep((obj as Record<string, unknown>)?.[key], rest);
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
  const [pendingSectionAI, setPendingSectionAI] = useState<{ sectionId: string; instruction: string } | null>(null);

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

  /** Push current AST onto undo stack before a mutation (pure ref mutation — no setState). */
  function snapshotRefs(current: LayoutAST) {
    undoStack.current = [...undoStack.current.slice(-(MAX_HISTORY - 1)), JSON.parse(JSON.stringify(current)) as LayoutAST];
    redoStack.current = [];
  }

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    setAst(current => {
      redoStack.current = [JSON.parse(JSON.stringify(current)) as LayoutAST, ...redoStack.current].slice(0, MAX_HISTORY);
      notify(prev);
      return prev;
    });
    setHistoryVersion(v => v + 1);
  }, [notify]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current[0];
    redoStack.current = redoStack.current.slice(1);
    setAst(current => {
      undoStack.current = [...undoStack.current, JSON.parse(JSON.stringify(current)) as LayoutAST].slice(-MAX_HISTORY);
      notify(next);
      return next;
    });
    setHistoryVersion(v => v + 1);
  }, [notify]);

  const updateField = useCallback(
    (sectionId: string, fieldPath: string, value: unknown) => {
      setAst(prev => {
        snapshotRefs(prev);
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
      setHistoryVersion(v => v + 1);
    },
    [notify],
  );

  const replaceAst = useCallback((newAst: LayoutAST) => {
    setAst(prev => {
      snapshotRefs(prev);
      notify(newAst);
      return newAst;
    });
    setHistoryVersion(v => v + 1);
  }, [notify]);

  const addArrayItem = useCallback(
    (sectionId: string, arrayPath: string, template: unknown) => {
      setAst(prev => {
        snapshotRefs(prev);
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          const content = sec.content as unknown as Record<string, unknown>;
          // Use getDeep to navigate nested paths (e.g. "categories.0.items")
          const arr = (getDeep(content, arrayPath) as unknown[]) ?? [];
          const updated = setDeep(content, arrayPath, [...arr, template]);
          return { ...sec, content: updated as unknown as typeof sec.content };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
      setHistoryVersion(v => v + 1);
    },
    [notify],
  );

  const removeArrayItem = useCallback(
    (sectionId: string, arrayPath: string, index: number) => {
      setAst(prev => {
        snapshotRefs(prev);
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          const content = sec.content as unknown as Record<string, unknown>;
          // Use getDeep to navigate nested paths (e.g. "categories.0.items")
          const arr = [...((getDeep(content, arrayPath) as unknown[]) ?? [])];
          arr.splice(index, 1);
          const updated = setDeep(content, arrayPath, arr);
          return { ...sec, content: updated as unknown as typeof sec.content };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
      setHistoryVersion(v => v + 1);
    },
    [notify],
  );

  const moveArrayItem = useCallback(
    (sectionId: string, arrayPath: string, from: number, to: number) => {
      setAst(prev => {
        snapshotRefs(prev);
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
          // Use getDeep to navigate nested paths
          const arr = [...((getDeep(content, arrayPath) as unknown[]) ?? [])];
          const [item] = arr.splice(from, 1);
          arr.splice(to, 0, item);
          const updated = setDeep(content, arrayPath, arr);
          return { ...sec, content: updated as unknown as typeof sec.content };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
      setHistoryVersion(v => v + 1);
    },
    [notify],
  );

  const updateSection = useCallback(
    (sectionId: string, newContent: unknown) => {
      setAst(prev => {
        snapshotRefs(prev);
        const sections = prev.sections.map(sec =>
          sec.id === sectionId
            ? { ...sec, content: newContent as typeof sec.content }
            : sec,
        ) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
      setHistoryVersion(v => v + 1);
    },
    [notify],
  );

  const addSection = useCallback(
    (afterIndex: number, newSection: LayoutAST['sections'][number]) => {
      setAst(prev => {
        snapshotRefs(prev);
        const sections = [...prev.sections];
        sections.splice(afterIndex + 1, 0, newSection);
        const next: LayoutAST = { ...prev, sections: sections as typeof prev.sections };
        notify(next);
        return next;
      });
      setHistoryVersion(v => v + 1);
    },
    [notify],
  );

  const triggerSectionAI = useCallback((sectionId: string, instruction: string) => {
    setPendingSectionAI({ sectionId, instruction });
  }, []);

  const clearSectionAITrigger = useCallback(() => {
    setPendingSectionAI(null);
  }, []);

  const removeSection = useCallback(
    (sectionId: string) => {
      setAst(prev => {
        snapshotRefs(prev);
        const sections = prev.sections.filter(sec => sec.id !== sectionId) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        notify(next);
        return next;
      });
      setHistoryVersion(v => v + 1);
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
        pendingSectionAI,
        selectElement,
        selectSection,
        clearSelection,
        updateField,
        replaceAst,
        addArrayItem,
        removeArrayItem,
        moveArrayItem,
        updateSection,
        addSection,
        removeSection,
        undo,
        redo,
        triggerSectionAI,
        clearSectionAITrigger,
      }}
    >
      {children}
    </EditContext.Provider>
  );
}
