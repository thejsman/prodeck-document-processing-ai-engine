'use client';

import { TemplateManager } from '@/components/TemplateManager';

export default function TemplatesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Proposal Templates</h1>
        <p className="muted">
          Create and edit the YAML templates that control which sections the proposal generator produces.
        </p>
      </div>
      <TemplateManager />
    </>
  );
}
