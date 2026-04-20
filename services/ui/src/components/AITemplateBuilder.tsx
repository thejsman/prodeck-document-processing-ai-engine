'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { generateTemplate } from '@/lib/api';

interface Props {
  /** Called when the AI produces YAML to inject into the editor. */
  onYamlGenerated: (yaml: string) => void;
}

export function AITemplateBuilder({ onYamlGenerated }: Props) {
  const { apiKey } = useAuth();

  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!apiKey || !prompt.trim()) return;
    setGenerating(true);
    setError('');
    try {
      const yaml = await generateTemplate(apiKey, prompt.trim());
      onYamlGenerated(yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="ai-builder card">
      <div className="ai-builder-header">
        <h3>AI Template Builder</h3>
        <p className="muted">
          Describe what you need and let AI generate a template.
        </p>
      </div>

      {/* Generate section */}
      <div className="ai-builder-section">
        <label className="ai-builder-label" htmlFor="ai-prompt">
          Generate template from prompt
        </label>
        <textarea
          id="ai-prompt"
          className="ai-builder-textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Create a proposal template for fintech compliance consulting"
          rows={3}
        />
        <button
          className="btn btn-primary ai-builder-btn"
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
        >
          {generating ? <><span className="spinner" /> Generating…</> : 'Generate Template'}
        </button>
      </div>

      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
