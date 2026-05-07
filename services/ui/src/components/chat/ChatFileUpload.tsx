'use client';

import { CheckCircle, FileText, Loader2 } from 'lucide-react';
import { Icon } from '@/components/ui/Icon';

export interface ChunkProgress {
  stage: string;
  processed?: number;
  total?: number;
}

const STAGE_LABELS: Record<string, string> = {
  chunking: 'Splitting document',
  embedding: 'Embedding',
  detecting: 'Detecting type',
  excerpting: 'Extracting sections',
  extracting: 'Analyzing',
  storing: 'Saving',
};

export interface ChatFileUploadProps {
  fileName: string;
  fileSize: number;
  progress: number;
  status: 'uploading' | 'processing' | 'done' | 'error';
  stage?: string;
  chunkProgress?: ChunkProgress;
  errorMessage?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatFileUpload({ fileName, fileSize, progress, status, stage, chunkProgress, errorMessage }: ChatFileUploadProps) {
  if (status === 'done') {
    return (
      <div className="chat-file-upload chat-file-upload--done">
        <Icon icon={FileText} size="sm" className="chat-file-upload__icon chat-file-upload__icon--primary" />
        <span className="chat-file-upload__name chat-file-upload__name--inline">{fileName}</span>
        <span className="chat-file-upload__size">&middot;&nbsp;{formatSize(fileSize)}</span>
        <Icon icon={CheckCircle} size="sm" className="chat-file-upload__check-icon" />
      </div>
    );
  }

  if (status === 'processing') {
    const chunkPct = chunkProgress?.total
      ? Math.round((chunkProgress.processed ?? 0) / chunkProgress.total * 100)
      : null;
    const chunkLabel = chunkProgress
      ? (STAGE_LABELS[chunkProgress.stage] ?? chunkProgress.stage)
      : null;

    return (
      <div className="chat-file-upload">
        <div className="chat-file-upload__header">
          <Icon icon={FileText} size="sm" className="chat-file-upload__icon chat-file-upload__icon--primary" />
          <span className="chat-file-upload__name">{fileName}</span>
          <span className="chat-file-upload__size">{formatSize(fileSize)}</span>
        </div>
        <div className="chat-file-upload__stage-row">
          <Icon icon={Loader2} size="sm" className="chat-file-upload__spinner" />
          <span className="chat-file-upload__status">{stage ?? 'Processing…'}</span>
        </div>
        {chunkProgress && (
          <div className="chat-file-upload__chunk-progress">
            <div className="chat-file-upload__chunk-bar">
              <div
                className="chat-file-upload__chunk-fill"
                style={{ width: chunkPct !== null ? `${chunkPct}%` : '100%' }}
              />
            </div>
            <span className="chat-file-upload__chunk-label">
              {chunkLabel}
              {chunkProgress.total
                ? ` ${chunkProgress.processed ?? 0}/${chunkProgress.total} chunks`
                : '…'}
            </span>
          </div>
        )}
      </div>
    );
  }

  const isError = status === 'error';
  const errorLabel = errorMessage
    ? errorMessage.length > 80 ? errorMessage.slice(0, 80) + '…' : errorMessage
    : 'Upload failed';

  return (
    <div className="chat-file-upload">
      <div className="chat-file-upload__header">
        <Icon icon={FileText} size="sm" className={`chat-file-upload__icon${isError ? '' : ''}`} />
        <span className="chat-file-upload__name">{fileName}</span>
        <span className="chat-file-upload__size">{formatSize(fileSize)}</span>
      </div>
      <div className="chat-file-upload__track">
        <div
          className={`chat-file-upload__fill${isError ? ' chat-file-upload__fill--error' : ''}`}
          style={{ width: isError ? '100%' : `${progress}%` }}
        />
      </div>
      <div className={`chat-file-upload__status${isError ? ' chat-file-upload__status--error' : ''}`}>
        {status === 'uploading' ? `Uploading… ${progress}%` : isError ? errorLabel : ''}
      </div>
    </div>
  );
}
