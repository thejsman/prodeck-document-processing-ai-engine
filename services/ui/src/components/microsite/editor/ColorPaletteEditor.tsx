"use client";

import { useState, useEffect, useRef } from "react";
import { useEditContext } from "./EditContext";
import type { LayoutAST } from "../../../types/presentation";

const ACCENT = "var(--primary)";

interface ColorToken {
  key: keyof import("../../../types/presentation").PluginTokens;
  label: string;
  description: string;
}

const EDITABLE_TOKENS: ColorToken[] = [
  { key: "accent", label: "Accent", description: "Buttons, links, highlights" },
  { key: "bg", label: "Background", description: "Page background" },
  { key: "surface", label: "Surface", description: "Cards & panels" },
  { key: "text", label: "Text", description: "Primary text color" },
];

const ACCENT_PRESETS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#ffffff",
  "#0f172a",
];

interface Props {
  tokens: import("../../../types/presentation").PluginTokens;
  onClose: () => void;
}

export function ColorPaletteEditor({ tokens, onClose }: Props) {
  const ctx = useEditContext();

  const effectiveAccent = (ctx?.ast.customTokens?.accent ??
    tokens.accent) as string;
  const effectiveBg = (ctx?.ast.customTokens?.bg ?? tokens.bg) as string;
  const effectiveSurface = (ctx?.ast.customTokens?.surface ??
    tokens.surface) as string;
  const effectiveText = (ctx?.ast.customTokens?.text ?? tokens.text) as string;

  const panelRef = useRef<HTMLDivElement>(null);
  const [localTokens, setLocalTokens] = useState<Record<string, string>>({
    accent: effectiveAccent,
    bg: effectiveBg,
    surface: effectiveSurface,
    text: effectiveText,
  });

  // Sync localTokens whenever the resolved tokens change (e.g. on editor first-open
  // when extractedCssVariables are applied, or after theme/plugin switch).
  useEffect(() => {
    setLocalTokens({
      accent: (ctx?.ast.customTokens?.accent ?? tokens.accent) as string,
      bg: (ctx?.ast.customTokens?.bg ?? tokens.bg) as string,
      surface: (ctx?.ast.customTokens?.surface ?? tokens.surface) as string,
      text: (ctx?.ast.customTokens?.text ?? tokens.text) as string,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tokens.accent,
    tokens.bg,
    tokens.surface,
    tokens.text,
    ctx?.ast.customTokens,
  ]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  if (!ctx) return null;

  // CSS variable keys that correspond to each editable token.
  // When a microsite is created from a URL, brand.extractedCssVariables
  // override customTokens in Microsite.tsx. Clearing the relevant CSS vars
  // here ensures the user's explicit color choice takes effect.
  const CSS_VAR_KEYS_FOR_TOKEN: Record<string, string[]> = {
    accent:  ['--ms-accent', '--ms-hero-accent', '--ms-accent2'],
    bg:      ['--ms-bg'],
    surface: ['--ms-bg2', '--ms-bg3', '--ms-surface'],
    text:    ['--ms-text', '--ms-text2', '--ms-text3'],
  };

  function handleChange(key: string, value: string) {
    const next = { ...localTokens, [key]: value };
    setLocalTokens(next);

    // Strip the CSS vars that correspond to this token so they no longer
    // override the user's new customTokens value.
    let updatedCssVars = { ...(ctx!.ast.brand?.extractedCssVariables ?? {}) };
    const keysToRemove = CSS_VAR_KEYS_FOR_TOKEN[key] ?? [];
    for (const k of keysToRemove) delete updatedCssVars[k];

    const newAst: LayoutAST = {
      ...ctx!.ast,
      customTokens: { ...ctx!.ast.customTokens, [key]: value },
      brand: {
        ...ctx!.ast.brand,
        extractedCssVariables: Object.keys(updatedCssVars).length > 0 ? updatedCssVars : undefined,
      },
    };
    ctx!.replaceAst(newAst);
  }

  function handleReset() {
    const newAst: LayoutAST = {
      ...ctx!.ast,
      customTokens: {
        ...ctx!.ast.customTokens,
        accent: undefined,
        bg: undefined,
        surface: undefined,
        text: undefined,
      },
    };
    ctx!.replaceAst(newAst);
    setLocalTokens({
      accent: tokens.accent,
      bg: tokens.bg,
      surface: tokens.surface,
      text: tokens.text,
    });
  }

  const hasOverrides = EDITABLE_TOKENS.some(
    (t) => ctx.ast.customTokens?.[t.key] !== undefined,
  );

  return (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        zIndex: 30000,
        marginTop: 6,
        background: "var(--panel)",
        borderRadius: 12,
        boxShadow: "0 16px 48px rgba(0,0,0,0.18)",
        border: "1px solid var(--border)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        width: 300,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              fontWeight: 700,
              color: "var(--text)",
            }}
          >
            Color Palette
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--subtle)" }}>
            Edit global design tokens
          </p>
        </div>
        {hasOverrides && (
          <button
            onClick={handleReset}
            style={{
              fontSize: 10,
              color: "#ef4444",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              padding: "3px 6px",
            }}
          >
            Reset
          </button>
        )}
      </div>

      <div
        style={{
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {EDITABLE_TOKENS.map((token) => (
          <div key={token.key}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <div>
                <span
                  style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}
                >
                  {token.label}
                </span>
                <span style={{ fontSize: 10, color: "var(--subtle)", marginLeft: 6 }}>
                  {token.description}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    fontFamily: "monospace",
                  }}
                >
                  {localTokens[token.key as string]}
                </span>
                <div style={{ position: "relative", width: 24, height: 24 }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 5,
                      background: localTokens[token.key as string],
                      border: "1.5px solid rgba(0,0,0,0.15)",
                      cursor: "pointer",
                    }}
                  />
                  <input
                    type="color"
                    value={localTokens[token.key as string]}
                    onChange={(e) =>
                      handleChange(token.key as string, e.target.value)
                    }
                    style={{
                      position: "absolute",
                      inset: 0,
                      opacity: 0,
                      width: "100%",
                      height: "100%",
                      cursor: "pointer",
                    }}
                  />
                </div>
              </div>
            </div>
            {/* Accent presets row */}
            {token.key === "accent" && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    onClick={() => handleChange("accent", color)}
                    title={color}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: color,
                      border:
                        localTokens.accent === color
                          ? `2px solid ${ACCENT}`
                          : "1.5px solid rgba(0,0,0,0.12)",
                      cursor: "pointer",
                      padding: 0,
                      flexShrink: 0,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <p style={{ margin: 0, fontSize: 10, color: "var(--subtle)" }}>
          Live preview · Ctrl+Z to undo · Use Design AI for advanced edits
        </p>
      </div>
    </div>
  );
}
