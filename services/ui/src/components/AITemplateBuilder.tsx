'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { generateTemplate, modifyTemplate } from '@/lib/api';

interface Props {
  /** Current YAML content in the editor — used as context for modify. */
  currentYaml: string;
  /** Called when the AI produces YAML to inject into the editor. */
  onYamlGenerated: (yaml: string) => void;
}

export function AITemplateBuilder({ currentYaml, onYamlGenerated }: Props) {
  const { apiKey } = useAuth();

  const [prompt, setPrompt] = useState('');
  const [instruction, setInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [modifying, setModifying] = useState(false);
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

  const handleModify = async () => {
    if (!apiKey || !instruction.trim()) return;
    if (!currentYaml.trim()) {
      setError('No template loaded in editor to modify');
      return;
    }
    setModifying(true);
    setError('');
    try {
      const yaml = await modifyTemplate(apiKey, currentYaml, instruction.trim());
      onYamlGenerated(yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setModifying(false);
    }
  };

  return (
    <div className="ai-builder card">
      <div className="ai-builder-header">
        <h3>AI Template Builder</h3>
        <p className="muted">
          Describe what you need and let AI generate or modify a template.
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
          disabled={!prompt.trim() || generating || modifying}
        >
          {generating ? <><span className="spinner" /> Generating…</> : 'Generate Template'}
        </button>
      </div>

      {/* Divider */}
      <div className="ai-builder-divider" />

      {/* Modify section */}
      <div className="ai-builder-section">
        <label className="ai-builder-label" htmlFor="ai-instruction">
          Modify current template
        </label>
        <textarea
          id="ai-instruction"
          className="ai-builder-textarea"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder='e.g. "Add a pricing section" or "Shorten all instructions"'
          rows={2}
        />
        <button
          className="btn ai-builder-btn"
          onClick={handleModify}
          disabled={!instruction.trim() || !currentYaml.trim() || generating || modifying}
        >
          {modifying ? <><span className="spinner" /> Applying…</> : 'Apply Change'}
        </button>
      </div>

      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}
