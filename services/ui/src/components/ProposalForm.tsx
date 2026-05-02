'use client';

import { useState } from 'react';
import {
  generateProposal,
  type ProposalDocument,
  type GenerateProposalRequest,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useExecutionStore } from '@/core/execution/execution-store';
import { NamespaceSelector } from './NamespaceSelector';
import { TemplateSelector } from './TemplateSelector';

interface Props {
  onGenerate: (doc: ProposalDocument, request: GenerateProposalRequest) => void;
  onGenerateStart?: (request: GenerateProposalRequest) => void;
  onGenerateFail?: (error: string) => void;
  isGenerating: boolean;
  setIsGenerating: (v: boolean) => void;
  onNamespaceChange?: (ns: string) => void;
  modalMode?: boolean;
}

export function ProposalForm({
  onGenerate,
  onGenerateStart,
  onGenerateFail,
  isGenerating,
  setIsGenerating,
  onNamespaceChange,
  modalMode = false,
}: Props) {
  const { apiKey } = useAuth();
  const addExecution = useExecutionStore((s) => s.addExecution);
  const updateExecution = useExecutionStore((s) => s.updateExecution);
  const [client, setClient] = useState('');
  const [projectType, setProjectType] = useState('');
  const [clientIndustry, setClientIndustry] = useState('');
  const [namespace, setNamespace] = useState('');
  const [template, setTemplate] = useState('default');
  const [overwrite, setOverwrite] = useState(false);
  const [teamSize, setTeamSize] = useState('');
  const [durationWeeks, setDurationWeeks] = useState('');
  const [ratePerWeek, setRatePerWeek] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!client.trim()) {
      setError('Client name is required');
      return;
    }

    // Pricing: all three or none.
    const hasTeam = teamSize.trim() !== '';
    const hasDuration = durationWeeks.trim() !== '';
    const hasRate = ratePerWeek.trim() !== '';
    const pricingCount = [hasTeam, hasDuration, hasRate].filter(Boolean).length;

    if (pricingCount > 0 && pricingCount < 3) {
      setError(
        'Deterministic pricing requires all three fields: team size, duration, and rate',
      );
      return;
    }

    const pricing =
      pricingCount === 3
        ? {
            teamSize: parseInt(teamSize, 10),
            durationWeeks: parseInt(durationWeeks, 10),
            ratePerWeek: parseFloat(ratePerWeek),
          }
        : null;

    if (pricing) {
      if (
        isNaN(pricing.teamSize) ||
        pricing.teamSize <= 0 ||
        isNaN(pricing.durationWeeks) ||
        pricing.durationWeeks <= 0 ||
        isNaN(pricing.ratePerWeek) ||
        pricing.ratePerWeek <= 0
      ) {
        setError('Pricing values must be positive numbers');
        return;
      }
    }

    const request: GenerateProposalRequest = {
      client: client.trim(),
      projectType: projectType.trim() || undefined,
      clientIndustry: clientIndustry.trim() || undefined,
      namespace: namespace || undefined,
      template,
      overwrite,
      pricing,
    };

    const execId = crypto.randomUUID();
    onGenerateStart?.(request);
    setIsGenerating(true);
    addExecution({ id: execId, type: 'proposal', status: 'running', title: client.trim() });
    try {
      const doc = await generateProposal(apiKey, request);
      updateExecution(execId, { status: 'completed' });
      onGenerate(doc, request);
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      onGenerateFail?.(msg);
      updateExecution(execId, { status: 'failed', errorMessage: msg });
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <form
      id={modalMode ? 'generate-proposal-form' : undefined}
      className={modalMode ? undefined : 'card'}
      onSubmit={handleSubmit}
    >
      {!modalMode && <h2>Generate Proposal</h2>}

      <div className="form-row">
        <div className="form-group">
          <label>Client *</label>
          <input
            className="input"
            type="text"
            placeholder="Acme Corp"
            value={client}
            onChange={(e) => setClient(e.target.value)}
            disabled={isGenerating}
          />
        </div>
        <div className="form-group">
          <label>Service Type *</label>
          <input
            className="input"
            type="text"
            placeholder="Digital Marketing"
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
            disabled={isGenerating}
          />
        </div>
        <div className="form-group">
          <label>Client Industry</label>
          <input
            className="input"
            type="text"
            placeholder="Real Estate"
            value={clientIndustry}
            onChange={(e) => setClientIndustry(e.target.value)}
            disabled={isGenerating}
          />
        </div>
      </div>

      <NamespaceSelector
        value={namespace}
        onChange={(ns) => { setNamespace(ns); onNamespaceChange?.(ns); }}
      />

      <TemplateSelector value={template} onChange={setTemplate} namespace={namespace} />

      <fieldset className="fieldset">
        <legend>Deterministic Pricing (optional)</legend>
        <div className="form-row">
          <div className="form-group">
            <label>Team Size</label>
            <input
              className="input"
              type="number"
              min="1"
              placeholder="5"
              value={teamSize}
              onChange={(e) => setTeamSize(e.target.value)}
              disabled={isGenerating}
            />
          </div>
          <div className="form-group">
            <label>Duration (weeks)</label>
            <input
              className="input"
              type="number"
              min="1"
              placeholder="12"
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(e.target.value)}
              disabled={isGenerating}
            />
          </div>
          <div className="form-group">
            <label>Rate / week ($)</label>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="2500"
              value={ratePerWeek}
              onChange={(e) => setRatePerWeek(e.target.value)}
              disabled={isGenerating}
            />
          </div>
        </div>
      </fieldset>

      <div className="checkbox-group">
        <input
          type="checkbox"
          id="overwrite"
          checked={overwrite}
          onChange={(e) => setOverwrite(e.target.checked)}
          disabled={isGenerating}
        />
        <label htmlFor="overwrite">Overwrite (skip versioning)</label>
      </div>

      {error && <p className="error">{error}</p>}

      {!modalMode && (
        <button type="submit" className="btn btn-primary" disabled={isGenerating}>
          {isGenerating ? <><span className="spinner" /> Generating...</> : 'Generate Proposal'}
        </button>
      )}
    </form>
  );
}
