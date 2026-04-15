"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useSectionId } from "./SectionIdContext";
import { useEditContext } from "./EditContext";
import { DiagramModal } from "./SectionEditOverlay";
import { ThemedMermaid } from "../shared/ThemedMermaid";
import type { PluginTokens } from "../../../types/presentation";

interface Props {
  diagram: string;
  tokens: PluginTokens;
  delay?: number;
  caption?: string;
  typeId?: string;
  wrapperStyle?: React.CSSProperties;
}

/**
 * ClickableDiagram — renders ThemedMermaid with an edit overlay during inline editing.
 * Hovering shows "Edit Diagram" (opens DiagramModal with code editor + live preview)
 * and "Remove" (strips diagram, keeps section).
 * Outside edit mode renders identically to Them
 * edMermaid.
 */
export function ClickableDiagram({
  diagram,
  tokens,
  delay,
  caption,
  typeId,
  wrapperStyle,
}: Props) {
  const sectionId = useSectionId();
  const ctx = useEditContext();
  const [hovered, setHovered] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Not in editor
  if (!ctx || !sectionId) {
    if (!diagram) return null;
    return (
      <ThemedMermaid
        diagram={diagram}
        tokens={tokens}
        delay={delay}
        caption={caption}
        typeId={typeId}
      />
    );
  }

  if (!diagram) return null;

  const section = ctx.ast.sections.find((s) => s.id === sectionId);
  if (!section) return null;

  return (
    <>
      <div
        style={{ position: "relative", ...wrapperStyle }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <ThemedMermaid
          diagram={diagram}
          tokens={tokens}
          delay={delay}
          caption={caption}
          typeId={typeId}
        />

        {hovered && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "rgba(0,0,0,0.42)",
              backdropFilter: "blur(3px)",
              zIndex: 10,
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowModal(true);
              }}
              style={{
                padding: "9px 20px",
                borderRadius: 100,
                border: "none",
                background: "#6366f1",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "system-ui, -apple-system, sans-serif",
                boxShadow: "0 2px 14px rgba(99,102,241,0.45)",
              }}
            >
              ✏ Edit Diagram
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                ctx.updateField(sectionId, "diagram", "");
              }}
              style={{
                padding: "9px 16px",
                borderRadius: 100,
                border: "none",
                background: "rgba(254,226,226,0.95)",
                color: "#dc2626",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "system-ui, -apple-system, sans-serif",
              }}
            >
              ✕ Remove
            </button>
          </div>
        )}
      </div>

      {showModal && createPortal(
        <DiagramModal
          section={section}
          diagram={diagram}
          onClose={() => setShowModal(false)}
        />,
        document.body,
      )}
    </>
  );
}
