'use client';

import { MemoryEditor } from '@/components/MemoryEditor';

export default function MemoryPage() {
  return (
    <>
      <div className="page-header">
        <h1>Project Memory</h1>
        <p className="muted">
          View and edit structured memory used by the proposal generator and other processors.
        </p>
      </div>
      <MemoryEditor />
    </>
  );
}
