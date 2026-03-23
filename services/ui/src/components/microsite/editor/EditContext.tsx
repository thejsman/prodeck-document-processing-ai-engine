'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { LayoutAST } from '../../../types/presentation';

// ── Selection model ──────────────────────────────────────────────────────────

export interface EditSelection {
  sectionId: string;
  fieldPath: string;        // dot-separated path in content, e.g. "eyebrow", "pillars.0.name"
  elementType: 'text' | 'button' | 'image' | 'icon';
  label: string;            // human-readable label for the edit panel
}

// ── Context shape ─────────────────────────────────────────────────────────────

export interface EditContextValue {
  isEditing: true;
  ast: LayoutAST;
  /** Currently selected element (null = only a section is focused) */
  selection: EditSelection | null;
  /** Currently focused section id (may differ from selection.sectionId when panel-driven) */
  activeSectionId: string | null;
  selectElement: (s: EditSelection) => void;
  selectSection: (sectionId: string) => void;
  clearSelection: () => void;
  updateField: (sectionId: string, fieldPath: string, value: unknown) => void;
  /** Replace the entire AST (e.g. after a design-editor-agent apply) */
  replaceAst: (ast: LayoutAST) => void;
  /** Add an item to an array field in a section's content */
  addArrayItem: (sectionId: string, arrayPath: string, template: unknown) => void;
  /** Remove an item from an array field by index */
  removeArrayItem: (sectionId: string, arrayPath: string, index: number) => void;
  /** Move an array item (drag-reorder) */
  moveArrayItem: (sectionId: string, arrayPath: string, from: number, to: number) => void;
  /** Replace the entire content of a section (e.g. after AI rewrite) */
  updateSection: (sectionId: string, newContent: unknown) => void;
}

const EditContext = createContext<EditContextValue | null>(null);

/** Returns null outside of an EditProvider — use this in section components so they work both inside and outside the editor. */
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
  // Handle array indices
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

  const updateField = useCallback(
    (sectionId: string, fieldPath: string, value: unknown) => {
      setAst(prev => {
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          if (fieldPath === '__imageUrl') {
            return { ...sec, image: { ...sec.image, url: value as string | null } };
          }
          if (fieldPath === '__imageQuery') {
            return { ...sec, image: { ...sec.image, query: value as string } };
          }
          if (fieldPath === '__imageSource') {
            return { ...sec, image: { ...sec.image, source: value as string } };
          }
          if (fieldPath === '__bgColor') {
            return { ...sec, bgColor: value as string };
          }
          if (fieldPath === '__heading') {
            return { ...sec, heading: value as string };
          }
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
    setAst(newAst);
    notify(newAst);
  }, [notify]);

  const addArrayItem = useCallback(
    (sectionId: string, arrayPath: string, template: unknown) => {
      setAst(prev => {
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
        // Special case: reorder top-level sections
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

  return (
    <EditContext.Provider
      value={{
        isEditing: true,
        ast,
        selection,
        activeSectionId,
        selectElement,
        selectSection,
        clearSelection,
        updateField,
        replaceAst,
        addArrayItem,
        removeArrayItem,
        moveArrayItem,
        updateSection,
      }}
    >
      {children}
    </EditContext.Provider>
  );
}
