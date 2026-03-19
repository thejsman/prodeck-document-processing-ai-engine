'use client';

import { FileUploader } from '@/components/FileUploader';

export default function IngestPage() {
  return (
    <>
      <div className="page-header">
        <h1>Document Ingestion</h1>
        <p className="muted">Upload documents to index them into a namespace&apos;s knowledge base.</p>
      </div>
      <FileUploader />
    </>
  );
}
