'use client';

import { AIAssistBlock } from './AIAssistBlock';

interface InstructionsTabProps {
  instructionsMd: string;
  onChange: (md: string) => void;
  onAIAssist: (instruction: string) => Promise<void>;
}

export function InstructionsTab({ instructionsMd, onChange, onAIAssist }: InstructionsTabProps) {
  const wordCount = instructionsMd.trim() ? instructionsMd.trim().split(/\s+/).length : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
        These instructions are injected into the AI system prompt when generating proposals with this skill.
        Write in natural language — identity, writing rules, industry context, anti-patterns.
      </p>

      <textarea
        value={instructionsMd}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`## Identity\nYou are writing a proposal for...\n\n## Writing Rules\n- Rule 1\n- Rule 2\n\n## Industry Context\n...\n\n## Anti-Patterns (DO NOT)\n- ...`}
        style={{
          flex: 1,
          minHeight: 400,
          width: '100%',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 12px',
          color: 'var(--text)',
          fontSize: 13,
          fontFamily: 'var(--font-mono, "Fira Code", "JetBrains Mono", monospace)',
          lineHeight: 1.6,
          resize: 'vertical',
          boxSizing: 'border-box',
          outline: 'none',
          tabSize: 2,
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{wordCount} words</span>
      </div>

      <AIAssistBlock
        placeholder={`e.g. "Add rules about avoiding jargon and keeping language accessible to non-technical stakeholders"`}
        onApply={onAIAssist}
      />
    </div>
  );
}
