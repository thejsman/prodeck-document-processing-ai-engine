'use client';

import { useState } from 'react';
import type { SkillApi, MicrositeDefaultsApi, PricingDefaultsApi } from '@/lib/api';
import { AIAssistBlock } from './AIAssistBlock';

interface TemplateOption { id: string; name: string }
interface NamespaceOption { name: string }

interface OverviewTabProps {
  skill: Partial<SkillApi>;
  onChange: (updates: Partial<SkillApi>) => void;
  onAIGenerate: (description: string) => Promise<void>;
  generating: boolean;
  namespaces?: NamespaceOption[];
  templates?: TemplateOption[];
}

function ChipInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [inputVal, setInputVal] = useState('');
  const add = () => {
    const trimmed = inputVal.trim();
    if (trimmed && !values.includes(trimmed)) onChange([...values, trimmed]);
    setInputVal('');
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {values.map((v) => (
        <span
          key={v}
          style={{
            background: 'var(--primary)',
            color: '#fff',
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {v}
          <button
            onClick={() => onChange(values.filter((x) => x !== v))}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        }}
        onBlur={add}
        placeholder={placeholder}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '3px 8px',
          fontSize: 12,
          background: 'var(--bg)',
          color: 'var(--text)',
          minWidth: 80,
          outline: 'none',
        }}
      />
    </div>
  );
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'new-skill';
}

function fieldStyle(): React.CSSProperties {
  return {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '7px 10px',
    color: 'var(--text)',
    fontSize: 13,
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'inherit',
  };
}

export function OverviewTab({
  skill,
  onChange,
  onAIGenerate,
  generating,
  namespaces = [],
  templates = [],
}: OverviewTabProps) {
  const [aiDescription, setAiDescription] = useState('');

  const handleGenerateClick = async () => {
    if (!aiDescription.trim()) return;
    await onAIGenerate(aiDescription.trim());
  };

  const update = (patch: Partial<SkillApi>) => onChange({ ...skill, ...patch });
  const scope = skill.scope ?? 'global';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Name */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Name *
        </label>
        <input
          value={skill.displayName ?? ''}
          onChange={(e) => update({ displayName: e.target.value, slug: slugify(e.target.value) })}
          placeholder="Fintech SaaS Proposals"
          style={fieldStyle()}
        />
        {skill.slug && (
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Slug: <code>{skill.slug}</code></p>
        )}
      </div>

      {/* Description */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Description
        </label>
        <textarea
          value={skill.description ?? ''}
          onChange={(e) => update({ description: e.target.value })}
          placeholder="For fintech and financial services SaaS consulting engagements"
          rows={2}
          style={{ ...fieldStyle(), resize: 'vertical' }}
        />
      </div>

      {/* Tone */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Tone
        </label>
        <input
          value={skill.toneDescription ?? ''}
          onChange={(e) => update({ toneDescription: e.target.value })}
          placeholder="confident, technical, ROI-focused"
          style={fieldStyle()}
        />
      </div>

      {/* Industries */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Industries
        </label>
        <ChipInput
          values={skill.industries ?? []}
          onChange={(v) => update({ industries: v })}
          placeholder="Add industry + Enter"
        />
      </div>

      {/* Project Types */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Project Types
        </label>
        <ChipInput
          values={skill.projectTypes ?? []}
          onChange={(v) => update({ projectTypes: v })}
          placeholder="Add project type + Enter"
        />
      </div>

      {/* Tags */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Tags
        </label>
        <ChipInput
          values={skill.tags ?? []}
          onChange={(v) => update({ tags: v })}
          placeholder="Add tag + Enter"
        />
      </div>

      {/* Scope */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Scope
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" checked={scope === 'global'} onChange={() => update({ scope: 'global', namespace: undefined })} />
            Global (all namespaces)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="radio" checked={scope === 'namespace'} onChange={() => update({ scope: 'namespace' })} />
            Namespace-specific:
            {scope === 'namespace' && (
              <select
                value={skill.namespace ?? ''}
                onChange={(e) => update({ namespace: e.target.value })}
                style={{ ...fieldStyle(), width: 'auto', padding: '4px 8px' }}
              >
                <option value="">— select —</option>
                {namespaces.map((n) => (
                  <option key={n.name} value={n.name}>{n.name}</option>
                ))}
              </select>
            )}
          </label>
        </div>
      </div>

      {/* Base Template */}
      <div>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Base Template <span style={{ fontWeight: 400, fontSize: 10 }}>(optional)</span>
        </label>
        <select
          value={skill.defaultTemplate ?? ''}
          onChange={(e) => update({ defaultTemplate: e.target.value || undefined })}
          style={fieldStyle()}
        >
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* AI Assist — full generation */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, background: 'var(--panel-soft, var(--panel))', marginTop: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--text)' }}>AI Assist</div>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          Describe what this skill is for and AI will fill in all tabs at once.
        </p>
        <textarea
          value={aiDescription}
          onChange={(e) => setAiDescription(e.target.value)}
          placeholder={`e.g. "I need a skill for enterprise SaaS proposals targeting fintech companies, with SOC 2 compliance and tiered pricing. Confident and technical tone."`}
          rows={4}
          disabled={generating}
          style={{ ...fieldStyle(), resize: 'vertical' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button
            onClick={handleGenerateClick}
            disabled={generating || !aiDescription.trim()}
            style={{
              background: 'var(--primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 500,
              cursor: generating || !aiDescription.trim() ? 'not-allowed' : 'pointer',
              opacity: generating || !aiDescription.trim() ? 0.6 : 1,
            }}
          >
            {generating ? 'Generating…' : 'Generate ▶'}
          </button>
        </div>
      </div>
    </div>
  );
}
