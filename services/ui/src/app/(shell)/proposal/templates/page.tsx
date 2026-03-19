'use client';

import { useState, useCallback } from 'react';
import { TemplateEditor } from '@/components/TemplateEditor';
import { AITemplateBuilder } from '@/components/AITemplateBuilder';

export default function TemplatesPage() {
  // Shared state for AI ↔ editor communication
  const [aiYaml, setAiYaml] = useState<string | null>(null);
  const [currentYaml, setCurrentYaml] = useState('');

  const handleAiYamlConsumed = useCallback(() => setAiYaml(null), []);

  return (
    <>
      <div className="page-header">
        <h1>Proposal Templates</h1>
        <p className="muted">Manage YAML templates used by the proposal generator.</p>
      </div>

      <AITemplateBuilder
        currentYaml={currentYaml}
        onYamlGenerated={setAiYaml}
      />

      <TemplateEditor
        aiInjectYaml={aiYaml}
        onAiYamlConsumed={handleAiYamlConsumed}
        onContentChange={setCurrentYaml}
      />
    </>
  );
}
