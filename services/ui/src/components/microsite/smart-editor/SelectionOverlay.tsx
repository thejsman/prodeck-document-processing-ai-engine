'use client';

import React from 'react';
import type { BridgeMessage } from '@/lib/microsite-bridge';

interface Props {
  hovered: BridgeMessage | null;
  selected: BridgeMessage | null;
  isProcessing: boolean;
  onClearSelected: () => void;
}

function chipLabel(msg: BridgeMessage): string {
  const section = msg.sectionType ? `${msg.sectionType} › ` : '';
  return `${section}${msg.label}`;
}

export function SelectionOverlay({ hovered, selected, isProcessing, onClearSelected }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {/* Processing dim */}
      {isProcessing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
            gap: 8,
          }}
        >
          <SpinnerIcon />
          Applying edit…
        </div>
      )}

      {/* Hover highlight — only when nothing is selected */}
      {!isProcessing && hovered && !selected && (
        <Highlight
          rect={hovered.rect}
          color="rgba(13,153,255,0.55)"
          fill="rgba(13,153,255,0.04)"
          dash
          label={chipLabel(hovered)}
          labelColor="rgba(13,153,255,0.9)"
        />
      )}

      {/* Selected highlight */}
      {!isProcessing && selected && (
        <Highlight
          rect={selected.rect}
          color="#0D99FF"
          fill="rgba(13,153,255,0.07)"
          label={chipLabel(selected)}
          labelColor="#0D99FF"
          showClose
          onClose={onClearSelected}
        />
      )}
    </div>
  );
}

interface HighlightProps {
  rect: { top: number; left: number; width: number; height: number };
  color: string;
  fill: string;
  dash?: boolean;
  label: string;
  labelColor: string;
  showClose?: boolean;
  onClose?: () => void;
}

function Highlight({ rect, color, fill, dash, label, labelColor, showClose, onClose }: HighlightProps) {
  // If the element is near the top, put the label inside (bottom-aligned) to avoid clipping
  const labelAbove = rect.top > 26;

  return (
    <div
      style={{
        position: 'absolute',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        outline: `1.5px ${dash ? 'dashed' : 'solid'} ${color}`,
        outlineOffset: -1,
        background: fill,
        borderRadius: 2,
        pointerEvents: showClose ? 'auto' : 'none',
        // No CSS transition — snap immediately like Figma
      }}
    >
      {/* Label chip */}
      <div
        style={{
          position: 'absolute',
          ...(labelAbove
            ? { top: -22, left: -1 }
            : { bottom: 4, left: 4 }),
          height: 20,
          padding: '0 6px',
          borderRadius: 3,
          background: labelColor,
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 10.5,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 600,
          letterSpacing: '0.025em',
          whiteSpace: 'nowrap',
          pointerEvents: showClose ? 'auto' : 'none',
          userSelect: 'none',
        }}
      >
        <span style={{ opacity: 0.8 }}>◆</span>
        <span>{label}</span>
        {showClose && onClose && (
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 2,
              color: '#fff',
              cursor: 'pointer',
              padding: '0 3px',
              fontSize: 11,
              lineHeight: '16px',
              marginLeft: 2,
              pointerEvents: 'auto',
            }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ animation: 'spin 0.7s linear infinite' }}
    >
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
