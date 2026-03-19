'use client';

import { ConfigEditor } from '@/components/ConfigEditor';

export default function ConfigPage() {
  return (
    <>
      <div className="page-header">
        <h1>Namespace Configuration</h1>
        <p className="muted">
          View and edit configuration used by the pipeline engine for each namespace.
        </p>
      </div>
      <ConfigEditor />
    </>
  );
}
