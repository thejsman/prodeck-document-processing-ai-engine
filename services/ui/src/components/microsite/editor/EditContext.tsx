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

  const updateField = useCallback(
    (sectionId: string, fieldPath: string, value: unknown) => {
      setAst(prev => {
        const sections = prev.sections.map(sec => {
          if (sec.id !== sectionId) return sec;
          // Special key: update image.url (not inside content)
          if (fieldPath === '__imageUrl') {
            return { ...sec, image: { ...sec.image, url: value as string | null } };
          }
          return {
            ...sec,
            content: setDeep(sec.content as unknown as Record<string, unknown>, fieldPath, value) as unknown as typeof sec.content,
          };
        }) as typeof prev.sections;
        const next: LayoutAST = { ...prev, sections };
        // Use setTimeout to call onChange outside of the React render cycle
        // This avoids the "Cannot update a component while rendering a different component" warning
        if (onChange) setTimeout(() => onChange(next), 0);
        return next;
      });
    },
    [onChange],
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
      }}
    >
      {children}
    </EditContext.Provider>
  );
}
